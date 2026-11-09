import {
  parsePrivateKey as parseAntelopeKey,
  signDigest as antelopeSignDigest,
  type AntelopeKeyPair,
} from "./antelope";

/** In-memory only. Never written to disk, never sent to a server. */
let secret: AntelopeKeyPair | null = null;

export function hasSecret(): boolean {
  return secret != null;
}

/**
 * Drop the session key and overwrite the 32 private-key bytes we own, so a
 * held reference (or a heap snapshot taken later) no longer contains them.
 * Limit: the pasted WIF *string* is immutable in JS and lives until GC.
 */
export function forgetSecret(): void {
  if (secret) {
    secret.privateKey.fill(0);
    secret = null;
  }
}

export function describeKey(kp: AntelopeKeyPair): { publicKey: string; legacy: string } {
  return { publicKey: kp.publicKeyString, legacy: kp.legacyPublicKeyString };
}

export function importSecret(raw: string): { publicKey: string; legacy: string } {
  return importParsedSecret(parseAntelopeKey(raw));
}

/**
 * Hold an already-parsed key pair as the session secret. Import UI parses
 * once (to look up the account) then transfers that same object here so a
 * second copy is never left on the heap.
 */
export function importParsedSecret(kp: AntelopeKeyPair): { publicKey: string; legacy: string } {
  // Replacing a key must not leave the previous one's bytes behind.
  if (secret && secret !== kp) secret.privateKey.fill(0);
  secret = kp;
  return describeKey(kp);
}

/**
 * Zero a parsed key that will not be held (failed import, abandoned lookup).
 * No-op when `kp` is the currently held secret — that one is owned by
 * `forgetSecret` / `importParsedSecret`.
 */
export function discardParsedKey(kp: AntelopeKeyPair | null | undefined): void {
  if (!kp || secret === kp) return;
  kp.privateKey.fill(0);
}

/** Sign a 32-byte digest, returning a SIG_K1_… signature string. */
export function signDigest(digest: Uint8Array): string {
  if (!secret) throw new Error("No private key in this session");
  return antelopeSignDigest(digest, secret);
}

export function sessionPublic(): { publicKey: string; legacy: string } | null {
  if (!secret) return null;
  return describeKey(secret);
}

export { parseAntelopeKey as parsePrivateKey };
