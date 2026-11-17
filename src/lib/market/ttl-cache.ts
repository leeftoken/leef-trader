/**
 * Small process-local TTL cache with a hard entry cap.
 *
 * Expiry is enforced on both reads and writes, so one-off keys do not remain
 * resident forever just because nothing asks for them a second time.
 */
export class TtlCache<K, V> {
  private entries = new Map<K, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError("TtlCache maxEntries must be a positive integer");
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new RangeError("TtlCache ttlMs must be positive");
    }
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: K, now = Date.now()): V | undefined {
    this.prune(now);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, now = Date.now()): void {
    this.prune(now);
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  prune(now = Date.now()): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
