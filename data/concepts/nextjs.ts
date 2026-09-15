import type { Concept } from "../types";

export const NEXTJS: Concept[] = [
  {
    id: "nextjs-app-router",
    cat: "nextjs",
    title: "App Router",
    one: "Next.js's directory-based router where folders define routes and files define UI.",
    why: "The old pages router mixed routing, data fetching, and rendering config per file. The App Router makes layout, loading, and error states first-class files, and defaults to React Server Components.",
    how: "Folders under app/ become URL segments; page.tsx makes a route public. layout.tsx wraps segments, loading.tsx and error.tsx add boundaries, and special files like route.ts handle non-page endpoints.",
    when: "Default to the App Router for new apps — it is where Next.js invests everything. The pages router remains for legacy apps and a few niche APIs.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "File conventions", detail: "page.tsx renders the route; layout.tsx wraps children; loading.tsx, error.tsx, not-found.tsx add boundaries." },
      { name: "Colocation", detail: "Non-special files in app/ (components.ts, styles) stay private — safe to colocate next to the route using them." },
      { name: "Server-first", detail: "Everything is a Server Component until a file declares 'use client'." },
    ],
    code: `// app/ folder structure -> URLs
// app/page.tsx                    -> /
// app/blog/page.tsx               -> /blog
// app/blog/[slug]/page.tsx        -> /blog/hello-world
// app/blog/layout.tsx             -> wraps all blog pages

// app/blog/[slug]/page.tsx
export default async function Post({ params }) {
  const post = await getPost(params.slug);
  return { post }; // render post (simplified JSX)
}`,
    steps: ["Folder created in app/", "page.tsx added", "URL segment live", "Layouts wrap segment"],
  },
  {
    id: "nextjs-routing",
    cat: "nextjs",
    title: "File-Based Routing",
    one: "URLs mirror the folder structure — no route config files to maintain.",
    why: "Central route tables grow stale and conflict-prone. Deriving routes from the filesystem makes every URL's source obvious and lets you create or delete pages by moving folders.",
    how: "Each folder is a URL segment; nested folders nest URLs. Conventions add behavior: [slug] for dynamic segments, [...slug] catch-all, (group) for shared layouts without a URL, @slot for parallel views.",
    when: "Works for virtually every app. Deeply dynamic CMS-style URL schemes still work via catch-all segments — no manual registry needed.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "Dynamic segments", detail: "[id] matches one segment; [...path] matches many; ?slug= generateStaticParams turns them static." },
      { name: "Route groups", detail: "(marketing) and (shop) organize folders and layouts without affecting URLs." },
      { name: "Private folders", detail: "_components prefix keeps helper folders out of the route namespace entirely." },
    ],
    code: `// Filesystem -> route table (no config!)
// app/shop/page.tsx                 /shop
// app/shop/[id]/page.tsx            /shop/123
// app/(dashboard)/settings/page.tsx /settings
// app/docs/[...path]/page.tsx       /docs/a/b/c

// app/shop/[id]/page.tsx
export default function Product({ params }) {
  return { id: params.id }; // 123 (simplified JSX)
}`,
    steps: ["Create folder", "Add page.tsx", "URL auto-registered", "Special files enhance"],
  },
  {
    id: "nextjs-layouts",
    cat: "nextjs",
    title: "Layouts & Templates",
    one: "layout.tsx wraps child segments and preserves its state across navigations.",
    why: "Nav bars and sidebars used to re-render (and lose scroll or state) on every page change. Layouts render once around the segment and stay mounted while children swap inside.",
    how: "layout.tsx receives children and renders the shared chrome around them. Layouts nest: a blog layout wraps blog pages inside the root layout. template.tsx is the variant that remounts on each navigation.",
    when: "Use layouts for nav, sidebars, providers, and metadata defaults. Choose template only when children must genuinely remount per navigation (entrance animations, reset state).",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "Nesting", detail: "Root layout wraps everything (html/body live here); segment layouts compose inward automatically." },
      { name: "Preserved UI", detail: "Interactive state inside a layout survives navigation — video keeps playing, inputs keep text." },
      { name: "template.tsx", detail: "Identical API but creates a new instance per navigation — use sparingly." },
    ],
    code: `// @jsx
// app/layout.tsx — root: every page passes through
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Nav />          {/* never unmounts */}
        {children}       {/* page renders here */}
      </body>
    </html>
  );
}

// app/blog/layout.tsx — nests inside root
// export default function BlogLayout({ children }) ...`,
    steps: ["Navigation starts", "Only page swaps", "Layout stays mounted", "State preserved"],
  },
  {
    id: "nextjs-server-client",
    cat: "nextjs",
    title: "Server vs Client Components",
    one: "'use client' draws the boundary: default server, interactive islands client.",
    why: "Shipping every component to the browser bloats bundles and forbids direct server data access. Next.js flips the default: render on the server, then hydrate only the interactive parts.",
    how: "Components are server by default — they can await data and never ship JS. A file starting with 'use client' opts it and its imports into the client bundle with full interactivity. Props crossing the boundary must be serializable.",
    when: "Keep pages, data fetching, and static sections on the server. Add 'use client' at the leaves that need state, effects, or browser APIs — push the boundary as deep as possible.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "What server can't do", detail: "No useState/useEffect, no window, no event handlers — anything interactive is client." },
      { name: "Passing the torch", detail: "Server components can render client components; the reverse fails unless the client child is passed as children." },
      { name: "Bundle effect", detail: "Everything imported below 'use client' joins the client bundle — one directive on a page undoes the whole benefit." },
    ],
    code: `// @jsx
// app/page.tsx — SERVER (default)
import Counter from "./Counter";

export default async function Page() {
  const stats = await db.getStats(); // server-only access
  return (
    <div>
      <p>Visits: {stats.count}</p>
      <Counter />   {/* client island */}
    </div>
  );
}

// app/Counter.tsx — CLIENT
// "use client"
// import { useState } from "react"; ...`,
    steps: ["Server renders page", "HTML sent to browser", "Client islands hydrate", "Interactive after hydration"],
  },
  {
    id: "nextjs-data-fetching",
    cat: "nextjs",
    title: "Data Fetching in Server Components",
    one: "Await data directly in components; fetch options control caching behavior.",
    why: "getServerSideProps-era indirection forced every fetch through special exports. In the App Router a component is just async — data access lives beside the markup that uses it.",
    how: "Make the component async and await fetch (or an ORM). Caching: force-cache opts into the Data Cache, no-store fetches per request, and next.revalidate sets time-based freshness. Identical fetches across the tree are memoized.",
    when: "Fetch in the deepest component that needs the data to keep waterfalls short. Wrap slow reads in Suspense so the shell streams instead of blocking.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "Request memoization", detail: "Same-URL fetches during one render pass reuse one request — fetch once in a layout, again in a page, no cost." },
      { name: "Blocking vs streaming", detail: "Uncached fetch blocks the route; a Suspense boundary converts that wait into a streamed fallback." },
      { name: "ORM access", detail: "Direct db calls in server components skip HTTP entirely — secrets never leave the server." },
    ],
    code: `// @jsx
// app/dashboard/page.tsx
export default async function Dashboard() {
  // per-request (default, uncached)
  const fresh = await fetch(api + "/metrics", { cache: "no-store" });

  // cached + revalidated every 10s
  const cached = await fetch(api + "/config", {
    next: { revalidate: 10 },
  });

  const metrics = await fresh.json();
  return { metrics }; // render (simplified JSX)
}`,
    steps: ["Async component runs", "fetch awaited", "Cache policy applied", "HTML rendered"],
  },
  {
    id: "nextjs-server-actions",
    cat: "nextjs",
    title: "Server Actions",
    one: "'use server' functions the client calls directly, executing on the server.",
    why: "Mutations used to require hand-built API routes plus client fetch code. Server Actions let a component import a function that runs on the server — types, auth, and revalidation included, zero endpoints.",
    how: "Mark an async function with 'use server' (file-level or inline). Pass it to form action={} or call it in handlers; the framework serializes the call, runs it server-side, and returns the result. Call revalidatePath/revalidateTag inside to refresh cached data.",
    when: "Perfect for form submits and mutations that redirect or revalidate. Not a replacement for real public APIs — actions are app-internal RPC, not versioned endpoints.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "Progressive enhancement", detail: "form action={serverFn} works before hydration — the form posts even if JS hasn't loaded." },
      { name: "Revalidation", detail: "Mutations call revalidatePath('/posts') or revalidateTag('posts') to bust cached reads immediately." },
      { name: "Security", detail: "Action bodies never ship to the client; treat arguments as untrusted input and authenticate inside the action." },
    ],
    code: `// @jsx
// app/new-post/page.tsx
async function createPost(formData) {
  "use server";
  await db.posts.create({ title: formData.get("title") });
  revalidatePath("/posts"); // cached list refreshed
  redirect("/posts");
}

export default function NewPost() {
  // posts directly to the server function
  return (
    <form action={createPost}>
      <input name="title" required />
      <button>Publish</button>
    </form>
  );
}`,
    steps: ["Form submits", "Action invoked", "Server mutation runs", "Cache revalidated", "Redirect/response"],
  },
  {
    id: "nextjs-dynamic-routes",
    cat: "nextjs",
    title: "Dynamic Routes",
    one: "Bracketed folders like [slug] match any segment value at that position.",
    why: "You can't hand-author a page per product or post. Dynamic segments parametrize one folder into infinitely many URLs, with the variable exposed to your component.",
    how: "Name a folder [slug]; the matched value arrives in params. Generate static variants with generateStaticParams (build time) or let requests render on demand. [...slug] catches multi-segment paths.",
    when: "Use for anything addressable by an id: posts, products, profiles. Prefer generateStaticParams for a known catalog; on-demand rendering for long-tail content.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "params & searchParams", detail: "params = path variables [slug]; searchParams = query string — both are props to pages." },
      { name: "generateStaticParams", detail: "Return the slug list to prerender those pages at build; unknown slugs render on demand (or 404)." },
      { name: "Catch-all", detail: "[...slug] matches one-or-more segments, [[...slug]] makes it optional too." },
    ],
    code: `// @jsx
// app/blog/[slug]/page.tsx
export async function generateStaticParams() {
  const posts = await db.postIds();
  return posts.map((slug) => ({ slug })); // prerender each
}

export default async function Post({ params }) {
  const post = await db.post(params.slug); // "hello-world"
  return { title: post.title }; // render (simplified JSX)
}`,
    steps: ["Request /blog/x", "[slug] matches 'x'", "Params passed to page", "Static or on-demand render"],
  },
  {
    id: "nextjs-route-handlers",
    cat: "nextjs",
    title: "Route Handlers",
    one: "route.ts files turn any route into a web-standard API endpoint.",
    why: "Webhooks, public APIs, and server-side webhooks need endpoints, not pages. Route Handlers give each URL a real Request/Response handler using the Web Fetch standard — no Express required.",
    how: "Create app/api/x/route.ts and export functions per verb (GET, POST...). They run server-side, can read databases and secrets, and support caching/revalidation like pages. Dynamic params arrive via the context argument.",
    when: "Use for API endpoints consumed outside your component tree (webhooks, cron, third parties). For mutations driven by your own UI, Server Actions are usually less code.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "Web standard", detail: "Signature (request: Request) => Response — portable to edge runtimes and testable without Next." },
      { name: "GET caching", detail: "GET handlers can be cached like fetches; other verbs are always dynamic." },
      { name: "Params in handlers", detail: "Second argument provides { params } for [slug] handlers — same convention as pages." },
    ],
    code: `// app/api/webhooks/stripe/route.ts
export async function POST(request) {
  const event = await request.json();
  await fulfill(event); // business logic, secrets safe
  return Response.json({ received: true });
}

// app/api/posts/route.ts
export async function GET() {
  const posts = await db.latestPosts();
  return Response.json(posts);
}`,
    steps: ["HTTP request", "route.ts matches", "Verb handler runs", "Response returned"],
  },
  {
    id: "nextjs-loading-streaming",
    cat: "nextjs",
    title: "Loading UI & Streaming",
    one: "loading.tsx wraps a segment in Suspense, streaming instant shells.",
    why: "Waiting for the slowest data query before sending any HTML makes every page feel as slow as its worst query. Streaming sends the shell immediately and fills slow regions as they resolve.",
    how: "Add loading.tsx to a segment: Next.js wraps that segment in a Suspense boundary automatically — the fallback ships with the shell while the page streams in. Nested loading files scope boundaries per segment; <Suspense> gives finer control.",
    when: "Add loading.tsx to routes with slow fetches. Keep fallbacks skeleton-shaped to avoid layout jumps; use explicit Suspense when only part of a page is slow.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "Automatic boundary", detail: "loading.tsx is sugar for <Suspense fallback={<Loading/>}> around the segment's page." },
      { name: "TTFB vs content", detail: "First byte is fast (shell), heavy sections arrive later — perceived speed beats raw query time." },
      { name: "Nesting", detail: "A deep segment's loading.tsx scopes its own fallback without disturbing parent boundaries." },
    ],
    code: `// @jsx
// app/dashboard/loading.tsx
export default function Loading() {
  return { skeleton: true }; // skeleton layout (simplified)
}

// app/dashboard/page.tsx — slow query no longer blocks shell
export default async function Dashboard() {
  const data = await slowReport(); // streams when ready
  return { data };
}`,
    steps: ["Navigation starts", "Shell + fallback sent", "Server streams content", "UI swaps when ready"],
  },
  {
    id: "nextjs-error-handling",
    cat: "nextjs",
    title: "Error & Not-Found Boundaries",
    one: "error.tsx catches render failures per segment; not-found.tsx handles 404s.",
    why: "One broken widget or missing record shouldn't blank the app. Segment-level error files quarantine failures the way route files scope layout — and give users a recovery path.",
    how: "error.tsx must be a client component; it receives the error and a reset() callback that re-renders the segment (try again). not-found.tsx renders when notFound() is called or no route matches, with the root one catching global 404s.",
    when: "Add error.tsx to segments with risky data rendering; not-found.tsx wherever dynamic params can miss. Always offer reset — a dead end is a design failure.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "Granularity", detail: "Each segment can own its boundary: a failed sidebar doesn't kill the main content." },
      { name: "reset()", detail: "Re-renders the segment — a one-click recovery for transient fetch failures." },
      { name: "notFound()", detail: "Call it in server components when a record is missing; the nearest not-found.tsx renders." },
    ],
    code: `// @jsx
// app/dashboard/error.tsx  (must be client)
// "use client"
export default function Error({ error, reset }) {
  return (
    <div>
      <p>Something broke: {error.message}</p>
      <button onClick={() => reset()}>Try again</button>
    </div>
  );
}

// app/blog/[slug]/page.tsx
// const post = await db.post(params.slug);
// if (!post) notFound(); // renders not-found.tsx`,
    steps: ["Render throws", "Boundary catches", "error.tsx shown", "reset() retries segment"],
  },
  {
    id: "nextjs-metadata",
    cat: "nextjs",
    title: "Metadata & SEO",
    one: "Static or generated metadata exports produce correct meta tags per route.",
    why: "Hand-writing <meta> tags per page drifts and misses Open Graph details. Next.js turns metadata into a typed export, guaranteeing consistent, correct tags everywhere — including per-product social cards.",
    how: "Export a metadata object for static values, or generateMetadata(params) for dynamic ones. Next.js merges metadata down the tree (child overrides parent) and renders title, description, OG, Twitter, favicon, and canonical tags.",
    when: "Set app-wide defaults in the root layout; generate per-record metadata in dynamic routes. Use generateMetadata when values depend on fetched data.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "Static export", detail: "export const metadata = { title, description } — merged with parent layout metadata." },
      { name: "generateMetadata", detail: "Async function receiving params; fetch the record once — requests are memoized with the page's." },
      { name: "OG images", detail: "ImageResponse builds dynamic social cards at request time — no design tool round-trips." },
    ],
    code: `// @jsx
// app/blog/[slug]/page.tsx
export async function generateMetadata({ params }) {
  const post = await db.post(params.slug);
  return {
    title: post.title,
    description: post.excerpt,
    openGraph: { images: [post.cover] },
  };
}

// app/layout.tsx — defaults children inherit
// export const metadata = { title: { default: "Atlas", template: "%s · Atlas" } };`,
    steps: ["Route renders", "Metadata resolved", "Parent merged with child", "Tags emitted to head"],
  },
  {
    id: "nextjs-image",
    cat: "nextjs",
    title: "Image Optimization (next/image)",
    one: "Serves right-sized, lazy-loaded, modern-format images automatically.",
    why: "Raw <img> tags ship desktop-sized JPEGs to phones and cause layout shift. next/image resizes per device, converts to AVIF/WebP, lazy-loads, and reserves space — Core Web Vitals by default.",
    how: "Swap <img> for <Image>. Give width/height (or fill for fluid). Next.js serves an optimized variant via its image optimizer, with priority controlling eager loading for above-the-fold heroes.",
    when: "Use for every content image. Remote hosts must be whitelisted in images.remotePatterns; art-directed tiny graphics can stay as <img> if you reserve space yourself.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "No layout shift", detail: "Dimensions are known up front, so the browser reserves space — CLS stays near zero." },
      { name: "priority", detail: "Set on the LCP hero image to preload it; everything else lazy-loads by default." },
      { name: "Remote patterns", detail: "External image domains must be declared — the optimizer refuses unknown hosts." },
    ],
    code: `// @jsx
import Image from "next/image";

export function Cover() {
  return (
    <Image
      src="/hero.jpg"
      alt="Atlas cover"
      width={1200}
      height={630}
      priority // above-the-fold: preload
    />
  );
}

// Fluid: fill the parent box instead
// <Image src="/bg.jpg" alt="" fill />`,
    steps: ["Image requested", "Optimizer sizes it", "Modern format served", "Lazy-loaded below fold"],
  },
  {
    id: "nextjs-font",
    cat: "nextjs",
    title: "Font Optimization (next/font)",
    one: "Self-hosts Google fonts at build time, eliminating render-blocking requests.",
    why: "Google Fonts via <link> adds a third-party request on every load and causes layout shift when the font swaps in. next/font downloads and self-hosts fonts at build time with zero layout shift.",
    how: "Import a font function, instantiate with subsets and a CSS variable, and use the variable in your styles. The font files ship with your deploy; the fallback metric-matches so text size doesn't jump.",
    when: "Use for all web fonts — custom and Google. Pair the CSS variable with Tailwind's fontFamily config so utilities pick it up.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "Build-time hosting", detail: "Files are fetched once at build and served from your origin — no Google request at runtime." },
      { name: "CSS variables", detail: "Inter({ variable: '--font-inter' }) exposes the family to CSS/Tailwind without class names." },
      { name: "display: swap built in", detail: "Text renders immediately with a size-matched fallback; no invisible-text period." },
    ],
    code: `// app/layout.tsx
import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter", // usable in CSS/Tailwind
});

// <html className={inter.variable}>
// <body className="font-sans">  (Tailwind: sans = var(--font-inter))`,
    steps: ["Font declared", "Downloaded at build", "Self-hosted files", "Zero external requests"],
  },
  {
    id: "nextjs-styling",
    cat: "nextjs",
    title: "Styling (CSS Modules & Tailwind)",
    one: "Scoped CSS Modules plus utility frameworks, imported directly in components.",
    why: "Global CSS leaks across a growing app. Next.js supports styling systems natively: CSS Modules scope by filename, Tailwind utilities keep styles colocated, and both code-split with the components that use them.",
    how: "Import styles from styles.module.css and reference classes as properties — the build hashes names so collisions are impossible. Global styles load once in the root layout. Tailwind works out of the box via PostCSS.",
    when: "Pick one primary system per app (utilities or modules) and stay consistent. Reach for modules when utility soup hurts readability of complex, stateful component styles.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "CSS Modules", detail: "styles.card compiles to a hashed class — scoping enforced by the bundler, zero runtime." },
      { name: "Global CSS", detail: "Only the root layout should import globals; components import their own modules." },
      { name: "Tailwind in RSC", detail: "Utilities are build-time extracted — they work perfectly inside server components." },
    ],
    code: `// @jsx
// components/Card.module.css
//   .card { border: 1px solid #eee; }
import styles from "./Card.module.css";

export function Card({ children }) {
  // hashed at build: Card_card__x7f2a
  return { className: styles.card, children };
}

// Tailwind alternative, colocated:
// <div className="rounded border p-4">{children}</div>`,
    steps: ["Import styles", "Classes scoped/hashed", "Bundled per component", "No global leaks"],
  },
  {
    id: "nextjs-caching",
    cat: "nextjs",
    title: "Caching Layers",
    one: "Four caches — memoization, Data Cache, Full Route Cache, Router Cache.",
    why: "Fast apps need caching at several levels, but an undocumented cache is a stale-data bug factory. Next.js names its layers so you can reason about what is cached where, and for how long.",
    how: "Request Memoization dedupes fetches within one render. The Data Cache persists fetch results across requests. The Full Route Cache stores rendered routes (opted out by dynamic data). The Router Cache keeps visited route payloads in the browser.",
    when: "Cache reads that tolerate staleness (force-cache, revalidate); mark live data no-store. Invalidate with revalidatePath/revalidateTag after mutations; remember Router Cache freshness is client-side.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "Request Memoization", detail: "Same fetch during one render = one network call; free dedupe across layout + page + components." },
      { name: "Data Cache", detail: "fetch cache spanning requests and deploys; revalidate: 60 or tags for targeted busting." },
      { name: "Full Route Cache", detail: "Static rendering caches the whole route HTML/RSC payload; any dynamic read opts that route out." },
      { name: "Router Cache", detail: "Client-side store of visited/prefetched segments — makes back/forward instant, with its own staleness TTLs." },
    ],
    code: `// Layer by layer on one fetch:
await fetch(url, {
  next: {
    revalidate: 60, // Data Cache: fresh for 60s
    tags: ["posts"], // opt into revalidateTag("posts")
  },
});
// Request Memoization: deduped within this render (always on)
// Full Route Cache: route stays static if data is cacheable
// Router Cache: browser keeps visited payloads for instant nav`,
    steps: ["Fetch called", "Memoized in render", "Data Cache persists", "Route cache serves", "Tag revalidates"],
  },
  {
    id: "nextjs-static-dynamic",
    cat: "nextjs",
    title: "Static vs Dynamic Rendering",
    one: "Routes render at build time by default; dynamic data opts them per-request.",
    why: "Prerendered HTML from a CDN is fast and cheap; per-request rendering is fresh but slower. Next.js picks per route automatically based on whether the route touches dynamic data.",
    how: "A route is static when no dynamic API runs — it's prerendered and cached. Reading cookies(), headers(), searchParams, or uncached fetch makes it dynamic, rendering per request at visit time.",
    when: "Keep marketing and catalog pages static; let dashboards and personalized views go dynamic (or stream dynamic islands into static shells via Suspense).",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "Auto detection", detail: "Any dynamic function usage flips the route; no per-page config to forget." },
      { name: "Hybrid routes", detail: "Static shell + <Suspense> around a dynamic read = fast first paint with fresh islands." },
      { name: "Build output", detail: "`next build` prints each route's strategy (○ Static / ƒ Dynamic) — read it after every build." },
    ],
    code: `// @jsx
import { cookies } from "next/headers";

// STATIC: no dynamic APIs — prerendered at build
export function Docs() {
  return { content: "..." };
}

// DYNAMIC: cookies() opts this route per-request
export default async function Account() {
  const theme = (await cookies()).get("theme");
  return { theme };
}`,
    steps: ["Build analyzes route", "No dynamic APIs: prerender", "Dynamic read found", "Per-request render"],
  },
  {
    id: "nextjs-isr",
    cat: "nextjs",
    title: "Incremental Static Regeneration",
    one: "Static pages that rebuild in the background after a revalidate interval.",
    why: "Pure static goes stale; fully dynamic pays rendering cost on every visit. ISR gives static speed with bounded freshness — the first visitor after expiry gets fresh content while others read the cached page.",
    how: "Set revalidate: 60 (export or per-fetch). Serving checks age: fresh pages serve instantly; expired pages serve stale immediately while one regeneration runs, then swap — stale-while-revalidate for pages.",
    when: "Use for product pages, blogs, docs — anything where minutes-old content is fine. Combine with on-demand revalidateTag for editor-triggered instant rebuilds.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "Time-based", detail: "export const revalidate = 60 sets the route's floor; per-fetch next.revalidate can be tighter." },
      { name: "On-demand", detail: "revalidatePath/revalidateTag (in actions or route handlers) rebuilds immediately after a CMS save." },
      { name: "Stale-while-revalidate", detail: "Expired content serves instantly while one background render refreshes — no thundering herd." },
    ],
    code: `// app/products/page.tsx
export const revalidate = 60; // rebuild at most every 60s

export default async function Products() {
  const items = await db.products(); // cached via ISR window
  return { items }; // render (simplified JSX)
}

// Instant, editor-triggered refresh:
// revalidateTag("products") in a Server Action`,
    steps: ["Page cached", "Interval expires", "Stale served instantly", "Background rebuild", "Fresh swap"],
  },
  {
    id: "nextjs-middleware",
    cat: "nextjs",
    title: "Middleware",
    one: "middleware.ts intercepts every request before routes, at the edge.",
    why: "Auth gates, A/B buckets, and locale redirects must run before rendering, once, for every path. Middleware gives you one file that inspects and rewrites or redirects requests globally.",
    how: "Export a middleware(request) function from middleware.ts (project root or src/). Return NextResponse.redirect/rewrite/next(). It runs on the edge runtime — fast, no Node APIs, no database by default.",
    when: "Use for auth redirects, header injection, and experiments. Keep it light — it runs on every matched request; use config.matcher to scope the blast radius.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "Edge runtime", detail: "Sub-millisecond cold starts worldwide; Web APIs only — no fs, no heavy Node libraries." },
      { name: "matcher", detail: "export const config = { matcher: '/dashboard/:path*' } skips middleware everywhere else." },
      { name: "Rewrites vs redirects", detail: "Rewrites proxy the URL silently; redirects change the browser URL — auth gates usually rewrite." },
    ],
    code: `// middleware.ts (project root)
import { NextResponse } from "next/server";

export function middleware(request) {
  const session = request.cookies.get("session");
  if (!session) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/dashboard/:path*", // scope: dashboard only
};`,
    steps: ["Request hits edge", "Middleware runs first", "Redirect/rewrite/next", "Route renders after"],
  },
  {
    id: "nextjs-env-vars",
    cat: "nextjs",
    title: "Environment Variables",
    one: "Server secrets and NEXT_PUBLIC_ browser values loaded per environment.",
    why: "Config belongs outside code (databases URLs, API keys). Next.js loads .env files per environment and — critically — only exposes variables you explicitly prefix for the browser.",
    how: "Define values in .env.local / .env.production; access via process.env. Variables prefixed NEXT_PUBLIC_ are inlined into the client bundle at build; unprefixed ones stay server-only and throw if read client-side.",
    when: "Use for every credential and per-environment URL. Remember NEXT_PUBLIC_ values are visible to users — never prefix secrets, even 'harmless' ones.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "Load order", detail: "process.env wins over .env.production over .env.local over .env — deploy platforms inject directly." },
      { name: "Build-time inlining", detail: "NEXT_PUBLIC_ values are string-replaced at build; changing them means rebuilding, not restarting." },
      { name: "Server-only guard", detail: "Unprefixed vars are undefined in client bundles — an accidental client read fails fast instead of leaking." },
    ],
    code: `// .env.local
//   DATABASE_URL=postgres://...   (server-only)
//   NEXT_PUBLIC_API_BASE=/api     (inlined to browser)

// Server Component / Route Handler — secrets OK
export async function getConfig() {
  return { db: process.env.DATABASE_URL }; // never shipped
}

// Anywhere (client included):
// const base = process.env.NEXT_PUBLIC_API_BASE;`,
    steps: ["Define in .env", "Server reads freely", "NEXT_PUBLIC_ inlined", "Secrets never exposed"],
  },
  {
    id: "nextjs-rewrites",
    cat: "nextjs",
    title: "Redirects & Rewrites",
    one: "next.config maps old or pretty URLs to real destinations before routing.",
    why: "Renamed pages break bookmarks, and clean marketing URLs rarely match internal paths. Redirects send users to the new address; rewrites serve different content without changing the visible URL.",
    how: "Declare arrays in next.config.mjs: redirects() maps source -> destination with permanent (308) or temporary (307) status; rewrites() proxies matched requests to another path or external URL. Middleware can do the same dynamically.",
    when: "Redirect for moved content (preserve SEO); rewrite for pretty URLs and API proxying. Static config for known mappings; middleware for per-request logic.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "307 vs 308", detail: "308 permanent preserves the HTTP method across the redirect; 307 may switch POST to GET — choose deliberately." },
      { name: "Rewrite proxying", detail: "Rewrites can target external origins — a self-hosted API gateway without exposing it." },
      { name: "Order matters", detail: "Redirects run before rewrites; first match wins inside each array — put specific rules first." },
    ],
    code: `// next.config.mjs
const nextConfig = {
  async redirects() {
    return [
      {
        source: "/old-guide",
        destination: "/guides/new",
        permanent: true, // 308: SEO-safe, keeps method
      },
    ];
  },
  async rewrites() {
    return [
      {
        // URL stays /api/status; content proxied
        source: "/api/status",
        destination: "https://status.internal/ping",
      },
    ];
  },
};`,
    steps: ["Request arrives", "Redirect checked first", "Rewrites proxy next", "Route renders unseen path"],
  },
  {
    id: "nextjs-parallel-intercepting",
    cat: "nextjs",
    title: "Parallel & Intercepting Routes",
    one: "Render multiple slots at once, or hijack a navigation into a modal view.",
    why: "Dashboards need independent loading panels; social apps show a post modal over the feed while keeping the URL deep-linkable. Plain nesting can't express either — slots and interception can.",
    how: "Parallel routes: @folder slots rendered as props into the parent layout, each with its own loading/error state. Intercepting routes: (.)folder matches same-level links, (..) parent-level — a /photo/123 link renders its intercepted view (modal) instead of full navigation.",
    when: "Use parallel slots for role-based panels and independent streams. Use interception for detail-over-list modals that must still work as standalone pages on refresh.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "@slots", detail: "app/@analytics and app/@team render as props (analytics, team) in layout.tsx — independent boundaries." },
      { name: "(.) conventions", detail: "(.) same level, (..) parent, (..)(..) grandparent, (...) root — intercept the link, not the URL." },
      { name: "Refresh = real page", detail: "Direct loads and refreshes render the full route; only soft navigation shows the intercepted modal." },
    ],
    code: `// @jsx
// app/dashboard/layout.tsx — parallel slots as props
export default function Layout({ children, analytics, team }) {
  return (
    <div>
      {children}
      {analytics}  {/* app/dashboard/@analytics/page.tsx */}
      {team}       {/* app/dashboard/@team/page.tsx */}
    </div>
  );
}

// app/feed/(.)photo/[id]/page.tsx
// -> soft-nav to /photo/123 renders as modal over feed`,
    steps: ["Layout defines slots", "Slots load independently", "Link intercepted", "Modal over feed", "Refresh shows full page"],
  },
  {
    id: "nextjs-link-nav",
    cat: "nextjs",
    title: "Link & Prefetching",
    one: "Client-side navigation that prefetches route payloads before you click.",
    why: "Full page loads for every navigation feel like 2010. <Link> swaps the page client-side and prefetches destinations in view — clicks feel instant because the content already arrived.",
    how: "Use <Link href> for internal navigation; Next.js fetches the route's RSC payload in the background (static routes eagerly in view, dynamic on hover for the default profile). router.push/replace handles programmatic moves; usePathname powers active states.",
    when: "Use <Link> for every internal link — including inside maps and lists. Leave prefetch disabled (prefetch={false}) for rarely-visited or heavy routes to save bandwidth.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "Prefetch profiles", detail: "Static routes: full payload prefetched in viewport; dynamic: shared layout only, or null until hover." },
      { name: "router methods", detail: "useRouter().push/replace/refresh/back — refresh re-fetches the current route server-side." },
      { name: "Active link", detail: "usePathname() + aria-current is the standard pattern for nav highlighting." },
    ],
    code: `// @jsx
import Link from "next/link";

export function Nav() {
  return (
    <nav>
      <Link href="/">Home</Link>
      <Link href="/blog">Blog</Link>
      {/* heavy admin route: no prefetch */}
      <Link href="/admin" prefetch={false}>Admin</Link>
    </nav>
  );
}

// Programmatic:
// const router = useRouter(); router.push("/blog");`,
    steps: ["Link enters viewport", "Payload prefetched", "Click: no page reload", "Instant client swap"],
  },
  {
    id: "nextjs-rendering-strategies",
    cat: "nextjs",
    title: "Choosing a Rendering Strategy",
    one: "Per-route decision: static, ISR, dynamic SSR, or client-side — pick by freshness.",
    why: "One rendering mode per app wastes either speed or freshness. Next.js lets each route — even each component — declare its own strategy, matching cost to how stale the data may be.",
    how: "Ask one question per route: how stale may this content be? Days -> static build. Seconds/minutes -> ISR (revalidate). Always-live/personalized -> dynamic no-store. User-only after login -> client fetch or streamed islands.",
    when: "Audit with `next build`'s strategy table. Mix freely: static marketing shell + ISR catalog + dynamic account panel is a normal production app.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "Static (build)", detail: "Fastest and cheapest; content changes only on redeploy — marketing, docs, changelogs." },
      { name: "ISR", detail: "Static speed with TTL freshness; stale-while-revalidate hides rebuild cost." },
      { name: "Dynamic (no-store)", detail: "Per-request render for personalization; stream via Suspense to protect TTFB." },
      { name: "Client-side", detail: "After-login widgets fetching APIs directly; ships JS, but only runs for viewers who need it." },
    ],
    code: `// One app, four strategies — per route:
// app/pricing/page.tsx        static (build once)
//   export const revalidate = 3600
// app/products/page.tsx       ISR (fresh ≤60s)
// app/account/page.tsx        dynamic
//   await fetch(url, { cache: "no-store" })
// app/admin/insights/page.tsx client-side fetch
//   (charts render after auth in the browser)`,
    steps: ["Classify freshness", "Pick per route", "Static where possible", "Stream dynamic parts"],
  },
  {
    id: "nextjs-database",
    cat: "nextjs",
    title: "Connecting a Database",
    one: "Server components and actions query databases directly, secrets stay server-side.",
    why: "A separate API layer for your own UI adds latency and boilerplate. Server components can import an ORM and await queries — no HTTP hop, no secrets in the browser, no hand-rolled fetch caching.",
    how: "Initialize the client once (a module singleton survives dev hot-reload), import it into server components, Server Actions, and Route Handlers. Never import the db module from a 'use client' file — the import graph keeps it server-only.",
    when: "Query directly for first-party reads and mutations. Expose Route Handlers only for external consumers, webhooks, or third-party callbacks.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "Singleton pattern", detail: "Cache the client on globalThis in dev so hot reloads don't exhaust connection pools." },
      { name: "Server-only imports", detail: "The 'server-only' package makes accidental client imports a build error, not a leaked secret." },
      { name: "Pooling", detail: "Serverless instances each hold pool connections — use pooled proxies (Prisma Accelerate, pgBouncer) at scale." },
    ],
    code: `// lib/db.ts — singleton across hot reloads
const { PrismaClient } = require("@prisma/client");

const db = globalThis.__db || new PrismaClient();
if (process.env.NODE_ENV === "development") {
  globalThis.__db = db;
}

// app/users/page.tsx (server component)
// const users = await db.user.findMany();  -- direct query`,
    steps: ["Module singleton", "Server component imports", "Await ORM query", "Secrets stay server-side"],
  },
  {
    id: "nextjs-deployment",
    cat: "nextjs",
    title: "Deployment & Output Modes",
    one: "Deploy to Vercel, any Node host, or export a fully static site.",
    why: "Teams have different constraints: managed platform, self-hosted cluster, or a plain CDN. next build produces the right artifact per target — full server, standalone Node server, or static export.",
    how: "Default build targets Node hosting (or Vercel zero-config). output: 'standalone' emits a minimal server.js for Docker. output: 'export' prerenders every route to static files — disabling server-only features (actions, middleware, ISR).",
    when: "Vercel for zero-ops App Router features; standalone for Docker/K8s; static export for CDN-only content sites exactly like this Atlas. Choose before adoption: export gives up server features by design.",
    ref: "Next.js Documentation",
    subtopics: [
      { name: "Static export", detail: "output: 'export' writes out/ for any static host — no server runtime, no dynamic APIs." },
      { name: "Standalone", detail: "Copies only needed node_modules into .next/standalone — small Docker images, self-hosted Node." },
      { name: "Feature trade-offs", detail: "Static export excludes Server Actions, middleware, ISR, route handlers — plan rendering strategies accordingly." },
    ],
    code: `// next.config.mjs — three deployment modes
const nextConfig = {
  // 1) Default: full server (Vercel, Node host)

  // 2) Docker-friendly minimal server:
  // output: "standalone",  // node .next/standalone/server.js

  // 3) Pure static site (this project):
  output: "export", // npm run build -> out/
};`,
    steps: ["Pick deploy target", "Set output mode", "next build", "Serve artifact"],
  },
];
