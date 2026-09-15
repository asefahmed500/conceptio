import type { Concept } from "../types";

export const SYSD: Concept[] = [
  {
    id: "sysd-cap",
    cat: "sysd",
    title: "CAP Theorem",
    one: "In a network partition, a distributed system must choose Consistency or Availability.",
    why: "Every distributed data claim eventually hits CAP: when the network splits, a node can either refuse requests it can't verify (stay consistent) or answer from possibly-stale local data (stay available). Knowing which side your database picks explains almost all of its behavior under failure.",
    how: "In normal operation you can have both consistency and availability. When a partition cuts nodes from each other: C systems reject writes/reads that would violate consistency (CP — ZooKeeper, HBase), A systems keep serving possibly-divergent data (AP — Cassandra, Dynamo). The choice is made per system (or per operation), and it's a real trade, not a slogan.",
    when: "Use CP where being wrong is unacceptable: ledgers, inventory reservation, coordination/locks. Use AP where being briefly stale is fine: feeds, carts, sessions, catalogs. The nuance most discussions miss: partitions are rare — your PACELC trade (latency vs consistency ALWAYS) matters more day-to-day than the partition behavior.",
    ref: "Eric Brewer — CAP Theorem",
    subtopics: [
      { name: "The partition premise", detail: "CAP only constrains behavior DURING a network partition — which is why 'pick two of three' misleads. Between partitions you tune consistency-latency instead (that's PACELC)." },
      { name: "CP systems", detail: "Refuse rather than risk wrongness: majority-quorum writes, rejects during partitions. Expect unavailability errors as the price — your app must decide what 'degraded' means." },
      { name: "AP systems", detail: "Accept writes always, reconcile later: last-write-wins or CRDT convergence. Expect conflicts and staleness as the price — your app must handle reading yesterday's data for seconds or minutes." },
      { name: "It's per-operation, really", detail: "Modern stores mix: Dynamo offers strongly-consistent reads (CP behavior) AND eventually-consistent reads (AP behavior) per call. Model the trade per data type, not per database." },
    ],
    code: `// The partition, simulated: two nodes that can't reach each other
class Node {
  constructor(name, peers) {
    this.name = name;
    this.peers = peers; // reachable nodes
    this.data = new Map();
    this.acceptWrites = true;
  }

  // AP choice: serve from local data, always available, possibly stale
  async readAP(key) {
    return this.data.get(key) ?? null; // no peer check — instant, maybe old
  }

  async writeAP(key, value) {
    this.data.set(key, { value, ts: Date.now(), node: this.name }); // accept always
    setImmediate(() => this.gossip(key)); // converge in background
    return true;
  }

  // CP choice: require majority agreement before answering
  async writeCP(key, value) {
    const reachable = [this, ...this.peers.filter((p) => !p.partitioned)];
    const majority = Math.floor(totalNodes() / 2) + 1;
    if (reachable.length < majority) {
      throw new Error("unavailable: cannot reach quorum"); // CP: refuse
    }
    for (const peer of reachable) await peer.applyLocal(key, value);
    return true;
  }
}

// Network partition happens:
nodeA.partitioned = false; nodeB.partitioned = true;
await nodeA.writeAP("cart:42", { items: 2 });           // AP: accepted, diverges
console.log(await nodeB.readAP("cart:42"));             // null (stale) — but available
await expect(nodeB.writeCP("cart:42", { items: 3 })).rejects.toThrow("quorum"); // CP: refused`,
    steps: ["Network partition occurs", "Choose Consistency", "Or choose Availability", "Can't fully have both"],
  },
  {
    id: "sysd-consistenthash",
    cat: "sysd",
    title: "Consistent Hashing",
    one: "Adding or removing a server only reshuffles a small slice of keys.",
    why: "Naive hashing (key % N) reassigns nearly EVERY key when N changes — one new cache node flushes the whole cache; one new DB shard moves almost all data. Consistent hashing makes membership changes move only ~1/N of keys: the property sharded systems and CDNs are built on.",
    how: "Hash servers onto a ring (0..2^32); hash each key onto the same ring; each key belongs to the next server clockwise. Adding a server steals only the segment between it and its predecessor; removing one hands its segment to its successor. Virtual nodes (100-200 per server) smooth the distribution across uneven machines.",
    when: "Anywhere keys map to a variable set of servers: distributed caches (Memcached clients), sharded storage (Dynamo, Cassandra), CDNs, and load-balanced stateful services. If your fleet membership changes at all, modulo-hashing is a data-migration incident waiting to happen.",
    ref: "Karger et al. — Consistent Hashing Paper",
    subtopics: [
      { name: "The ring", detail: "Both servers and keys land on one hash circle; ownership = next server clockwise. Membership changes affect only the changed arc — everything else keeps its owner." },
      { name: "Virtual nodes", detail: "Each physical server appears 100-200 times on the ring: smooths statistical lumps (small clusters get wild with plain consistent hashing) and lets uneven machines take proportional shares." },
      { name: "Bounded movement", detail: "The guarantee: adding node N moves ~1/(N+1) of keys, not all of them. 10 nodes → 11 moves ~9%; the cache stays 91% warm through a scale-out." },
      { name: "Rendezvous hashing alternative", detail: "HRW: each key computes a score per server, picks the max. No ring, perfect balance, easy weighted support — O(N) per lookup instead of O(log N), fine for small N." },
    ],
    code: `const crypto = require("crypto");
const hash = (s) => crypto.createHash("md5").update(s).digest().readUInt32BE(0);

class ConsistentHashRing {
  constructor(vnodes = 150) {
    this.ring = new Map();  // ringHash -> server
    this.sorted = [];       // sorted ring hashes for binary search
    this.vnodes = vnodes;
  }

  addServer(server) {
    for (let i = 0; i < this.vnodes; i++) {
      const h = hash(server + "#" + i);
      this.ring.set(h, server);
    }
    this.sorted = [...this.ring.keys()].sort((a, b) => a - b);
  }

  removeServer(server) {
    for (const [h, s] of this.ring) if (s === server) this.ring.delete(h);
    this.sorted = [...this.ring.keys()].sort((a, b) => a - b);
  }

  getServer(key) {
    const h = hash(key);
    // first server clockwise from the key's position
    const idx = this.sorted.findIndex((x) => x >= h);
    return this.ring.get(this.sorted[idx === -1 ? 0 : idx]);
  }
}

const ring = new ConsistentHashRing();
["cache-1", "cache-2", "cache-3"].forEach((s) => ring.addServer(s));
const before = ["k1", "k2", "k3"].map((k) => [k, ring.getServer(k)]);

ring.addServer("cache-4"); // scale out: only ~25% of keys move, 75% stay warm
const moved = ["k1", "k2", "k3"].filter(([k, s]) => ring.getServer(k) !== s).length;
console.log({ before, moved }); // moved: 1 of 3 — modulo would have moved all 3`,
    steps: ["Keys mapped on a ring", "Server added", "Only nearby keys move", "Rest stay put"],
  },
  {
    id: "sysd-cqrs",
    cat: "sysd",
    title: "CQRS",
    one: "Splitting the model that handles writes from the model that handles reads.",
    why: "Writes want normalized, constraint-enforced structures; reads want denormalized, pre-joined shapes. One model serves both badly — either slow reads full of joins or fragile writes. CQRS lets each side be shaped for its job, scaled independently, and optimized without compromise.",
    how: "Commands (writes) go through the domain model enforcing invariants, appending changes to the store. Those changes propagate (events, CDC) to read models: projections shaped per query — a search index, a denormalized table, a cache. Queries hit ONLY the read models, never the write store.",
    when: "Worth it when reads and writes genuinely diverge: dashboards reading across millions of rows while writes are simple, or search/recommendations needing exotic structures. Skip for plain CRUD — two models without divergence is pure overhead. CQRS pairs naturally with event sourcing but doesn't require it.",
    ref: "Martin Fowler — CQRS",
    subtopics: [
      { name: "Commands vs queries", detail: "Commands mutate and enforce invariants (PlaceOrder); queries never mutate and return shaped data (GetOrderSummary). Separating the types clarifies everything downstream." },
      { name: "Read models as projections", detail: "Each read shape gets its own projection: flat table for lists, search index for lookup, graph for recommendations. Rebuildable from the write-side events at any time." },
      { name: "Eventual consistency between models", detail: "Projection lag means reads trail writes by ms-seconds. UI handles it: read-your-writes for the acting user, version stamps, or optimistic UI. This is CQRS's cost — know where it's acceptable." },
      { name: "Independent scaling", detail: "Read traffic 50x write traffic? Scale 20 read replicas of the projection while keeping one write store. The models' different load profiles stop fighting over one database." },
    ],
    code: `// WRITE SIDE: normalized, invariant-enforcing
class OrderCommands {
  static async place(db, userId, items) {
    if (!items.length) throw new Error("empty order");
    const order = { id: crypto.randomUUID(), userId, items, status: "placed", totalCents: sum(items) };
    await db.orders.insert(order);
    await bus.publish("OrderPlaced", order); // read models learn via events
    return order.id;
  }
  static async ship(db, orderId) {
    const order = await db.orders.find(orderId);
    if (order.status !== "paid") throw new Error("cannot ship unpaid order"); // invariant
    await db.orders.update(orderId, { status: "shipped" });
    await bus.publish("OrderShipped", { orderId });
  }
}

// READ SIDE: projections shaped for their queries, rebuilt from events
bus.on("OrderPlaced", async (e) => {
  await readDb.ordersByMonth.insertOne({ month: monthOf(e.createdAt), orderId: e.id, totalCents: e.totalCents });
  await searchIndex.index({ id: e.id, userId: e.userId, status: "placed" });
});
bus.on("OrderShipped", async (e) => {
  await readDb.ordersByMonth.updateMany({ orderId: e.orderId }, { $set: { status: "shipped" } });
  await searchIndex.patch(e.orderId, { status: "shipped" });
});

// Queries hit ONLY projections — the dashboard never touches the write store
const revenue = await readDb.ordersByMonth.aggregate([{ $match: { month } }, { $group: { _id: null, total: { $sum: "$totalCents" } } }]);
const results = await searchIndex.query({ userId, status: "shipped" });`,
    steps: ["Write request → Command model", "State mutated", "Read request → Query model", "Optimized read view returned"],
  },
  {
    id: "sysd-lbalgorithms",
    cat: "sysd",
    title: "Load Balancing Algorithms",
    one: "Round robin, least connections, and IP hash each spread traffic differently.",
    why: "The distribution algorithm decides whether your fleet's capacity is actually usable: round robin against unequal request costs sends users to busy servers while idle ones nap. Choosing the algorithm is choosing how the fleet behaves under uneven load — the normal case, not the exception.",
    how: "Round robin rotates evenly (ignores load). Least connections routes to the least-busy member (adapts to request cost). Weighted variants scale by declared capacity. IP/source hash pins clients to members (affinity). Least response time and random-with-2-choices add smarter or cheaper heuristics.",
    when: "Default to least connections for mixed-cost HTTP APIs. Round robin when costs are uniform or you're L4-forwarding packets. IP hash only for legacy session affinity — real state belongs in Redis. Weighted least-connections when instance sizes differ (canary-sized green pool next to blue).",
    ref: "AWS ELB Documentation",
    subtopics: [
      { name: "Round robin", detail: "Perfectly even counts, perfectly blind to cost: 1ms health checks and 5s reports land in the same rotation. Great for uniform work; a capacity illusion for mixed APIs." },
      { name: "Least connections", detail: "Route to whoever has the fewest open connections — self-correcting against slow requests, no configuration of request costs needed. The HTTP-API default and what ALBs actually do." },
      { name: "IP hash / source affinity", detail: "hash(client IP) → server: sticky without cookies, breaks behind NAT (offices pile onto one server) and reshuffles when pool size changes. Use cookie affinity instead when you need stickiness." },
      { name: "Weighted + least response time", detail: "Weights encode capacity differences (c6i.2xlarge = 2x t3.large). Least-response-time adapts to measured slowness — powerful, but oscillates when latency is noisy; needs smoothing windows." },
    ],
    code: `// Four algorithms over the same fleet — feel the behavioral difference
class Pool {
  constructor(targets) {
    this.targets = targets.map((url) => ({ url, active: 0, healthy: true, p95: 50 }));
    this.rr = 0;
  }

  roundRobin() {
    const live = this.targets.filter((t) => t.healthy);
    return live[this.rr++ % live.length];
  }

  leastConnections() {
    const live = this.targets.filter((t) => t.healthy);
    return live.reduce((min, t) => (t.active < min.active ? t : min)); // adapts to cost
  }

  weightedLeastConn() {
    const live = this.targets.filter((t) => t.healthy);
    // normalize: score = active / weight -> big boxes take proportionally more
    return live.reduce((min, t) => (t.active / t.weight < min.active / min.weight ? t : min));
  }

  ipHash(clientIp) {
    const live = this.targets.filter((t) => t.healthy);
    const h = hash(clientIp);
    return live[h % live.length]; // affinity — reshuffles when fleet size changes
  }

  async dispatch(pick, buildRequest) {
    const target = pick(this);
    target.active++;
    const start = Date.now();
    try {
      return await fetch(target.url + buildRequest.path, buildRequest.init);
    } finally {
      target.active--;
      target.p95 = 0.9 * target.p95 + 0.1 * (Date.now() - start); // smoothed response time
    }
  }
}

// Mixed-cost API: least-connections keeps one slow-report server from eating the fleet
const pool = new Pool(["http://a:3000", "http://b:3000", "http://c:3000"]);
app.use(async (req, res, next) => {
  const t = pool.leastConnections();
  // ... proxy to t ...
});`,
    steps: ["Request arrives", "Algorithm picks server", "Round robin / least conn / IP hash", "Request routed accordingly"],
  },
  {
    id: "sysd-ratelimiterdesign",
    cat: "sysd",
    title: "Rate Limiter Design",
    one: "Token bucket and sliding window are two common algorithms for enforcing limits.",
    why: "'Limit to 100 per minute' hides four different algorithms with different burst behavior, memory costs, and fairness. The design choice decides whether your API allows useful bursts, punishes boundary timing, and survives distributed deployment — before anyone writes a line of code.",
    how: "Fixed window: one counter per minute (simple, boundary bursts of 2x). Sliding window: weighted blend of current+previous windows (smooth, slightly more state). Token bucket: tokens refill at a rate, requests consume them — bursts allowed up to bucket size (the most flexible). Sliding log: exact timestamps in a sorted set (precise, memory-hungry).",
    when: "Token bucket for APIs where short bursts are fine but sustained rate matters (the general default). Sliding window when boundary spikes are unacceptable (billing meters). All of them in Redis with Lua for atomicity when limits must hold across a cluster — in-process counters only enforce per-instance.",
    ref: "Stripe Engineering Blog",
    subtopics: [
      { name: "Token bucket", detail: "Bucket of size B refilling at R/s: allows B-burst instantly then sustains R. Two knobs = intuitive policy ('10 burst, 5/s sustained'). The AWS API throttling model." },
      { name: "Sliding window counter", detail: "Weight current window by elapsed fraction + previous window's count: smooths the fixed-window boundary burst with just 2 counters per client. The pragmatic middle." },
      { name: "Sliding window log", detail: "Store each request's timestamp (sorted set), prune older than window, count: EXACT limits, O(window density) memory. For billing-grade accuracy or small limits, not for 10k-rps clients." },
      { name: "Distributed enforcement", detail: "N app instances sharing one Redis via atomic Lua = one cluster-wide limit. In-memory per-instance = N times the intended limit (and an interviewer's favorite follow-up)." },
    ],
    code: `// All three, against Redis, atomic where it matters
const FIXED = \`
  local n = redis.call("INCR", KEYS[1])
  if n == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
  return n
\`;
async function fixedWindow(clientId, limit, windowSec) {
  const minute = Math.floor(Date.now() / (windowSec * 1000));
  const count = await redis.eval(FIXED, 1, "rl:" + clientId + ":" + minute, windowSec);
  return count <= limit;
}

// Token bucket: burst + sustained rate
const BUCKET = \`
  local tokens = tonumber(redis.call("HGET", KEYS[1], "t") or ARGV[1])
  local last = tonumber(redis.call("HGET", KEYS[1], "ts") or ARGV[3])
  local now = tonumber(ARGV[3])
  tokens = math.min(tonumber(ARGV[1]), tokens + (now - last) * tonumber(ARGV[2]))
  if tokens < 1 then
    redis.call("HSET", KEYS[1], "t", tokens, "ts", now)
    return 0
  end
  redis.call("HSET", KEYS[1], "t", tokens - 1, "ts", now)
  return 1
\`;
async function tokenBucket(clientId, capacity, refillPerSec) {
  return (await redis.eval(BUCKET, 1, "tb:" + clientId,
    capacity, refillPerSec, Math.floor(Date.now() / 1000))) === 1;
}

// Sliding window counter: smooth the boundary
async function slidingWindow(clientId, limit, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const cur = Math.floor(now / windowSec);
  const elapsed = (now % windowSec) / windowSec;
  const [curC, prevC] = await Promise.all([
    redis.get("rl:" + clientId + ":" + cur).then(Number),
    redis.get("rl:" + clientId + ":" + (cur - 1)).then(Number),
  ]);
  const weighted = prevC * (1 - elapsed) + curC;
  if (weighted + 1 <= limit) {
    await redis.multi().incr("rl:" + clientId + ":" + cur).expire("rl:" + clientId + ":" + cur, windowSec * 2).exec();
    return true;
  }
  return false;
}`,
    steps: ["Tokens added over time", "Request consumes a token", "No tokens left", "Request rejected until refill"],
  },
  {
    id: "sysd-urlshortener",
    cat: "sysd",
    title: "Designing a URL Shortener",
    one: "A classic interview problem covering hashing, redirects, and storage at scale.",
    why: "The perfect micro-design problem: it looks trivial (store URL, redirect) and then unfolds into ID generation, collision handling, read-heavy scaling, analytics, and abuse control. Every decision — keys, storage, caching — is a 101 lesson in system design.",
    how: "Core: generate a short code (base62 of a sequential ID — no collisions, or hash-based with collision checks), store code→long_url in a KV store. Redirect: 301 (cached by browsers — no analytics) vs 302 (always hits you — analytics kept). Reads dwarf writes 100:1 → cache hot codes in Redis/CDN, custom aliases on top.",
    when: "The design pattern generalizes: any short-ID → heavy-lookup service (short links, coupon codes, share tokens). The interview discipline — requirements first (analytics? custom aliases? TTLs?), estimate QPS, then design — is the transferable skill.",
    ref: "System Design Primer (GitHub)",
    subtopics: [
      { name: "ID generation", detail: "Sequential counter → base62 (aZ3x9Q): collision-free, sortable, but enumerable. Random 7-char codes: 62^7 ≈ 3.5 trillion space, collision check on insert. Most systems: counter + random salt." },
      { name: "301 vs 302", detail: "301 = permanent, browsers cache and never return (no click analytics, can't expire). 302/307 = temporary, every click hits your redirector (analytics + expiry control). SEO vs measurement trade." },
      { name: "Read-heavy caching", detail: "100:1 read:write → Redis in front (hot codes), CDN for popular public links. Redirect at the edge (workers) = 5ms globally. The cache is the architecture; the DB is cold storage." },
      { name: "Abuse control", detail: "Shorteners are phishing infrastructure unless you fight it: malware scanning on insert, blocklists, per-user rate limits, and expiring/revocable codes. Google shutdown bit.ly's spam era for a reason." },
    ],
    code: `const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

// Counter-based ID -> base62: collision-free, short, sortable
let counter; // from a ranged allocator (Zookeeper/Ticket Server) at scale
function encode(num) {
  let s = "";
  do { s = ALPHABET[num % 62] + s; num = Math.floor(num / 62); } while (num > 0);
  return s.padStart(7, "a"); // 62^7 = 3.5 trillion codes
}

async function shorten(longUrl, { customAlias = null, userId } = {}) {
  validateUrl(longUrl); // SSRF + malware checks: you're a phishing target otherwise

  const code = customAlias ?? encode(await idAllocator.next());
  const existing = await redis.get("code:" + code);
  if (existing && !customAlias) return JSON.parse(existing); // idempotent same-URL
  if (existing && customAlias) throw new ConflictError("alias taken");

  await db.urls.insert({ code, longUrl, userId, createdAt: new Date() });
  await redis.set("code:" + code, JSON.stringify({ longUrl }), { EX: 86400 * 30 });
  return "https://sho.rt/" + code;
}

// The redirect: 302 for analytics + expiry control, served from cache
app.get("/:code", async (req, res) => {
  const raw = await redis.get("code:" + req.params.code)
    ?? (await db.urls.find(req.params.code))?.let?.((r) => JSON.stringify({ longUrl: r.longUrl }));
  if (!raw) return res.status(404).send("unknown link");

  const { longUrl } = JSON.parse(raw);
  metrics.increment("redirect", { code: req.params.code.slice(0, 1) }); // fire-and-forget analytics
  res.set("Cache-Control", "public, max-age=60");                        // CDN-cacheable hot links
  res.redirect(302, longUrl);
});`,
    steps: ["Long URL submitted", "Hashed to short code", "Stored in database", "Short code redirects to long URL"],
  },
  {
    id: "sysd-newsfeed",
    cat: "sysd",
    title: "Designing a News Feed",
    one: "Fan-out on write vs fan-out on read for delivering personalized feeds.",
    why: "The feed is the classic read-scale problem: personalized (ranked, merged, from everyone you follow) yet served thousands of times per second. The whole design is ONE trade: precompute feeds when posts happen (fast reads, expensive writes) or compute at request time (cheap writes, slow reads).",
    how: "Fan-out on write: when a user posts, push the post ID into every follower's precomputed feed list (Redis lists). Reads are one fetch. Fan-out on read: at request time, gather recent posts from all followed users, merge, rank. Hybrid: fan-out for normal users, fan-out-on-read for celebrities (10M followers would mean 10M writes per post).",
    when: "Hybrid is the real answer at scale: most users have <1000 followers (fan-out cheap), celebrities get merged at read time. The interview tells you to pick; the production system tells you the answer depends on follower distribution — design both paths and route by author weight.",
    ref: "System Design Primer (GitHub)",
    subtopics: [
      { name: "Fan-out on write", detail: "Post → push into all followers' cached feeds: O(followers) write cost, O(1) reads. Perfect when reads massively outnumber writes and follower counts are bounded." },
      { name: "Fan-out on read", detail: "Feed = merge(following's recent posts) at request time: O(1) writes, O(followees) reads. Handles celebrities and ephemeral content; needs fast merging (pre-sorted per-author feeds, k-way merge)." },
      { name: "The hybrid router", detail: "Fan-out for authors < 10k followers; at read time, merge the precomputed feed with the few celebrities the user follows. Best of both — this is what Twitter/Instagram actually do." },
      { name: "Ranking as a layer", detail: "Store candidate IDs in the feed; rank at read (recency × affinity × engagement) over the top ~500 candidates. Ranking changes don't require re-fanning the world." },
    ],
    code: `// HYBRID: fan-out for normal authors, read-time merge for celebrities
const CELEBRITY_THRESHOLD = 10000;

async function publishPost(authorId, postId) {
  const followers = await countFollowers(authorId);

  if (followers < CELEBRITY_THRESHOLD) {
    // fan-out on write: push into each follower's cached feed
    const batches = followersBatches(authorId, 5000);
    for await (const batch of batches) {
      await redis.pipeline(...batch.map((f) => ["lPush", "feed:" + f, postId])).exec();
      await batch.forEach(async (f) => redis.lTrim("feed:" + f, 0, 799)); // cap feed length
    }
  }
  // celebrities: stored posts are discoverable at read time
  await authorTimeline.set(authorId, postId);
}

async function getFeed(userId) {
  // 1. precomputed part: instant from cache
  const precomputed = await redis.lRange("feed:" + userId, 0, 199);

  // 2. celebrity part: k-way merge over the ~20 celebrities this user follows
  const celebrities = await following.filterByFollowerCount(userId, CELEBRITY_THRESHOLD);
  const celebPosts = (await Promise.all(celebrities.map((c) => authorTimeline.recent(c, 20)))).flat();

  // 3. merge + rank: recency x affinity over ~220 candidates
  const merged = [...new Set([...precomputed, ...celebPosts])];
  const ranked = await ranker.score(userId, merged, { recencyWeight: 0.6, affinityWeight: 0.4 });
  return hydrate(ranked.slice(0, 50)); // fetch full posts for the top 50 only
}`,
    steps: ["User posts content", "Fan-out on write: pushed to followers' feeds", "Or fan-out on read: computed at request time", "Feed rendered to viewer"],
  },
  {
    id: "sysd-chatsystem",
    cat: "sysd",
    title: "Designing a Chat System",
    one: "Combining WebSockets, message queues, and storage for real-time delivery.",
    why: "Chat looks like a CRUD app with a socket attached, then reveals the real requirements: delivery guarantees across flaky mobile networks, ordering across devices, offline inboxing, and fan-out to group members across many servers. It's the canonical real-time + reliability design exercise.",
    how: "Clients hold persistent WebSocket connections to gateway servers (sticky by connection, discovered via presence service). Messages: client → gateway → queue → persisted with sequence numbers → fanned out to recipients' gateways → pushed over sockets. Offline recipients get inboxed messages delivered on reconnect; ACKs and client-side dedupe close the reliability loop.",
    when: "The pattern generalizes to anything real-time with guarantees: collaboration, presence, live notifications, multiplayer state. The transferable core: connection layer (gateways) separate from logic, persistent ordered storage as the source of truth, and delivery confirmation loops.",
    ref: "System Design Primer (GitHub)",
    subtopics: [
      { name: "Connection gateways", detail: "Stateless-ish servers holding the sockets: users connect to the nearest/least-loaded gateway; a presence registry maps userId → gateway so any server can route to any user." },
      { name: "Ordering & sequence numbers", detail: "Per-conversation monotonic sequence numbers assigned at persist time. Clients detect gaps → request sync. Clocks lie across devices; sequences assigned by the server are the only honest ordering." },
      { name: "Delivery guarantees", detail: "Persist → fan-out → per-recipient ACK. No ACK → retry with backoff (idempotent by messageId: clients dedupe). The at-least-once + client dedupe combo is THE pattern for guaranteed delivery." },
      { name: "Offline inboxing & sync", detail: "Recipient offline: message sits in the inbox (per-user queue/table). On reconnect, client sends last-seen sequence → server replays the delta. History pagination shares the same machinery." },
    ],
    code: `// Message flow: gateway -> persist (seq) -> fan-out -> ACK -> offline inbox
app.ws("/chat", (ws, req) => {
  const userId = req.user.sub;
  presence.register(userId, gatewayId);
  ws.on("close", () => presence.unregister(userId));

  ws.on("message", async (raw) => {
    const msg = JSON.parse(raw);

    // 1. persist FIRST with server-assigned sequence — the source of truth
    const seq = await sequences.next(msg.conversationId);
    const stored = await db.messages.insert({ ...msg, senderId: userId, seq, id: msg.idempotencyId });

    // 2. durable fan-out: queue so a slow recipient's gateway never blocks the sender
    await fanoutQueue.add("deliver", { message: stored });

    // 3. ACK the sender — their UI can mark 'sent'
    ws.send(JSON.stringify({ type: "ack", id: msg.idempotencyId, seq }));
  });
});

// Delivery worker: push to online recipients, inbox the offline ones
const deliver = new Worker("deliver", async ({ message }) => {
  const recipients = await conversation.members(message.conversationId);

  await Promise.all(recipients.map(async (uid) => {
    const gw = await presence.locate(uid);
    if (gw) {
      const delivered = await gateways[gw].push(uid, message, { timeoutMs: 3000 });
      if (delivered) return; // online + pushed
    }
    await db.inbox.insert({ userId: uid, messageId: message.id, seq: message.seq }); // offline inbox
  }));
});

// Reconnect sync: replay everything since last-seen sequence (dedupe by id client-side)
app.get("/sync", async (req, res) => {
  const { conversationId, lastSeq } = req.query;
  res.json({ messages: await db.messages.after(conversationId, Number(lastSeq), 200) });
});`,
    steps: ["Message sent", "WebSocket delivers in real time", "Queued if recipient offline", "Persisted to storage"],
  },
  {
    id: "sysd-leaderelection",
    cat: "sysd",
    title: "Leader Election",
    one: "Distributed nodes agree on which one coordinates, especially after a failure.",
    why: "Many distributed tasks must run EXACTLY ONCE — cron jobs, partition rebalancing, failover coordination. Run them on all nodes and they collide; run on none and nothing happens. Leader election picks one node to coordinate, and re-picks automatically when it dies.",
    how: "Consensus-lite via leases: nodes compete for a lock/token with a TTL (etcd/ZooKeeper session, Redis SET NX+TTL, Postgres advisory lock). The holder is leader while it renews; on death, the lease expires and survivors race to acquire. Fencing tokens (monotonic version numbers) stop a dead-but-slow old leader from acting after the new one starts.",
    when: "Any single-coordinator need in a multi-node deployment: schedulers, rebalancers, backup initiators, metric rollups. If a platform primitive exists (K8s leader election, Kafka consumer group leader, Postgres primary), use it — hand-rolled election is where split-brain bugs breed.",
    ref: "Raft Consensus Algorithm Paper",
    subtopics: [
      { name: "Lease-based election", detail: "Lock with TTL + heartbeat renewal: leader = current holder. Simple, available — but TTL tuning is life: too short = leadership flaps under GC pauses; too long = failover takes forever." },
      { name: "Split brain & fencing", detail: "Old leader paused (GC/network) past TTL → new leader elected → old leader wakes and acts. Fencing tokens (incrementing numbers checked by the resource) make the stale leader's writes provably rejectable." },
      { name: "Consensus-based (Raft/Zab)", detail: "etcd/ZooKeeper run full consensus: elections survive arbitrary node failures with strict safety. Heavier, but the right base when correctness of the election itself is critical (config, coordination services)." },
      { name: "Platform primitives", detail: "K8s Lease objects (used by controllers), Kafka consumer groups (partition leaders), Postgres streaming replication (the primary IS the leader). Prefer the platform's battle-tested mechanism over rolling your own." },
    ],
    code: `// Lease-based leader election with fencing — the practical pattern
class LeaderElection {
  constructor(name, instanceId, { ttlMs = 15000, renewMs = 5000 } = {}) {
    this.key = "leader:" + name;
    this.instanceId = instanceId;
    this.ttlMs = ttlMs;
    this.renewMs = renewMs;
    this.term = 0; // fencing token: monotonically increasing
  }

  async campaign(onLead, onFollow) {
    for (;;) {
      // try to acquire or reconfirm leadership
      const current = await redis.get(this.key);
      if (!current) {
        const acquired = await redis.set(this.key, JSON.stringify({ id: this.instanceId, term: ++this.term }), { NX: true, PX: this.ttlMs });
        if (acquired) { logger.info("became leader", { term: this.term }); this.leading = onLead(this.term); }
      }
      if (current && JSON.parse(current).id === this.instanceId) {
        await redis.pExpire(this.key, this.ttlMs); // renew lease
      } else if (this.leading) {
        this.leading = false; onFollow(); // lost leadership: STOP acting immediately
      }
      await sleep(this.renewMs);
    }
  }

  get fenceToken() { return this.term; } // storage rejects writes with stale terms
}

const election = new LeaderElection("nightly-rollup", instanceId);
election.campaign(
  (term) => scheduler.start("rollup", { fenceToken: term }),  // ONLY the leader runs this
  () => scheduler.stop("rollup")
);

// Storage enforces fencing: a zombie leader can't corrupt anything
await pool.query("UPDATE rollups SET value = $1 WHERE term < $2", [value, term]);`,
    steps: ["Leader fails", "Nodes detect timeout", "Election triggered", "New leader chosen by majority"],
  },
  {
    id: "sysd-consensus",
    cat: "sysd",
    title: "Consensus Algorithms (Raft/Paxos)",
    one: "Getting distributed nodes to agree on a single value despite failures.",
    why: "Everything coordination-shaped rests on consensus: leader election, replicated state machines, config stores, distributed locks. Raft/Paxos are the proven protocols that let N failure-prone machines behave like ONE reliable machine — tolerate up to (N-1)/2 failures while never agreeing on two things at once.",
    how: "Raft: nodes elect a leader by majority vote; the leader takes writes, replicates them as log entries, and commits once a MAJORITY acknowledges. Reads/writes require only quorum, so 2f+1 nodes tolerate f failures. Safety comes from term numbers and majority intersection: two majorities always overlap, so conflicting commits are impossible.",
    when: "You almost never implement it — you USE it: etcd (K8s state), ZooKeeper, CockroachDB/TiKV, Consul, Kafka's KRaft. Reach for a consensus store when you need strongly-consistent coordination metadata; avoid as a general database (quorum commit latency on every write).",
    ref: "Raft Consensus Algorithm Paper",
    subtopics: [
      { name: "Leader election + terms", detail: "Monotonic terms; each election increments. Leaders carry their term on every message — a node seeing a higher term immediately steps down. Stale-leader confusion dies by arithmetic." },
      { name: "Log replication", detail: "Writes append to the leader's log, replicate to followers, commit on majority ack, then apply in order. All nodes execute the SAME log → same state (replicated state machine)." },
      { name: "Majority quorum intersection", detail: "The safety core: any two majorities share a node, so a value committed in one term survives into the next election. This is why 2f+1 survives f failures — and why 3 nodes is the minimum meaningful cluster." },
      { name: "Raft over Paxos", detail: "Same guarantees, built for comprehension: explicit leader, decoupled election/log/commit. Paxos (and Multi-Paxos) came first but was notoriously hard to implement correctly — Raft is what you actually deploy." },
    ],
    code: `// Raft's shape, simplified: election, replication, commit by majority
class RaftNode {
  constructor(id, peers) {
    this.id = id;
    this.peers = peers;                  // including self: 2f+1 total
    this.term = 0;
    this.state = "follower";
    this.log = [];
    this.commitIndex = -1;
  }

  async elect() {
    this.term++;
    this.state = "candidate";
    const votes = [this.id];

    const acks = await Promise.all(this.peers.filter((p) => p !== this.id).map(async (peer) => {
      try {
        const res = await rpc(peer, "requestVote", { term: this.term, candidateId: this.id });
        return res.voteGranted ? peer : null;
      } catch { return null; } // unreachable peer: not a no-vote, just absent
    }));

    for (const a of acks) if (a) votes.push(a);
    const majority = Math.floor(this.peers.length / 2) + 1;
    if (votes.length >= majority && this.state === "candidate") {
      this.state = "leader"; // terms + majority: at most ONE leader per term, ever
      this.heartbeat();
    }
  }

  async replicate(entry) {
    if (this.state !== "leader") throw new Error("not the leader");
    const index = this.log.push({ term: this.term, entry }) - 1;

    const acked = await Promise.all(this.peers.map(async (peer) => {
      try { return (await rpc(peer, "appendEntries", { term: this.term, entries: this.log.slice(index) })).ok; }
      catch { return false; }
    }));

    const majority = Math.floor(this.peers.length / 2) + 1;
    if (acked.filter(Boolean).length >= majority) {
      this.commitIndex = index;           // committed: majority durability, can't be lost
      return true;
    }
    return false; // uncommitted: will retry / may be superseded by a new leader
  }
}`,
    steps: ["Proposal made", "Nodes vote", "Majority agrees", "Value committed across cluster"],
  },
  {
    id: "sysd-distlocks",
    cat: "sysd",
    title: "Distributed Locks",
    one: "Coordinating exclusive access to a resource across multiple machines.",
    why: "In-process mutexes stop at the process boundary: three app servers running 'renew certificates' will run it three times. A distributed lock extends mutual exclusion across the fleet — acquire before the critical section, hold briefly, release or expire.",
    how: "A shared store arbitrates: SET key value NX PX ttl — one winner, everyone else told no. Safety needs the TTL (a crashed holder must not deadlock the resource) plus fencing tokens (monotonic numbers the protected resource checks) because a paused holder can wake up AFTER its lock expired and someone else took over.",
    when: "Use for coordinating maintenance and idempotent work (cron leadership, cache rebuilds, migrations), where the failure mode is duplicated work. NOT as a correctness mechanism around money or inventory — a database transaction with row locks or atomic conditional writes is the real guarantee there. Redlock (multi-node Redis) remains debated; DB-backed locks or ZooKeeper/etcd are safer ground.",
    ref: "Redis Documentation (Redlock)",
    subtopics: [
      { name: "SET NX + TTL", detail: "The whole primitive: atomic create-if-absent with expiry. TTL = failure safety; choose it above worst-case critical section + clock skew, below tolerable failover wait." },
      { name: "Fencing tokens", detail: "Lock grants an incrementing token; the resource rejects stale ones (WHERE term < mine). Without it, a GC-paused holder resumes post-expiry and corrupts the new holder's work. Martin Kleppmann's Redlock critique in one concept." },
      { name: "Renewal vs expiry", detail: "Long work: renew the TTL on a heartbeat (watchdog), OR design the work to checkpoint-and-resume after lock loss. Renewal must stop the instant you're not sure you still hold the lock." },
      { name: "DB-backed alternative", detail: "Postgres: INSERT a lease row with unique constraint + expires_at, or advisory locks. Transactional, auditable, no extra infra — usually the right answer when you already run Postgres." },
    ],
    code: `// Redis lock with fencing + DB enforcement
class DistLock {
  constructor(name, instanceId) {
    this.key = "lock:" + name;
    this.instanceId = instanceId;
    this.token = null;
  }

  async acquire(ttlMs = 30000) {
    this.token = Date.now(); // simplified: real fencing uses a monotonic counter source
    const ok = await redis.set(this.key, JSON.stringify({ id: this.instanceId, token: this.token }), { NX: true, PX: ttlMs });
    if (!ok) return false;
    this.watchdog = setInterval(() => redis.pExpire(this.key, ttlMs), ttlMs / 3); // renew while alive
    return true;
  }

  async release() {
    clearInterval(this.watchdog);
    // compare-and-delete: only the holder releases (Lua for atomicity)
    await redis.eval(\`
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      end
      return 0
    \`, 1, this.key, JSON.stringify({ id: this.instanceId, token: this.token }));
  }
}

// Usage: cron leadership across 5 instances
const lock = new DistLock("cert-renewal", instanceId);
if (await lock.acquire()) {
  try {
    const term = lock.token;
    await renewCertificates();                     // the critical section
    await db.runs.insert({ job: "cert-renewal", term }); // fenced by term
  } finally {
    await lock.release();
  }
}

// The correctness alternative for inventory — no lock at all, atomic condition:
// UPDATE inventory SET stock = stock - 1 WHERE sku = $1 AND stock > 0  <- atomic, safe, done.`,
    steps: ["Node requests lock", "Lock acquired with expiry", "Critical section runs", "Lock released or expires"],
  },
  {
    id: "sysd-idempotencydist",
    cat: "sysd",
    title: "Idempotency in Distributed Systems",
    one: "Ensuring retried operations across services don't duplicate effects.",
    why: "Distributed systems retry EVERYTHING — timeouts after the server processed the request are the norm, not the exception. Without idempotency, each retry doubles a charge, duplicates a shipment, or double-decrements stock. With it, retries become safe and the whole architecture relaxes.",
    how: "Client attaches an idempotency key (UUID) per logical operation; server records key → response atomically. Replays return the stored response instead of re-executing. Server-side, design operations to be naturally idempotent where possible (conditional updates, upserts, absolute values instead of increments) — keys are the belt, natural idempotency is the suspenders.",
    when: "Every unsafe operation that crosses a network: payment APIs (Stripe's Idempotency-Key), order creation, queue consumers, webhook receivers, saga steps. The contract goes in your API docs: keys required, retention window stated, replay returns the original response with a marker.",
    ref: "Stripe Engineering Blog",
    subtopics: [
      { name: "Key → response storage", detail: "Store the FIRST response (status + body + status code) keyed by the key, with TTL. Replay returns the stored artifact — including errors, which is correct: the operation DID happen." },
      { name: "Atomic claim races", detail: "Two concurrent requests with the same key: unique-constraint insert decides the winner; the loser either waits for the stored result (409 with Location) or fails with 'request in progress'. Never process both." },
      { name: "Natural idempotency first", detail: "SET status='paid' vs increment counter; upsert vs insert; DELETE by id vs delete-first-match. Operations built as absolute conditional state changes are idempotent without any key machinery." },
      { name: "Scope the keys", detail: "Keys are scoped per operation type + per client: (client_id, operation, key). A replayed 'charge' key must never apply to 'refund' — unscoped keyspaces create cross-operation collisions." },
    ],
    code: `// The server-side pattern: atomic claim, stored response, scoped keys
async function createPayment(req, res) {
  const key = req.get("Idempotency-Key");
  if (!key) return res.status(400).json({ error: { code: "idempotency_key_required" } });

  const scope = "payment:" + req.user.id; // scoped: this client's payments only

  // 1. atomic claim: unique constraint decides the winner of concurrent duplicates
  const claim = await pool.query(
    "INSERT INTO idempotency_keys (scope, key, status) VALUES ($1, $2, 'processing') ON CONFLICT DO NOTHING RETURNING id",
    [scope, key]
  );

  if (claim.rowCount === 0) {
    const existing = await pool.query("SELECT * FROM idempotency_keys WHERE scope = $1 AND key = $2", [scope, key]);
    if (existing.rows[0].status === "processing") {
      return res.status(409).json({ error: { code: "request_in_progress" } }); // concurrent duplicate
    }
    // REPLAY: return the original response — charged once, guaranteed
    return res.status(existing.rows[0].status_code).json(existing.rows[0].response);
  }

  // 2. execute ONCE, store the response, mark complete — in one transaction
  const payment = await processPayment(req.body); // may itself be retried by its own guards
  await pool.query(
    "UPDATE idempotency_keys SET status = 'done', status_code = $1, response = $2 WHERE scope = $3 AND key = $4",
    [201, JSON.stringify(payment), scope, key]
  );
  res.status(201).json(payment);
}`,
    steps: ["Request sent with idempotency key", "Network fails, client retries", "Server recognizes same key", "Original result returned, not repeated"],
  },
  {
    id: "sysd-partitioning",
    cat: "sysd",
    title: "Data Partitioning Strategies",
    one: "Range, hash, and directory-based partitioning split data across nodes differently.",
    why: "When one database can't hold or serve the data, partitioning spreads it — but the partition KEY decides which queries stay fast and which become scatter-gather disasters. Range/hash/directory aren't just options; they're different answers to 'how will this data be queried?'",
    how: "Range: contiguous key ranges per node (usernames A-M, N-Z) — great for range scans, hot-spots on sequential keys. Hash: hash(key) % N — even distribution, dead range scans. Directory: a lookup service maps key → node — flexible (arbitrary assignment, live rebalancing) at the cost of an extra lookup and a directory to scale.",
    when: "Hash for key-value access at scale (Dynamo, Cassandra default). Range for time-series and sorted access (Spanner, HBase) with salting against hot spots. Directory when tenants need custom placement (move whale tenants to dedicated nodes). Composite keys (tenant+hash) mix benefits; the choice is permanent-ish — repartitioning is a migration project.",
    ref: "Martin Kleppmann — Designing Data-Intensive Applications",
    subtopics: [
      { name: "Range partitioning", detail: "Sorted ranges per node: time-series paradise (one node per day), hot-spot hell for monotonic IDs (all writes hit the 'last' node). Fix with salting or interleaved ranges." },
      { name: "Hash partitioning", detail: "hash(key) → node: statistical uniformity, zero hot spots. The price: range queries fan out to every node, and ordering exists only within a node. Key-value access is the target shape." },
      { name: "Directory partitioning", detail: "A lookup table maps keys → nodes: arbitrary placement, tenant-specific moves, online rebalancing. The directory is now critical infrastructure — cache it, replicate it, lose it and nothing routes." },
      { name: "Skew & hot keys", detail: "One celebrity user or one massive tenant can dominate a hash partition. Detect via per-partition/per-key metrics; treat with key salting (split into sub-keys) or moving the whale to a dedicated partition." },
    ],
    code: `// Three strategies over the same users table — feel the query consequences
class HashPartitioner {
  constructor(nodes) { this.nodes = nodes; }
  route(key) { return this.nodes[hash(key) % this.nodes.length]; }
  // point lookup: one node. range query: ALL nodes (scatter-gather).
}

class RangePartitioner {
  constructor(ranges) { // [{ min: "a", max: "m", node }, ...]
    this.ranges = ranges;
  }
  route(key) { return this.ranges.find((r) => key >= r.min && key < r.max).node; }
  // range scan touching 2 nodes. BUT: sequential UUIDs -> everything hits the last range.
}

class DirectoryPartitioner {
  constructor() { this.map = new Map(); } // tenantId -> node, mutable placement
  route(key) { return this.map.get(key) ?? this.map.set(key, leastLoaded()).get(key); }
  async moveTo(key, node) { await copyData(key, node); this.map.set(key, node); await deleteFromOld(key); }
}

// The composite trick: tenant-local ordering + global spread
function partitionKey(tenantId, userId) {
  return tenantId + ":" + hash(userId) % 16; // 16 slots per tenant: spread + range scans within tenant
}

// Hot-spot detection feeds the strategy choice
setInterval(async () => {
  const stats = await nodes.map((n) => n.writeQps());
  if (max(stats) > 3 * median(stats)) {
    logger.warn("partition skew detected", { hottest: hottestPartition.key });
    // response: salt the key, or directory-move the whale tenant
  }
}, 60000);`,
    steps: ["Choose partition key", "Range: sorted ranges per node", "Hash: hashed key per node", "Directory: lookup table maps key to node"],
  },
  {
    id: "sysd-vectorclocks",
    cat: "sysd",
    title: "Vector Clocks",
    one: "A way to track causality and ordering of events across distributed nodes.",
    why: "Two replicas accept writes to the same key simultaneously — which one is 'newer'? Timestamps lie (clocks skew); sequence numbers need a coordinator. Vector clocks capture CAUSALITY: they can tell 'B happened after A' from 'A and B are concurrent conflicts' — the difference between merging and guessing.",
    how: "Each event's version is a vector: {nodeA: 3, nodeB: 5}. Local writes increment own counter; replicas merge (element-wise max) when data flows. Compare: A happened-before B if A's vector ≤ B's everywhere (and strictly less somewhere). Incomparable vectors = concurrent writes = a real conflict (Dynamo surfaces both versions; the app or user resolves).",
    when: "Use where concurrent writes are real and merge semantics matter: shopping carts (Dynamo's original case — merge items), collaborative editing, multi-master replication with conflict detection. Skip where last-write-wins is acceptable (counters with delta merging, session data) — vectors add size and resolve-work for conflicts you'd throw away anyway.",
    ref: "Martin Kleppmann — Designing Data-Intensive Applications",
    subtopics: [
      { name: "The vector arithmetic", detail: "Increment your own slot on write; take element-wise max on merge. Compare via partial order: less-than-or-equal everywhere = causality; some-greater-some-less = concurrency." },
      { name: "Concurrent = conflict", detail: "Incomparable versions aren't 'the newer won' — they're divergent history. Resolve by application merge (union cart items), user choice (which edit wins), or CRDT math. V8/Riak expose siblings for exactly this." },
      { name: "Clock skew immunity", detail: "Vectors never consult wall clocks — ordering is derived from observed causality. NTP drift, leap seconds, and lying VM clocks simply cannot corrupt the history." },
      { name: "The growth problem", detail: "Vectors grow with replica count and never shrink naively — a churny cluster accumulates zombie entries. Prune with stability thresholds (entries older than max-seen + margin are safe to drop)." },
    ],
    code: `// Vector clocks: causality without wall clocks
class VectorClock {
  constructor(v = {}) { this.v = { ...v }; }

  increment(nodeId) {
    this.v[nodeId] = (this.v[nodeId] ?? 0) + 1;
    return this;
  }

  merged(other) {
    const out = new VectorClock();
    for (const node of new Set([...Object.keys(this.v), ...Object.keys(other.v)])) {
      out.v[node] = Math.max(this.v[node] ?? 0, other.v[node] ?? 0);
    }
    return out;
  }

  compare(other) {
    const nodes = new Set([...Object.keys(this.v), ...Object.keys(other.v)]);
    let aGreater = false, bGreater = false;
    for (const n of nodes) {
      const a = this.v[n] ?? 0, b = other.v[n] ?? 0;
      if (a > b) aGreater = true;
      if (b > a) bGreater = true;
    }
    if (aGreater && bGreater) return "concurrent"; // CONFLICT: divergent history
    if (aGreater) return "after";
    if (bGreater) return "before";
    return "equal";
  }
}

// Two replicas accept writes offline, then sync:
const a = new VectorClock().increment("replicaA");          // A wrote
const b = new VectorClock().increment("replicaB");          // B wrote, never saw A
console.log(a.compare(b));                                   // "concurrent" — real conflict, resolve by merging

const synced = a.merged(b).increment("replicaA");            // A merges B's state, writes again
console.log(synced.compare(b));                              // "after" — causally newer, no conflict

// The DynamoDB cart case: concurrent carts merge by union, not by timestamp
function mergeCarts(cartA, cartB) {
  return { items: unionBy(cartA.items, cartB.items, "sku"), clock: cartA.clock.merged(cartB.clock) };
}`,
    steps: ["Event occurs on Node A", "Clock incremented", "Event propagates", "Causal order reconstructed from clocks"],
  },
  {
    id: "sysd-quorum",
    cat: "sysd",
    title: "Quorum Reads/Writes",
    one: "Requiring a majority of replicas to agree before confirming a read or write.",
    why: "N replicas, no coordinator: how do you stay consistent while staying available? Quorums are the arithmetic answer — require majorities, and any read quorum must overlap any write quorum, so reads can't miss the latest write. Consistency becomes a dial (R + W > N) instead of a binary.",
    how: "Write to W replicas before acknowledging; read from R replicas and take the newest version. With R + W > N, read and write quorums always intersect, so a read sees at least one replica with the latest value. Strong: R=W=quorum of N=3 (2+2>3). Tunable: W=1, R=1 gives availability + eventual consistency; W=N, R=1 gives read-your-writes cheaply.",
    when: "Quorum mode for data where staleness is a bug (inventory, coordination metadata, user auth data). Eventual mode (quorum writes only, R=1) for throughput-heavy data tolerant of stale reads (feeds, analytics). Latency note: quorum reads/writes wait for the slowest-of-majority replica — p99 grows with replica spread.",
    ref: "Martin Kleppmann — Designing Data-Intensive Applications",
    subtopics: [
      { name: "The intersection rule", detail: "R + W > N guarantees overlap: every read quorum contains a replica that saw the write quorum. R + W ≤ N trades consistency for concurrency — your explicit choice, per table/operation." },
      { name: "Tuning N, R, W", detail: "N=3, R=2, W=2: balanced (tolerates 1 node failure both ways). N=5, R=2, W=2: higher availability, weaker consistency. W=N: writes need all nodes (robust reads, fragile writes). The numbers ARE the contract." },
      { name: "Newest-wins reads", detail: "Read quorum returns R versions; resolve by version/vector-clock/timestamp. With sloppy clocks, prefer version numbers assigned at write time — timestamp resolution across nodes is a skew trap." },
      { name: "Sloppy quorums & hinted handoff", detail: "During failures, 'sloppy' quorums accept writes on ANY healthy nodes (outside preferred set) with hints to transfer later — availability preserved, consistency weakened temporarily. Dynamo's signature trick." },
    ],
    code: `// Quorum arithmetic made runnable: N=3, tunable R and W
const N = 3;
const replicas = [r1, r2, r3]; // storage nodes, each: { data: Map, version: Map }

function quorum(x) { return Math.floor(N / 2) + 1; }

async function put(key, value, { W = quorum() } = {}) {
  const version = nextVersion(key); // monotonic per key — NOT a wall clock
  const acks = await Promise.all(replicas.map(async (r) => {
    try { return (await r.write(key, { value, version })).ok; } catch { return false; }
  }));
  if (acks.filter(Boolean).length >= W) return { ok: true, version };
  throw new Error("write quorum not reached"); // CP-style refusal
}

async function get(key, { R = quorum() } = {}) {
  const answers = (await Promise.all(replicas.map(async (r) => {
    try { return await r.read(key); } catch { return null; }
  }))).filter(Boolean);

  if (answers.length < R) throw new Error("read quorum not reached");

  // newest version wins — quorum overlap guarantees at least one replica has it
  const newest = answers.reduce((a, b) => (b.version > a.version ? b : a));
  // async repair: push the newest back to lagging replicas (read repair)
  answers.filter((a) => a.version < newest.version).forEach((a) => a.repair(newest));
  return newest.value;
}

// The dial in action:
// get(k, { R: 3 }) + put(k, { W: 3 }) -> strongest, slowest
// get(k, { R: 1 }) + put(k, { W: 1 }) -> fastest, eventual (R+W=2 <= N=3: overlap not guaranteed)`,
    steps: ["Write sent to all replicas", "Wait for majority ack", "Quorum reached", "Write confirmed"],
  },
  {
    id: "sysd-bloomfilter",
    cat: "sysd",
    title: "Bloom Filters",
    one: "A space-efficient structure that quickly tells you if an item is definitely not in a set.",
    why: "'Have I seen this URL before?' over a billion items: a hash set costs GBs; a Bloom filter answers the same question in a few bits per item — with one catch. It can say 'maybe present' (false positive) but NEVER 'not present' wrongly. That asymmetry is exactly what most filtering problems want.",
    how: "A bit array + k hash functions. Insert: set k bits (at the k hashes of the item). Query: if ANY of the k bits is 0 → definitely absent; if all set → probably present (false positive rate tunable via size and k: ~1% at ~10 bits/item). No deletion (bits are shared) — counting Bloom filters or cuckoo filters extend it.",
    when: "The 'avoid expensive lookups for absent items' pattern: DB query avoidance (Cassandra/LSM engines check bloom before reading SSTables), cache pass-through protection (don't hit Redis/DB for keys never stored), crawler seen-URL sets, spell checkers, malicious-URL pre-checks. Anywhere absent-lookups outnumber present ones.",
    ref: "Martin Kleppmann — Designing Data-Intensive Applications",
    subtopics: [
      { name: "The asymmetry is the feature", detail: "False positives are cheap (fall through to the real check); false negatives are impossible. Design filters where 'maybe' costs one lookup and 'definitely not' saves millions." },
      { name: "Sizing & false positive rate", detail: "Given expected n and target p: m = -n·ln(p)/(ln2)² bits, k = (m/n)·ln2. 1% needs ~9.6 bits/item (~1.2 bytes): a billion items in ~1.2GB. Under-size the array and the FP rate explodes exponentially." },
      { name: "No deletion", detail: "Clearing one item's bits would clear shared bits of others. Workarounds: counting Bloom (counters instead of bits, 4x memory), cuckoo filters (deletable, comparable performance), or rebuild periodically." },
      { name: "Scalable variants", detail: "Fixed-size filters overflow (FP rate climbs). Scalable Bloom chains generations of filters with tightening error budgets; RedisBloom offers server-side BF.ADD/BF.EXISTS with auto-scaling." },
    ],
    code: `// A Bloom filter in 30 lines — sized for a target false-positive rate
class BloomFilter {
  constructor(expectedItems, targetFp = 0.01) {
    // optimal sizing math: m bits, k hashes
    const m = Math.ceil(-expectedItems * Math.log(targetFp) / (Math.LN2 ** 2));
    const k = Math.max(1, Math.round((m / expectedItems) * Math.LN2));
    this.bits = new Uint8Array(Math.ceil(m / 8));
    this.k = k;
    this.m = m;
  }

  hashes(item) {
    // double hashing: k probes from 2 hash values (Kirsch-Mitzenmacher)
    const h1 = hash32(String(item), 0x9747b28c);
    const h2 = hash32(String(item), 0xcc9e2d51);
    return Array.from({ length: this.k }, (_, i) => (h1 + i * h2) % this.m);
  }

  add(item) { for (const pos of this.hashes(item)) this.bits[pos >> 3] |= 1 << (pos & 7); }

  mightContain(item) {
    return this.hashes(item).every((pos) => this.bits[pos >> 3] & (1 << (pos & 7)));
    // false: DEFINITELY absent (no false negatives)
    // true:  probably present (rate = targetFp) -> confirm with the real lookup
  }
}

// The killer use: protect the database from lookups that can never succeed
const seenUrls = new BloomFilter(100_000_000, 0.01); // ~120MB for 100M URLs

async function crawl(url) {
  if (!seenUrls.mightContain(url)) {
    await crawlFresh(url);          // 99% of requests: DB/cache never touched
    seenUrls.add(url);
  } else if (await db.urls.exists(url)) {
    return; // false positive (1%): confirmed present — one real lookup paid
  }
}

// Cache-pass protection: never hit Redis/DB for keys that were never written
if (!membershipFilter.mightContain(key)) return res.status(404).json({ error: "not found" });`,
    steps: ["Item hashed to bit positions", "Bits set in filter", "Query checks those bits", "All set → maybe present; any unset → definitely absent"],
  },
  {
    id: "sysd-notificationsystem",
    cat: "sysd",
    title: "Designing a Notification System",
    one: "Fanning a single event out to email, push, and SMS channels reliably.",
    why: "One 'payment failed' event must reach email, mobile push, SMS, and in-app — each with its own provider, rate limits, failure modes, and user preferences. Naive inline calls make the checkout request hostage to SendGrid's uptime. A notification system decouples events from channels with fan-out, retries, and preference enforcement.",
    how: "Event arrives on a queue → template + preference resolution (which channels does this user want for this category?) → per-channel dispatch jobs with provider adapters → delivery attempts with backoff, provider failover (SES→SendGrid), and status tracking (sent/delivered/bounced) → dedupe and rate limiting per user across channels.",
    when: "Any product sending more than trivial notifications. The reliability patterns transfer everywhere: queue-based fan-out, provider abstraction, user preference gating, and delivery-status reconciliation. In-app notifications add a read path (badge counts, feed) sharing the same stored records.",
    ref: "System Design Primer (GitHub)",
    subtopics: [
      { name: "Channel fan-out", detail: "One event → parallel per-channel jobs: email, push, SMS, in-app. Channels fail independently; a SendGrid outage delays email while push still lands. The queue is the blast-radius boundary." },
      { name: "Preferences & quiet hours", detail: "Users opt out per category × channel; security alerts bypass, marketing doesn't. Check preferences BEFORE spend — SMS costs money and unwanted SMS costs users." },
      { name: "Provider failover", detail: "Abstract 'send email' behind adapters with health tracking: primary fails 3x → circuit-break to backup (SES ↔ SendGrid). Providers WILL have outages; your design decides if users notice." },
      { name: "Dedupe & rate limits", detail: "The same event retried by two workers must not double-send: dedupe key = event + channel + user. Per-user rate caps (5 pushes/hour) prevent your retry storm from becoming their phone's nightmare." },
    ],
    code: `// Event -> fan-out -> channel workers with failover + preferences
notificationQueue.process("notify", async (job) => {
  const { event } = job.data; // { type: "payment_failed", userId, data }

  // 1. preferences BEFORE spend: category x channel matrix
  const prefs = await preferences.for(event.userId);
  const channels = ["email", "push", "sms"].filter((ch) => allows(prefs, event.type, ch));

  await Promise.all(channels.map((ch) => dispatchQueue.add("send:" + ch, { event }, { attempts: 5, backoff: { type: "exponential", delay: 5000 } })));
});

// Per-channel worker: adapter + failover + dedupe
emailWorker.on("active", async (job) => {
  const { event } = job.data;
  const dedupeKey = event.id + ":email";

  if (!(await redis.set(dedupeKey, "1", { NX: true, EX: 86400 }))) return; // already sent

  const body = await templates.render(event.type, event.data);
  const user = await users.contact(event.userId);

  // failover ladder: primary -> backup -> dead letter
  try {
    await withBreaker("ses", () => ses.sendEmail({ to: user.email, subject: body.subject, html: body.html }));
  } catch (err) {
    logger.warn("primary provider failed, failover", { error: err.message });
    await sendgrid.send({ to: user.email, subject: body.subject, html: body.html });
  }

  await db.notifications.insert({ userId: event.userId, channel: "email", type: event.type, sentAt: new Date() });
});

// Quiet hours gate: the check that saves user trust (and SMS budget)
function allows(prefs, category, channel) {
  if (!prefs[category]?.[channel]) return false;
  if (channel === "sms" && category !== "security" && isQuietHour(prefs.timezone)) return false;
  return true;
}`,
    steps: ["Event triggers notification", "Fanned out to channels", "Email / push / SMS sent in parallel", "Delivery status tracked"],
  },
  {
    id: "sysd-distfilestorage",
    cat: "sysd",
    title: "Designing Distributed File Storage",
    one: "Chunking, replication, and metadata lookup, like GFS or S3 internally.",
    why: "Files that exceed any single disk, buckets that outgrow any single machine, durability beyond any single datacenter — distributed file storage solves all three with one pattern: split files into chunks, replicate chunks across nodes, and let a metadata layer tell clients where everything lives.",
    how: "Files split into fixed chunks (64-256MB); each chunk replicated (3x) across nodes/racks; a metadata service (name node / index) maps file → chunk list → chunk locations, while chunk servers hold the data. Reads: metadata lookup then stream direct from chunk servers (data never flows through metadata). Writes: write to all replicas (primary-chunk coordination), versioned for consistency.",
    when: "The internals behind S3/GFS are the interview target, but the pattern shows up whenever you build storage: media pipelines (chunk + parallel upload), backup systems, log storage, data lakes. Most products should USE object storage — understanding it is what lets you design around its limits (no appends, no locks, eventual listing).",
    ref: "Google File System Paper (Ghemawat et al.)",
    subtopics: [
      { name: "Chunking", detail: "Fixed-size chunks enable parallel I/O (upload 8 chunks concurrently), uniform storage management, and dedup granularity. Random-access reads map offset → chunk index + intra-chunk offset with trivial math." },
      { name: "Replication & placement", detail: "3 copies: same rack survives disk death, cross-rack survives rack failure, cross-region survives region loss. Placement spreads replicas so failures are uncorrelated — that's the durability math (11 nines ≈ 3 copies)." },
      { name: "Metadata separation", detail: "The metadata service knows file→chunks→locations (fits in RAM: ~100 bytes per chunk) and is the consistency bottleneck; DATA flows client↔chunk-server directly. Control plane small, data plane huge — the GFS insight." },
      { name: "Consistency model", detail: "GFS: primary replica orders mutations, clients may see stale regions (at-least-once appends, duplicated records). S3: read-after-write per object, no appends, list eventually consistent (now strongly). Know which model you're designing to." },
    ],
    code: `// Chunked, replicated storage — the GFS shape in miniature
const CHUNK_SIZE = 64 * 1024 * 1024; // 64MB

// WRITE: split -> replicate -> index
async function putFile(fileId, buffer) {
  const chunks = splitInto(buffer, CHUNK_SIZE);
  const manifest = [];

  await Promise.all(chunks.map(async (chunk, i) => {
    const chunkId = fileId + ":" + i;
    // placement: spread replicas across failure domains
    const locations = placementServer.pick(3, { distinctRacks: true });
    await Promise.all(locations.map((node) => node.store(chunkId, chunk)));
    manifest.push({ chunkId, index: i, locations: locations.map((n) => n.id), checksum: crc32(chunk) });
  }));

  await metadata.put(fileId, { chunks: manifest, size: buffer.length, version: Date.now() });
}

// READ: metadata lookup -> stream direct from chunk servers (parallel)
async function getFile(fileId, res) {
  const { chunks } = await metadata.get(fileId); // small: the only metadata hop
  res.set("Content-Length", chunks.reduce((s, c) => s + c.size, 0));

  for (const entry of chunks) {                  // stream chunk by chunk
    const node = entry.locations.map((id) => chunkServers[id]).find((n) => n.healthy);
    const data = await node.read(entry.chunkId);
    if (crc32(data) !== entry.checksum) {
      // corruption: read from another replica, report the bad copy
      const alt = entry.locations.filter((id) => id !== node.id).map((id) => chunkServers[id]).find((n) => n.healthy);
      res.write(await alt.read(entry.chunkId));
      continue;
    }
    res.write(data);
  }
  res.end();
}`,
    steps: ["File split into chunks", "Chunks replicated across nodes", "Metadata server tracks locations", "Client assembles chunks on read"],
  },
  {
    id: "sysd-ratelimitercluster",
    cat: "sysd",
    title: "Designing an API Rate Limiter Cluster",
    one: "Coordinating rate limits across many server instances consistently.",
    why: "A limit of 100 req/min enforced per-instance becomes 800 req/min with 8 instances — each one counts its own requests. The design question is where the shared count lives, how fast it can be checked, and what happens when the shared store itself is unavailable.",
    how: "Shared counter store (Redis) checked atomically by every instance: Lua scripts make INCR+EXPIRE or token-bucket updates one round trip. Optimize the hot path with local batching/leases (instance grabs 100 tokens at once, serves locally, refills when drained — 1/100th the Redis load). Failure mode: Redis down → fail open (allow, alarm) or fail closed (deny, protect) by policy.",
    when: "Every cluster enforcing real limits. The local-lease optimization matters above ~1k rps (Redis becomes the bottleneck you built); strict counting (billing meters) skips leases and pays the Redis tax per request. Multi-region: per-region limits with a global backstop, not global synchronous counting.",
    ref: "Stripe Engineering Blog",
    subtopics: [
      { name: "Shared store, atomic ops", detail: "Redis Lua: read-count-decide-write as ONE atomic operation — no races between instances. INCR + EXPIRE races (counter without TTL if crash between) die inside the script." },
      { name: "Token leases (batching)", detail: "Instance withdraws a chunk (50-100 tokens) per Redis call, serves locally, returns unused on shutdown. Redis load drops 50-100x; limit accuracy drops to lease granularity — perfect for most APIs, wrong for billing." },
      { name: "Fail-open vs fail-closed", detail: "Redis unavailable: fail-open protects availability (limits suspended, alarm fires, abuse risk accepted) or fail-closed protects the backend (all requests 503). Login throttlers fail closed; public APIs usually fail open." },
      { name: "Hot client problems", detail: "One client at 50k rps turns its counter key into a Redis hotspot. Shard the counter (key0..key9, pick by request hash, sum for reads) or route that client's checks to a replica with lag tolerance." },
    ],
    code: `// Cluster-wide token bucket with local leases — the production shape
const TAKE_LEASE = \`
  local key = KEYS[1]
  local capacity, refill, now, amount = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
  local tokens = tonumber(redis.call("HGET", key, "t") or capacity)
  local last = tonumber(redis.call("HGET", key, "ts") or now)
  tokens = math.min(capacity, tokens + (now - last) * refill)
  local granted = math.min(tokens, amount)
  redis.call("HSET", key, "t", tokens - granted, "ts", now)
  redis.call("EXPIRE", key, 3600)
  return granted
\`;

class ClusterRateLimiter {
  constructor({ capacity = 1000, refillPerSec = 100, leaseSize = 100 }) {
    Object.assign(this, { capacity, refillPerSec, leaseSize });
    this.local = 0;
  }

  // hot path: NO Redis call — serve from the local lease
  allow() {
    if (this.local >= 1) { this.local -= 1; return true; }
    return false; // lease empty -> async refill
  }

  async refillLease() {
    const granted = await redis.eval(TAKE_LEASE, 1,
      "rl:" + instanceId, // per-instance lease account fed by the shared bucket
      this.capacity, this.refillPerSec, Math.floor(Date.now() / 1000), this.leaseSize);
    this.local += granted;
    if (granted === 0) this.starved = true; // policy: fail-open during starvation, alarm
  }
}

setInterval(() => limiter.refillLease().catch(() => { limiter.failOpen = true; }), 1000);

// Middleware: microsecond decisions, cluster-consistent within lease granularity
app.use((req, res, next) => {
  if (!limiter.allow() && limiter.failOpen) return next(); // Redis down: degrade gracefully
  if (!limiter.allow()) {
    res.set("Retry-After", "1");
    return res.status(429).json({ error: { code: "rate_limited" } });
  }
  next();
});`,
    steps: ["Requests hit multiple servers", "Shared counter store", "Servers check shared state", "Limit enforced consistently cluster-wide"],
  },
  {
    id: "sysd-consistencymodels",
    cat: "sysd",
    title: "Eventual vs Strong Consistency",
    one: "Trading immediate agreement across replicas for availability, or vice versa.",
    why: "Replicated data forces the question: must every read reflect every previous write, everywhere, immediately? Strong consistency is simple to reason about but costs latency and availability; eventual consistency is fast and available but lets reads disagree until convergence. The model choice per data type is a core design decision.",
    how: "Strong: reads served only from the leader/quorum that has all writes (R+W>N, linearizable reads) — every read sees the latest write, paying commit latency. Eventual: any replica serves reads; writes propagate async; replicas converge with last-write-wins or merge functions — fast and available, stale by seconds. Middle ground: bounded staleness (max 5s old), session consistency (read-your-writes within a session).",
    when: "Strong for: account balances, inventory, auth/permissions, anything where acting on stale data costs money or security. Eventual for: feeds, view counts, recommendations, catalogs — where 'a few seconds old' is invisible. Session consistency is the pragmatic default for user-facing apps: users must see THEIR writes; others' staleness is fine.",
    ref: "Martin Kleppmann — Designing Data-Intensive Applications",
    subtopics: [
      { name: "Linearizability", detail: "Strongest single-object model: every operation appears atomically at some instant between its start and end. Reads pay leader/quorum latency; during partitions, reads fail (CAP's CP side)." },
      { name: "Eventual convergence", detail: "All replicas reach the same value IF writes stop — the fine print matters: convergence via LWW timestamps (silent loss), CRDT merge (lossless), or app reconciliation. Know your merge function." },
      { name: "Session guarantees", detail: "Read-your-writes (your writes visible to you), monotonic reads (no time travel backward), consistent prefix. Cheap to implement via session→replica pinning or version checks — the 90% fix for eventual-consistency UX bugs." },
      { name: "The UX cost of staleness", detail: "'I saved it and it disappeared' is eventual consistency reaching the user. Map data types to models: cart = session-consistent, feed = eventual, balance = strong. Mixed per type, never global." },
    ],
    code: `// One API, three consistency levels — chosen per data type
class ConsistentStore {
  // STRONG: quorum read — always sees the latest committed write
  async getBalance(accountId) {
    const { rows } = await pool.query("SELECT balance_cents FROM accounts WHERE id = $1", [accountId]);
    return rows[0]; // single primary: linearizable by construction
  }

  // SESSION: read-your-writes — pin the user's reads to where they wrote
  async getCart(session) {
    if (session.wroteAt && Date.now() - session.wroteAt < 5000) {
      return primary.query("SELECT * FROM carts WHERE user_id = $1", [session.userId]); // sticky to primary
    }
    return replica.query("SELECT * FROM carts WHERE user_id = $1", [session.userId]); // stale ok otherwise
  }

  // EVENTUAL: any replica, converge later — fast and fine for view counts
  async getViewCount(videoId) {
    const { rows } = await replica.query("SELECT views FROM video_stats WHERE id = $1", [videoId]);
    return rows[0].views;
  }
}

// Writes stamp the session for read-your-writes routing
async function addToCart(session, sku) {
  await primary.query("INSERT INTO cart_items ...", [session.userId, sku]);
  session.wroteAt = Date.now(); // the next 5s of this user's reads hit the primary
}

// Bounded staleness: refuse to serve data older than the budget
async function getOrderWithBudget(orderId, maxStaleMs = 5000) {
  const local = await replica.query("SELECT *, updated_at FROM orders WHERE id = $1", [orderId]);
  if (Date.now() - local.rows[0].updated_at.getTime() <= maxStaleMs) return local.rows[0];
  return (await primary.query("SELECT * FROM orders WHERE id = $1", [orderId])).rows[0]; // too stale: escalate
}`,
    steps: ["Write to one node", "Strong: wait for all replicas", "Eventual: return immediately", "Replicas converge later"],
  },
  {
    id: "sysd-deliveryguarantees",
    cat: "sysd",
    title: "Message Delivery Guarantees",
    one: "At-most-once, at-least-once, and exactly-once each trade off duplication vs loss.",
    why: "Every queue, RPC, and event system makes a delivery promise — and the three promise levels have radically different failure modes. Choosing without understanding them means lost payments (at-most-once, silently) or duplicate charges (at-least-once, naively). 'Exactly-once' is the most misunderstood phrase in distributed systems.",
    how: "At-most-once: fire and forget, no retries — fast, loses messages on any failure. At-least-once: retry until ACKed — nothing lost, duplicates guaranteed; consumers dedupe (idempotency keys, processed-message tables). Exactly-once: achieved only as at-least-once delivery + exactly-once PROCESSING (transactional dedupe of effect, or transactional outbox + idempotent consumer) — a system property, not a transport feature.",
    when: "At-most-once: metrics, presence, anything where newest-wins and loss is harmless. At-least-once + idempotent consumers: the default for 95% of systems (orders, emails, webhooks). True exactly-once processing: payments and ledgers — built with idempotency keys over at-least-once transport, not bought from the broker's marketing page.",
    ref: "Apache Kafka Documentation",
    subtopics: [
      { name: "At-most-once", detail: "Send once, never retry: a dropped network packet deletes the message from history. Right for telemetry and ephemeral state; catastrophic anywhere money is involved." },
      { name: "At-least-once + dedupe", detail: "The workhorse: ACK-after-processing, redeliver-on-timeout. Duplicates are CERTAIN under retries — every consumer gets a processed-messages table or natural idempotency, without exception." },
      { name: "Exactly-once processing", detail: "Not a delivery mode: it's at-least-once delivery + exactly-once EFFECTS (dedupe key + business write in one transaction, or Kafka transactions for consume-transform-produce loops). Costs throughput and complexity — pay it only where duplication is genuinely unacceptable." },
      { name: "Kafka specifics", detail: "enable.idempotence kills broker-side duplicates per producer; transactions span consume-produce atomically; consumer offsets commit AFTER processing (crash = redelivery = at-least-once + your dedupe). Read_committed consumers see only transactional results." },
    ],
    code: `// The three levels, and how exactly-once is actually built
// AT-MOST-ONCE: fine for metrics, fatal for money
socket.send(JSON.stringify(event)); // dropped? gone forever. acceptable: it's a view count.

// AT-LEAST-ONCE: retry until acked — duplicates WILL arrive
async function deliverAtLeastOnce(message) {
  for (;;) {
    try {
      await consumer.process(message);
      await consumer.ack(message); // ack AFTER processing: crash before ack = redelivery
      return;
    } catch { await sleep(backoff()); }
  }
}

// EXACTLY-ONCE PROCESSING = at-least-once delivery + deduped effects (one transaction)
async function processExactlyOnce(message) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // 1. atomic claim: have we applied this message's effect already?
    const claim = await client.query(
      "INSERT INTO processed_effects (consumer, message_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1",
      ["payments", message.id]
    );
    if (claim.rowCount) {
      await chargeCard(message);                    // 2. the side effect, applied at most once
      await client.query("UPDATE orders SET status = 'paid' WHERE id = $1", [message.orderId]);
    }
    await client.query("COMMIT");                    // claim + effect commit atomically
    await consumer.ack(message);
  } catch (e) {
    await client.query("ROLLBACK");                  // claim released: redelivery will retry cleanly
    await consumer.nack(message);
  }
}`,
    steps: ["Message sent", "At-most-once: may be lost", "At-least-once: may duplicate", "Exactly-once: neither, at higher cost"],
  },
  {
    id: "sysd-paymentsystem",
    cat: "sysd",
    title: "Designing a Payment System",
    one: "Idempotency, ledgers, and reconciliation to move money safely.",
    why: "Payments are the domain where 'eventually consistent' and 'usually correct' are disqualifying: money must never be created, destroyed, or duplicated, even across crashes, retries, and provider outages. The design patterns here — idempotency, double-entry ledgers, reconciliation — are the difference between a product and a liability.",
    how: "Idempotency keys on every operation (client retries are certain). A double-entry LEDGER as the source of truth: every movement is a balanced pair of entries (debit wallet, credit processor); balances are derived, never stored-and-mutated. State machines for payment status (pending → authorized → captured → settled, with explicit failure arcs). Reconciliation jobs diff your ledger against provider reports daily — divergence is investigated, never auto-healed.",
    when: "Any system touching money. The audit trail requirements also make it the canonical domain for event sourcing. The non-negotiables apply even at small scale: one duplicated $5 charge destroys more trust than a week of downtime.",
    ref: "Stripe Engineering Blog",
    subtopics: [
      { name: "Idempotency everywhere", detail: "Client keys on payment creation, provider refs on every call (Stripe idempotency keys), consumer dedupe on webhooks. The rule: every operation must be safely retryable, because in payments everything IS retried." },
      { name: "Double-entry ledger", detail: "Every movement = balanced entries across accounts (user: -1000, processor: +1000). Sum is always zero; balances are queries over entries; history is immutable. This is what makes 'where did the money go' answerable forever." },
      { name: "Payment state machine", detail: "Pending → authorized → captured → settled, with failed/refunded arcs — transitions validated, persisted with the attempt, and idempotent. 'What state is this payment in?' must never depend on guessing from side effects." },
      { name: "Reconciliation", detail: "Daily: provider settlement report vs your ledger — every charge, refund, fee, and payout matched. Mismatches become investigation tickets. Reconciliation is how you find the bug BEFORE the auditor does." },
    ],
    code: `// The money-moving core: idempotent charge into a double-entry ledger
async function charge({ idempotencyKey, userId, amountCents, method }) {
  if (!idempotencyKey) throw new Error("idempotency key required");
  if (amountCents <= 0) throw new Error("invalid amount");

  return db.transaction(async (tx) => {
    // 1. idempotent claim (one row per key, unique index)
    const claim = await tx.query(
      "INSERT INTO payment_intents (key, user_id, amount_cents, status) VALUES ($1,$2,$3,'pending') ON CONFLICT (key) DO NOTHING RETURNING id",
      [idempotencyKey, userId, amountCents]
    );
    if (!claim.rows.length) {
      const existing = await tx.query("SELECT * FROM payment_intents WHERE key = $1", [idempotencyKey]);
      return existing.rows[0]; // replay: return the ORIGINAL payment, charge nothing
    }
    const intentId = claim.rows[0].id;

    // 2. call the provider (safe: this tx retries, provider call is keyed too)
    const providerResult = await stripe.charges.create({
      amount: amountCents, currency: "usd", customer: method.providerRef,
    }, { idempotencyKey }); // provider-side dedupe: the belt AND suspenders

    // 3. DOUBLE-ENTRY: the movement as balanced entries — the source of truth
    await tx.query(\`INSERT INTO ledger_entries (intent_id, account, amount_cents) VALUES
      ($1, 'user:' || $2, $3),
      ($1, 'processor:stripe', $4)\`,
      [intentId, userId, -amountCents, amountCents]);

    await tx.query("UPDATE payment_intents SET status = 'captured', provider_ref = $1 WHERE id = $2",
      [providerResult.id, intentId]);
    return { id: intentId, status: "captured" };
  });
}

// The ledger invariant, checked continuously: sum of all entries is ZERO
// SELECT sum(amount_cents) FROM ledger_entries;  -- must always be 0. Alarm if not.

// Daily reconciliation: provider truth vs your ledger
async function reconcile() {
  const report = await stripe.balanceTransactions.list({ created: { gte: yesterday } });
  const ours = await db.query("SELECT provider_ref, amount_cents FROM ledger_entries WHERE account = 'processor:stripe' AND created_at > yesterday");
  const diffs = diffBy(report.data, ours.rows, "provider_ref");
  for (const d of diffs) await investigations.create({ type: "reconciliation_mismatch", detail: d }); // humans, never auto-fix
}`,
    steps: ["Payment initiated", "Idempotency key prevents duplicates", "Ledger entry recorded", "Reconciled against provider"],
  },
  {
    id: "sysd-capacityestimation",
    cat: "sysd",
    title: "Capacity Estimation",
    one: "Rough back-of-envelope math on QPS, storage, and bandwidth before building a system.",
    why: "The 15 minutes of arithmetic before design decides scale decisions you can't unmake: whether a single Postgres suffices or you need sharding, whether reads fit in memory or need a cache tier. Interviewers test it; production teams skip it and rediscover it as an outage.",
    how: "From product numbers to resource numbers: users → DAU → actions/user/day → QPS (daily actions / 86400s, peak = 2-3x average) → per-request resource cost → storage growth (bytes × write rate × retention) → bandwidth (QPS × response size). Keep powers-of-ten handy and sanity-check every claim.",
    when: "Before designing anything with scale ambitions, before every launch, and during incident post-mortems ('we estimated 10k QPS, reality 40k'). The deliverable is a short table: read/write QPS, storage/year, bandwidth, memory for hot set — each traced to an assumption you can revisit.",
    ref: "System Design Primer (GitHub)",
    subtopics: [
      { name: "QPS from users", detail: "100M users × 20% DAU × 10 reads/day = 200M reads/day ≈ 2.3k QPS average, ~7k peak (3x rule). Writes are typically 1-10% of reads — the read:write ratio shapes the whole architecture." },
      { name: "Storage growth", detail: "Writes/day × avg row size × 365: 50M posts/day × 1KB = 50GB/day ≈ 18TB/year — raw. Add 3x replication and 2x indexes and the 'small' dataset is 100TB/year. Retention policy is part of the storage answer." },
      { name: "The hot set & memory", detail: "80/20 rule: cache the hot 20% of data. Working set = hot data size: 100TB total but 50GB hot → Redis at 64GB handles it. This number decides whether caching 'works' — not the total dataset size." },
      { name: "Bandwidth & NICs", detail: "QPS × response size = egress: 7k QPS × 50KB = 350MB/s ≈ 3Gbps. Compare to NIC/instance limits and CDN offload; egress $ often exceeds compute $ — the bill that surprises." },
    ],
    code: `// Back-of-envelope estimation, as code — the assumptions ARE the design
function estimate({ usersM, dauPct, readsPerUser, writesPerUser, rowBytes, respBytes, retentionYears }) {
  const dau = usersM * 1e6 * dauPct;
  const dailyReads = dau * readsPerUser;
  const dailyWrites = dau * writesPerUser;

  const avgQps = dailyReads / 86400;
  const peakQps = avgQps * 3;                     // the 2-3x peak rule
  const writeQps = (dailyWrites / 86400) * 3;

  const storagePerYear = dailyWrites * rowBytes * 365 * 3; // x3 replication
  const hotSet = storagePerYear * 0.05;                     // hot 5% fits in memory?
  const egressGbps = (peakQps * respBytes * 8) / 1e9;

  return {
    dau: format(dau),
    readQps: { avg: format(avgQps), peak: format(peakQps) },
    writeQps: format(writeQps),
    storagePerYear: bytes(storagePerYear),
    cacheNeeded: bytes(hotSet) + " -> " + (hotSet < 64e9 ? "one Redis node" : "Redis cluster"),
    egressAtPeak: egressGbps.toFixed(1) + " Gbps -> " + (egressGbps > 5 ? "CDN mandatory" : "origin OK"),
    verdict: peakQps < 10e3
      ? "single Postgres + read replicas + cache: fine"
      : peakQps < 100e3
        ? "cache tier + replicas + pooling: required"
        : "sharding + distributed everything: plan it now",
  };
}

console.log(estimate({ usersM: 100, dauPct: 0.2, readsPerUser: 10, writesPerUser: 0.5, rowBytes: 1024, respBytes: 50 * 1024, retentionYears: 5 }));
// { readQps: { avg: '23.1K', peak: '69.4K' }, storagePerYear: '27.4TB', verdict: 'cache tier + replicas + pooling' }`,
    steps: ["Estimate users & usage", "Derive QPS", "Estimate storage growth", "Size infrastructure accordingly"],
  },
  {
    id: "sysd-autocomplete",
    cat: "sysd",
    title: "Designing a Search Autocomplete",
    one: "Tries and ranked prefix matching for instant suggestions.",
    why: "Autocomplete must respond in <50ms because users type continuously — every keystroke is a query against the entire corpus. The design lives or dies on prefix data structures, top-k ranking, and client debouncing; naively hitting the database per keystroke fails all three.",
    how: "Build a trie (prefix tree) over terms with weighted nodes (frequency counts); prefix query = walk to the node, collect the top-k heaviest descendants (precomputed top-k per node makes reads O(k)). Refresh the trie periodically from a frequency pipeline (recent searches + corpus terms). Client side: debounce ~100-200ms, cache prefixes, cancel superseded requests.",
    when: "Any typeahead: search boxes, address bars, emoji pickers. Small scale: a sorted array + binary search for prefix ranges beats a trie on simplicity. Large scale: trie in memory (Redis sorted sets with ZRANGEBYLEX approximate this), or an engine (Elasticsearch completion suggester, Meili) once ranking gets fuzzy-match needs.",
    ref: "System Design Primer (GitHub)",
    subtopics: [
      { name: "Trie structure", detail: "Nodes per character; each node stores its subtree's top-k terms with weights. Query: walk the prefix, read the cached top-k — O(prefix + k) regardless of corpus size." },
      { name: "Ranking by frequency", detail: "Weight = smoothed popularity: global frequency × recency decay × user affinity (personalized: your history boosts your terms). Freshness matters — 'election' spikes in November must outrank its historical average." },
      { name: "Refresh pipeline", detail: "Queries stream to an aggregator; a job rebuilds trie deltas every N minutes/hours and hot-swaps. Dual-buffer pattern: build the new trie fully, swap the pointer atomically — readers never see a half-built tree." },
      { name: "Client-side craft", detail: "Debounce 150ms (users pause between words), abort superseded fetches (AbortController), cache the last prefix's results, and render stale-while-revalidate. The server can be perfect and the UX still feel broken without this." },
    ],
    code: `// Trie with precomputed top-k: O(prefix + k) queries at any scale
class TrieNode {
  constructor() { this.children = new Map(); this.topK = []; } // topK: [{term, weight}] sorted desc
}

class Autocomplete {
  constructor(k = 8) { this.root = new TrieNode(); this.k = k; }

  index(term, weight) {
    let node = this.root;
    for (const ch of term.toLowerCase()) {
      if (!node.children.has(ch)) node.children.set(ch, new TrieNode());
      node = node.children.get(ch);
    }
    node.isWord = term;
  }

  // rebuild top-k bottom-up: each node knows its subtree's heaviest completions
  finalize(node = this.root) {
    const all = [];
    if (node.isWord) all.push({ term: node.isWord, weight: weights(node.isWord) });
    for (const child of node.children.values()) all.push(...this.finalize(child));
    node.topK = all.sort((a, b) => b.weight - a.weight).slice(0, this.k);
    return node.topK;
  }

  suggest(prefix) {
    let node = this.root;
    for (const ch of prefix.toLowerCase()) {
      node = node.children.get(ch);
      if (!node) return []; // O(prefix) to miss
    }
    return node.topK.map((t) => t.term); // O(k): the answers are already here
  }
}

const ac = new Autocomplete();
["iphone 15", "iphone case", "iphone charger", "ice cream"].forEach((t) => ac.index(t));
ac.finalize();
console.log(ac.suggest("iph")); // ["iphone 15", "iphone case", "iphone charger"]

// Client side: the half that makes it FEEL instant
let controller;
input.addEventListener("input", debounce(async (e) => {
  controller?.abort();
  controller = new AbortController();
  const res = await fetch("/suggest?q=" + encodeURIComponent(e.target.value), { signal: controller.signal });
  render(await res.json());
}, 150));`,
    steps: ["User types prefix", "Trie traversed", "Matching completions ranked", "Top suggestions returned instantly"],
  },
  {
    id: "sysd-tradeoffs",
    cat: "sysd",
    title: "Trade-off Analysis in System Design",
    one: "Every design decision trades one quality — speed, cost, simplicity — against another.",
    why: "There are no solutions in system design, only trade-offs — and immature designs are usually trade-offs nobody named. Making them explicit ('we accept eventual consistency HERE to gain THIS availability') is what separates defensible architecture from fashionable architecture.",
    how: "For each decision: name the options, the axis they trade on (latency/cost/complexity/consistency/operability), the constraint that dominates (real traffic, team size, compliance), and the reversal condition ('if p99 > 500ms, revisit'). Write it down — the doc is the design; the diagram is just its summary.",
    when: "Every significant choice: database selection, consistency model, sync vs async, monolith vs services, build vs buy. The habit that compounds: a one-page decision record per choice (context, options, trade, reversal condition) — in two years it's the only thing that explains why the system is the way it is.",
    ref: "Google SRE Book",
    subtopics: [
      { name: "Name the axis", detail: "Every trade moves along named axes: latency vs throughput, consistency vs availability, cost vs performance, simplicity vs flexibility, build vs buy. If you can't name what you're giving up, you haven't decided anything." },
      { name: "Constraints decide", detail: "The right answer is a function of YOUR numbers: team of 3 → monolith; 200ms p95 SLA → cache tiers; compliance → on-prem. Copying Netflix's design with none of Netflix's problems is cargo-culting." },
      { name: "Complexity is a cost", detail: "Every moving part is paid forever: to run, monitor, debug, and explain to new engineers. The burden of proof belongs to the added complexity, not the boring choice — boring is usually winning." },
      { name: "Reversibility & decision records", detail: "Prefer reversible decisions when stakes are unclear (library, queue choice) and spend real analysis on irreversible ones (data model, partition key). Record each: context, options, trade, reversal condition — future-you inherits the reasoning, not just the result." },
    ],
    code: `// Decision record: the trade-off made explicit and reviewable
const decision = {
  id: "ADR-014",
  title: "Feed delivery: fan-out on write vs on read",
  date: "2026-09-13",
  status: "accepted",
  context: {
    traffic: "12k read QPS peak, 800 write QPS",
    followerDistribution: "p99 = 120 followers; top 0.01% have 1M+",
    team: "8 engineers, 2 on infra rotation",
  },
  options: [
    { name: "Fan-out on write", pros: ["O(1) reads — trivially fast feeds"], cons: ["celebrity posts = 1M+ writes", "write pipeline complexity"] },
    { name: "Fan-out on read", pros: ["simple writes", "no fan-out pipeline"], cons: ["12k QPS × merge cost", "read latency p95 blows SLO"] },
  ],
  tradeoff: {
    gaining: "p95 read latency < 80ms at 12k QPS (SLO)",
    paying: "a fan-out worker pipeline + hybrid routing complexity (~2 engineer-weeks build, permanent ops)",
    accepting: "celebrity feeds merge at read time: up to 200ms for users following whales",
  },
  reversalCondition: "If p95 > 150ms sustained for a week, or fan-out queue depth alarms weekly — revisit (option: read-model cache).",
};
// The doc IS the architecture. The diagram is just its shadow.

// The general analysis frame, applied mechanically:
function analyze(options, weights) {
  return options
    .map((o) => ({
      name: o.name,
      score: Object.entries(weights).reduce((s, [axis, w]) => s + w * (o.scores[axis] ?? 3), 0),
      givesUp: o.cons,
    }))
    .sort((a, b) => b.score - a.score);
}
// scores: latency/1-5, ops-burden/1-5, cost/1-5 per option — the weights are YOUR constraints`,
    steps: ["Requirement identified", "Options compared", "Trade-offs weighed", "Decision made & documented"],
  },
];