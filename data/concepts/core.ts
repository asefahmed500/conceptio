import type { Concept } from "../types";

export const CORE: Concept[] = [
  {
    id: "core-ds",
    cat: "core",
    title: "Data Structures",
    one: "Arrays, lists, trees, graphs, and hash maps — the containers every algorithm is built from.",
    why: "The container you pick decides whether an operation takes microseconds or minutes. Data structures control how data sits in memory, which directly sets the cost of reading, inserting, and deleting — most 'slow code' is really 'wrong structure for the access pattern'.",
    how: "Each structure organizes elements differently: arrays store items contiguously for O(1) index access, hash maps hash a key to a bucket for O(1) average lookup, trees keep items ordered for O(log n) search, and linked lists chain nodes so inserting in the middle is O(1). You match the structure to the operation you perform most.",
    when: "Use an array for ordered iteration, a Map or Set for membership tests and keyed lookups, a tree when data must stay sorted, and a queue/stack to control processing order (FIFO/LIFO). Reach for a hash map by default — most backend problems are really 'find by key'.",
    ref: "CLRS — Introduction to Algorithms",
    subtopics: [
      { name: "Arrays", detail: "Contiguous memory gives O(1) index access, but inserting in the middle is O(n) because everything shifts. The default choice for ordered, iteration-heavy data." },
      { name: "Hash maps (Map/Set)", detail: "A hash function maps each key to a bucket, giving O(1) average lookup, insert, and delete. Worst case degrades to O(n) when many keys collide in one bucket." },
      { name: "Stacks & queues", detail: "A stack is last-in-first-out (undo, call stacks, DFS); a queue is first-in-first-out (job processing, BFS, request buffering)." },
      { name: "Trees & graphs", detail: "Trees keep data ordered for O(log n) search (B-trees power database indexes); graphs model relationships where any node can connect to any other, like social links or routing." },
    ],
    code: `// Finding a user by id: O(n) scan vs O(1) hash lookup
const usersAsArray = [
  { id: "u1", name: "Ada" },
  { id: "u2", name: "Grace" },
];

// Wrong structure for "find by id" — scans every entry
const byScan = usersAsArray.find((u) => u.id === "u2"); // O(n)

// Right structure: hash map keyed by id
const usersById = new Map(usersAsArray.map((u) => [u.id, u]));
const byKey = usersById.get("u2"); // O(1) — instant even with 10M rows

// Word-frequency counter with a Map
function wordCounts(text) {
  const counts = new Map();
  for (const word of text.toLowerCase().split(/\\s+/)) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts;
}
console.log(wordCounts("to be or not to be").get("to")); // 2`,
    steps: ["Choose structure", "Insert data", "Traverse / query", "Update or delete"],
  },
  {
    id: "core-bigo",
    cat: "core",
    title: "Big-O Notation",
    one: "Describes how runtime or memory grows as the input size grows.",
    why: "Code that feels fast with 100 rows can fall over at 10 million. Big-O lets you predict that collapse before it happens and compare algorithms on how they scale, not how they benchmark on one machine.",
    how: "You count the dominant operations as a function of input size n, then drop constants and smaller terms. A loop over n items is O(n); a loop inside a loop is O(n²); halving the problem each step (binary search) is O(log n). The highest-order term wins because it dominates as n grows.",
    when: "Use it whenever you choose an algorithm, design a schema, or estimate whether a feature survives production-scale data. Don't use it to micro-optimize code that runs on 20 items — constants and real-world caching often matter more there.",
    ref: "CLRS — Introduction to Algorithms",
    subtopics: [
      { name: "The common classes", detail: "O(1) constant (hash lookup), O(log n) (binary search, B-tree descent), O(n) (single scan), O(n log n) (good sorts), O(n²) (nested loops). Each step up is catastrophic at scale." },
      { name: "Drop the constants", detail: "Big-O ignores constant factors and small terms: 3n + 50 simplifies to O(n). It describes growth shape, not exact speed." },
      { name: "Time vs space", detail: "Every structure trades memory for speed. A hash map is O(1) lookup but pays O(n) extra memory; Big-O applies to memory growth the same way." },
      { name: "Amortized cost", detail: "Array.push is O(1) amortized — occasional resizes cost O(n) but averaged over many pushes it's constant. Judge operations over a sequence, not a single call." },
    ],
    code: `// O(n²) — for each user, rescan all orders
function matchOrdersSlow(users, orders) {
  const result = [];
  for (const user of users) {
    for (const order of orders) {
      if (order.userId === user.id) result.push(order);
    }
  }
  return result;
}

// O(n + m) — index orders by userId once, then look up
function matchOrdersFast(users, orders) {
  const byUser = new Map();
  for (const order of orders) {
    const list = byUser.get(order.userId) ?? [];
    list.push(order);
    byUser.set(order.userId, list);
  }
  return users.flatMap((u) => byUser.get(u.id) ?? []);
}

// With 10,000 users and 10,000 orders: ~100M ops vs ~20K ops.`,
    steps: ["Input size n", "Count operations", "Express growth rate", "Compare algorithms"],
  },
  {
    id: "core-recursion",
    cat: "core",
    title: "Recursion",
    one: "A function that calls itself until it hits a base case.",
    why: "Some data is recursive by nature — nested comment threads, file systems, org charts, JSON. Recursion lets you process the whole structure with a tiny function instead of manually managing stacks of work.",
    how: "Each call solves one small piece and delegates the rest to itself with smaller input. Two parts make it work: a base case that stops the descent, and a recursive step that always moves closer to it. Results then unwind back up the call stack.",
    when: "Use it for trees, nested structures, divide-and-conquer algorithms, and anything defined in terms of itself. Prefer iteration for very deep linear data — every recursive call consumes a stack frame, and 100,000-deep recursion overflows the stack.",
    ref: "CLRS — Introduction to Algorithms",
    subtopics: [
      { name: "Base case first", detail: "The base case is what stops recursion. Missing or unreachable base cases cause infinite recursion and a stack overflow crash." },
      { name: "The call stack", detail: "Every call gets its own stack frame with local variables. Depth = memory. JavaScript's default stack overflows around 10,000–100,000 frames." },
      { name: "Tail calls & iteration", detail: "A recursive call as the very last operation can in principle reuse the frame (tail-call optimization), but most JS engines don't — rewrite deep tail recursion as a loop." },
      { name: "Memoized recursion", detail: "Caching results by input turns exponential blowup (naive fib: O(2^n)) into linear time — the core idea behind dynamic programming." },
    ],
    code: `// Flatten a nested comment tree into a flat list with depth
function flattenComments(nodes, depth = 0, out = []) {
  for (const node of nodes) {
    out.push({ id: node.id, depth });        // record this level
    if (node.replies) {
      flattenComments(node.replies, depth + 1, out); // recurse deeper
    }
  }
  return out;
}

const thread = [
  { id: "a", replies: [{ id: "b", replies: [{ id: "c" }] }] },
  { id: "d" },
];
console.log(flattenComments(thread));
// [{id:"a",depth:0},{id:"b",depth:1},{id:"c",depth:2},{id:"d",depth:0}]

// Memoized recursion: Fibonacci without the exponential blowup
const memo = new Map();
function fib(n) {
  if (n <= 1) return n;
  if (memo.has(n)) return memo.get(n);
  const value = fib(n - 1) + fib(n - 2);
  memo.set(n, value);
  return value;
}
console.log(fib(50)); // instant — naive version would take minutes`,
    steps: ["Call function", "Check base case", "Recurse on smaller input", "Unwind & return"],
  },
  {
    id: "core-oop",
    cat: "core",
    title: "OOP Principles",
    one: "Encapsulation, inheritance, and polymorphism shape how code models real-world entities.",
    why: "OOP groups data and the behavior that operates on it into one place, so changes to an entity touch one class instead of scattered functions. It gives large codebases a vocabulary — entities, repositories, services — that maps to how teams talk about the domain.",
    how: "Encapsulation hides internal state behind methods; inheritance lets a class reuse and extend another; polymorphism lets different classes answer the same method call each in their own way, so calling code doesn't need if/else on types.",
    when: "Use it when modeling domain entities with state and behavior (User, Order, PaymentGateway). Keep it shallow — deep inheritance hierarchies become brittle; prefer composition ('has-a') over inheritance ('is-a') when in doubt.",
    ref: "Gang of Four — Design Patterns",
    subtopics: [
      { name: "Encapsulation", detail: "Private fields (JS # syntax) expose behavior, not data. Callers can't corrupt internal state, and you can change internals freely." },
      { name: "Inheritance", detail: "A subclass inherits and extends a parent's behavior. Useful for genuine is-a relationships; overused, it creates fragile hierarchies." },
      { name: "Polymorphism", detail: "Different implementations answer the same call — stripeGateway.pay() and paypalGateway.pay() satisfy the same interface, so checkout code never branches on payment type." },
      { name: "Composition over inheritance", detail: "Build complex behavior by combining small objects instead of extending a class tree. Easier to test, swap, and reason about." },
    ],
    code: `class PaymentGateway {
  #apiKey;
  constructor(apiKey) {
    this.#apiKey = apiKey;        // encapsulated — not reachable outside
  }
  charge(amountCents) {
    throw new Error("Subclasses must implement charge()");
  }
  keyHint() {
    return this.#apiKey.slice(0, 4); // controlled access for subclasses
  }
}

class StripeGateway extends PaymentGateway {
  async charge(amountCents) {
    console.log("Stripe: charging", amountCents, "with key", this.keyHint());
    return { status: "succeeded", provider: "stripe" };
  }
}

class MockGateway extends PaymentGateway {
  async charge(amountCents) {
    return { status: "succeeded", provider: "mock" }; // polymorphism: same call, own behavior
  }
}

// Checkout depends only on the base type — swappable per environment
async function checkout(gateway, cartTotalCents) {
  return gateway.charge(cartTotalCents);
}

const env = process.env.NODE_ENV;
const gateway = env === "test" ? new MockGateway("test") : new StripeGateway("sk_live_...");
console.log(await checkout(gateway, 4900));`,
    steps: ["Define class", "Encapsulate state", "Inherit / extend", "Polymorphic call"],
  },
  {
    id: "core-fp",
    cat: "core",
    title: "Functional Programming",
    one: "Pure functions and immutability reduce side effects and hidden state.",
    why: "Functions that only map inputs to outputs — no hidden writes, no global reads — are trivially testable, safely parallelizable, and predictable to refactor. FP removes the 'spooky action at a distance' that shared mutable state causes.",
    how: "You compose small pure functions with map/filter/reduce instead of writing imperative loops that mutate accumulators. Data is transformed by creating new values rather than editing old ones, so every step's output is visible and chainable.",
    when: "Use it for data transformation pipelines, business rules, and anything you want to unit-test without mocks. At the boundaries (HTTP, DB, filesystem) side effects are unavoidable — the goal is to confine them to a thin outer shell, not to eliminate them.",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "Pure functions", detail: "Same input always yields same output, no side effects. Pure functions can be cached (memoized), tested without setup, and run in any order." },
      { name: "Immutability", detail: "Instead of mutating, produce new values. This makes state changes explicit and prevents one part of a system from silently corrupting another's data." },
      { name: "Higher-order functions", detail: "Functions that take or return functions (map, filter, reduce, once, retry). They're how you express patterns instead of duplicating loop code." },
      { name: "Declarative pipelines", detail: "chainedUsers.filter(active).map(toDto) states what you want; an imperative loop states how to build it. Pipelines read like the business rule." },
    ],
    code: `// Imperative: mutation, accumulation, hard to test in isolation
function revenueImpressive(orders) {
  let total = 0;
  for (let i = 0; i < orders.length; i++) {
    if (orders[i].status === "paid") {
      total += orders[i].amountCents;
    }
  }
  return total;
}

// Functional: pure pipeline, each step obvious and testable
const isPaid = (order) => order.status === "paid";
const amount = (order) => order.amountCents;
const sum = (a, b) => a + b;

const revenue = (orders) => orders.filter(isPaid).map(amount).reduce(sum, 0);

const orders = [
  { status: "paid", amountCents: 1200 },
  { status: "refunded", amountCents: 800 },
  { status: "paid", amountCents: 500 },
];
console.log(revenue(orders)); // 1700 — same inputs, same output, no side effects`,
    steps: ["Input", "Pure function", "Output", "No shared state mutated"],
  },
  {
    id: "core-patterns",
    cat: "core",
    title: "Design Patterns",
    one: "Named, reusable solutions to recurring software design problems.",
    why: "Patterns give teams a shared vocabulary: 'make it a strategy' communicates a whole design in three words. They encode proven solutions so you don't reinvent (or mis-invent) approaches to problems thousands of codebases already solved.",
    how: "Each pattern is a template: the participants, their responsibilities, and how they interact. You recognize the shape of your problem (creation, structure, behavior) and adapt the template — patterns are applied, not copy-pasted.",
    when: "Use a pattern when your problem genuinely matches it — factory for object creation behind an interface, strategy for swappable algorithms, observer for event notification. Anti-pattern warning: forcing patterns onto simple code adds indirection with no benefit.",
    ref: "Gang of Four — Design Patterns",
    subtopics: [
      { name: "Singleton", detail: "One shared instance across the app (config, connection pool). Convenient but global — in tests it forces resets; in serverless, instances don't survive calls." },
      { name: "Factory", detail: "A function that creates objects without the caller choosing the concrete class — e.g. createMailer() returns SendGrid in prod and a logger in dev." },
      { name: "Strategy", detail: "Encapsulate interchangeable algorithms behind one interface and pick at runtime: pricing strategies, auth strategies, cache eviction strategies." },
      { name: "Observer", detail: "Subjects notify subscribed listeners — the engine beneath EventEmitter, webhooks, and every event-driven system." },
    ],
    code: `// STRATEGY: shipping cost rules change often — isolate each behind one interface
const strategies = {
  standard: (weightKg) => 500 + weightKg * 100,
  express: (weightKg) => 1200 + weightKg * 250,
  pickup: () => 0,
};

function shippingCost(method, weightKg) {
  const strategy = strategies[method];
  if (!strategy) throw new Error("Unknown shipping method: " + method);
  return strategy(weightKg);
}

console.log(shippingCost("standard", 2)); // 700
console.log(shippingCost("pickup", 2));   // 0

// FACTORY: pick the real implementation by environment, callers never know
function createMailer(env) {
  if (env === "production") return (to, body) => sendgridSend(to, body);
  return (to, body) => console.log("[dev mail to", to + "]", body);
}

const mailer = createMailer(process.env.NODE_ENV);
mailer("ada@example.com", "Your order shipped.");`,
    steps: ["Controller", "Service", "Repository", "Database"],
  },
  {
    id: "core-solid",
    cat: "core",
    title: "SOLID Principles",
    one: "Five principles that keep object-oriented code maintainable as it grows.",
    why: "As a codebase grows, the cost driver isn't writing code — it's changing it safely. SOLID names five habits that keep modules small, dependencies pointed in the right direction, and changes local instead of rippling through the system.",
    how: "Single Responsibility: one reason to change per class. Open/Closed: extend behavior by adding code, not editing stable code. Liskov: subtypes must be substitutable for their base. Interface Segregation: small, focused interfaces. Dependency Inversion: high-level logic depends on abstractions, which are injected from outside.",
    when: "Apply them as design reviews for anything meant to live long: services, domain logic, shared libraries. Skip the ceremony for throwaway scripts and thin CRUD handlers — dogmatic SOLID on trivial code produces interfaces nobody needs.",
    ref: "Robert C. Martin — Clean Code",
    subtopics: [
      { name: "Single responsibility", detail: "A class that validates, saves, AND emails orders changes for three reasons and breaks in three ways. Split by reason-to-change, not by noun." },
      { name: "Open/closed", detail: "Add a new payment provider by adding a class that satisfies the PaymentGateway interface — not by editing a switch statement inside checkout." },
      { name: "Liskov substitution", detail: "If a subclass throws on methods the base promises to work, it violates the contract — e.g. a ReadOnlyRepository extending Repository that can't save." },
      { name: "Dependency inversion", detail: "Business logic depends on a Notifier interface; the concrete EmailNotifier is injected at startup. Tests inject a fake — no mocking of concrete classes needed." },
    ],
    code: `// Dependency inversion + interface segregation in action
class Notifier {
  send(to, message) {
    throw new Error("implement send()");
  }
}

class EmailNotifier extends Notifier {
  send(to, message) {
    console.log("Email to", to, ":", message);
  }
}

class SmsNotifier extends Notifier {
  send(to, message) {
    console.log("SMS to", to, ":", message);
  }
}

// OrderService depends on the ABSTRACTION, never a concrete channel
class OrderService {
  constructor(notifier) {
    if (!(notifier instanceof Notifier)) throw new Error("notifier required");
    this.notifier = notifier;
  }
  placeOrder(user, cart) {
    const order = { id: "ord_" + Date.now(), user: user.id, items: cart.length };
    this.notifier.send(user.email, "Order " + order.id + " confirmed");
    return order;
  }
}

const service = new OrderService(new EmailNotifier());
service.placeOrder({ id: "u1", email: "ada@example.com" }, ["book"]);
// swap in new SmsNotifier() with zero changes to OrderService`,
    steps: ["Single responsibility", "Open/closed", "Liskov substitution", "Interface segregation", "Dependency inversion"],
  },
  {
    id: "core-async",
    cat: "core",
    title: "Async / Event Loop",
    one: "The runtime keeps working on other requests while one waits on I/O.",
    why: "A web server spends most of its life waiting — on databases, APIs, disks. Node's event loop turns that waiting time into throughput: one thread serves thousands of concurrent requests by never blocking on I/O.",
    how: "Async work (timers, network, disk) is handed to the runtime; callbacks/continuations land in queues. The event loop repeatedly: runs synchronous code, drains microtasks (promises), then checks timers and I/O completions. While an await suspends a function, the thread is free to serve other requests.",
    when: "Use it for I/O-bound workloads — APIs, proxies, real-time apps. Never run CPU-heavy loops on the main thread: one 50ms synchronous computation blocks every request for 50ms; move that to worker threads or a queue.",
    ref: "Node.js Documentation",
    subtopics: [
      { name: "Microtasks vs macrotasks", detail: "Promise continuations (microtasks) run immediately after the current code, before timers and I/O callbacks. This is why await feels synchronous." },
      { name: "Non-blocking I/O", detail: "File and network operations are delegated to the OS/libuv thread pool; your JS thread just registers a callback and moves on." },
      { name: "Sequential vs parallel awaits", detail: "awaiting in a loop runs one-by-one; starting promises first and Promise.all-ing them runs concurrently — often a 5–10x latency difference." },
      { name: "Event loop starvation", detail: "Long synchronous work (JSON.parse of a 50MB payload, crypto loops) blocks all requests. Profile for it; offload with worker_threads." },
    ],
    code: `// Sequential: 100ms + 100ms = ~200ms total
async function dashboardSlow(userId) {
  const user = await db.users.find(userId);      // 100ms
  const orders = await db.orders.byUser(userId); // 100ms AFTER user
  return { user, orders };
}

// Parallel: both start immediately — ~100ms total
async function dashboardFast(userId) {
  const [user, orders] = await Promise.all([
    db.users.find(userId),
    db.orders.byUser(userId),
  ]);
  return { user, orders };
}

// Per-request async flow — the thread serves others while we await
server.on("request", async (req, res) => {
  try {
    const data = await dashboardFast(req.params.userId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "internal" });
  }
});`,
    steps: ["Request in", "Hits I/O (DB call)", "Loop moves on", "Callback on completion", "Response out"],
  },
  {
    id: "core-concurrency",
    cat: "core",
    title: "Concurrency vs Parallelism",
    one: "Concurrency is managing many tasks at once; parallelism is running them simultaneously.",
    why: "Confusing the two leads to wrong architecture: Node is concurrent (one thread juggling many pending operations) but not parallel for JS execution. Knowing which you have tells you whether your bottleneck is scheduling or CPU.",
    how: "Concurrency interleaves progress on multiple tasks — start task A, while it awaits I/O start task B — on one thread. Parallelism executes tasks at the same instant on multiple cores or machines. Concurrency is about structure; parallelism is about execution.",
    when: "Use concurrency (async/await, queues) to overlap I/O waits; use parallelism (worker_threads, cluster, multiple processes) to use multiple cores for CPU-bound work. A single Node process is concurrent by default; it needs explicit help to be parallel.",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "Interleaving, not simultaneity", detail: "One waiter serving five tables is concurrency — always busy with someone, never two at once. Parallelism is five waiters, one per table." },
      { name: "JS is single-threaded", detail: "Your JavaScript runs on one thread; parallelism only comes from worker_threads, child processes, or other services. I/O waits overlap; CPU work does not." },
      { name: "Race conditions", detail: "Concurrent tasks sharing state without coordination produce order-dependent bugs — two awaits read-then-write the same balance and one update is lost." },
      { name: " worker_threads & cluster", detail: "worker_threads give true in-process parallelism for CPU tasks; cluster runs one process per core for request throughput." },
    ],
    code: `const { Worker } = require("worker_threads");

// CONCURRENT (single thread): overlap 3 API calls during their waits
async function concurrentFetch() {
  const start = Date.now();
  const [user, orders, invoices] = await Promise.all([
    fetch("/api/user").then((r) => r.json()),
    fetch("/api/orders").then((r) => r.json()),
    fetch("/api/invoices").then((r) => r.json()),
  ]);
  console.log("concurrent ms:", Date.now() - start); // ~ slowest single call
  return { user, orders, invoices };
}

// PARALLEL (multiple threads): hash 4 files on 4 cores simultaneously
function hashOnWorker(data) {
  return new Promise((resolve, reject) => {
    const worker = new Worker("./hash-worker.js", { workerData: data });
    worker.on("message", resolve);
    worker.on("error", reject);
  });
}

async function parallelHash(files) {
  return Promise.all(files.map((f) => hashOnWorker(f))); // truly simultaneous
}`,
    steps: ["Tasks queued", "Interleaved (concurrent)", "Or simultaneous (parallel)", "Results combined"],
  },
  {
    id: "core-memory",
    cat: "core",
    title: "Memory Management",
    one: "Stack vs heap allocation, and garbage collection reclaiming unused memory.",
    why: "You don't free memory manually in JS, but you can still leak it — and leaked memory in a long-lived Node process means latency spikes, OOM kills, and 3 a.m. restarts. Understanding allocation tells you what keeps memory alive.",
    how: "Primitives and object references live on the stack/heap as the runtime sees fit; the garbage collector frees objects once nothing references them (reachability). A value stays alive as long as any live closure, global, cache, or listener can still reach it.",
    when: "Think about memory in long-running processes: unbounded caches, growing arrays, forgotten timers and listeners. Use heap snapshots to find leaks; use WeakMap/WeakRef when you want associativity without pinning objects in memory.",
    ref: "V8 Engine Documentation",
    subtopics: [
      { name: "Reachability rules GC", detail: "GC frees only unreachable objects. One forgotten reference — in a global map, an active listener, a closure — keeps an entire object graph alive." },
      { name: "Common Node leaks", detail: "Unbounded caches, setInterval never cleared, event listeners re-registered per request, and closures capturing large scopes in long-lived callbacks." },
      { name: "WeakMap & WeakRef", detail: "Keys in a WeakMap don't prevent collection — perfect for metadata attached to objects you don't own, like caching computed values per request object." },
      { name: "Diagnosing with snapshots", detail: "Take two heap snapshots under load (heapdump / Chrome DevTools), diff them, and look for objects that only grow — that's your leak." },
    ],
    code: `// LEAK: this cache grows forever — every request pins its data in memory
const cache = new Map();
function leakyRemember(key, bigPayload) {
  cache.set(key, bigPayload); // never evicted, never expires
}

// FIXED: bounded + expiring cache
const TTL_MS = 5 * 60 * 1000;
const bounded = new Map();
function remember(key, value) {
  if (bounded.size >= 1000) {
    const oldest = bounded.keys().next().value; // Map preserves insertion order
    bounded.delete(oldest);                     // evict oldest entry
  }
  bounded.set(key, { value, expires: Date.now() + TTL_MS });
}
function get(key) {
  const entry = bounded.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    bounded.delete(key);
    return null; // unreachable -> eligible for garbage collection
  }
  return entry.value;
}

// WeakMap: metadata without keeping the target alive
const meta = new WeakMap();
function track(req) {
  meta.set(req, { startedAt: Date.now() }); // vanishes when req is collected
}`,
    steps: ["Allocate memory", "Use (stack or heap)", "Becomes unreachable", "Garbage collected"],
  },
  {
    id: "core-errors",
    cat: "core",
    title: "Error Handling",
    one: "Fail loudly in development, fail safely in production — never swallow errors silently.",
    why: "Unhandled and swallowed errors are the two extremes that break systems: a crash mid-request loses user work, while a silent catch hides corruption until it's unrecoverable. Deliberate error handling turns failures into observable, recoverable events.",
    how: "Fail fast on programmer errors (invalid config at startup), recover gracefully on operational errors (DB timeout, 429 from an API). Throw typed errors, catch at the boundary that can actually respond (a request handler), log with context, and translate to safe responses.",
    when: "Wrap I/O boundaries and third-party calls; validate inputs before business logic; centralize handling in one middleware/loop so every failure gets the same logging and response shape. Never catch an error just to log and rethrow nothing — that's how data loss hides.",
    ref: "Node.js Documentation",
    subtopics: [
      { name: "Operational vs programmer errors", detail: "Operational errors (timeout, validation) are expected — handle them. Programmer errors (undefined is not a function) are bugs — crash loudly and let the supervisor restart." },
      { name: "Typed errors", detail: "Custom error classes with codes (NotFoundError, ValidationError) let handlers branch on type instead of parsing message strings." },
      { name: "Centralized boundary", detail: "One error middleware (or process-level handler) formats every failure: log stack + context, return 4xx/5xx, never leak stack traces to clients." },
      { name: "Always preserve context", detail: "When rethrowing, attach what matters: userId, requestId, the failing input. An error without context is a bug report you can't act on." },
    ],
    code: `class AppError extends Error {
  constructor(status, code, message, context = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.context = context;
  }
}

const NotFound = (what, id) => new AppError(404, "not_found", what + " " + id + " not found");

// Business layer throws typed, contextual errors
async function getUser(repo, id) {
  const user = await repo.find(id);
  if (!user) throw NotFound("User", id);
  return user;
}

// ONE boundary translates every failure safely
function errorHandler(err, req, res, logger) {
  const status = err.status ?? 500;
  logger.error({
    code: err.code ?? "internal",
    message: err.message,
    context: err.context,
    path: req.url,
    stack: err.stack,
  });
  res.status(status).json({
    error: err.code ?? "internal_error",
    // never expose stack traces or internals to clients
  });
}

process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection — bug in code", err);
  process.exit(1); // fail loudly: supervisor restarts a clean process
});`,
    steps: ["Error thrown", "Caught & typed", "Logged with context", "Safe response returned"],
  },
  {
    id: "core-types",
    cat: "core",
    title: "Type Systems",
    one: "Static vs dynamic typing changes when type errors are caught.",
    why: "Every runtime TypeError — undefined is not a function — is a type error caught at the worst moment: in production, by a user. A type system moves that discovery to compile time or, in plain JS, to the edges via validation.",
    how: "Static types annotate values so a checker proves operations make sense before running. Dynamic typing checks at runtime — flexible, but every assumption (is it a string? is it defined?) must be defended with checks or validated at the boundary.",
    when: "Use TypeScript (or JSDoc types) for anything beyond a script — refactors become mechanical and self-verifying. Whatever you choose, validate external input (HTTP bodies, env vars, queue messages) at the boundary with a schema — the type system can't see the network.",
    ref: "TypeScript Handbook",
    subtopics: [
      { name: "Compile-time vs runtime", detail: "Static checks catch wrong-shape data before deploy; runtime checks catch it when it happens. TS gives you the first; schema validation gives you the second." },
      { name: "TypeScript in JS projects", detail: "JSDoc comments (/** @param {string} id */) give editors and tsc type checking while files stay .js — a low-friction upgrade path." },
      { name: "Boundary validation", detail: "Types describe what your code assumes; runtime schemas (zod, ajv) verify what actually arrived. Parse, don't guess: unknown input is untyped input." },
      { name: "any is a hole", detail: "Every any silences the checker at that point and all points downstream. Prefer unknown — it forces an explicit check before use." },
    ],
    code: `// Plain JS: every assumption must be defended at runtime
function createOrderJs(body) {
  if (typeof body !== "object" || body === null) {
    throw new Error("body must be an object");
  }
  if (typeof body.userId !== "string") {
    throw new Error("userId must be a string"); // caught in production
  }
  if (!Number.isInteger(body.amountCents) || body.amountCents <= 0) {
    throw new Error("amountCents must be a positive integer");
  }
  return { userId: body.userId, amountCents: body.amountCents };
}

// Same guarantees expressed as a reusable schema (zod-style)
const OrderSchema = {
  validate(body) {
    const result = createOrderJs(body); // one place, reused everywhere
    return result;
  },
};

// TypeScript equivalent — the compiler now enforces this everywhere:
// interface Order { userId: string; amountCents: number; }
// function createOrder(body: unknown): Order { ... }`,
    steps: ["Write code", "Static: checked at compile", "Dynamic: checked at runtime", "Errors surface"],
  },
  {
    id: "core-immutability",
    cat: "core",
    title: "Immutability",
    one: "Data that can't change after creation, reducing bugs from shared state.",
    why: "Most Nightmare Bugs™ are two pieces of code mutating the same object with different assumptions. Immutable data can't change under you: values are facts you can pass anywhere, cache, compare, and reason about without synchronization.",
    how: "Instead of editing an object, you create a new version with the change applied (spread, structuredClone, or libraries like Immer). Old references keep their original value, so anyone holding them sees consistent data forever.",
    when: "Default to immutability for shared state, cache values, config, and anything crossing an async boundary. Write hot paths (parsing megabytes, per-pixel loops) mutatively when profiling proves it — mutate locally inside a function, then freeze the result.",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "Copy-on-write", detail: "Never assign into a shared object; spread into a new one: { ...user, name: 'Ada' }. The original stays valid for everyone still holding it." },
      { name: "Shallow vs deep", detail: "Spread copies one level — nested objects are still shared. structuredClone (or Immer) gives deep copies when nested state matters." },
      { name: "Object.freeze", detail: "freeze() makes an object read-only at runtime (shallow by default) — great for config objects where accidental mutation should throw in strict mode." },
      { name: "Cheap equality", detail: "If data never changes, equality is reference equality — React, memoization, and change detection all get faster and simpler." },
    ],
    code: `"use strict";

// MUTATION: two holders of "cart" see a surprise
const cartA = { items: ["book"] };
const cartB = cartA;
cartB.items.push("knife"); // cartA changed too — who did that?

// IMMUTABLE UPDATE: new version, old one untouched
const cart1 = Object.freeze({ items: Object.freeze(["book"]) });
const cart2 = { ...cart1, items: [...cart1.items, "pen"] };
console.log(cart1.items); // ["book"] — still exactly what it was
console.log(cart2.items); // ["book", "pen"]

// Deep-freeze config so nobody can tamper with it at runtime
function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") deepFreeze(value);
  }
  return Object.freeze(obj);
}

const config = deepFreeze({ db: { host: "localhost", port: 5432 } });
try {
  config.db.host = "evil.example.com";
} catch (err) {
  console.log("blocked:", err.message); // Cannot assign to read only property
}`,
    steps: ["Create value", "Never mutate", "Copy on change", "Old reference stays valid"],
  },
  {
    id: "core-closures",
    cat: "core",
    title: "Closures",
    one: "A function that remembers variables from its enclosing scope.",
    why: "Closures let a function carry private, persistent state without global variables or classes. They are the foundation of module patterns, callbacks, middleware, memoization, and once-only initialization in JavaScript.",
    how: "When an inner function references variables from an outer function, the runtime keeps those variables alive as long as the inner function exists. Every call of the inner function reads and writes that same captured scope, so state persists between calls while staying invisible to the outside.",
    when: "Use closures for private state (counters, caches, once-guards), factory functions that pre-configure behavior, and middleware that wraps a request. Avoid them for large data that must be released — a closure keeps its captured variables in memory as long as it lives.",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "Private state", detail: "Variables captured by a closure can't be reached from outside — only through the functions that close over them. Real encapsulation without classes." },
      { name: "Factory functions", detail: "A function that returns another function configured at creation time, e.g. makeMultiplier(3) returns a function that always multiplies by 3." },
      { name: "Memoization", detail: "A closure can hold a cache object between calls so repeated inputs return instantly instead of recomputing." },
      { name: "The classic loop trap", detail: "var is function-scoped, so callbacks created in a for loop all share one variable; let creates a fresh binding per iteration and fixes the surprise." },
    ],
    code: `// createCounter returns a function with private, persistent state
function createCounter() {
  let count = 0; // captured by the closure — invisible from outside

  return function increment() {
    count += 1; // same variable on every call
    return count;
  };
}

const next = createCounter();
console.log(next()); // 1
console.log(next()); // 2 — state persisted between calls

// Real-world use: an Express-style rate-limit middleware factory
function rateLimit(max) {
  let hits = 0; // private per mounted instance
  return function (req, res, next) {
    hits += 1;
    if (hits > max) return res.status(429).send("Too many requests");
    next();
  };
}`,
    steps: ["Outer function runs", "Inner function defined", "Outer returns", "Inner still holds scope"],
  },
  {
    id: "core-di",
    cat: "core",
    title: "Dependency Injection",
    one: "Pass a class's dependencies in from outside instead of creating them internally.",
    why: "A service that constructs its own database client is welded to it: you can't test it without a real database, swap providers, or vary config per environment. Injection turns hard-wired dependencies into explicit, replaceable inputs.",
    how: "Dependencies arrive through the constructor (or function parameters). The composition root — usually app startup — decides which concrete implementations to wire in. The business class only knows the interface it received.",
    when: "Use it for anything touching I/O: repositories, mailers, payment providers, clocks. It makes unit tests trivial (inject in-memory fakes) and environment swaps one-line changes. Skip the DI frameworks in small apps — constructor injection by hand is enough.",
    ref: "NestJS Documentation",
    subtopics: [
      { name: "Constructor injection", detail: "Required dependencies as constructor parameters make the contract explicit and the object impossible to construct half-configured." },
      { name: "The composition root", detail: "One place (main.ts / app factory) builds real implementations and wires them together; everything downstream stays ignorant of concrete choices." },
      { name: "Test doubles", detail: "Inject an in-memory UserRepository in tests — no DB, no mocks framework, fast deterministic tests." },
      { name: "Inject time too", detail: "Instead of calling new Date() deep inside logic, inject a clock. Tests can freeze or advance time to test expiry, rate windows, and schedules." },
    ],
    code: `class UserRepository {
  async find(id) {
    throw new Error("implement find()");
  }
}

class PgUserRepository extends UserRepository {
  constructor(pool) {
    super();
    this.pool = pool;
  }
  async find(id) {
    const { rows } = await this.pool.query("select * from users where id = $1", [id]);
    return rows[0] ?? null;
  }
}

class InMemoryUserRepository extends UserRepository {
  constructor(users) {
    super();
    this.users = new Map(users.map((u) => [u.id, u]));
  }
  async find(id) {
    return this.users.get(id) ?? null;
  }
}

// AuthService receives its dependency — it never constructs one
class AuthService {
  constructor(users) {
    this.users = users;
  }
  async getProfile(id) {
    const user = await this.users.find(id);
    if (!user) throw new Error("user not found");
    return { id: user.id, name: user.name };
  }
}

// Production wiring:
const prod = new AuthService(new PgUserRepository(pool));
// Test wiring — same class, zero database:
const test = new AuthService(new InMemoryUserRepository([{ id: "u1", name: "Ada" }]));`,
    steps: ["Define dependency", "Inject via constructor", "Class uses it", "Swap implementation freely"],
  },
  {
    id: "core-iterators",
    cat: "core",
    title: "Iterators & Generators",
    one: "Objects that produce a sequence of values one at a time, lazily.",
    why: "Materializing a million-row query or a huge file into an array wastes memory and delays the first result. Iterators and generators let you stream values as they're produced — constant memory, instant first item, composable with for...of.",
    how: "An iterator is any object with next() returning { value, done }. A generator (function*) builds one automatically: each yield pauses the function, returns a value, and resumes only when the consumer asks for the next one. Pull-based: nothing computes until requested.",
    when: "Use generators for streaming large datasets (DB cursors, log files, paginated APIs), infinite sequences, and lazy pipelines. Use plain arrays when you need random access, .length, or multiple passes — generators are single-shot streams.",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "The iterator protocol", detail: "next() returns { value, done }. Any object implementing it works with for...of, spread, and destructuring — that's the whole contract." },
      { name: "Laziness", detail: "Code after yield doesn't run until the next pull. A generator over 10M rows holds one row in memory at a time, not ten million." },
      { name: "yield* delegation", detail: "yield* delegates to another iterable — compose generators like functions: yield* paginate(page + 1) recurses through result sets." },
      { name: "Early exit & cleanup", detail: "Breaking a for...of calls the generator's return() — put try/finally inside to close DB cursors or file handles even when the consumer stops early." },
    ],
    code: `// Stream rows from a paginated API without loading everything
async function* fetchAllUsers(pageUrl) {
  let url = pageUrl;
  while (url) {
    const res = await fetch(url);
    const page = await res.json();
    for (const user of page.data) {
      yield user; // pause here until the consumer asks for the next one
    }
    url = page.next_page_url; // null ends the stream
  }
}

// Constant memory: one page alive at a time, even across 10,000 pages
for await (const user of fetchAllUsers("https://api.example.com/users")) {
  if (user.banned) {
    console.log("first banned user:", user.id);
    break; // stops pulling — later pages are never fetched
  }
}

// Lazy pipeline: nothing runs until the loop consumes it
function* take(iterable, n) {
  let count = 0;
  for (const item of iterable) {
    if (count++ >= n) return;
    yield item;
  }
}
const nums = function* () { for (let i = 1; ; i++) yield i; }; // infinite
for (const n of take(nums(), 3)) console.log(n); // 1 2 3`,
    steps: ["Call next()", "Yield one value", "Pause execution", "Resume on next call"],
  },
  {
    id: "core-regex",
    cat: "core",
    title: "Regular Expressions",
    one: "Pattern matching for validating and extracting text.",
    why: "Half of input processing is 'does this string look right, and pull out the parts' — emails, phone numbers, slugs, log lines, route params. Regex encodes that in one declarative pattern instead of nested string slicing.",
    how: "A pattern describes shapes: character classes ([a-z]), quantifiers (+, {2,4}), anchors (^, $), and groups () for extraction. The engine scans the input for matches; named groups let you pull fields out by name instead of index.",
    when: "Use it for validation, extraction, and search-replace on well-understood text. Don't use it for structured formats (HTML, JSON, SQL) — parse those properly. Complex regex becomes write-only; comment it or build it from named pieces.",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "Character classes & quantifiers", detail: "\\d digits, \\w word chars, \\s whitespace; + one-or-more, * zero-or-more, {3,16} a range. The vocabulary of every pattern." },
      { name: "Capture groups", detail: "Parentheses remember matched slices: /(?<year>\\d{4})-(?<month>\\d{2})/ names them, match.groups.year pulls them out safely." },
      { name: "Greedy vs lazy", detail: ".* grabs as much as possible (to the LAST match of what follows); .*? stops at the FIRST. The classic <.+> vs <.+?> HTML-tag difference." },
      { name: "ReDoS danger", detail: "Nested quantifiers on user input ((a+)+$) can make the engine backtrack exponentially — a denial-of-service vector. Prefer linear patterns and length caps." },
    ],
    code: `// Validate and extract — one pattern instead of string surgery
const slugRe = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
console.log(slugRe.test("my-clean-slug")); // true
console.log(slugRe.test("My Clean Slug")); // false

// Named groups pull fields out by name
const logRe = /(?<level>ERROR|WARN|INFO) \\[(?<time>[^\\]]+)\\] (?<msg>.*)/;
const line = 'ERROR [2026-09-13T10:15:00] DB connection refused';
const { groups } = line.match(logRe);
console.log(groups.level, "at", groups.time, ":", groups.msg);

// Extract all prices from text
const prices = "Coffee $3.50, sandwich $8.25, total $11.75".match(/\\$\\d+\\.\\d{2}/g);
console.log(prices); // ["$3.50", "$8.25", "$11.75"]

// Safe replacement: mask everything but the last 4 digits
const masked = "4242-4242-4242-1234".replace(/^.*-(\\d{4})$/, "****-****-****-$1");
console.log(masked); // ****-****-****-1234`,
    steps: ["Define pattern", "Scan input string", "Match found", "Extract or replace"],
  },
  {
    id: "core-serialization",
    cat: "core",
    title: "Serialization",
    one: "Converting in-memory objects into a transferable format like JSON.",
    why: "Memory objects live in one process; HTTP responses, queue messages, cache entries, and files all need bytes. Serialization is the bridge — and the place where Dates vanish, undefined disappears, and BigInts throw if you're careless.",
    how: "JSON.stringify walks the object and writes text; JSON.parse reads it back. Anything without a JSON representation (functions, undefined, Dates — which silently become strings) is lost or transformed. Custom toJSON/toReviver control the mapping.",
    when: "Use JSON for APIs, queues, and cache entries; consider binary formats (protobuf, msgpack) when payloads are big or hot paths. Always version and validate deserialized data — a parse gives you unknown-shaped values, not trust.",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "What JSON loses", detail: "Functions, undefined, Symbols, and Map/Set don't survive; Dates become ISO strings; keys with undefined values are dropped. Round-trip tests catch surprises." },
      { name: "toJSON & reviver", detail: "A toJSON method customizes how an object serializes; the parse reviver rehydrates — e.g. reviving ISO strings back into Date instances." },
      { name: "Versioned payloads", detail: "Queue messages outlive deploys. Include a version field and keep old parsers working, or consumers crash on yesterday's messages." },
      { name: "Safe parsing", detail: "JSON.parse throws on malformed input — wrap untrusted payloads (HTTP bodies, queue messages) in try/catch and reject cleanly, never crash the worker." },
    ],
    code: `const event = {
  id: "evt_1",
  createdAt: new Date("2026-09-13T10:00:00Z"),
  meta: { retries: 0, note: undefined }, // undefined keys vanish
};

const wire = JSON.stringify(event, (key, value) =>
  value instanceof Date ? value.toISOString() : value
);
console.log(wire);
// {"id":"evt_1","createdAt":"2026-09-13T10:00:00.000Z","meta":{"retries":0}}

// Reviver rehydrates Dates on the way back
const back = JSON.parse(wire, (key, value) => {
  if (typeof value === "string" && /^\\d{4}-\\d{2}-\\d{2}T/.test(value)) {
    return new Date(value);
  }
  return value;
});
console.log(back.createdAt instanceof Date); // true

// Never crash a worker on malformed queue messages
function safeParse(raw) {
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: "malformed payload" };
  }
}`,
    steps: ["In-memory object", "Serialize (stringify)", "Send / store", "Deserialize (parse)"],
  },
  {
    id: "core-eventdriven",
    cat: "core",
    title: "Event-Driven Programming",
    one: "Code reacts to emitted events rather than running strictly top-to-bottom.",
    why: "Direct calls couple the caller to the callee — every new feature edits the same function. Events invert that: the emitter announces 'this happened' and any number of listeners react, without knowing about each other.",
    how: "A registry maps event names to handler functions. emit('order.placed', data) synchronously (or async) invokes every registered listener. Nothing happens for events with no listeners — the emitter never waits on or fails because of one.",
    when: "Use it for cross-cutting reactions (audit, notifications, cache invalidation) and plugin-style extension points. Don't use it for the main request path — implicit call chains are hard to trace; keep critical flows explicit and reserve events for side channels.",
    ref: "Node.js Documentation",
    subtopics: [
      { name: "Emitter, event, listener", detail: "Node's EventEmitter is the pattern in one class: on(name, fn) subscribes, emit(name, ...args) fires. Almost every Node API (servers, streams, processes) is built on it." },
      { name: "Loose coupling", detail: "Billing can react to order.placed without the order service importing it. Add and remove features by adding and removing listeners." },
      { name: "Error events", detail: "An emit('error') with no listener THROWS and crashes the process — every emitter that can fail needs an error listener, always." },
      { name: "Sync by default", detail: "Listeners run in order, synchronously, during emit. A slow listener delays the emitter — wrap listener bodies in setImmediate/queue work for heavy tasks." },
    ],
    code: `const { EventEmitter } = require("events");

const bus = new EventEmitter();

// Listeners react to the same event, independently
bus.on("order.placed", (order) => {
  console.log("email: receipt for", order.id);
});
bus.on("order.placed", (order) => {
  console.log("analytics: tracking", order.id, order.totalCents);
});
bus.on("order.placed", async (order) => {
  // heavy work must not block the emitter — defer it
  setImmediate(() => console.log("warehouse: reserving stock for", order.id));
});

// The emitter knows nothing about email, analytics, or warehouses
function placeOrder(cart) {
  const order = { id: "ord_" + Date.now(), totalCents: cart.reduce((s, i) => s + i.priceCents, 0) };
  bus.emit("order.placed", order);
  return order;
}

const order = placeOrder([{ priceCents: 1200 }, { priceCents: 800 }]);
console.log("returned immediately:", order.id);

// Never forget an error listener — it crashes the process otherwise
bus.on("error", (err) => console.error("bus error:", err.message));`,
    steps: ["Event emitted", "Listener registered", "Handler runs", "Program continues"],
  },
  {
    id: "core-modules",
    cat: "core",
    title: "Modules & Packages",
    one: "Splitting code into reusable, independently versioned units.",
    why: "One giant file can't be navigated, tested, or reused. Modules give every unit a clear public surface and private internals; packages take it further with independent versioning and distribution through npm.",
    how: "A file is a module: export names you want public, import what you need. The module system caches instances, so a module's top-level code runs once per process — a natural place for singletons like config or pools.",
    when: "Split along responsibility lines (routes, services, repositories, utils) so each file has one reason to change. Extract to a package only when code is genuinely shared across projects — premature packaging adds release friction for nothing.",
    ref: "npm Documentation",
    subtopics: [
      { name: "ESM vs CommonJS", detail: "import/export (ESM) is the standard, with static analysis that enables tree-shaking; require()/module.exports (CommonJS) is the legacy system most npm packages still support." },
      { name: "Public surface discipline", detail: "Export the minimum: a module exposing 30 functions is hard to use and impossible to refactor. One clear entry point (index.js) per folder." },
      { name: "Barrel files & boundaries", detail: "index.js re-exports the public API so internals can rename freely. Import from the folder, never reach into another module's internals." },
      { name: "Semantic versioning", detail: "major.minor.patch: breaking changes bump major, features bump minor, fixes bump patch. Pin dependencies and read changelogs before major upgrades." },
    ],
    code: `// ---------- money.js ----------
const RATES = { usd: 1, eur: 1.08, gbp: 1.27 }; // private to this module

function toUsd(amount, currency) {
  const rate = RATES[currency];
  if (!rate) throw new Error("unsupported currency: " + currency);
  return amount * rate;
}

function format(cents) {
  return "$" + (cents / 100).toFixed(2);
}

module.exports = { toUsd, format }; // the entire public surface

// ---------- checkout.js ----------
const { format: fmt } = require("./money"); // cached after first require

function receipt(items) {
  const total = items.reduce((sum, i) => sum + i.priceCents, 0);
  return "Total: " + fmt(total);
}

console.log(receipt([{ priceCents: 1200 }, { priceCents: 800 }])); // Total: $20.00

// ESM equivalent in an "money.mjs" world:
// export function toUsd(...) {...}
// import { toUsd } from "./money.mjs";`,
    steps: ["Write module", "Export functions", "Publish package", "Import elsewhere"],
  },
  {
    id: "core-testing",
    cat: "core",
    title: "Testing Fundamentals",
    one: "Unit, integration, and end-to-end tests check correctness at different scopes.",
    why: "Tests are the difference between refactoring with confidence and hoping. They pin down current behavior, document intent with executable examples, and catch regressions before users do — far cheaper than production incidents.",
    how: "Unit tests exercise one function/class with fakes around it — fast, thousands of them. Integration tests run real pieces together (service + real Postgres in Docker) to catch wiring bugs. E2E drives the whole system over HTTP like a real client.",
    when: "Push most tests down to the unit level (fast, precise failures), a solid layer of integration tests around real I/O, and a handful of E2E tests over critical user journeys. Test behavior, not implementation — tests that break on every refactor are a tax, not a safety net.",
    ref: "Martin Fowler — Testing",
    subtopics: [
      { name: "Arrange-Act-Assert", detail: "Set up inputs, call the thing, assert the outcome. Keeping the three phases visible makes every test readable in five seconds." },
      { name: "The test pyramid", detail: "Many unit, fewer integration, few E2E. Inverted pyramids (mostly E2E) are slow, flaky, and give vague failures." },
      { name: "Fakes over mocks", detail: "An in-memory repository behaves like the real thing; a mock asserts call sequences and breaks on every internal refactor. Prefer fakes for state, spies for side effects." },
      { name: "Deterministic tests", detail: "Inject the clock, seed random values, and never sleep in tests. Flaky tests get ignored — an ignored test is a deleted test." },
    ],
    code: `// The unit under test — dependencies injected so tests need no DB
function createCheckout({ repo, clock }) {
  return async function checkout(userId, cart) {
    const total = cart.reduce((s, i) => s + i.priceCents, 0);
    const order = { id: "ord_" + clock.now(), userId, total, paid: true };
    await repo.save(order);
    return order;
  };
}

// Minimal fake repository — behaves like the real one, zero I/O
function fakeRepo() {
  const saved = [];
  return { save: async (o) => saved.push(o), saved };
}

// ---------- unit test (tiny, deterministic) ----------
async function testCheckoutAppliesTotal() {
  // Arrange
  const repo = fakeRepo();
  const checkout = createCheckout({ repo, clock: { now: () => 1234 } });

  // Act
  const order = await checkout("u1", [{ priceCents: 1200 }, { priceCents: 800 }]);

  // Assert
  console.assert(order.total === 2000, "total should be 2000");
  console.assert(repo.saved.length === 1, "order should be persisted");
  console.log("PASS checkout totals");
}

await testCheckoutAppliesTotal();

// An integration test of the same flow runs against real Postgres in Docker —
// same Arrange-Act-Assert shape, slower, catches wiring and SQL bugs.`,
    steps: ["Unit (one function)", "Integration (components together)", "End-to-end (full flow)", "CI runs all"],
  },
  {
    id: "core-git",
    cat: "core",
    title: "Version Control (Git)",
    one: "Tracking every change to code with the ability to branch and merge safely.",
    why: "Git turns code history into a safety net: every change is attributable, revertible, and reviewable. Branches let many people work in parallel; the commit history is the incident-response tool when a deploy breaks.",
    how: "Commits snapshot the staged tree. Branches are movable pointers to a commit, so creating one is instant. Merging combines histories; rebase replays your commits onto another base for a linear story. Everything is local until you push.",
    when: "Branch per feature/fix, commit in small reviewable steps, and open PRs early. Rewriting history (rebase/amend) is fine on your own unpushed branches — never on shared ones. When a deploy goes wrong, revert the commit rather than hot-fixing forward in a panic.",
    ref: "Git Documentation",
    subtopics: [
      { name: "The staging area", detail: "git add selects exactly what the next commit contains — you can commit part of a file's changes and leave the rest for a second commit." },
      { name: "Branches are cheap", detail: "A branch is a 41-byte pointer file. Branch for every unit of work; long-lived shared branches are what causes merge pain." },
      { name: "Merge vs rebase", detail: "Merge preserves real history with a join commit; rebase replays commits for a linear log. Rule: rebase private branches, merge shared ones." },
      { name: "Revert for undo", detail: "git revert creates a new commit that undoes an old one — the safe production undo, because history stays intact for everyone else." },
    ],
    code: `// Terminal session — the everyday Git loop:
// $ git switch -c feature/rate-limiting     # instant branch for one unit of work
// $ git add middleware/rate-limit.js        # stage exactly this change
// $ git commit -m "add token bucket rate limiter"
//
// $ git push -u origin feature/rate-limiting  # open a PR from here
//
// Someone reports the new limiter broke prod — surgical undo:
// $ git revert 9f3c2ab                      # new commit that reverses it
// $ git push                                # history stays intact
//
// Inspect what changed and who to ask:
// $ git log --oneline -5
// 9f3c2ab add token bucket rate limiter
// 5d1e0f4 fix: edge case in pagination
// $ git blame middleware/rate-limit.js      # line-by-line authorship`,
    steps: ["Commit change", "Branch off", "Merge back", "History preserved"],
  },
  {
    id: "core-apidesign",
    cat: "core",
    title: "API Design Principles",
    one: "Predictable, consistent naming and behavior make an API easy to learn and use.",
    why: "An API is a promise: once clients depend on it, changes are expensive forever. Consistency is the compounding asset — a developer who learns one endpoint should already know how all the others behave.",
    how: "Model endpoints around resources (nouns), let HTTP methods express intent, keep naming and error shapes uniform, and version from day one. Every response answers: did it work, what did I get, and what went wrong — in the same structure every time.",
    when: "Apply rigor to anything a second consumer will touch — public APIs, frontend-backend contracts, internal service APIs. Sketch the resource model and error format before writing handlers; retrofitting consistency after clients exist is a breaking change.",
    ref: "Google API Design Guide",
    subtopics: [
      { name: "Resources, not verbs", detail: "POST /orders not /createOrder — the method carries the verb, the URL identifies the thing. Predictable routes are guessable routes." },
      { name: "Consistent error envelope", detail: "Every failure: { error: { code, message, details } }. Clients write one error handler, not one per endpoint." },
      { name: "Version from day one", detail: "/v1/orders gives you room to evolve. Breaking changes ship as /v2 while v1 lives on a deprecation timeline." },
      { name: "Design for the caller", detail: "Fewer round trips (include related data or offer ?include=), cursor pagination, and idempotency keys on unsafe operations. The API exists for its users." },
    ],
    code: `// A tiny but consistent resource API — same conventions everywhere
const routes = [];

function route(method, path, handler) {
  routes.push({ method, path, handler });
}

// Resource: collections are plural nouns; methods carry intent
route("GET", "/v1/orders", listOrders);
route("GET", "/v1/orders/:id", getOrder);
route("POST", "/v1/orders", createOrder);

// One error envelope for every failure — clients handle errors once
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.body = { error: { code, message, details } };
  }
}

async function getOrder(db, id) {
  const order = await db.orders.find(id);
  if (!order) throw new ApiError(404, "order_not_found", "No order with id " + id);
  return order; // success shape: { data, error: null }
}

async function listOrders(db, { cursor, limit = 20 }) {
  const orders = await db.orders.page(cursor, Math.min(limit, 100)); // capped limit
  return { data: orders, nextCursor: orders.at(-1)?.id ?? null };
}

console.log(routes.map((r) => r.method + " " + r.path));
// GET /v1/orders, GET /v1/orders/:id, POST /v1/orders`,
    steps: ["Define resource", "Consistent naming", "Predictable behavior", "Document clearly"],
  },
  {
    id: "core-idempotency",
    cat: "core",
    title: "Idempotency",
    one: "An operation that produces the same result no matter how many times it runs.",
    why: "Networks time out after the money moved. Mobile clients retry. Queues deliver twice. Without idempotency, every retry risks a double charge, double shipment, or double email — retries become dangerous instead of safe.",
    how: "The client sends a unique key (Idempotency-Key: uuid) with the request. The server records key → response on first execution; retries with the same key return the stored response instead of re-executing. Keys are kept until they expire (24h is typical).",
    when: "Make every unsafe, retried operation idempotent: payments, order creation, webhook receivers, queue consumers. Natural idempotency helps too — PUT /orders/123 (set to this state) is inherently safer than POST /orders (creates anew) for retried writes.",
    ref: "Stripe API Documentation",
    subtopics: [
      { name: "Idempotency keys", detail: "Client generates one key per logical operation (a UUID), reused across retries. Server stores the first response and replays it for duplicates." },
      { name: "Storage & races", detail: "Keys go in a table/cache with a unique constraint. Two concurrent requests with the same key: one wins the insert, the other waits and returns the stored result." },
      { name: "Natural idempotency", detail: "set(status=paid) is idempotent; count = count + 1 is not. Model writes as absolute values or upserts wherever possible and retries become harmless." },
      { name: "Consumer deduplication", detail: "Queue consumers keep a table of processed message IDs; a duplicate delivery is detected and skipped instead of re-applied." },
    ],
    code: `const processed = new Map(); // key -> stored response (real impl: DB w/ unique index)

async function createPayment(db, idempotencyKey, { userId, amountCents }) {
  if (!idempotencyKey) throw new Error("Idempotency-Key required");

  const existing = processed.get(idempotencyKey);
  if (existing) {
    return { replayed: true, payment: existing }; // retry: return original result
  }

  const payment = await db.payments.insert({ userId, amountCents, status: "paid" });
  processed.set(idempotencyKey, payment);
  return { replayed: false, payment };
}

// First attempt
console.log(await createPayment(db, "key-abc", { userId: "u1", amountCents: 4900 }));
// -> { replayed: false, payment: {...} }

// Network dies, client retries with the SAME key
console.log(await createPayment(db, "key-abc", { userId: "u1", amountCents: 4900 }));
// -> { replayed: true, payment: {...} }  — charged once, not twice

// Webhook receivers do the same: event.id is the dedupe key`,
    steps: ["Request sent", "Retried on timeout", "Server recognizes duplicate", "Same result returned"],
  },
  {
    id: "core-loggingbasics",
    cat: "core",
    title: "Structured Logging",
    one: "Logging as machine-parsable key-value data instead of free-text strings.",
    why: "grep-through-a-million-lines is not debugging. Structured logs are queryable data: 'show me every error for user u42 on checkout in the last hour' is one filter — impossible with prose lines like 'user u42 checkout failed!!'.",
    how: "Each log entry is one JSON object with standard fields (timestamp, level, message) plus context (userId, requestId, durationMs). Correlation IDs thread every log line from one request across services, so the whole journey is retrievable.",
    when: "Log events worth paying to store: requests (method, path, status, duration), state changes, and errors with stack traces. Log at boundaries, not inside loops. Never log secrets or raw personal data — logs outlive the compliance review.",
    ref: "OpenTelemetry Documentation",
    subtopics: [
      { name: "One JSON per line", detail: "stdout carries single-line JSON — log shippers (Fluentd, Vector) parse and index it. Multi-line stack traces: put them in one field." },
      { name: "Levels with meaning", detail: "error = needs action now, warn = degraded but working, info = state changes, debug = detail for investigating. Production runs at info; debug flips on per-request." },
      { name: "Correlation IDs", detail: "Generate a requestId at the edge, attach to every log line and outgoing call. One ID retrieves the full cross-service story of a single request." },
      { name: "Redaction by default", detail: "Strip passwords, tokens, card numbers, and emails before serialization — an allowlist of loggable fields beats a blocklist you have to maintain." },
    ],
    code: `const crypto = require("crypto");

function logger(base) {
  return {
    child(extra) {
      return logger({ ...base, ...extra }); // requestId sticks to every line
    },
    log(level, message, fields = {}) {
      const entry = {
        time: new Date().toISOString(),
        level,
        msg: message,
        ...base,
        ...fields,
      };
      process.stdout.write(JSON.stringify(entry) + "\\n");
    },
    info: function (m, f) { return this.log("info", m, f); },
    error: function (m, f) { return this.log("error", m, f); },
  };
}

// Redaction: secrets never enter logs
const SECRET_FIELDS = ["password", "token", "cardNumber"];
function redact(fields) {
  const safe = { ...fields };
  for (const key of SECRET_FIELDS) if (key in safe) safe[key] = "[redacted]";
  return safe;
}

// Per-request child logger — every line carries the same requestId
async function handleRequest(req) {
  const log = logger({ service: "checkout" }).child({ requestId: crypto.randomUUID() });
  log.info("request received", redact({ path: req.url, password: req.body?.password }));
  try {
    // ... work ...
    log.info("request complete", { durationMs: 42, status: 200 });
  } catch (err) {
    log.error("request failed", { stack: err.stack });
  }
}`,
    steps: ["Event occurs", "Log as structured fields", "Ship to aggregator", "Query & filter later"],
  },
];
