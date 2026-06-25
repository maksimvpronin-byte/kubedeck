import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { buildKubectlCommand, type KubectlCommand } from "./command";
import {
  classifyKubectlError,
  KubectlError,
  sanitizeKubectlText,
  truncateKubectlText,
} from "./errors";

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  commandPreview: string;
  returnCode: number;
}

export type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

interface ActiveProcess {
  child: ChildProcessWithoutNullStreams;
  cancel: (message: string) => void;
}

export class KubectlRunner {
  private readonly active = new Map<number, ActiveProcess>();
  private closed = false;

  constructor(
    private readonly log: (message: string) => void,
    private readonly spawnProcess: SpawnProcess = spawn as SpawnProcess,
  ) {}

  run(command: KubectlCommand): Promise<CommandResult> {
    if (this.closed) {
      return Promise.reject(new KubectlError({
        code: "KUBECTL_RUNTIME_STOPPED",
        message: "kubectl runtime is stopped",
        rawStderr: "",
        commandPreview: "",
      }));
    }

    const built = buildKubectlCommand(command);
    const stdinBytes = typeof command.stdinText === "string"
      ? Buffer.byteLength(command.stdinText, "utf8")
      : 0;

    this.log(
      `node kubectl preview=${built.preview} timeout=${command.timeoutSeconds}s maxOutput=${command.maxOutputBytes} stdinBytes=${stdinBytes}`,
    );

    return new Promise<CommandResult>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;

      try {
        child = this.spawnProcess(built.executable, built.args, {
          shell: false,
          windowsHide: true,
          env: built.environment,
        });
      } catch (error) {
        reject(new KubectlError({
          code: "KUBECTL_NOT_FOUND",
          message: `kubectl not found: ${command.kubectlPath}`,
          rawStderr: sanitizeKubectlText(
            error instanceof Error ? error.message : String(error),
          ),
          commandPreview: built.preview,
        }));
        return;
      }

      const processKey = child.pid ?? Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let totalBytes = 0;
      let settled = false;
      let timer: NodeJS.Timeout | undefined;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        this.active.delete(processKey);
      };

      const fail = (error: KubectlError, kill = false) => {
        if (settled) return;
        settled = true;

        if (kill && !child.killed) {
          try {
            child.kill();
          } catch {
            // Best effort only.
          }
        }

        cleanup();
        reject(error);
      };

      const cancel = (message: string) => {
        fail(new KubectlError({
          code: "KUBECTL_CANCELLED",
          message,
          rawStderr: "",
          commandPreview: built.preview,
        }), true);
      };

      this.active.set(processKey, { child, cancel });

      const collect = (target: Buffer[], chunk: Buffer | string) => {
        if (settled) return;

        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.length;

        if (command.maxOutputBytes > 0 && totalBytes > command.maxOutputBytes) {
          const partial = Buffer.concat([...stderrChunks, ...stdoutChunks, buffer]).toString("utf8");
          fail(new KubectlError({
            code: "OUTPUT_TOO_LARGE",
            message: `kubectl output is too large (${totalBytes} bytes, limit ${command.maxOutputBytes} bytes). Narrow the namespace/resource or reduce logs tail.`,
            rawStderr: truncateKubectlText(sanitizeKubectlText(partial)),
            commandPreview: built.preview,
          }), true);
          return;
        }

        target.push(buffer);
      };

      child.stdout.on("data", (chunk) => collect(stdoutChunks, chunk));
      child.stderr.on("data", (chunk) => collect(stderrChunks, chunk));

      child.stdin.on("error", (error: NodeJS.ErrnoException) => {
        if (settled || error.code === "EPIPE") return;
        fail(new KubectlError({
          code: "KUBECTL_STDIN_FAILED",
          message: "Unable to send input to kubectl",
          rawStderr: truncateKubectlText(sanitizeKubectlText(error.message)),
          commandPreview: built.preview,
        }), true);
      });

      child.on("error", (error: NodeJS.ErrnoException) => {
        const missing = error.code === "ENOENT";
        fail(new KubectlError({
          code: missing ? "KUBECTL_NOT_FOUND" : "KUBECTL_START_FAILED",
          message: missing
            ? `kubectl not found: ${command.kubectlPath}`
            : "kubectl process could not be started",
          rawStderr: truncateKubectlText(sanitizeKubectlText(error.message)),
          commandPreview: built.preview,
        }));
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        cleanup();

        const stdout = Buffer.concat(stdoutChunks).toString("utf8");
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        const returnCode = typeof code === "number" ? code : -1;

        if (returnCode !== 0) {
          reject(new KubectlError({
            code: classifyKubectlError(stderr),
            message: "kubectl command failed",
            rawStderr: truncateKubectlText(sanitizeKubectlText(stderr)),
            commandPreview: built.preview,
          }));
          return;
        }

        resolve({
          ok: true,
          stdout,
          stderr,
          commandPreview: built.preview,
          returnCode,
        });
      });

      if (command.timeoutSeconds > 0) {
        timer = setTimeout(() => {
          const raw = Buffer.concat(
            stderrChunks.length ? stderrChunks : stdoutChunks,
          ).toString("utf8");

          fail(new KubectlError({
            code: "TIMEOUT",
            message: `kubectl command timed out after ${command.timeoutSeconds}s`,
            rawStderr: truncateKubectlText(sanitizeKubectlText(raw)),
            commandPreview: built.preview,
          }), true);
        }, command.timeoutSeconds * 1000);
      }

      if (typeof command.stdinText === "string") {
        child.stdin.end(command.stdinText, "utf8");
      } else {
        child.stdin.end();
      }
    });
  }

  async runJson(command: KubectlCommand): Promise<Record<string, unknown>> {
    const result = await this.run(command);

    if (!result.stdout.trim()) {
      throw new KubectlError({
        code: "KUBECTL_EMPTY_RESPONSE",
        message: "kubectl returned an empty response instead of JSON",
        rawStderr: "",
        commandPreview: result.commandPreview,
      });
    }

    try {
      const value: unknown = JSON.parse(result.stdout);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("JSON root must be an object");
      }
      return value as Record<string, unknown>;
    } catch (error) {
      throw new KubectlError({
        code: "KUBECTL_INVALID_JSON",
        message: "kubectl returned invalid JSON",
        rawStderr: truncateKubectlText(sanitizeKubectlText(
          error instanceof Error ? error.message : String(error),
        )),
        commandPreview: result.commandPreview,
      });
    }
  }

  activeCount(): number {
    return this.active.size;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    const active = [...this.active.values()];
    for (const process of active) {
      process.cancel("kubectl command cancelled because KubeDeck is shutting down");
    }

    await Promise.all(active.map(({ child }) =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) {
          resolve();
          return;
        }

        const timer = setTimeout(resolve, 1000);
        child.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      }),
    ));

    this.active.clear();
  }
}
