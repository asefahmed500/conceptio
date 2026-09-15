# Backend Atlas

A visual, searchable map of 225 backend engineering concepts across 9 categories — each with a why/how/when breakdown, subtopics, a Node.js code example, and an animated flow diagram. Built with Next.js 14 (static export), Tailwind CSS, and React Flow. `prd.md` is the product spec.

## Run it

```bash
npm install
npm run dev        # dev server on http://localhost:3000
npm run build      # static export to out/
npm run serve      # serve out/ locally (PORT env var to change the port)
npm test           # content validation + audit
npm run typecheck
```

## What's inside

- `app/page.tsx` — ties it together: category filter, search across all 225, and the detail panel state.
- `app/layout.tsx` — Inter font and site metadata.
- `components/Sidebar.tsx` — the 9-category navigation rail.
- `components/ConceptCard.tsx` — grid card shown per concept, with its source cited.
- `components/ConceptDetail.tsx` — full detail view: why/how/when, subtopics, code example.
- `components/FlowDiagram.tsx` — renders each concept's steps as an animated React Flow chain (snake-wraps into rows for longer sequences).
- `components/CodeBlock.tsx` — renders the Node.js code example.
- `data/types.ts` — the `Concept` type.
- `data/concepts.ts` — aggregator: exports `CATEGORIES` and `CONCEPTS`, merged from the per-category files.
- `data/concepts/{core,web,db,auth,arch,cache,scale,ops,sysd}.ts` — 25 rich concepts per category (225 total).

## Extending

Add a new concept object to the relevant category file in `data/concepts/`. The `Concept` shape (see `data/types.ts`):

```ts
{
  id: string;        // unique, prefixed by category (e.g. "db-indexing")
  cat: string;       // category id ("core", "web", ...)
  title: string;
  one: string;       // plain-English one-liner
  why: string;       // what problem it solves
  how: string;       // the mechanism
  when: string;      // when to use it (and when not to)
  ref: string;       // named source (docs, book, standard)
  subtopics: { name, detail }[]; // 3-5 subtopics
  code: string;      // real-world Node.js example
  steps: string[];   // 3-5 steps drawn as the flow diagram
}
```

No other file needs to change — the grid, search, detail panel, and diagram all read from the aggregated data. Run `npm test` to validate content completeness (25 concepts × all fields per category).

## Deployment

`next.config.mjs` sets `output: "export"`, so `npm run build` produces a fully static site in `out/` — deploy that directory to any static host. `public/_headers` ships security headers and is honored by Netlify and Cloudflare Pages; on Vercel, configure the same headers in `vercel.json` if desired. No Content-Security-Policy is set: React Flow relies on inline style attributes, which a strict CSP would block without careful tuning.
