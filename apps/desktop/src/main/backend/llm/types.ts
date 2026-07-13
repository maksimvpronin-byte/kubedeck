import type { LlmSettings } from "../config/types";

export type LlmRole = "system" | "user" | "assistant";

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmAnalyzeResourceRequest {
  clusterId: string;
  resource: string;
  kind?: string;
  namespace?: string;
  name: string;
  resourceObject: Record<string, unknown>;
  yaml?: string;
  events?: unknown[];
  describe?: string;
  relatedResources?: unknown[];
  relatedLinks?: unknown[];
  related?: unknown[];
  userRequest?: string;
  language?: string;
}

export interface LlmCompletion {
  answer: string;
  model: string;
  elapsedMs: number;
}

export interface LlmPromptBuildResult {
  messages: LlmMessage[];
  context: string;
  contextChars: number;
  truncated: boolean;
  maxOutputTokens: number;
}

export interface LlmTestRequest {
  settings?: Partial<LlmSettings>;
}
