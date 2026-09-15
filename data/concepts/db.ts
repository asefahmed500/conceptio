import type { Concept } from "../types";

export const DB: Concept[] = [
  {
    id: "db-indexing",
    cat: "db",
    title: "Indexing",
    one: "A sorted lookup structure so the database doesn't scan every row to find one.",
    why: "A full table scan is O(n): at 10M rows every lookup reads 10M rows. An index turns that into O(log n) tree descent — the difference between a 4ms and a 40-second query, and the single highest-leverage performance tool in databases.",
    how: "Most indexes are B-trees: keys kept sorted with branching factor in the hundreds, so finding one row among billions takes 3–4 page reads. The planner chooses the index when its column appears in WHERE/JOIN/ORDER BY; a composite index (a, b) serves queries on a, or a AND b, but not b alone.",
    when: "Index every column that appears in frequent WHERE clauses, joins, and sort keys. Don't index everything: each index slows every write (all copies must update) and eats disk. Measure with EXPLAIN — an index the planner ignores is pure overhead.",
    ref: "PostgreSQL Documentation",
    subtopics: [
      { name: "B-tree mechanics", detail: "Sorted, shallow, wide: millions of rows are 3 levels deep. Range scans (BETWEEN, LIKE 'abc%') follow the leaf chain sequentially." },
      { name: "Composite index order", detail: "Column order is a prefix rule: index (user_id, created_at) answers 'orders of user X sorted by date' perfectly but can't skip to a created_at range alone." },
      { name: "Covering indexes", detail: "Index-only scans: if the index holds every selected column (INCLUDE clause), the table is never touched — the fastest read path available." },
      { name: "Write amplification", detail: "Every INSERT/UPDATE touches the table plus each index. Ten indexes can make writes 10x slower — index reads you actually run, not reads you imagine." },
    ],
    code: `// The problem: filter + sort over millions of rows
// SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20;

// The fix: one composite index whose column order matches the query
await pool.query(
  "CREATE INDEX CONCURRENTLY idx_orders_user_created ON orders (user_id, created_at DESC)"
);

// EXPLAIN before/after is how you prove it worked
const plan = await pool.query("EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20", ["u42"]);
console.log(plan.rows.map((r) => Object.values(r)[0]).join("\\n"));
// Before: Sort  (cost=... rows=999912)  -> Seq Scan on orders   [~40s]
// After:  Index Scan using idx_orders_user_created         [~0.4ms]

// Partial index: index only the rows you ever query
await pool.query(
  "CREATE INDEX idx_orders_unshipped ON orders (created_at) WHERE status = 'pending'"
);`,
    steps: ["No index: scan all rows", "Add index", "Index: tree lookup", "Row found in log(n)"],
  },
  {
    id: "db-acid",
    cat: "db",
    title: "ACID Transactions",
    one: "A transaction is Atomic, Consistent, Isolated, and Durable — all or nothing.",
    why: "Moving money is two writes: debit A, credit B. A crash between them loses money. ACID is the database's promise that multi-step changes are indivisible, rule-abiding, non-interfering, and survive power loss — the foundation every correctness argument stands on.",
    how: "Atomicity: the write-ahead log lets the engine roll back incomplete transactions. Consistency: constraints (FK, unique, CHECK) must hold at commit. Isolation: concurrent transactions see a consistent snapshot per the isolation level. Durability: commit returns only after the WAL is fsynced to disk.",
    when: "Wrap any multi-write invariant in a transaction: ledgers, inventory decrements, user+profile creation. Keep them short — long transactions hold locks and bloat vacuum work. Some stores (DynamoDB single-item, Redis) relax parts of ACID for speed; know which promises you're living without.",
    ref: "PostgreSQL Documentation",
    subtopics: [
      { name: "Atomicity = all-or-nothing", detail: "A failed step undoes every step. No partial debits, ever — the undo log makes 'half a transaction' unrepresentable." },
      { name: "Consistency is enforced", detail: "The DB refuses commits that violate constraints. App-level invariants (balance > 0) still need CHECK constraints or SERIALIZABLE to be real." },
      { name: "Isolation is a spectrum", detail: "Default READ COMMITTED lets concurrent anomalies through; SERIALIZABLE stops them at a throughput cost. Pick per-operation, not globally." },
      { name: "Durability vs performance", detail: "synchronous_commit=off makes commits faster by risking the last few hundred ms of writes on OS crash — a trade some logs accept, no ledger should." },
    ],
    code: `// Transfer $50: two writes that must succeed together
const client = await pool.connect();
try {
  await client.query("BEGIN");

  const debited = await client.query(
    "UPDATE accounts SET balance_cents = balance_cents - 5000 WHERE id = $1 AND balance_cents >= 5000 RETURNING id",
    ["acct_a"]
  );
  if (debited.rowCount === 0) throw new Error("insufficient funds");

  await client.query(
    "UPDATE accounts SET balance_cents = balance_cents + 5000 WHERE id = $1",
    ["acct_b"]
  );

  await client.query(
    "INSERT INTO ledger (from_acct, to_acct, amount_cents) VALUES ($1, $2, 5000)",
    ["acct_a", "acct_b"]
  );

  await client.query("COMMIT");   // atomic: all three writes or none
} catch (err) {
  await client.query("ROLLBACK"); // crash, error, insufficient funds -> nothing happened
  throw err;
} finally {
  client.release();
}`,
    steps: ["Atomicity", "Consistency", "Isolation", "Durability"],
  },
  {
    id: "db-replication",
    cat: "db",
    title: "Replication",
    one: "Writes go to a primary; copies (replicas) serve reads to spread the load.",
    why: "One database node is one bottleneck and one point of failure. Replication gives you read scaling (N copies serving reads), resilience (primary dies, a replica is promoted), and a safety net (a lagging replica is a live backup).",
    how: "The primary ships its write-ahead log to replicas, which replay it continuously. Synchronous replication waits for a replica ack before committing (no data loss, more latency); async returns immediately (fast, but a replica can lag seconds behind).",
    when: "Replicate as soon as reads outgrow the primary or downtime becomes unacceptable. Async is the default for read scaling; semi-sync protects the most critical writes. Beware replication lag: a user who just wrote and immediately reads their own data from a lagging replica sees it vanish.",
    ref: "AWS RDS Documentation",
    subtopics: [
      { name: "Sync vs async", detail: "Sync: commit waits for the replica — slower commits, zero loss on primary death. Async: instant commits, possible loss of the last transactions on failover." },
      { name: "Replication lag", detail: "A replica seconds behind serves stale reads. Show users their own writes from the primary (read-your-writes) and let replicas serve everything older." },
      { name: "Failover isn't instant", detail: "Promotion takes detection + election + DNS/DNS-cache cutover — 10s to minutes. Health checks and a practiced runbook matter more than the config." },
      { name: "Physical vs logical", detail: "Physical (WAL byte-level) replicas are exact copies, same version; logical replication streams row changes — enabling upgrades and cross-version copies." },
    ],
    code: `const primary = new Pool({ connectionString: process.env.PRIMARY_URL });
const replica = new Pool({ connectionString: process.env.REPLICA_URL });

// Writes always hit the primary
async function placeOrder(userId, cart) {
  const client = await primary.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "INSERT INTO orders (user_id, total_cents) VALUES ($1, $2) RETURNING *",
      [userId, cart.totalCents]
    );
    await client.query("COMMIT");
    return rows[0];
  } finally {
    client.release();
  }
}

// Reads hit replicas — with read-your-writes protection
async function listOrders(userId, { writtenAfter = null } = {}) {
  if (writtenAfter && Date.now() - writtenAfter < 5000) {
    return primary.query("SELECT * FROM orders WHERE user_id = $1", [userId]); // fresh write? primary
  }
  return replica.query("SELECT * FROM orders WHERE user_id = $1", [userId]);    // stale-tolerant
}`,
    steps: ["Write → Primary", "Replicate to copies", "Replica A", "Replica B", "Reads served from replicas"],
  },
  {
    id: "db-sharding",
    cat: "db",
    title: "Sharding",
    one: "Splitting one huge table across many databases, each holding a slice of the rows.",
    why: "Vertical scaling hits a wall: one machine's CPU, RAM, and IOPS cap out, and replication can't fix write throughput. Sharding spreads both data and load across commodity nodes — the only answer at true planetary scale.",
    how: "Pick a shard key (user_id, tenant_id); a router hashes or range-maps it to a node, and each node owns a disjoint slice. Queries including the key hit one shard; queries without it fan out to all and merge — expensive, so design access patterns around the key first.",
    when: "Shard when you genuinely must — write volume or dataset size outgrows the biggest node, usually billions of rows or TB-scale hot data. It forfeits cross-shard transactions, joins, and global uniqueness; every other option (indexes, partitions, read replicas, caching) is cheaper. If you can shard by tenant, do it — tenant boundaries absorb most of the pain.",
    ref: "MongoDB Documentation",
    subtopics: [
      { name: "Choosing the shard key", detail: "High cardinality, even distribution, present in most queries. A low-cardinality key (country) creates hot shards; a random key destroys locality." },
      { name: "Hash vs range", detail: "Hash keys distribute perfectly but kill range scans; range keys keep ranges local but create hotspots on monotonic keys (timestamps)." },
      { name: "Cross-shard queries", detail: "No shard key = scatter-gather to every node, plus merge logic. Cross-shard transactions become 2PC or sagas — the real price of sharding." },
      { name: "Resharding pain", detail: "Changing the key or adding nodes means moving data live. Plan double-writes and backfills up front; hot-shard splits are scheduled maintenance, not surprises." },
    ],
    code: `// Tenanted app: tenant_id is the natural shard key
const { createHash } = require("crypto");
const SHARDS = [
  { id: 0, conn: "postgres://shard0.internal/app" },
  { id: 1, conn: "postgres://shard1.internal/app" },
  { id: 2, conn: "postgres://shard2.internal/app" },
  { id: 3, conn: "postgres://shard3.internal/app" },
];

function shardFor(tenantId) {
  const h = createHash("md5").update(tenantId).digest();
  return SHARDS[h.readUInt32BE(0) % SHARDS.length];
}

const pools = new Map(SHARDS.map((s) => [s.id, new Pool({ connectionString: s.conn })]));

// Keyed operations land on exactly one shard — fast, transactional
async function createOrder(tenantId, order) {
  const pool = pools.get(shardFor(tenantId).id);
  return pool.query(
    "INSERT INTO orders (tenant_id, user_id, total_cents) VALUES ($1, $2, $3) RETURNING *",
    [tenantId, order.userId, order.totalCents]
  );
}

// No key? Scatter-gather: every shard, merged — the expensive path
async function globalSearch(term) {
  const results = await Promise.all(
    [...pools.values()].map((p) => p.query("SELECT * FROM orders WHERE note ILIKE $1", ["%" + term + "%"]))
  );
  return results.flatMap((r) => r.rows);
}`,
    steps: ["Shard key routes request", "Shard 1 (A–H)", "Shard 2 (I–P)", "Shard 3 (Q–Z)"],
  },
  {
    id: "db-normalization",
    cat: "db",
    title: "Normalization",
    one: "Structuring tables to reduce data duplication and update anomalies.",
    why: "One customer's address copied into a million order rows means a million chances to be inconsistent — change the address and you must find every copy. Normalization stores each fact exactly once, so updates are single-point and truth can't drift.",
    how: "Split entities into their own tables (customers, orders, products), give each a key, and reference others by foreign keys. Each table describes one thing; repeating groups move to child tables. The result: no fact stored twice, enforced by FK constraints.",
    when: "Normalize by default for OLTP — transactional systems live and die by write consistency. Denormalize selectively later, driven by measured read slowness, not by vibes. Analytics/reporting copies live in the warehouse, denormalized on purpose.",
    ref: "PostgreSQL Documentation",
    subtopics: [
      { name: "Update anomalies", detail: "Duplication creates three failure modes: update one copy and forget others, delete a row and lose unrelated facts, or fail to insert because no parent exists yet." },
      { name: "Foreign keys enforce truth", detail: "A FK makes orphan rows impossible — the database rejects bad references instead of trusting every caller to be careful." },
      { name: "Third normal form in practice", detail: "Every non-key column depends on the key, the whole key, and nothing but the key. If a column repeats per group or depends on another non-key column, split it out." },
      { name: "Joins are the cost", detail: "Normalized reads need joins. Indexed joins on keyed columns are fast — 'joins are slow' usually means missing indexes or a genuinely denormalization-worthy hot path." },
    ],
    code: `// DENORMALIZED: one table, duplicated facts
// orders: id | customer_name | customer_email | product_name | price_cents
// (change ada@example.com -> 10,000 order rows to update)

// NORMALIZED: each fact lives once
await pool.query(\`
  CREATE TABLE customers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    email citext UNIQUE NOT NULL
  );
  CREATE TABLE products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    price_cents int NOT NULL
  );
  CREATE TABLE orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL REFERENCES customers(id),
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE order_items (
    order_id uuid REFERENCES orders(id),
    product_id uuid REFERENCES products(id),
    qty int NOT NULL CHECK (qty > 0),
    PRIMARY KEY (order_id, product_id)
  );
\`);

// One email update — one row
await pool.query("UPDATE customers SET email = $1 WHERE id = $2", ["new@example.com", customerId]);

// Reads reassemble via joins
const { rows } = await pool.query(\`
  SELECT o.id, c.name, p.name AS product, oi.qty
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  JOIN order_items oi ON oi.order_id = o.id
  JOIN products p ON p.id = oi.product_id
  WHERE o.id = $1
\`, [orderId]);`,
    steps: ["Raw duplicated data", "Split into related tables", "Link via foreign keys", "No duplication remains"],
  },
  {
    id: "db-denormalization",
    cat: "db",
    title: "Denormalization",
    one: "Deliberately duplicating data to speed up reads at the cost of write complexity.",
    why: "Sometimes the read you run a million times a day shouldn't join five tables. Denormalization pre-computes and stores the answer — a counter, a cached name, a rolled-up total — trading write-time consistency work for read-time speed.",
    how: "Copy or aggregate data into the shape the read wants: store author_name on each post, keep likes_count on the post instead of COUNT(*) per view, or maintain a summary table updated by triggers or the application. Every write must now maintain the duplicate — via the same transaction, triggers, or an async rebuild.",
    when: "Denormalize measured hot paths: counts shown on every page, names needed in every list, reports re-aggregated constantly. Every duplicate needs a documented update path — an unowned duplicate is a future bug report, not an optimization.",
    ref: "PostgreSQL Documentation",
    subtopics: [
      { name: "Derived columns", detail: "posts.likes_count incremented in the same transaction as each like — one write becomes two, one COUNT query becomes a column read." },
      { name: "Summary tables", detail: "daily_revenue rolled up by a scheduled job: reads become single-row lookups; the pipeline, not the request path, pays the aggregation cost." },
      { name: "Materialized views", detail: "The database-native version: a query stored as a table, refreshed on demand (REFRESH MATERIALIZED VIEW). Stale until refreshed — know your freshness budget." },
      { name: "Consistency debt", detail: "Every duplicate can drift. Write the sync mechanism AND the repair job (nightly recount) at the same time as the duplicate itself." },
    ],
    code: `// Hot read: every post list needs author name + like count
// Normalized: JOIN posts->users + COUNT(likes) per post on EVERY page view

// Denormalized copies, maintained on write
await pool.query(\`
  ALTER TABLE posts
    ADD COLUMN author_name text,
    ADD COLUMN likes_count int NOT NULL DEFAULT 0;
\`);

// Write path keeps the copies honest — same transaction, always
async function likePost(postId, userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      "INSERT INTO likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1",
      [postId, userId]
    );
    if (inserted.rowCount) {
      await client.query("UPDATE posts SET likes_count = likes_count + 1 WHERE id = $1", [postId]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// The read that justified everything: no joins, no aggregation
const { rows } = await pool.query(
  "SELECT id, title, author_name, likes_count FROM posts WHERE feed = 'global' LIMIT 50"
);

// Repair job drifts can't hide from: nightly truth check
// UPDATE posts p SET likes_count = (SELECT count(*) FROM likes l WHERE l.post_id = p.id);`,
    steps: ["Normalized tables", "Duplicate for read speed", "Faster query", "More write coordination needed"],
  },
  {
    id: "db-joins",
    cat: "db",
    title: "SQL Joins",
    one: "Combining rows from two or more tables based on a related column.",
    why: "Normalized data lives in pieces — joins are how you reassemble it into answers. Whether a report takes 40ms or 40s usually comes down to join conditions and whether the joined columns are indexed.",
    how: "INNER JOIN keeps only matching pairs; LEFT JOIN keeps all left rows with NULLs where the right side is missing — the workhorse for 'rows and their optional relations'. The planner picks nested loop (small outer, indexed inner), hash join (big unsorted sets), or merge join (both sorted) based on statistics.",
    when: "Join on indexed keys and keep join chains short. Watch for LEFT JOIN + WHERE-on-right-column (silently becomes INNER) and accidental row multiplication from one-to-many joins (a SUM that counts everything 3x). ANTI-join (LEFT JOIN ... WHERE right IS NULL) is the idiomatic 'find rows without matches'.",
    ref: "PostgreSQL Documentation",
    subtopics: [
      { name: "INNER vs LEFT", detail: "INNER: only pairs that match. LEFT: every left row survives, unmatched right columns become NULL. Pick by whether missing relations should hide rows." },
      { name: "Join algorithms", detail: "Nested loop: for each outer row, probe an indexed inner — great when outer is small. Hash: build a hash of one side, probe with the other — great for large unsorted inputs." },
      { name: "Fan-out danger", detail: "Joining orders->items->shipments multiplies rows per order. Aggregate in a subquery (or DISTINCT ON) before the outer aggregation or your totals are wrong." },
      { name: "Index the join keys", detail: "foreign keys rarely get automatic indexes (Postgres doesn't). Every FK you join on needs one, or each probe becomes a scan." },
    ],
    code: `// "Every customer, their order count, and total spent — including zeros"
await pool.query(\`
SELECT
  c.id,
  c.name,
  COUNT(o.id)              AS order_count,
  COALESCE(SUM(o.total_cents), 0) AS spent_cents
FROM customers c
LEFT JOIN orders o
  ON o.customer_id = c.id          -- FK join: index orders(customer_id) or this crawls
  AND o.status = 'paid'            -- filter the RIGHT side in ON, not WHERE
GROUP BY c.id, c.name;
\`);

// Customers who NEVER ordered — the anti-join
await pool.query(\`
SELECT c.id, c.name
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.id IS NULL;
\`);

// Fan-out fix: aggregate the many-side BEFORE joining
await pool.query(\`
WITH items_per_order AS (
  SELECT order_id, SUM(qty * price_cents) AS items_total
  FROM order_items
  GROUP BY order_id
)
SELECT o.id, o.total_cents, i.items_total
FROM orders o
JOIN items_per_order i ON i.order_id = o.id
WHERE o.created_at > now() - interval '7 days';
\`);

// EXPLAIN ANALYZE the slow one before rewriting it — measure, then tune.`,
    steps: ["Table A", "Match on key", "Table B", "Combined result set"],
  },
  {
    id: "db-nosql",
    cat: "db",
    title: "NoSQL Types",
    one: "Document, key-value, column-family, and graph stores each fit different access patterns.",
    why: "Relational databases optimize for flexible queries over structured tables — not every workload wants that. NoSQL families each trade query flexibility for a specific superpower: microsecond lookups, massive write throughput, schema-free documents, or relationship traversal.",
    how: "Key-value stores (Redis, DynamoDB) hash a key to one machine — the fastest possible get/put. Document stores (MongoDB) store JSON-ish trees and index into them. Column-family (Cassandra, Bigtable) write-optimized wide rows for time series and analytics. Graph (Neo4j) stores edges as first-class data for hop-by-hop traversal.",
    when: "Match the store to the access pattern: session/cache lookups → key-value; flexible nested content (product catalogs, CMS) → document; write-heavy telemetry → column-family; social graphs, recommendations, fraud rings → graph. Multi-model needs, complex ad-hoc queries, and strong multi-row transactions still belong in Postgres.",
    ref: "MongoDB Documentation",
    subtopics: [
      { name: "Key-value", detail: "O(1) get/set by key, nothing else. No secondary queries — if you can't name the key, you can't find the data. Perfect for sessions, feature flags, counters." },
      { name: "Document", detail: "Aggregate in one place: a product with variants and specs is one read. Rule of thumb: model documents around what's read together, and expect to embed what you'd otherwise join." },
      { name: "Column-family", detail: "Writes append and reads scan row ranges across many nodes — built for ingest-heavy time series and analytics where queries are known up front." },
      { name: "Graph", detail: "A 4-hop friend-of-friend query is one local traversal instead of four recursive JOINs. Depth-first relationship questions are where graphs justify themselves." },
    ],
    code: `// The same problem in two models: product catalog
// Document (Mongo): the product IS the aggregate — one read per page
const products = db.collection("products");
await products.insertOne({
  _id: "sku-123",
  name: "Trail Shoe",
  variants: [
    { size: 42, color: "red", stock: 12 },
    { size: 43, color: "red", stock: 3 },
  ],
  specs: { weight_g: 290, drop_mm: 8 },
});
const shoe = await products.findOne({ _id: "sku-123" }); // variants included — no join

// Key-value (Redis): session lookup — the canonical use case
await redis.set("sess:abc123", JSON.stringify({ userId: "u1", exp: Date.now() + 3600000 }), { EX: 3600 });
const sess = JSON.parse(await redis.get("sess:abc123"));

// Graph (Cypher): friends-of-friends who liked 'climbing' — 3 hops, one query
// MATCH (me:User {id:'u1'})-[:FRIEND*2]->(fof:User)-[:LIKED]->(p:Post {tag:'climbing'})
// RETURN DISTINCT fof.name, p.title LIMIT 10

// Rule: name your top 3 queries FIRST, then pick the store that does them natively.`,
    steps: ["Pick access pattern", "Document (nested JSON)", "Key-value (fast lookup)", "Graph (relationships)"],
  },
  {
    id: "db-pooling",
    cat: "db",
    title: "Connection Pooling",
    one: "Reusing a fixed set of database connections instead of opening one per request.",
    why: "A Postgres connection is a process on the server — ~5–10MB and real setup cost. 100 concurrent requests each opening a connection means 100 processes and a melting database. A pool turns connection setup into a one-time cost and caps concurrency at a number the DB can survive.",
    how: "The pool keeps N connections open; a request borrows one, runs its queries, and returns it. If none are free, requests queue (with a timeout) instead of opening more. Sizing starts around (cores × 2–4) — more is usually WORSE: context-switching overhead grows while throughput drops.",
    when: "Pool in every process that touches the DB — and multiply by process count: 8 app servers × 20 connections = 160, often past Postgres's max_connections. Front the fleet with PgBouncer when the math stops working. Always release connections back (finally block) or the pool drains and everything times out.",
    ref: "node-postgres Documentation",
    subtopics: [
      { name: "Pool sizing", detail: "Start cores×2–4 per process. Beyond the sweet spot, throughput DROPS as connections fight over CPU and locks. Measure at peak, adjust, repeat." },
      { name: "Borrow-return discipline", detail: "client.release() in a finally — one leak path (early return, throw) and the pool starves into 5s acquisition timeouts under load." },
      { name: "Transaction pinning", detail: "BEGIN checks out one client until COMMIT. Wrap transactions tightly; awaiting external APIs inside one pins a connection for seconds." },
      { name: "PgBouncer & serverless", detail: "Serverless functions scale to thousands of instances — direct pools explode. PgBouncer (transaction mode) multiplexes thousands of clients over a few dozen real connections." },
    ],
    code: `const { Pool } = require("pg");

// One pool per process, created at startup — NOT per request
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,                 // ceiling per process; 10 servers = 100 total. Count yours.
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000, // fail fast when the pool is exhausted
});

// Pool.query borrows + returns automatically — use this 90% of the time
const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);

// Transactions need one client held across queries — release it in finally
async function transfer(fromId, toId, cents) {
  const client = await pool.connect(); // borrow
  try {
    await client.query("BEGIN");
    await client.query("UPDATE accounts SET balance = balance - $1 WHERE id = $2", [cents, fromId]);
    await client.query("UPDATE accounts SET balance = balance + $1 WHERE id = $2", [cents, toId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release(); // THE line that prevents pool exhaustion
  }
}

// Watch it at runtime
pool.on("error", (err) => console.error("idle client error", err));`,
    steps: ["Request needs DB", "Borrow from pool", "Query runs", "Connection returned to pool"],
  },
  {
    id: "db-queryopt",
    cat: "db",
    title: "Query Optimization",
    one: "Rewriting or indexing a query so the engine finds a faster execution plan.",
    why: "The database can answer a question in many ways — seq scan, index scan, join orders — with 1000x cost differences. Optimization is reading its plan, finding where it chose badly, and giving it what it needs to choose right: indexes, statistics, or a better-written query.",
    how: "Run EXPLAIN ANALYZE: it shows the actual plan and where the time went. Look for seq scans on big tables, rows estimates wildly off actuals (stale statistics), and sorts/spills to disk. Then: add the matching index, rewrite the anti-pattern (functions on indexed columns, leading wildcards, SELECT *), or restructure.",
    when: "Optimize the queries that dominate your DB time (pg_stat_statements ranks them by total time) — not the ones that look ugly. Re-check after data growth: a plan fine at 10K rows dies at 10M. N+1 query patterns live in the app layer; fix them with joins or batched loading.",
    ref: "PostgreSQL Documentation",
    subtopics: [
      { name: "Reading EXPLAIN", detail: "cost = planner's guess, actual = truth, loops multiply everything. Start at the biggest actual-time node and ask what it's scanning and why." },
      { name: "Index-killing patterns", detail: "WHERE lower(email) = ... , WHERE date(created_at) = ..., LIKE '%abc' — all functions/wildcards that can't use a plain index. Fix: functional index, range predicates, or prefix search." },
      { name: "Stale statistics", detail: "The planner guesses row counts from stats gathered by ANALYZE. After big loads or on skewed data, wrong estimates cascade into wrong join algorithms. ANALYZE explicitly." },
      { name: "The N+1 pattern", detail: "50 posts × 1 author query each = 51 round trips. Fix in the app: single JOIN or WHERE id = ANY($1) batch. Often a 50x latency fix with zero schema changes." },
    ],
    code: `// SLOW: function on the indexed column + leading wildcard
// SELECT * FROM users WHERE lower(email) = 'ada@example.com';
// SELECT * FROM products WHERE name ILIKE '%shoe%';

// Fix 1: expression index that matches the expression exactly
await pool.query("CREATE INDEX idx_users_email_lower ON users (lower(email))");

// Fix 2: trigram index for contains-search
await pool.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
await pool.query("CREATE INDEX idx_products_name_trgm ON products USING gin (name gin_trgm_ops)");

// Fix 3: replace date(created_at) = today with a range the index can use
await pool.query(
  "SELECT * FROM events WHERE created_at >= $1 AND created_at < $2",
  ["2026-09-13", "2026-09-14"]
);

// Measure: top offenders by total time
const worst = await pool.query(\`
  SELECT query, calls, mean_exec_time, total_exec_time
  FROM pg_stat_statements
  ORDER BY total_exec_time DESC
  LIMIT 5
\`);

// Prove the win
const plan = await pool.query("EXPLAIN ANALYZE SELECT * FROM users WHERE lower(email) = $1", ["ada@example.com"]);
console.log(plan.rows.at(-1)); // Execution Time: 0.081 ms (was 420 ms)`,
    steps: ["Slow query", "Run EXPLAIN plan", "Add index or rewrite", "Faster execution plan"],
  },
  {
    id: "db-orm",
    cat: "db",
    title: "ORMs",
    one: "A layer that maps database rows to application objects, so you query in code.",
    why: "Hand-writing SQL + row mapping for every CRUD path is boilerplate that attracts typos and injection bugs. An ORM gives typed models, migrations, and relationships in one place — teams move faster and the obvious paths are safe by default.",
    how: "You declare models (User has many Orders); the ORM generates queries, hydrates nested objects, tracks changes, and wraps transactions. Complex queries drop down to raw SQL when needed. Type safety flows from the schema to query results (Prisma) or vice versa.",
    when: "Use one for app-style CRUD with standard relations — the 90% case. Know the leaks: lazy-loading causes N+1 (use eager includes), bulk operations are slow through the ORM (use raw SQL), and reporting queries belong in SQL. The ORM is a convenience layer, not a wall between you and the database.",
    ref: "Prisma Documentation",
    subtopics: [
      { name: "Models & relations", detail: "Declare once (schema.prisma / entities), get migrations, typed clients, and relation loading everywhere. The schema file becomes the team's shared source of truth." },
      { name: "The N+1 leak", detail: "orders.map(o => o.customer.name) fires one query per order with lazy loading. Eager loading (include: { customer: true }) batches it into one or two." },
      { name: "Escape hatches", detail: "Every serious ORM exposes raw SQL (prisma.$queryRaw, sequelize.literal). Report queries, CTEs, and exotic features should use it without guilt." },
      { name: "Migrations as a byproduct", detail: "The diff between model and DB becomes a reviewable migration file — schema evolution gets version-controlled with the code that needs it." },
    ],
    code: `// schema.prisma — declare once, gain types + migrations + client
// model User {
//   id     String  @id @default(uuid())
//   name   String
//   orders Order[]
// }
// model Order {
//   id        String   @id @default(uuid())
//   totalCents Int
//   user      User     @relation(fields: [userId], references: [id])
//   userId    String
//   createdAt DateTime @default(now())
// }

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Create with relations — no manual FK bookkeeping
const user = await prisma.user.create({
  data: { name: "Ada", orders: { create: [{ totalCents: 4900 }] } },
});

// EAGER loading: one query, no N+1
const usersWithOrders = await prisma.user.findMany({
  include: { orders: true }, // joins orders in the same round trip
  where: { orders: { some: { totalCents: { gt: 1000 } } } },
});

// Typed results: user.orders[0].totalCents is Int, not any

// Escape hatch: real SQL when the ORM isn't the right tool
const revenue = await prisma.$queryRaw\`
  SELECT date_trunc('day', created_at) AS day, sum(total_cents) AS cents
  FROM orders WHERE created_at > now() - interval '30 days'
  GROUP BY 1 ORDER BY 1
\`;`,
    steps: ["Define model", "Call ORM method", "SQL generated", "Rows mapped to objects"],
  },
  {
    id: "db-migrations",
    cat: "db",
    title: "Migrations",
    one: "Version-controlled, incremental changes to a database schema.",
    why: "'Update the schema by hand on prod' is how staging and production drift apart until something breaks inexplicably. Migrations make schema changes code: reviewed, ordered, repeatable, and identical on every environment.",
    how: "Each migration is a numbered/timestamped file with up (apply) and down (revert) steps. The tool tracks which files ran where and applies pending ones in order. Additive changes deploy cleanly; breaking changes need expand/contract: add new shape, dual-write, migrate data, then remove the old shape.",
    when: "Every schema change ships as a migration — no exceptions, including 'quick fixes'. On zero-downtime systems, keep each migration backward-compatible with the code currently running: add columns (nullable/defaulted), never rename or drop in the same release that stops using them.",
    ref: "Prisma Documentation",
    subtopics: [
      { name: "Forward-only mindset", detail: "Down migrations rarely get tested and prod data is precious — plan to fix forward with a new migration rather than trusting 'down' in anger." },
      { name: "Expand/contract", detail: "Release 1: add email_normalized. Release 2: backfill + dual-write. Release 3: switch reads. Release 4: drop old column. Zero downtime, always revertible." },
      { name: "Long-running backfills", detail: "UPDATE on 50M rows locks and bloats. Backfill in batches (by id range) from a script, outside the migration runner, with sleep between chunks." },
      { name: "Ordering & drift", detail: "Two branches both add migration 5 — the runner detects the collision. Timestamps over sequence numbers, and CI applies migrations to a scratch DB to catch conflicts." },
    ],
    code: `// migrations/20260913120000_add_orders_status.sql
const migration = \`
-- +migrate Up
ALTER TABLE orders ADD COLUMN status text NOT NULL DEFAULT 'pending';
CREATE INDEX idx_orders_status ON orders (status) WHERE status = 'pending';

-- +migrate Down
DROP INDEX idx_orders_status;
ALTER TABLE orders DROP COLUMN status;
\`;

// Runner applies pending migrations in order, records them, refuses gaps
// $ migrate up           (or: prisma migrate deploy / knex migrate:latest)

// Zero-downtime backfill: batches outside the transaction
async function backfill(batchSize = 5000) {
  let lastId = 0;
  for (;;) {
    const { rowCount } = await pool.query(
      "UPDATE orders SET status = 'paid' WHERE id > $1 AND id <= $2 AND paid_at IS NOT NULL",
      [lastId, lastId + batchSize]
    );
    if (rowCount === 0) break;
    lastId += batchSize;
    await new Promise((r) => setTimeout(r, 100)); // let replication & vacuum breathe
  }
}`,
    steps: ["Write migration file", "Apply to schema", "Schema updated", "History tracked"],
  },
  {
    id: "db-isolation",
    cat: "db",
    title: "Transaction Isolation Levels",
    one: "How much one transaction can see of another's uncommitted changes.",
    why: "Two cashiers selling the last ticket, two workers granting the same coupon — isolation is what stands between concurrent transactions and lost updates. The level you pick decides which anomalies are possible, and they're cheaper to prevent than to debug.",
    how: "Read Uncommitted sees dirty data (nobody uses it). Read Committed (Postgres default) never sees uncommitted writes but allows nonrepeatable reads within one transaction. Repeatable Read snapshots the transaction's reads; Serializable behaves as if transactions ran one at a time — rejecting conflicts at commit.",
    when: "Default is fine for most CRUD. Reach for Repeatable Read when one transaction must see a consistent world across multiple reads (reports, validation-then-write). Use Serializable for invariants like 'at most N' or balance checks — and handle the serialization failures it throws with retries.",
    ref: "PostgreSQL Documentation",
    subtopics: [
      { name: "The anomaly zoo", detail: "Dirty read (see uncommitted), nonrepeatable read (same query, different answers), phantom (new rows appear mid-transaction), lost update (both write, one vanishes)." },
      { name: "Snapshots via MVCC", detail: "Postgres keeps old row versions so readers never block writers. Repeatable Read just pins the snapshot your transaction started with." },
      { name: "Serializable retries", detail: "Serializable can ABORT on conflict — the app must retry (catch 40001, loop). It converts 'silent corruption' into 'occasional retry', a good trade." },
      { name: "Cheaper: explicit locking", detail: "SELECT ... FOR UPDATE on the specific rows often beats escalating the whole transaction to Serializable — lock narrowly, not globally." },
    ],
    code: `// The classic lost update at READ COMMITTED:
// T1: read stock=1 | T2: read stock=1 | T1: write 0 | T2: write 0 -> sold twice

// Fix A: Serializable + retry loop
async function buyTicketSerializable(eventId, buyer) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const { rows } = await client.query("SELECT stock FROM events WHERE id = $1", [eventId]);
      if (rows[0].stock < 1) throw new Error("sold out");

      await client.query("UPDATE events SET stock = stock - 1 WHERE id = $1", [eventId]);
      const order = await client.query("INSERT INTO orders (event_id, buyer) VALUES ($1, $2) RETURNING *", [eventId, buyer]);
      await client.query("COMMIT");
      return order.rows[0];
    } catch (err) {
      await client.query("ROLLBACK");
      if (err.code === "40001" && attempt < 3) continue; // serialization failure: retry
      throw err;
    } finally {
      client.release();
    }
  }
}

// Fix B: narrow lock — serialize just this row, keep default isolation
// SELECT stock FROM events WHERE id = $1 FOR UPDATE;  -- others wait here
// ...check + update... COMMIT`,
    steps: ["Read Uncommitted", "Read Committed", "Repeatable Read", "Serializable"],
  },
  {
    id: "db-eventualconsistency",
    cat: "db",
    title: "Eventual Consistency",
    one: "Replicas may briefly disagree, but converge to the same value over time.",
    why: "Waiting for every replica to confirm every write costs latency and availability. Eventual consistency trades that wait for speed: writes acknowledge locally and propagate in the background — the price is a window where replicas disagree.",
    how: "A write lands on one node, is stamped with a timestamp/version, and flows to peers asynchronously. Reads may hit stale data until propagation completes. Convergence is guaranteed by last-write-wins timestamps, version vectors, or anti-entropy gossip that reconciles differences.",
    when: "Accept it where brief staleness is harmless: view counts, feeds, caches, product recommendations. Never for account balances, inventory you can't oversell, or anything where a user's next action depends on their previous write — or use read-your-writes routing for those paths.",
    ref: "DynamoDB Documentation",
    subtopics: [
      { name: "The staleness window", detail: "Typically milliseconds, but under load or partitions it can stretch to seconds or minutes. Design for 'how stale can it get', not 'will it be stale'." },
      { name: "Read-your-writes", detail: "Session affinity to the node that took the write (or version-checked reads) hides eventual consistency from the user who just acted — the standard UX patch." },
      { name: "Conflict resolution", detail: "Concurrent writes to one key are resolved by LWW timestamps (last write silently wins), version vectors (detect real conflicts), or CRDTs (merge mathematically). Know which one your store picked." },
      { name: "CAP in practice", detail: "During a network partition you choose: refuse writes (CP) or accept divergence (AP). Eventual consistency is the AP choice — available now, consistent later." },
    ],
    code: `// A replicated counter with async propagation — the canonical AP pattern
const replicas = new Map([
  ["eu", { value: 100, clock: 1 }],
  ["us", { value: 100, clock: 1 }],
]);

// Write acknowledges LOCALLY — instantly
function write(region, delta) {
  const r = replicas.get(region);
  r.value += delta;
  r.clock += 1;
  setImmediate(() => propagate(region)); // background convergence
  return r.value; // eu returns 105 while us still shows 100
}

// Anti-entropy: regions exchange state, highest clock wins (LWW)
function propagate(from) {
  for (const [name, other] of replicas) {
    if (name === from) continue;
    const source = replicas.get(from);
    if (source.clock > other.clock) {
      other.value = source.value;
      other.clock = source.clock;
      console.log(name, "converged to", other.value);
    }
  }
}

write("eu", 5);                       // fast local ack
console.log(replicas.get("us").value); // 100 — stale for a moment
setTimeout(() => {
  console.log(replicas.get("us").value); // 105 — eventually consistent
}, 50);`,
    steps: ["Write to one replica", "Propagate to others", "Brief disagreement window", "All replicas converge"],
  },
  {
    id: "db-locking",
    cat: "db",
    title: "Optimistic vs Pessimistic Locking",
    one: "Assume no conflict and check later, versus locking the row up front.",
    why: "Two users edit the same wiki page — whose save wins, and does the first one even know they lost? Locking strategies decide how concurrent writers coordinate: detect conflicts after the fact, or block them before they happen.",
    how: "Optimistic: read includes a version number; the UPDATE is WHERE version = seen_version — zero rows affected means someone changed it, so retry or merge. Pessimistic: SELECT ... FOR UPDATE locks the row; other writers block on their read until the first transaction commits.",
    when: "Optimistic for low-contention data (user profiles, CMS content, config) — no lock overhead, conflicts are rare and retryable. Pessimistic for hot rows where retries would thrash (ticket inventory, wallet balances, sequence assignment) — short transactions, locked briefly.",
    ref: "PostgreSQL Documentation",
    subtopics: [
      { name: "Version column", detail: "An integer or timestamp bumped on every write. The conditional UPDATE is atomic — the database arbitrates without any explicit locks." },
      { name: "FOR UPDATE semantics", detail: "Row-level exclusive lock held until commit. Others reading without FOR UPDATE proceed; other writers wait. Deadlock risk grows with multiple locked rows in different orders." },
      { name: "Conflict UX", detail: "Optimistic failures are user-facing: 'someone edited this, refresh and merge'. Design the retry/merge flow, not just the 409 response." },
      { name: "Skip locked queues", detail: "FOR UPDATE SKIP LOCKED is how Postgres job queues work: each worker locks different pending rows and never blocks another worker." },
    ],
    code: `// OPTIMISTIC: version check — no locks, retry on conflict
async function updateProfileOptimistic(userId, changes, seenVersion) {
  const { rowCount } = await pool.query(
    \`UPDATE profiles
       SET bio = $1, avatar = $2, version = version + 1
     WHERE id = $3 AND version = $4\`,
    [changes.bio, changes.avatar, userId, seenVersion]
  );
  if (rowCount === 0) {
    throw Object.assign(new Error("concurrent edit"), { code: "conflict" }); // caller retries/merges
  }
}

// PESSIMISTIC: lock the row, then decide — others wait at the SELECT
async function buyLastTicket(eventId, buyer) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // every concurrent buyer serializes HERE, on this one row
    const { rows } = await client.query(
      "SELECT stock FROM events WHERE id = $1 FOR UPDATE",
      [eventId]
    );
    if (rows[0].stock < 1) throw new Error("sold out");
    await client.query("UPDATE events SET stock = stock - 1 WHERE id = $1", [eventId]);
    await client.query("INSERT INTO orders (event_id, buyer) VALUES ($1, $2)", [eventId, buyer]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}`,
    steps: ["Optimistic: read, edit, check version", "Conflict? retry", "Pessimistic: lock row first", "Others wait"],
  },
  {
    id: "db-views",
    cat: "db",
    title: "Database Views",
    one: "A saved query that behaves like a virtual, always-current table.",
    why: "The same five-table join pasted into six endpoints drifts six ways. A view names the query once: business logic (active users, open orders) gets a stable definition, and security teams can grant access to the view without exposing base tables.",
    how: "CREATE VIEW stores the query text; every SELECT against the view re-executes it against live data — nothing is materialized. Materialized views are the hybrid: results cached to disk for speed, refreshed (REFRESH MATERIALIZED VIEW) when you decide.",
    when: "Use views to centralize shared business definitions and to give BI tools/analysts read access to exactly one shape. Use materialized views for expensive aggregations read often and tolerated slightly stale. Don't stack views on views on views — each layer re-compiles into the final query.",
    ref: "PostgreSQL Documentation",
    subtopics: [
      { name: "Views are macros", detail: "The planner inlines the view's query — no extra indirection at runtime. Zero cost, pure encapsulation." },
      { name: "Materialized views", detail: "Physically stored, refreshed on command (or CONCURRENTLY without blocking reads). The cache-invalidation question moves into your schema." },
      { name: "Security barrier", detail: "Grant SELECT on active_orders_v instead of the orders table — users physically cannot read cancelled orders. With security_barrier, row filters can't be optimized away." },
      { name: "Updatable views", detail: "Simple single-table views accept INSERT/UPDATE (rules auto-map columns); complex views need INSTEAD OF triggers. Most teams write to tables and read through views." },
    ],
    code: `// Business definition, written once
await pool.query(\`
  CREATE VIEW active_subscriptions AS
  SELECT s.id, s.user_id, s.plan, s.renews_at
  FROM subscriptions s
  WHERE s.status = 'active'
    AND s.renews_at > now()
\`);

// Every consumer speaks the same language
const { rows } = await pool.query(
  "SELECT * FROM active_subscriptions WHERE plan = $1", ["pro"]
);

// Security: analysts get exactly this shape and nothing else
await pool.query("GRANT SELECT ON active_subscriptions TO analyst_role");

// Expensive daily aggregation? Materialize it
await pool.query(\`
  CREATE MATERIALIZED VIEW daily_revenue AS
  SELECT date_trunc('day', created_at) AS day, SUM(total_cents) AS cents
  FROM orders WHERE status = 'paid'
  GROUP BY 1
  WITH DATA;
\`);
await pool.query("CREATE UNIQUE INDEX ON daily_revenue (day)");

// Refresh off-peak without blocking readers
await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY daily_revenue");`,
    steps: ["Define query", "Save as view", "Query view like a table", "Underlying data stays live"],
  },
  {
    id: "db-storedproc",
    cat: "db",
    title: "Stored Procedures",
    one: "Precompiled logic that runs inside the database itself.",
    why: "Some logic belongs next to the data: batch moves over millions of rows, or a money transfer where the round trip alone dwarfs the work. Stored procedures run where the data lives — no network hops per statement, one call instead of fifty.",
    how: "You write the procedure in a database language (PL/pgSQL, T-SQL), the engine parses and caches a plan, and clients invoke it by name with arguments. It executes with full transactional control — commits, error handling, cursors — inside the server.",
    when: "Use for data-intensive batch work, atomic multi-step operations where network latency dominates, and logic shared by many applications. Avoid putting business rules there your application team can't test, version, or debug comfortably — logic in the DB deploys on DB time.",
    ref: "PostgreSQL Documentation",
    subtopics: [
      { name: "Set-based speed", detail: "A procedure that loops server-side processes millions of rows without shipping each one over the network — the app version would be 100x network-bound." },
      { name: "PL/pgSQL in practice", detail: "Variables, IF/LOOP, and EXCEPTION blocks with real transactional semantics — a full language, but with DB tooling, not your IDE's." },
      { name: "Version control tension", detail: "Procedures live in the database: ship them as migrations, or they drift between environments. Every change is a deploy — treat it like code, because it is." },
      { name: "Security bundling", detail: "Grant EXECUTE without table access (SECURITY DEFINER carefully) — the classic pattern for letting apps enqueue jobs but never touch the queue table directly." },
    ],
    code: `// The logic: expire stale carts — millions of rows, set-based
await pool.query(\`
  CREATE OR REPLACE FUNCTION expire_stale_carts(max_age interval)
  RETURNS integer AS $$
  DECLARE
    moved integer;
  BEGIN
    -- archive in one set-based statement, not one query per row
    INSERT INTO expired_carts (cart_id, user_id, expired_at)
    SELECT id, user_id, now() FROM carts WHERE updated_at < now() - max_age;

    GET DIAGNOSTICS moved = ROW_COUNT;

    DELETE FROM carts WHERE updated_at < now() - max_age;
    RETURN moved;
  END;
  $$ LANGUAGE plpgsql;
\`);

// App calls it by name — one round trip, transactional inside
const { rows } = await pool.query("SELECT expire_stale_carts($1) AS expired", ["7 days"]);
console.log(rows[0].expired); // 183,204 rows moved, no network churn

// Money transfer as a procedure: zero gap between check and move
await pool.query(\`
  CREATE OR REPLACE FUNCTION transfer(from_acct uuid, to_acct uuid, amount_cents int)
  RETURNS void AS $$
  BEGIN
    UPDATE accounts SET balance_cents = balance_cents - amount_cents
      WHERE id = from_acct AND balance_cents >= amount_cents;
    IF NOT FOUND THEN RAISE EXCEPTION 'insufficient funds'; END IF;
    UPDATE accounts SET balance_cents = balance_cents + amount_cents WHERE id = to_acct;
  END;
  $$ LANGUAGE plpgsql;
\`);`,
    steps: ["Define procedure in DB", "App calls it by name", "Logic runs server-side", "Result returned"],
  },
  {
    id: "db-fulltextsearch",
    cat: "db",
    title: "Full-Text Search",
    one: "Indexing text so queries can match words and relevance, not exact strings.",
    why: "LIKE '%shoe%' can't rank, can't handle 'running shoes' vs 'shoes running', and reads every row. Full-text search tokenizes documents into words, indexes them, and returns results ordered by relevance — search that actually helps users.",
    how: "Text is parsed into tokens (stemming 'running'→'run', dropping stopwords) forming a tsvector — an inverted index from word to rows. Queries become tsqueries ('shoes & waterproof'), matched via GIN index, ranked by ts_rank (frequency, position, weighting).",
    when: "Postgres FTS is excellent up to millions of rows: product search, article search, log triage. Reach for Elasticsearch/Typesense/Meili when you need typo tolerance, faceted filters, autosuggest-as-you-type at scale, or hundreds of millions of documents.",
    ref: "PostgreSQL Documentation",
    subtopics: [
      { name: "tsvector & tsquery", detail: "to_tsvector('english', text) normalizes a document; to_tsquery/plainto_tsquery normalizes the query. Match with @@ — the whole pipeline in one operator." },
      { name: "Ranking", detail: "ts_rank scores by term frequency and field weights (title beats body with setweight A/B/C/D). Users click the first result — ranking IS the product." },
      { name: "GIN indexes", detail: "An inverted index per column: CREATE INDEX ... USING gin(tsvector_col). Turns @@ lookups from full scans into index probes." },
      { name: "Prefix + fuzzy matching", detail: "shoe:* matches shoe/shoes; pg_trgm similarity handles typos. Combine both for forgiving search without a separate engine." },
    ],
    code: `// One-time setup: stored vector + index
await pool.query(\`
  ALTER TABLE articles ADD COLUMN search tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
      setweight(to_tsvector('english', coalesce(body,'')), 'B')
    ) STORED;
  CREATE INDEX idx_articles_search ON articles USING gin(search);
\`);

// Search with ranking — title hits outrank body hits
const q = "waterproof running shoes";
const { rows } = await pool.query(\`
  SELECT id, title,
         ts_rank(search, query) AS relevance
  FROM articles, plainto_tsquery('english', $1) AS query
  WHERE search @@ query
  ORDER BY relevance DESC
  LIMIT 20
\`, [q]);

// Highlight the matched fragments for the UI
const highlighted = await pool.query(\`
  SELECT ts_headline('english', body, plainto_tsquery('english', $1),
         'StartSel=<mark>,StopSel=</mark>,MaxFragments=2') AS snippet
  FROM articles WHERE search @@ plainto_tsquery('english', $1) LIMIT 3
\`, [q]);

// Typo tolerance via trigram similarity alongside FTS
const fuzzy = await pool.query(
  "SELECT * FROM articles WHERE similarity(title, $1) > 0.3 ORDER BY similarity(title, $1) DESC",
  ["watrproof runing shoo"]
);`,
    steps: ["Text indexed", "Query with keywords", "Ranked by relevance", "Best matches returned"],
  },
  {
    id: "db-timeseries",
    cat: "db",
    title: "Time-Series Databases",
    one: "Optimized storage and queries for data points ordered by time, like metrics.",
    why: "Sensor readings, request metrics, prices — append-mostly, queried by time range, pruned when old. A B-tree built for random updates handles this badly; time-series engines compress by timestamp and answer 'last hour of data' without touching the rest.",
    how: "Data is partitioned by time (hypertables/chunks): each chunk covers an interval, writes land in the newest one, and old chunks compress columnar-style (delta encoding, gorilla compression). Range queries prune to the relevant chunks; retention is dropping whole chunks.",
    when: "Use for high ingest rates (thousands of points/sec) with time-bucketed queries: monitoring, IoT, financial ticks. A regular Postgres with proper indexes handles modest volumes fine — don't add an engine until write volume or compression costs demand it. Never store time-series you'll need to UPDATE transactionally in one.",
    ref: "InfluxDB Documentation",
    subtopics: [
      { name: "Time partitioning", detail: "Rows split into chunks by interval (hour/day). Query 'last 24h' touches only 1-2 chunks — partition pruning is the whole speed trick." },
      { name: "Compression", detail: "Sorted timestamps compress absurdly well: delta-of-delta + gorilla often 10-20x smaller than row storage. Old chunks compress; hot chunks stay fast." },
      { name: "Downsampling", detail: "Roll raw points into 1m/1h averages via continuous aggregates — dashboards read the rollups; raw data feeds drill-downs until retention drops it." },
      { name: "Retention policies", detail: "Data expires by age automatically (drop chunk, not row). Decide per series: raw metrics 30 days, rollups 2 years." },
    ],
    code: `// TimescaleDB: Postgres with time-series superpowers
await pool.query("CREATE EXTENSION IF NOT EXISTS timescaledb");

// Any table becomes a hypertable, chunked by time
await pool.query(\`
  CREATE TABLE readings (
    sensor_id int NOT NULL,
    ts timestamptz NOT NULL,
    temperature double precision NOT NULL
  );
  SELECT create_hypertable('readings', 'ts', chunk_time_interval => interval '1 day');
\`);

// Ingest: append-only batches — thousands of rows per statement
await pool.query(
  "INSERT INTO readings (sensor_id, ts, temperature) SELECT $1, unnest($2::timestamptz[]), unnest($3::float8[])",
  [42, timestamps, temps]
);

// Time-bucketed dashboard query: hourly averages, gaps filled
const { rows } = await pool.query(\`
  SELECT time_bucket('1 hour', ts) AS hour,
         sensor_id,
         avg(temperature) AS avg_temp,
         max(temperature) AS peak
  FROM readings
  WHERE ts > now() - interval '24 hours' AND sensor_id = 42
  GROUP BY 1, 2
  ORDER BY 1
\`);

// Continuous aggregate + retention: raw 30 days, hourly rollups forever
await pool.query(\`
  CREATE MATERIALIZED VIEW readings_hourly WITH (timescaledb.continuous) AS
  SELECT time_bucket('1 hour', ts) AS hour, sensor_id, avg(temperature) AS avg_temp
  FROM readings GROUP BY 1, 2
\`);
await pool.query("SELECT add_retention_policy('readings', INTERVAL '30 days')");`,
    steps: ["Metric collected", "Stamped with time", "Stored in time-ordered buckets", "Queried by time range"],
  },
  {
    id: "db-graphdb",
    cat: "db",
    title: "Graph Databases",
    one: "Storing relationships as first-class citizens for traversal-heavy queries.",
    why: "'Friends of friends who bought this' is 3 recursive joins in SQL — each hop explodes the intermediate result and gets slower with depth. Graph databases store edges physically, so traversing one hop is a pointer chase, no matter how deep the path.",
    how: "Data is nodes (entities) and edges (typed, directed relationships), optionally with properties. Queries declare patterns to match (Cypher/Gremlin): the engine walks from anchor nodes through real index-free adjacency — each hop follows stored links, cost scales with matches, not total graph size.",
    when: "Use for relationship-dense domains: social features, fraud rings (accounts sharing devices/cards), recommendations, knowledge graphs, dependency/impact analysis. Keep relational for transactional entity data — most systems pair them: Postgres for records, graph for the relationship questions.",
    ref: "Neo4j Documentation",
    subtopics: [
      { name: "Index-free adjacency", detail: "Every node physically points to its neighbors. Hop cost is constant regardless of graph size — depth-4 traversals don't quadruple in cost like recursive CTEs." },
      { name: "Cypher pattern matching", detail: "(a:User)-[:FRIENDS]->(b) reads like the question you're asking. ASCII-art patterns compose into multi-hop queries without joins." },
      { name: "Model by questions", detail: "Model edges around the queries you'll run (BOUGHT, VIEWED, SHARED_DEVICE), not around entities. Edge direction and type choices decide query speed." },
      { name: "Fraud ring example", detail: "Accounts linked by shared cards, devices, and addresses form dense subgraphs — one Cypher pattern surfaces an entire fraud ring that SQL would need 5 recursive joins to find." },
    ],
    code: `// Schema-free: nodes + typed edges
// (:User)-[:PLACED]->(:Order)-[:CONTAINS]->(:Product)
// (:User)-[:USES_DEVICE]->(:Device)

// Fraud ring: accounts sharing a device with a known-bad account, 2 hops away
// MATCH (bad:User {flagged: true})-[:USES_DEVICE]->(d:Device)<-[:USES_DEVICE]-(suspect:User)
// WHERE NOT (bad)-[:SAME_PERSON]->(suspect)
// RETURN suspect.id, collect(DISTINCT d.id) AS shared_devices, count(*) AS overlap

// SQL equivalent needs recursive joins — fine at hop 1, painful at hop 4:
// WITH RECURSIVE ring AS (
//   SELECT user_id, device_id FROM user_devices WHERE user_id = $1
//   UNION
//   SELECT ud.user_id, ud.device_id
//   FROM user_devices ud JOIN ring r ON ud.device_id = r.device_id
// )
// SELECT DISTINCT user_id FROM ring WHERE user_id != $1;

// Recommendation: friends-of-friends who bought what you viewed, ranked
// MATCH (me:User {id: $userId})-[:FRIENDS*1..2]->(friend)
//       -[:PLACED]->(:Order)-[:CONTAINS]->(p:Product)
// WHERE NOT (me)-[:BOUGHT]->(p)
// RETURN p.id, p.title, count(DISTINCT friend) AS socialProof
// ORDER BY socialProof DESC LIMIT 10

// A query API client-side (neo4j-driver shape):
const result = await session.run(
  "MATCH (u:User {id: $id})-[:FRIENDS]->(f) RETURN f.name LIMIT 10",
  { id: "u1" }
);`,
    steps: ["Nodes = entities", "Edges = relationships", "Traverse connections", "Pattern match across graph"],
  },
  {
    id: "db-backups",
    cat: "db",
    title: "Database Backups",
    one: "Regular snapshots so data can be restored after loss or corruption.",
    why: "Disks fail, migrations delete the wrong table, ransomware encrypts everything. A backup you haven't tested restoring is a hope, not a plan — the RTO/RPO math (how long to restore, how much data you can lose) only means something when proven.",
    how: "Two complementary kinds: logical dumps (pg_dump — portable SQL, slow at scale) and physical base backups (PITR: a filesystem-level snapshot plus the WAL archive, letting you replay to ANY point in time). Automated, encrypted, stored in another region, and restore-tested on a schedule.",
    when: "Everyone, always: daily base backup plus continuous WAL archiving gives point-in-time recovery. Size retention to compliance (30–90 days common) and verify restores quarterly by actually standing a copy up and running queries against it.",
    ref: "PostgreSQL Documentation",
    subtopics: [
      { name: "Logical vs physical", detail: "pg_dump: portable, version-flexible, slow on huge DBs. Physical (basebackup+WAL): fast restore, same-version only, enables PITR to the second." },
      { name: "Point-in-time recovery", detail: "Restore the base backup, then replay archived WAL to 14:32:05 — right before the bad migration ran. PITR is the difference between losing a day and losing 5 minutes." },
      { name: "The 3-2-1 rule", detail: "3 copies, 2 media types, 1 off-site/off-region. Ransomware that encrypts your DB and your same-region backup bucket is a real, observed failure mode." },
      { name: "Restore drills", detail: "Automate a monthly restore into a scratch instance, run integrity queries, record how long it took. Untested backups rot silently — WAL gaps, expired credentials, full buckets." },
    ],
    code: `// Daily base backup (physical) — the foundation of PITR
// $ pg_basebackup -h primary.internal -D /backups/base -X stream -C -S daily_backup

// WAL archiving in postgresql.conf makes point-in-time possible:
//   archive_mode = on
//   archive_command = 'aws s3 cp %p s3://db-wal/example/%f'

// Logical dump for portability (smaller DBs, cross-version copies)
// $ pg_dump --format=custom --compress=6 appdb > app_$(date +%F).dump

// The part everyone skips: PROVE the restore works
const { execSync } = require("child_process");

async function monthlyRestoreDrill() {
  const start = Date.now();
  execSync("aws s3 sync s3://db-backups/example /restore/base");
  execSync("pg_ctl -D /restore/base start -o '-p 5433'");

  // replay WAL to just before yesterday's bad migration
  execSync("touch /restore/base/recovery.signal");
  execSync("echo \\"restore_command = 'aws s3 cp s3://db-wal/example/%f %p'\\" >> /restore/base/postgresql.conf");
  execSync("echo \\"recovery_target_time = '2026-09-12 03:14:00'\\" >> /restore/base/postgresql.conf");

  const ok = execSync("psql -p 5433 -c 'SELECT count(*) FROM users'").toString();
  console.log(JSON.stringify({ restoreMs: Date.now() - start, ok }));
}

// Object-lock the bucket — backups that attackers (or you) can delete aren't backups.`,
    steps: ["Scheduled snapshot", "Stored off-site", "Data loss occurs", "Restore from backup"],
  },
  {
    id: "db-readwritesplit",
    cat: "db",
    title: "Read/Write Splitting",
    one: "Routing reads to replicas and writes to the primary database.",
    why: "Most apps are 95% reads — the primary sits bored while page views pile onto it. Splitting sends writes (5%) to the primary and reads (95%) to replicas, roughly multiplying read capacity by replica count with one routing layer.",
    how: "A routing layer (app-level pools, a proxy like PgBouncer/ProxySQL, or the ORM) inspects each query: writes and locking reads go to the primary; plain SELECTs go to a replica, often the least-lagged. Transactions always pin to the primary — mixing nodes inside one breaks isolation.",
    when: "Split once the primary is read-bound and adding indexes/caching has been exhausted. Handle the gotchas first: replication lag (fresh writes then stale reads), and transactions that accidentally straddle. If your 'reads' include SELECT ... FOR UPDATE or sequences, they're writes — route accordingly.",
    ref: "AWS RDS Documentation",
    subtopics: [
      { name: "Routing rules", detail: "Simple: method-based (POST → primary). Better: transaction- and statement-aware. Best: explicit hints where it matters (user session after write)." },
      { name: "Read-your-writes", detail: "Track the last write timestamp (or WAL position/LSN) per session; route that session's reads to primary until replicas catch up. Cheap and fixes the worst UX bug." },
      { name: "Transactions stay primary", detail: "BEGIN..COMMIT is atomic on one node only. The router must pin transactions to the primary — most accidental routing bugs are hidden transactions." },
      { name: "Pick the least lagged", detail: "Routing to a replica 30s behind spreads stale reads. Track lag (pg_last_wal_replay_lag) and shed reads to primary when replicas fall behind SLA." },
    ],
    code: `// Routing layer: statement inspection + read-your-writes window
const primary = new Pool({ connectionString: process.env.PRIMARY_URL });
const replicas = [new Pool({ connectionString: process.env.REPLICA1 }), new Pool({ connectionString: process.env.REPLICA2 })];

const isWrite = (sql) => /^\\s*(insert|update|delete|create|alter|drop|select\\s+.*for\\s+update)/i.test(sql);

let writeClock = 0; // set after every write; sessions compare against it

function db(session) {
  return {
    async query(sql, params) {
      const freshWindow = session.lastWriteAt && Date.now() - session.lastWriteAt < 3000;

      if (isWrite(sql)) {
        const result = await primary.query(sql, params);
        session.lastWriteAt = writeClock = Date.now();
        return result;
      }
      if (freshWindow) {
        return primary.query(sql, params); // just wrote: read-your-writes
      }
      const replica = replicas[Math.floor(Math.random() * replicas.length)];
      return replica.query(sql, params);
    },
  };
}

// Usage: one session object per request
const session = {};
await db(session).query("SELECT * FROM products WHERE featured = true"); // replica
await db(session).query("UPDATE carts SET total = 4900 WHERE id = $1", [cartId]); // primary
await db(session).query("SELECT total FROM carts WHERE id = $1", [cartId]); // primary (fresh window)`,
    steps: ["Write request → Primary", "Read request → Replica", "Load balanced across replicas", "Primary stays lighter loaded"],
  },
  {
    id: "db-warehousing",
    cat: "db",
    title: "Data Warehousing",
    one: "A separate store optimized for analytical queries over historical data.",
    why: "Analytics queries scan every row, join everything, and lock or stall the production database — one dashboard can degrade checkout. A warehouse is a copy purpose-built for that: columnar storage, massive scans, no transactional load.",
    how: "ETL/EL pipelines extract from operational DBs (CDC via WAL, or batched dumps), load into columnar storage (BigQuery, Snowflake, Redshift), and analysts query with SQL over years of history. Schemas are denormalized star schemas: fact tables (events, orders) + dimension tables (user, product, date).",
    when: "Build one when analysts need queries that would hurt production: cohort retention, year-over-year, full-history funnels. You don't need one on day one — a read replica + BI tool covers small analytics. Add the warehouse when query volume/patterns start shaping prod decisions.",
    ref: "Google BigQuery Documentation",
    subtopics: [
      { name: "Columnar storage", detail: "Values stored per-column: 'SUM(price) over 5B rows' reads one column, not all columns of every row — 10-100x less I/O for aggregates." },
      { name: "ETL vs EL(T)", detail: "Traditional ETL transforms before loading (clean star schema). Modern ELT loads raw then transforms in-warehouse (dbt) — cheaper, and raw is re-processable." },
      { name: "CDC pipelines", detail: "Change Data Capture streams the WAL (Debezium) so the warehouse mirrors prod within minutes — no midnight full-dump window, no prod impact." },
      { name: "Star schema", detail: "Facts (order_events) surrounded by dimensions (dim_user, dim_product, dim_date). BI tools generate fast joins over this shape automatically." },
    ],
    code: `// Warehouse-side (BigQuery SQL): cohort retention in seconds
// SELECT
//   DATE_TRUNC(first_order.month, MONTH) AS cohort,
//   DATE_DIFF(o.month, first_order.month, MONTH) AS month_n,
//   COUNT(DISTINCT o.user_id) AS actives
// FROM monthly_orders o
// JOIN (
//   SELECT user_id, MIN(month) AS month FROM monthly_orders GROUP BY user_id
// ) first_order USING (user_id)
// GROUP BY 1, 2 ORDER BY 1, 2;

// Pipeline: CDC from prod into the warehouse (node producer sketch)
const { WebClient } = require("@slack/webkit");

async function syncOrdersToWarehouse(since) {
  // extract from operational replica — never the primary
  const { rows } = await replica.query(
    "SELECT * FROM orders WHERE updated_at > $1", [since]
  );

  // load: columnar stores love big batched inserts
  const rowsJson = rows.map((r) => JSON.stringify(r)).join("\\n");
  await bigquery.dataset("ops").table("orders").load(rowsJson, { format: "json" });

  return rows.length;
}

// Schedule incremental syncs; warehouse handles the heavy SQL
setInterval(async () => {
  const count = await syncOrdersToWarehouse(lastCheckpoint);
  console.log("synced", count, "orders");
}, 5 * 60 * 1000);`,
    steps: ["Operational DB (transactional)", "ETL pipeline", "Warehouse (analytical)", "Reports & dashboards"],
  },
  {
    id: "db-schemadesign",
    cat: "db",
    title: "Schema Design",
    one: "Deciding how entities and relationships map to tables and keys.",
    why: "The schema is the one artifact you can never cheaply change: every query, index, and migration for years lives inside the shape you choose today. Ten minutes of modeling ('what is an order, really?') prevents months of migrations.",
    how: "Start from the domain: list entities, their relationships and cardinalities (user HAS MANY orders; order HAS MANY products VIA items). Map each entity to a table with a stable primary key (uuid or bigint), relationships to FKs, and constraints (NOT NULL, UNIQUE, CHECK) so bad data is impossible, not discouraged.",
    when: "Design before the first migration, and re-validate before big features: new access patterns change what should be indexed or denormalized. Soft-delete (deleted_at) vs hard delete, nullable vs default — decide conventions once, apply everywhere.",
    ref: "PostgreSQL Documentation",
    subtopics: [
      { name: "Keys that don't change", detail: "Surrogate keys (uuid/bigidentity) never update; natural keys (email, SKU) belong in UNIQUE constraints, not as the primary key everything references." },
      { name: "Junction tables", detail: "Many-to-many (students<->courses) is always its own table with both FKs — and often grows into a first-class entity (enrollments with grade, status, timestamps)." },
      { name: "Constraints as design", detail: "NOT NULL, UNIQUE, CHECK, and FKs are executable documentation: the database refuses invalid states even if a bug, a script, or a human tries. Validate in code too, but never only in code." },
      { name: "Denormalize by measurement", detail: "Start normalized. Add derived columns/summary tables when specific queries measurably need them — and give each duplicate a maintenance mechanism in the same commit." },
    ],
    code: `// Domain: users place orders containing products
await pool.query(\`
  CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email citext NOT NULL UNIQUE,          -- natural key as constraint
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz                 -- soft delete convention
  );

  CREATE TABLE products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sku text NOT NULL UNIQUE,
    name text NOT NULL,
    price_cents int NOT NULL CHECK (price_cents >= 0)
  );

  CREATE TABLE orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    status text NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','paid','shipped','cancelled')),
    total_cents int NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
    created_at timestamptz NOT NULL DEFAULT now()
  );

  -- many-to-many grows into a real entity
  CREATE TABLE order_items (
    order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES products(id),
    qty int NOT NULL CHECK (qty > 0),
    unit_price_cents int NOT NULL,          -- snapshot: price AT purchase time
    PRIMARY KEY (order_id, product_id)
  );

  CREATE INDEX idx_orders_user ON orders (user_id, created_at DESC);
\`);`,
    steps: ["Identify entities", "Define relationships", "Choose keys", "Normalize as needed"],
  },
  {
    id: "db-multitenancy",
    cat: "db",
    title: "Multi-Tenancy Data Isolation",
    one: "Separating each customer's data within a shared database.",
    why: "SaaS economics demand shared infrastructure, but customer A must never read customer B's data — one leaking query is a company-ending breach. Isolation architecture is the decision that decides how bad your worst bug can be.",
    how: "Three models, increasing isolation: shared table (tenant_id column on every row, enforced at query time), schema-per-tenant (namespaced tables, shared engine), database-per-tenant (hard isolation, higher cost). Shared table + row-level security (RLS) is the modern default: the database itself refuses cross-tenant reads even if app code has a bug.",
    when: "Shared table for most SaaS: cheapest, simplest ops, scale to thousands of tenants. Schema/DB-per-tenant for enterprise customers with compliance demands or huge data skew. Whichever you pick, put the tenant guard in the database layer — application-level WHERE clauses WILL be forgotten once.",
    ref: "AWS SaaS Lens",
    subtopics: [
      { name: "tenant_id everywhere", detail: "Every table, every index (lead with tenant_id in composite indexes), every query. The discipline cost is the model's main price." },
      { name: "Row-level security", detail: "Postgres RLS: policy forces tenant_id = current_setting('app.tenant_id'). Set per transaction; even a forgotten WHERE is safe — the DB filters it." },
      { name: "Pool-by-tenant routing", detail: "DB-per-tenant needs a tenant → connection map. Watch the connection math: 100 tenants × pools quickly exceeds any max_connections." },
      { name: "Noisy neighbors", detail: "One tenant's 10M-row report slows everyone on shared hardware. Track per-tenant usage, move whales to dedicated nodes, rate-limit per tenant." },
    ],
    code: `// Shared table + Postgres RLS: isolation enforced by the database
await pool.query(\`
  ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON documents
    USING (tenant_id = current_setting('app.tenant_id')::uuid);
\`);

// Every request: set the tenant, then query without thinking about it
async function withTenant(tenantId, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL app.tenant_id = $1", [tenantId]); // transaction-scoped
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

// The developer forgets the WHERE clause — still safe:
const docs = await withTenant(tenantId, (client) =>
  client.query("SELECT * FROM documents")  // RLS appends tenant_id = current silently
);

// tenant_id leads every index:
// CREATE INDEX idx_documents_tenant ON documents (tenant_id, created_at DESC);

// Cross-tenant access attempt (empty setting) returns nothing, throws nothing:
// SET app.tenant_id = '';  SELECT * FROM documents;  -> 0 rows`,
    steps: ["Shared database", "Tenant ID on every row", "Query scoped by tenant", "Isolation enforced in app or RLS"],
  },
];