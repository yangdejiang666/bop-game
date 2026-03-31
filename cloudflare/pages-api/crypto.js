import { PASSWORD_HASH_ITERATIONS } from "./constants.js";

function base64UrlEncode(bytes) {
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding =
    normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(`${normalized}${padding}`);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: PASSWORD_HASH_ITERATIONS,
    },
    key,
    256,
  );
  return `pbkdf2_sha256$${PASSWORD_HASH_ITERATIONS}$${base64UrlEncode(salt)}$${base64UrlEncode(new Uint8Array(bits))}`;
}

export async function verifyPassword(password, storedHash) {
  const [algorithm, iterationsText, saltText, hashText] = String(
    storedHash || "",
  ).split("$");
  if (
    algorithm !== "pbkdf2_sha256" ||
    !iterationsText ||
    !saltText ||
    !hashText
  ) {
    return false;
  }

  const iterations = Number(iterationsText);
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return false;
  }

  const salt = base64UrlDecode(saltText);
  const expected = base64UrlDecode(hashText);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations,
    },
    key,
    expected.byteLength * 8,
  );
  return constantTimeEqual(new Uint8Array(derived), expected);
}

export function createOpaqueToken(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `${prefix}_${base64UrlEncode(bytes)}`;
}
