import type { Concept } from "../types";

export const OPS: Concept[] = [
  {
    id: "ops-cicd",
    cat: "ops",
    title: "CI/CD Pipeline",
    one: "Every code push is automatically tested and, if it passes, deployed.",
    why: "Manual deploys are where courage meets error: untested builds, forgotten steps, and 'works on my machine'. A pipeline mechanizes the path from commit to production — every change verified identically, deployments boring, rollbacks routine.",
    how: "Continuous Integration: every push builds the app and runs the test suite in a clean environment — merge gates on green, not on hope. Continuous Delivery/Deployment: the verified artifact flows through environments (staging → prod), with CD deploying automatically and CDelivering requiring one human click.",
    when: "From the second commit of any real project — the pipeline pays for itself within weeks. The maturity path: CI (tests) → artifact builds → automated staging deploys → production deploy with gates. The discipline that matters: main stays deployable, always, and everything ships through the pipeline — no side doors.",
    ref: "GitHub Actions Documentation",
    subtopics: [
      { name: "CI gates", detail: "Lint + typecheck + unit + integration on every PR: green is the merge requirement. Fast feedback matters — a 40-minute CI suite teaches people to not wait for it." },
      { name: "Artifacts, not checkouts", detail: "Build ONCE, promote the same artifact through environments. Rebuilding per environment means prod runs code that was never tested as prod's binary." },
      { name: "Deploy strategies", detail: "The pipeline ends in a strategy: rolling, blue-green, canary. The pipeline's job is the same regardless — push the artifact, shift traffic, watch, and roll back on regression." },
      { name: "Pipeline as code", detail: "The pipeline definition lives in the repo (GitHub Actions YAML, .gitlab-ci.yml), versioned and reviewed like everything else. Snowflake Jenkins configs are how deploys become folklore." },
    ],
    code: `// .github/workflows/deploy.yml — the whole path as reviewed code
// name: CI/CD
// on:
//   push: { branches: [main] }
//   pull_request:
// jobs:
//   ci:
//     runs-on: ubuntu-latest
//     steps:
//       - uses: actions/checkout@v4
//       - uses: actions/setup-node@v4
//         with: { node-version: 20, cache: npm }
//       - run: npm ci
//       - run: npm run lint
//       - run: npx tsc --noEmit
//       - run: npm test -- --coverage
//       - run: npm run build
//       - name: Build artifact ONCE
//         run: docker build -t registry.example.com/app:\${{ github.sha }} .
//       - name: Push artifact
//         run: docker push registry.example.com/app:\${{ github.sha }}
//
//   deploy:
//     needs: ci                      # only green builds deploy
//     if: github.ref == 'refs/heads/main'
//     runs-on: ubuntu-latest
//     steps:
//       - name: Deploy to staging
//         run: ./deploy.sh staging registry.example.com/app@\${{ github.sha }}
//       - name: Smoke test staging
//         run: ./smoke.sh https://staging.example.com
//       - name: Deploy to production (canary 5%)
//         run: ./deploy.sh prod --canary 5 registry.example.com/app@\${{ github.sha }}
//       - name: Auto-rollback on regression
//         run: ./watch-and-rollback.sh --window 10m`,
    steps: ["Push code", "Run tests", "Build image", "Deploy", "Live"],
  },
  {
    id: "ops-bluegreen",
    cat: "ops",
    title: "Blue-Green Deploy",
    one: "Running old and new versions side by side, then switching traffic instantly.",
    why: "Rolling deploys mix two versions mid-flight and take minutes to complete; bad deploys need another slow roll to undo. Blue-green keeps both versions fully deployed and switches traffic in ONE atomic move — instant cutover, instant rollback, zero mixed-version window.",
    how: "Blue runs production traffic. Green deploys alongside, verified privately (smoke tests against green directly, no user traffic). Then the router flips: green takes 100%, blue idles warm as the instant rollback target. After a soak period, blue is decommissioned or becomes the next green.",
    when: "When rollback speed matters more than infrastructure cost (2x fleet during deploys) and versions can coexist (schema-compatible migrations). The classic fit: VM/traditional deploys where canary routing is hard. Kubernetes/progressive-delivery setups usually get the same safety from canaries at lower cost.",
    ref: "AWS Documentation",
    subtopics: [
      { name: "The instant switch", detail: "Cutover is a router change (LB target group, DNS weight, service selector): seconds, atomic, no mixed versions. Rollback = flip back. That symmetry is the entire value." },
      { name: "Pre-flight verification", detail: "Green gets real smoke tests BEFORE users: health checks, a synthetic purchase, migration verification. Users only touch green after green has proven itself." },
      { name: "The database asterisk", detail: "Both colors share one DB: migrations must be backward-compatible (expand/contract) or the 'instant rollback' breaks the moment green's migration ran. The pattern's one hard constraint." },
      { name: "Warm blue, warm green", detail: "Green must be AT capacity before cutover (cold caches, JIT, empty pools otherwise), and blue stays warm (not scaled to zero) until the soak passes — rollback that needs 10 minutes of boot isn't instant." },
    ],
    code: `// Blue-green orchestration: deploy, verify, flip, soak, retire
const COLORS = { blue: "app-blue.internal", green: "app-green.internal" };
let active = "blue";

async function deploy(build) {
  const next = active === "blue" ? "green" : "blue";

  // 1. bring the idle color up to FULL capacity — cold green can't take traffic
  await fleet.scale(COLORS[next], fleet.size(COLORS[active]));
  await fleet.waitForHealthy(COLORS[next]);

  // 2. pre-flight: verify green privately, before any user touches it
  const smoke = await runSmokeTests("http://" + COLORS[next]);
  if (!smoke.ok) {
    await fleet.scale(COLORS[next], 0);
    throw new Error("green failed smoke: " + smoke.failures.join(", "));
  }

  // 3. THE SWITCH — one atomic routing change, seconds
  await lb.setTarget({ "app.example.com": COLORS[next] });
  const previous = active;
  active = next;
  logger.info("cutover", { from: previous, to: next });

  // 4. soak: blue stays warm as the instant-rollback target
  await sleep(15 * 60 * 1000);
  const errorRate = await metrics.errorRate("10m");
  if (errorRate > 0.01) {
    await lb.setTarget({ "app.example.com": COLORS[previous] });
    active = previous;
    await pager.warn("rolled back to " + previous);
    return false;
  }

  await fleet.scale(COLORS[previous], 0); // retire the old color
  return true;
}`,
    steps: ["Blue: current live version", "Green: new version deployed", "Traffic switches to green", "Blue kept for instant rollback"],
  },
  {
    id: "ops-containers",
    cat: "ops",
    title: "Containers",
    one: "Packaging the app with everything it needs so it runs the same anywhere.",
    why: "'Works on my machine' is a dependency problem: node versions, native modules, OS libraries, env drift. A container packages the app plus its entire world into one immutable image — the same bytes run identically on a laptop, CI, and production.",
    how: "A Dockerfile describes the build: base image, dependency install, app code, startup command. The builder produces a layered image (immutable, content-addressed); the runtime unpacks it into an isolated process (own filesystem, network namespace, resource limits). Images ship via registries; containers are their running instances.",
    when: "The default packaging for anything deployed server-side. The craft that matters: small images (multi-stage builds), no secrets baked in, non-root user, and one process per container. Docker on the laptop, the same image in the cluster — parity is the whole point.",
    ref: "Docker Documentation",
    subtopics: [
      { name: "Images are layered", detail: "Each Dockerfile instruction is a cached layer: dependency layers change rarely, code layers change always. Order the file so expensive, stable layers come first — 10x faster builds." },
      { name: "Multi-stage builds", detail: "Build with compilers and dev tools in stage 1, copy ONLY the artifact to a slim runtime stage (node:20-slim). 1.2GB images become 150MB: faster pulls, smaller attack surface." },
      { name: "One process per container", detail: "Containers are process boundaries, not VMs: one concern each (web, worker, cron). Multi-process containers break signal handling, logging, and scaling independence." },
      { name: "Config at runtime", detail: "The image is immutable and environment-free: DATABASE_URL and friends inject at run time (env vars). One image promoted dev → staging → prod, config aside — twelve-factor in practice." },
    ],
    code: `// Dockerfile — multi-stage, slim, non-root, signal-friendly
// ---- stage 1: build ----
// FROM node:20-slim AS build
// WORKDIR /app
// COPY package*.json ./           # dependency layer first: cached between builds
// RUN npm ci
// COPY . .
// RUN npm run build               # tsc, bundlers — dev tools stay in this stage
//
// ---- stage 2: runtime ----
// FROM node:20-slim
// ENV NODE_ENV=production
// WORKDIR /app
// COPY package*.json ./
// RUN npm ci --omit=dev
// COPY --from=build /app/dist ./dist
//
// RUN groupadd -r app && useradd -r -g app app   # never run as root
// USER app
//
// EXPOSE 3000
// CMD ["node", "dist/server.js"]   # PID 1 gets SIGTERM -> graceful shutdown works

// Build once, run the SAME bytes everywhere:
// docker build -t registry.example.com/app:1.4.2 .
// docker push registry.example.com/app:1.4.2
// docker run -e DATABASE_URL=... -p 3000:3000 registry.example.com/app:1.4.2
// staging runs :1.4.2, prod runs :1.4.2 — parity by construction.`,
    steps: ["App code", "Dependencies", "Container image", "Runs identically anywhere"],
  },
  {
    id: "ops-kubernetes",
    cat: "ops",
    title: "Kubernetes Basics",
    one: "Orchestrating containers across a cluster: scheduling, scaling, self-healing.",
    why: "Ten containers on one host is manageable; 300 across 20 hosts by hand is chaos. Kubernetes turns fleet operations into declarative config: you describe the DESIRED state (5 replicas of this image, this much CPU) and the cluster continuously reconciles reality toward it.",
    how: "You write manifests (Deployments: replica count + pod template; Services: stable networking; ConfigMaps/Secrets: config). The control plane schedules pods onto nodes, restarts failed ones, rolls out manifest changes progressively, and exposes APIs (HPA, ingress) that build on the same model.",
    when: "Worth its complexity from roughly 'more than one service or more than a few instances' — and required once you want self-healing, rolling deploys, and autoscaling as platform features. For a single small app, a VM + systemd or a PaaS is less machinery doing the same job.",
    ref: "Kubernetes Documentation",
    subtopics: [
      { name: "Declarative reconciliation", detail: "You never 'run commands' — you edit desired state; controllers converge reality to it. Crash → restart. Drift → corrected. This loop is why K8s systems self-heal without human touching." },
      { name: "Pods, Deployments, Services", detail: "Pod: one or more containers, mortal by design. Deployment: manages replica sets of pods, rolling updates. Service: a stable virtual IP/DNS over changing pod IPs — apps talk to names, not addresses." },
      { name: "Rolling updates", detail: "Change the image tag in the Deployment; the controller replaces pods gradually (maxUnavailable/maxSurge), health-checking each wave. Bad rollouts stall automatically when new pods fail readiness." },
      { name: "The learning cliff", detail: "K8s is a platform for building platforms: ingress, RBAC, operators, CRDs are deep water. Managed control planes (EKS/GKE) remove the hardest part — running the control plane itself." },
    ],
    code: `// deployment.yaml — desired state, not commands
// apiVersion: apps/v1
// kind: Deployment
// metadata: { name: web }
// spec:
//   replicas: 5
//   strategy:
//     rollingUpdate: { maxUnavailable: 0, maxSurge: 2 }   # zero-downtime waves
//   selector: { matchLabels: { app: web } }
//   template:
//     metadata: { labels: { app: web } }
//     spec:
//       containers:
//         - name: web
//           image: registry.example.com/app:1.4.2
//           ports: [{ containerPort: 3000 }]
//           envFrom: [{ secretRef: { name: web-secrets } }]
//           readinessProbe:
//             httpGet: { path: /readyz, port: 3000 }
//           livenessProbe:
//             httpGet: { path: /healthz, port: 3000 }
//           resources:
//             requests: { cpu: 250m, memory: 256Mi }
//             limits: { memory: 512Mi }
// ---
// kind: Service            # stable DNS: web.default.svc -> live pods
// spec:
//   selector: { app: web }
//   ports: [{ port: 80, targetPort: 3000 }]

// kubectl apply -f deployment.yaml   # declare; the cluster reconciles
// kubectl rollout status deployment/web
// kubectl rollout undo deployment/web # rollback is also just reconciliation`,
    steps: ["Define desired state", "Scheduler places pods", "Cluster runs them", "Self-heals on failure"],
  },
  {
    id: "ops-dockercompose",
    cat: "ops",
    title: "Docker Compose",
    one: "Defining and running multi-container applications with one config file.",
    why: "A real app is app + postgres + redis + worker — and 'run these four things, networked' shouldn't be a wiki page of terminal commands. Compose makes the whole local (or single-host) stack one declarative file and one command: docker compose up.",
    how: "A compose.yaml declares services: image or build context, ports, env, volumes, dependency order. docker compose up creates a network, starts everything, wires DNS by service name (the app reaches postgres at hostname 'postgres'). Profiles and overrides vary dev/test setups without forking scripts.",
    when: "Local development (the whole stack for every contributor, identical), CI test environments (ephemeral real Postgres/Redis per run), and small single-host production deployments. It stops scaling where multi-host scheduling, self-healing, and rolling deploys begin — that's the K8s boundary.",
    ref: "Docker Documentation",
    subtopics: [
      { name: "Service networking", detail: "Compose creates a network where each service's name is a DNS name: app connects to postgres:5432 — no IPs, no port juggling on localhost. The container-native resolution devs never get locally otherwise." },
      { name: "depends_on vs healthchecks", detail: "depends_on orders STARTS, not readiness — the app boots before Postgres accepts connections. Pair it with healthchecks + condition: service_healthy for actually-correct startup ordering." },
      { name: "Volumes for state", detail: "Databases need named volumes to survive container restarts; code needs bind mounts (./src:/app/src) for hot reload. Mixing them up is how 'docker compose down' eats someone's dev data." },
      { name: "Profiles & overrides", detail: "Profiles gate optional services (docker compose --profile debug up adds adminer). Override files (compose.override.yml) layer local settings on the committed base without editing it." },
    ],
    code: `// compose.yaml — the whole stack as code
// services:
//   app:
//     build: .
//     ports: ["3000:3000"]
//     environment:
//       DATABASE_URL: postgres://app:secret@postgres:5432/app
//       REDIS_URL: redis://redis:6379
//     volumes: ["./src:/app/src"]              # hot reload in dev
//     depends_on:
//       postgres: { condition: service_healthy } # real readiness, not just start order
//       redis:    { condition: service_started }
//
//   worker:
//     build: .
//     command: npm run worker
//     environment:
//       DATABASE_URL: postgres://app:secret@postgres:5432/app
//     depends_on:
//       postgres: { condition: service_healthy }
//
//   postgres:
//     image: postgres:16
//     environment: { POSTGRES_USER: app, POSTGRES_PASSWORD: secret, POSTGRES_DB: app }
//     healthcheck:
//       test: ["CMD-SHELL", "pg_isready -U app"]
//       interval: 2s
//       retries: 15
//     volumes: ["pgdata:/var/lib/postgresql/data"]  # data survives restarts
//
//   redis:
//     image: redis:7
//
// volumes:
//   pgdata:

// docker compose up -d        # app + worker + postgres + redis, networked, healthy
// docker compose logs -f app
// docker compose down         # teardown; pgdata volume survives`,
    steps: ["Define services in YAML", "Run one command", "All containers start", "Networked together"],
  },
  {
    id: "ops-iac",
    cat: "ops",
    title: "Infrastructure as Code",
    one: "Defining servers and infrastructure in version-controlled config instead of manual setup.",
    why: "Clicking a console into existence creates infrastructure nobody can reproduce, review, or audit — the snowflake production box everyone fears. IaC makes infrastructure reviewable code: diffed in PRs, versioned in git, reproducible from scratch after any disaster.",
    how: "Declarative tools (Terraform/OpenTofu, Pulumi, CloudFormation) describe DESIRED infrastructure (VPC, subnets, instances, DNS); the tool diffs current vs desired and applies the delta. State tracks what exists; plan/apply gives review-then-execute discipline, exactly like a migration for your cloud account.",
    when: "Any infrastructure expected to live more than a week or be recreated ever. The discipline ladder: everything in code → no console changes (drift detection) → PR-reviewed applies via CI. Start small: one VPC + one app's resources, then expand coverage.",
    ref: "Terraform Documentation",
    subtopics: [
      { name: "Declarative + state", detail: "You describe the end state; the tool computes the diff (plan). State files map config to real resources — protect them (remote backend, locking) or two applies can race and duplicate everything." },
      { name: "Plan/apply review", detail: "terraform plan shows exactly what will be created/changed/destroyed before anything happens. Infrastructure changes get PR review like code — the destroy line in a plan is where disasters are caught." },
      { name: "Modules", detail: "Reusable components: a 'web-service' module packaging LB + instances + autoscaling + DNS. The 5th service provisioned in 20 lines instead of 500 — consistency by construction." },
      { name: "Drift is the enemy", detail: "Any console change makes code lie. Detect with scheduled plan runs (drift alarms) and enforce with read-only consoles + CI-only applies. The rule: if it isn't in code, it doesn't exist." },
    ],
    code: `// main.tf — production, reviewable, reproducible
// terraform {
//   backend "s3" { bucket = "tfstate-example", key = "prod/app.tfstate", dynamodb_table = "tflock" }
// }
//
// module "web" {
//   source        = "./modules/web-service"
//   name          = "web"
//   instance_type = "t3.large"
//   min_size      = 3
//   max_size      = 30
//   image         = "registry.example.com/app:1.4.2"
//   health_check  = "/healthz"
// }
//
// module "db" {
//   source            = "./modules/postgres"
//   instance_class    = "db.r6g.xlarge"
//   multi_az          = true
//   backup_retention  = 14
// }
//
// resource "aws_route53_record" "app" {
//   zone_id = var.zone_id
//   name    = "app.example.com"
//   type    = "A"
//   alias   { name = module.web.lb_dns_name, zone_id = module.web.lb_zone_id }
// }

// terraform plan   # exactly what changes: +2 instances, 0 destroys <- reviewed in PR
// terraform apply  # the reviewed delta happens

// Disaster recovery IS the repo:
// terraform apply -var environment=replica   # whole stack rebuilt in one region over`,
    steps: ["Write infra config", "Version controlled", "Apply to provision", "Reproducible environment"],
  },
  {
    id: "ops-envconfig",
    cat: "ops",
    title: "Environment Configuration",
    one: "Keeping secrets and settings outside code, injected per environment.",
    why: "The same build must run in dev, staging, and prod — different databases, keys, and feature settings. Hardcoded config forks behavior per environment (tested ≠ shipped) and puts secrets in git history where they live forever. Environment injection keeps ONE artifact, many configs.",
    how: "Twelve-factor style: config enters as environment variables at process start, validated (missing var = crash at boot, not mystery at request 5000). Secrets come from a vault/secret manager into those env vars; non-secret config (URLs, flags) from the platform's config layer. Never config files per environment deployed with the app.",
    when: "Every app, from the first environment variable. The boot-time validation habit is the high-value part: a service that refuses to start with missing config turns deploy-time typos into instant, obvious failures instead of runtime ghosts.",
    ref: "12factor.net",
    subtopics: [
      { name: "Validate at boot", detail: "Parse and validate ALL env config at startup into a typed config object; exit loudly on missing/invalid. The app that starts is the app that can run — no half-configured zombies." },
      { name: "One artifact, many configs", detail: "The exact same image/commit deploys everywhere; only injected env differs. If staging and prod builds differ, your pipeline tests a different binary than it ships." },
      { name: "Secrets are env, sourced from vaults", detail: "Env vars carry secrets at runtime but must be FED securely: secret manager → platform injection → process env. Committed .env files and CI logs echoing env are the classic leaks." },
      { name: "Config taxonomy", detail: "Separate: secrets (vault), infrastructure endpoints (platform config), feature flags (flag service), and tunables (env with sane defaults). Different change cadences, different owners." },
    ],
    code: `// config.ts — parse once at boot, typed, loud about missing values
const SCHEMA = {
  NODE_ENV: ["development", "test", "production"],
  PORT: "number",
  DATABASE_URL: "string",
  REDIS_URL: "string",
  JWT_SECRET: "string",
  FEATURE_NEW_CHECKOUT: "boolean",
};

function loadConfig(schema) {
  const config = {};
  const problems = [];

  for (const [key, type] of Object.entries(schema)) {
    const raw = process.env[key];
    if (raw === undefined) {
      problems.push(key + " is required");
      continue;
    }
    if (type === "number") config[key] = Number(raw);
    else if (type === "boolean") config[key] = raw === "true" || raw === "1";
    else if (Array.isArray(type)) {
      if (!type.includes(raw)) { problems.push(key + " must be one of " + type.join("|")); continue; }
      config[key] = raw;
    } else config[key] = raw;
  }

  if (problems.length) {
    console.error("CONFIG ERRORS:\\n  " + problems.join("\\n  ")); // refuse to boot half-configured
    process.exit(1);
  }
  return config;
}

module.exports.config = loadConfig(SCHEMA);
// config.JWT_SECRET is typed, validated, and guaranteed present — everywhere downstream.`,
    steps: ["Config defined per environment", "Injected at runtime", "Same code, different config", "Dev/staging/prod differ safely"],
  },
  {
    id: "ops-logging",
    cat: "ops",
    title: "Logging & Centralized Logs",
    one: "Aggregating logs from every service into one searchable place.",
    why: "Debugging a 10-service request by ssh-ing to 10 boxes and grepping 10 log formats isn't debugging — it's archaeology. Centralized logs turn the fleet's output into ONE queryable dataset: cross-service requests, fleet-wide errors, and 3 a.m. triage all become searches instead of scavenger hunts.",
    how: "Services write structured logs to stdout (they own nothing else); a shipper (Fluent Bit, Vector, platform collector) tails and forwards them to a store (Elasticsearch, Loki, ClickHouse, vendor SaaS) that indexes and serves queries. Correlation IDs stitch multi-service stories back together.",
    when: "Every service from the beginning — retrofitting structure onto years of free-text logs is the painful way. The design decisions made early: JSON to stdout only (no local files, no rotation logic in the app), correlation IDs everywhere, and levels that mean something.",
    ref: "Elastic (ELK Stack) Documentation",
    subtopics: [
      { name: "Write to stdout, ship outside", detail: "The app knows nothing about files, rotation, or shipping — that's the platform's job. Apps that manage their own log files tie their fate to local disks and lose everything when the container dies." },
      { name: "Structured JSON events", detail: "One JSON object per line with standard fields (ts, level, service, requestId) + context. Queries become filters ('level=error AND service=orders AND userId=42') instead of regex archaeology." },
      { name: "Correlation IDs", detail: "Request ID generated at the edge, propagated through every hop (headers), attached to every log line. One ID retrieves the complete cross-service story of one request — the entire point of centralization." },
      { name: "Retention & cost", detail: "Log volume is a budget: error/warn kept long (90d), info shorter (14-30d), debug sampled or off. Index only what you query; archive the rest to cheap object storage." },
    ],
    code: `// The app: JSON to stdout, correlation ID attached, nothing else
const log = (level, msg, fields = {}) =>
  process.stdout.write(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service: "orders",
    requestId: asyncLocalStorage.getStore()?.requestId ?? "none",
    msg,
    ...fields,
  }) + "\\n");

// Middleware: every request gets its thread
app.use((req, res, next) => {
  const requestId = req.get("x-request-id") ?? crypto.randomUUID();
  asyncLocalStorage.run({ requestId }, () => {
    res.setHeader("x-request-id", requestId);
    const start = Date.now();
    res.on("finish", () =>
      log("info", "request", { method: req.method, path: req.url, status: res.statusCode, ms: Date.now() - start })
    );
    next();
  });
});

// The shipper (Fluent Bit config concept): tail stdout -> index centrally
// [INPUT] name tail, path /var/log/containers/*.log, tag kube.*
// [OUTPUT] name es, match *, host search.internal, index logs-%Y.%m.%d

// What centralization buys: one query across the whole fleet
// { "query": { "bool": { "must": [
//     { "match": { "requestId": "7f3a-..." } }   <- entire request story, all services
// ]}}},
// and fleet-wide: level:error AND service:orders AND msg:"payment failed" -> last 24h`,
    steps: ["Service emits log", "Shipped to aggregator", "Indexed centrally", "Searched across all services"],
  },
  {
    id: "ops-metrics",
    cat: "ops",
    title: "Metrics & Monitoring",
    one: "Continuously measuring system health: CPU, latency, error rate.",
    why: "Logs tell you what happened to one request; metrics tell you how the SYSTEM is doing right now and over time. Without metrics, capacity planning is guessing, degradation is invisible until users report it, and every question starts with 'when did this start?'.",
    how: "Services expose counters (requests total), gauges (queue depth now), and histograms (latency distributions) — by labels (endpoint, status, region). Prometheus scrapes them on an interval into a time-series DB; dashboards (Grafana) visualize; alert rules evaluate continuously.",
    when: "Every service ships metrics from day one: the four golden signals (latency, traffic, errors, saturation) per endpoint plus resource gauges. The craft is in label discipline (cardinality explosion kills metric stores) and in dashboards built around SLOs, not around 'everything we can measure'.",
    ref: "Prometheus Documentation",
    subtopics: [
      { name: "The four golden signals", detail: "Latency (p95/p99), traffic (rps), errors (rate by code), saturation (pool usage, queue depth). Every service's first dashboard is exactly these four — everything else is commentary." },
      { name: "Counters, gauges, histograms", detail: "Counter: only increases (requests_total). Gauge: current value (connections_active). Histogram: distributions with buckets — how you get p95s. Choosing the wrong type makes the question unanswerable later." },
      { name: "Label cardinality", detail: "Labels create time series: endpoint=40 labels × status=5 × region=3 = 600 series per metric. NEVER label with userId/requestId — one busy service can melt the metrics backend." },
      { name: "Pull vs push", detail: "Prometheus pulls /metrics on an interval: simple, self-service, scrape-failure-is-a-signal. Push gateways exist for batch jobs. Most teams standardize on pull + service discovery." },
    ],
    code: `// prom-client: the three metric types on one endpoint
const client = require("prom-client");
const register = new client.Registry();

const httpDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "latency by route and status",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5], // buckets define which p99s are measurable
});
const queueDepth = new client.Gauge({ name: "queue_depth", help: "jobs waiting" });
const jobsProcessed = new client.Counter({ name: "jobs_processed_total", labelNames: ["status"], help: "worker throughput" });

register.registerMetric(httpDuration, queueDepth, jobsProcessed);

// Instrument once via middleware
app.use((req, res, next) => {
  const end = httpDuration.startTimer();
  res.on("finish", () => end({ method: req.method, route: req.route?.path ?? "unmatched", status: res.statusCode }));
  next();
});

// Expose for scraping
app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

// Alert rules (Prometheus concept): page on SLO burn, not on noise
// - alert: HighErrorRate
//   expr: sum(rate(http_request_duration_seconds_count{status=~"5.."}[5m]))
//       / sum(rate(http_request_duration_seconds_count[5m])) > 0.01
//   for: 5m
// - alert: QueueBacklog
//   expr: queue_depth > 5000
//   for: 10m`,
    steps: ["Metric emitted", "Scraped periodically", "Stored as time series", "Visualized on dashboard"],
  },
  {
    id: "ops-tracing",
    cat: "ops",
    title: "Distributed Tracing",
    one: "Following a single request as it moves across multiple services.",
    why: "One checkout call fans into auth, orders, inventory, billing, and email — when it's slow, logs and metrics can't tell you WHERE the 2 seconds went. Tracing reconstructs the request's full journey as a tree of spans with timings: the bottleneck is on a map instead of a mystery.",
    how: "The entry point starts a trace with a unique trace ID; every hop creates a span (start, duration, attributes) and propagates the context onward (W3C traceparent headers) — including through queues. Spans report to a collector (OpenTelemetry) and assemble into a waterfall you can query by trace ID, endpoint, or latency.",
    when: "Any architecture with 2+ services or meaningful queue hops — the value scales with service count. Instrument at the edges and critical hops first (auto-instrumentation covers HTTP/DB libraries); 100% sampling in dev, head-tail sampling (keep all errors, sample slow/normal) in prod to control cost.",
    ref: "OpenTelemetry Documentation",
    subtopics: [
      { name: "Spans & the trace tree", detail: "A trace is a tree: the request span parents child spans (DB query, HTTP call, queue publish) each with duration and attributes. The waterfall IS the answer to 'where did the time go'." },
      { name: "Context propagation", detail: "traceparent headers carry trace ID + span ID across HTTP; queue messages carry it as metadata. Broken propagation = orphan spans = half a story — the #1 tracing integration bug." },
      { name: "OpenTelemetry", detail: "The vendor-neutral standard: instrument once with OTel SDK, export to Jaeger/Tempo/Datadog/whatever's next. Auto-instrumentation modules cover HTTP, Express, pg, redis with zero code." },
      { name: "Sampling strategy", detail: "100% sampling costs real money at scale. Head sampling (keep 10% at source) is cheap but blind to what it dropped; tail sampling (collect all, keep 100% of errors + slowest + a sample) answers questions better for less." },
    ],
    code: `// OpenTelemetry: auto-instrument everything, custom spans where it matters
// tracing.js — loaded FIRST in the entrypoint
// const { NodeSDK } = require("@opentelemetry/sdk-node");
// const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");
// const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
//
// new NodeSDK({
//   traceExporter: new OTLPTraceExporter({ url: "http://collector.internal:4318/v1/traces" }),
//   instrumentations: [getNodeAutoInstrumentations()], // http, express, pg, redis: covered
// }).start();

// Custom span for the business step auto-instrumentation can't see
const { trace } = require("@opentelemetry/api");
async function placeOrder(userId, cart) {
  return trace.getTracer("orders").startActiveSpan("orders.placeOrder", async (span) => {
    span.setAttribute("user.id", userId);
    span.setAttribute("cart.items", cart.items.length);
    try {
      const order = await createOrder(userId, cart);   // child spans: pg INSERT
      await reserveInventory(order);                    // child span: HTTP -> inventory
      return order;
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: 2 }); // ERROR
      throw err;
    } finally {
      span.end();
    }
  });
}

// The payoff: one slow request, fully explained
// trace 4f9a2b: checkout (2140ms)
//   ├─ auth.verify        12ms
//   ├─ orders.placeOrder  1980ms
//   │   ├─ pg.INSERT orders          18ms
//   │   └─ HTTP POST inventory      1940ms   <- THE bottleneck, on a map
//   └─ email.enqueue       15ms`,
    steps: ["Request enters system", "Trace ID attached", "Passed through each service", "Full path visualized"],
  },
  {
    id: "ops-alerting",
    cat: "ops",
    title: "Alerting",
    one: "Automatically notifying engineers when a metric crosses a dangerous threshold.",
    why: "Metrics without alerting are a museum: someone has to be looking. Alerting watches every metric continuously and pages a human only when action is needed — the difference between fixing a disk at 80% and explaining data loss at 100%.",
    how: "Alert rules evaluate metrics continuously: expression (error rate > 1%, disk > 85%) + duration (for 5 minutes, killing blips) + severity. Critical pages the on-call (PagerDuty); warnings go to Slack. Every alert links to a dashboard and a runbook — the responder's first minute is navigation, not investigation.",
    when: "Alert on symptoms users feel (SLO burn rates, error rates, latency) rather than every cause (CPU spikes). The cardinal sin is alert fatigue: an alert that fires weekly and gets ignored teaches the on-call to ignore ALL alerts. If it fired and needed nothing, fix it or delete it.",
    ref: "PagerDuty Documentation",
    subtopics: [
      { name: "Symptoms, not causes", detail: "Page on what users experience: 'API error rate 5%', not 'CPU 90%'. CPU at 90% with healthy latency is capacity planning; error rates burning the SLO are an incident." },
      { name: "For-duration kills flapping", detail: "'expr > threshold for: 5m' means the condition must persist — a 30-second spike never pages. This one line is the difference between trusted alerts and muted Slack channels." },
      { name: "Multi-window burn rates", detail: "SLO-based alerting: page when the error budget burns fast (5% of budget in 1h) OR steadily (10% in 6h). Catches both fires and slow bleeds, with far fewer false pages than static thresholds." },
      { name: "Every alert has a runbook", detail: "The alert payload includes: what it means, first diagnostic steps, dashboard link, escalation path. An alert without a runbook is a riddle attached to a pager at 4 a.m." },
    ],
    code: `// Alert rules: symptoms + duration + runbook links
// prometheus alerts.yml:
// groups:
//   - name: api-slo
//     rules:
//       - alert: ApiErrorBudgetBurn
//         expr: |
//           (
//             sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
//             / sum(rate(http_requests_total[5m])) by (service)
//           ) > 0.02
//         for: 5m
//         labels: { severity: critical }
//         annotations:
//           summary: "{{ $labels.service }} error rate {{ $value | humanizePercentage }}"
//           runbook_url: "https://wiki.example.com/runbooks/api-errors"
//           dashboard: "https://grafana.example.com/d/api-health"
//
//       - alert: DiskWillFillIn4h
//         expr: predict_linear(node_filesystem_free_bytes[1h], 4 * 3600) < 0
//         for: 10m
//         labels: { severity: warning }
//         annotations:
//           runbook_url: "https://wiki.example.com/runbooks/disk"

// Routing: critical pages a human, warnings go to chat
function route(alert) {
  if (alert.severity === "critical") {
    pagerduty.trigger({
      routing_key: process.env.PD_KEY,
      dedup_key: alert.name + ":" + alert.labels.service, // group repeats
      payload: {
        summary: alert.annotations.summary,
        source: alert.labels.service,
        severity: "critical",
        custom_details: { runbook: alert.annotations.runbook_url },
      },
    });
  } else {
    slack.post(process.env.ALERTS_CHANNEL, formatSlack(alert)); // visible, non-interrupting
  }
}

// The hygiene loop: every paged alert gets reviewed post-incident
// fired 30x/month + no action taken 30x = DELETE or lower severity. Alert fatigue kills real alerts.`,
    steps: ["Metric monitored", "Threshold breached", "Alert fires", "On-call engineer notified"],
  },
  {
    id: "ops-rollback",
    cat: "ops",
    title: "Rollback Strategy",
    one: "A predefined, fast way to revert to the previous working version.",
    why: "Bad deploys happen to everyone; staying bad is a choice. The difference between a 5-minute blip and a 2-hour incident is usually just whether rollback was designed, rehearsed, and trusted — or whether the on-call is debugging forward under pressure instead.",
    how: "Rollback must be a first-class operation: keep the previous artifact deployed (blue-green) or one command away (k8s rollout undo), keep migrations backward-compatible (old code must run on new schema), and automate the trigger (error-rate regression → auto-rollback). Practice it like a fire drill.",
    when: "Design it before every deploy mechanism you adopt, and verify it in game days. The preconditions that make rollback POSSIBLE: versioned artifacts retained (can you actually deploy last Tuesday?), compatible schemas, feature flags decoupling release from deploy, and health signals trusted enough to trigger it.",
    ref: "Google SRE Book",
    subtopics: [
      { name: "Rollback speed budget", detail: "Set the number: rollback must complete < 5 minutes. If your 'rollback' is a 40-minute pipeline, that's not a rollback — it's a second deploy, and the incident doubles in length." },
      { name: "Schema compatibility is the enabler", detail: "Rollback breaks when new code migrated the schema incompatibly. Expand/contract migrations keep old code runnable — the prerequisite for treating rollback as a real option." },
      { name: "Automated triggers", detail: "Humans decide to deploy; metrics decide to roll back: error rate regression after deploy = automatic revert + page. Removes the 10-20 minutes of 'is it really broken?' debate from the middle of an incident." },
      { name: "Drills, not documents", detail: "A quarterly 'rollback drill': deploy a canary that intentionally 500s, watch auto-rollback restore service, time it. The drill finds the broken rollback path BEFORE the real night." },
    ],
    code: `// Rollback as a designed operation — artifact, schema, trigger, drill

// 1. The artifact always exists: immutable, versioned, retained
// deploys: [{ version: "1.4.2", deployedAt: "...", artifact: "registry/app:1.4.2" },
//           { version: "1.4.1", deployedAt: "...", artifact: "registry/app:1.4.1" }]

async function rollback(targetVersion, { reason }) {
  const start = Date.now();
  logger.warn("ROLLBACK initiated", { from: current(), to: targetVersion, reason });

  // feature flags off for anything the new version introduced
  await flags.disableAllIntroducedAfter(targetVersion);

  // redeploy the previous artifact — seconds, not a rebuild
  await k8s.setImage("web", "registry.example.com/app:" + targetVersion);
  await k8s.awaitRollout("web", { timeoutMs: 120000 });

  // verify before declaring success
  const health = await smokeSuite("https://app.example.com");
  if (!health.ok) throw new Error("rollback unhealthy: " + health.failures);

  logger.info("ROLLBACK complete", { ms: Date.now() - start });
  await pager.resolve("rollback complete: " + reason);
}

// 2. The automated trigger: metrics decide, humans get paged
watchdog.on("deployRegression", async ({ version, metric }) => {
  if (minutesSince(version.deployedAt) < 30) {           // only fresh deploys
    await rollback(version.previous, { reason: "auto: " + metric });
  }
});

// 3. The drill: prove it quarterly
// deploy canary-500.suffix that 500s -> expect auto-rollback < 5min -> log the actual time`,
    steps: ["New version deployed", "Issue detected", "Rollback triggered", "Previous version restored"],
  },
  {
    id: "ops-gitops",
    cat: "ops",
    title: "GitOps",
    one: "Using a Git repository as the single source of truth for infrastructure state.",
    why: "When deploys happen via laptops, kubectl contexts, and tribal memory, infrastructure state is unknowable and unreproducible. GitOps makes git the ONLY way state changes: every change is a reviewed commit, every drift is an incident, and the repo's history IS the audit log.",
    how: "Declaratively describe everything (K8s manifests, Terraform) in a repo. An in-cluster controller (Argo CD, Flux) continuously compares live state vs git and reconciles differences — manually-changed pods get reverted, merged commits get deployed. No human holds kubectl credentials for prod; the controller does.",
    when: "Once infrastructure exceeds what one person holds in their head — or the moment compliance asks 'who changed what, when?'. The on-ramp: point Argo/Flux at your existing manifests; the culture shift (PR-only changes, no console edits) is the hard part, not the tooling.",
    ref: "Weaveworks GitOps Documentation",
    subtopics: [
      { name: "Pull, not push", detail: "The controller PULLS desired state from git and applies it — no CI system holds prod credentials. A compromised pipeline can't touch prod; it can only merge a PR, which is reviewed." },
      { name: "Reconciliation kills drift", detail: "Someone hot-fixes a replica count in the console? The controller reverts it within minutes — loudly. Drift becomes impossible to accumulate, which is the whole security and sanity argument." },
      { name: "Repo topology", detail: "App repos build artifacts; a config repo declares which versions run where (envs/overlays per directory). Promoting = a PR changing one line: version 1.4.1 → 1.4.2 in prod overlay." },
      { name: "Rollback = revert", detail: "git revert the bad commit; the controller converges back. Rollback gets code review history, a diff, and an author — not a 2 a.m. kubectl snowflake." },
    ],
    code: `// The config repo IS production:
// envs/
//   staging/
//     kustomization.yml  -> image tag: 1.4.2
//   prod/
//     kustomization.yml  -> image tag: 1.4.1   <- promotion = PR that changes this line

// Argo CD Application: reconcile prod from the repo, continuously
// apiVersion: argoproj.io/v1alpha1
// kind: Application
// metadata: { name: web-prod }
// spec:
//   source:
//     repoURL: https://github.com/example/deploy-config
//     path: envs/prod
//   destination: { server: https://kubernetes.default.svc, namespace: prod }
//   syncPolicy:
//     automated: { prune: true, selfHeal: true }   # drift? reverted. merged? deployed.
//     syncOptions: [CreateNamespace=true]

// The whole deployment workflow:
// 1. app repo CI builds + pushes registry/app:1.4.2
// 2. PR to deploy-config: envs/prod/kustomization.yml newTag: 1.4.2
// 3. review approves & merges
// 4. Argo detects, syncs, reports health in the PR via status checks
//
// Anyone who has ever hot-fixed prod via console learns the hard way:
// kubectl scale deployment web --replicas=10   # ...reverted to 5 by selfHeal in ~2 min`,
    steps: ["Desired state committed to Git", "Controller detects change", "Cluster reconciled to match", "Git history = deployment history"],
  },
  {
    id: "ops-immutableinfra",
    cat: "ops",
    title: "Immutable Infrastructure",
    one: "Never patch a running server — replace it with a new one instead.",
    why: "Every in-place patch (apt upgrade on prod, config tweak via ssh) makes servers drift apart until each one is a unique snowflake no one can reproduce. Immutable infra replaces mutation with replacement: servers are cattle, images are the truth, and any instance can die without grief.",
    how: "Build a golden image (Packer: base OS + dependencies + your artifact, versioned). Deploys launch NEW instances from the new image; healthy ones join the pool, old ones drain and die. Config changes = new image, not an ssh session. Nothing running is ever edited.",
    when: "The default for anything autoscaled or containerized (containers ARE immutable infra). Highest value where fleets are large or compliance demands provable consistency. The cost: image build pipeline must be fast (minutes), and debugging means logs/metrics — you can't ssh into a philosophy.",
    ref: "HashiCorp Documentation",
    subtopics: [
      { name: "Golden images (Packer)", detail: "One build produces the versioned AMI/image: OS patches, runtime, app artifact baked in. Boot time stays fast because everything is pre-installed — no 20-minute cloud-init per scale-out." },
      { name: "Replace, never mutate", detail: "Config change → new image → rolling replacement. Every server in the fleet is byte-identical to its siblings: debugging 'which box is different' becomes a question that can't exist." },
      { name: "Pets vs cattle", detail: "Pets get named, nursed, and mourned; cattle get replaced. Immutable infra is the cattle philosophy operationalized — and the reason autoscaling can add 10 instances that behave exactly like the existing 30." },
      { name: "State lives elsewhere", detail: "Immutable instances must be stateless: data in managed DBs, files in object storage, sessions in Redis. Any stateful remnant on the instance dies with the replacement — the pattern forces twelve-factor." },
    ],
    code: `// packer.json — the golden image, versioned and reproducible
// {
//   "builders": [{ "type": "amazon-ebs", "instance_type": "t3.medium",
//                  "ami_name": "app-{{ timestamp }}" }],
//   "provisioners": [
//     { "type": "shell", "inline": [
//       "apt-get update && apt-get upgrade -y",        # OS patches: baked, not ssh'd
//       "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
//       "apt-get install -y nodejs"
//     ]},
//     { "type": "file", "source": "dist/app-1.4.2.tar.gz", "destination": "/tmp/app.tar.gz" },
//     { "type": "shell", "inline": ["mkdir -p /opt/app && tar xzf /tmp/app.tar.gz -C /opt/app"] }
//   ]
// }

// Deploys: new image -> rolling replacement -> old instances die with their snowflakes
async function deploy(newImageId) {
  const newInstances = await fleet.launch({ imageId: newImageId, count: currentCount(), tags: { version: newImageId } });
  await fleet.waitHealthy(newInstances);       // full boot + readiness before any swap

  await lb.replaceTargets(oldTargets, newInstances);

  await drain(oldTargets);                     // finish in-flight requests
  await fleet.terminate(oldTargets);           // no mercy, no patching: gone.

  audit.record("deploy", { from: currentImageId, to: newImageId });
}

// The diagnostic shift: 'ssh in and look' is gone.
// -> journalctl -u app (shipped centrally), metrics, and a one-command local replica:
// docker run registry.example.com/app:1.4.2   # the exact bytes prod runs`,
    steps: ["New image built", "New server launched from image", "Old server terminated", "No in-place patching"],
  },
  {
    id: "ops-artifactreg",
    cat: "ops",
    title: "Artifact Registries",
    one: "Storing versioned build outputs like images and packages for deployment.",
    why: "Deploys need a trustworthy source of deployable bits: the exact image that passed CI, the exact npm package the lockfile names. Without a registry, builds get rebuilt differently, versions get ambiguous, and 'what's actually running in prod?' becomes unanswerable.",
    how: "CI pushes immutable, versioned artifacts to a registry (Docker Hub, GHCR, ECR, Artifactory): images tagged with commit SHA + semver. Deployments pull by exact digest — never :latest — giving bit-for-bit parity between 'what CI tested' and 'what prod runs'. Retention policies age out old layers.",
    when: "Any pipeline that builds anything: containers (mandatory), internal npm packages, Lambda zips, IaC modules. The rules that matter: tags immutable (or digest-pinned), :latest banned in prod manifests, and artifacts retained long enough to roll back weeks later.",
    ref: "Docker Hub Documentation",
    subtopics: [
      { name: "Immutable versioning", detail: "Tag = build (git SHA) plus semver alias. Digests (sha256:...) are the only truly immutable reference — production manifests pin digests so 'rollback' deploys literally the same bytes." },
      { name: "Promotion not rebuilds", detail: "The artifact built in CI is promoted staging → prod, never rebuilt per environment. A rebuilt image has different layers, different deps — it's a different, untested artifact wearing the same tag." },
      { name: "Access & scanning", detail: "Registries gate pulls (prod clusters pull from prod registries only) and scan images for CVEs on push — a vuln found at push is a build failure; found at runtime it's an incident." },
      { name: "Retention & cost", detail: "Every build stores layers forever unless you prune: keep N recent + every prod-deployed digest, delete PR-build images after a week. Registry bills are the silent line item." },
    ],
    code: `// CI: build once, push with TWO names — the digest is what prod pins
// .github/workflows/build.yml (deploy job):
// - run: docker build -t ghcr.io/example/app:$GITHUB_SHA -t ghcr.io/example/app:$VERSION .
// - run: docker push ghcr.io/example/app:$GITHUB_SHA
// - run: docker push ghcr.io/example/app:$VERSION
// - run: docker image inspect ghcr.io/example/app:$GITHUB_SHA --format '{{index .RepoDigests 0}}' > digest.txt

// Deploy manifests pin the DIGEST — bit-for-bit, immutable, rollback-safe:
// kind: Deployment
// spec:
//   containers:
//     - name: web
//       image: ghcr.io/example/app@sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08

// Registry policies as code (ECR-flavored):
// lifecycle_policy:
//   rules:
//     - { tagStatus: tagged,   tagPatternList: ["pr-*"],      selection: any, count: 20 }   // PR builds: last 20
//     - { tagStatus: tagged,   tagPattern: "sha256-*",        selection: any, count: 200 }  // real builds: 200
//     - { tagStatus: untagged, selection: any, countUntil: 30d }            // orphan layers: gone

// Provenance check at deploy time: only artifacts THIS pipeline signed may run
const digest = readFileSync("digest.txt", "utf8").trim();
const attestation = await registry.attestation(digest);
if (attestation.builder !== "https://github.com/example/app/.github/workflows/build.yml") {
  throw new Error("refusing to deploy unattested artifact " + digest);
}`,
    steps: ["Build produces artifact", "Pushed to registry", "Tagged with version", "Pulled during deployment"],
  },
  {
    id: "ops-zerodowntime",
    cat: "ops",
    title: "Zero-Downtime Deployment",
    one: "Rolling out a new version without dropping any in-flight requests.",
    why: "Users don't schedule their checkouts around your deploys. Every deploy that drops requests is a revenue leak hiding in your metrics — usually blamed on 'the internet'. Zero-downtime is the assembly of small disciplines that make deploys invisible.",
    how: "The components: multiple replicas so old versions keep serving during rollout; readiness gates so new pods receive traffic only when actually able; connection draining so terminating instances finish in-flight work; backward-compatible APIs/schemas so both versions coexist; and a health-checked load balancer orchestrating it all.",
    when: "Every user-facing service, always. The usually-missed pieces: readiness checks that verify dependencies (not just process liveness), preStop hooks + SIGTERM handling (drain before die), and surge/unavailable budgets tuned so capacity never dips during the rollout.",
    ref: "Kubernetes Documentation",
    subtopics: [
      { name: "Readiness as the gate", detail: "A pod receives traffic only after /readyz passes — warm caches, open pools, deps reachable. Liveness is for restarts; readiness is for routing. Confusing them ships 502s during every deploy." },
      { name: "Graceful shutdown", detail: "SIGTERM: stop accepting, finish in-flight requests (seconds), close pools, exit. Plus a preStop sleep so LB rules update before the pod's connections stop arriving. This is where most 'random deploy errors' actually live." },
      { name: "Rolling budgets", detail: "maxUnavailable=0 guarantees capacity never dips (surge pods cover the wave); maxSurge caps the temporary over-provision. Zero-downtime IS these two numbers plus working probes." },
      { name: "Compatibility during rollout", detail: "For minutes, old and new serve simultaneously: schemas expand/contract, APIs additive-only, queue messages versioned. One incompatible change undoes everything else on this list." },
    ],
    code: `// Server side: drain like you mean it
const server = app.listen(3000);

process.on("SIGTERM", () => {
  logger.info("SIGTERM: draining");
  // 1. stop accepting NEW connections
  server.close(async () => {
    await Promise.allSettled([pool.end(), redis.quit()]);
    logger.info("drained, exiting");
    process.exit(0);
  });
  // 2. hard stop safety net: don't hang forever
  setTimeout(() => process.exit(1), 15000).unref();
});

// K8s side: readiness gates + budgets + preStop ordering
// kind: Deployment
// spec:
//   strategy:
//     rollingUpdate: { maxUnavailable: 0, maxSurge: 1 }  # capacity never dips
//   template:
//     spec:
//       containers:
//         - name: web
//           readinessProbe: { httpGet: { path: /readyz, port: 3000 }, periodSeconds: 2 }
//           lifecycle:
//             preStop:
//               exec: { command: ["sleep", "5"] }  # LB stops routing here BEFORE SIGTERM
//       terminationGracePeriodSeconds: 30

// The deployment is now invisible:
// kubectl set image deployment/web web=registry/app:1.4.3
// kubectl rollout status deployment/web   # 0 dropped requests, capacity never < 100%`,
    steps: ["New instances started", "Health checked", "Traffic gradually shifted", "Old instances drained & removed"],
  },
  {
    id: "ops-orchestration",
    cat: "ops",
    title: "Container Orchestration",
    one: "Automating deployment, scaling, and networking of containers at scale.",
    why: "Running containers by hand answers none of the real questions: which host has capacity? What happens when one dies? How do 30 replicas share port 3000? Orchestration (Kubernetes, Nomad, ECS) is the control plane that answers these continuously and automatically.",
    how: "You declare desired state (image, replica count, resources, networking). The orchestrator schedules containers onto nodes by capacity/affinity, maintains the declared count (crash → reschedule), load-balances between them, rolls out changes progressively, and scales on metrics — a reconciliation loop, forever.",
    when: "The moment containers multiply past a handful of hosts or services. Below that, a single host with compose is honest. Kubernetes is the ecosystem default; Nomad/ECS are simpler alternatives with fewer moving parts — the concepts here transfer to all of them.",
    ref: "Kubernetes Documentation",
    subtopics: [
      { name: "Scheduling", detail: "Placement is a constraint solve: resource requests fit, node selectors/affinity, topology spread (don't put all 5 replicas in one zone), taints/tolerations. Bad scheduling = noisy neighbors and zone-correlated outages." },
      { name: "Self-healing loops", detail: "Reconciliation: actual vs desired, forever. Pod dies → replaced in seconds. Node dies → its pods rescheduled elsewhere. This constant convergence is what 'self-healing' concretely means." },
      { name: "Service discovery & LB", detail: "Containers get DNS names and virtual IPs managed by the platform: apps reach 'orders' by name, and the platform load-balances over live, healthy endpoints — Consul-style discovery, built in." },
      { name: "The operational bill", detail: "Orchestrators are complex systems you now operate: upgrades, RBAC, networking plugins, resource tuning. Managed control planes offload the worst part; the configuration surface remains yours to learn." },
    ],
    code: `// One manifest expresses the whole desired state; the platform does the rest
// kind: Deployment
// spec:
//   replicas: 5                       # "always 5" — crashes replaced automatically
//   strategy: { rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } }
//   template:
//     spec:
//       topologySpreadConstraints:     # survive a zone dying
//         - maxSkew: 1
//           topologyKey: topology.kubernetes.io/zone
//           whenUnsatisfiable: ScheduleAnyway
//           labelSelector: { matchLabels: { app: web } }
//       containers:
//         - name: web
//           image: registry/app:1.4.2
//           resources: { requests: { cpu: 250m, memory: 256Mi } }  # scheduler input
//           readinessProbe: { httpGet: { path: /readyz, port: 3000 } }
// ---
// kind: Service       # 'web' is now a stable DNS name + load-balanced VIP
// spec:
//   selector: { app: web }
//   ports: [{ port: 80, targetPort: 3000 }]

// Everything below is what you DON'T write anymore:
// - which host each container runs on (scheduler)
// - restarting crashed containers (reconciliation)
// - re-registering servers after deploys (endpoints controller)
// - spreading a deploy across 5 replicas (deployment controller)
// - scaling at peak (HorizontalPodAutoscaler)`,
    steps: ["Desired state declared", "Orchestrator schedules containers", "Monitors health", "Restarts or reschedules as needed"],
  },
  {
    id: "ops-slo",
    cat: "ops",
    title: "Service Level Objectives (SLOs)",
    one: "A target reliability metric a team commits to for a service.",
    why: "'Five nines!' aspirations burn money without deciding anything. SLOs turn reliability into a measurable contract: which requests, how fast, how often allowed to fail — and (via error budgets) whether the team ships features or fixes reliability this month.",
    how: "Pick SLIs users feel: availability (% of valid requests served) and latency (% served under threshold), measured at the consumer edge. Set targets from user needs and business reality (99.9%, p95 < 300ms). The error budget = 100% − target: a finite allowance spent by failures, replenished only by staying reliable.",
    when: "Every service with users deserves one — start with ONE availability SLO and ONE latency SLO on the critical path. The budget mechanics are the payoff: budget remaining → ship features; budget burned → reliability work takes priority, by pre-agreed policy rather than meeting arguments.",
    ref: "Google SRE Book",
    subtopics: [
      { name: "SLI before SLO", detail: "The indicator defines what you measure (valid requests, from where, excluding which endpoints). A sloppy SLI ('all requests fast') makes the SLO either trivial or impossible — measure what users experience." },
      { name: "Error budgets", detail: "99.9% = 43 minutes of allowed badness per month, in the user's face. The budget converts reliability vs velocity arguments into arithmetic: budget left → deploy; empty → freeze and fix." },
      { name: "Targets from users, not vibes", detail: "User research + business cost sets the number: is 99% acceptable for this product (7h/month down)? Overshooting costs engineering time users never asked for. Most internal services live happily at 99-99.5%." },
      { name: "Measure at the consumer edge", detail: "Server-side metrics miss the user's reality (last-mile networks, browser errors). Measure from real clients (RUM) or the closest honest proxy — the SLO reflects THEIR experience, not your dashboard's." },
    ],
    code: `// SLO definition + live budget math — the whole system in code
const SLO = {
  availability: { target: 0.999, windowDays: 30 },  // 99.9%
  latency:      { target: 0.99,  thresholdMs: 300, windowDays: 30 }, // 99% under 300ms
};

const BUDGET_MINUTES = (1 - SLO.availability.target) * SLO.availability.windowDays * 24 * 60; // 43.2

async function errorBudget() {
  const [badRequests, totalRequests] = await Promise.all([
    metrics.sum("http_requests_total", { status: "5xx", window: "30d" }),
    metrics.sum("http_requests_total", { window: "30d" }),
  ]);

  const errorRate = badRequests / totalRequests;
  const budgetSpentPct = (errorRate / (1 - SLO.availability.target)) * 100;

  const latencySli = await metrics.ratio("http_request_duration_seconds", { le: SLO.latency.thresholdMs / 1000, window: "30d" });

  return {
    availabilitySli: (1 - errorRate).toFixed(4),
    budget: {
      spent: budgetSpentPct.toFixed(1) + "%",
      minutesRemaining: (BUDGET_MINUTES * (1 - budgetSpentPct / 100)).toFixed(1),
    },
    latencyP95TargetMet: latencySli >= SLO.latency.target,
    policy: budgetSpentPct > 100
      ? "BUDGET EXHAUSTED: reliability work takes priority, feature freeze per policy"
      : budgetSpentPct > 75
        ? "WARN: >75% of budget consumed — review risky deploys"
        : "OK: ship",
  };
}`,
    steps: ["Define target (e.g. 99.9% uptime)", "Measure actual performance", "Compare against target", "Adjust priorities if missed"],
  },
  {
    id: "ops-incidentresponse",
    cat: "ops",
    title: "Incident Response",
    one: "A structured process for detecting, mitigating, and learning from outages.",
    why: "Incidents are chaotic by nature — and chaos without structure means slow mitigation, turf confusion, and the same outage recurring quarterly. A practiced incident process converts panic into roles, timelines, and a mitigation-first reflex.",
    how: "Declare the incident (severity, incident commander), communicate (status page, internal channel), mitigate FIRST (rollback, failover, flag-off — root cause can wait), then resolve and capture the timeline. Post-incident: a blameless post-mortem within 48h producing dated action items.",
    when: "Defined before the pager fires: severity levels, on-call rotation, escalation chains, and comms templates. Run game days to rehearse — the first execution of an incident process should never be during a real incident.",
    ref: "Google SRE Book",
    subtopics: [
      { name: "Roles: IC, comms, ops", detail: "Incident Commander coordinates and decides (they don't type commands); Operations investigate and mitigate; Communications update stakeholders. One person wearing all three hats is how incidents stall." },
      { name: "Mitigate before understanding", detail: "The reflex that saves outages: recent deploy? Roll back. Dependency down? Fail over. Root-cause analysis happens AFTER users are unblocked — 'investigating while users burn' is the classic rookie failure." },
      { name: "Severity levels", detail: "SEV1: users/down or data risk — page now, status page, exec awareness. SEV2: major degradation — page, no status page. SEV3: minor, ticket. The levels decide response speed and who's woken up." },
      { name: "The timeline habit", detail: "Someone logs every action with timestamps in the channel from minute one. The post-mortem is 80% written by the time mitigation ends — and the timeline is what makes blameless analysis possible." },
    ],
    code: `// Incident tooling: declare, coordinate, learn
const SEVERITIES = {
  SEV1: { page: true, statusPage: true, channel: "#inc-sev1", responseSla: "5m" },
  SEV2: { page: true, statusPage: false, channel: "#inc-sev2", responseSla: "15m" },
  SEV3: { page: false, statusPage: false, channel: "#inc-sev3", responseSla: "1 business day" },
};

async function declareIncident({ severity, title, reporter }) {
  const policy = SEVERITIES[severity];
  const id = "INC-" + Date.now().toString(36);

  await slack.createChannel(id, policy.channel);
  await slack.post(policy.channel,
    ":rotating_light: " + id + " " + severity + " — " + title +
    "\\nIC: (assign) | Ops: (assign) | Comms: (assign)" +
    "\\nTimeline: (log EVERY action with timestamps)"
  );
  if (policy.page) await pager.pageOnCall({ id, severity, title });
  if (policy.statusPage) await statusPage.update("investigating", title);

  audit.record("incident.declared", { id, severity, reporter });
  return id;
}

// The mitigation-first reminder, pinned in every incident channel:
// "RECENT DEPLOY? ROLL BACK FIRST. Diagnose after users are unblocked."

// Resolution feeds the post-mortem machine:
async function resolveIncident(id, timeline) {
  await audit.record("incident.resolved", { id, durationMs: timeline.duration() });
  await postMortem.draft({ id, timeline: timeline.entries() }); // blameless doc, due 48h
  await statusPage.update("resolved");
}`,
    steps: ["Incident detected", "Team mobilized", "Mitigated", "Post-mortem written"],
  },
  {
    id: "ops-configmgmt",
    cat: "ops",
    title: "Configuration Management",
    one: "Tools that keep server configuration consistent across a fleet.",
    why: "50 servers configured by hand are 50 subtly different machines — and the difference between them is where 3 a.m. incidents live. Config management makes server state declarative and enforced: every box converges to the same defined state, continuously.",
    how: "You declare state (packages installed, files' contents, services running) in code (Ansible, Chef, Puppet); the tool diffs each machine against it and applies the delta — idempotently, on schedule. Drift (manual changes, partial failures) is corrected automatically on the next converge run.",
    when: "VM/legacy fleets and hybrid environments are its heartland (containers/K8s absorb much of this into images). Ansible also shines for one-off fleet operations (rolling kernel patch, cert rotation) where its agentless SSH model beats building a pipeline.",
    ref: "Ansible Documentation",
    subtopics: [
      { name: "Idempotent declarations", detail: "Tasks describe END states ('package installed', 'file has this content'), not steps. Running twice changes nothing — which is what makes scheduled convergence safe and drift self-correcting." },
      { name: "Convergence runs kill drift", detail: "Apply on a schedule (hourly/daily): any manual change outside the code gets reverted, and the fleet provably matches the repo. Drift detection alerts (diff without apply) for sensitive environments." },
      { name: "Inventory & roles", detail: "Machines grouped by role (web, db, worker); roles bundle the config each group needs. New server: add to inventory, apply role, done — identical to its 49 siblings by construction." },
      { name: "The image alternative", detail: "Config-mgmt-on-running-servers vs bake-into-images (Packer) and replace: the modern hybrid is Ansible building golden images, immutable deploys running them. Mutable convergence remains for long-lived stateful boxes." },
    ],
    code: `// playbook.yml — declarative fleet state (Ansible)
// - hosts: webservers
//   become: true
//   roles: [common, nginx, app]
//   tasks:
//     - name: app user exists
//       ansible.builtin.user:
//         name: app
//         system: true
//
//     - name: app binary is current version
//       ansible.builtin.copy:
//         src: "artifacts/app-{{ app_version }}/server.js"
//         dest: /opt/app/server.js
//         owner: app
//         notify: restart app          # handlers fire only on actual change
//
//     - name: nginx config matches repo
//       ansible.builtin.template:
//         src: nginx.conf.j2
//         dest: /etc/nginx/nginx.conf
//         validate: nginx -t -c %s     # never deploy a config that doesn't parse
//         notify: reload nginx
//
//     - name: service enabled and running
//       ansible.builtin.systemd:
//         name: app
//         state: started
//         enabled: true

// ansible-playbook -i inventory prod playbooks/site.yml --check  # drift report: what WOULD change
// ansible-playbook -i inventory prod playbooks/site.yml           # converge: fleet matches repo

// Scheduled convergence: drift becomes a 1-hour problem, not a 3-month surprise
// cron: 0 */4 * * * ansible-playbook site.yml --limit prod`,
    steps: ["Define config once", "Applied across all servers", "Drift detected", "Corrected automatically"],
  },
  {
    id: "ops-buildpipelines",
    cat: "ops",
    title: "Build Pipelines & Artifacts",
    one: "Compiling and packaging code into a deployable unit before release.",
    why: "Source code isn't deployable — transforms (compile, bundle, minify) and packaging (images, zips) stand between git and production. Doing that ONCE, in CI, producing ONE versioned artifact is what makes 'the tested build' and 'the shipped build' the same object.",
    how: "The pipeline: checkout → install deps (lockfile-pinned) → typecheck/lint → test → build (deterministic, env-free) → package into an immutable artifact (image/zip) tagged with the commit SHA → push to registry. Downstream stages deploy THAT artifact, never re-running the build.",
    when: "Every project, immediately — even 'build = npm run build'. The discipline points: lockfiles committed, builds hermetic (no network at build time), artifacts immutable and traceable to one commit, and build times kept low enough that developers watch them.",
    ref: "GitHub Actions Documentation",
    subtopics: [
      { name: "Deterministic builds", detail: "Same commit → same artifact, byte-for-byte where possible: pinned lockfiles, fixed base image digests, no clock/env leakage. Non-determinism means the artifact you test isn't provably the one you ship." },
      { name: "Cache aggressively", detail: "Dependency layers/caches keyed by lockfile hash: 10-minute builds become 90 seconds, which keeps CI green and developers iterating. Cache invalidation bugs hide in 'it worked locally'." },
      { name: "The artifact IS the deploy unit", detail: "Promote the tested artifact through environments — never rebuild per env. One commit maps to one artifact maps to a provable production state; tracing an incident to its source is then trivial." },
      { name: "Fail the build on quality gates", detail: "Lint, types, tests, secret scanning, vulnerability audit: all pipeline steps, all blocking. Anything humans can skip WILL be skipped — the pipeline is where discipline is mechanical." },
    ],
    code: `// The build stage of a pipeline, expressed in CI YAML + a Makefile
// .github/workflows/build.yml
// jobs:
//   build:
//     runs-on: ubuntu-latest
//     steps:
//       - uses: actions/checkout@v4
//       - uses: actions/setup-node@v4
//         with: { node-version: 20, cache: npm }        # dep cache keyed by lockfile
//       - run: npm ci                                    # LOCKFILE-EXACT deps
//       - run: npm run lint
//       - run: npx tsc --noEmit
//       - run: npm test
//       - run: npm audit --audit-level=high
//       - run: npm run build                             # hermetic: no env, no network
//       - run: |
//           echo "$GITHUB_SHA" > BUILD_INFO
//           docker build -t ghcr.io/example/app:$GITHUB_SHA .
//       - run: docker push ghcr.io/example/app:$GITHUB_SHA
//       - run: echo "digest=$(docker inspect --format '{{index .RepoDigests 0}}' ghcr.io/example/app:$GITHUB_SHA)" >> $GITHUB_OUTPUT

// The contract: one commit -> one immutable artifact
function artifactFor(commitSha) {
  return {
    image: "ghcr.io/example/app@" + digestFor(commitSha), // digest, not tag
    builtFrom: commitSha,
    builtBy: "build.yml@main",
    testedAt: pipelineRunFor(commitSha).url,               // provenance is a link, not a claim
  };
}
// deploy(artifactFor("9f86d08"));  // staging, prod: SAME bytes, promoted`,
    steps: ["Source code", "Compiled / bundled", "Packaged as artifact", "Ready for deployment"],
  },
  {
    id: "ops-cloudbasics",
    cat: "ops",
    title: "Cloud Provider Basics",
    one: "Managed compute, storage, and networking services rented instead of owned.",
    why: "Owning hardware means capacity guesses, hardware lifecycles, and DC walkthroughs. Cloud converts infrastructure to an API: provision in minutes, pay per use, scale elastically — and inherit world-class datacenters, networking, and regions you could never build.",
    how: "Building blocks: compute (VMs, containers, functions), storage (object S3-style, block volumes), networking (VPCs, subnets, load balancers, DNS), and managed services (Postgres, Redis, queues). Everything is API-driven — which is what makes IaC and automation possible at all.",
    when: "The default for nearly everyone now; the skill is choosing between building blocks and managed services. Rule of thumb: managed databases/queues yes (undifferentiated heavy lifting), but understand the primitives (VPC, IAM, object storage) because every managed service is assembled from them and billed by them.",
    ref: "AWS Documentation",
    subtopics: [
      { name: "Regions & AZs", detail: "Regions are geographic clusters; AZs are isolated datacenters within them (separate power/fiber). The HA unit: deploy across 3 AZs, lose one, keep serving. Latency between AZs is ~1-2ms — cheap redundancy." },
      { name: "The shared responsibility line", detail: "Provider secures the infrastructure (facilities, hardware, hypervisor); you secure everything ON it (OS patches, IAM, encryption, app code). 'The cloud is secure by default' is how buckets leak." },
      { name: "IAM is the real product", detail: "Everything authorizes through IAM: instances reading S3, services calling services, humans in consoles. Least-privilege roles per workload — instance profiles over long-lived keys, always." },
      { name: "Managed services trade-off", detail: "RDS vs self-managed Postgres: you give up superuser control and gain automated backups, patching, failover, and monitoring. For most teams that's the best trade they'll ever make — know what you're outsourcing." },
    ],
    code: `// Provisioning via API (aws-sdk) — the cloud is code
const { EC2, S3, RDS } = require("@aws-sdk/client-*");

// Object storage: the primitive everything leans on
const s3 = new S3();
await s3.putObject({ Bucket: "uploads", Key: "avatar/u42.png", Body: buffer });
const url = await getSignedUrl(s3, { Bucket: "uploads", Key: "avatar/u42.png" }, { expiresIn: 300 });

// Compute with instance profiles — no long-lived keys on machines
// iam role: web-app-role -> policy: s3:GetObject uploads/*, sqs:SendMessage jobs
// ec2 run-instances: IamInstanceProfile: { Name: "web-app-role" }

// The cost model is the product: everything meters
function monthlyEstimate({ webInstances, rps, storageGb, egressTb }) {
  return {
    compute: webInstances * 24 * 30 * 0.096,          // t3.large-hours
    database: 180 + rps > 1000 ? 260 : 0,              // db.t3.medium + IOPS bump
    storage: storageGb * 0.023,
    egress: egressTb * 90,                             // <- usually the surprise line
    note: "CDN offload cuts egress ~10x: see scale-cdnoffload",
  };
}

// The availability unit: 3 AZs, one subnet each
// vpc -> subnets [az-a, az-b, az-c] -> ASG across all three -> ALB in front
// lose an entire AZ: capacity drops 33%, availability unchanged. That's the design.`,
    steps: ["Need infrastructure", "Provision via cloud provider", "Pay for usage", "Scale up or down on demand"],
  },
  {
    id: "ops-secretsrotation",
    cat: "ops",
    title: "Secrets Rotation",
    one: "Periodically replacing credentials to limit the damage of a leak.",
    why: "Any credential can leak: a repo push, a log line, an exit interview. Rotation bounds the damage window — a leaked password valid for 24 hours is an incident; one valid for three years is a breach you discover later. Untouchable credentials are standing risk.",
    how: "Issue short-lived credentials where possible (dynamic DB users, STS tokens, OIDC federation — expiry automatic). For static secrets, automate rotation: generate new → update vault → propagate to consumers → verify → revoke old, with overlap windows so nothing breaks mid-rotation.",
    when: "Dynamic/short-lived wherever the system supports it (zero rotation work). Static secrets rotate on schedule (90 days typical) AND on any suspicion, staff change, or vendor breach notice. The proof of a working rotation process is having executed it — unrotated 'break-glass' keys are the ones that fail you.",
    ref: "HashiCorp Vault Documentation",
    subtopics: [
      { name: "Dynamic credentials", detail: "Vault/database issues per-instance credentials with 1-24h TTLs: nothing to rotate, expiry is automatic, leaked values self-destruct. The single best upgrade a secrets story can make." },
      { name: "The rotation dance", detail: "For static secrets: dual-validity window (new + old both work) → issue new → propagate → verify consumers → revoke old. Without overlap, rotation IS an outage; with it, rotation is invisible." },
      { name: "Rotation ≠ confidence", detail: "A rotation runbook nobody has run is a theory. Game-day it quarterly: rotate every credential class, time it, fix what breaks. The first real rotation shouldn't be during an incident." },
      { name: "Kill-switch readiness", detail: "Rotation's emergency sibling: revoking NOW. Know, per credential, what breaks when it's revoked and how fast consumers recover. The credential you can't revoke owns you." },
    ],
    code: `// Automated rotation with overlap windows — the safe pattern
async function rotateSecret(name) {
  const provider = providers[name]; // db, stripe, jwt-signing...

  // 1. new credential, BOTH valid during the window
  const next = await provider.create();
  await vault.write("secret/" + name, { current: next, previous: await vault.read("secret/" + name, "current") });

  // 2. consumers pick up new value on next fetch/lease-renewal (no redeploy needed
  //    when apps read current-at-boot + hot-reload via vault templates)
  await notifyConsumers(name);

  // 3. verify the new credential WORKS before killing the old one
  const healthy = await provider.verify(next);
  if (!healthy) {
    await vault.rollback(name);
    await pager.warn("rotation failed, rolled back", { secret: name });
    return false;
  }

  // 4. overlap window elapsed -> revoke the old value
  await sleep(provider.overlapMs ?? 3600 * 1000);
  await provider.revoke(previous);
  audit.record("secret.rotated", { name });
  return true;
}

// Schedule + trigger: time-based AND event-based
schedule.scheduleJob("0 4 1 * *", () => STATIC_SECRETS.forEach(rotateSecret));      // monthly
bus.on("employee.offboarded", () => rotateSecret("deploy-keys"));                    // event-based
bus.on("github.breach_notice", () => STATIC_SECRETS.forEach(rotateSecret));          // emergency`,
    steps: ["Credential issued", "Used for a period", "Rotated automatically", "Old credential invalidated"],
  },
  {
    id: "ops-postmortems",
    cat: "ops",
    title: "Post-Mortems",
    one: "A blameless written review of what caused an incident and how to prevent it.",
    why: "Every outage is tuition paid — the post-mortem is whether you get the education. Without one, the same incident recurs quarterly with different names; with a blameless one, systemic causes get fixed instead of scapegoats getting named.",
    how: "Within 48h while memory is fresh: timeline (from logs/annotations), impact (users, duration, revenue), contributing causes (plural, systemic — not one human's typo), what went well, and action items with owners and dates. Blameless: 'the deploy lacked a canary' not 'Dave deployed on Friday'.",
    when: "Every SEV1/SEV2, and SEV3s that were interesting. The process only works if action items get DONE: tracked as tickets with due dates, reviewed in ops meetings, and culled when they rot. A post-mortem whose actions never ship is a ritual, not a practice.",
    ref: "Google SRE Book",
    subtopics: [
      { name: "Blameless by design", detail: "People follow existing incentives; failures are system gaps. 'Why did the pipeline allow a bad deploy?' beats 'who clicked deploy?' — blame makes people hide information, and hidden information is how incidents recur." },
      { name: "Contributing causes, plural", detail: "Real outages have a stack: the bug, the missing canary, the alert that fired to nobody, the runbook that was stale. Fixing one layer prevents this incident; fixing the stack prevents its family." },
      { name: "Action items with owners", detail: "Every finding → ticket with an owner and date: 'add rollback alarm (owner: Ada, due 9/20)'. Untyped 'we should be more careful' action items are how post-mortems become theater." },
      { name: "The review culture", detail: "Post-mortems read like incident reports shared org-wide: searchable, linked from alerts/runbooks. Before touching a system, its post-mortem history is the fastest orientation there is." },
    ],
    code: `// Post-mortem template as code — the structure enforced, blame excluded
const postMortem = {
  incident: "INC-2026-0913",
  severity: "SEV1",
  title: "Checkout down 23 minutes after config deploy",
  impact: {
    users: "~4,100 failed checkouts",
    duration: "14:02-14:25 UTC",
    revenue: "≈ $38k GMV at risk, 61% recovered on retry",
    detection: "SLO burn alert, 2 min after impact began",
  },
  timeline: [
    { at: "14:00", what: "config deploy v78 ships (missing feature-flag default)" },
    { at: "14:02", what: "checkout 500s spike; alert fires" },
    { at: "14:06", what: "on-call paged; IC assigned" },
    { at: "14:11", what: "deploy v78 identified as change; rollback decision" },
    { at: "14:14", what: "rollback started" },
    { at: "14:25", what: "recovered; error rate to baseline" },
  ],
  contributingCauses: [
    "config change allowed empty flag-default (no schema validation at boot)",  // systemic, not 'who'
    "staging smoke tests did not cover the checkout path",
    "rollback took 12 min: pipeline rebuilds instead of promoting previous artifact",
  ],
  whatWentWell: ["alert fired in 2 min", "on-call followed the rollback-first runbook"],
  actionItems: [
    { what: "validate config schema at boot (fail fast)", owner: "ada", due: "2026-09-20" },
    { what: "add checkout flow to staging smoke suite",   owner: "grace", due: "2026-09-25" },
    { what: "promote artifacts instead of rebuilding on rollback", owner: "linus", due: "2026-10-01" },
  ],
};
// review: blameless — every cause is a system gap with a fix attached.`,
    steps: ["Incident resolved", "Timeline reconstructed", "Root cause identified", "Action items assigned"],
  },
  {
    id: "ops-observability",
    cat: "ops",
    title: "Observability (Logs, Metrics, Traces)",
    one: "The three pillars that let you understand system behavior after the fact.",
    why: "Modern systems fail in ways nobody predicted — monitoring (known-unknowns) isn't enough. Observability is the property that lets you ask NEW questions of a running system and get answers: which of the three telemetry types you reach for depends on the question.",
    how: "Three complementary signals: logs (discrete events with full context — the 'what exactly happened'), metrics (aggregated numbers over time — 'how much, how fast, trending which way'), traces (request journeys across services — 'where did the time go'). Correlation links them: trace IDs in logs, exemplars linking metrics to traces.",
    when: "All three, from the start — each answers questions the others can't. Is it broken? → metrics. Why is THIS request slow? → trace. What exactly did the system do for user X at 14:02? → logs. Teams that skip one pillar re-derive it painfully during their first real incident.",
    ref: "OpenTelemetry Documentation",
    subtopics: [
      { name: "When to reach for which", detail: "Alerting/health → metrics. Debugging one slow request → traces. Forensics and audit → logs. The pillars aren't competitors; every production question routes to one of them first." },
      { name: "Correlation is the force multiplier", detail: "trace_id on every log line, exemplars linking metric spikes to example traces, resource attributes everywhere (service, version, region). One click flows from dashboard → trace → logs — that loop is observability." },
      { name: "OpenTelemetry as the standard", detail: "One instrumentation API + SDK feeding any backend: logs/metrics/traces with shared context. Vendor swaps stop being re-instrumentation projects — the lock-in protection that makes the investment durable." },
      { name: "High-cardinality debugging", detail: "The observability test: can you slice by ANY dimension after the fact (user ID, request feature, cohort)? Metrics can't store infinite cardinality — that's what logs/traces (queryable, sampled) are for." },
    ],
    code: `// The three pillars wired together with correlation IDs
const { trace, context } = require("@opentelemetry/api");

// LOGS: every line carries the active trace
function log(level, msg, fields = {}) {
  const span = trace.getSpan(context.active());
  process.stdout.write(JSON.stringify({
    ts: new Date().toISOString(), level, msg,
    service: process.env.SERVICE_NAME,
    trace_id: span?.spanContext().traceId,   // <- pillar linkage
    ...fields,
  }) + "\\n");
}

// METRICS: with exemplars pointing at example traces
const histogram = new client.Histogram({
  name: "checkout_duration_seconds",
  buckets: [0.1, 0.3, 1, 3],
  enableExemplars: true,                    // metric spike -> example trace id
});

// TRACES: attributes are the high-cardinality slice-and-dice surface
await tracer.startActiveSpan("checkout", async (span) => {
  span.setAttribute("user.tier", user.tier);
  span.setAttribute("cart.size", cart.items.length);
  try {
    await log("info", "checkout start", { userId: user.id });
    const result = await charge(cart);      // pg + http child spans appear automatically
    histogram.record(result.ms, { tier: user.tier }, traceIdAsExemplar());
    return result;
  } finally {
    span.end();
  }
});

// The incident loop this enables:
// dashboard: p99 spike on checkout (metrics)
//   -> exemplar -> trace 4f9a: 1.9s inside inventory call (traces)
//     -> trace_id query -> "circuit breaker opened, fell back to legacy pricing" (logs)`,
    steps: ["Logs (what happened)", "Metrics (how much / how often)", "Traces (where time was spent)", "Combined view of system health"],
  },
];