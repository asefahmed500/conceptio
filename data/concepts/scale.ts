import type { Concept } from "../types";

export const SCALE: Concept[] = [
  {
    id: "scale-horizontal",
    cat: "scale",
    title: "Horizontal Scaling",
    one: "Adding more machines instead of making one machine bigger.",
    why: "Every machine has a ceiling, and the ones above 32 cores cost exponentially more per core. Horizontal scaling removes the ceiling: capacity becomes a count of commodity nodes — and the count is a config value, not a hardware purchase.",
    how: "A load balancer sits in front of N identical stateless instances; traffic spreads across them, and adding capacity means adding instances (manually or via autoscaling). The prerequisite is statelessness: sessions, files, and caches move to shared stores (Redis, S3) so any instance can serve any request.",
    when: "The default scaling direction for web workloads. Use it once vertical headroom is exhausted or availability demands (one node dying must not be an outage) — which in practice means design stateless from day one so horizontal is always available to you.",
    ref: "AWS Documentation",
    subtopics: [
      { name: "Statelessness first", detail: "The enabling contract: no request-scoped state in process memory or local disk. Sessions to Redis, uploads to object storage, caches shared. Stateless = infinitely clonable." },
      { name: "Load balancer as front door", detail: "One stable entry point hides the pool: health-checked targets, rolling deploys, and capacity changes invisible to clients. Sticky sessions are the escape hatch for stateful legacy." },
      { name: "Shared data tier", detail: "Scaling app instances shifts the bottleneck to the database — the shared state that remains. Plan for read replicas, caching, and connection pooling as part of the same journey." },
      { name: "The cost curve", detail: "Horizontal wins on ceiling, availability, and price/performance at scale; vertical wins on simplicity below that. The crossover is usually one or two machines." },
    ],
    code: `// The stateless app: identical instances, no local state
const app = express();
app.use(sessionStore({ client: redis }));      // sessions: shared, not memory
app.use("/uploads", proxyToS3());              // files: object storage, not disk

// Every instance is interchangeable
const PORT = process.env.PORT ?? 3000;
const server = app.listen(PORT, () => console.log("instance ready :" + PORT));

// Graceful drain: SIGTERM stops new traffic, finishes in-flight work
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));        // LB health check marks us down first
  setTimeout(() => process.exit(1), 10000);   // hard stop safety net
});

// Capacity is arithmetic now:
// p95 target 200ms, one instance handles 300 rps, peak is 3000 rps
// -> 10 instances + 2 for failover headroom. Autoscaling makes it continuous:

// autoscaler.every(30, async () => {
//   const target = Math.ceil(currentRps / 300) + 1;
//   await fleet.resize("web", clamp(target, 2, 50));
// });`,
    steps: ["1 server", "Load balancer added", "3 servers", "Auto-scaling group"],
  },
  {
    id: "scale-ratelimit",
    cat: "scale",
    title: "Rate Limiting",
    one: "Capping how many requests a client can make in a time window.",
    why: "Without limits, one buggy client loop — or one attacker — consumes capacity meant for everyone. Rate limiting is capacity insurance: it converts 'the site is down because of one customer' into 'that customer got a 429'.",
    how: "Track consumption per client key (user ID, API key, IP) against a policy (N requests per window) using a fast shared counter store (Redis). Algorithms trade simplicity for smoothness: fixed window (simple, boundary bursts), sliding window (smooth), token bucket (allows controlled bursts).",
    when: "Every public endpoint, and every expensive internal one. Differentiate policies by cost (search: 10/min, reads: 1000/min) and by client tier (free vs paid). Respond with 429 + Retry-After, and expose remaining-quota headers so good clients self-regulate before hitting the wall.",
    ref: "Stripe Engineering Blog",
    subtopics: [
      { name: "Client keying", detail: "User ID > API key > IP, in that order of preference. IP alone punishes whole offices behind NAT; unauthenticated + IP is the floor, not the strategy." },
      { name: "Algorithms", detail: "Fixed window: one counter per minute (boundary burst 2x). Sliding window: weighted blend of two windows (smooth). Token bucket: refill rate + burst capacity (best for uneven traffic)." },
      { name: "Tiered limits", detail: "Separate buckets per endpoint class so one expensive export doesn't consume the budget needed for normal browsing. Also per-tenant and global backstops." },
      { name: "The response contract", detail: "429 + Retry-After + X-RateLimit-Remaining/Reset turns a wall into a protocol: well-behaved clients back off automatically and never see errors." },
    ],
    code: `// Token bucket in Redis — atomic via Lua, one round trip per request
const TOKEN_BUCKET = \`
  local key, capacity, refill_rate, now = KEYS[1], tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
  local bucket = redis.call("HMGET", key, "tokens", "ts")
  local tokens = tonumber(bucket[1]) or capacity
  local last = tonumber(bucket[2]) or now

  tokens = math.min(capacity, tokens + (now - last) * refill_rate)  -- refill
  if tokens < 1 then
    redis.call("HSET", key, "tokens", tokens, "ts", now)
    return { 0, math.floor(tokens * 100) }
  end

  tokens = tokens - 1
  redis.call("HSET", key, "tokens", tokens, "ts", now)
  redis.call("EXPIRE", key, 3600)
  return { 1, math.floor(tokens) }
\`;

const POLICIES = {
  default: { capacity: 100, refill: 100 / 60 },   // 100 burst, ~1.7/s sustained
  search:  { capacity: 10,  refill: 10 / 60 },    // expensive: tighter
};

async function rateLimit(req, res, next) {
  const policy = req.path.includes("/search") ? POLICIES.search : POLICIES.default;
  const key = "rl:" + (req.user?.id ?? req.ip) + ":" + (policy === POLICIES.search ? "s" : "d");

  const [allowed, remaining] = await redis.eval(
    TOKEN_BUCKET, 1, key,
    policy.capacity, policy.refill, Math.floor(Date.now() / 1000)
  );

  res.set("X-RateLimit-Remaining", String(remaining));
  if (!allowed) {
    res.set("Retry-After", "2");
    return res.status(429).json({ error: { code: "rate_limited" } });
  }
  next();
}
app.use(rateLimit);`,
    steps: ["Requests tracked per client", "Threshold reached", "Excess requests rejected", "Window resets"],
  },
  {
    id: "scale-circuitbreaker",
    cat: "scale",
    title: "Circuit Breaker",
    one: "After enough failures, stop calling a broken service and fail fast instead.",
    why: "A dead dependency is bad; a slow one is worse — every caller holds connections waiting for timeouts, thread/event-loop pools saturate, and the failure cascades upstream. The breaker converts that slow suffocation into fast, explicit failure plus automatic recovery probing.",
    how: "Three states. Closed: requests flow; failures counted in a window. Open: threshold tripped → calls fail INSTANTLY (no network) for a cool-down. Half-open: one probe request passes through; success closes the circuit, failure reopens it. The state machine is per-dependency.",
    when: "Wrap every network dependency: third-party APIs, internal services, even the DB for non-critical reads. Pair with fallbacks (serve cached/default when open) so an open breaker degrades features instead of erroring pages — that's graceful degradation wearing a breaker.",
    ref: "Microsoft Architecture Guide",
    subtopics: [
      { name: "Failure thresholds", detail: "Count recent failures (5 of last 20) or consecutive ones. Too sensitive: flaps on blips; too lax: the cascade starts before the trip. Tune to the dependency's normal error profile." },
      { name: "Half-open probing", detail: "Recovery without overload: ONE request tests the water after the cool-down. Success → close (traffic resumes); failure → reopen (wait longer). Avoids thundering-herd reconnections." },
      { name: "Fail fast ≠ fail everything", detail: "Open circuit = instant error (no timeout wait). The point is releasing your resources, so pair each breaker with a fallback: cache, default value, or feature-off." },
      { name: "Per-dependency isolation", detail: "One breaker per endpoint/dependency, never global: payment being down must not open the breaker on — or block — the inventory client." },
    ],
    code: `class CircuitBreaker {
  constructor(name, { threshold = 5, windowMs = 30000, cooldownMs = 15000 } = {}) {
    this.name = name;
    this.state = "closed";
    this.failures = [];
    this.cooldownMs = cooldownMs;
    this.threshold = threshold;
    this.windowMs = windowMs;
    this.probedAt = 0;
  }

  async exec(fn, fallback) {
    const now = Date.now();

    if (this.state === "open") {
      if (now - this.probedAt < this.cooldownMs) return fallback(); // fail FAST, no network
      this.state = "half-open";                                     // one probe allowed
    }

    try {
      const result = await fn();
      if (this.state === "half-open") {
        this.state = "closed";
        this.failures = [];
        logger.info("breaker closed", { dep: this.name });
      }
      return result;
    } catch (err) {
      this.failures = this.failures.filter((t) => now - t < this.windowMs);
      this.failures.push(now);

      if (this.state === "half-open" || this.failures.length >= this.threshold) {
        this.state = "open";
        this.probedAt = now;
        logger.warn("breaker OPEN", { dep: this.name, failures: this.failures.length });
        metrics.increment("breaker.open", { dep: this.name });
      }
      return fallback(); // degrade, don't error
    }
  }
}

// One breaker per dependency, each with its own fallback
const recommendations = new CircuitBreaker("recs-api");
const payments = new CircuitBreaker("payments-api");

app.get("/product/:id", async (req, res) => {
  const recs = await recommendations.exec(
    () => recsApi.for(req.params.id),
    () => cache.get("recs:default") ?? []       // fallback: cached or empty
  );
  res.json({ recs }); // recommendations down = degraded page, not 500
});`,
    steps: ["Closed (calls flow)", "Failures spike", "Open (calls blocked)", "Half-open test call", "Closed again if healthy"],
  },
  {
    id: "scale-loadbalancing",
    cat: "scale",
    title: "Load Balancing",
    one: "Incoming traffic is spread across multiple servers instead of hitting one.",
    why: "N identical instances are worthless if one of them eats all the traffic. The load balancer is what turns a fleet into one logical server: distributing load, health-checking members, and enabling rolling deploys and failover without client awareness.",
    how: "The LB owns the stable address; it forwards each request (or connection) to a pool member by algorithm — round robin (even rotation), least connections (route to the least busy), weighted (capacity-proportional), IP hash (affinity). Health checks prune dead members automatically.",
    when: "In front of every multi-instance tier. L4 (TCP) for raw speed, L7 (HTTP) for smart routing (paths, headers, retries). Cloud managed LBs cover 95% of needs; the interesting decisions are algorithm choice, health check design, and connection draining during deploys.",
    ref: "AWS ELB Documentation",
    subtopics: [
      { name: "Round robin vs least connections", detail: "Round robin: even counts, ignores actual cost — bad when request costs vary. Least connections: adapts to real load and slow requests; the default for uneven workloads." },
      { name: "Health checks", detail: "Periodic probes remove/unregister failing members — the LB is only as smart as its checks. Check readiness (deps reachable), not just liveness, or you route into zombies." },
      { name: "L4 vs L7", detail: "L4 routes TCP streams blind (fast, cheap, no header logic). L7 reads HTTP: path-based routing, header rewrites, retries, canary weights — everything interesting lives at L7." },
      { name: "Connection draining", detail: "On member removal, finish in-flight requests (30s grace) before cutting: the difference between rolling deploys users never notice and random 502s during every deploy." },
    ],
    code: `// A minimal L7 round-robin LB with health checks — the mechanics made visible
const targets = [
  { url: "http://10.0.0.1:3000", healthy: true },
  { url: "http://10.0.0.2:3000", healthy: true },
  { url: "http://10.0.0.3:3000", healthy: true },
];
let rr = 0;

// health checks: prune the dead every 5s
setInterval(async () => {
  await Promise.all(targets.map(async (t) => {
    try {
      const res = await fetch(t.url + "/healthz", { signal: AbortSignal.timeout(1000) });
      t.healthy = res.ok && (await res.text()).includes("ready");
    } catch { t.healthy = false; }
  }));
}, 5000);

const server = http.createServer(async (req, res) => {
  const pool = targets.filter((t) => t.healthy);
  if (!pool.length) { res.writeHead(503); return res.end("no healthy upstreams"); }

  const target = pool[rr++ % pool.length]; // round robin over LIVE members only
  try {
    const upstream = await fetch(target.url + req.url, {
      method: req.method,
      headers: { ...req.headers, host: new URL(target.url).host, "x-forwarded-for": req.socket.remoteAddress },
      body: req.method === "GET" ? undefined : req,
    });
    res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
    upstream.body.pipe(res);
  } catch {
    target.healthy = false; // ejection on failure
    res.writeHead(502); res.end();
  }
});
server.listen(80);`,
    steps: ["Traffic in", "Load balancer", "Server A", "Server B", "Server C"],
  },
  {
    id: "scale-vertical",
    cat: "scale",
    title: "Vertical Scaling",
    one: "Making a single machine bigger (more CPU/RAM) instead of adding machines.",
    why: "Sometimes the honest answer: the app is stateful, legacy, or the bottleneck is a single monolithic store. Vertical scaling buys 10x with a reboot and zero architecture — no distributed-systems tax, no code changes, done before lunch.",
    how: "Move to a larger instance type: more vCPUs, RAM, faster NVMe/IO. The app doesn't change — same process, bigger box. Databases especially benefit: a bigger buffer pool, more connections, faster disk. The pattern's limit is the catalog's biggest instance.",
    when: "Right for: quick relief while horizontal work happens, databases inside their sweet spot, stateful legacy you can't split yet, and dev/staging. Wrong as the end-state for user-facing fleets — you inherit a hard ceiling, a single point of failure, and painful resize downtime.",
    ref: "AWS Documentation",
    subtopics: [
      { name: "The ceiling", detail: "There is always a largest instance — and the last 2x costs 3-5x per unit. Vertical buys time, not a future: budget the horizontal migration from day one." },
      { name: "Databases first", detail: "Postgres on a 64-core/256GB box with NVMe is a beast few apps outgrow. Scale the DB vertically, the app tier horizontally — the pragmatic hybrid most 'scalable' systems actually run." },
      { name: "Resize downtime", detail: "Most clouds require stop/resize/start: minutes of planned outage. Choose maintenance windows, or pair with a replica promotion for near-zero-downtime vertical moves." },
      { name: "Know your bottleneck first", detail: "RAM-bound? CPU-bound? IO-bound? Vertical scaling spent on the wrong resource is money burned: profile (CPU steal, memory pressure, iops/throughput) before resizing." },
    ],
    code: `// The whole implementation of vertical scaling: a config change
// terraform:
// resource "aws_instance" "app" {
//   instance_type = var.app_instance_type   # t3.large -> r6i.2xlarge: done.
// }

// Where vertical actually shines: the database's memory config follows the box
// postgresql.conf on the bigger machine:
//   shared_buffers = 64GB          # was 8GB — buffer pool hits jump dramatically
//   effective_cache_size = 192GB   # planner knows the OS cache is huge now
//   max_connections = 500          # more headroom before pooling is mandatory
//   maintenance_work_mem = 8GB     # faster VACUUM/index builds

// Measure before AND after — prove the resize hit the actual bottleneck:
const before = await pool.query(\`
  SELECT buffers.hits::float / nullif(buffers.hits + buffers.reads, 0) AS cache_hit_ratio
  FROM pg_statio_user_tables WHERE relname = 'orders'
\`);

// after: cache_hit_ratio 0.91 -> 0.995; p95 480ms -> 95ms. Money well spent.
// if instead p95 stayed 480ms: the bottleneck was IO locks, not memory — wrong dial.`,
    steps: ["Server at capacity", "Upgrade CPU/RAM", "Same server, more power", "Handles more load"],
  },
  {
    id: "scale-autoscaling",
    cat: "scale",
    title: "Auto-Scaling",
    one: "Automatically adding or removing servers based on real-time load.",
    why: "Traffic isn't flat — 3 a.m. needs 4 instances, noon needs 40, Black Friday needs 400. Provisioning for peak wastes money 90% of the time; provisioning for average loses revenue at peak. Autoscaling tracks demand with machines instead of humans.",
    how: "A metrics signal (CPU, request rate, queue depth, p95 latency) feeds a policy: above target → add instances, below → remove. New instances launch from a golden image/AMI, register with the LB via health checks, and serve within minutes. Scale-IN needs extra care (connection draining, work handoff).",
    when: "Any tier with variable load and stateless instances — web frontends, workers (scale on queue depth). Not for: databases (state makes churn expensive — scale them vertically/pooled), and anything where instance startup exceeds the load spike's duration (predictive/scheduled scaling covers events).",
    ref: "AWS Documentation",
    subtopics: [
      { name: "Choosing the metric", detail: "Best signals track what users feel: request latency, queue depth, rps-per-instance. CPU is a lagging proxy — an IO-bound service can be drowning at 20% CPU." },
      { name: "Scale-out fast, scale-in slow", detail: "Asymmetric policies: react to spikes in seconds; shrink gradually (10-min cooldowns) or bounce-backs churn instances up and down all day." },
      { name: "Warm-up compensation", detail: "A fresh instance has cold caches/JIT. Scale-in policies that ignore first-minute metrics (or target-tracking with warmup) prevent premature 'this instance is idle' decisions." },
      { name: "Min/max guards", detail: "Always floor and ceiling: min=2 for availability (one can die), max=budget/disaster cap. A runaway scale-out event with no max is a financial incident." },
    ],
    code: `// Queue-depth autoscaling: the worker pattern done right
setInterval(async () => {
  const [depth, perInstance] = [await queue.getWaitingCount(), 50]; // 50 jobs/min per worker
  const instances = await fleet.size("workers");
  const desired = Math.ceil(depth / (perInstance * 5)); // target: <5 min of backlog

  // asymmetric: scale out aggressively, scale in gently
  if (desired > instances) {
    await fleet.resize("workers", Math.min(desired, MAX_INSTANCES)); // now
    metrics.increment("autoscale.out", { from: instances, to: desired });
  } else if (desired < instances - 1) {
    if (await cooldownElapsed("scale_in", 10 * 60 * 1000)) {         // 10-min cooldown
      await fleet.resize("workers", Math.max(desired, MIN_INSTANCES));
      metrics.increment("autoscale.in", { from: instances });
    }
  }
}, 30000);

// Request-rate scaling for the web tier, latency-targeted
setInterval(async () => {
  const p95 = await metrics.p95("http_request_duration", "5m");
  const instances = await fleet.size("web");

  if (p95 > 250 && instances < MAX_WEB) await fleet.resize("web", instances + 2);
  else if (p95 < 100 && instances > MIN_WEB && (await cooldownElapsed("web_in", 600000))) {
    await fleet.resize("web", instances - 1);
  }
}, 15000);`,
    steps: ["Metric monitored (CPU/requests)", "Threshold crossed", "New instance launched", "Instance removed when load drops"],
  },
  {
    id: "scale-readreplicas",
    cat: "scale",
    title: "Database Read Replicas",
    one: "Serving read traffic from copies to reduce load on the primary.",
    why: "Most database work is reads — and the primary is one machine. Read replicas multiply read capacity by copy count while the primary keeps writes: the single most effective database scaling lever before sharding ever enters the conversation.",
    how: "The primary ships its WAL; replicas replay it continuously (async by default). The app routes reads to replicas (see read/write splitting), writes to the primary. Failover promotion turns a replica into the new primary when the primary dies — replication doubles as the HA story.",
    when: "When the primary is read-bound and indexes/caching have plateaued. Mind replication lag: read-after-write paths must route to the primary, and replicas must never fall minutes behind silently (lag monitoring with alerts). Sharding is the NEXT step when WRITES outgrow the primary — replicas don't help write throughput.",
    ref: "AWS RDS Documentation",
    subtopics: [
      { name: "Replication lag reality", detail: "Replicas trail by ms-seconds normally, worse under load. Design for it: read-your-writes routing, and lag-aware load balancing that sheds reads to primary when replicas fall behind." },
      { name: "Lag monitoring", detail: "Alert on replication delay (WAL position delta or seconds-behind). A silently-lagging replica is a stale-data generator wearing an HA costume." },
      { name: "Replicas as HA", detail: "Automatic failover (RDS Multi-AZ, Patroni) promotes a replica on primary death — 30s-2min blip instead of an outage. Sync replication trades commit latency for zero data loss." },
      { name: "Offload non-critical reads", detail: "Analytics, exports, and report queries move to replicas FIRST — a runaway report can't stall checkouts. Some teams give replicas their own resource configs." },
    ],
    code: `// Routing with read-your-writes: the whole pattern
const primary = new Pool({ connectionString: PRIMARY_URL });
const replicas = [new Pool({ connectionString: REPLICA_1 }), new Pool({ connectionString: REPLICA_2 })];
let lagMs = 0;

setInterval(async () => { // lag-aware routing
  const { rows } = await replicas[0].query("SELECT extract(epoch from now() - pg_last_xact_replay_timestamp()) * 1000 AS ms");
  lagMs = rows[0].ms;
  if (lagMs > 2000) logger.warn("replica lagging", { ms: lagMs });
}, 5000);

function readPool({ requireFresh = false, writtenAt = 0 } = {}) {
  const freshWindow = Date.now() - writtenAt < Math.max(lagMs * 2, 1000);
  if (requireFresh || freshWindow) return primary;   // user just wrote? primary.
  return replicas[Math.floor(Math.random() * replicas.length)];
}

// Writes: always primary, stamp the write time
async function placeOrder(userId, cart) {
  const order = await primary.query("INSERT INTO orders ... RETURNING *", [userId, cart]);
  req.writtenAt = Date.now();
  return order;
}

// Reads: replicas, except when freshness is required
const history = await readPool({ writtenAt: req.writtenAt }).query("SELECT * FROM orders WHERE user_id = $1", [userId]);
const analytics = await readPool({}).query("SELECT ... heavy report ..."); // never touches primary`,
    steps: ["Primary handles writes", "Data replicated", "Reads routed to replicas", "Primary load reduced"],
  },
  {
    id: "scale-backpressure",
    cat: "scale",
    title: "Backpressure",
    one: "A system signals upstream to slow down when it's overwhelmed.",
    why: "A system without backpressure doesn't degrade — it queues until it dies: buffers grow, memory explodes, latencies climb past timeouts. Backpressure is the nervous system that says 'slow down' BEFORE the collapse, converting overload into measurable, recoverable delay.",
    how: "The consumer exposes its capacity (high-water marks, credits, queue depth) and the producer respects it: bounded queues that reject/block when full, stream pipes that pause reads when writes lag, protocol-level flow control (HTTP 429, TCP windows, Kafka consumer lag). The signal propagates to the true source of load.",
    when: "Any producer/consumer pair with mismatched speeds: streams (file/HTTP), message queues, WebSocket fan-out, batch pipelines. The design question is always WHERE the wait lands: block the producer, drop the excess (with metrics), or shed to a cheaper fallback.",
    ref: "Reactive Streams Specification",
    subtopics: [
      { name: "Bounded queues", detail: "The foundation: a queue with a max. Full queue = concrete policy (block, drop-new, drop-oldest, reject upstream) instead of unbounded memory growth. Unbounded queue = postponed crash." },
      { name: "Stream piping", detail: "Node streams pipe() pauses the READ side when the WRITE side buffers — file copies and proxy responses throttle automatically. Break the pipe (ignore drain events) and memory explodes." },
      { name: "Reject, don't absorb", detail: "Past a threshold, say no fast: 429/503 upstream (they retry later) beats accepting work you'll time out on anyway. Absorbing everything converts YOUR overload into EVERYONE's timeout." },
      { name: "End-to-end signal", detail: "Real backpressure propagates: DB slow → consumer slow → queue deep → API 429s → client retries with backoff. Each hop amplifies the 'slow down' instead of buffering it." },
    ],
    code: `// Bounded queue with explicit overflow policy — the backpressure core
class BoundedQueue {
  constructor(max) { this.items = []; this.max = max; this.dropped = 0; }

  push(item) {
    if (this.items.length >= this.max) {
      this.dropped++;
      metrics.increment("queue.dropped", { name: this.name });
      return false; // backpressure: producer learns we're full
    }
    this.items.push(item);
    return true;
  }
  pop() { return this.items.shift(); }
  get depth() { return this.items.length; }
}

// Producer respects the signal: slow down, then shed
const work = new BoundedQueue(1000);
async function ingest(event) {
  if (!work.push(event)) {
    // we're saturated: tell the SOURCE to back off rather than buffering forever
    throw Object.assign(new Error("overloaded"), { statusCode: 503, retryAfter: 5 });
  }
}

// Consumer drains at its own pace — depth is the health signal
setInterval(async () => {
  while (work.depth > 0) {
    await process(work.pop());
  }
  metrics.gauge("queue.depth", work.depth);
}, 100);

// Node stream piping: OS-grade backpressure, no code needed
const fileStream = fs.createReadStream(hugeFile);
fileStream.pipe(gzipStream).pipe(response); // gzip slow? read pauses automatically.

// HTTP-level: the queue told us to shed — speak it
app.use((err, req, res, next) => {
  if (err.statusCode === 503) {
    res.set("Retry-After", String(err.retryAfter));
    return res.status(503).json({ error: { code: "overloaded" } });
  }
  next(err);
});`,
    steps: ["Consumer overwhelmed", "Signals producer to slow", "Producer reduces rate", "System stays stable"],
  },
  {
    id: "scale-backoff",
    cat: "scale",
    title: "Retry with Exponential Backoff",
    one: "Waiting progressively longer between retries so a failing service isn't hammered.",
    why: "The first reflex — retry immediately, retry hard — turns one service's hiccup into a DDoS from its own clients: a thousand callers all retrying at once form a thundering herd that finishes the job of killing the dependency. Backoff spaces retries out and lets the victim breathe.",
    how: "On failure, wait base × 2^attempt (1s, 2s, 4s...), capped at a max, and add JITTER (randomization) so retried calls don't synchronize. Only retry idempotent operations, only retry retryable failures (timeouts, 503, 429-after-Retry-After — never 4xx bugs), and cap total attempts.",
    when: "Every network call that can fail transiently: service-to-service, queues, third-party APIs, DB connections. Full-jitter (random 0..min(cap, base*2^n)) is the empirically best variant. Combine with circuit breakers — backoff handles the single caller; breakers stop the fleet.",
    ref: "AWS Documentation",
    subtopics: [
      { name: "Jitter is mandatory", detail: "Without it, all clients that failed together retry together — forever. Full jitter (random within the backoff window) desynchronizes the herd; it's the difference between recovery and synchronized pounding." },
      { name: "Retry only what's retryable", detail: "Timeouts, 502/503/504, 429 (respect Retry-After), connection resets: yes. 400/422/401: never — a validation error fails identically forever. Non-idempotent POSTs need idempotency keys before any retry." },
      { name: "Cap and budget", detail: "Max attempts (3-5) and max total wait (a few seconds in request paths; minutes in jobs). Unbounded retries = unbounded latency tail; callers have their own timeouts to respect." },
      { name: "Honor Retry-After", detail: "When the server says 'wait 30s', waiting 2s and retrying is an attack. The header is the server's backpressure speaking — obey it before your own backoff math." },
    ],
    code: `// Production-grade retry: exponential + full jitter + retryable classification
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function isRetryable(err) {
  if (err.code === "ECONNRESET" || err.code === "ETIMEDOUT") return true;
  const status = err.status ?? err.statusCode;
  return status === 429 || status === 502 || status === 503 || status === 504 || status === undefined;
}

async function retry(fn, {
  attempts = 5,
  baseMs = 200,          // first wait: 200ms
  capMs = 8000,          // never wait longer than 8s
  respectRetryAfter = true,
} = {}) {
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === attempts - 1) throw err;

      let wait = Math.random() * Math.min(capMs, baseMs * 2 ** attempt); // FULL JITTER
      const retryAfter = Number(err.headers?.get?.("retry-after"));
      if (respectRetryAfter && retryAfter) wait = Math.max(wait, retryAfter * 1000);

      logger.warn("retrying", { attempt: attempt + 1, waitMs: Math.round(wait), error: err.message });
      await sleep(wait);
    }
  }
  throw lastErr;
}

// Usage: flaky upstream survives, bug fails fast
const data = await retry(() => fetch("https://partner.example.com/quotes").then((r) => {
  if (!r.ok) throw Object.assign(new Error("upstream " + r.status), { status: r.status, headers: r.headers });
  return r.json();
}));`,
    steps: ["Request fails", "Wait 1s, retry", "Fails again, wait 2s", "Fails again, wait 4s"],
  },
  {
    id: "scale-degradation",
    cat: "scale",
    title: "Graceful Degradation",
    one: "Serving partial functionality instead of a full outage when a dependency fails.",
    why: "Every feature depends on something that will eventually be down. The choice is binary: design fallbacks in advance, or let one dead dependency take the whole page — usually the least critical one (recommendations) killing the most critical (checkout).",
    how: "Classify features into must-serve and nice-to-have. Nice-to-haves get fallback paths: cached data, static defaults, feature-hidden. The request path treats dependency failure as a normal branch, not an exception: recommendations empty? Render the page without them, log the degradation.",
    when: "Design it for every read path with a non-critical dependency: recommendations, reviews, activity feeds, counters, avatars. Write paths (payments, orders) fail honestly instead — never degrade a money operation into a wrong one. The pre-work: identify dependencies and pre-build the fallbacks.",
    ref: "Microsoft Architecture Guide",
    subtopics: [
      { name: "Feature triage", detail: "Map dependencies → impact: catalog (critical), reviews (important), recommendations (cosmetic). When triage is explicit, fallbacks are obvious; when it's implicit, everything fails everything." },
      { name: "Fallback ladders", detail: "Fresh call → cached copy (stale ok) → default/static content → feature hidden. Each rung degrades quality, never availability. Build the ladder per feature, not globally." },
      { name: "Timeouts make it possible", detail: "Degradation needs fast failure: 500ms timeout on recommendations, then fallback. Without aggressive timeouts, 'waiting to degrade' IS the outage." },
      { name: "Visible degradation", detail: "Serve the fallback AND flag it: response markers, metrics per degraded feature, UI hints. Silent degradation rots; measured degradation gets fixed." },
    ],
    code: `// Product page: every optional dependency on a fallback ladder
app.get("/product/:id", async (req, res) => {
  // CRITICAL: no fallback — fail honestly
  const product = await catalog.get(req.params.id); // throws 404/500 for real
  if (!product) return res.status(404).json({ error: { code: "not_found" } });

  // degrade helper: try the ladder, measure the rung you landed on
  async function degrade(name, ...attempts) {
    for (const attempt of attempts) {
      try {
        return { value: await attempt.fn(), degraded: attempt.label !== "live" };
      } catch (err) {
        logger.warn("degraded", { feature: name, rung: attempt.label, error: err.message });
      }
    }
    return { value: attempts.at(-1).fallback, degraded: true };
  }

  const [reviews, recs, stock] = await Promise.all([
    degrade("reviews",
      { label: "live", fn: () => reviewsApi.for(product.id, { timeout: 400 }) },
      { label: "cache", fn: () => cache.get("reviews:" + product.id) },
      { label: "static", fallback: { items: [], count: null } }
    ),
    degrade("recommendations",
      { label: "live", fn: () => recsApi.for(product.id, { timeout: 400 }) },
      { label: "static", fallback: product.related ?? [] }
    ),
    degrade("stock",
      { label: "live", fn: () => inventoryApi.level(product.id, { timeout: 300 }) },
      { label: "static", fallback: { unknown: true } }
    ),
  ]);

  metrics.increment("page.render", { degradedReviews: reviews.degraded, degradedRecs: recs.degraded });
  res.json({ data: { product, reviews: reviews.value, recommendations: recs.value, stock: stock.value } });
});`,
    steps: ["Dependency fails", "Core feature detected as down", "Fallback response served", "User sees partial, not total, failure"],
  },
  {
    id: "scale-healthchecks",
    cat: "scale",
    title: "Health Checks & Heartbeats",
    one: "Periodic pings confirming a service instance is still alive and ready.",
    why: "Fleets manage instances by trusting declarations of health — a dead instance that LOOKS alive receives traffic forever, and a restarting one that LOOKS dead gets killed before it finishes booting. Health checks are how orchestration sees the truth.",
    how: "Liveness: is the process up? (/healthz returns 200 if the event loop responds). Readiness: can it serve? (/readyz checks DB/dependencies; fails while warming or degraded). Heartbeats: instances ping a registry/leader on a schedule; silence = presumed dead. Orchestrators (K8s) and LBs consume these signals for routing and restarts.",
    when: "Every service, always — wired into LB target groups and K8s probes from day one. The design care: readiness must check what actually determines success (deps, warmup), and liveness must NOT (a slow DB shouldn't trigger restart loops — that's readiness's job).",
    ref: "Kubernetes Documentation",
    subtopics: [
      { name: "Liveness vs readiness", detail: "Liveness failing → restart the process (deadlocked event loop). Readiness failing → stop routing, keep running (DB blip, cache warming). Confusing them causes restart storms during dependency hiccups." },
      { name: "Deep vs shallow checks", detail: "Shallow: can I answer TCP/HTTP at all. Deep: can I actually serve (SELECT 1, cache connected, queue reachable). Route-ready needs deep; LB probing tolerates shallow." },
      { name: "Heartbeats & leases", detail: "Scheduled self-announcement with TTL: silence past TTL = dead (leader election, worker registries, cron locks all use this). Clock skew and GC pauses make TTLs generous-but-bounded." },
      { name: "Startup probes", detail: "Slow-booting apps (JVM, big caches) need a startup window where readiness failures don't count: K8s startupProbe defers the other probes until first success." },
    ],
    code: `// The three probes, implemented honestly
let ready = false; // flipped after warmup completes

app.get("/healthz", (req, res) => {
  // LIVENESS: process-level only. NO dependency checks here.
  res.status(200).json({ status: "alive", uptime: process.uptime() });
});

app.get("/readyz", async (req, res) => {
  // READINESS: can we serve? check what ACTUALLY gates success
  if (!ready) return res.status(503).json({ status: "warming" });

  const checks = await Promise.allSettled([
    pool.query("SELECT 1"),
    redis.ping(),
  ]);
  const db = checks[0].status === "fulfilled";
  const cache = checks[1].status === "fulfilled";

  // partial readiness: degraded but serving (no cache = slower, not broken)
  const status = db ? (cache ? 200 : 200) : 503;
  res.status(status).json({ status: db ? "ready" : "db_down", cache });
});

// Warmup: heavy init BEFORE declaring ready
async function startup() {
  await warmCaches();         // load top-K keys
  ready = true;               // only NOW does the LB/K8s route traffic here
  console.log("ready");
}

// Heartbeat: announce to the worker registry
setInterval(async () => {
  await redis.set("workers:" + instanceId, JSON.stringify({ queues: ["reports"], at: Date.now() }), { EX: 15 });
}, 5000);
// registry treats silence > 15s as death and reassigns the instance's jobs`,
    steps: ["Instance running", "Health check pings it", "Responds healthy", "Or fails, removed from pool"],
  },
  {
    id: "scale-throttling",
    cat: "scale",
    title: "Throttling",
    one: "Deliberately slowing responses instead of rejecting them outright under load.",
    why: "A hard rate limit is a cliff: over it, requests die. Throttling is the slope between 'fine' and 'rejected' — extra requests wait briefly, get served slightly late, and users mostly never notice. It converts overload curves into smooth degradation instead of error spikes.",
    how: "Measure per-client or global capacity consumption. Within limits: pass. Slightly over: delay the response (queue with a cap) or add artificial latency. Well over: shed with 429/503. The throttle band is the point — bounded queuing (say max 2s wait) with clear feedback (Retry-After, quota headers) at the edges.",
    when: "Friendly, retry-tolerant workloads near their limits: batch exports, polling clients, partner APIs. Not for latency-critical paths (checkout shouldn't 'wait a bit') — there, hard limits and shed-fast are kinder. Combine: throttle the mild excess, limit the gross excess.",
    ref: "AWS Documentation",
    subtopics: [
      { name: "Bounded waiting", detail: "The throttle band needs a ceiling (1-3s): beyond it, clients time out anyway and you've just moved the failure while holding connections. Delay briefly, then shed." },
      { name: "Priority lanes", detail: "Under load, throttle cheap/low-priority traffic first (analytics, prefetch) so critical requests skip the queue. Throttling is a scheduling decision, not just a delay." },
      { name: "Client feedback", detail: "X-RateLimit-Remaining, Retry-After, and 'degraded: true' markers let well-behaved clients adapt: spread their calls, back off, or show 'slower than usual' instead of erroring." },
      { name: "Load shedding is throttling's sibling", detail: "Past the band, refuse NEW work while finishing old: 503 + Retry-After. A service that sheds loudly recovers; one that queues silently dies slowly." },
    ],
    code: `// Throttle band: pass -> delay -> shed, in one middleware
function throttle({ capacityPerSec = 50, maxDelayMs = 2000 }) {
  let tokens = capacityPerSec;
  let last = Date.now();
  let waiting = 0;

  setInterval(() => {
    const now = Date.now();
    tokens = Math.min(capacityPerSec, tokens + ((now - last) / 1000) * capacityPerSec);
    last = now;
  }, 500).unref();

  return async (req, res, next) => {
    const now = Date.now();
    if (tokens >= 1) {
      tokens -= 1;
      return next(); // in capacity: instant
    }

    // mild excess: bounded wait
    const delay = Math.min(((1 - tokens) / capacityPerSec) * 1000, maxDelayMs);
    if (delay < maxDelayMs) {
      tokens += 1; // reserve the token we'll consume
      res.set("X-Throttled", "true");
      metrics.increment("throttle.delayed", { path: req.path });
      return setTimeout(next, delay);
    }

    // gross excess: shed loudly
    waiting++;
    metrics.increment("throttle.shed", { path: req.path });
    res.set("Retry-After", String(Math.ceil(waiting / capacityPerSec) + 1));
    return res.status(503).json({ error: { code: "overloaded", retryAfterMs: (waiting / capacityPerSec) * 1000 } });
  };
}

app.use(throttle({ capacityPerSec: 50, maxDelayMs: 2000 }));`,
    steps: ["Load exceeds threshold", "Requests delayed, not dropped", "System stays within capacity", "Requests eventually served"],
  },
  {
    id: "scale-queueingunderload",
    cat: "scale",
    title: "Queueing Under Load",
    one: "Buffering incoming work in a queue instead of processing it instantly.",
    why: "Real traffic arrives in bursts, but capacity is fixed. A queue converts bursty arrivals into smooth, sustainable processing — the system absorbs a 10x spike by working through a backlog, instead of collapsing at the moment of peak demand.",
    how: "Arrivals append to a bounded queue; workers process at a sustainable rate. The physics (Little's Law: depth = arrival rate × wait time) means depth IS latency: a queue that's 10s deep makes every request 10s slower. So queues need bounds, depth monitoring, and a shed policy when depth explodes.",
    when: "Any workload that tolerates delay: video encoding, email sending, report generation, import processing. The critical design rule: requests whose response the user waits on should queue as little as possible — queue the downstream work, not the user's answer.",
    ref: "AWS Documentation",
    subtopics: [
      { name: "Bounded queues", detail: "A max depth with a policy (reject/429, drop-oldest). Unbounded queues just move the failure: memory fills, latencies grow silently, and the crash happens at the worst moment." },
      { name: "Little's Law as a design tool", detail: "depth = arrival × latency. If you process 100/s and 5000 arrive, the backlog drains in 50s — and item #5000 waited 50 seconds. Size capacity from the wait you can tolerate." },
      { name: "Depth is the health metric", detail: "Alert on queue depth and age-of-oldest-item, not worker CPU. Growing depth = capacity below arrival rate; the only fixes are more workers or less arrival (shed/429)." },
      { name: "Priority queues", detail: "Not all work is equal: user-facing jobs jump ahead of batch imports. Two queues with weighted worker allocation beats one queue where a bulk import starves checkout." },
    ],
    code: `// A bounded work queue with depth-aware shedding — the whole discipline
class WorkQueue {
  constructor(name, maxDepth) {
    this.name = name;
    this.max = maxDepth;
    this.items = [];
    this.rejected = 0;
  }

  enqueue(item) {
    if (this.items.length >= this.max) {
      this.rejected++; // shed at the door: better a 429 now than a 30s timeout later
      metrics.increment("queue.rejected", { queue: this.name });
      throw Object.assign(new Error("queue full"), { statusCode: 429 });
    }
    const enqueuedAt = Date.now();
    this.items.push({ item, enqueuedAt });
    metrics.gauge("queue.depth", this.items.length, { queue: this.name });
  }

  oldestAgeMs() {
    return this.items.length ? Date.now() - this.items[0].enqueuedAt : 0;
  }
}

const exports_ = new WorkQueue("exports", 5000); // 5000 pending exports max

app.post("/v1/exports", async (req, res) => {
  try {
    exports_.enqueue({ userId: req.user.id, query: req.body });
    res.status(202).json({ status: "queued", position: exports_.items.length });
  } catch (err) {
    res.set("Retry-After", "60");
    res.status(429).json({ error: { code: "export_backlog_full" } });
  }
});

// Workers drain at a sustainable rate; alarms watch depth and age
setInterval(async () => {
  const age = exports_.oldestAgeMs();
  if (age > 5 * 60 * 1000) await pager.warn("export queue: oldest item > 5min"); // capacity below arrivals
}, 30000);

async function workerLoop() {
  for (;;) {
    const job = exports_.items.shift();
    if (!job) { await sleep(200); continue; }
    await processExport(job.item);
  }
}`,
    steps: ["Burst of requests", "Buffered in queue", "Workers process at sustainable rate", "Backlog drains over time"],
  },
  {
    id: "scale-bulkhead",
    cat: "scale",
    title: "Bulkhead Isolation",
    one: "Partitioning resources so one overloaded component can't exhaust the whole system.",
    why: "Shared resources are shared fates: one connection pool, one thread pool, one slow dependency — and the analytics report that hogs all 20 DB connections takes checkout down with it. Bulkheads partition the scarce resource so failure stays inside its compartment.",
    how: "Give each dependency or tenant class its own allocation of the constrained resource: separate DB pools, separate HTTP agents with per-host sockets, per-queue worker concurrency, per-tenant rate budgets. When a compartment saturates, ITS requests fail fast — everyone else is untouched.",
    when: "Any service calling multiple dependencies with anything shared: pools, threads, event-loop time. Critical-vs-peripheral split is the design core: checkout gets guaranteed capacity, recommendations and analytics get leftovers with hard caps.",
    ref: "Microsoft Architecture Guide",
    subtopics: [
      { name: "Per-dependency pools", detail: "Pool A for Service X, Pool B for Service Y — X exhausting its 5 connections cannot starve Y's 20. The partition IS the protection; one big pool is one big blast radius." },
      { name: "Fail fast in compartment", detail: "A full bulkhead rejects immediately (or after tiny wait) — never an unbounded queue inside the compartment. Slow failure leaks into other compartments via held threads/sockets." },
      { name: "Budget by criticality", detail: "Allocate to the business: checkout 80%, recommendations 15%, analytics 5%. Sizing is an explicit architectural decision reviewed like schema changes." },
      { name: "Watch per-compartment", detail: "Metrics per bulkhead (saturation, rejections, wait time) turn 'the site is slow' into 'recommendations bulkhead saturated at 14:02' — diagnosable in minutes." },
    ],
    code: `// Per-dependency DB pools: the compartments
const pools = {
  core:   new Pool({ connectionString: CORE_DB, max: 20 }),   // checkout, auth — protected
  recs:   new Pool({ connectionString: REC_DB, max: 4 }),     // recommendations — capped
  reports: new Pool({ connectionString: REPORT_DB, max: 2 }), // analytics — crumbs, on purpose
};

// A compartment-aware query helper: failures stay in their lane
async function scopedQuery(lane, sql, params, timeoutMs = 5000) {
  const client = await pools[lane].connect(); // waits only for ITS pool
  try {
    const result = await Promise.race([
      client.query(sql, params),
      new Promise((_, rej) => setTimeout(() => rej(new Error(lane + " timeout")), timeoutMs)),
    ]);
    return result;
  } catch (err) {
    metrics.increment("bulkhead.failure", { lane });
    throw err; // recs being down never blocks core — different pools entirely
  } finally {
    client.release();
  }
}

// A runaway report saturates the reports pool only:
try {
  await scopedQuery("reports", "SELECT ... five-table cross join ...");
} catch (err) {
  // reports bulkhead full — page still works:
}
const product = await scopedQuery("core", "SELECT * FROM products WHERE id = $1", [id]); // instant, unaffected`,
    steps: ["Pool A for Service X", "Pool B for Service Y", "X exhausts its pool", "Y keeps functioning normally"],
  },
  {
    id: "scale-stickysessions",
    cat: "scale",
    title: "Sticky Sessions",
    one: "Routing a client's requests to the same server for the life of a session.",
    why: "Stateful legacy apps store session state in process memory — and must keep hitting the same instance. Sticky sessions (session affinity) let you scale out WITHOUT fixing statelessness: the LB pins each client to one server via cookie or IP hash.",
    how: "The LB marks the first response with an affinity cookie (or hashes the client IP) and routes subsequent requests from that client to the same target. Capacity changes and deploys break affinity, so instances still need session recovery (shared store or re-login) for correctness over time.",
    when: "A transitional pattern for stateful apps you haven't fixed yet, and for special state like WS connections or warm local caches. New designs: avoid it — shared session stores (Redis) are more reliable, scale better, and make every instance interchangeable. Sticky + in-memory sessions = deploys log users out.",
    ref: "AWS ELB Documentation",
    subtopics: [
      { name: "Cookie-based affinity", detail: "The LB injects a routing cookie (AWSALB, GLBX id); the client echoes it; the LB maps to the same target. Survives client IP changes; breaks if the target dies." },
      { name: "IP hash affinity", detail: "Hash the source IP to a target — no cookie needed, but breaks behind NAT (whole offices pinned to one box) and rebalances whenever the pool size changes." },
      { name: "The imbalance problem", detail: "Sticky breaks even distribution: one heavy client = one overloaded instance while others idle. Autoscaling decisions get noisy. Least-request + shared state is strictly better engineering." },
      { name: "Draining stickiness", detail: "Deploys with sticky sessions must drain: stop sending NEW clients to a target, let affinity holders finish, THEN kill it. Skip this and every deploy amputates live sessions." },
    ],
    code: `// Sticky routing at the LB layer (nginx-style, cookie affinity)
// upstream app_pool {
//   server 10.0.0.1:3000;
//   server 10.0.0.2:3000;
//   server 10.0.0.3:3000;
//   sticky cookie srv_id expires=1h domain=.example.com httponly;
// }

// What it enables: stateful instances that scale... mostly
const sessions = new Map(); // in-process state — works ONLY with sticky sessions
app.post("/login", (req, res) => {
  const sid = crypto.randomUUID();
  sessions.set(sid, { userId: req.body.userId });
  res.json({ sid });
});
app.get("/me", (req, res) => {
  const s = sessions.get(req.query.sid);
  // always lands on the instance that created it — until the LB reshuffles
  res.json({ userId: s?.userId ?? null });
});

// The failure modes to engineer for anyway:
// 1. Target dies -> affinity breaks -> sessions vanish -> users re-login. Design re-auth gracefully.
// 2. Pool resizes -> hash rebinds half the clients. Keep maintenance windows.
// 3. Deploys -> drain first, or every deploy is a mass logout:
//    nginx: server 10.0.0.2:3000 down;  // no new affinity, existing requests drain

// The exit path: replace in-memory Map with Redis -> sticky becomes optional -> remove it.`,
    steps: ["Client's first request", "Assigned to Server A", "Load balancer remembers", "Later requests return to Server A"],
  },
  {
    id: "scale-bluegreentraffic",
    cat: "scale",
    title: "Blue-Green Traffic Shifting",
    one: "Gradually moving load to a new version while watching for errors.",
    why: "Cutover-all-at-once bets 100% of traffic on an untested-in-production release. Blue-green shifting moves 5% → 25% → 100% with error-rate gates between steps: a bad release burns 5% of users for 2 minutes instead of everyone for an hour.",
    how: "Run old (blue) and new (green) in parallel behind the LB. Shift a slice of traffic to green, compare error rate/latency/saturation against blue's baseline, hold or advance. Issues → shift back instantly (it's a weight change). Full cutover only when green's numbers are clean at meaningful load.",
    when: "Any release where you can run both versions simultaneously — which requires schema compatibility (green's writes must not break blue). Pairs with feature flags (shifting traffic AND enabling flags are separate dials) and automated rollback on metric regression.",
    ref: "AWS Documentation",
    subtopics: [
      { name: "Gated steps", detail: "5% (smoke) → 25% → 50% → 100%, holding minutes between. The gates are AUTOMATED: compare green vs blue error rate + p95, regress = auto-rollback. Humans watch; machines pull the trigger." },
      { name: "Baseline comparison", detail: "Judge green against blue's LIVE numbers, not historical averages: a deploy-time traffic spike makes green look bad everywhere. Same window, same traffic mix." },
      { name: "Schema compatibility", detail: "Both versions hit one database: expand/contract migrations are a hard prerequisite. Green adding a column is fine; green renaming one breaks blue instantly." },
      { name: "Instant rollback", detail: "The safety net is the weight dial: shift 0% to green in one API call. Rollback drills prove it — a rollback path nobody has exercised is a theory." },
    ],
    code: `// Traffic shifting with automated gates and rollback
const versions = { blue: { weight: 100 }, green: { weight: 0 } };

async function shift(toGreen) {
  const steps = [5, 25, 50, 100];
  for (const weight of steps) {
    versions.green.weight = weight;
    versions.blue.weight = 100 - weight;
    logger.info("shift", { green: weight });

    await sleep(3 * 60 * 1000); // soak 3 minutes per step

    const [green, blue] = await Promise.all([
      metrics.window("green", "3m"),
      metrics.window("blue", "3m"),
    ]);

    // gate: green must be no worse than blue on errors and latency
    const errorRegression = green.errorRate > blue.errorRate * 1.5 + 0.001;
    const latencyRegression = green.p95 > blue.p95 * 1.25;
    if (errorRegression || latencyRegression) {
      versions.green.weight = 0;
      versions.blue.weight = 100;
      await pager.warn("auto-rollback", { step: weight, green: green.errorRate, blue: blue.errorRate });
      return false;
    }
  }
  await changelog.record("green promoted to 100%");
  return true;
}

// Router: pick by weight, sticky enough for one request's lifetime
function pickTarget() {
  return Math.random() * 100 < versions.green.weight ? "green" : "blue";
}
app.use((req, res, next) => {
  const target = pickTarget();
  req.headers["x-version"] = target; // proxy forwards to the right pool
  next();
});`,
    steps: ["100% on old version", "Shift 10% to new", "Monitor error rate", "Shift to 100% if healthy"],
  },
  {
    id: "scale-canary",
    cat: "scale",
    title: "Canary Releases",
    one: "Rolling a change out to a small percentage of traffic before a full release.",
    why: "Some failures only appear under real traffic: a query plan that's fine at 100 rows and catastrophic at 10M, a cache that inverts into a stampede, a memory leak that needs hours. Canaries expose the change to real load at 5% blast radius — production as the test harness.",
    how: "Deploy the new version to a small slice (canary instances or traffic weight). Watch its metrics against the control group (the stable version) — errors, latency, saturation, business KPIs. Healthy at small size → ramp progressively. Unhealthy → kill the canary; 95% of users never noticed it existed.",
    when: "Default for any service with meaningful traffic and automated metrics. Needs both halves: the small-blast-radius routing AND the automated analysis (a canary without metric comparison is just a slow rollout). Smaller audiences use feature-flag percentages to get the same effect.",
    ref: "Google SRE Book",
    subtopics: [
      { name: "Canary vs control", detail: "Compare canary to the STABLE version's live metrics, same window — not to yesterday's averages. Traffic mix and time-of-day fool absolute thresholds; relative comparison doesn't." },
      { name: "Metric selection", detail: "Golden signals first (error rate, p95/p99 latency, saturation) plus business KPIs (checkout conversion, signup rate). Technical-health-only canaries miss 'the feature is broken but fast'." },
      { name: "Ramp schedule", detail: "1% → 5% → 25% → 100% with soak time per step long enough for slow failures (memory leaks need hours — schedule an overnight soak before the final jump for risky changes)." },
      { name: "Kill switch automation", detail: "The canary's value is measured in minutes-to-kill: automatic rollback on regression beats a human noticing. Alert channels page; the canary API reverts on its own." },
    ],
    code: `// Canary analysis: relative comparison with automatic kill
const canary = { weight: 1, healthy: true };

async function analyzeAndRamp() {
  const schedule = [1, 5, 25, 100];
  for (const target of schedule) {
    canary.weight = target;
    logger.info("canary ramp", { weight: target });

    const soakMs = target === 100 ? 0 : 10 * 60 * 1000;
    await sleep(soakMs);

    // pull matched windows for canary vs control
    const [c, k] = await Promise.all([
      metrics.window({ version: "canary", minutes: 10 }),
      metrics.window({ version: "stable", minutes: 10 }),
    ]);

    const regressions = {
      errors: c.errorRate > k.errorRate * 1.5 + 0.001,
      latency: c.p99 > k.p99 * 1.25,
      saturation: c.cpu > k.cpu * 1.5,
      business: c.checkoutRate < k.checkoutRate * 0.95, // business KPI matters too
    };

    if (Object.values(regressions).some(Boolean)) {
      canary.weight = 0;                    // KILL: instant, automated
      await pager.warn("canary killed", { regressions, weight: target });
      await deploy.rollback("canary");
      return false;
    }
  }
  await changelog.record("canary promoted");
  return true;
}

// Router honors the weight; canary traffic tagged for metric attribution
function route(req) {
  const version = Math.random() * 100 < canary.weight ? "canary" : "stable";
  req.headers["x-deploy-version"] = version; // metrics key: compare apples to apples
  return upstreams[version];
}`,
    steps: ["Deploy to 5% of servers", "Watch metrics closely", "No regressions found", "Roll out to remaining 95%"],
  },
  {
    id: "scale-capacityplanning",
    cat: "scale",
    title: "Capacity Planning",
    one: "Estimating the resources needed to handle expected future load.",
    why: "Run out of capacity and you have an outage; over-provision and you burn 40% of infra budget on idle. Capacity planning is the math that keeps you between: forecasting demand, translating it to resources, and buying lead-time ahead of the curve.",
    how: "Measure current per-unit capacity (one instance = X rps; DB = Y connections; cache = Z GB working set), forecast demand growth (traffic trends, launches, seasonality), then compute: instances = peak rps / per-instance rps × safety factor. Track headroom weekly; buy when headroom crosses the reorder line.",
    when: "Quarterly reviews minimum, before every launch/marketing push/seasonal peak, and whenever per-unit capacity changes (new instance type, new index). The deliverable is a living doc: current limits, forecast, headroom, and the next action per resource.",
    ref: "Google SRE Book",
    subtopics: [
      { name: "Per-unit capacity", detail: "Load-test to learn the real number: one app instance = 320 rps at p95<200ms; one DB writer = 1200 writes/s. Capacity math is only as good as these measured constants." },
      { name: "Forecasting", detail: "Extrapolate growth (traffic +30%/quarter), add known events (launch in March, Black Friday x3), and stress the assumption: what's the number at 2x forecast? That's the plan's error bar." },
      { name: "Headroom & N+1", detail: "Run at ≤60-70% of capacity in steady state: absorbs spikes AND instance loss. N+1 rule: losing your largest node must not breach capacity — during peak, that IS the sizing constraint." },
      { name: "Lead time", detail: "Capacity you need in March must be ordered/planned in January: DB instance classes, provisioned IOPS, Redis memory, and (for on-prem) hardware. The reorder line is lead time + review cadence away from the ceiling." },
    ],
    code: `// A living capacity model — the math, checked weekly
const model = {
  perInstanceRps: 320,          // measured by load test, re-measured each quarter
  currentInstances: 12,
  peakRps: 3100,                // last-30-day peak
  growthQuarterly: 0.30,        // trailing 4-quarter trend
};

function capacityReport({ monthsAhead = 3 }) {
  const capacity = model.perInstanceRps * model.currentInstances;
  const usable = capacity * 0.65;                       // N+1 + headroom policy
  const forecastPeak = model.peakRps * (1 + model.growthQuarterly) ** (monthsAhead / 3);

  const headroom = usable / forecastPeak;
  const instancesNeeded = Math.ceil((forecastPeak / 0.65) / model.perInstanceRps) + 1; // +1: N+1

  const report = {
    now: { capacity, usable, peak: model.peakRps, headroomPct: ((usable / model.peakRps - 1) * 100).toFixed(0) + "%" },
    forecast: { monthsAhead, peak: Math.round(forecastPeak), headroomPct: ((headroom - 1) * 100).toFixed(0) + "%" },
    action: instancesNeeded > model.currentInstances
      ? "ADD " + (instancesNeeded - model.currentInstances) + " instances (lead time applies)"
      : "OK — no action",
  };
  return report;
}

console.log(capacityReport({ monthsAhead: 3 }));
// { forecast: { peak: 4030, headroomPct: '-7%' }, action: 'ADD 4 instances' }

// The DB check most teams forget: connections scale with instances
const connCheck = {
  perInstance: 25, instances: model.currentInstances + 4,
  dbMax: 400, // max_connections
  verdict: ((model.currentInstances + 4) * 25 > 400) ? "REQUIRES POOLER" : "OK",
};`,
    steps: ["Forecast growth", "Estimate resource needs", "Provision ahead of demand", "Review and adjust"],
  },
  {
    id: "scale-latencythroughput",
    cat: "scale",
    title: "Latency vs Throughput",
    one: "Latency is how fast one request completes; throughput is requests completed per second.",
    why: "They trade against each other and optimizing the wrong one wastes the sprint: batching boosts throughput and hurts individual latency; parallelism cuts latency while raising resource use. Knowing which your users (and your SLOs) actually measure is the first scaling decision.",
    how: "Latency = time per request, reported as percentiles (p50, p95, p99 — averages lie). Throughput = completed work per unit time (rps, jobs/min). They couple through concurrency (Little's Law: latency = concurrency / throughput) — a queue forms the moment arrivals exceed throughput, and tail latency explodes first.",
    when: "Optimize latency for interactive paths (APIs, page loads — users feel p95); optimize throughput for background work (jobs, pipelines — the queue is the interface). Measure both always: throughput without latency hides saturation; latency without throughput hides underutilization.",
    ref: "Google SRE Book",
    subtopics: [
      { name: "Percentiles, not averages", detail: "p50=50ms / p99=2s means 1 in 100 users suffers 40x. Averages hide them completely. Track p50/p95/p99/p99.9 separately — each percentile is a different user population." },
      { name: "Little's Law", detail: "L = λ × W: concurrency = arrival rate × wait time. It tells you queue depth before you build: 500 rps × 0.2s = 100 in-flight requests per instance — that's your connection/thread budget." },
      { name: "The batching trade", detail: "Batching 10 writes into one transaction: throughput up 5-8x, single-write latency up slightly. Perfect for pipelines; wrong for checkout. Decide per path, not per codebase." },
      { name: "Saturation shows in the tail", detail: "Before throughput plateaus, p99 spikes — queueing starts at ~70% utilization. The tail is your early-warning system: p99 climbing means capacity planning time, not yet an outage." },
    ],
    code: `// Measure BOTH, correctly, everywhere
function recorder(name) {
  const samples = [];
  return {
    observe(ms) {
      samples.push(ms);
      if (samples.length > 10000) samples.shift();
    },
    snapshot() {
      const sorted = [...samples].sort((a, b) => a - b);
      const pct = (p) => sorted[Math.floor(sorted.length * p)] ?? 0;
      return {
        p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), // never an average alone
        count: sorted.length,
      };
    },
  };
}
const latency = recorder("checkout");

let completed = 0;
setInterval(() => {
  metrics.gauge("throughput.rps", completed / 10); // throughput: work per second
  completed = 0;
  metrics.gauge("latency.p99", latency.snapshot().p99); // latency: the user's experience
}, 10000);

// Little's Law: size the concurrency budget from measured numbers
const CONCURRENCY = Math.ceil(ARRIVAL_RPS * TARGET_LATENCY_S);
// 500 rps × 0.2s = 100 in-flight max per instance — set pool/thread limits to match
const pool = new Pool({ max: CONCURRENCY });

// The batching decision, made per path with both numbers:
// pipeline (background):  batch 50 inserts -> 8x throughput, +4ms latency. DO IT.
// checkout (interactive): batch nothing    -> throughput irrelevant, latency is money. DON'T.`,
    steps: ["Single request timed (latency)", "Many requests over time", "Count completed per second", "Throughput measured"],
  },
  {
    id: "scale-loadtesting",
    cat: "scale",
    title: "Load Testing",
    one: "Simulating heavy traffic before launch to find where a system breaks.",
    why: "You don't know your capacity until you exceed it — and finding that out during Black Friday is the most expensive possible discovery. Load testing finds the breaking point, the bottleneck order, and the recovery behavior while it's still cheap to fix.",
    how: "Generate synthetic traffic matching real shapes (endpoints mix, payload sizes, think times) at increasing levels: baseline → expected peak → 2x. Watch golden signals AND downstream saturation (DB connections, queue depth, cache hit ratio) — the first resource to saturate is your next bottleneck, named.",
    when: "Before launches, before seasonal peaks, after major architecture changes, and quarterly on critical paths. Rules: test like you operate (same infra, realistic data volume), never test prod unannounced, and always test RECOVERY (drop load and watch it stabilize) — many systems break once and never recover.",
    ref: "k6 Documentation",
    subtopics: [
      { name: "Realistic scenarios", detail: "Record/replay real endpoint mixes with think times — 100% GET /homepage at 5000 rps tests nothing. The failure you're pre-empting arrives as your REAL traffic shape." },
      { name: "Ramp + soak + spike", detail: "Ramp tests the breaking point; soak (hours at 60%) finds leaks and connection rot; spike tests burst absorption (2x in 30s). Each answers a different question; run all three." },
      { name: "Watch downstream, not just the endpoint", detail: "The app tier survives; the DB connection pool dies at step 6. Instrument every layer during tests — saturation order is the roadmap of what to fix first." },
      { name: "Recovery is the test", detail: "Drop load after breaking point and watch: latency back to baseline in 60s = healthy. Stuck at degraded = retry storms, queue debt, or connection leaks that will turn one spike into an outage." },
    ],
    code: `// k6 load test: ramp to peak, hold, spike, recover
// import http from 'k6/http';
// import { check, sleep } from 'k6';
//
// export const options = {
//   scenarios: {
//     ramp: {
//       executor: 'ramping-arrival-rate',
//       startRate: 50, timeUnit: '1s',
//       preAllocatedVUs: 200, maxVUs: 2000,
//       stages: [
//         { target: 200, duration: '2m' },   // baseline
//         { target: 800, duration: '5m' },   // expected peak
//         { target: 1600, duration: '3m' },  // 2x: find the break
//         { target: 800, duration: '5m' },   // recovery: does it stabilize?
//       ],
//     },
//   },
//   thresholds: {
//     http_req_duration: ['p(95)<200'],      // the SLO, as a pass/fail gate
//     http_req_failed: ['rate<0.001'],
//   },
// };
//
// export default function () {
//   const res = http.get('https://staging.example.com/v1/products?featured=true');
//   check(res, { 'status 200': (r) => r.status === 200 });
//   sleep(Math.random() * 3); // think time: humans aren't loops
// }

// While it runs, watch the DOWNSTREAM saturation order — that's the fix list:
async function saturationSnapshot() {
  const [db, queue, cache] = await Promise.all([
    pool.query("SELECT count(*) FROM pg_stat_activity WHERE state = 'active'"),
    mainQueue.getWaitingCount(),
    redis.info("stats").then((s) => s.match(/keyspace_hits:(\\d+)/)?.[1]),
  ]);
  console.log(JSON.stringify({
    dbActive: db.rows[0].count + "/" + POOL_MAX,   // first to hit max = first bottleneck
    queueDepth: queue,                              // growing = workers underprovisioned
    cacheHits: cache,                               // dropping = working set > memory
  }));
}`,
    steps: ["Simulate concurrent users", "Ramp up load", "Monitor system response", "Identify breaking point"],
  },
  {
    id: "scale-hpa",
    cat: "scale",
    title: "Horizontal Pod Autoscaler",
    one: "Kubernetes automatically adjusts pod replica count based on observed metrics.",
    why: "Manual kubectl scale is 3 a.m. pager work. The HPA closes the loop inside the cluster: metrics say busy → replicas increase; metrics say idle → replicas shrink. It's autoscaling as a declarative resource — the promise, not the procedure.",
    how: "You declare: target deployment + metric + target value (70% CPU, or 1000 rps per pod via custom metrics). The HPA controller polls metrics every 15s, computes desired replicas = ceil(current × currentMetric/target), and applies bounded by min/max. Scale-in stabilizes (windows, cooldowns) to prevent flapping.",
    when: "Any stateless deployment on K8s with variable load. CPU/memory targets for simple cases; custom metrics (queue depth, rps) for real accuracy. Not for stateful sets (databases) — and only works if pods ACTUALLY request resources (requests/limits set) since CPU% is relative to request.",
    ref: "Kubernetes Documentation",
    subtopics: [
      { name: "The math", detail: "desiredReplicas = ceil(currentReplicas × currentMetricValue / targetValue). 4 pods at 90% CPU targeting 70% → ceil(4 × 90/70) = 6 pods. Simple, stable, and metric-source-dependent." },
      { name: "Requests are the denominator", detail: "CPU% is usage / REQUESTED cpu. Pods without requests read 9999% and scale permanently. Setting requests/limits is a prerequisite, not a nicety." },
      { name: "Custom metrics", detail: "CPU misleads for IO-bound services. Custom Metric APIs (Prometheus adapter) scale on what matters: rps-per-pod, queue depth, p95 latency — HPA reads them like any metric." },
      { name: "Scale-in stabilization", detail: "Removing pods on every dip causes flapping. stabilizationWindow (default 5m for scale-down) +PodDisruptionBudgets keep shrinking polite: drain, respect budgets, never strand in-flight requests." },
    ],
    code: `// The declarative promise: "keep CPU near 70%, between 3 and 30 pods"
// apiVersion: autoscaling/v2
// kind: HorizontalPodAutoscaler
// metadata: { name: web-hpa }
// spec:
//   scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: web }
//   minReplicas: 3
//   maxReplicas: 30
//   metrics:
//     - type: Resource
//       resource:
//         name: cpu
//         target: { type: Utilization, averageUtilization: 70 }
//     - type: Pods                                # custom metric: real load signal
//       pods:
//         metric: { name: http_requests_per_second }
//         target: { type: AverageValue, averageValue: "150" }
//   behavior:
//     scaleDown:
//       stabilizationWindowSeconds: 300           # no flapping
//       policies: [{ type: Percent, value: 25, periodSeconds: 60 }]
//     scaleUp:
//       policies: [{ type: Percent, value: 100, periodSeconds: 30 }] # double fast

// The prerequisite that makes CPU% meaningful — requests are the denominator:
// kind: Deployment -> containers:
//   resources:
//     requests: { cpu: "500m", memory: "512Mi" }
//     limits:   { memory: "1Gi" }

// HPA computes: ceil(4 * (90 / 70)) = 6 replicas. Metrics server does the watching.
// kubectl get hpa web-hpa --watch
// web-hpa  Deployment/web  cpu: 91%/70%  3  30  6`,
    steps: ["Metric exceeds target", "HPA controller notices", "Replica count increased", "Load spread across new pods"],
  },
  {
    id: "scale-cdnoffload",
    cat: "scale",
    title: "CDN Offloading",
    one: "Routing static or heavy traffic away from origin servers to edge networks.",
    why: "Every byte served from origin costs you twice: bandwidth money and capacity that dynamic requests need. CDNs serve the same bytes from edges for a fraction of the cost — offloading is the rare optimization that improves latency, capacity, AND budget simultaneously.",
    how: "Move cacheable content to the edge: static assets with hashed URLs, media files, and (with s-maxage) cacheable API responses. The origin sees only cache misses. Offload ratio (edge hits / total) is the metric — 90%+ offload for asset-heavy sites is normal and transforms origin sizing math.",
    when: "Any site with static assets, media, or downloadable content — which is all of them. The frontier is dynamic offload: API GETs and HTML with short TTLs and correct cache keys. Not for authenticated per-user responses unless cache keys make personalization safe.",
    ref: "Cloudflare Documentation",
    subtopics: [
      { name: "Offload ratio", detail: "edge hits ÷ total requests. Drive it up with long TTLs + hashed URLs (never purged), shield origins against miss storms, and cache aggressively at every tier." },
      { name: "Media is the big win", detail: "Video, images, downloads dwarf HTML bytes 100:1. One 2GB video seed file served 10,000 times = 20TB from edges instead of your origin egress bill." },
      { name: "Dynamic offload", detail: "s-maxage on API GETs and HTML: even 30s caching at edge cuts origin load by the request rate × 30s worth. Cache-key design (normalize queries) determines hit ratio." },
      { name: "Origin protection math", detail: "Capacity planning inverts: size origin for (1 - offload) × peak, not peak. At 95% offload, a 50k rps peak hits origin with 2.5k rps — the difference between 3 servers and 60." },
    ],
    code: `// Push everything cacheable to the edge; measure what remains
app.get("/v1/products/:id", async (req, res) => {
  res.set({
    // edge caches 60s: origin sees this endpoint at 1/60th of its request rate
    "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
    "Cache-Tag": "product:" + req.params.id,
  });
  res.json({ data: await catalog.get(req.params.id) });
});

// Media: never streamed from origin — pre-signed CDN URLs
app.get("/v1/downloads/:assetId", async (req, res) => {
  const asset = await db.assets.find(req.params.assetId);
  if (!asset) return res.status(404).end();
  // 302 to the CDN edge: origin sends ~200 bytes instead of 2GB
  res.redirect(302, cdn.signedUrl("/media/" + asset.key, { expiresIn: 300 }));
});

// The sizing math offload buys you:
function originSizing({ peakRps, offloadRatio, perInstanceRps }) {
  const originRps = peakRps * (1 - offloadRatio);
  return {
    offloadRatio,
    originRps: Math.round(originRps),
    instances: Math.ceil(originRps / perInstanceRps) + 1,
    saved: (Math.ceil(peakRps / perInstanceRps) - Math.ceil(originRps / perInstanceRps)) + " instances",
  };
}
console.log(originSizing({ peakRps: 50000, offloadRatio: 0.95, perInstanceRps: 320 }));
// { originRps: 2500, instances: 9, saved: '147 instances' }`,
    steps: ["Static asset requested", "Served from CDN edge", "Origin server untouched", "Origin capacity freed for dynamic requests"],
  },
  {
    id: "scale-connlimits",
    cat: "scale",
    title: "Database Connection Limits",
    one: "Every database has a maximum connection count that scaling must respect.",
    why: "The scaling math nobody does until 3 a.m.: each app instance holds a pool, and instances multiply — 20 instances × 20 connections = 400, and Postgres's max_connections is 400. The 21st instance doesn't add capacity; it adds connection-refused errors fleet-wide.",
    how: "Two directions. Reduce demand: smaller per-instance pools, transaction-mode pooling (PgBouncer multiplexes thousands of clients over dozens of real connections). Increase supply carefully: raising max_connections costs per-connection memory (~5-10MB each) and context-switching — beyond ~500 connections Postgres itself slows.",
    when: "Do the math before every horizontal scaling step: instances × pool size vs max_connections, minus headroom for migrations, cron jobs, and humans. Serverless (hundreds of ephemeral instances) makes direct connections structurally impossible — a pooler or HTTP-based driver is mandatory, not optional.",
    ref: "PostgreSQL Documentation",
    subtopics: [
      { name: "The fleet multiplication", detail: "Connections = instances × pool.max. Track it in the capacity doc next to instance counts; every autoscaling event changes the DB math too. Autoscaler policies and pool sizes must be designed together." },
      { name: "PgBouncer transaction mode", detail: "Clients borrow a real connection per TRANSACTION, not per session: 1000 client connections share 30 real ones. The trade: session state (prepared statements, SETs) needs care." },
      { name: "Connection memory math", detail: "Each Postgres connection is a process: work_mem × complex queries + ~5MB base. 1000 connections can eat more RAM than the buffer pool — the DB slows down exactly when you 'added capacity'." },
      { name: "Waiting is a feature", detail: "A pool queue (wait up to N seconds) converts connection exhaustion from errors into latency. Fail-fast with a queue beats connection-refused storms; monitor wait time as the saturation signal." },
    ],
    code: `// The math, enforced in code — capacity planning as a runtime check
const FLEET = {
  instances: 20,
  poolMaxPerInstance: 15,     // tuned DOWN from the default 20
  dbMaxConnections: 400,
  reserve: 50,                // headroom: migrations, cron, DBA humans
};

function connectionBudget() {
  const used = FLEET.instances * FLEET.poolMaxPerInstance;
  const available = FLEET.dbMaxConnections - FLEET.reserve;
  return {
    used,
    available,
    headroom: available - used,
    verdict: used > available ? "SCALING BLOCKED: add PgBouncer first" : "OK",
  };
}
console.log(connectionBudget()); // { used: 300, available: 350, headroom: 50, verdict: 'OK' }

// Instance-local pool tuned to the fleet math
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: FLEET.poolMaxPerInstance,
  connectionTimeoutMillis: 3000, // wait in the queue, then fail loudly
});

// PgBouncer for the serverless / large-fleet endgame:
// [pgbouncer]
// pool_mode = transaction          # 1000 clients share 30 real connections
// default_pool_size = 30
// max_client_conn = 2000
// app connects to: postgres://pgbouncer.internal:6432/app

// Saturation monitoring: pool wait time is the early warning
pool.on("connect", () => metrics.increment("db.connect"));
setInterval(() => {
  metrics.gauge("db.pool.waiting", pool.waitingCount);
  if (pool.waitingCount > 10) logger.warn("pool saturated — check fleet math");
}, 5000);`,
    steps: ["Servers scale out", "Each opens connections", "Limit approaches max", "Connection pooling required"],
  },
  {
    id: "scale-multiregion",
    cat: "scale",
    title: "Multi-Region Deployment",
    one: "Running the system in multiple geographic regions for latency and resilience.",
    why: "Two truths: physics (Sydney users wait 200ms+ for Virginia, forever) and fate (cloud regions DO go down — whole us-east-1 outages are historical fact). Multi-region fixes both: serve users from the closest region and survive the loss of any one of them.",
    how: "Deploy the full stack to 2+ regions behind global routing (GeoDNS, anycast, global LB). Data strategy is the hard part: active-passive (one region writes, others replicate for DR) or active-active (all regions write — needs CRDT/last-write-wins/replicated data layer and conflict discipline). Failover is health-based DNS/weight shifting.",
    when: "When users are globally distributed (latency justifies it) or the business requires regional-failure survival (RTO minutes, not hours). It multiplies cost and complexity — start with active-passive DR and a CDN; advance to active-active only with a data story you can actually operate.",
    ref: "AWS Documentation",
    subtopics: [
      { name: "Active-passive", detail: "One region serves; others stand warm (replicated data, smaller capacity). Failover = DNS/weight shift + promotion. 10x simpler than active-active; RTO is minutes, most non-financial systems live here." },
      { name: "Active-active", detail: "All regions serve their locale's traffic and writes. Latency: excellent. Data: the hard problem — cross-region replication lag means conflict handling (last-write-wins, CRDTs) and read-your-writes routing. Budget months." },
      { name: "Global routing", detail: "GeoDNS (latency or geo policy), anycast IPs, or a global LB (CloudFront/Cloudflare/Front Door). Health-checked at region granularity: failover is a routing table change, not a human scramble." },
      { name: "Data gravity", detail: "Replication is the tax: async (lag, possible loss) vs sync (cross-region RTT on every commit — 100ms+). Most systems: sync within region, async across regions, and design for convergence rather than truth." },
    ],
    code: `// Global routing: users land in the closest healthy region
// GeoDNS policy (Route53 lat/geo):
//   eu-west-1  -> eu users,  weight 100, health check /healthz
//   us-east-1  -> us users,  weight 100, health check /healthz
//   failover:  unhealthy region's weight -> 0 (automatic with health checks)

// Per-region app: identical, region-pinned resources
const REGION = process.env.AWS_REGION; // injected per deployment
const pool = new Pool({ host: \`db.\${REGION}.internal\` }); // local DB only

// Writes: local region + async cross-region replication (the pragmatic 95%)
async function placeOrder(userId, cart) {
  const order = await pool.query("INSERT INTO orders ... RETURNING *", [userId, cart]);
  // replication to the other region happens at the storage layer (Aurora Global, etc.)
  return order;
}

// Read-your-writes across regions: session stickiness to the writing region
function requireSession(req, res, next) {
  const home = req.cookies.homeRegion ?? REGION;
  if (home !== REGION && req.method !== "GET") {
    // writes from a visitor of another region: proxy home, or accept async
    return proxyToRegion(home, req, res);
  }
  next();
}

// Region health is the failover trigger — one dead region, traffic rebalances
setInterval(async () => {
  const peers = await healthRegistry.all();
  const dead = peers.filter((p) => p.unhealthy);
  if (dead.length) logger.warn("region degraded", { regions: dead.map((d) => d.name) });
  // GeoDNS health checks handle rerouting automatically; this is for observability
}, 15000);`,
    steps: ["User in Region A", "Served from Region A", "Region A fails", "Traffic rerouted to Region B"],
  },
  {
    id: "scale-chaos",
    cat: "scale",
    title: "Chaos Engineering",
    one: "Deliberately injecting failures to verify a system survives them.",
    why: "Every system HAS a failure mode you haven't tested — you just discover it during the incident instead of before. Chaos engineering runs those failures as controlled experiments: hypothesis, injection, observation. The outage happens on YOUR schedule, with a rollback button.",
    how: "Form a hypothesis about steady-state behavior ('losing one instance keeps error rate < 0.1%'), inject reality (kill pods, add latency, blackhole a dependency, fill disks), observe against the hypothesis, and improve what breaks. Start small in staging, escalate blast radius, always with abort conditions.",
    when: "After observability exists (you can't learn from chaos you can't see) and basics are stable. Start with safe injections: pod kills in staging, dependency latency games in low-traffic hours, game days where the team manually executes failure scenarios. Automate only what staging survived.",
    ref: "Principles of Chaos Engineering",
    subtopics: [
      { name: "Steady-state hypothesis", detail: "Define 'healthy' in metrics BEFORE injecting: error rate < 0.1%, p95 < 300ms. The experiment tests whether the hypothesis survives — not whether it 'feels fine'." },
      { name: "Injection toolbox", detail: "Instance death (kill pods), latency injection (toxiproxy 500ms on the DB), dependency blackhole, clock skew, disk full, cert expiry. Each targets one resilience claim: timeouts, breakers, failover." },
      { name: "Blast radius control", detail: "Abort conditions wired in advance: error rate > 1% for 60s = auto-stop injection. Start with one pod in staging, not the prod database. Chaos is an experiment, not an outage with extra steps." },
      { name: "Game days", detail: "The team-level exercise: scenario announced ('region fails at 14:00'), roles assigned, runbook executed live, findings documented. The cultural half of chaos — rehearsing the incident before it's real." },
    ],
    code: `// A chaos experiment runner: hypothesis + injection + abort
async function chaosExperiment({ name, hypothesis, inject, abort, durationMs }) {
  logger.info("experiment start", { name, hypothesis });
  const baseline = await metrics.window("5m");

  const aborter = setInterval(async () => {
    const now = await metrics.window("1m");
    if (await abort(now)) {
      logger.error("ABORT: steady state violated", { name, now });
      await cleanup(); // injection's undo function
      process.exit(2);
    }
  }, 10000);

  const undo = await inject(); // reality, on your schedule
  await sleep(durationMs);
  clearInterval(aborter);
  await undo();

  const after = await metrics.window("5m");
  const findings = { name, recovered: after.errorRate <= baseline.errorRate * 1.2, baseline, after };
  logger.info("experiment complete", findings);
  return findings;
}

// Experiment: do our timeouts + breakers survive a slow dependency?
await chaosExperiment({
  name: "payments-api-latency",
  hypothesis: "p95 stays < 500ms and checkout still works when payments adds 3s latency",
  inject: async () => {
    await toxiproxy.addToxic("payments", { type: "latency", attrs: { latency: 3000 } });
    return () => toxiproxy.removeToxic("payments", "latency");
  },
  abort: async (m) => m.errorRate > 0.01 || m.p95 > 1000, // abort = auto-rollback
  durationMs: 5 * 60 * 1000,
});
// Findings feed tickets: "breaker opened at 42s but checkout timeout was 30s — tighten"`,
    steps: ["System running normally", "Inject failure (kill instance)", "Observe system response", "Fix weaknesses found"],
  },
];