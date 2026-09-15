import type { Concept } from "../types";

export const ARCH: Concept[] = [
  {
    id: "arch-monomicro",
    cat: "arch",
    title: "Monolith vs Microservices",
    one: "One deployable app versus many small, independently-deployable services.",
    why: "The deployment question shapes everything: how fast you ship, how you scale, how teams coordinate. Monoliths optimize for iteration speed and simplicity; microservices optimize for independent scaling and team autonomy — at a heavy operational price.",
    how: "A monolith is one codebase, one process, one deploy: in-process function calls, one transaction boundary, one log stream. Microservices split along business boundaries into separately deployed services communicating over the network — each with its own database, scaling, and failure modes.",
    when: "Start with a modular monolith — one deploy, strict internal module boundaries. Split into services when you have evidence: teams blocked waiting on each other, wildly different scaling profiles (recommendation ML vs CRUD), or independent release cadences. Distributed systems tax (network failures, eventual consistency, ops burden) must be paid on purpose.",
    ref: "Sam Newman — Building Microservices",
    subtopics: [
      { name: "The modular monolith", detail: "One deployable with enforced module boundaries (no cross-module table access). Most of the architecture benefits, none of the network pain — and extraction later is mechanical." },
      { name: "Independent deploys", detail: "The real microservices prize: team A ships 5x/day without coordinating with team B. If your 'microservices' deploy together, you have a distributed monolith — worst of both." },
      { name: "Database per service", detail: "Each service owns its schema; others read via its API or events. Shared databases re-couple everything and make every schema change a cross-team negotiation." },
      { name: "The distributed tax", detail: "Every in-process call becomes a network call that can timeout, duplicate, or reorder: retries, circuit breakers, tracing, and saga patterns are the entry fee." },
    ],
    code: `// MONOLITH: one process, one transaction, a function call
async function placeOrderMonolith(userId, cart) {
  const client = await pool.connect(); // single DB, single transaction
  try {
    await client.query("BEGIN");
    const order = await createOrder(client, userId, cart);      // orders module
    await reserveInventory(client, cart);                        // inventory module
    await chargeCard(client, userId, cart.totalCents);           // billing module
    await client.query("COMMIT"); // atomic across all three — free in a monolith
    return order;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// MICROSERVICES: the same flow spans three services and networks
async function placeOrderDistributed(userId, cart) {
  const order = await ordersClient.create(userId, cart);          // HTTP/gRPC — can timeout
  try {
    await inventoryClient.reserve(order.id, cart);                // can fail AFTER orders committed
    await billingClient.charge(order.id, cart.totalCents);        // can fail after both
  } catch (err) {
    await ordersClient.compensate(order.id); // saga: undo step 1 — no shared transaction exists
    throw err;
  }
  return order;
  // now you also own: retries, idempotency keys, tracing, service discovery...
}`,
    steps: ["Monolith: one codebase", "One deploy", "Microservices: many services", "Independent deploys"],
  },
  {
    id: "arch-queue",
    cat: "arch",
    title: "Message Queues",
    one: "A producer drops a job in a queue; a worker picks it up when free.",
    why: "Doing everything inline couples your response time to your slowest task and your uptime to your busiest dependency. A queue decouples them: producers return instantly, workers process at their own pace, traffic spikes get absorbed as depth instead of downtime.",
    how: "Producer appends a message (job payload + metadata); broker persists it (Redis, RabbitMQ, SQS, Kafka); consumers pull when ready and acknowledge when done. Unacked messages redeliver (at-least-once semantics — consumers must be idempotent), and repeatedly-failing messages route to a dead-letter queue.",
    when: "Use for anything that doesn't need to finish inside the request: emails, thumbnails, webhooks fan-out, report generation, order fulfillment. Don't queue what the user is waiting on — the response path stays synchronous; the queue is for everything after 'success' is returned.",
    ref: "BullMQ Documentation",
    subtopics: [
      { name: "Producer-consumer decoupling", detail: "The web service neither knows nor cares how many workers exist. Deploy workers independently, scale them by queue depth, restart them mid-day." },
      { name: "At-least-once delivery", detail: "Queues guarantee delivery by redelivering unacked messages — duplicates WILL happen. Every handler is idempotent by design (job ID dedupe)." },
      { name: "Visibility timeout", detail: "A worker 'checks out' a message for N seconds; if it crashes mid-job, the timeout expires and the message redelivers to another worker. Set it above your worst processing time." },
      { name: "Backpressure by depth", detail: "Queue depth is your load signal: alerts at thresholds, autoscale workers on depth, and reject-at-the-door (429) when the queue itself would grow unboundedly." },
    ],
    code: `// Producer: the request returns in 2ms — work happens later
app.post("/signup", express.json(), async (req, res) => {
  const user = await db.users.create(req.body);

  await emailQueue.add("welcome", { userId: user.id }, { attempts: 5, backoff: { type: "exponential", delay: 2000 } });
  await thumbnailsQueue.add("avatar", { userId: user.id, image: user.avatarUrl });

  res.status(201).json({ data: { id: user.id } }); // user isn't waiting on SMTP
});

// Consumer: separate process, independent scale, idempotent handler
const worker = new Worker(
  "emails",
  async (job) => {
    const seen = await redis.set("job:" + job.id, "1", { NX: true }); // dedupe: at-least-once
    if (!seen) return; // already processed — skip silently

    const user = await db.users.find(job.data.userId);
    await smtp.send({ to: user.email, template: "welcome" });
  },
  { concurrency: 10 }
);

worker.on("failed", async (job, err) => {
  logger.error("job failed", { jobId: job.id, attempts: job.attemptsMade, error: err.message });
  if (job.attemptsMade >= 5) await deadLetterQueue.add("emails", job.data);
});

// Autoscale signal: depth per queue
setInterval(async () => {
  const waiting = await emailQueue.getWaitingCount();
  if (waiting > 5000) scaler.scaleWorkers("email-worker", Math.ceil(waiting / 1000));
}, 15000);`,
    steps: ["Producer", "Queue", "Worker picks up job", "Job processed"],
  },
  {
    id: "arch-middleware",
    cat: "arch",
    title: "Middleware Pipeline",
    one: "Each request passes through a chain of functions before reaching the handler.",
    why: "Auth, logging, parsing, CORS, rate limiting — every request needs the same preamble. Middleware composes these once, in order, so handlers stay pure business logic and cross-cutting concerns live in exactly one audited place.",
    how: "Each middleware receives (req, res, next): do your work, then call next() to pass control down; the chain unwinds on the way back (response phase). It's the onion model — request travels inward through every layer, response travels back out through them in reverse.",
    when: "Use for everything orthogonal to business logic: request ID, body parsing, auth, authorization, compression, error handling (the LAST middleware — it sees errors thrown downstream). Resist stuffing business decisions into middleware; it's for mechanics, not domain rules.",
    ref: "Express.js Documentation",
    subtopics: [
      { name: "Order is the architecture", detail: "requestId → parse → security headers → auth → rate limit → routes → error handler. Register error handling last so it wraps everything; auth before anything that needs identity." },
      { name: "next(err) propagation", detail: "Calling next(err) skips every remaining middleware until an error handler. One bad middleware that forgets next() hangs the request forever." },
      { name: "Async middleware", detail: "Express 4 doesn't catch rejected async middleware — wrap handlers (or use Express 5) or one throw becomes an unhandled rejection and a hung request." },
      { name: "The onion unwinds", detail: "Code after next() runs during the response phase: log request + status + duration in ONE middleware by wrapping next() instead of hooking res events." },
    ],
    code: `// The onion, built by hand — each layer wraps the next
function compose(middleware) {
  return (req, res) => {
    let i = 0;
    function next(err) {
      const mw = middleware[i++];
      if (err || !mw) return done(err, req, res); // skip to error handler
      try {
        mw(req, res, next); // may be async-wrapped in real frameworks
      } catch (e) {
        next(e);
      }
    }
    next();
  };
}

const app = compose([
  function requestId(req, res, next) {
    req.id = crypto.randomUUID();
    res.setHeader("X-Request-Id", req.id);
    next();
  },
  async function auth(req, res, next) {
    req.user = await verifyToken(req.headers.authorization).catch(() => null);
    next(); // identity resolved; handlers decide if it's required
  },
  function rateLimit(req, res, next) {
    if (overLimit(req.ip)) { res.statusCode = 429; return res.end(); }
    next();
  },
  function handler(req, res) {
    res.end(JSON.stringify({ hello: req.user?.name ?? "anonymous" }));
  },
]);

function done(err, req, res) {
  if (err) { res.statusCode = 500; res.end("internal error"); }
}
// request flows: requestId -> auth -> rateLimit -> handler
// response unwinds back through them in reverse.`,
    steps: ["Request", "Auth check", "Logger", "Validator", "Route handler"],
  },
  {
    id: "arch-eventdriven",
    cat: "arch",
    title: "Event-Driven Architecture",
    one: "Services communicate by emitting and reacting to events rather than direct calls.",
    why: "Point-to-point API calls create a dependency mesh: orders must know about email, analytics, inventory, fraud. Events invert it — orders announces 'OrderPlaced' and whoever cares subscribes. Adding a consumer changes nothing about the producer.",
    how: "Producers write facts (past tense, immutable: OrderPlaced, PaymentFailed) to a broker (Kafka, RabbitMQ, SNS). Consumers subscribe to event types, process independently, and manage their own failures and offsets. Delivery is asynchronous: producers don't know who consumed, or if.",
    when: "Use for workflows spanning services (fulfillment pipelines), fan-out to many consumers, and integration between bounded contexts. Keep synchronous calls for the request path where the user waits on an answer — events are for reactions, not for 'what's the price?' lookups.",
    ref: "AWS Documentation",
    subtopics: [
      { name: "Events are facts", detail: "Named in past tense with full context: OrderPlaced(orderId, userId, total, items). Consumers shouldn't need to call back the producer to understand the event." },
      { name: "Temporal decoupling", detail: "The email service can be DOWN when orders are placed — it processes the backlog when it recovers. Availability of the whole exceeds availability of parts." },
      { name: "Event schema evolution", detail: "Consumers run older code: add optional fields, never rename or repurpose. Version topics/events (OrderPlaced.v2) when shapes break." },
      { name: "Eventual consistency by design", detail: "After OrderPlaced, inventory projections are briefly stale. Consumers design for idempotent, out-of-order, and delayed delivery — or you'll debug 3 a.m. ghosts." },
    ],
    code: `// Producer: writes a fact, knows nothing about consumers
async function placeOrder(userId, cart) {
  const order = await ordersDb.create(userId, cart);
  await kafka.send("orders", {
    type: "OrderPlaced",
    version: 1,
    orderId: order.id,
    userId,
    totalCents: cart.totalCents,
    items: cart.items,
    occurredAt: new Date().toISOString(),
  });
  return order;
}

// Consumer 1 (email service) — independent deploy, own failure handling
kafka.on("OrderPlaced", async (event) => {
  if (event.type !== "OrderPlaced") return;
  await idempotent("email:" + event.orderId, async () =>
    smtp.send({ to: await emailOf(event.userId), template: "order-confirm", data: event })
  );
});

// Consumer 2 (analytics) — same event, different concern, zero producer changes
kafka.on("OrderPlaced", (event) => warehouse.insert("order_events", event));

// Consumer 3 (inventory) — reacts and emits its own fact
kafka.on("OrderPlaced", async (event) => {
  await inventory.reserve(event.items);
  await kafka.send("inventory", { type: "StockReserved", orderId: event.orderId });
});

// Idempotency: delivery is at-least-once
async function idempotent(key, fn) {
  if (!(await redis.set(key, "1", { NX: true, EX: 86400 }))) return; // seen it
  await fn();
}`,
    steps: ["Service A emits event", "Event bus", "Service B reacts", "Service C reacts independently"],
  },
  {
    id: "arch-pubsub",
    cat: "arch",
    title: "Pub/Sub",
    one: "Publishers emit messages to a topic; any number of subscribers receive them.",
    why: "Direct queues connect one producer to one consumer; pub/sub broadcasts one message to every interested party. It's the abstraction that makes fan-out cheap — one 'price.changed' event reaches cache, websocket push, analytics, and mobile notifications simultaneously.",
    how: "Messages go to named topics, not to consumers. Each subscriber holds its own subscription with its own delivery and ack state: one slow consumer doesn't slow others. Brokers range from in-process EventEmitters to Redis pub/sub (fire-and-forget) to Google Pub/Sub/Kafka (durable, replayable).",
    when: "Use for broadcast semantics: cache invalidation across instances, realtime push to many clients, integration events with several consumers. Know your delivery model — Redis pub/sub loses messages if no one is listening; durable systems (Kafka, Google Pub/Sub) retain per-subscriber state.",
    ref: "Google Cloud Pub/Sub Documentation",
    subtopics: [
      { name: "Topics vs queues", detail: "Queue: one message, one consumer (work distribution). Topic: one message, every subscriber (event distribution). Most real systems need both shapes." },
      { name: "Subscriber independence", detail: "Each subscription acks independently — analytics lagging 10 minutes doesn't hold back websocket push. Slow consumers fall behind privately." },
      { name: "At-most-once vs durable", detail: "Redis pub/sub: fire-and-forget, gone if unlistened (fine for live ticks). Durable pub/sub retains until acked per subscription — choose by 'can we afford to miss one?'." },
      { name: "Ordering guarantees", detail: "Global ordering kills throughput; brokers order per-key (partition by orderId). Design consumers for per-entity ordering, chaos across entities." },
    ],
    code: `// A Redis-backed pub/sub hub with room semantics
const { createClient } = require("redis");
const pub = createClient(), sub = createClient();
await pub.connect(); await sub.connect();

// Subscribe: rooms via pattern
await sub.pSubscribe("room:*", (message, channel) => {
  const roomId = channel.split(":")[1];
  for (const client of rooms.get(roomId) ?? []) {
    client.write(JSON.stringify(JSON.parse(message))); // fan out to sockets
  }
});

// Publish: one call, every subscriber, every server instance
async function priceChanged(instrument, price) {
  await pub.publish("room:trading", JSON.stringify({ type: "price", instrument, price }));
  await pub.publish("analytics", JSON.stringify({ type: "price.tick", instrument, price, ts: Date.now() }));
}

// Durable pub/sub (Google Pub/Sub shape): per-subscription state
await topic.publishMessage({ json: { type: "OrderPlaced", orderId: "o1" } });
// subscription "email" and subscription "analytics" each ack independently —
// analytics can retry for 7 days without touching email delivery.`,
    steps: ["Publisher sends to topic", "Topic fans out", "Subscriber A receives", "Subscriber B receives"],
  },
  {
    id: "arch-mvc",
    cat: "arch",
    title: "MVC Pattern",
    one: "Separates data (Model), UI (View), and control flow (Controller).",
    why: "Unstructured apps braid parsing, queries, and HTML into one function. MVC separates the concerns so they change independently: business rules move without touching templates; templates redesign without touching queries.",
    how: "Controllers receive requests, invoke models, and choose views. Models encapsulate data, validation, and business rules — no HTTP knowledge. Views render the model into output (HTML/JSON) with logic that stays presentation-only. Request → controller → model → view → response.",
    when: "The default shape for server-rendered apps (Rails, Laravel, Django all MVC). For JSON APIs the 'View' collapses into serializers; keep the controller-thin/model-fat discipline — it's what actually preserves testability. SPA frontends re-enact MVC with their own state/views.",
    ref: "Ruby on Rails Guides",
    subtopics: [
      { name: "Fat model, thin controller", detail: "Controllers parse input and pick responses; ALL business rules live in models. A 400-line controller means the model layer is missing." },
      { name: "Models aren't table wrappers", detail: "Anemic models (just ORM rows) push logic into controllers. Real models enforce invariants: can_cancel? charge! — the verbs of the domain." },
      { name: "Views stay dumb", detail: "Template conditionals beyond formatting ('show badge if admin') are controller/model logic leaking upward. Pre-compute what the view needs." },
      { name: "MVC in JSON APIs", detail: "Controller: validate + call model + status code. Serializer: entity → JSON shape. The pattern survives; the 'view' becomes the serializer layer." },
    ],
    code: `// MODEL: business rules, zero HTTP knowledge
class OrderModel {
  static async create(userId, items) {
    if (!items.length) throw new ValidationError("empty order");
    const total = items.reduce((s, i) => s + i.priceCents * i.qty, 0);
    return db.orders.insert({ userId, items, totalCents: total, status: "pending" });
  }
  static async markPaid(orderId) {
    const order = await db.orders.find(orderId);
    if (order.status !== "pending") throw new InvalidTransition(order.status + " -> paid");
    return db.orders.update(orderId, { status: "paid", paidAt: new Date() });
  }
}

// CONTROLLER: HTTP in, calls model, picks response — no business rules
const orderController = {
  async create(req, res) {
    try {
      const items = await validateCart(req.body.items);
      const order = await OrderModel.create(req.user.id, items);
      res.status(201).json({ data: serializeOrder(order) });
    } catch (err) {
      if (err instanceof ValidationError) return res.status(422).json({ error: { code: "invalid" } });
      throw err;
    }
  },
};

// VIEW (serializer): presentation only
function serializeOrder(order) {
  return {
    id: order.id,
    status: order.status,
    total: "$" + (order.totalCents / 100).toFixed(2),
    createdAt: order.createdAt.toISOString(),
  };
}`,
    steps: ["Request hits Controller", "Controller updates Model", "Model notifies View", "View renders response"],
  },
  {
    id: "arch-layered",
    cat: "arch",
    title: "Layered Architecture",
    one: "Presentation, business logic, and data access kept in distinct layers.",
    why: "When SQL lives in route handlers and formatting lives in SQL, every change touches everything. Layers give dependencies a single direction — UI depends on logic, logic depends on data access — so each layer changes without the others knowing.",
    how: "Three classic tiers: presentation (HTTP handling, serialization), business (domain rules, orchestration), data (repositories, queries). Calls flow strictly downward; the data layer knows nothing about HTTP, the presentation layer knows nothing about SQL. Cross-layer data passes as plain domain objects.",
    when: "The pragmatic default for most services — familiar, testable (mock the repository, test the business layer pure). Keep layers honest: a 'quick query' in the controller starts the erosion. For complex domains, evolve toward hexagonal/clean architecture where the domain sits at the center with dependencies pointing inward.",
    ref: "Microsoft Architecture Guide",
    subtopics: [
      { name: "One-way dependencies", detail: "Presentation → Business → Data, never backwards. The rule that makes layers real: if the repository imports Express, the architecture is decorative." },
      { name: "Repositories", detail: "The data layer exposes domain verbs (findActiveOrders(userId)), not query fragments. Business code says what it wants; SQL is an implementation detail." },
      { name: "DTOs at the edges", detail: "Each boundary transforms: DB rows → domain objects → API DTOs. The order's status enum differs from the API's status string on purpose." },
      { name: "Testing per layer", detail: "Unit-test business logic with a fake repository (no DB); integration-test repositories against real Postgres. Failures localize to a layer instead of everywhere." },
    ],
    code: `// DATA LAYER: SQL lives here and nowhere else
class OrderRepository {
  async findByUser(userId) {
    const { rows } = await pool.query(
      "SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC", [userId]
    );
    return rows.map(rowToDomain); // rows -> domain objects
  }
  async save(order) {
    await pool.query(
      "INSERT INTO orders (id, user_id, total_cents, status) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET status = $4",
      [order.id, order.userId, order.totalCents, order.status]
    );
  }
}

// BUSINESS LAYER: pure domain logic, knows repositories, never HTTP/SQL
class OrderService {
  constructor(orders) { this.orders = orders; }

  async placeOrder(userId, items) {
    if (!items.length) throw new EmptyCartError();
    const order = { id: crypto.randomUUID(), userId, items, status: "pending", totalCents: sum(items) };
    await this.orders.save(order);
    return order;
  }

  async cancel(userId, orderId) {
    const order = (await this.orders.findByUser(userId)).find((o) => o.id === orderId);
    if (!order) throw new NotFoundError(orderId);
    if (order.status === "shipped") throw new CannotCancelError(orderId);
    order.status = "cancelled";
    await this.orders.save(order);
  }
}

// PRESENTATION LAYER: HTTP concerns only
app.post("/orders", async (req, res) => {
  try {
    const order = await orderService.placeOrder(req.user.id, req.body.items);
    res.status(201).json({ data: toDto(order) });
  } catch (e) {
    if (e instanceof EmptyCartError) return res.status(422).json({ error: { code: "empty_cart" } });
    throw e;
  }
});`,
    steps: ["Presentation layer", "Business logic layer", "Data access layer", "Database"],
  },
  {
    id: "arch-hexagonal",
    cat: "arch",
    title: "Hexagonal Architecture",
    one: "The core domain is isolated from frameworks and external systems via ports/adapters.",
    why: "Frameworks and databases change; business rules shouldn't notice. Hexagonal (ports & adapters) puts the domain at the center with dependency-pointing-inward rules — swap Postgres for Mongo, Express for Fastify, or run the whole app in tests with zero infrastructure.",
    how: "The core defines ports: interfaces it needs (OrderRepository, PaymentGateway, Clock) and offers (use cases). Adapters implement ports on the outside: a PostgresOrderRepository, a StripeGateway, an HTTP controller that calls use cases. The core imports nothing outward — adapters depend on the core, never the reverse.",
    when: "Worth it for domain-rich, long-lived systems: complex rules, multiple delivery channels (HTTP + queue + CLI), and infrastructure you expect to swap or fake heavily in tests. For a thin CRUD service, layered is less ceremony for the same discipline.",
    ref: "Alistair Cockburn — Hexagonal Architecture",
    subtopics: [
      { name: "Ports (interfaces)", detail: "Owned by the core, named for the domain: PaymentGateway.charge(amount), not StripeClient.callApi(). The core defines what it needs, not what exists." },
      { name: "Adapters (implementations)", detail: "Everything technical lives here: HTTP controllers, DB repositories, message consumers. Each adapter translates between the outside world and core contracts." },
      { name: "Dependency inversion enforced", detail: "import graph: adapters → core, never core → adapters. Lint rules (dependency-cruiser) keep the rule honest after the architecture diagram is forgotten." },
      { name: "The test payoff", detail: "The entire core runs in a unit test with in-memory adapters — no Postgres container, no HTTP. Business logic test suites go from minutes to milliseconds." },
    ],
    code: `// CORE: ports defined by the domain — pure TypeScript/JS, zero imports
class PlaceOrderUseCase {
  constructor(orders, payments, clock) { // ports, injected
    this.orders = orders; this.payments = payments; this.clock = clock;
  }
  async execute(userId, items) {
    const total = items.reduce((s, i) => s + i.priceCents * i.qty, 0);
    const order = { id: crypto.randomUUID(), userId, items, totalCents: total, status: "pending", placedAt: this.clock.now() };
    await this.orders.save(order);                      // port call — DB unseen
    const payment = await this.payments.charge(total);  // port call — Stripe unseen
    if (payment.status !== "succeeded") throw new PaymentFailedError(order.id);
    order.status = "paid";
    await this.orders.save(order);
    return order;
  }
}

// ADAPTERS: technology lives at the edges
class PgOrderRepository { // implements the orders port
  async save(order) {
    await pool.query(
      "INSERT INTO orders (id, user_id, total_cents, status, placed_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET status = $4",
      [order.id, order.userId, order.totalCents, order.status, order.placedAt]
    );
  }
}
class FakeClock { constructor(t = 0) { this.t = t; } now() { return new Date(this.t); } }

// Wiring (composition root): adapters injected INTO the core
const useCase = new PlaceOrderUseCase(new PgOrderRepository(), new StripeGateway(key), new FakeClock());
app.post("/orders", (req, res) => useCase.execute(req.user.id, req.body.items).then((o) => res.json(toDto(o))));

// The whole core, tested in milliseconds — no DB, no Stripe:
// new PlaceOrderUseCase(inMemoryOrders, fakeGateway, new FakeClock(0))`,
    steps: ["External system", "Adapter", "Port", "Core domain logic"],
  },
  {
    id: "arch-servicediscovery",
    cat: "arch",
    title: "Service Discovery",
    one: "How services find each other's network location dynamically.",
    why: "In a dynamic fleet, 'orders is at 10.0.4.12' lives for minutes: autoscaling replaces instances, deploys roll IPs, containers restart elsewhere. Hardcoded addresses and config files rot instantly — discovery makes location a runtime lookup, not a config constant.",
    how: "Instances register themselves (or their orchestrator does) in a registry (Consul, etcd, K8s DNS) with health metadata. Callers query the registry — by name, getting all healthy instances — load-balance across them, and watch for changes. Kubernetes dissolves this into DNS + Service objects.",
    when: "You need it the moment instances are ephemeral: autoscaling groups, containers, multi-region. On Kubernetes you get it free (Service DNS names); on VMs adopt Consul or a cloud load balancer with target groups. Skip it for static fleets — a config list of 3 stable IPs is honest simplicity.",
    ref: "Consul Documentation",
    subtopics: [
      { name: "Self-registration vs platform", detail: "Services register + heartbeat themselves (Consul), or the platform registers them (K8s endpoints, AWS target groups). Platform-managed has fewer failure modes." },
      { name: "Health-based membership", detail: "The registry only returns instances passing health checks — dead instances vanish from results in seconds. This is the entire value: the list is ALWAYS live." },
      { name: "Client-side vs server-side", detail: "Client-side: caller queries the registry and load balances itself (smart, more code). Server-side: hit one stable LB address that hides the pool (simple, extra hop)." },
      { name: "Caching & staleness", detail: "Callers cache registry results for speed — stale caches route to dead instances. Short TTLs + retry-on-next-instance absorb the window." },
    ],
    code: `// A registry with heartbeats — the core of discovery in 40 lines
const registry = new Map(); // serviceName -> Map(instanceId -> { url, lastHeartbeat })

function register(serviceName, instanceId, url) {
  if (!registry.has(serviceName)) registry.set(serviceName, new Map());
  registry.get(serviceName).set(instanceId, { url, lastHeartbeat: Date.now() });
}

function discover(serviceName) {
  const now = Date.now();
  const instances = [...(registry.get(serviceName)?.values() ?? [])].filter(
    (i) => now - i.lastHeartbeat < 15000 // only healthy: heartbeat within 15s
  );
  if (!instances.length) throw new Error("no healthy instances for " + serviceName);
  return instances[Math.floor(Math.random() * instances.length)].url; // client-side LB
}

// Instance side: announce + heartbeat + graceful deregister
const instanceId = crypto.randomUUID();
register("orders", instanceId, "http://10.0.4.12:8000");
const beat = setInterval(() => {
  registry.get("orders").get(instanceId).lastHeartbeat = Date.now();
}, 5000);

process.on("SIGTERM", () => {
  clearInterval(beat);
  registry.get("orders").delete(instanceId); // leave cleanly before exit
});

// Caller: never an IP, always a name
const orderUrl = discover("orders");
const res = await fetch(orderUrl + "/orders", { method: "POST", body });`,
    steps: ["Service registers itself", "Registry stores location", "Another service queries registry", "Connects to resolved address"],
  },
  {
    id: "arch-servicemesh",
    cat: "arch",
    title: "Service Mesh",
    one: "A dedicated infrastructure layer handling service-to-service traffic, retries, and observability.",
    why: "Every service re-implementing retries, mTLS, timeouts, and metrics is 20 libraries drifting apart. A mesh moves service-to-service plumbing into the infrastructure: every language, every team, identical behavior — configured once, centrally.",
    how: "A proxy (sidecar) sits beside every service, intercepting all traffic. Control plane (Istio, Linkerd) pushes config: retry policies, mTLS certs, traffic splits. Services talk to local proxies; proxies handle the network — the app sees plain HTTP to 'orders' while the mesh does encryption, retries, and telemetry.",
    when: "Adopt when service count × policies makes in-app libraries unmaintainable — typically 20+ services, polyglot, with compliance-driven mTLS requirements. Before that, a good RPC library (gRPC + interceptors) or OSS proxy per service is cheaper. Meshes carry real cost: sidecar resources, complexity, debugging one layer further away.",
    ref: "Istio Documentation",
    subtopics: [
      { name: "Sidecar pattern", detail: "Every pod gets a proxy container; app traffic loops through localhost. The app's network stack is replaced by the mesh's — transparently to code." },
      { name: "mTLS everywhere, automatic", detail: "The mesh issues and rotates workload certificates, enforcing encrypted, identity-verified service-to-service calls with zero app code — the compliance checkbox, solved." },
      { name: "Traffic management", detail: "Retries with budgets, timeouts, outlier ejection (a circuit breaker at the proxy), canary weight splits (90/10), mirroring — all as declarative YAML, not libraries." },
      { name: "Uniform telemetry", detail: "Golden signals (latency, traffic, errors, saturation) for EVERY hop, emitted by the proxy: service maps and per-hop SLOs without instrumenting each codebase." },
    ],
    code: `// Mesh config (Istio-flavored YAML concept) — app code stays plain
// apiVersion: networking.istio.io/v1
// kind: DestinationRule
// spec:
//   host: orders
//   trafficPolicy:
//     tls: { mode: ISTIO_MUTUAL }          # automatic mTLS
//     connectionPool: { http: { http2MaxRequests: 1000 } }
//     outlierDetection:                     # circuit breaking, in the proxy
//       consecutive5xxErrors: 5
//       interval: 10s
//       baseEjectionTime: 30s

// apiVersion: networking.istio.io/v1
// kind: VirtualService
// spec:
//   hosts: [orders]
//   http:
//     - route:
//         - destination: { host: orders, subset: v1 }
//           weight: 90
//         - destination: { host: orders, subset: v2 }
//           weight: 10                       # canary: pure config
//       retries:
//         attempts: 3
//         perTryTimeout: 2s
//         retryOn: 5xx,reset

// The application is deliberately boring — no retry/mtls/tracing code:
const res = await fetch("http://orders/orders", { method: "POST", body });
// the sidecar did: mTLS handshake, retries, ejection, metrics, traces`,
    steps: ["Service A calls Service B", "Sidecar proxy intercepts", "Handles retry/routing/metrics", "Request delivered"],
  },
  {
    id: "arch-serverless",
    cat: "arch",
    title: "Serverless / FaaS",
    one: "Code runs on-demand in short-lived functions with no server management.",
    why: "Most services idle at 5% utilization while you pay for 100%. FaaS bills per-invocation milliseconds, scales to zero between events, and absorbs a viral spike without capacity planning — the platform owns the fleet, patching, and scaling.",
    how: "You upload a function; the platform triggers it from events (HTTP, queue, schedule, stream). Cold starts spin a fresh runtime (100ms–seconds, language-dependent); warm invocations reuse the container. Execution is time-boxed (seconds to 15 min), stateless by contract — any state goes to external stores.",
    when: "Great for spiky/infrequent workloads: webhooks, image processing, scheduled jobs, glue between SaaS. Wrong for high steady throughput (cheaper to keep containers warm), latency-critical paths (cold starts), and long computations (timeouts). Design for statelessness from request one.",
    ref: "AWS Lambda Documentation",
    subtopics: [
      { name: "Cold starts", detail: "First invocation initializes runtime + your code: 150ms (Node) to seconds (JVM). Mitigate with provisioned concurrency, slim bundles, and keeping init work lazy." },
      { name: "Stateless contract", detail: "Local state may vanish between invocations — but /tmp and globals sometimes persist on reused containers. Treat them as cache-at-best, never correctness." },
      { name: "Event sources", detail: "HTTP gateways, queues, schedules, S3 uploads, streams — the platform invokes with the event as payload. The event shape IS your request object." },
      { name: "The economics", detail: "Pay-per-ms wins for spiky traffic; steady 24/7 load often costs more than containers. Model both — plus the hidden costs: observability, vendor coupling, cold-start SLAs." },
    ],
    code: `// An AWS Lambda handler (Node 20) — the event IS the request
const { Pool } = require("pg");

let pool; // module scope: REUSED across warm invocations — init outside the handler
function db() {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  return pool;
}

exports.handler = async (event) => {
  // cold vs warm: log it once, watch it in metrics
  console.log(JSON.stringify({ cold: !global.warm, ms: Date.now() }));
  global.warm = true;

  try {
    switch (event.requestContext?.http?.method) {
      case "POST": {
        const { rows } = await db().query(
          "INSERT INTO orders (user_id, total_cents) VALUES ($1, $2) RETURNING *",
          [event.identity?.sub ?? "anon", JSON.parse(event.body).totalCents]
        );
        return { statusCode: 201, body: JSON.stringify({ data: rows[0] }) };
      }
      default: {
        const { rows } = await db().query("SELECT * FROM orders LIMIT 50");
        return { statusCode: 200, body: JSON.stringify({ data: rows }) };
      }
    }
  } catch (err) {
    console.error(err); // goes to CloudWatch with the request ID
    return { statusCode: 500, body: JSON.stringify({ error: "internal" }) };
  }
  // container may freeze here and be reused — or vanish. Never rely on globals for correctness.
};`,
    steps: ["Event triggers function", "Function spins up", "Executes & returns", "Shuts down until next trigger"],
  },
  {
    id: "arch-eventsourcing",
    cat: "arch",
    title: "Event Sourcing",
    one: "Store every state change as an event instead of just the current state.",
    why: "CRUD overwrites: when an account balance changes, the old value is gone — along with the why. Event sourcing keeps every change as an immutable fact, so you can answer any historical question, rebuild state anywhere, and debug by replaying reality instead of guessing.",
    how: "The event store is append-only: OrderPlaced, ItemAdded, OrderShipped. Current state is derived by folding events left-to-right (replay); snapshots every N events keep replays fast. New writes append validated events; the aggregate's rules decide which events are legal from the current state.",
    when: "Use for domains where history IS the product (ledgers, audit trails) or where projections serve multiple read models (CQRS pairs naturally). Avoid for plain CRUD — replay logic, event versioning, and eventual-consistent projections are real complexity. The bank account (ledger) and shopping cart are the canonical fits.",
    ref: "Martin Fowler — Event Sourcing",
    subtopics: [
      { name: "Append-only event store", detail: "Events are immutable facts with monotonic sequence per aggregate. Nothing is ever UPDATEd — correction happens by appending a compensating event." },
      { name: "Replay & snapshots", detail: "State = fold(events). Snapshots every 100 events make reload O(1): load snapshot + fold the tail. Rebuilds let you fix bugs by replaying history through corrected code." },
      { name: "Projections", detail: "Read models built BY consuming events: an 'open orders' table, a analytics rollup, a search index — each rebuildable from scratch, each eventually consistent." },
      { name: "Schema evolution", detail: "Old events live forever: consumers must read v1 events written years ago. Version events, upcast old shapes on read, and never mutate stored history." },
    ],
    code: `// Event store: append-only log per aggregate
const eventStore = {
  async append(aggregateId, expectedVersion, events) {
    // optimistic concurrency: two writers can't both append to version 3
    const { rowCount } = await pool.query(
      "INSERT INTO events (aggregate_id, version, type, data) SELECT $1, generate_series($2, $3), d.type, d.data FROM (SELECT unnest($4::text[]) AS type, unnest($5::jsonb[]) AS data) d",
      [aggregateId, expectedVersion + 1, expectedVersion + events.length, events.map((e) => e.type), events.map((e) => JSON.stringify(e.data))]
    );
    if (rowCount !== events.length) throw new ConflictError("concurrent modification");
  },
};

// Aggregate: state is FOLDED from events — nothing else stores state
function foldCart(events) {
  return events.reduce((cart, e) => {
    switch (e.type) {
      case "CartCreated": return { id: e.data.cartId, items: [], status: "open", version: e.version };
      case "ItemAdded":   cart.items.push(e.data); return cart;
      case "ItemRemoved": cart.items = cart.items.filter((i) => i.sku !== e.data.sku); return cart;
      case "CheckedOut":  cart.status = "checked_out"; return cart;
      default: return cart;
    }
  }, null);
}

// Command handling: load, validate, append NEW events
async function addItem(cartId, item) {
  const history = await loadEvents(cartId);
  const cart = foldCart(history);
  if (cart.status !== "open") throw new Error("cart closed");

  await eventStore.append(cartId, history.at(-1)?.version ?? 0, [
    { type: "ItemAdded", data: { sku: item.sku, qty: item.qty, priceCents: item.priceCents } },
  ]);
}`,
    steps: ["Change occurs", "Stored as event", "Events appended", "Current state derived by replay"],
  },
  {
    id: "arch-saga",
    cat: "arch",
    title: "Saga Pattern",
    one: "Coordinating a distributed transaction as a sequence of local transactions with compensations.",
    why: "Across services there is no BEGIN COMMIT spanning the network — orders, inventory, and billing each own their database. A saga sequences local transactions and, when one fails, runs compensating actions to undo the earlier ones. It's the only way to keep multi-service workflows consistent.",
    how: "Two styles: choreography (services react to each other's events, no coordinator) and orchestration (a saga manager calls steps and handles failures explicitly). Every step is a local transaction plus a compensating action; steps and compensations must be idempotent because retries WILL replay them.",
    when: "Any multi-service workflow with side effects: order fulfillment (charge → reserve → ship), travel booking (flight + hotel + car), account provisioning. Avoid for read paths and single-service operations — a plain transaction is still better when it's possible.",
    ref: "Microsoft Architecture Guide",
    subtopics: [
      { name: "Compensating actions", detail: "Semantic undo, not database rollback: refund the charge, release the inventory. Compensations themselves can fail — they retry forever or escalate to humans." },
      { name: "Choreography vs orchestration", detail: "Choreography: OrderPlaced → each service reacts (simple, but the flow is invisible across codebases). Orchestration: one state machine defines the flow explicitly — preferable past 3 steps." },
      { name: "Idempotency everywhere", detail: "Sagas retry on timeout: 'reserve inventory' may run twice. Every step keyed by saga ID + step name, deduped on receipt." },
      { name: "Semantic locks", detail: "Mid-saga state is visible: order is 'pending payment', inventory 'reserved'. Other flows must read and respect pending states — this is the distributed lock substitute." },
    ],
    code: `// Orchestration: an explicit state machine over local transactions
class OrderSaga {
  constructor(orderId) {
    this.id = orderId;
    this.state = { step: "charge", compensated: [] };
  }

  async run(order) {
    try {
      await billing.charge(order.id, order.totalCents);      // local tx 1 (idempotent by orderId)
      this.state.step = "reserve";

      await inventory.reserve(order.id, order.items);        // local tx 2
      this.state.step = "ship";

      await shipping.schedule(order.id, order.address);      // local tx 3
      await db.sagas.complete(this.id);
      await bus.publish("OrderFulfilled", { orderId: order.id });
    } catch (err) {
      logger.error("saga failed", { saga: this.id, step: this.state.step, error: err.message });
      await this.compensate(order);
      throw err;
    }
  }

  async compensate(order) {
    // undo in REVERSE order — semantic rollbacks, retried until they stick
    for (const step of [...this.state.compensated].reverse()) {
      for (let attempt = 1; ; attempt++) {
        try {
          if (step === "ship") await shipping.cancel(order.id);
          if (step === "reserve") await inventory.release(order.id);
          if (step === "charge") await billing.refund(order.id, order.totalCents);
          break;
        } catch (e) {
          if (attempt > 5) { await alertOps("compensation_stuck", { saga: this.id, step }); break; }
          await sleep(2 ** attempt * 1000);
        }
      }
    }
    await bus.publish("OrderFailed", { orderId: order.id });
  }
}`,
    steps: ["Step 1 commits", "Step 2 commits", "Step 3 fails", "Compensating rollback runs"],
  },
  {
    id: "arch-ddd",
    cat: "arch",
    title: "Domain-Driven Design",
    one: "Modeling software around the real business domain and its own language.",
    why: "Most software fails at the seams between what the business means and what the code does — a 'customer' meaning three things in three services. DDD aligns code structure with business structure, so experts and engineers speak one language and complexity lands where it belongs.",
    how: "Discover the domain with experts; define a ubiquitous language (terms mean exactly one thing); carve the system into bounded contexts where each term has one meaning; model aggregates that enforce invariants (an Order and its items change only together); express behavior in the domain layer, not in controllers or SQL.",
    when: "Highest value in complex domains where rules ARE the product: logistics, insurance, trading, healthcare. Overkill for CRUD apps — a form over a table doesn't need aggregates and context maps. Apply selectively: DDD the core domain, keep supporting contexts simple.",
    ref: "Eric Evans — Domain-Driven Design",
    subtopics: [
      { name: "Ubiquitous language", detail: "If the business says 'shipment' and code says 'delivery', every conversation burns translation cycles. Rename the code — the glossary is a build artifact." },
      { name: "Bounded contexts", detail: "'Customer' in Sales (lead, pipeline stage) ≠ Billing (invoice recipient, payment terms). Separate models per context, mapped explicitly, instead of one god-model pleasing nobody." },
      { name: "Aggregates", detail: "Consistency boundaries: load the Order aggregate, enforce invariants (total = sum of items), save atomically. Cross-aggregate references by ID only — never hold another aggregate's objects." },
      { name: "Domain events", detail: "Aggregates announce what happened (OrderShipped) rather than being mutated by controllers. Side effects (emails, analytics) subscribe — the core stays clean." },
    ],
    code: `// AGGREGATE: one consistency boundary, invariants enforced inside
class Order {
  constructor(id, customerId) {
    this.id = id;
    this.customerId = customerId;
    this.items = [];
    this.status = "draft";
    this.events = []; // domain events collected for dispatch after save
  }

  addItem(sku, qty, priceCents) {           // behavior + rules live HERE
    if (this.status !== "draft") throw new Error("cannot modify a placed order");
    if (qty < 1) throw new Error("quantity must be positive");
    this.items.push({ sku, qty, priceCents });
  }

  place() {
    if (!this.items.length) throw new Error("empty orders cannot be placed");
    if (this.totalCents() > 500000 && !this.approved) throw new Error("orders over $5000 need approval");
    this.status = "placed";
    this.events.push({ type: "OrderPlaced", orderId: this.id, totalCents: this.totalCents() });
  }

  totalCents() {
    return this.items.reduce((s, i) => s + i.qty * i.priceCents, 0);
  }
}

// REPOSITORY reconstitutes aggregates; side effects subscribe to events
class OrderRepository {
  async save(order) {
    await db.orders.persist(order);
    for (const event of order.events) await bus.publish(event); // OrderPlaced -> email, analytics
    order.events = [];
  }
}

// Ubiquitous language in the API itself — experts can read this test:
// given an order with 2 items, when the customer places it, then it is 'placed' and OrderPlaced is published`,
    steps: ["Talk to domain experts", "Define ubiquitous language", "Model bounded contexts", "Code mirrors the domain"],
  },
  {
    id: "arch-bff",
    cat: "arch",
    title: "Backend-for-Frontend",
    one: "A dedicated backend tailored to one specific frontend's needs.",
    why: "One general-purpose API serves every client badly: mobile needs 3 fields over a slow network, web wants fat payloads, TV wants different auth. A BFF gives each frontend a backend shaped exactly to it — one round trip, exact fields, client-specific concerns owned by the client's team.",
    how: "Each frontend gets its own backend service (mobile-BFF, web-BFF) that calls downstream services/APIs, aggregates, reshapes, and returns exactly what that UI renders. The BFF owns client concerns: aggregation, field trimming, response shaping, and token handling for that platform.",
    when: "Use when multiple genuinely different clients consume shared services and their needs diverge (field sets, round trips, protocols). Skip for one client or when clients are similar — a BFF per frontend multiplies deploy targets and code duplication; GraphQL is often the alternative answer.",
    ref: "Sam Newman — Building Microservices",
    subtopics: [
      { name: "Owned by the frontend team", detail: "The team building the screen owns the BFF serving it — interface changes stop being cross-team negotiations. Conway's law, weaponized for good." },
      { name: "Aggregation & trimming", detail: "Dashboard = user + orders + notifications: three downstream calls fan out in parallel server-side, merged into one tight payload. Mobile pays for 2KB, not 40KB." },
      { name: "Platform-specific concerns", detail: "Mobile BFF handles flaky-network retries, compression, and coarse batches; web BFF does ETags and fine-grained caches. Each client gets its own dialect." },
      { name: "Thin by contract", detail: "BFFs hold NO business rules — reshaping and aggregation only. The moment domain logic creeps in, you've built a second source of truth." },
    ],
    code: `// Mobile BFF: one request from the app -> everything the screen shows
app.get("/mobile/dashboard", async (req, res) => {
  const userId = req.user.sub;

  // fan out to downstream services IN PARALLEL
  const [user, orders, notifications] = await Promise.all([
    fetch("http://users:8001/users/" + userId).then((r) => r.json()),
    fetch("http://orders:8002/orders?userId=" + userId + "&limit=5").then((r) => r.json()),
    fetch("http://notifications:8003/unread?userId=" + userId).then((r) => r.json()),
  ]);

  // shape EXACTLY what the mobile screen renders — 2KB, not 40KB
  res.json({
    greeting: user.name.split(" ")[0],
    avatarUrl: smallAvatar(user.avatarUrl),      // mobile-size variant
    recentOrders: orders.items.map((o) => ({
      id: o.id,
      status: o.status,
      total: (o.totalCents / 100).toFixed(2),
    })),
    unreadCount: notifications.count,
    deepLinks: { orders: "myapp://orders", notifications: "myapp://alerts" },
  });
});

// The web BFF serves the same domain with different shaping — richer fields,
// ETag caching, no deep links. Neither client talks to core services directly.`,
    steps: ["Mobile app", "Mobile BFF", "Web app", "Web BFF", "Shared services behind both"],
  },
  {
    id: "arch-stranglerfig",
    cat: "arch",
    title: "Strangler Fig Pattern",
    one: "Gradually replacing a legacy system by routing traffic to new services piece by piece.",
    why: "Big-bang rewrites die: 18 months of parallel development, a feature freeze, and a terrifying cutover night. The strangler fig grows the new system around the old one, one route at a time, each step live and reversible — value ships while the migration runs.",
    how: "Put a routing facade in front of the legacy monolith. Build the new service for ONE capability; point that route at it; verify with real traffic; repeat. The legacy shrinks route by route until it's empty and can be deleted. Dual-writes or CDC keep data consistent during the transition.",
    when: "Any incremental modernization: monolith → services, old framework → new, on-prem → cloud. Requires the patience to keep both systems running during the transition — if the business can't tolerate a year of coexistence, the plan is fantasy.",
    ref: "Martin Fowler — StranglerFigApplication",
    subtopics: [
      { name: "The routing facade", detail: "A proxy/gateway maps paths → old or new system. Cutover is a routing rule, instantly reversible when the new path regresses at 2 a.m." },
      { name: "Route by capability", detail: "Migrate a cohesive capability (password reset, invoicing) — not a random layer. Each extraction leaves the monolith smaller and the new service meaningful." },
      { name: "Data synchronization", detail: "The hardest part: both systems live on overlapping data. Dual-writes during transition, or CDC from the legacy DB feeding the new service's store." },
      { name: "Asset capture", detail: "As routes move, capture domain knowledge: tests port to the new service, monitoring per capability, and the team learns the domain by moving it." },
    ],
    code: `// The facade: every route starts at the monolith, moves one at a time
const ROUTES = {
  "/api/invoices": "http://invoices-service.internal:8000", // MIGRATED
  "/api/auth/*":   "http://auth-service.internal:8001",     // MIGRATED
  // everything else still lives in the monolith:
};

const MONOLITH = "http://legacy-monolith.internal:7000";

app.use(async (req, res, next) => {
  const target =
    Object.entries(ROUTES).find(([pattern]) => matchPath(pattern, req.path))?.[1] ?? MONOLITH;

  proxy.web(req, res, { target }, (err) => next(err));
});

// Migration day for one capability — feature-flag controlled, instantly reversible:
async function migrateRoute(pattern, newTarget) {
  const errorsBefore = await metrics.errorRate(pattern, "1h");

  ROUTES[pattern] = newTarget;
  await sleep(10 * 60 * 1000); // soak 10 minutes

  const errorsAfter = await metrics.errorRate(pattern, "10m");
  if (errorsAfter > errorsBefore * 1.5) {
    delete ROUTES[pattern]; // instant rollback: traffic flows to the monolith again
    await alertOps("strangler_rollback", { pattern });
    return false;
  }
  await changelog.record(pattern + " migrated to " + newTarget);
  return true;
}`,
    steps: ["Legacy system live", "New service built alongside", "Traffic routed incrementally", "Legacy fully replaced"],
  },
  {
    id: "arch-bulkhead",
    cat: "arch",
    title: "Bulkhead Pattern",
    one: "Isolating resources so one failing component can't sink the whole system.",
    why: "Ships sink when one hull breach floods the whole deck — services drown the same way: the recommendation service's slowdown consumes every DB connection, and now checkout is down too. Bulkheads partition resources per dependency so failure stays local.",
    how: "Give each dependency its own pool of the scarce resource — DB connections, HTTP agents, worker concurrency, threads. A bulkhead enforces limits per partition: recommendations can use its 5 connections and no more; checkout's 20 are untouchable. Requests beyond a partition's limit fail fast instead of queueing forever.",
    when: "Every service calling multiple dependencies with shared pools needs them — most visibly: one slow third-party API degrading your whole app. Combine with circuit breakers (bulkhead limits damage, breaker stops the calls) and per-dependency timeouts.",
    ref: "Microsoft Architecture Guide",
    subtopics: [
      { name: "Pools per dependency", detail: "Separate connection pools / HTTP agents / concurrency limits per downstream. The scarce resource is partitioned — that's the entire mechanism." },
      { name: "Fail fast at the hull", detail: "When a partition is full, reject immediately (503 for that feature) instead of queueing. A bounded wait is fine; an unbounded queue is the flood." },
      { name: "Core vs peripheral", detail: "Budget ruthlessly: checkout gets 80% of connections, recommendations 10%, analytics 10%. Sizing IS the architecture decision." },
      { name: "Pair with breakers", detail: "Bulkheads contain a slow dependency; circuit breakers stop calling it. Together: local failure, fast failure, automatic recovery." },
    ],
    code: `// One pool per dependency — recommendations can't touch checkout's capacity
const pools = {
  checkout: new Pool({ connectionString: CHECKOUT_DB, max: 20 }),   // the core
  recommend: new Pool({ connectionString: RECO_DB, max: 5 }),       // peripheral
  analytics: new Pool({ connectionString: ANALYTICS_DB, max: 3 }),  // peripheral
};

// Bulkheaded outbound calls: each dependency gets its own agent + concurrency cap
function bulkhead(name, maxConcurrent, timeoutMs) {
  let active = 0;
  const queue = [];
  return function run(fn) {
    return new Promise((resolve, reject) => {
      const start = () => {
        active++;
        const timer = setTimeout(() => {
          active--;
          reject(new Error(name + " timed out")); // fail fast, don't hang
          pump();
        }, timeoutMs);
        fn()
          .then((v) => { clearTimeout(timer); active--; resolve(v); })
          .catch((e) => { clearTimeout(timer); active--; reject(e); })
          .finally(pump);
      };
      const pump = () => { if (active < maxConcurrent && queue.length) queue.shift()(); };
      active < maxConcurrent ? start() : queue.push(start);
      if (queue.length > 50) reject(new Error(name + " bulkhead full")); // shed load
    });
  };
}

const callRecommendations = bulkhead("recommend", 5, 800);
const callPayments = bulkhead("payments", 20, 3000);

app.get("/product/:id", async (req, res) => {
  const product = await callPayments(() => catalogApi.get(req.params.id)).catch(() => null);
  // recommendations failing/overloaded can NEVER block this response:
  const recs = await callRecommendations(() => recsApi.for(req.params.id)).catch(() => []);
  res.json({ product, recommendations: recs }); // graceful degradation, isolated hulls
});`,
    steps: ["Component A pool", "Component B pool", "A overloads", "B keeps running unaffected"],
  },
  {
    id: "arch-idempotentconsumers",
    cat: "arch",
    title: "Idempotent Consumers",
    one: "Message handlers that safely process the same message twice without side effects.",
    why: "Queues guarantee at-least-once delivery — duplicates are a feature of the transport, not a bug in your code. A consumer that charges a card or decrements stock per delivery will double-execute; every consumer must dedupe by design.",
    how: "Attach a unique key to each message (event ID, or a natural business key like orderId+action). Before processing, atomically claim the key (INSERT with unique constraint, or Redis SET NX). Claim won → process; claim lost → already done, acknowledge and skip. The claim and the business write should commit together.",
    when: "Every single queue/webhook/stream consumer, without exception. Natural idempotency (SET status=paid) is even better than dedupe where achievable — but most real handlers (send email, charge card) need the processed-messages table.",
    ref: "Enterprise Integration Patterns — Hohpe & Woolf",
    subtopics: [
      { name: "The processed-keys table", detail: "consumer_name + message_id with a unique index. The atomic INSERT IS the lock: two workers processing the same message — one wins, one skips." },
      { name: "Claim-with-commit", detail: "Ideal: dedupe row and business changes in ONE transaction. If the handler crashes after committing, the redelivered message sees the key and skips. Separate stores need outbox/claim patterns." },
      { name: "Natural keys beat UUIDs", detail: "orderId+charge is a stronger dedupe key than a random messageId: retries AND duplicate business intents both collapse. Message IDs protect transport dupes; business keys protect logic dupes." },
      { name: "TTL the claims", detail: "Keep processed keys long enough to cover redelivery windows (days), then expire them — unbounded dedupe tables become their own operational problem." },
    ],
    code: `// Consumer wrapper: dedupe by message ID, then by business key
async function consume(topic, handler) {
  for (;;) {
    const message = await broker.receive(topic);

    // 1. transport-level dedupe (redeliveries, worker restarts)
    const claimed = await pool.query(
      "INSERT INTO processed_messages (consumer, message_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1",
      [topic, message.id]
    );
    if (claimed.rowCount === 0) { await broker.ack(message); continue; } // already done

    try {
      // 2. business-level dedupe where it matters more than transport dupes
      // handler example: charge card once per (orderId, attempt)
      await pool.query("BEGIN");
      const intentKey = message.data.orderId + ":charge:" + message.data.attempt;
      const claimedIntent = await pool.query(
        "INSERT INTO processed_intents (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING 1",
        [intentKey]
      );
      if (claimedIntent.rowCount) {
        await handler(message.data);           // the side effect
      }
      await pool.query("COMMIT");              // claim + effect commit together
      await broker.ack(message);
    } catch (err) {
      await pool.query("ROLLBACK");            // claim released, message will redeliver
      await broker.nack(message, { retryIn: 5000 });
    }
  }
}`,
    steps: ["Message delivered", "Handler checks if already processed", "Processed once", "Duplicate delivery ignored"],
  },
  {
    id: "arch-dlq",
    cat: "arch",
    title: "Dead Letter Queues",
    one: "Failed messages get routed aside for inspection instead of being lost.",
    why: "When a message fails repeatedly — poison payload, bug, downstream outage — the choices are: retry forever (blocking the queue), drop it (silent data loss), or park it somewhere inspectable. The DLQ is the parking lot: processing continues, failures are visible, nothing vanishes.",
    how: "Configure a max-delivery count (or visibility timeout policy); exhausted messages route to a dead-letter queue with metadata (original topic, error, attempt count, timestamp). Ops monitors DLQ depth as an alarm; engineers inspect, fix the cause, and replay messages back to the source queue.",
    when: "Every serious queue deployment. Watch the failure mode it creates: a DLQ nobody monitors becomes a black hole where data quietly rots — alert on depth, review weekly, and keep the replay tooling ready BEFORE the incident.",
    ref: "AWS SQS Documentation",
    subtopics: [
      { name: "Redrive policy", detail: "The broker's rule for when to dead-letter (after N attempts). Too low: transient glitches dead-letter; too high: poison messages block their queue for hours." },
      { name: "Failure metadata", detail: "The DLQ entry needs the error message, stack, attempt count, and original payload — debugging a bare payload three weeks later is archaeology." },
      { name: "Replay tooling", detail: "A script that drains DLQ → source queue (or a repair topic), rate-limited and observable. The fix-then-replay loop is the whole point; build it before you need it." },
      { name: "Poison message handling", detail: "Some messages can never succeed (malformed, expired). After diagnosis, quarantine them explicitly — a 'discard with audit' endpoint beats eternal re-dead-lettering." },
    ],
    code: `// Consumer with retry budget -> DLQ routing
const MAX_ATTEMPTS = 5;

async function consumeWithDlq(topic, dlq, handler) {
  for (;;) {
    const msg = await broker.receive(topic);
    try {
      await handler(msg.data);
      await broker.ack(msg);
    } catch (err) {
      const attempts = (msg.deliveryCount ?? 1) + 1;
      logger.warn("processing failed", {
        messageId: msg.id, attempts, error: err.message, stack: err.stack,
      });

      if (attempts >= MAX_ATTEMPTS) {
        // park with FULL context — future-you needs the error, not just the payload
        await broker.send(dlq, {
          originalTopic: topic,
          messageId: msg.id,
          payload: msg.data,
          error: { message: err.message, stack: err.stack },
          failedAt: new Date().toISOString(),
          attempts,
        });
        await broker.ack(msg); // remove from source: unblocks the queue
        metrics.increment("messages.dead_lettered", { topic });
      } else {
        await broker.nack(msg, { delay: 2 ** attempts * 1000 }); // exponential backoff
      }
    }
  }
}

// Alarm: DLQ depth is a paging metric, not a dashboard curiosity
setInterval(async () => {
  const depth = await broker.depth("orders-dlq");
  if (depth > 0) await pager.warn("DLQ has " + depth + " messages needing triage");
}, 60000);

// Replay tool: fix the bug, then drain
async function replayDlq(dlq, source, filter) {
  for (;;) {
    const batch = await broker.receiveBatch(dlq, 10);
    if (!batch.length) break;
    for (const msg of batch) {
      if (!filter || filter(msg)) await broker.send(source, msg.payload);
      await broker.ack(msg);
    }
  }
}`,
    steps: ["Message fails processing", "Retried N times", "Still fails", "Routed to dead letter queue"],
  },
  {
    id: "arch-multitenancy",
    cat: "arch",
    title: "Multi-Tenancy Architecture",
    one: "One deployment serves many customers, isolated logically or physically.",
    why: "Per-customer infrastructure is a margins killer: 500 customers = 500 databases to patch, back up, and monitor. Multi-tenancy shares infrastructure across tenants while guaranteeing isolation — the economics of SaaS rest on getting this spectrum right per customer tier.",
    how: "A continuum: shared-everything (one app, one DB, tenant_id columns), shared-app/pooled-DBs (one app, database-per-tenant), or dedicated stacks (cell-based: tenant groups on their own infrastructure). Tenant context flows through every request (subdomain → token claim → connection setting), enforced at the data layer, not by developer discipline.",
    when: "Shared model for long-tail SaaS tenants; dedicated databases/cells for enterprise compliance or whale tenants with noisy-neighbor problems. Most real systems mix: pooled for 99% of tenants, dedicated cells for the top 1% paying for it.",
    ref: "AWS SaaS Lens",
    subtopics: [
      { name: "Tenant resolution", detail: "Every request establishes WHO the tenant is — subdomain (acme.app.com), JWT claim, or API key — before any data access. Unresolved tenant = reject, never default." },
      { name: "Isolation spectrum", detail: "Shared schema (cheap, RLS-enforced) → schema-per-tenant → database-per-tenant → cell-per-tenant-group. Cost and safety both rise; choose per tier, not globally." },
      { name: "Noisy neighbors", detail: "One tenant's 50M-row export slows the shared pool. Track per-tenant usage (query time, queue depth), rate-limit per tenant, and move whales to dedicated capacity." },
      { name: "Tenant-aware operations", detail: "Onboarding, offboarding, backups, and restores all become per-tenant operations. Decide tenant-level export/deletion (GDPR) BEFORE the first enterprise deal." },
    ],
    code: `// Tenant context resolution + enforcement at the data layer
function tenantContext(req, res, next) {
  const tenantId = req.headers["x-tenant-id"] ?? req.user?.tenantId;
  if (!tenantId) return res.status(400).json({ error: { code: "no_tenant" } });
  req.tenantId = tenantId; // every downstream operation requires this
  next();
}

// Pooled connections, but every transaction is tenant-scoped (RLS from db-multitenancy)
async function withTenant(req, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL app.tenant_id = $1", [req.tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// Enterprise tier: dedicated database, chosen at connection time
function poolFor(tenantId) {
  const dedicated = DEDICATED_TENANTS.get(tenantId);
  return dedicated ? dedicatedPools.get(dedicated) : sharedPool;
}

// Per-tenant rate limiting: the noisy neighbor guard
const usage = new Map(); // tenantId -> minute counters
function tenantRateLimit(req, res, next) {
  const key = req.tenantId + ":" + Math.floor(Date.now() / 60000);
  const count = (usage.get(key) ?? 0) + 1;
  usage.set(key, count);
  if (count > TENANT_LIMITS.get(req.tenantId)) {
    return res.status(429).json({ error: { code: "tenant_rate_limited" } });
  }
  next();
}`,
    steps: ["Tenant A request", "Shared infrastructure", "Tenant B request", "Isolated by tenant ID"],
  },
  {
    id: "arch-backgroundjobs",
    cat: "arch",
    title: "Background Jobs / Workers",
    one: "Long-running or deferred tasks processed outside the request/response cycle.",
    why: "A 30-second PDF render or a 10k-recipient email burst cannot live inside an HTTP request — the client times out, the worker thread blocks, the platform kills the process. Background jobs move work out of the request path: users get instant responses, workers take the time they need.",
    how: "The request enqueues a job (payload + options: retries, backoff, delay) and returns a job ID. A worker process pulls jobs from the queue and executes with full retry semantics: attempts counted, exponential backoff on failure, DLQ after exhaustion. Progress and results are stored where the client can poll or be notified.",
    when: "Anything slower than ~2–3 seconds or side-effectful beyond the response: emails, media processing, imports/exports, report generation, webhooks fan-out, ML inference. Also scheduled/deferred work (retry tomorrow, process at 2 a.m.). If the user waits on it, it's a request; otherwise, it's a job.",
    ref: "BullMQ Documentation",
    subtopics: [
      { name: "Enqueue, don't execute", detail: "The request handler's job is validation + enqueue: 5ms, then respond with a job ID. The client polls GET /jobs/:id or subscribes to a websocket for completion." },
      { name: "Retry with backoff", detail: "Transient failures (API down, DB timeout) self-heal on retry: 5 attempts, exponential delay. Permanent failures dead-letter for triage. Jobs must be idempotent — retries replay them." },
      { name: "Job payload discipline", detail: "Pass IDs and small data, not blobs: 'render pdf for doc 123' re-fetches current state; a payload snapshot renders stale data and bloats the queue." },
      { name: "Concurrency control", detail: "Workers declare concurrency per queue type: CPU-bound renders 2/worker, I/O-bound emails 50/worker. Separate queues so renders can't starve emails." },
    ],
    code: `// Request path: validate, enqueue, respond — nothing heavy
app.post("/reports", express.json(), async (req, res) => {
  const { rows } = await pool.query("SELECT 1 FROM reports WHERE id = $1", [req.body.reportId]);
  if (!rows.length) return res.status(404).json({ error: { code: "unknown_report" } });

  const job = await reportQueue.add(
    "generate",
    { reportId: req.body.reportId, requestedBy: req.user.id }, // IDs, not blobs
    { attempts: 5, backoff: { type: "exponential", delay: 3000 }, removeOnComplete: 100 }
  );
  res.status(202).json({ jobId: job.id, status: "queued" }); // 202 Accepted
});

// Polling endpoint for the client
app.get("/jobs/:id", async (req, res) => {
  const job = await reportQueue.getJob(req.params.id);
  if (!job) return res.status(404).end();
  const state = await job.getState(); // waiting | active | completed | failed
  res.json({ status: state, progress: job.progress, resultUrl: job.returnvalue?.url });
});

// Worker process: separate deployment, concurrency tuned to the work
const worker = new Worker("reports", async (job) => {
  job.updateProgress(10);
  const data = await db.reports.export(job.data.reportId);   // fetch fresh state
  job.updateProgress(40);
  const file = await pdf.render(data);                        // the heavy part
  job.updateProgress(80);
  const url = await storage.put("reports/" + job.data.reportId + ".pdf", file);
  job.updateProgress(100);
  await notify(job.data.requestedBy, "Your report is ready", url);
  return { url };
}, { concurrency: 2 }); // CPU-bound: low concurrency per worker`,
    steps: ["Request enqueues job", "Response returned immediately", "Worker processes job later", "Result stored or notified"],
  },
  {
    id: "arch-cron",
    cat: "arch",
    title: "Cron Jobs & Scheduling",
    one: "Running tasks automatically on a fixed time schedule.",
    why: "A whole class of work is time-driven, not request-driven: nightly reports, invoice runs, cache warming, cleanup, sync jobs. Scheduling turns 'someone remembers to run this' into infrastructure — and forgetting stops being the failure mode.",
    how: "A scheduler triggers by time expression (cron syntax: minute hour day month weekday). In distributed systems, the challenge is exactly-once execution: multiple instances must not each fire the job — solved by leader election, distributed locks, or a platform scheduler (Cloud Scheduler, K8s CronJobs, managed queues) that invokes once.",
    when: "Use for periodic maintenance and batch work. For intervals counting from deployment (every 5 min), platform schedulers or in-process timers work; for business-calendar logic (first Monday, last day of month), a real scheduler library beats raw cron syntax.",
    ref: "node-cron Documentation",
    subtopics: [
      { name: "Cron expressions", detail: "* * * * * = minute hour day-of-month month day-of-week. '0 2 * * 1-5' = 02:00 on weekdays. Libraries add 'every 5 minutes' sugar and timezone support." },
      { name: "Distributed locking", detail: "3 app instances × 1 cron = 3 simultaneous runs. Lock in Redis/Postgres (SET NX + TTL): only the lock holder executes; others skip. Release on completion, expire on crash." },
      { name: "Idempotency + catch-up", detail: "Jobs must tolerate running late or twice: key runs by time window (dedupe on 'nightly-2026-09-13'), and missed runs need a catch-up policy — skip or run-once." },
      { name: "Observability", detail: "The worst cron failure is silent: log start/end/duration, alert when a run is overdue ('heartbeat' monitoring), and record last-success timestamps you can query." },
    ],
    code: `const cron = require("node-cron");
const Redis = require("ioredis");
const redis = new Redis();

// Exactly-once across instances: distributed lock per run
async function runOnce(jobName, windowId, fn) {
  const lockKey = "cron:" + jobName + ":" + windowId;           // e.g. nightly:2026-09-13
  const acquired = await redis.set(lockKey, instanceId, { NX: true, EX: 6 * 3600 });
  if (!acquired) return; // another instance already ran this window

  const start = Date.now();
  try {
    await fn();
    await redis.set("cron:lastSuccess:" + jobName, new Date().toISOString());
    logger.info("cron done", { jobName, windowId, ms: Date.now() - start });
  } catch (err) {
    await redis.del(lockKey); // allow retry next tick after a failure
    logger.error("cron failed", { jobName, error: err.message });
    await pager.warn("cron failed: " + jobName);
  }
}

cron.schedule("0 2 * * *", () => runOnce("nightly-invoices", dayKey(), generateInvoices));
cron.schedule("*/15 * * * *", () => runOnce("sync-partners", fifteenMinKey(), syncPartners));

// Overdue heartbeat: alert when last success is too old
setInterval(async () => {
  const last = await redis.get("cron:lastSuccess:nightly-invoices");
  if (!last || Date.now() - new Date(last) > 26 * 3600 * 1000) {
    await pager.warn("nightly-invoices has not succeeded in >26h");
  }
}, 10 * 60 * 1000);`,
    steps: ["Schedule defined", "Time reached", "Job triggers", "Task executes"],
  },
  {
    id: "arch-featureflags",
    cat: "arch",
    title: "Feature Flags",
    one: "Toggling functionality on or off without a new deployment.",
    why: "Deploy ≠ release. Flags decouple them: merge code dark, enable for internal users, ramp to 10%, then 100% — or kill a misbehaving feature in seconds instead of rolling back a deployment. They convert releases from cliff-edge events into dial turns.",
    how: "Code checks a flag at runtime (if (flags.newCheckout)); the flag value comes from a config service, database, or SDK with local caching. Flags carry context: percentage rollout, allowlists, per-tenant overrides. The kill path — flip off, users back to the old path — must never require a deploy.",
    when: "Use for gradual rollouts, experiments (A/B), early access, and operational kill switches on risky paths. The discipline that matters: flags are debt with an expiry — every flag gets an owner and a removal ticket at creation, or the codebase drowns in dead conditionals.",
    ref: "LaunchDarkly Documentation",
    subtopics: [
      { name: "Release vs ops vs experiment", detail: "Different lifetimes: release flags live weeks (then die), ops kill-switches live forever, experiment flags live until statistical significance. Name them by type; manage by type." },
      { name: "Percentage rollout", detail: "Deterministic bucketing on user ID (hash % 100 < ramp): a given user is always in the same cohort — consistent experience, clean attribution, no cookie flapping." },
      { name: "Evaluation performance", detail: "Flag checks sit on hot paths: SDKs cache rules locally and refresh in the background. Never let a flag lookup be a per-request network call to another region." },
      { name: "Flag hygiene", detail: "Track: owner, creation date, intended removal. Stale flags compound: 200 dead conditionals make every code path hypothetical. Removal is part of shipping the feature." },
    ],
    code: `// A tiny flag service: rules evaluated locally, cached
const flags = {
  "new-checkout": { enabled: true, rollout: 10, allowlist: ["u_internal_1"] },
  "dark-mode": { enabled: true, rollout: 100 },
  "legacy-export": { enabled: true, rollout: 100 }, // kill switch for an old path
};

const cache = { rules: flags, fetchedAt: 0 };
setInterval(async () => { cache.rules = await flagService.fetch(); cache.fetchedAt = Date.now(); }, 30000);

// Deterministic bucketing: same user, same answer, forever
function isEnabled(flagKey, user) {
  const rule = cache.rules[flagKey];
  if (!rule || !rule.enabled) return false;
  if (rule.allowlist?.includes(user.id)) return true;
  const bucket = hash(user.id + flagKey) % 100;       // stable per user+flag
  return bucket < rule.rollout;
}

function hash(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

// Usage: the new path is shippable dark, ramped gradually, killable instantly
app.post("/checkout", express.json(), async (req, res) => {
  if (isEnabled("new-checkout", req.user)) return newCheckoutFlow(req, res);
  return legacyCheckoutFlow(req, res);
});

// Incident response: flip the switch, no deploy
// await flagService.update("new-checkout", { enabled: false });  <- users back on legacy in <30s`,
    steps: ["Flag defined", "Code checks flag", "On: new path", "Off: old path"],
  },
  {
    id: "arch-apicomposition",
    cat: "arch",
    title: "API Composition",
    one: "Aggregating data from multiple services into one response for the client.",
    why: "Once data is split across services, a single screen needs five owners' data. Making the client call five services couples the frontend to the microservice topology and burns mobile round trips. API composition fans out server-side and returns one merged answer.",
    how: "A composer (gateway, BFF, or dedicated aggregator) receives one request, fans out parallel calls to the owning services, merges results into a view model, and responds. Failures are handled per-section: degrade the parts that failed, return the parts that worked.",
    when: "The default read pattern for microservices — no extra infrastructure beyond the composer. Its limits: complex cross-service filtering/joins and heavy fan-out latency; that's when a CQRS read model (pre-joined view fed by events) replaces on-the-fly composition.",
    ref: "Microsoft Architecture Guide",
    subtopics: [
      { name: "Parallel fan-out", detail: "Promise.all across services: total latency = slowest call, not the sum. Sequential composition is the classic self-inflicted latency wound." },
      { name: "Partial failure handling", detail: "Each section degrades independently: recommendations timeout → return cached/empty, profile fails → 500? No: return the order with a 'profile unavailable' marker. Composition must decide per-section." },
      { name: "Where composition lives", detail: "Gateway-level (generic), BFF (client-owned), or dedicated aggregator. Avoid chains: a composer calling composers multiplies latency and failure modes." },
      { name: "When to pre-join instead", detail: "Hot paths with expensive joins (search across services, dashboards polling 10 sources) justify a CQRS read model fed by events — pay at write time, not per request." },
    ],
    code: `// GET /account-summary -> one response from four services
app.get("/account-summary", async (req, res) => {
  const userId = req.user.sub;
  const timeout = (ms) => new Promise((_, rej) => setTimeout(rej, ms));

  // per-section fetch: each degrades independently
  const section = async (name, promise, fallback) => {
    try {
      return { [name]: await Promise.race([promise, timeout(800)]) };
    } catch {
      metrics.increment("composition.degraded", { section: name });
      return { [name]: fallback };
    }
  };

  const [profile, orders, invoices, usage] = await Promise.all([
    section("profile", usersClient.get("/users/" + userId).then((r) => r.json()), null),
    section("orders", ordersClient.get("/orders?userId=" + userId + "&limit=5").then((r) => r.json()), []),
    section("invoices", billingClient.get("/invoices?userId=" + userId + "&unpaid=true").then((r) => r.json()), []),
    section("usage", meteringClient.get("/usage/" + userId + "/current").then((r) => r.json()), {}),
  ]);

  const merged = Object.assign({}, ...[profile, orders, invoices, usage]);
  const degraded = [profile, orders, invoices, usage].some(
    (s, i) => JSON.stringify(s) !== JSON.stringify(merged[["profile", "orders", "invoices", "usage"][i]])
  );

  res.json({ data: merged, partial: degraded }); // client knows what's missing and why
});`,
    steps: ["Client requests one endpoint", "Fan out to Service A", "Fan out to Service B", "Merged response returned"],
  },
  {
    id: "arch-twelvefactor",
    cat: "arch",
    title: "Twelve-Factor App",
    one: "A set of principles for building portable, scalable cloud-native apps.",
    why: "Apps that work on one laptop and die in the cloud share the same sins: config baked into code, local state everywhere, snowflake servers. The twelve factors codify what makes apps portable, horizontally scalable, and disposable — the vocabulary cloud platforms assume you speak.",
    how: "Twelve disciplines covering: one codebase/many deploys, explicit dependencies, config in the environment, backing services as attached resources, stateless share-nothing processes, port binding, disposability (fast start/graceful stop), dev/prod parity, logs as event streams, one-off admin tasks as processes, and statelessness above all.",
    when: "Audit any app destined for cloud deployment against the list — the highest-yield factors are config (III), statelessness (VI), disposability (IX), and parity (X). Legacy apps score low on all; each factor you adopt is an independent win, no need for ceremony.",
    ref: "12factor.net",
    subtopics: [
      { name: "Config in environment", detail: "Factor III: the SAME artifact deploys to dev/staging/prod — only env vars differ. A config file forked per environment means the tested build isn't the shipped build." },
      { name: "Stateless processes", detail: "Factor VI: nothing request-relevant lives in process memory or local disk. Any instance can die mid-flight; sessions go to Redis, uploads to object storage." },
      { name: "Disposability", detail: "Factor IX: fast startup, graceful shutdown (finish in-flight work on SIGTERM, then die). Platforms kill instances casually — rebuilds and reschedules are normal weather." },
      { name: "Logs as streams", detail: "Factor XI: write events to stdout and let the platform route/aggregate them. The app has zero opinion about log files, rotation, or shipping." },
    ],
    code: `// III. CONFIG: all env, validated at boot — fail fast on missing config
const required = ["DATABASE_URL", "REDIS_URL", "JWT_SECRET"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("missing env: " + missing.join(", ")); // crash BEFORE serving traffic
  process.exit(1);
}
const config = { db: process.env.DATABASE_URL, redis: process.env.REDIS_URL, jwt: process.env.JWT_SECRET };

// VI. STATELESS: nothing request-scoped lives in this process
// sessions -> Redis, uploads -> S3, rate limits -> Redis (never a local Map)

// IX. DISPOSABLE: graceful shutdown on SIGTERM
const server = app.listen(config.port ?? 3000);
process.on("SIGTERM", async () => {
  server.close(() => console.log("drained: no in-flight requests")); // stop accepting
  await Promise.allSettled([pool.end(), redis.quit()]);               // release resources
  process.exit(0);
});

// XI. LOGS: stdout only — the platform is the log shipper
// console.log(JSON.stringify({ level: "info", msg: "serving", port: server.address().port }))

// XII. ADMIN: one-off tasks run in the SAME image
// docker run app-image npm run migrate        # not ssh + manual psql`,
    steps: ["Config in environment", "Stateless processes", "Backing services attached", "Logs as event streams"],
  },
];