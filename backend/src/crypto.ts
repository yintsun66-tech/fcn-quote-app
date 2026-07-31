import { AppError } from "./errors";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const binary = atob(base64);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    throw new AppError(500, "INVALID_SECRET_CONFIGURATION", "伺服器安全設定不正確。 ");
  }
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const key = base64UrlToBytes(secret);
  if (key.byteLength < 32) {
    throw new AppError(500, "INVALID_SECRET_CONFIGURATION", "伺服器安全設定不正確。 ");
  }
  return crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function importAesKey(secret: string): Promise<CryptoKey> {
  const key = base64UrlToBytes(secret);
  if (key.byteLength !== 32) {
    throw new AppError(500, "INVALID_SECRET_CONFIGURATION", "伺服器安全設定不正確。 ");
  }
  return crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export function randomToken(byteLength = 32): string {
  return bytesToBase64Url(randomBytes(byteLength));
}

export async function sha256Text(value: string): Promise<string> {
  return sha256Bytes(encoder.encode(value));
}

export async function sha256Bytes(value: ArrayBuffer | Uint8Array<ArrayBufferLike>): Promise<string> {
  const bytes = Uint8Array.from(value instanceof Uint8Array ? value : new Uint8Array(value));
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

export async function keyedHash(secret: string, value: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await importHmacKey(secret), encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

// Crockford base32 alphabet (uppercase, excludes I, L, O, U to avoid ambiguity).
const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// Deterministic short correlation code for email subjects: one uppercase Crockford
// base32 character per HMAC byte (5 bits each). Same (secret, value) always yields the
// same code, so outbound storage, the outbound worker rebuild, and inbound matching stay
// consistent. length must not exceed the 32-byte HMAC output.
export async function keyedShortCode(secret: string, value: string, length = 10): Promise<string> {
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await importHmacKey(secret), encoder.encode(value)));
  let code = "";
  for (let index = 0; index < length; index += 1) {
    code += CROCKFORD_BASE32[signature[index]! & 31];
  }
  return code;
}

export function rfqCorrelationCode(secret: string, rfqId: string): Promise<string> {
  return keyedShortCode(secret, `RFQ_CORRELATION_V1:${rfqId}`, 10);
}

export async function encryptEmployeeNumber(secret: string, employeeNumber: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importAesKey(secret), encoder.encode(employeeNumber));
  return { ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)), iv: bytesToBase64Url(iv) };
}

export async function decryptEmployeeNumber(secret: string, ciphertext: string, iv: string): Promise<string> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlToBytes(iv) },
      await importAesKey(secret),
      base64UrlToBytes(ciphertext)
    );
    return decoder.decode(plaintext);
  } catch {
    throw new AppError(500, "EMPLOYEE_DATA_DECRYPTION_FAILED", "行編資料無法解密。 ");
  }
}

async function derivePassword(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array<ArrayBuffer>> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    256
  ));
}

async function pepperPasswordHash(pepperSecret: string, derived: Uint8Array<ArrayBuffer>): Promise<string> {
  return keyedHash(pepperSecret, `PASSWORD_HASH_V1:${bytesToBase64Url(derived)}`);
}

export async function hashPassword(password: string, iterations: number, pepperSecret: string): Promise<{ hash: string; salt: string; algorithm: string; iterations: number }> {
  const salt = randomBytes(16);
  const derived = await derivePassword(password, salt, iterations);
  const hash = await pepperPasswordHash(pepperSecret, derived);
  return { hash, salt: bytesToBase64Url(salt), algorithm: "PBKDF2-HMAC-SHA256+HMAC-SHA256-PEPPER-v1", iterations };
}

export async function verifyPassword(password: string, expectedHash: string, salt: string, iterations: number, pepperSecret: string): Promise<boolean> {
  const derived = await derivePassword(password, base64UrlToBytes(salt), iterations);
  const actual = base64UrlToBytes(await pepperPasswordHash(pepperSecret, derived));
  const expected = base64UrlToBytes(expectedHash);
  if (actual.byteLength !== expected.byteLength) return false;
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual(left: ArrayBufferView<ArrayBuffer>, right: ArrayBufferView<ArrayBuffer>): boolean;
  };
  return subtle.timingSafeEqual(actual, expected);
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}
