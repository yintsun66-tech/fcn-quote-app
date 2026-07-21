import { describe, expect, it } from "vitest";
import { decryptEmployeeNumber, encryptEmployeeNumber, hashPassword, keyedHash, sha256Bytes, verifyPassword } from "../src/crypto";

const DATA_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const LOOKUP_KEY = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

describe("crypto primitives", () => {
  it("hashes and verifies passwords without storing plaintext", async () => {
    const result = await hashPassword("Correct Horse Battery 123!", 10_000, LOOKUP_KEY);
    expect(result.hash).not.toContain("Correct Horse");
    expect(result.algorithm).toBe("PBKDF2-HMAC-SHA256+HMAC-SHA256-PEPPER-v1");
    expect(await verifyPassword("Correct Horse Battery 123!", result.hash, result.salt, result.iterations, LOOKUP_KEY)).toBe(true);
    expect(await verifyPassword("Wrong Password 123!", result.hash, result.salt, result.iterations, LOOKUP_KEY)).toBe(false);
    expect(await verifyPassword("Correct Horse Battery 123!", result.hash, result.salt, result.iterations, DATA_KEY)).toBe(false);
  });

  it("encrypts employee numbers and decrypts only with the configured key", async () => {
    const encrypted = await encryptEmployeeNumber(DATA_KEY, "12345");
    expect(encrypted.ciphertext).not.toContain("12345");
    expect(await decryptEmployeeNumber(DATA_KEY, encrypted.ciphertext, encrypted.iv)).toBe("12345");
  });

  it("creates stable keyed lookup hashes", async () => {
    const first = await keyedHash(LOOKUP_KEY, "12345");
    const second = await keyedHash(LOOKUP_KEY, "12345");
    const different = await keyedHash(LOOKUP_KEY, "54321");
    expect(first).toBe(second);
    expect(first).not.toBe(different);
  });

  it("hashes raw binary content without converting it to text", async () => {
    const first = await sha256Bytes(new Uint8Array([0, 255, 1, 254]));
    const second = await sha256Bytes(new Uint8Array([0, 255, 1, 254]).buffer);
    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
