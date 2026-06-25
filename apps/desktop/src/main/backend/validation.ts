export const MAX_LOG_TAIL_LINES = 5000;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]+$/;

export class RequestValidationError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function validateIdentifier(
  value: string,
  field: string,
  maxLength = 253,
): string {
  const text = String(value ?? "").trim();

  if (!text) {
    throw new RequestValidationError(400, "INVALID_IDENTIFIER", `${field} must not be empty`);
  }
  if (text.length > maxLength) {
    throw new RequestValidationError(400, "INVALID_IDENTIFIER", `${field} is too long`);
  }
  if (text.includes("/") || text.includes("\\") || text.includes("\0")) {
    throw new RequestValidationError(
      400,
      "INVALID_IDENTIFIER",
      `${field} contains an invalid path separator`,
    );
  }
  if (!IDENTIFIER_PATTERN.test(text)) {
    throw new RequestValidationError(
      400,
      "INVALID_IDENTIFIER",
      `${field} contains unsupported characters`,
    );
  }

  return text;
}

export function normalizeTailLines(value: string | null): number {
  if (value === null || value.trim() === "") return 500;
  if (!/^-?\d+$/.test(value.trim())) {
    throw new RequestValidationError(422, "INVALID_QUERY", "tail must be an integer");
  }

  const parsed = Number.parseInt(value, 10);
  return Math.max(1, Math.min(MAX_LOG_TAIL_LINES, parsed));
}

export function parseBooleanQuery(
  value: string | null,
  field: string,
  defaultValue = false,
): boolean {
  if (value === null || value.trim() === "") return defaultValue;

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;

  throw new RequestValidationError(422, "INVALID_QUERY", `${field} must be a boolean`);
}
