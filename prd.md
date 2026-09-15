# Backend Atlas — Product Requirements Document (v2)

## 1. Summary
Backend Atlas is a single-page Next.js application that maps the full landscape of backend engineering into one visual, searchable atlas: 225 concepts across 9 categories, each with a plain-English definition, a cited reference, and an animated React Flow diagram showing how it actually works step by step.

**Who it's for:** developers building a mental map of backend systems, and anyone preparing for system design interviews.

**Core value:** turns backend terminology into something explorable and visual — pick a category, scan the grid, open a concept, watch its flow animate.

## 2. Goals
- Full, even coverage: exactly 25 concepts in each of 9 categories (225 total), no thin sections.
- Every concept ships with a working, animated diagram — no placeholders.
- Every concept cites where its definition came from (a real, named source — official docs, a standard reference book, or an engineering blog).
- Fast to scan and fast to search: category → grid → detail, full-text search across all 225 concepts.
- Feels like a designed product: off-white background, Inter typography, one restrained accent color — not a generic card-and-shadow template.

## 3. Non-goals
- Not a course or tutorial with long-form lessons — one-liners and diagrams, not essays.
- No user accounts, auth, or backend of its own — fully static, client-side data.
- No code sandbox or quizzes in this version.

## 4. Information Architecture
9 categories, 25 concepts each:
1. Core Programming
2. Web Fundamentals
3. Databases
4. Auth & Security
5. Server Architecture
6. Caching
7. Scalability & Performance
8. DevOps & Deployment
9. System Design

Each concept record:
```ts
type Concept = {
  id: string;
  cat: string;        // category id
  title: string;
  one: string;         // plain-English one-liner, <20 words
  ref: string;          // named source (docs, book, or standard reference)
  steps: string[];       // 3–5 steps rendered as a React Flow diagram
};
```
Adding a concept is a single tuple appended to one array — no other file changes.

## 5. UX / Screens
**Single view, two panels, desktop and mobile:**
- **Left sidebar** — 9 categories with live concept counts, sticky on scroll.
- **Main grid** — concept cards for the active category (title, one-liner, cited source). A search bar filters across all 225 concepts by title or definition, replacing the grid with matches from any category.
- **Detail panel** — opens in place of the grid on click: full title, one-liner, source citation, an animated React Flow diagram of the concept's steps, and a row of "related concepts" chips from the same category to jump laterally without returning to the grid.

No login, no persistence — pure client-side exploration; state lives in React only.

## 6. Visual system
- **Background:** off-white, `#F8F7F3`.
- **Ink:** warm graphite, `#1B1A18` (not pure black).
- **Accent:** signal-blue, `#2F4B9A`, used sparingly — active nav state, first node in a diagram, animated edges.
- **Neutrals:** hairline border `#E4E1D8`, muted label `#8A8578`.
- **Typography:** Inter throughout, weight and size carry hierarchy — no second typeface.
- **Diagrams:** React Flow nodes/edges, flat two-tone (ink + accent), animated dashed edges signal flow direction; long sequences snake-wrap into rows instead of overflowing.
- **Motion:** one deliberate transition (detail panel entrance) plus the diagram's animated edges — no hover-fade on every card.

## 7. Tech Stack
- Next.js 14 (App Router, patched to 14.2.35+), React 18, TypeScript.
- Tailwind CSS for layout and styling, tokens matched to the palette above.
- React Flow (`reactflow`) for all concept diagrams.
- Inter via `next/font/google`.
- Concepts as a static local TypeScript module (`data/concepts.ts`) — no database, no API routes.
- Deployable as a static Next.js build (Vercel-ready).

## 8. Content Scope (delivered)
| Category | Count |
|---|---|
| Core Programming | 25 |
| Web Fundamentals | 25 |
| Databases | 25 |
| Auth & Security | 25 |
| Server Architecture | 25 |
| Caching | 25 |
| Scalability & Performance | 25 |
| DevOps & Deployment | 25 |
| System Design | 25 |
| **Total** | **225** |

Every entry has a definition, a named reference, and a diagram — verified, no gaps.

## 9. Appendix A — Full Concept List (all 225)

Every concept shipped in the build, grouped by category, with its one-liner and cited reference exactly as they appear in `data/concepts.ts`.

### Core Programming (25)

| # | Concept | One-liner | Reference |
|---|---|---|---|
| 1 | Data Structures | Arrays, lists, trees, graphs, and hash maps — the containers every algorithm is built from. | CLRS — Introduction to Algorithms |
| 2 | Big-O Notation | Describes how runtime or memory grows as the input size grows. | CLRS — Introduction to Algorithms |
| 3 | Recursion | A function that calls itself until it hits a base case. | CLRS — Introduction to Algorithms |
| 4 | OOP Principles | Encapsulation, inheritance, and polymorphism shape how code models real-world entities. | Gang of Four — Design Patterns |
| 5 | Functional Programming | Pure functions and immutability reduce side effects and hidden state. | MDN Web Docs |
| 6 | Design Patterns | Named, reusable solutions to recurring software design problems. | Gang of Four — Design Patterns |
| 7 | SOLID Principles | Five principles that keep object-oriented code maintainable as it grows. | Robert C. Martin — Clean Code |
| 8 | Async / Event Loop | The runtime keeps working on other requests while one waits on I/O. | Node.js Documentation |
| 9 | Concurrency vs Parallelism | Concurrency is managing many tasks at once; parallelism is running them simultaneously. | MDN Web Docs |
| 10 | Memory Management | Stack vs heap allocation, and garbage collection reclaiming unused memory. | V8 Engine Documentation |
| 11 | Error Handling | Fail loudly in development, fail safely in production — never swallow errors silently. | Node.js Documentation |
| 12 | Type Systems | Static vs dynamic typing changes when type errors are caught. | TypeScript Handbook |
| 13 | Immutability | Data that can't change after creation, reducing bugs from shared state. | MDN Web Docs |
| 14 | Closures | A function that remembers variables from its enclosing scope. | MDN Web Docs |
| 15 | Dependency Injection | Pass a class's dependencies in from outside instead of creating them internally. | NestJS Documentation |
| 16 | Iterators & Generators | Objects that produce a sequence of values one at a time, lazily. | MDN Web Docs |
| 17 | Regular Expressions | Pattern matching for validating and extracting text. | MDN Web Docs |
| 18 | Serialization | Converting in-memory objects into a transferable format like JSON. | MDN Web Docs |
| 19 | Event-Driven Programming | Code reacts to emitted events rather than running strictly top-to-bottom. | Node.js Documentation |
| 20 | Modules & Packages | Splitting code into reusable, independently versioned units. | npm Documentation |
| 21 | Testing Fundamentals | Unit, integration, and end-to-end tests check correctness at different scopes. | Martin Fowler — Testing |
| 22 | Version Control (Git) | Tracking every change to code with the ability to branch and merge safely. | Git Documentation |
| 23 | API Design Principles | Predictable, consistent naming and behavior make an API easy to learn and use. | Google API Design Guide |
| 24 | Idempotency | An operation that produces the same result no matter how many times it runs. | Stripe API Documentation |
| 25 | Structured Logging | Logging as machine-parsable key-value data instead of free-text strings. | OpenTelemetry Documentation |

### Web Fundamentals (25)

| # | Concept | One-liner | Reference |
|---|---|---|---|
| 1 | HTTP Request Cycle | Client sends a request, server routes it, middleware runs, and a response comes back. | MDN Web Docs |
| 2 | REST vs GraphQL | REST exposes many fixed endpoints; GraphQL exposes one endpoint the client can shape. | GraphQL.org Documentation |
| 3 | WebSockets | A single connection stays open so server and client can push messages either way. | MDN Web Docs |
| 4 | HTTP Methods | GET, POST, PUT, DELETE — each method signals a different intent to the server. | MDN Web Docs |
| 5 | Status Codes | Numeric codes group outcomes: 2xx success, 4xx client error, 5xx server error. | MDN Web Docs |
| 6 | Headers & Cookies | Metadata and small stored values that travel alongside every request. | MDN Web Docs |
| 7 | CORS | A browser rule blocking cross-origin requests unless the server explicitly allows them. | MDN Web Docs |
| 8 | Same-Origin Policy | Browsers isolate pages from different origins from reading each other's data by default. | MDN Web Docs |
| 9 | Server-Sent Events | A one-way stream from server to client over a single long-lived HTTP connection. | MDN Web Docs |
| 10 | Long Polling | Client repeatedly asks the server 'anything new?' and the server waits before replying. | MDN Web Docs |
| 11 | API Versioning | Changing an API without breaking clients still relying on the old version. | Google API Design Guide |
| 12 | Content Negotiation | Client and server agree on a response format like JSON or XML via headers. | MDN Web Docs |
| 13 | URL Structure & Routing | Mapping URL patterns to the handler functions that serve them. | Express.js Documentation |
| 14 | gRPC | A binary, contract-first RPC protocol built on top of HTTP/2. | grpc.io Documentation |
| 15 | Webhooks | The server calls your endpoint when an event happens, instead of you polling for it. | Stripe Documentation |
| 16 | Session Management | Tracking a logged-in user across many stateless HTTP requests. | OWASP |
| 17 | Cookies vs Local Storage | Where and how data persists in the browser, and who can read it. | MDN Web Docs |
| 18 | Compression (gzip/brotli) | Shrinking response payloads before they travel over the network. | MDN Web Docs |
| 19 | HTTP/2 & HTTP/3 | Multiplexed streams over one connection cut the latency HTTP/1.1 suffered from. | MDN Web Docs |
| 20 | DNS Resolution | Translating a domain name into an IP address before a request can be sent. | Cloudflare Learning Center |
| 21 | TLS Handshake | Client and server agree on encryption keys before any data is exchanged. | Cloudflare Learning Center |
| 22 | API Gateway | A single entry point that routes, authenticates, and rate-limits requests to backend services. | AWS Documentation |
| 23 | Pagination | Splitting a large result set into pages instead of returning everything at once. | Stripe API Documentation |
| 24 | Request Validation | Checking every incoming payload's shape and values before it reaches business logic. | OWASP |
| 25 | API Throttling | Slowing clients that exceed their allotted request rate rather than rejecting outright. | Stripe API Documentation |

### Databases (25)

| # | Concept | One-liner | Reference |
|---|---|---|---|
| 1 | Indexing | A sorted lookup structure so the database doesn't scan every row to find one. | PostgreSQL Documentation |
| 2 | ACID Transactions | A transaction is Atomic, Consistent, Isolated, and Durable — all or nothing. | PostgreSQL Documentation |
| 3 | Replication | Writes go to a primary; copies (replicas) serve reads to spread the load. | AWS RDS Documentation |
| 4 | Sharding | Splitting one huge table across many databases, each holding a slice of the rows. | MongoDB Documentation |
| 5 | Normalization | Structuring tables to reduce data duplication and update anomalies. | PostgreSQL Documentation |
| 6 | Denormalization | Deliberately duplicating data to speed up reads at the cost of write complexity. | PostgreSQL Documentation |
| 7 | SQL Joins | Combining rows from two or more tables based on a related column. | PostgreSQL Documentation |
| 8 | NoSQL Types | Document, key-value, column-family, and graph stores each fit different access patterns. | MongoDB Documentation |
| 9 | Connection Pooling | Reusing a fixed set of database connections instead of opening one per request. | node-postgres Documentation |
| 10 | Query Optimization | Rewriting or indexing a query so the engine finds a faster execution plan. | PostgreSQL Documentation |
| 11 | ORMs | A layer that maps database rows to application objects, so you query in code. | Prisma Documentation |
| 12 | Migrations | Version-controlled, incremental changes to a database schema. | Prisma Documentation |
| 13 | Transaction Isolation Levels | How much one transaction can see of another's uncommitted changes. | PostgreSQL Documentation |
| 14 | Eventual Consistency | Replicas may briefly disagree, but converge to the same value over time. | DynamoDB Documentation |
| 15 | Optimistic vs Pessimistic Locking | Assume no conflict and check later, versus locking the row up front. | PostgreSQL Documentation |
| 16 | Database Views | A saved query that behaves like a virtual, always-current table. | PostgreSQL Documentation |
| 17 | Stored Procedures | Precompiled logic that runs inside the database itself. | PostgreSQL Documentation |
| 18 | Full-Text Search | Indexing text so queries can match words and relevance, not exact strings. | PostgreSQL Documentation |
| 19 | Time-Series Databases | Optimized storage and queries for data points ordered by time, like metrics. | InfluxDB Documentation |
| 20 | Graph Databases | Storing relationships as first-class citizens for traversal-heavy queries. | Neo4j Documentation |
| 21 | Database Backups | Regular snapshots so data can be restored after loss or corruption. | PostgreSQL Documentation |
| 22 | Read/Write Splitting | Routing reads to replicas and writes to the primary database. | AWS RDS Documentation |
| 23 | Data Warehousing | A separate store optimized for analytical queries over historical data. | Google BigQuery Documentation |
| 24 | Schema Design | Deciding how entities and relationships map to tables and keys. | PostgreSQL Documentation |
| 25 | Multi-Tenancy Data Isolation | Separating each customer's data within a shared database. | AWS SaaS Lens |

### Auth & Security (25)

| # | Concept | One-liner | Reference |
|---|---|---|---|
| 1 | JWT Auth | Server signs a token with claims; client sends it back to prove identity. | Auth0 Documentation |
| 2 | OAuth2 | Log in with Google or GitHub — a third party vouches for the user's identity. | OAuth.net Documentation |
| 3 | RBAC | Permissions attach to roles, not individual users — assign a role, inherit its access. | NIST |
| 4 | Password Hashing | Storing a one-way scrambled version of a password, never the plain text. | OWASP |
| 5 | Session-Based Auth | Server stores session state; the client holds only a session ID cookie. | OWASP |
| 6 | SSO (Single Sign-On) | Log in once, gain access to multiple connected applications. | Auth0 Documentation |
| 7 | MFA | A second proof of identity required beyond just a password. | OWASP |
| 8 | CSRF | Tricking a logged-in browser into submitting a request it didn't intend. | OWASP |
| 9 | XSS | Injecting malicious script into a page that other users will view. | OWASP |
| 10 | SQL Injection | Malicious input that alters an unescaped database query. | OWASP |
| 11 | Input Validation & Sanitization | Checking and cleaning every incoming value before it's trusted. | OWASP |
| 12 | Encryption at Rest vs in Transit | Protecting stored data versus protecting data while it travels. | AWS Documentation |
| 13 | API Keys | A simple secret string identifying which app or client is calling. | Stripe Documentation |
| 14 | Zero Trust Architecture | Never trust a request by default — verify every single one. | NIST |
| 15 | Secrets Management | Storing credentials outside of code, in a dedicated vault. | HashiCorp Vault Documentation |
| 16 | ABAC | Access decisions based on attributes of user, resource, and environment. | NIST |
| 17 | Least Privilege | Every user or service gets only the access it strictly needs. | NIST |
| 18 | Content Security Policy | A header restricting what scripts and resources a page can load. | MDN Web Docs |
| 19 | HTTPS/TLS | Encrypting traffic between client and server so it can't be read in transit. | MDN Web Docs |
| 20 | Token Refresh Flow | Issuing a short-lived access token plus a longer-lived refresh token. | Auth0 Documentation |
| 21 | Brute-Force Protection | Locking or slowing an account after repeated failed login attempts. | OWASP |
| 22 | Audit Logging | Recording who did what and when, for security review. | NIST |
| 23 | Authentication vs Authorization | Authentication proves who you are; authorization decides what you can do. | OWASP |
| 24 | Data Masking | Hiding or obfuscating sensitive fields in logs and non-production environments. | OWASP |
| 25 | Vulnerability Scanning | Automated tools that check dependencies and code for known security issues. | OWASP |

### Server Architecture (25)

| # | Concept | One-liner | Reference |
|---|---|---|---|
| 1 | Monolith vs Microservices | One deployable app versus many small, independently-deployable services. | Sam Newman — Building Microservices |
| 2 | Message Queues | A producer drops a job in a queue; a worker picks it up when free. | BullMQ Documentation |
| 3 | Middleware Pipeline | Each request passes through a chain of functions before reaching the handler. | Express.js Documentation |
| 4 | Event-Driven Architecture | Services communicate by emitting and reacting to events rather than direct calls. | AWS Documentation |
| 5 | Pub/Sub | Publishers emit messages to a topic; any number of subscribers receive them. | Google Cloud Pub/Sub Documentation |
| 6 | MVC Pattern | Separates data (Model), UI (View), and control flow (Controller). | Ruby on Rails Guides |
| 7 | Layered Architecture | Presentation, business logic, and data access kept in distinct layers. | Microsoft Architecture Guide |
| 8 | Hexagonal Architecture | The core domain is isolated from frameworks and external systems via ports/adapters. | Alistair Cockburn — Hexagonal Architecture |
| 9 | Service Discovery | How services find each other's network location dynamically. | Consul Documentation |
| 10 | Service Mesh | A dedicated infrastructure layer handling service-to-service traffic, retries, and observability. | Istio Documentation |
| 11 | Serverless / FaaS | Code runs on-demand in short-lived functions with no server management. | AWS Lambda Documentation |
| 12 | Event Sourcing | Store every state change as an event instead of just the current state. | Martin Fowler — Event Sourcing |
| 13 | Saga Pattern | Coordinating a distributed transaction as a sequence of local transactions with compensations. | Microsoft Architecture Guide |
| 14 | Domain-Driven Design | Modeling software around the real business domain and its own language. | Eric Evans — Domain-Driven Design |
| 15 | Backend-for-Frontend | A dedicated backend tailored to one specific frontend's needs. | Sam Newman — Building Microservices |
| 16 | Strangler Fig Pattern | Gradually replacing a legacy system by routing traffic to new services piece by piece. | Martin Fowler — StranglerFigApplication |
| 17 | Bulkhead Pattern | Isolating resources so one failing component can't sink the whole system. | Microsoft Architecture Guide |
| 18 | Idempotent Consumers | Message handlers that safely process the same message twice without side effects. | Enterprise Integration Patterns — Hohpe & Woolf |
| 19 | Dead Letter Queues | Failed messages get routed aside for inspection instead of being lost. | AWS SQS Documentation |
| 20 | Multi-Tenancy Architecture | One deployment serves many customers, isolated logically or physically. | AWS SaaS Lens |
| 21 | Background Jobs / Workers | Long-running or deferred tasks processed outside the request/response cycle. | BullMQ Documentation |
| 22 | Cron Jobs & Scheduling | Running tasks automatically on a fixed time schedule. | node-cron Documentation |
| 23 | Feature Flags | Toggling functionality on or off without a new deployment. | LaunchDarkly Documentation |
| 24 | API Composition | Aggregating data from multiple services into one response for the client. | Microsoft Architecture Guide |
| 25 | Twelve-Factor App | A set of principles for building portable, scalable cloud-native apps. | 12factor.net |

### Caching (25)

| # | Concept | One-liner | Reference |
|---|---|---|---|
| 1 | Cache-Aside | App checks the cache first; on a miss it reads the DB, then fills the cache. | Redis Documentation |
| 2 | Cache Invalidation | The hardest problem in caching — deciding when stale data must be thrown out. | Redis Documentation |
| 3 | CDN | Static assets are cached on servers close to the user instead of the origin. | Cloudflare Documentation |
| 4 | Write-Through Cache | Every write goes to the cache and the database at the same time. | AWS Documentation |
| 5 | Write-Behind Cache | Writes hit the cache immediately; the database updates asynchronously later. | AWS Documentation |
| 6 | TTL (Time to Live) | Cached data automatically expires after a set duration. | Redis Documentation |
| 7 | Cache Stampede | Many requests simultaneously miss the cache and hit the database at once. | Redis Documentation |
| 8 | In-Memory Cache (Redis/Memcached) | Storing hot data in RAM for microsecond access instead of disk. | Redis Documentation |
| 9 | HTTP Caching Headers | Cache-Control and ETag tell browsers and proxies how long to reuse a response. | MDN Web Docs |
| 10 | Browser Caching | The browser stores assets locally so repeat visits skip the network. | MDN Web Docs |
| 11 | Edge Caching | Caching responses at servers geographically close to the user. | Cloudflare Documentation |
| 12 | Query Result Caching | Storing the output of an expensive database query for reuse. | Redis Documentation |
| 13 | Cache Eviction Policies | LRU, LFU, and FIFO decide what gets removed when the cache is full. | Redis Documentation |
| 14 | Distributed Caching | A cache shared across multiple app instances instead of local to one. | Redis Documentation |
| 15 | Negative Caching | Caching the fact that something doesn't exist, to avoid repeated failed lookups. | Cloudflare Documentation |
| 16 | Cache Warming | Pre-loading the cache with expected data before real traffic arrives. | AWS Documentation |
| 17 | Object Caching | Caching entire serialized objects rather than individual fields. | Redis Documentation |
| 18 | Content Fingerprinting | Naming cached assets by content hash so URLs change only when content changes. | Webpack Documentation |
| 19 | Client-Side Caching (SWR/React Query) | The frontend caches fetched data and revalidates it in the background. | TanStack Query Documentation |
| 20 | Session Caching | Storing session data in a fast shared store instead of per-server memory. | Redis Documentation |
| 21 | Read-Through Cache | The cache itself fetches from the database on a miss, transparently to the app. | AWS Documentation |
| 22 | Multi-Layer Caching | Combining browser, CDN, and server caches for compounding speed gains. | Cloudflare Documentation |
| 23 | Cache Coherence | Keeping multiple caches in sync so none of them serves outdated data. | Redis Documentation |
| 24 | Rate Limit Counters in Cache | Using a fast in-memory store to track request counts per client. | Redis Documentation |
| 25 | Cache Key Design | Structuring cache keys so related data can be found and invalidated together. | Redis Documentation |

### Scalability & Performance (25)

| # | Concept | One-liner | Reference |
|---|---|---|---|
| 1 | Horizontal Scaling | Adding more machines instead of making one machine bigger. | AWS Documentation |
| 2 | Rate Limiting | Capping how many requests a client can make in a time window. | Stripe Engineering Blog |
| 3 | Circuit Breaker | After enough failures, stop calling a broken service and fail fast instead. | Microsoft Architecture Guide |
| 4 | Load Balancing | Incoming traffic is spread across multiple servers instead of hitting one. | AWS ELB Documentation |
| 5 | Vertical Scaling | Making a single machine bigger (more CPU/RAM) instead of adding machines. | AWS Documentation |
| 6 | Auto-Scaling | Automatically adding or removing servers based on real-time load. | AWS Documentation |
| 7 | Database Read Replicas | Serving read traffic from copies to reduce load on the primary. | AWS RDS Documentation |
| 8 | Backpressure | A system signals upstream to slow down when it's overwhelmed. | Reactive Streams Specification |
| 9 | Retry with Exponential Backoff | Waiting progressively longer between retries so a failing service isn't hammered. | AWS Documentation |
| 10 | Graceful Degradation | Serving partial functionality instead of a full outage when a dependency fails. | Microsoft Architecture Guide |
| 11 | Health Checks & Heartbeats | Periodic pings confirming a service instance is still alive and ready. | Kubernetes Documentation |
| 12 | Throttling | Deliberately slowing responses instead of rejecting them outright under load. | AWS Documentation |
| 13 | Queueing Under Load | Buffering incoming work in a queue instead of processing it instantly. | AWS Documentation |
| 14 | Bulkhead Isolation | Partitioning resources so one overloaded component can't exhaust the whole system. | Microsoft Architecture Guide |
| 15 | Sticky Sessions | Routing a client's requests to the same server for the life of a session. | AWS ELB Documentation |
| 16 | Blue-Green Traffic Shifting | Gradually moving load to a new version while watching for errors. | AWS Documentation |
| 17 | Canary Releases | Rolling a change out to a small percentage of traffic before a full release. | Google SRE Book |
| 18 | Capacity Planning | Estimating the resources needed to handle expected future load. | Google SRE Book |
| 19 | Latency vs Throughput | Latency is how fast one request completes; throughput is requests completed per second. | Google SRE Book |
| 20 | Load Testing | Simulating heavy traffic before launch to find where a system breaks. | k6 Documentation |
| 21 | Horizontal Pod Autoscaler | Kubernetes automatically adjusts pod replica count based on observed metrics. | Kubernetes Documentation |
| 22 | CDN Offloading | Routing static or heavy traffic away from origin servers to edge networks. | Cloudflare Documentation |
| 23 | Database Connection Limits | Every database has a maximum connection count that scaling must respect. | PostgreSQL Documentation |
| 24 | Multi-Region Deployment | Running the system in multiple geographic regions for latency and resilience. | AWS Documentation |
| 25 | Chaos Engineering | Deliberately injecting failures to verify a system survives them. | Principles of Chaos Engineering |

### DevOps & Deployment (25)

| # | Concept | One-liner | Reference |
|---|---|---|---|
| 1 | CI/CD Pipeline | Every code push is automatically tested and, if it passes, deployed. | GitHub Actions Documentation |
| 2 | Blue-Green Deploy | Running old and new versions side by side, then switching traffic instantly. | AWS Documentation |
| 3 | Containers | Packaging the app with everything it needs so it runs the same anywhere. | Docker Documentation |
| 4 | Kubernetes Basics | Orchestrating containers across a cluster: scheduling, scaling, self-healing. | Kubernetes Documentation |
| 5 | Docker Compose | Defining and running multi-container applications with one config file. | Docker Documentation |
| 6 | Infrastructure as Code | Defining servers and infrastructure in version-controlled config instead of manual setup. | Terraform Documentation |
| 7 | Environment Configuration | Keeping secrets and settings outside code, injected per environment. | 12factor.net |
| 8 | Logging & Centralized Logs | Aggregating logs from every service into one searchable place. | Elastic (ELK Stack) Documentation |
| 9 | Metrics & Monitoring | Continuously measuring system health: CPU, latency, error rate. | Prometheus Documentation |
| 10 | Distributed Tracing | Following a single request as it moves across multiple services. | OpenTelemetry Documentation |
| 11 | Alerting | Automatically notifying engineers when a metric crosses a dangerous threshold. | PagerDuty Documentation |
| 12 | Rollback Strategy | A predefined, fast way to revert to the previous working version. | Google SRE Book |
| 13 | GitOps | Using a Git repository as the single source of truth for infrastructure state. | Weaveworks GitOps Documentation |
| 14 | Immutable Infrastructure | Never patch a running server — replace it with a new one instead. | HashiCorp Documentation |
| 15 | Artifact Registries | Storing versioned build outputs like images and packages for deployment. | Docker Hub Documentation |
| 16 | Zero-Downtime Deployment | Rolling out a new version without dropping any in-flight requests. | Kubernetes Documentation |
| 17 | Container Orchestration | Automating deployment, scaling, and networking of containers at scale. | Kubernetes Documentation |
| 18 | Service Level Objectives (SLOs) | A target reliability metric a team commits to for a service. | Google SRE Book |
| 19 | Incident Response | A structured process for detecting, mitigating, and learning from outages. | Google SRE Book |
| 20 | Configuration Management | Tools that keep server configuration consistent across a fleet. | Ansible Documentation |
| 21 | Build Pipelines & Artifacts | Compiling and packaging code into a deployable unit before release. | GitHub Actions Documentation |
| 22 | Cloud Provider Basics | Managed compute, storage, and networking services rented instead of owned. | AWS Documentation |
| 23 | Secrets Rotation | Periodically replacing credentials to limit the damage of a leak. | HashiCorp Vault Documentation |
| 24 | Post-Mortems | A blameless written review of what caused an incident and how to prevent it. | Google SRE Book |
| 25 | Observability (Logs, Metrics, Traces) | The three pillars that let you understand system behavior after the fact. | OpenTelemetry Documentation |

### System Design (25)

| # | Concept | One-liner | Reference |
|---|---|---|---|
| 1 | CAP Theorem | In a network partition, a distributed system must choose Consistency or Availability. | Eric Brewer — CAP Theorem |
| 2 | Consistent Hashing | Adding or removing a server only reshuffles a small slice of keys. | Karger et al. — Consistent Hashing Paper |
| 3 | CQRS | Splitting the model that handles writes from the model that handles reads. | Martin Fowler — CQRS |
| 4 | Load Balancing Algorithms | Round robin, least connections, and IP hash each spread traffic differently. | AWS ELB Documentation |
| 5 | Rate Limiter Design | Token bucket and sliding window are two common algorithms for enforcing limits. | Stripe Engineering Blog |
| 6 | Designing a URL Shortener | A classic interview problem covering hashing, redirects, and storage at scale. | System Design Primer (GitHub) |
| 7 | Designing a News Feed | Fan-out on write vs fan-out on read for delivering personalized feeds. | System Design Primer (GitHub) |
| 8 | Designing a Chat System | Combining WebSockets, message queues, and storage for real-time delivery. | System Design Primer (GitHub) |
| 9 | Leader Election | Distributed nodes agree on which one coordinates, especially after a failure. | Raft Consensus Algorithm Paper |
| 10 | Consensus Algorithms (Raft/Paxos) | Getting distributed nodes to agree on a single value despite failures. | Raft Consensus Algorithm Paper |
| 11 | Distributed Locks | Coordinating exclusive access to a resource across multiple machines. | Redis Documentation (Redlock) |
| 12 | Idempotency in Distributed Systems | Ensuring retried operations across services don't duplicate effects. | Stripe Engineering Blog |
| 13 | Data Partitioning Strategies | Range, hash, and directory-based partitioning split data across nodes differently. | Martin Kleppmann — Designing Data-Intensive Applications |
| 14 | Vector Clocks | A way to track causality and ordering of events across distributed nodes. | Martin Kleppmann — Designing Data-Intensive Applications |
| 15 | Quorum Reads/Writes | Requiring a majority of replicas to agree before confirming a read or write. | Martin Kleppmann — Designing Data-Intensive Applications |
| 16 | Bloom Filters | A space-efficient structure that quickly tells you if an item is definitely not in a set. | Martin Kleppmann — Designing Data-Intensive Applications |
| 17 | Designing a Notification System | Fanning a single event out to email, push, and SMS channels reliably. | System Design Primer (GitHub) |
| 18 | Designing Distributed File Storage | Chunking, replication, and metadata lookup, like GFS or S3 internally. | Google File System Paper (Ghemawat et al.) |
| 19 | Designing an API Rate Limiter Cluster | Coordinating rate limits across many server instances consistently. | Stripe Engineering Blog |
| 20 | Eventual vs Strong Consistency | Trading immediate agreement across replicas for availability, or vice versa. | Martin Kleppmann — Designing Data-Intensive Applications |
| 21 | Message Delivery Guarantees | At-most-once, at-least-once, and exactly-once each trade off duplication vs loss. | Apache Kafka Documentation |
| 22 | Designing a Payment System | Idempotency, ledgers, and reconciliation to move money safely. | Stripe Engineering Blog |
| 23 | Capacity Estimation | Rough back-of-envelope math on QPS, storage, and bandwidth before building a system. | System Design Primer (GitHub) |
| 24 | Designing a Search Autocomplete | Tries and ranked prefix matching for instant suggestions. | System Design Primer (GitHub) |
| 25 | Trade-off Analysis in System Design | Every design decision trades one quality — speed, cost, simplicity — against another. | Google SRE Book |

## 10. Success criteria
- A user can go from landing to understanding a concept — visually, with its steps animating — in under 15 seconds.
- All 225 concepts render a working diagram; none are empty or placeholder.
- Search returns relevant matches from any category, not just the active one.
- Fully responsive; sidebar collapses gracefully on mobile; no layout shift when the detail panel opens.

## 11. Future (not built in this version)
- Bookmark "concepts I understand" (needs persistence).
- Ordered "learning paths" for structured interview prep.
- Export a category as a one-page PDF cheat sheet.
- Deeper diagram types (true compare/cycle layouts) beyond the current sequential-chain rendering.