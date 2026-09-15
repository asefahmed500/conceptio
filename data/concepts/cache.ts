import type { Concept } from "../types";

export const CACHE: Concept[] = [
  {
    id: "cache-aside",
    cat: "cache",
    title: "Cache-Aside",
    one: "App checks the cache first; on a miss it reads the DB, then fills the cache.",
    why: "The default caching pattern because it's opt-in and safe: the database stays the source of truth, and the cache is just an accelerator the app controls. No special cache infrastructure behavior required — works with any DB and any cache.",
    how: "Read: check cache → hit? return. Miss → read DB → write result to cache with a TTL → return. Write: update the DB, then DELETE the cache key (not update it) — the next read repopulates with fresh data. Delete-on-write avoids race conditions where an old value overwrites a newer one.",
    when: "Default choice for read-heavy data with tolerable staleness: product pages, user profiles, dashboards. Use write-through instead when reads are rare but consistency after write matters, and nothing when data must be strictly consistent (balances, stock) — cache those not at all or with tiny TTLs.",
    ref: "Redis Documentation",
    subtopics: [
      { name: "Lazy population", detail: "The cache fills only with data actually requested — no prefetch guessing. Cold caches mean the first request per key pays DB cost; warming fixes the deploy-time cliff." },
      { name: "Delete on write", detail: "After a DB update, DELETE the key rather than updating it. Updating can race with a concurrent read and cache stale data forever; deleting is idempotent and self-healing." },
      { name: "TTL as a safety net", detail: "Even with delete-on-write, set TTLs (seconds to hours). Bugs, missed invalidations, and replication lag all get bounded by expiry — TTLs turn mistakes into brief staleness." },
      { name: "Negative result handling", detail: "Decide explicitly: cache 'not found' briefly (negative caching) or let misses hit the DB every time. Nonexistent-ID lookups are a classic DoS vector without it." },
    ],
    code: `const TTL_SECONDS = 300;

async function getUser(userId) {
  const key = "user:" + userId;

  // 1. check cache
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit);

  // 2. miss -> database
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
  if (!rows[0]) {
    await redis.set(key, JSON.stringify({ notFound: true }), { EX: 60 }); // negative cache
    return null;
  }

  // 3. fill cache, return
  await redis.set(key, JSON.stringify(rows[0]), { EX: TTL_SECONDS });
  return rows[0];
}

// Write path: DB first, then DELETE (never update) the cache
async function updateUser(userId, changes) {
  await pool.query("UPDATE users SET name = $1 WHERE id = $2", [changes.name, userId]);
  await redis.del("user:" + userId); // next read repopulates with fresh data
  return getUser(userId);
}`,
    steps: ["Check cache", "Miss → read DB", "Write result to cache", "Next read → hit"],
  },
  {
    id: "cache-invalidation",
    cat: "cache",
    title: "Cache Invalidation",
    one: "The hardest problem in caching — deciding when stale data must be thrown out.",
    why: "A cache that serves outdated data is worse than no cache: users see wrong balances, deleted posts resurrect, support tickets pile up. Invalidation is hard because every strategy trades freshness against load — and the failures are silent.",
    how: "Three levers, usually combined: TTL (time-bounded staleness, simplest), explicit eviction (delete keys when source data changes — needs a reliable trigger), and versioned keys (bump a version prefix; old keys age out unused). The trigger can be application code, DB triggers/CDC, or an event bus.",
    when: "Pick by freshness budget: data that may lag 60s → TTL alone. Data that must update promptly → delete-on-write plus short TTL as backup. Cross-service invalidation → events (ProductUpdated → subscribers delete their keys). If you can't name the freshness budget, you haven't designed the cache.",
    ref: "Redis Documentation",
    subtopics: [
      { name: "Delete vs update", detail: "Delete-on-write wins: updates can race with concurrent readers and persist stale values; deletes are idempotent and the next read repopulates correctly." },
      { name: "Versioned keys", detail: "user:42:v7:data — bump the version when the entity changes. No delete storms, old versions expire naturally, and in-flight requests keep their consistent version." },
      { name: "Event-driven invalidation", detail: "CDC or domain events fan out invalidation to every cache that cares. Decouples producers from every downstream cache — but adds a failure mode to monitor." },
      { name: "Staleness budgets", detail: "Name it per data type: product price 5 min, cart contents 0 s, recommendations 1 h. The budget chooses the mechanism — not the other way around." },
    ],
    code: `// Versioned keys: invalidation without deletes
async function getVersion(entityId) {
  const v = await redis.get("ver:user:" + entityId);
  return v ?? (await pool.query("SELECT version FROM users WHERE id = $1", [entityId])).rows[0].version;
}

async function getUser(userId) {
  const version = await getVersion(userId); // cheap: usually cached itself
  const key = "user:" + userId + ":v" + version + ":full";
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit);

  const user = await db.users.find(userId);
  await redis.set(key, JSON.stringify(user), { EX: 3600 });
  return user;
}

// Write: bump version -> old keys orphan instantly, next read builds the new one
async function updateUser(userId, changes) {
  const newVersion = await db.users.updateAndBumpVersion(userId, changes);
  await redis.set("ver:user:" + userId, String(newVersion), { EX: 86400 });
}

// TTL as the backup net for everything you forgot to invalidate:
// every cached value carries EX — bugs degrade to temporary staleness, not forever-wrong.

// Monitoring staleness: track hit ratio + worst-case age
setInterval(async () => {
  const info = await redis.info("stats");
  console.log("hit ratio:", parseHitRatio(info));
}, 60000);`,
    steps: ["Data changes", "Cache still holds old value", "Invalidation triggered", "Fresh value cached next read"],
  },
  {
    id: "cache-cdn",
    cat: "cache",
    title: "CDN",
    one: "Static assets are cached on servers close to the user instead of the origin.",
    why: "Light in Lagos shouldn't wait 300ms for a server in Virginia. CDNs replicate content to edge locations worldwide — latency drops from RTT-to-origin to RTT-to-nearest-edge, origin load collapses, and DDoS traffic hits absorbent edges instead of your servers.",
    how: "You point DNS at the CDN; it fetches from origin on first request per edge (fill) and serves cached copies after. Cache behavior is controlled by Cache-Control headers (or CDN rules); static assets get long TTLs + content-hashed filenames; dynamic/API responses can be cached with short TTLs and cache keys.",
    when: "Everything public and static: images, JS/CSS, fonts, video. Increasingly dynamic content too — HTML and API GETs with proper cache keys and short TTLs (the 'dynamic CDN' model). Nothing for authenticated per-user responses unless cache keys include the user and you understand the risks.",
    ref: "Cloudflare Documentation",
    subtopics: [
      { name: "Edge PoPs", detail: "Hundreds of points of presence, each with its own cache. Users hit the nearest: latency falls from intercontinental to metro distances." },
      { name: "Cache-Control drives it", detail: "max-age=31536000, immutable for hashed assets; s-maxage for CDN vs browser split; stale-while-revalidate serves old while refreshing. The CDN obeys your headers — or your misconfiguration." },
      { name: "Origin shielding", detail: "A mid-tier shield cache between edges and origin: 100 edges miss once to the shield instead of 100 times to origin. Protects origins from cache-miss storms." },
      { name: "Purging", detail: "Deploy = purge by prefix/URL or rely on content hashing (no purge needed). Emergency purges exist but are the fire escape, not the plan." },
    ],
    code: `// Origin: headers ARE the CDN configuration
app.use("/assets", express.static("dist", {
  immutableMaxAge: "1y",              // hashed filenames never change content
  setHeaders: (res, path) => {
    if (path.match(/\\.[0-9a-f]{8}\\./)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
  },
}));

// API responses: cacheable with tight control
app.get("/v1/products/:id", async (req, res) => {
  const product = await db.products.find(req.params.id);
  res.set({
    // CDN caches 60s; browsers revalidate; serve stale up to 60s while refetching
    "Cache-Control": "public, s-maxage=60, max-age=0, stale-while-revalidate=60",
    "Cache-Tag": "product:" + product.id, // purge handle: flush by tag on product update
    Vary: "Accept-Encoding",
  });
  res.json({ data: product });
});

// Content hashing: the purge-free deploy strategy
// app.a1b2c3d4.js -> new build -> app.e5f6a7b8.js -> new URL -> no purge needed
// <script src="/assets/app.e5f6a7b8.js">`,
    steps: ["User request", "Nearest CDN edge", "Cache hit → served", "Cache miss → origin"],
  },
  {
    id: "cache-writethrough",
    cat: "cache",
    title: "Write-Through Cache",
    one: "Every write goes to the cache and the database at the same time.",
    why: "Cache-aside leaves a stale window after writes; write-through closes it by treating the cache as the primary write surface — the DB write happens in the same flow, so the cache is never stale once the write returns.",
    how: "Write request → write to cache AND to DB (synchronously, usually cache first then DB, or in one transactional flow) → acknowledge. Reads then always hit warm cache. The cache synchronously mirrors the DB, trading write latency (two writes) for guaranteed read consistency.",
    when: "Read-heavy data that must be consistent immediately after write: config, feature flags, user settings. Avoid for write-heavy workloads (every write pays double) and when the cache is volatile (restart wipes it — you need cache warming or accept cold reads).",
    ref: "AWS Documentation",
    subtopics: [
      { name: "Synchronized writes", detail: "Both writes complete before ack — no stale window. The cost is write latency and a new failure mode: DB write fails after cache write succeeded (compensate or use a transactional outbox)." },
      { name: "Read-after-write consistency", detail: "The entire point: users see their own writes instantly because the cache is already updated. Kills the 'I saved it but it shows old data' support ticket class." },
      { name: "Write amplification", detail: "Every write = 2 writes. Batches that would hit the DB once now also rewrite cache entries — measure write volume before choosing this pattern." },
      { name: "Cold start problem", detail: "Restarted/evicted caches have no data even though the DB is fine. Combine with read-through fills and warm critical keys at boot." },
    ],
    code: `// Write path: cache and DB updated together, then ack
async function updateSettings(userId, settings) {
  const key = "settings:" + userId;

  // 1. cache first (fast), then DB — or use a pipeline/transaction
  await redis.set(key, JSON.stringify(settings), { EX: 86400 });
  try {
    await pool.query(
      "INSERT INTO user_settings (user_id, settings, updated_at) VALUES ($1, $2, now()) ON CONFLICT (user_id) DO UPDATE SET settings = $2, updated_at = now()",
      [userId, JSON.stringify(settings)]
    );
  } catch (err) {
    await redis.del(key); // DB failed: don't leave diverging cache state
    throw err;
  }
  return settings; // reads now hit fresh cache — read-after-write guaranteed
}

// Read path: always warm
async function getSettings(userId) {
  const hit = await redis.get("settings:" + userId);
  if (hit) return JSON.parse(hit);

  const { rows } = await pool.query("SELECT settings FROM user_settings WHERE user_id = $1", [userId]);
  const settings = rows[0]?.settings ?? {};
  await redis.set("settings:" + userId, JSON.stringify(settings), { EX: 86400 }); // read-through fill
  return settings;
}`,
    steps: ["Write request", "Write to cache", "Write to database", "Both stay in sync"],
  },
  {
    id: "cache-writebehind",
    cat: "cache",
    title: "Write-Behind Cache",
    one: "Writes hit the cache immediately; the database updates asynchronously later.",
    why: "Some write bursts outrun any database: counters, view totals, telemetry, game events. Write-behind acknowledges instantly from the cache and drains to the DB in batches — user-perceived write latency drops to cache speed, and the DB absorbs blended batches it can actually handle.",
    how: "Write → cache updated → ack immediately. A background flusher collects dirty keys and writes them to the DB periodically or when a batch size hits. Durability moves into the cache layer: flushing must survive crashes (write-ahead log, replication, or accept loss) — this is the pattern's price.",
    when: "High-velocity, loss-tolerant counters and metrics: view counts, likes, heartbeats, rate-limit buckets. Never for money, inventory, or anything where losing the last 5 seconds of writes is unacceptable — unless the cache layer has durable persistence (Redis AOF, or an event log feeding it).",
    ref: "AWS Documentation",
    subtopics: [
      { name: "The flusher", detail: "Background process scanning dirty keys: batches writes (one UPDATE per 100 increments instead of 100 UPDATEs), applies via INCREMENT-style ops to avoid lost updates." },
      { name: "Durability trade-off", detail: "Ack-before-persist means a crash can lose unflushed writes. Mitigate: AOF-every-write, replicated cache, or an append-only event log as the true source with the DB as materialized view." },
      { name: "Batch merging", detail: "100 increments to one key between flushes = ONE db write with +100. Merge operations, don't queue states — that's where the throughput win lives." },
      { name: "Read-your-writes preserved", detail: "Reads hit the cache, which holds the newest value — users see their writes instantly even though the DB lags by seconds. The DB lag is invisible to the app flow." },
    ],
    code: `// High-velocity counter: view counts that would melt the DB inline
async function recordView(videoId) {
  const key = "views:" + videoId;
  await redis.multi().incr(key).sAdd("views:dirty", videoId).exec(); // mark dirty
  return Number(await redis.get(key)); // instant ack — DB not touched
}

// Flusher: drains dirty counters to the DB in merged batches
setInterval(async () => {
  const ids = await redis.sPopN("views:dirty", 500);
  if (!ids.length) return;

  // ONE round trip per batch instead of one per view event
  const pipeline = redis.pipeline();
  const values = {};
  for (const id of ids) values[id] = Number(await redis.get("views:" + id));

  await pool.query(
    "UPDATE videos SET views = views + v.delta FROM (SELECT * FROM unnest($1::text[], $2::bigint[]) AS t(id, delta)) v WHERE videos.id = v.id",
    [Object.keys(values), Object.values(values).map((v) => v - (lastFlushed[v.id] ?? 0))]
  );
  for (const id of ids) lastFlushed[id] = values[id];
}, 2000); // DB sees 2s-wide batches at blended volume`,
    steps: ["Write to cache (fast)", "Return to client", "Queued write", "Database updated async"],
  },
  {
    id: "cache-ttl",
    cat: "cache",
    title: "TTL (Time to Live)",
    one: "Cached data automatically expires after a set duration.",
    why: "Every cache entry is a bet that the source hasn't changed. TTL caps how long you keep making that bet: staleness becomes bounded and self-healing — even when invalidation code has a bug, the wrongness expires. It's the default correctness mechanism of caching.",
    how: "Each write carries EX (seconds) or PX (ms); the store evicts lazily (on access, expired) or actively (background sampling). Choose per key: seconds for volatile data, hours for stable reference data, and jitter (±10%) across keys so expirations don't synchronize into stampedes.",
    when: "Always set one — a TTL-less cache is a future incident (unbounded staleness + memory growth). Tune by freshness budget and recompute cost: expensive-to-recompute + stable → long TTL; cheap + volatile → short. Combine with explicit invalidation: TTL is the safety net, not the primary strategy.",
    ref: "Redis Documentation",
    subtopics: [
      { name: "Choosing the duration", detail: "Start from the staleness budget (how old can it be?) and the recompute cost (how expensive if too short?). These two numbers decide everything." },
      { name: "Jitter prevents stampedes", detail: "10,000 keys expiring at :00 = 10,000 simultaneous DB hits. Add random ±10% to every TTL: expirations spread out, load stays flat." },
      { name: "Lazy vs active expiry", detail: "Expired keys are evicted on access or by background sampling — an expired-but-untouched key still occupies memory briefly. Size caches for peak, not for logical content." },
      { name: "TTL ≠ invalidation", detail: "TTL bounds worst-case staleness; explicit invalidation provides freshness on events. Production caches use both: events for correctness, TTL for resilience." },
    ],
    code: `// TTL with jitter — the stampede-proof set
async function cacheSet(key, value, baseTtlSeconds) {
  const jitter = baseTtlSeconds * 0.1 * (Math.random() * 2 - 1); // ±10%
  await redis.set(key, JSON.stringify(value), { EX: Math.round(baseTtlSeconds + jitter) });
}

// Freshness budget -> TTL, per data type
const TTL_POLICY = {
  "product:":     3600,  // stable, expensive recompute -> 1h
  "product:price:": 60,  // volatile -> 1 min
  "user:session:":  86400,
  "search:":        30,  // cheap-ish recompute, volatile -> 30s
  "user:missing:":  30,  // negative cache: short
};

function ttlFor(key) {
  const prefix = Object.keys(TTL_POLICY).find((p) => key.startsWith(p));
  return TTL_POLICY[prefix] ?? 300; // sane default
}

// Observe expiry behavior: eviction stats + expired-key counts
const info = await redis.info("stats");
console.log("expired_keys:", info.match(/expired_keys:(\\d+)/)?.[1]);`,
    steps: ["Value cached", "TTL timer starts", "Timer expires", "Value evicted automatically"],
  },
  {
    id: "cache-stampede",
    cat: "cache",
    title: "Cache Stampede",
    one: "Many requests simultaneously miss the cache and hit the database at once.",
    why: "Your hottest key expires and 5,000 concurrent requests all miss at the same instant — all 5,000 run the same expensive query, the DB falls over, and the outage compounds as timeouts trigger retries. Stampedes turn a routine expiry into an incident.",
    how: "Three defenses, often combined: request coalescing (in-process or distributed lock — the first request recomputes, the rest wait on it), stale-while-revalidate (serve the expired value immediately while one request refreshes in the background), and TTL jitter (expirations stop synchronizing).",
    when: "Guard any hot key whose recompute is expensive: dashboards, product pages, config blobs. The in-flight-promise pattern costs ~10 lines and eliminates the entire class in-process; distributed locks cover multi-instance fleets; SWR covers user experience during refreshes.",
    ref: "Redis Documentation",
    subtopics: [
      { name: "Request coalescing", detail: "Map key → in-flight promise. Second..Nth callers await the SAME promise: one DB query per expiry regardless of concurrency. The single highest-value 10 lines in caching." },
      { name: "Stale-while-revalidate", detail: "Serve the expired value instantly (staleness within budget), refresh asynchronously. Users never wait; only the background refresher pays DB cost." },
      { name: "Distributed locks", detail: "Multi-instance: SET NX lock on miss; winner recomputes, losers poll the cache briefly then fall back to DB. Locks need TTLs — a crashed holder must not deadlock the key." },
      { name: "Probabilistic early expiry", detail: "XFetch: each read has a small probability of refreshing BEFORE expiry, proportional to recompute cost — hot keys refresh early and never actually expire." },
    ],
    code: `// Request coalescing: one flight per key, all callers share it
const inFlight = new Map();

async function getWithCoalescing(key, loader, ttlSeconds) {
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit);

  // someone is already loading this key -> join their flight
  if (inFlight.has(key)) return inFlight.get(key);

  const flight = (async () => {
    try {
      const value = await loader();
      await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
      return value;
    } finally {
      inFlight.delete(key); // flight over — next miss starts a new one
    }
  })();

  inFlight.set(key, flight);
  return flight;
}

// Usage: 5000 concurrent requests = 1 DB query, 4999 awaiters
const dashboard = await getWithCoalescing(
  "dashboard:global",
  () => pool.query("SELECT ... expensive aggregation ..."),
  60
);

// Stale-while-revalidate variant: serve expired instantly, refresh in background
async function getSwr(key, loader, ttl, maxStaleSeconds) {
  const raw = await redis.get(key);
  if (raw) {
    const { value, storedAt } = JSON.parse(raw);
    if (Date.now() - storedAt < (ttl + maxStaleSeconds) * 1000) {
      if (Date.now() - storedAt > ttl * 1000 && !inFlight.has(key)) {
        inFlight.set(key, getWithCoalescing(key, loader, ttl)); // background refresh
      }
      return value; // possibly slightly stale, always instant
    }
  }
  return getWithCoalescing(key, loader, ttl);
}`,
    steps: ["Cache entry expires", "Many requests arrive at once", "All miss simultaneously", "Database overloaded"],
  },
  {
    id: "cache-inmemory",
    cat: "cache",
    title: "In-Memory Cache (Redis/Memcached)",
    one: "Storing hot data in RAM for microsecond access instead of disk.",
    why: "Disk reads cost milliseconds; RAM reads cost microseconds — a 100-1000x gap that transforms p99 latency. An in-memory store between app and DB turns hot-path reads into near-free operations and offloads the database entirely.",
    how: "Redis/Memcached hold data in RAM with O(1) key access, TTL support, and eviction policies for when memory fills. Redis adds rich structures (hashes, sorted sets, streams) and persistence; Memcached stays a simpler multi-threaded pure cache. Apps treat it as a shared, fast key-value layer.",
    when: "Shared caches (multi-instance apps), sessions, rate-limit counters, leaderboards (sorted sets), queues. For single-process caches of tiny hot data, a plain in-process Map/LRU beats a network hop. Size by working set: cache the hot 5%, not the whole dataset — memory is the budget.",
    ref: "Redis Documentation",
    subtopics: [
      { name: "Redis vs Memcached", detail: "Redis: data structures, persistence, replication, Lua — the default choice. Memcached: simpler, multi-threaded, great for pure string caching at massive scale." },
      { name: "Eviction policy", detail: "allkeys-lru evicts least-recently-used anything; volatile-lru only evicts keys WITH TTLs. Pure caches: allkeys-lru + maxmemory. Mixing cache and durable data in one instance needs volatile-*." },
      { name: "In-process vs network cache", detail: "L1 (Map/LRU, ns) + L2 (Redis, ~ms) is the classic two-tier: process-local absorbs the hottest keys, Redis provides shared coherence. Beware L1 incoherence across instances." },
      { name: "The network is the floor", detail: "Redis round trips cost ~0.2–1ms — 10x better than DB, 1000x worse than a local Map. Batch with pipelines/MGET when doing many gets." },
    ],
    code: `// Sessions + hot reads: the bread-and-butter Redis patterns
await redis.set("sess:" + sid, JSON.stringify(session), { EX: 3600 });

// Hashes for objects: field-level access without serializing the blob
await redis.hSet("product:42", { name: "Trail Shoe", price: "129.00", stock: "12" });
const stock = await redis.hGet("product:42", "stock"); // just the field

// Sorted sets: leaderboards in O(log n)
await redis.zIncrBy("leaderboard", points, userId);
const top10 = await redis.zRevRange("leaderboard", 0, 9, { WITHSCORES: true });

// Pipelining: 100 reads, one round trip
const keys = products.map((p) => "product:" + p.id);
const results = await redis.pipeline(...keys.map((k) => ["get", k])).exec();

// L1/L2 two-tier with a tiny in-process LRU
class L1 {
  constructor(max = 500) { this.map = new Map(); this.max = max; }
  get(k) {
    if (!this.map.has(k)) return null;
    const v = this.map.get(k);
    this.map.delete(k); this.map.set(k, v); // touch = recency
    return v;
  }
  set(k, v) {
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value); // evict oldest
  }
}`,
    steps: ["App needs data", "Check RAM-based cache", "Hit: microseconds", "Miss: fall back to disk DB"],
  },
  {
    id: "cache-httpheaders",
    cat: "cache",
    title: "HTTP Caching Headers",
    one: "Cache-Control and ETag tell browsers and proxies how long to reuse a response.",
    why: "The most scalable cache is the one you don't operate: every browser and CDN already caches for free. HTTP caching headers are the API that controls that global cache fleet — set them right and a large share of your traffic never reaches your servers at all.",
    how: "Cache-Control declares freshness (max-age for browsers, s-maxage for shared caches, no-store to opt out) and staleness policy (stale-while-revalidate, must-revalidate). ETag/Last-Modified enable conditional requests: the client revalidates with If-None-Match and gets a body-less 304 when unchanged. Vary lists which request headers split the cache.",
    when: "Set deliberate headers on every response: immutable long-cache for hashed assets, short s-maxage for cacheable API GETs, no-store for auth/personalized responses. The common disasters: forgetting ETags on dynamic content (no 304s), and no-store everywhere out of fear (origin hammered).",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "max-age vs s-maxage", detail: "max-age governs browsers; s-maxage governs CDNs/proxies. Split them: CDN caches 60s while browsers revalidate every time — freshness control per tier." },
      { name: "ETag revalidation", detail: "Strong validation: client sends If-None-Match; unchanged → 304 with zero body. Saves bandwidth even when freshness expired — huge for large payloads." },
      { name: "stale-while-revalidate", detail: "Serve the stale copy instantly, refresh in the background. Absorbs expiry spikes (the HTTP-native stampede defense) at the cost of bounded staleness." },
      { name: "Vary correctness", detail: "Vary: Accept-Encoding, Authorization determines cache keys. Missing Vary on content-negotiated responses serves JSON to XML clients; over-Varying (User-Agent!) fragments the cache into uselessness." },
    ],
    code: `// Hashed assets: immutable means never revalidated for a year
res.set("Cache-Control", "public, max-age=31536000, immutable");

// Cacheable API response with revalidation support
const etag = '"' + crypto.createHash("sha1").update(JSON.stringify(product)).digest("hex") + '"';
res.set({
  "Cache-Control": "public, s-maxage=60, max-age=0, stale-while-revalidate=30",
  ETag: etag,
  Vary: "Accept-Encoding",
});
if (req.get("If-None-Match") === etag) return res.status(304).end(); // zero-body save
res.json({ data: product });

// Never cache: authenticated + personalized
res.set("Cache-Control", "private, no-store");

// The full tiers for one product page:
// Browser: max-age=0 (always revalidate)
// CDN:     s-maxage=60 (absorbs the fleet for a minute)
// Stale:   stale-while-revalidate=30 (expiry spike absorbed)
// Origin:  hit only after all layers miss — or on true revalidation changes`,
    steps: ["Server sets Cache-Control", "Browser stores response", "Reused until expiry", "Revalidated with ETag"],
  },
  {
    id: "cache-browser",
    cat: "cache",
    title: "Browser Caching",
    one: "The browser stores assets locally so repeat visits skip the network.",
    why: "Repeat visitors are most of your traffic, and their fastest request is the one never made. Browser caching turns second loads into disk reads: instant, offline-capable, and completely free of server cost — if your URLs and headers let it work.",
    how: "The browser stores responses per (URL + Vary) with their Cache-Control policy. Fresh responses are used as-is. Stale ones revalidate conditionally (If-None-Match/If-Modified-Since) → 304 keeps the local copy. Content-hashed filenames make 'new version' = 'new URL', so old entries never need invalidating.",
    when: "All static assets: long max-age + immutable + hashed names. HTML: short or no-store (it references the hashed assets and must stay fresh). Service workers go further — offline shells, runtime caching strategies (cache-first for assets, network-first for data).",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "Immutable + hashed names", detail: "max-age=31536000, immutable with app.a1b2.js: deploys ship new URLs, browsers never revalidate old ones. The single most effective frontend performance setting." },
      { name: "Heuristic caching", detail: "No Cache-Control? Browsers guess (roughly 10% of Age since Last-Modified) — unpredicatable and unfixable. Always send explicit headers; never rely on heuristics." },
      { name: "The HTML problem", detail: "index.html can't be hashed (its name is fixed) — keep it max-age=0/must-revalidate or no-cache so it revalidates while its hashed children stay cached forever." },
      { name: "Service workers", detail: "Programmable cache: install-time precache of the shell, runtime strategies per route. Also the only cache you can invalidate from JS — powerful, and famously sticky when buggy." },
    ],
    code: `// Static assets: cache forever, deploy new URLs
app.use("/assets", express.static("public/assets", {
  maxAge: "1y",
  immutable: true, // -> Cache-Control: public, max-age=31536000, immutable
}));

// HTML: always revalidate, tiny payloads make 304s cheap
app.get(["/", "/app"], (req, res) => {
  const html = renderShell();
  const etag = 'W/"' + crypto.createHash("sha1").update(html).digest("base64") + '"';
  res.set({ "Cache-Control": "no-cache", ETag: etag }); // no-cache = store, but revalidate
  if (req.get("if-none-match") === etag) return res.status(304).end();
  res.type("html").send(html);
});

// Service worker: cache-first assets, network-first data
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ??
          fetch(event.request).then((res) => {
            const copy = res.clone();
            caches.open("assets-v1").then((c) => c.put(event.request, copy));
            return res;
          })
      )
    );
  } else if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request)); // always fresh; fallback to cache on offline
  }
});`,
    steps: ["First visit downloads asset", "Stored in browser cache", "Repeat visit checks cache", "Served without network call"],
  },
  {
    id: "cache-edge",
    cat: "cache",
    title: "Edge Caching",
    one: "Caching responses at servers geographically close to the user.",
    why: "The RTT you can't shrink is physics: a Virginia round trip from Manila is ~180ms forever. Edge caching moves the response to Manila — first byte drops from 200ms to 5ms. It's the only performance fix that beats the speed of light.",
    how: "Responses are cached at CDN PoPs (edge locations) keyed by URL + Vary headers + cache rules. Dynamic content participates via short s-maxage, cache keys, and per-region rules; modern platforms run code at the edge (workers/functions) with data access, making 'cache at edge' mean full request handling.",
    when: "Any geographically distributed audience: static assets always; HTML and cacheable API GETs (catalog, search, feeds) increasingly. Skip for strongly personal or write-path responses — those bypass edge caches (private, no-store) by design.",
    ref: "Cloudflare Documentation",
    subtopics: [
      { name: "PoP anatomy", detail: "Each edge location holds its own cache: users hit the nearest. First user per PoP pays the origin fetch; everyone after rides local RAM/SSD." },
      { name: "Cache keys", detail: "What makes a response unique: URL + Vary headers + custom rules (cookie presence, query allowlist). Over-inclusive keys fragment caches; under-inclusive serves wrong content." },
      { name: "Compute at the edge", detail: "Workers/Lambda@Edge run JS at PoPs: auth checks, personalization, A/B — cached data with computed responses. The line between CDN and application is dissolving." },
      { name: "Purge at global scale", detail: "Invalidating propagates to hundreds of PoPs (seconds to minutes). Design for infrequent purges: tags, versions, or hashed URLs instead of emergency flushes." },
    ],
    code: `// Edge-cacheable API: same code, global reach
app.get("/v1/catalog/search", async (req, res) => {
  const q = String(req.query.q ?? "").slice(0, 64);

  // normalize cache key inputs — query noise fragments caches
  res.set({
    "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    Vary: "Accept-Encoding, Accept-Language",
    "Cache-Tag": "catalog,search:" + q.toLowerCase(), // purge handle per term
  });
  res.json({ data: await search(q) });
});

// Edge worker (Cloudflare-flavored): cached origin data + computed personalization
module.exports = {
  async fetch(request, env) {
    const url = new URL(request.url);

    // hot catalog data: edge cache, 30s freshness
    let catalog = await env.CACHES.default.match("catalog:v3");
    if (!catalog) {
      catalog = await fetch("https://origin.example.com/api/catalog");
      await env.CACHES.default.put("catalog:v3", catalog.clone(), { cacheTtl: 30 });
    }

    // personalized header computed AT the edge — 5ms from the user
    const country = request.cf?.country ?? "XX";
    return new Response(await renderPage(await catalog.json(), country), {
      headers: { "Content-Type": "text/html", "Cache-Control": "private, no-store" },
    });
  },
};`,
    steps: ["Origin server", "Response cached at edge", "Nearby user request", "Served from nearest edge"],
  },
  {
    id: "cache-queryresult",
    cat: "cache",
    title: "Query Result Caching",
    one: "Storing the output of an expensive database query for reuse.",
    why: "Some queries cost seconds — dashboards, reports, search facets — and get asked hundreds of times per minute with identical parameters. Caching the RESULT turns a per-request seconds-long DB burn into one query per TTL window.",
    how: "Key = query identity (normalized SQL + parameters, or a semantic key like 'report:sales:2026-09'). Value = the serialized result set with a TTL matched to data volatility. The craft is in key design (parameter normalization, tenant scoping) and choosing TTLs per query volatility.",
    when: "Expensive read-only queries with stable parameters: analytics endpoints, search pages, landing-page aggregates. Don't cache user-specific volatile data without tenant-scoped keys, and never cache unbounded parameter spaces (free-text search keys need normalization or caps).",
    ref: "Redis Documentation",
    subtopics: [
      { name: "Query identity keys", detail: "hash(normalized SQL + params) works mechanically; semantic keys (report:sales:2026-09:tenant:42) are debuggable and invalidatable by group. Prefer semantic." },
      { name: "TTL per volatility", detail: "Yesterday's revenue: 1h. Current-day: 60s. Live counters: don't. Classify queries by how fast their answers rot, not by how expensive they are." },
      { name: "Serialization cost", detail: "Big result sets pay JSON.stringify/parse on every hit (CPU) and bloat memory. Paginate/limit cached results; cache aggregates, not full tables." },
      { name: "Stampede protection required", detail: "Expensive query = worst possible stampede candidate. Coalesce with in-flight promises or locks — query-result caches and stampede protection ship together." },
    ],
    code: `// Semantic-key query cache with coalescing — the full pattern
const inFlight = new Map();

async function cachedQuery(key, sql, params, ttlSeconds) {
  const hit = await redis.get("q:" + key);
  if (hit) return JSON.parse(hit);

  if (inFlight.has(key)) return inFlight.get(key); // stampede protection

  const flight = (async () => {
    const { rows } = await pool.query(sql, params);
    await redis.set("q:" + key, JSON.stringify(rows), { EX: ttlSeconds });
    inFlight.delete(key);
    return rows;
  })();
  inFlight.set(key, flight);
  return flight;
}

// Usage: dashboard aggregation, TTL matched to volatility
app.get("/v1/reports/sales/:month", async (req, res) => {
  const rows = await cachedQuery(
    "sales:" + req.params.month + ":tenant:" + req.tenantId, // semantic, scannable key
    "SELECT date_trunc('day', created_at) d, sum(total_cents) c FROM orders WHERE tenant_id = $1 AND date_trunc('month', created_at) = $2 GROUP BY 1 ORDER BY 1",
    [req.tenantId, req.params.month + "-01"],
    3600 // monthly report data: 1h is generous
  );
  res.json({ data: rows });
});

// Invalidate by group on writes: bump the month's key version
await redis.incr("qver:sales:" + month); // keys become sales:...:v<version>:tenant...`,
    steps: ["Expensive query runs once", "Result cached", "Same query requested again", "Served from cache instantly"],
  },
  {
    id: "cache-eviction",
    cat: "cache",
    title: "Cache Eviction Policies",
    one: "LRU, LFU, and FIFO decide what gets removed when the cache is full.",
    why: "Memory is finite; hot data is not. When the cache fills, SOMETHING must go — the eviction policy decides whether you keep the data that earns its keep or evict exactly what your traffic needed next. Bad policy = cache that performs like no cache.",
    how: "LRU evicts least-recently-used (recency heuristic — the classic default). LFU evicts least-frequently-used (keeps steady hot items, punishes one-off bursts slower). FIFO evicts oldest regardless of use (rarely right). Redis implements approximations (sampled LRU/LFU) for O(1) performance at scale.",
    when: "Pure caches: allkeys-lru (default). Mixed cache + durable keys in one Redis: volatile-* policies so only TTL'd keys evict. Scans that poison LRU (batch jobs touching every key): LFU or cache seeding. Memcached: LRU per slab class, no choice needed.",
    ref: "Redis Documentation",
    subtopics: [
      { name: "LRU (recency)", detail: "Evict what wasn't touched longest. Great when the past predicts the future; poisoned by one-shot scans that flush the working set. Redis approximates with sampling — O(1) instead of a real linked list." },
      { name: "LFU (frequency)", detail: "Evict the least-accessed. Keeps steady hots alive through scan storms; slow to admit new hot keys. Redis LFU decays counts over time to stay adaptive." },
      { name: "TTL-first eviction", detail: "volatile-ttl evicts the soonest-to-expire keys — couples eviction with your freshness model. Sensible when TTLs encode importance." },
      { name: "Sizing to the working set", detail: "Policy can't fix under-provisioning: if the hot set is 8GB in 4GB of memory, hit ratio dies at any policy. Measure the working set; size memory to it; then tune policy." },
    ],
    code: `// A correct LRU in plain JS: Map preserves insertion order
class LRUCache {
  constructor(maxEntries) {
    this.max = maxEntries;
    this.map = new Map();
  }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value); // re-insert = most recently used
    return value;
  }
  set(key, value) {
    this.map.delete(key); // refresh position if present
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value; // LRU victim
      this.map.delete(oldest);
      this.evictions = (this.evictions ?? 0) + 1;
    }
  }
}

// Redis server-side: choose policy + ceiling in config
// maxmemory 2gb
// maxmemory-policy allkeys-lru      (pure cache)
// maxmemory-policy volatile-lru     (mixed cache + durable keys)

// Watch eviction health: evictions climbing = memory too small
const info = await redis.info("stats");
console.log({
  evicted: info.match(/evicted_keys:(\\d+)/)?.[1],
  hits: info.match(/keyspace_hits:(\\d+)/)?.[1],
  misses: info.match(/keyspace_misses:(\\d+)/)?.[1],
});`,
    steps: ["Cache reaches capacity", "Policy selects victim", "LRU: least recently used evicted", "New item stored"],
  },
  {
    id: "cache-distributed",
    cat: "cache",
    title: "Distributed Caching",
    one: "A cache shared across multiple app instances instead of local to one.",
    why: "With 8 app instances and per-process caches, the same key is cached 8 times with 8 different staleness states — hit ratios divide by 8 and invalidation must reach every box. A shared cache (Redis cluster) centralizes: one copy, one invalidation, one hit ratio.",
    how: "A dedicated cache tier (Redis/Memcached cluster) holds all entries; every instance reads/writes over the network. Sharding spreads keys across nodes by hash slots; replication adds read replicas and failover. Invalidation events broadcast to all consumers instead of all machines.",
    when: "Default once you run more than one instance — which is any production deployment. Trade-offs vs in-process: ~0.5ms network per op (pipeline to amortize) and a new dependency that can fail (degrade to DB on cache-down; never hard-fail requests because Redis sneezed).",
    ref: "Redis Documentation",
    subtopics: [
      { name: "Consistent hashing / slots", detail: "Redis Cluster spreads keys across 16384 slots sharded over nodes. Multi-key ops need keys in the same slot: hash tags {user:42}:profile and {user:42}:cart co-locate deliberately." },
      { name: "Graceful degradation", detail: "Cache-down must mean slower, not broken: catch connection errors, serve from DB, keep a tiny in-process fallback cache. Circuit-break the cache itself." },
      { name: "Invalidation fan-out", detail: "Pub/sub invalidation: writer publishes 'invalidate user:42', every instance drops its L1 copy. The L1+L2 two-tier needs this; pure L2 doesn't." },
      { name: "Hot key problem", detail: "One celebrity key can saturate a shard. Mitigate: local L1 in front, key replication (key:1..N copies with random suffix picks), or client-side caching (Redis 6)."},
    ],
    code: `// Two-tier: tiny L1 in-process + shared Redis L2, with invalidation
const Cluster = require("ioredis").Cluster;
const redis = new Cluster([{ host: "redis-0", port: 6379 }, { host: "redis-1", port: 6379 }]);

async function get(key, loader, ttl) {
  // L1: microseconds, per-process
  const local = l1.get(key);
  if (local !== undefined) return local;

  // L2: shared, ~ms
  const hit = await redis.get(key).catch(() => null); // cache-down != request-down
  if (hit) {
    const value = JSON.parse(hit);
    l1.set(key, value);
    return value;
  }

  const value = await loader();
  await redis.set(key, JSON.stringify(value), { EX: ttl }).catch(() => null); // degrade silently
  l1.set(key, value);
  return value;
}

// Writer: L2 write-through + L1 invalidation broadcast
async function write(key, value, ttl) {
  await redis.set(key, JSON.stringify(value), { EX: ttl });
  await redis.publish("cache:invalidate", key); // every instance drops its L1 copy
}
sub.subscribe("cache:invalidate");
sub.on("message", (_ch, key) => l1.map.delete(key));`,
    steps: ["App instance A writes", "Shared cache cluster", "App instance B reads", "Both see same data"],
  },
  {
    id: "cache-negative",
    cat: "cache",
    title: "Negative Caching",
    one: "Caching the fact that something doesn't exist, to avoid repeated failed lookups.",
    why: "Nonexistent data is the worst cache miss: every lookup for user/999999 walks the full DB path to return nothing — and attackers/crawlers love nonexistent IDs. Caching the NEGATIVE result makes absence as cheap as presence.",
    how: "On a not-found, write a sentinel value (null marker, {'notFound': true}, or a tiny body) with a SHORT TTL (30s–5min). Reads hitting the sentinel return 404 without touching the DB. Sentinels expire quickly so newly-created entities appear without explicit invalidation.",
    when: "Any endpoint addressing by user-supplied ID: user profiles, order lookups, DNS lookups (NXDOMAIN), auth token checks. Also for expensive computations that can legitimately return empty (search with no hits). The short TTL is the whole trick — long negative caches break new-record UX.",
    ref: "Cloudflare Documentation",
    subtopics: [
      { name: "The sentinel value", detail: "Can't cache JSON 'null' distinctly from missing key — use a marker: 'null' string, {'__notFound': true}, or an empty-string convention agreed upon by both writers and readers." },
      { name: "Short TTL on purpose", detail: "Negative entries must self-heal fast: entity gets created → next read after TTL finds it. 30–120s bounds the 'I created it but it 404s' window without invalidation machinery." },
      { name: "ID enumeration defense", detail: "Attackers probing sequential IDs hit cached 404s at microsecond speed instead of your DB — negative caching is also a cheap anti-scraping layer for nonexistent resources." },
      { name: "Delete invalidates negatives too", detail: "When an entity IS created/deleted, delete both its positive and negative keys — or rely on the short TTL and accept the window. Decide per endpoint; write it down." },
    ],
    code: `const NOT_FOUND = JSON.stringify({ __notFound: true });
const NEG_TTL = 60;  // short: created entities appear within a minute
const POS_TTL = 600;

async function getOrder(orderId) {
  const key = "order:" + orderId;

  const hit = await redis.get(key);
  if (hit) {
    const value = JSON.parse(hit);
    if (value.__notFound) return null;   // cached absence: DB untouched
    return value;
  }

  const { rows } = await pool.query("SELECT * FROM orders WHERE id = $1", [orderId]);
  if (!rows[0]) {
    await redis.set(key, NOT_FOUND, { EX: NEG_TTL }); // cache the absence
    return null;
  }

  await redis.set(key, JSON.stringify(rows[0]), { EX: POS_TTL });
  return rows[0];
}

// Creation invalidates the negative entry immediately (optional but nicer):
async function createOrder(order) {
  await db.orders.insert(order);
  await redis.del("order:" + order.id); // clears both negative cache AND stale positives
  return order;
}

// HTTP layer too: 404s are cacheable by browsers/CDNs with Cache-Control
res.set("Cache-Control", "public, max-age=30"); // on the 404 response`,
    steps: ["Lookup fails (not found)", "Absence cached briefly", "Repeat lookup", "Served 'not found' without re-checking"],
  },
  {
    id: "cache-warming",
    cat: "cache",
    title: "Cache Warming",
    one: "Pre-loading the cache with expected data before real traffic arrives.",
    why: "A cold cache makes every deploy a mini-outage: first N users per key eat full DB cost, latencies spike, and stampedes lurk. Warming loads the predictable hot set before traffic flows — the cache starts useful instead of starting empty.",
    how: "After deploy/restart/eviction, a warming job fetches the known-hot keys through the normal cache-fill path (getOrLoad) so entries land with proper TTLs. Sources for the hot list: yesterday's top keys, hardcoded criticals, per-tenant homepage data, or metrics-exported hit rankings.",
    when: "Scheduled jobs, deploy-time warmups, and post-incident refills. Highest value for expensive recomputes (dashboards, search indexes, homepage aggregates). Skip for long-tail caches where the 'hot set' is basically all traffic — warming can't help what can't be enumerated.",
    ref: "AWS Documentation",
    subtopics: [
      { name: "Top-K warming", detail: "Track which keys actually get hit (metrics or Redis keyspace notifications); persist the daily top-K; warm exactly those after restarts. Data-driven, self-updating." },
      { name: "Warming via the normal path", detail: "Warm by CALLING getOrLoad, not by writing arbitrary values: fills carry correct TTLs, coalescing, and serialization — warming that bypasses the fill path creates subtle divergence." },
      { name: "Rate-limited warming", detail: "A warming job can stampede the DB itself: warm with concurrency caps and jitter, spread over minutes. Warm the top 100 first, not everything at once." },
      { name: "Tenant-aware warming", detail: "Multi-tenant: warm per-region top tenants' landing data after each regional deploy. One global warm list misses every regional hot key." },
    ],
    code: `// The hot list: tracked from real traffic
setInterval(async () => {
  const top = await pool.query(
    "SELECT key FROM cache_hits_daily WHERE day = current_date ORDER BY hits DESC LIMIT 200"
  );
  await redis.set("warming:topk", JSON.stringify(top.rows.map((r) => r.key)));
}, 3600 * 1000);

// After deploy/restart: refill through the normal load path
const LOADERS = {
  "dashboard:global": () => computeDashboard(),
  "home:featured": () => db.products.featured(),
  "config:flags": () => flagService.all(),
};

async function warmCache() {
  const keys = JSON.parse((await redis.get("warming:topk")) ?? "[]");
  const criticals = ["dashboard:global", "home:featured", "config:flags"];
  const all = [...new Set([...criticals, ...keys])];

  // capped concurrency + jitter: warming must not BE a stampede
  const queue = [...all];
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      for (;;) {
        const key = queue.shift();
        if (!key) return;
        const loader = LOADERS[key] ?? defaultLoaderFor(key);
        await getWithCoalescing(key, loader, ttlFor(key)).catch(() => null);
        await new Promise((r) => setTimeout(r, Math.random() * 200)); // spread the load
      }
    })
  );
  console.log("cache warmed:", all.length, "keys");
}

process.on("SIGTERM", () => {}); // deploy drains, then new instance runs warmCache() before serving`,
    steps: ["Deploy or restart", "Cache empty", "Warming job pre-fills it", "Traffic hits warm cache"],
  },
  {
    id: "cache-object",
    cat: "cache",
    title: "Object Caching",
    one: "Caching entire serialized objects rather than individual fields.",
    why: "A product page needs the whole product — name, price, variants, images. Field-level caching would mean N round trips and N invalidations to reassemble one object. Object caching stores the assembled aggregate once: one key, one get, one invalidation.",
    how: "Build the object once (from one or many DB reads), serialize (JSON/MessagePack), store under a semantic key (product:42:v7) with a TTL. Reads deserialize the whole thing. Invalidation is object-granular: bump version or delete the key when ANY constituent changes.",
    when: "Read-mostly aggregates rendered whole: products, user profiles, CMS pages, config documents. Don't use for objects needing partial updates at high write rates (every field change rewrites the whole blob) or oversized objects (a 5MB JSON per key thrashes memory and network).",
    ref: "Redis Documentation",
    subtopics: [
      { name: "Aggregate keys", detail: "Key the object by its identity, not its query: product:42 serves the page, the API, and the widget alike. Query-shaped keys fragment the same object across many entries." },
      { name: "Versioned invalidation", detail: "product:42:v7 — writers bump v8 and the old blob orphans until TTL. In-flight requests keep a consistent snapshot; no partial-object races." },
      { name: "Serialization choice", detail: "JSON: debuggable, universal. MessagePack: ~30% smaller, faster. Store format version inside the blob so deploys can't read stale shapes blind." },
      { name: "Size discipline", detail: "Cache objects the size your network path likes: <100KB typical. Giant objects need chunking or field-level design — a 5MB blob per get is a self-inflicted DoS." },
    ],
    code: `// Build once, cache whole
async function getProduct(productId) {
  const version = (await redis.get("ver:product:" + productId)) ?? "1";
  const key = "product:" + productId + ":v" + version;

  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit); // whole object, one round trip

  // assemble from multiple sources — the expensive part happens once per version
  const [product, variants, images] = await Promise.all([
    db.products.find(productId),
    db.variants.byProduct(productId),
    db.images.byProduct(productId),
  ]);
  const aggregate = { format: 1, ...product, variants, images, assembledAt: Date.now() };

  await redis.set(key, JSON.stringify(aggregate), { EX: 3600 });
  return aggregate;
}

// Any constituent changes -> bump version, whole object rebuilds next read
async function updateVariantPrice(productId, variantId, priceCents) {
  await db.variants.updatePrice(variantId, priceCents);
  await redis.incr("ver:product:" + productId); // orphan v7, next read builds v8
}

// Bad alternative this replaces: 3 keys, 3 gets, 3 invalidations, partial-state races
// product:42:meta | product:42:variants | product:42:images  <- reassembled how, consistently?`,
    steps: ["Object assembled", "Serialized", "Stored as one cache entry", "Retrieved and deserialized whole"],
  },
  {
    id: "cache-fingerprint",
    cat: "cache",
    title: "Content Fingerprinting",
    one: "Naming cached assets by content hash so URLs change only when content changes.",
    why: "The hardest part of caching isn't storing — it's invalidating without breaking anything. Content-hashed URLs dissolve the problem: new content = new URL = browsers/CDNs fetch fresh; unchanged content = same URL = cached forever. No purges, no stale JS, no cache-bust hacks.",
    how: "The build pipeline hashes file contents (app.a1b2c3.js) and emits a manifest mapping logical names to hashed ones. Templates reference via the manifest. Immutable caching (max-age=1y) goes on hashed assets; the HTML that references them stays uncached or briefly cached.",
    when: "All static assets in any deploy pipeline: JS/CSS bundles, images, fonts. The pattern extends to API responses (fingerprint in ETag) and even cache keys for computed objects. The one requirement: the build must rewrite references — manual hashed filenames rot instantly.",
    ref: "Webpack Documentation",
    subtopics: [
      { name: "The manifest", detail: "Build emits {\"app.js\": \"app.a1b2c3.js\"}; server templates look up through it. Rename-safe: templates never hardcode hashes; the build owns the mapping." },
      { name: "immutable flag", detail: "max-age=31536000, immutable tells browsers 'never even revalidate' — skips the conditional request entirely for the cache lifetime. Only safe BECAUSE URLs change with content." },
      { name: "HTML is the weak link", detail: "index.html must stay fresh (no-cache/max-age=0) since it holds the latest hashes. Deploy order matters: assets first, HTML last, old assets kept one deploy for in-flight pages." },
      { name: "Beyond the build", detail: "ETags ARE response fingerprinting (same idea server-side). API responses can embed content hashes in Cache-Tag/version params for object-cache invalidation by content." },
    ],
    code: `// Build step: hash contents, emit manifest
const crypto = require("crypto");
const fs = require("fs");

const manifest = {};
for (const file of fs.readdirSync("dist/assets")) {
  const content = fs.readFileSync("dist/assets/" + file);
  const hash = crypto.createHash("md5").update(content).digest("hex").slice(0, 8);
  const hashed = file.replace(/(\\.[^.]+)$/, "." + hash + "$1");
  fs.copyFileSync("dist/assets/" + file, "dist/assets/" + hashed);
  manifest[file] = "/assets/" + hashed; // app.js -> /assets/app.a1b2c3d4.js
}
fs.writeFileSync("dist/manifest.json", JSON.stringify(manifest));

// Server: templates resolve through the manifest
function asset(logicalName) {
  const hashed = MANIFEST[logicalName];
  if (!hashed) throw new Error("asset not built: " + logicalName);
  return hashed;
}

res.send(\`<!doctype html>
  <link rel="stylesheet" href="\${asset("app.css")}">
  <script src="\${asset("app.js")}" defer></script>\`);

// Headers: hashed assets live forever, HTML revalidates
app.use("/assets", express.static("dist/assets", { maxAge: "1y", immutable: true }));
app.get("/", (req, res) => res.set("Cache-Control", "no-cache").send(renderShell()));`,
    steps: ["File content hashed", "Hash embedded in filename", "Unchanged content → same URL", "Changed content → new URL, cache busts"],
  },
  {
    id: "cache-clientside",
    cat: "cache",
    title: "Client-Side Caching (SWR/React Query)",
    one: "The frontend caches fetched data and revalidates it in the background.",
    why: "Every navigation re-fetching identical data makes the app feel slow and the API hot. Client-side cache libraries keep fetched data in memory/localStorage: revisits render INSTANTLY from cache, then silently revalidate — perceived speed without stale data at rest.",
    how: "The library keys cached responses (usually by URL), serves stale data immediately on cache hit, and revalidates in the background (SWR = stale-while-revalidate). On revalidation it diff/updates the UI. Deduping collapses concurrent identical requests into one; mutations can invalidate or optimistically update specific keys.",
    when: "Any data-driven frontend. Critical for back-forward navigation, lists revisited, and polling/realtime dashboards (refetchInterval replaces hand-rolled polling). Be deliberate with what's cached: per-user data stays client-side only; cache time matches data volatility.",
    ref: "TanStack Query Documentation",
    subtopics: [
      { name: "Stale-while-revalidate", detail: "Serve cached instantly, fetch fresh, patch the UI when it arrives. Users see data at 0ms; correctness arrives ~100ms later. The UX gold standard for reads." },
      { name: "Request deduplication", detail: "10 components calling the same endpoint mount → 1 network request. The cache key (URL + params) is the dedupe unit — design URLs accordingly." },
      { name: "Mutations & invalidation", detail: "After a write, invalidate affected keys (or optimistically patch + rollback on error). Without this step the cache serves pre-mutation data until its next revalidation." },
      { name: "Cache time budget", detail: "staleTime (how long data is considered fresh: no refetch) vs gcTime (how long unused cache lives). Match staleTime to volatility: config 5 min, feed 15 s, wallet 0." },
    ],
    code: `// React Query shape: the whole pattern in one hook
const { data: orders, isFetching } = useQuery({
  queryKey: ["orders", userId, { page }],
  queryFn: () => fetch("/v1/orders?userId=" + userId + "&page=" + page).then((r) => r.json()),
  staleTime: 30_000,  // fresh for 30s: revisit = instant, no refetch
  gcTime: 5 * 60_000, // unused entries live 5 min
  placeholderData: (prev) => prev, // pagination feels instant
});

// Revisit the page: cached data renders at 0ms; a background refetch
// patches any changes. Back/forward navigation is free.

// Mutation + invalidation: the half everyone forgets
const queryClient = useQueryClient();
const createOrder = useMutation({
  mutationFn: (cart) => fetch("/v1/orders", { method: "POST", body: JSON.stringify(cart) }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["orders", userId] }); // refetch affected lists
    queryClient.invalidateQueries({ queryKey: ["account", userId] }); // and the balance
  },
});

// Optimistic update: UI moves instantly, rolls back on failure
await queryClient.cancelQueries({ queryKey: ["orders", userId] });
const previous = queryClient.getQueryData(["orders", userId]);
queryClient.setQueryData(["orders", userId], (old) => ({ ...old, items: [newOrder, ...old.items] }));
createOrder.mutate(cart, { onError: () => queryClient.setQueryData(["orders", userId], previous) });`,
    steps: ["Fetch data", "Cache in memory", "Show cached instantly", "Revalidate in background"],
  },
  {
    id: "cache-session",
    cat: "cache",
    title: "Session Caching",
    one: "Storing session data in a fast shared store instead of per-server memory.",
    why: "Sessions in process memory break the moment you run 2+ instances: login lands on A, the next request hits B — logged out. A shared cache (Redis) makes sessions instance-agnostic: any server serves any user, deploys don't log everyone out, and revocation is instant cluster-wide.",
    how: "Session records live in Redis keyed by opaque session ID with TTL = expiry (expiry for free). The auth middleware reads the cookie, GETs the record (~0.5ms), and resolves identity. Writes (login, rotation, logout) SET/DEL the key — cluster-wide effects immediately.",
    when: "Every multi-instance deployment — which is all of them. Redis TTL also solves cleanup (no session-sweeper cron). For extreme scale, session reads can use local L1 with pub/sub invalidation, but plain Redis reads at 0.5ms are rarely the bottleneck worth that complexity.",
    ref: "Redis Documentation",
    subtopics: [
      { name: "TTL as expiry", detail: "SET EX at login, refreshed (EXPIRE) on activity: idle expiry and cleanup are one mechanism. Absolute caps need a second field checked in code." },
      { name: "Instance-agnostic auth", detail: "The whole point: session lookup is a network call to shared state, not process memory. Autoscaling, deploys, and restarts no longer interact with login state." },
      { name: "Revocation is a DEL", detail: "Password change or ban: delete the user's session keys (track an index user:sessions:<uid> set) — every device logs out within one request. JWTs can't do this without denylists." },
      { name: "Sizing & resilience", detail: "Sessions are hot (every request reads) and loss-tolerable (users re-login). allkeys-lru is safe here; still, cache-down should fail OPEN to 're-login' not 500s everywhere." },
    ],
    code: `// Login: session into Redis, TTL handles expiry
app.post("/login", express.json(), async (req, res) => {
  const user = await verifyCredentials(req.body);
  if (!user) return res.status(401).json({ error: { code: "invalid_credentials" } });

  const sid = crypto.randomBytes(32).toString("hex");
  const session = { userId: user.id, createdAt: Date.now(), absoluteExpiry: Date.now() + 864e5 };

  await redis.set("sess:" + sid, JSON.stringify(session), { EX: 1800 }); // 30 min idle
  await redis.sAdd("user:sessions:" + user.id, sid);                     // revocation index
  res.cookie("sid", sid, { httpOnly: true, secure: true, sameSite: "lax" });
  res.sendStatus(204);
});

// Every request: one GET resolves identity — from any instance
async function requireSession(req, res, next) {
  const sid = req.cookies.sid;
  const raw = sid && (await redis.get("sess:" + sid));
  if (!raw) return res.status(401).json({ error: { code: "session_expired" } });

  const session = JSON.parse(raw);
  if (Date.now() > session.absoluteExpiry) {
    await revoke(sid);
    return res.status(401).json({ error: { code: "session_expired" } });
  }
  await redis.expire("sess:" + sid, 1800); // sliding idle window
  req.userId = session.userId;
  next();
}

// Password change: EVERYWHERE logs out, instantly
async function revokeAllFor(userId) {
  const sids = await redis.sMembers("user:sessions:" + userId);
  if (sids.length) await redis.del(...sids.map((s) => "sess:" + s), "user:sessions:" + userId);
}`,
    steps: ["User logs in", "Session written to shared cache", "Any server instance reads it", "No sticky session required"],
  },
  {
    id: "cache-readthrough",
    cat: "cache",
    title: "Read-Through Cache",
    one: "The cache itself fetches from the database on a miss, transparently to the app.",
    why: "Cache-aside puts fill logic in every caller — and every caller drifts differently. Read-through centralizes the miss path inside a cache layer: the app just asks for the key and the cache guarantees a fresh-or-cached answer. Business code never touches the DB on reads.",
    how: "The cache layer (a library wrapping Redis, a proxy, or your data-access module) owns the loader: on miss it calls the registered load function, stores the result with TTL, and returns it. Callers see one API: get(key). Coalescing and stampede protection live inside the layer, once.",
    when: "When read patterns are stable enough to register as loaders, and multiple services/teams share access patterns — the consistency win compounds. Cache-aside remains right when fills are genuinely bespoke per call site, or the 'cache' is a thin wrapper you don't want to build.",
    ref: "AWS Documentation",
    subtopics: [
      { name: "The loader registry", detail: "key-prefix -> load function: 'user:' loads users, 'product:' loads products. One module owns all read paths; per-caller drift becomes impossible." },
      { name: "Stampede protection built in", detail: "Coalescing/locks implemented once in the layer benefit every key automatically. Callers can't forget it because they can't bypass the layer." },
      { name: "Transparent TTL policy", detail: "TTLs by key class also centralize: the layer decides user: keys live 5 min, config: keys 1 h. Policy changes are one-file deploys, not hunts through every call site." },
      { name: "Write-side still explicit", detail: "Read-through covers reads only — writes still invalidate/update keys. The full pattern pair: read-through fills + write-through/delete invalidation." },
    ],
    code: `// The cache layer: one place owns misses, TTLs, and coalescing
class ReadThroughCache {
  #loaders = new Map();
  #inFlight = new Map();

  register(prefix, { load, ttlSeconds }) {
    this.#loaders.set(prefix, { load, ttlSeconds });
  }

  async get(key) {
    const hit = await redis.get(key).catch(() => null);
    if (hit) return JSON.parse(hit);

    const loader = [...this.#loaders.entries()].find(([p]) => key.startsWith(p))?.[1];
    if (!loader) throw new Error("no loader registered for " + key);

    // coalesce: one load per key across concurrent callers
    if (this.#inFlight.has(key)) return this.#inFlight.get(key);
    const flight = (async () => {
      try {
        const value = await loader.load(key);
        if (value != null) await redis.set(key, JSON.stringify(value), { EX: loader.ttlSeconds });
        return value;
      } finally {
        this.#inFlight.delete(key);
      }
    })();
    this.#inFlight.set(key, flight);
    return flight;
  }
}

// Registration: policy lives here, once
const cache = new ReadThroughCache();
cache.register("user:", { load: (k) => db.users.find(k.split(":")[1]), ttlSeconds: 300 });
cache.register("config:", { load: () => db.config.current(), ttlSeconds: 3600 });

// Application code: no DB on reads, anywhere, ever
const user = await cache.get("user:" + userId);`,
    steps: ["App requests from cache", "Cache misses", "Cache fetches from DB itself", "Returns to app, stores for next time"],
  },
  {
    id: "cache-multilayer",
    cat: "cache",
    title: "Multi-Layer Caching",
    one: "Combining browser, CDN, and server caches for compounding speed gains.",
    why: "No single cache beats the stack: a browser hit costs 0ms and zero server load; an edge hit costs 5ms; Redis 1ms plus datacenter RTT; the DB 20ms+. Layering them means most requests die at the cheapest possible layer — the origin serves only what all layers missed.",
    how: "The same response flows through layers in order: browser → CDN edge → app cache (Redis/L1) → DB. Each layer has its own TTL/policy tuned to its strengths (long at the edge for static, short at origin for volatile). Requests stop at the first layer holding fresh-enough data; writes must consider every layer below them.",
    when: "Any content with geographic audience and hot paths. The design work is per-layer freshness budgets and an invalidation story spanning layers (CDN purge + Redis DEL + client revalidation) — layered caching without a coherent invalidation plan is how stale content ships to millions.",
    ref: "Cloudflare Documentation",
    subtopics: [
      { name: "Layer ordering", detail: "Cheapest and furthest first: browser (0ms) → CDN (5ms) → L1 process (0.01ms but app-side) → Redis (1ms) → DB. Each hit saves everything after it." },
      { name: "Per-layer budgets", detail: "Edge: long TTLs, content-hashed (immutable). Origin Redis: seconds-minutes with invalidation hooks. Browser: max-age matched to volatility. One budget table rules all layers." },
      { name: "Cross-layer invalidation", detail: "A write must reach every layer: DB → Redis DEL → CDN purge-by-tag → clients revalidate via ETag. Miss one layer and it serves the old world until its TTL dies." },
      { name: "Hit-ratio attribution", detail: "Measure each layer's hits separately (CDN analytics, Redis stats, app metrics). The layer with low ratio AND high origin traffic is where the next tuning hour goes." },
    ],
    code: `// One product page, four layers, each doing its job
// L0 BROWSER: hashed assets immutable, HTML revalidates
//   Cache-Control: public, max-age=31536000, immutable   (assets)
//   Cache-Control: no-cache + ETag                        (HTML)
// L1 CDN: 60s at the edge, purge by tag on product change
//   Cache-Control: public, s-maxage=60, stale-while-revalidate=30
//   Cache-Tag: product:42
// L2 APP: Redis object cache + in-flight coalescing
async function getProductPage(id) {
  const key = "product:page:" + id;
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit);
  if (inFlight.has(key)) return inFlight.get(key);

  const flight = (async () => {
    const page = await assemblePageFromDb(id);          // L3 DB: the last resort
    await redis.set(key, JSON.stringify(page), { EX: 120 });
    inFlight.delete(key);
    return page;
  })();
  inFlight.set(key, flight);
  return flight;
}
// L3 DATABASE: sees ~ (1 - edgeHitRatio) * (1 - redisHitRatio) of traffic

// THE WRITE: invalidation cascades through every layer
async function updateProduct(id, changes) {
  await db.products.update(id, changes);
  await redis.del("product:page:" + id, "product:" + id); // L2
  await cdn.purgeByTag("product:" + id);                   // L1 edges worldwide
  // L0 self-heals via ETag revalidation on next visit
}`,
    steps: ["Browser cache", "CDN edge cache", "Server-side cache", "Database as last resort"],
  },
  {
    id: "cache-coherence",
    cat: "cache",
    title: "Cache Coherence",
    one: "Keeping multiple caches in sync so none of them serves outdated data.",
    why: "One cache has staleness budgets; MANY caches have coherence bugs — three services each caching user:42 can serve three different truths after one write. Coherence is the discipline that turns a fleet of caches into one logical cache.",
    how: "When source data changes, every cache holding it must learn: push invalidation (writer publishes events; each cache drops keys — pub/sub or CDC), or pull reconciliation (TTLs bounded short enough that divergence self-heals). Push for promptness, TTLs as the correctness floor.",
    when: "Whenever 2+ caches can hold the same entity: service-level caches plus a shared Redis plus CDN. Design the invalidation bus BEFORE the second cache appears — retrofitting coherence means an archaeology of who-caches-what.",
    ref: "Redis Documentation",
    subtopics: [
      { name: "Invalidate what you read", detail: "The owning service publishes 'user:42 changed'; subscribers delete THEIR copies of derived keys. Rule: whoever caches an entity subscribes to its invalidation topic." },
      { name: "TTL floor for missed events", detail: "Pub/sub is at-most-once: a subscriber down during the event never learns. Every pushed invalidation pairs with a TTL floor — divergence expires instead of persisting." },
      { name: "Version numbers", detail: "A monotonic version per entity (DB column or Redis counter) turns coherence into comparison: caches store version+value, and a cheap version check detects staleness without full refetch." },
      { name: "Read-your-writes routing", detail: "After a write, route THAT user's reads to the authoritative store (or their own L1) for a few seconds — hides cross-cache divergence from the user who caused it." },
    ],
    code: `// The invalidation bus: write once, every cache converges
// Writer side (user service):
async function updateUser(userId, changes) {
  const version = await db.users.updateAndBump(userId, changes);
  await redis.publish("invalidate", JSON.stringify({ entity: "user", id: userId, version }));
}

// Subscriber side (every service that caches users):
await sub.subscribe("invalidate");
sub.on("message", async (_ch, raw) => {
  const { entity, id, version } = JSON.parse(raw);
  if (entity !== "user") return;

  await redis.del("user:" + id);          // shared L2 copy
  l1.delete("user:" + id);                // process-local L1 copy
  await cdn.purgeByTag("user:" + id).catch(() => null); // edge copies, best-effort
  metrics.increment("coherence.invalidated", { entity });
});

// The TTL floor: pub/sub misses (subscriber down, network partition) self-heal here
// user: keys carry EX 300 — worst-case divergence is 5 minutes, never forever.

// Version-check reads: detect staleness cheaply without full refetch
async function getUserIfCurrent(userId, knownVersion) {
  const current = Number((await redis.get("ver:user:" + userId)) ?? 0);
  if (current === knownVersion) return CACHED; // still valid
  return refetch(userId); // stale -> rebuild from source
}`,
    steps: ["Data updated at source", "Invalidation broadcast", "All caches notified", "All caches consistent again"],
  },
  {
    id: "cache-ratecounters",
    cat: "cache",
    title: "Rate Limit Counters in Cache",
    one: "Using a fast in-memory store to track request counts per client.",
    why: "Rate limiting needs a counter check on EVERY request — a DB round trip per request just to say 'allowed' doubles your latency and triples DB load. An in-memory store makes the limit check O(1) at microsecond cost, shared across all app instances.",
    how: "Per-client counters keyed by window (rl:{client}:{minute}) with INCR + EXPIRE; the read-modify-write is atomic server-side. Fixed windows are trivial but bursty at boundaries; sliding windows (two adjacent fixed windows, weighted) and token buckets (INCR-by-cost with refill) refine accuracy — all still one round trip.",
    when: "Every rate limiter beyond a single process. Also: login-attempt counters, idempotency dedupe sets, and 'recently seen' bloom-style checks. The cluster gotcha: instances check the SAME Redis — that's the feature (cluster-wide limits) and the latency floor (~0.5ms per check).",
    ref: "Redis Documentation",
    subtopics: [
      { name: "Fixed window counters", detail: "INCR rl:{key}:{YYYYMMDDHHmm} + EXPIRE 60s: one round trip, exact within the window. Boundary burst: 2x limit across a window edge — usually acceptable." },
      { name: "Sliding window", detail: "Weighted blend of the current and previous window: count = prev * (elapsed/60) + current. Smooths boundaries; still 2-3 Redis ops. ZADD-based sliding logs are exact but heavier." },
      { name: "Lua for atomicity", detail: "Multi-op algorithms (token bucket refill + consume) need read-modify-write atomicity: a small Lua script executes as one atomic unit, one round trip, no races between instances." },
      { name: "Fail-open vs fail-closed", detail: "Redis down: allow everything (fail-open, availability first) or deny everything (fail-closed, protection first)? Rate limiting usually fails OPEN with an alarm — login throttling fails CLOSED." },
    ],
    code: `// Sliding window rate limiter: atomic Lua, one round trip
const SLIDING_LUA = \`
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local limit = tonumber(ARGV[3])
  local prev_key = KEYS[2]

  local current = tonumber(redis.call("GET", key) or "0")
  local prev = tonumber(redis.call("GET", prev_key) or "0")
  local elapsed = now % window
  local weighted = prev * ((window - elapsed) / window) + current

  if weighted + 1 > limit then
    return { 0, math.ceil(limit - weighted) }
  end

  redis.call("INCR", key)
  redis.call("EXPIRE", key, window * 2)
  redis.call("EXPIRE", prev_key, window * 2)
  return { 1, limit - math.ceil(weighted + 1) }
\`;

async function checkRate(clientId, limit = 100, windowSec = 60) {
  const now = Math.floor(Date.now() / 1000);
  const minute = Math.floor(now / windowSec);
  const [allowed, remaining] = await redis.eval(
    SLIDING_LUA, 2,
    "rl:" + clientId + ":" + minute,           // current window
    "rl:" + clientId + ":" + (minute - 1),     // previous window
    now, windowSec, limit
  );
  return { allowed: allowed === 1, remaining };
}

// Middleware: every request, microsecond check, cluster-wide truth
app.use(async (req, res, next) => {
  const { allowed, remaining } = await checkRate(req.user?.id ?? req.ip);
  res.set("X-RateLimit-Remaining", String(remaining));
  if (!allowed) return res.status(429).json({ error: { code: "rate_limited" } });
  next();
});`,
    steps: ["Request arrives", "Counter incremented in cache", "Checked against limit", "Allowed or rejected"],
  },
  {
    id: "cache-keydesign",
    cat: "cache",
    title: "Cache Key Design",
    one: "Structuring cache keys so related data can be found and invalidated together.",
    why: "Cache keys are an API you can't refactor later: every reader, writer, and invalidation code path hardcodes the format. Bad key design makes invalidation impossible (which keys hold this user's data?) — and impossible invalidation is how stale data ships.",
    how: "Namespaced, hierarchical, deterministic: entity:id:facet:version (user:42:profile:v3). Colons for hierarchy (Redis convention), sorted/normalized parameters for composite keys (search:q=shoes:sort=price:page=1 — same inputs, same order, same key). Group keys by prefix so SCAN/del-by-pattern and pub/sub invalidation work per group.",
    when: "Design keys when you design the cache — and document the schema. Review when a new invalidation need appears ('purge everything about tenant 7'): if keys can't answer it, the schema is wrong, not the tooling.",
    ref: "Redis Documentation",
    subtopics: [
      { name: "Namespace hierarchy", detail: "entity:id:facet:version reads left-to-right from broad to specific. Consistent naming lets tooling (monitoring, bulk invalidation) operate on prefixes instead of guessing formats." },
      { name: "Deterministic serialization", detail: "Composite keys from parameters MUST normalize: sort query params, trim/lowercase where the API is case-insensitive, exclude tracking noise (utm_*). Same request must always produce the same key." },
      { name: "Version slots", detail: "Embed a version segment (v3) you can bump to invalidate a whole class of keys at once — the cheap alternative to SCAN-and-delete over millions of keys." },
      { name: "Tenant scoping in keys", detail: "Multi-tenant: tenant id INSIDE the key (t:7:user:42), never implied. A missing tenant prefix is a cross-tenant data leak — the scariest cache bug class there is." },
    ],
    code: `// A documented key schema — the whole team's contract
const KEYS = {
  user:    (tenantId, userId, v = 1) => \`t:\${tenantId}:user:\${userId}:v\${v}\`,
  profile: (tenantId, userId)        => \`t:\${tenantId}:user:\${userId}:profile\`,
  search:  (tenantId, params)        => \`t:\${tenantId}:search:\${canonical(params)}\`,
  session: (sid)                     => \`sess:\${sid}\`,
};

// Deterministic composite keys: sorted, filtered, normalized
function canonical(params) {
  return Object.entries(params)
    .filter(([k]) => !["utm_source", "ref", "cb"].includes(k)) // noise out
    .map(([k, v]) => [k, String(v).trim().toLowerCase()])
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => k + "=" + encodeURIComponent(v))
    .join(":");
}
// search({ q: "Shoes ", sort: "price", cb: "123" })
// search({ sort: "price", q: "shoes" })   -> SAME key. Both hits.

// Group invalidation without SCAN storms: version slot per group
async function invalidateTenantUsers(tenantId) {
  await redis.incr("t:" + tenantId + ":ver:user"); // next reads build keys with the new version
}

// Del-by-pattern only on bounded namespaces (SCAN, never KEYS in prod):
async function purgeTenantSearch(tenantId) {
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", "t:" + tenantId + ":search:*", "COUNT", 500);
    if (keys.length) await redis.del(...keys);
    cursor = next;
  } while (cursor !== "0");
}`,
    steps: ["Define key pattern", "Group related keys by prefix", "Invalidate by pattern", "Clean, targeted eviction"],
  },
];