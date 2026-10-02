import fs from "node:fs";
import path from "node:path";

// Every log KubeDeck keeps stops at this size and starts again, keeping the
// one before it beside it. desktop.log used to grow for as long as the app was
// installed: a line per kubectl call is about ten megabytes a day with a few
// clusters connected.
export const MAX_LOG_FILE_BYTES = 20 * 1024 * 1024;

// desktop.log -> desktop.previous.log, audit.jsonl -> audit.previous.jsonl.
export function previousLogPath(filePath: string): string {
  const extension = path.extname(filePath);
  return path.join(path.dirname(filePath), `${path.basename(filePath, extension)}.previous${extension}`);
}

// Appends `text`, first moving the file aside when the text would take it past
// `maxBytes`, so a log and its previous file together never hold much more than
// twice that. A file that cannot be moved - held open by another program on
// Windows, say - is written to anyway: losing the cap for a while is better
// than losing the line.
export function appendRotatingLog(filePath: string, text: string, maxBytes = MAX_LOG_FILE_BYTES): void {
  if (maxBytes > 0) {
    try {
      const size = fs.statSync(filePath).size;
      if (size > 0 && size + Buffer.byteLength(text, "utf8") > maxBytes) {
        const previousPath = previousLogPath(filePath);
        fs.rmSync(previousPath, { force: true });
        fs.renameSync(filePath, previousPath);
      }
    } catch {
      // No file yet, or it could not be moved; either way the append decides.
    }
  }
  fs.appendFileSync(filePath, text, "utf8");
}
