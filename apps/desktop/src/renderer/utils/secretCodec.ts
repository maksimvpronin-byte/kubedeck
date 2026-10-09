// Base64 for the Secret Data tab, by bytes rather than by atob's Latin-1, so a
// value with Cyrillic in it goes back to the cluster byte for byte. Strictness
// matches the backend's decodeBase64Strict: what is accepted here, it accepts.

const STRICT_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  // Spread in slices: one call with a large value runs out of stack.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string) {
  if (!STRICT_BASE64.test(encoded)) return null;
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  // Spare bits in the last group decode the same but re-encode differently;
  // the backend refuses those, so they are refused here too.
  return bytesToBase64(bytes) === encoded ? bytes : null;
}

export function encodeSecretText(text: string) {
  return bytesToBase64(new TextEncoder().encode(text));
}

// The text a value holds, or null when its bytes are not UTF-8 and editing
// them as text would change them.
export function decodeSecretText(encoded: string) {
  const bytes = base64ToBytes(encoded);
  if (!bytes) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

// Base64 as typed or pasted, wrapped lines included, in the one form the
// cluster is sent; null when it is not base64.
export function canonicalSecretBase64(input: string) {
  const compact = input.replace(/\s+/g, "");
  return base64ToBytes(compact) ? compact : null;
}
