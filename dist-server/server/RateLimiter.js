/** Fixed windows start at the first request. Rejections never extend them or evict another client's quota. */
export class RateLimiter {
    requests;
    windowMs;
    maxEntries;
    now;
    entries = new Map();
    timer;
    constructor(requests, windowMs, maxEntries, now = () => performance.now()) {
        this.requests = requests;
        this.windowMs = windowMs;
        this.maxEntries = maxEntries;
        this.now = now;
        this.timer = setInterval(() => this.sweep(), Math.min(windowMs, 60_000)).unref();
    }
    consume(key) {
        const now = this.now();
        let entry = this.entries.get(key);
        if (entry && entry.expiresAt <= now) {
            this.entries.delete(key);
            entry = undefined;
        }
        if (!entry) {
            // At capacity, reclaim expired entries before failing closed. Never reset a live quota to make space.
            if (this.entries.size >= this.maxEntries)
                this.sweep();
            if (this.entries.size >= this.maxEntries)
                return { allowed: false, retryAfterSeconds: Math.ceil((this.entries.values().next().value.expiresAt - now) / 1000) };
            entry = { count: 0, expiresAt: now + this.windowMs };
            this.entries.set(key, entry);
        }
        if (entry.count >= this.requests)
            return { allowed: false, retryAfterSeconds: Math.ceil((entry.expiresAt - now) / 1000) };
        entry.count += 1;
        return { allowed: true, retryAfterSeconds: 0 };
    }
    sweep() {
        const now = this.now();
        // All windows have equal duration and monotonic creation times, so the map is ordered by expiry.
        for (const [key, entry] of this.entries) {
            if (entry.expiresAt > now)
                break;
            this.entries.delete(key);
        }
    }
    get size() { return this.entries.size; }
    close() { clearInterval(this.timer); this.entries.clear(); }
}
