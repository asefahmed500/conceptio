#!/usr/bin/env node
"use strict";
/*
 * content-audit.cjs — deep content QA for data/concepts/*.ts (Backend Atlas).
 * Zero new dependencies: Node stdlib only (fs, os, path, vm).
 *
 * Checks:
 *  - loads the 9 TS data files as CommonJS (strips `import type` + `: Concept[]`,
 *    rewrites `export const X` -> `module.exports.X`, writes a temp .cjs, requires it)
 *  - global id uniqueness, cat whitelist, id-prefix === cat
 *  - steps: array of 3-5 non-empty strings
 *  - subtopics: 3-5 items, each with non-empty name/detail
 *  - why/how/when/one/title/ref: non-empty strings
 *  - one: <= 20 words
 *  - code: vm.Script syntax check (retry wrapped as async IIFE for top-level await)
 *  - encoding: no U+FFFD anywhere (data files + prd.md)
 *  - PRD appendix cross-check: title / one-liner / ref exact match, by category + order,
 *    25 rows per category
 *
 * Exit 0 = PASS, exit 1 = FAIL.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const CATS = ["core", "web", "db", "auth", "arch", "cache", "scale", "ops", "sysd"];
const NEW_CATS = ["react", "nextjs"]; // frontend extension: not in prd.md, 25 each
const HEADING_TO_CAT = {
  "Core Programming": "core",
  "Web Fundamentals": "web",
  "Databases": "db",
  "Auth & Security": "auth",
  "Server Architecture": "arch",
  "Caching": "cache",
  "Scalability & Performance": "scale",
  "DevOps & Deployment": "ops",
  "System Design": "sysd",
};
const CAT_FILES = [...CATS, ...NEW_CATS];

const problems = []; // { id, check, detail }
function flag(id, check, detail) {
  problems.push({ id, check, detail });
}

// ---------------------------------------------------------------- load data
const pending = [];
let combined = "";
let sawFFFD = false;
for (const cat of CAT_FILES) {
  const file = path.join("data", "concepts", cat + ".ts");
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8").trim() === "") {
    pending.push(cat);
    continue;
  }
  const src = fs.readFileSync(file, "utf8");
  if (src.includes("\uFFFD")) {
    sawFFFD = true;
    flag(cat + " (file)", "encoding", "contains U+FFFD replacement character");
  }
  let js = src.replace(/^import type .*$/m, "");
  js = js.replace(/export const (\w+)\s*:\s*Concept\[\]\s*=/, "module.exports.$1 =");
  if (!/module\.exports\.\w+\s*=/.test(js)) {
    flag(cat + " (file)", "load", "could not rewrite export declaration");
  }
  combined += js + "\n";
}
const prdText = fs.readFileSync("prd.md", "utf8");
if (prdText.includes("\uFFFD")) {
  sawFFFD = true;
  flag("prd.md", "encoding", "contains U+FFFD replacement character");
}

const tmpFile = path.join(os.tmpdir(), "content-audit-" + process.pid + "-" + Date.now() + ".cjs");
fs.writeFileSync(tmpFile, combined, "utf8");
let data;
try {
  data = require(tmpFile);
} catch (e) {
  console.error("FATAL: could not evaluate data files as JS:", e.message);
  try { fs.unlinkSync(tmpFile); } catch (_) {}
  process.exit(1);
}
try { fs.unlinkSync(tmpFile); } catch (_) {}

const concepts = []; // { cat, c }
for (const cat of CAT_FILES) {
  if (pending.includes(cat)) continue;
  const arr = data[cat.toUpperCase()];
  if (!Array.isArray(arr)) {
    flag(cat + " (file)", "load", "exported value is not an array");
    continue;
  }
  for (const c of arr) concepts.push({ cat, c });
}
const expectTotal = 25 * (CAT_FILES.length - pending.length);

// ---------------------------------------------------------- field-level checks
const seenIds = new Map(); // id -> "cat/index"

function checkStrings(id, c) {
  for (const k of ["title", "one", "why", "how", "when", "ref"]) {
    const v = c[k];
    if (typeof v !== "string" || v.trim() === "") {
      flag(id, "field:" + k, "missing or empty (got " + (v === undefined ? "undefined" : typeof v) + ")");
    }
  }
}

for (let i = 0; i < concepts.length; i++) {
  const { cat, c } = concepts[i];
  const label = cat + "/" + (i + 1);
  const id = typeof c.id === "string" && c.id.trim() !== "" ? c.id : label;
  if (typeof c.id !== "string" || c.id.trim() === "") {
    flag(label, "field:id", "missing or empty id");
  } else if (seenIds.has(id)) {
    flag(id, "id:unique", "duplicate id (also at " + seenIds.get(id) + ")");
  } else {
    seenIds.set(id, label);
    const allowed = CAT_FILES.includes(c.cat);
    if (!allowed) flag(id, "cat:whitelist", "cat is " + JSON.stringify(c.cat));
    const prefix = id.split("-")[0];
    if (prefix !== c.cat) flag(id, "id:prefix", "id prefix " + JSON.stringify(prefix) + " != cat " + JSON.stringify(c.cat));
  }

  // steps
  if (!Array.isArray(c.steps)) {
    flag(id, "steps", "not an array");
  } else {
    if (c.steps.length < 3 || c.steps.length > 5) {
      flag(id, "steps:count", c.steps.length + " steps (need 3-5)");
    }
    c.steps.forEach((s, j) => {
      if (typeof s !== "string" || s.trim() === "") flag(id, "steps:empty", "step " + (j + 1) + " is empty/not a string");
    });
  }

  // subtopics
  if (!Array.isArray(c.subtopics)) {
    flag(id, "subtopics", "not an array");
  } else {
    if (c.subtopics.length < 3 || c.subtopics.length > 5) {
      flag(id, "subtopics:count", c.subtopics.length + " subtopics (need 3-5)");
    }
    c.subtopics.forEach((s, j) => {
      if (!s || typeof s !== "object") {
        flag(id, "subtopics:item", "subtopic " + (j + 1) + " is not an object");
      } else {
        if (typeof s.name !== "string" || s.name.trim() === "") flag(id, "subtopics:name", "subtopic " + (j + 1) + " name empty");
        if (typeof s.detail !== "string" || s.detail.trim() === "") flag(id, "subtopics:detail", "subtopic " + (j + 1) + " (" + (s.name || "?") + ") detail empty");
      }
    });
  }

  checkStrings(id, c);

  // one-liner word count (<= 20 words)
  if (typeof c.one === "string" && c.one.trim() !== "") {
    const words = c.one.trim().split(/\s+/).length;
    if (words > 20) flag(id, "one:words", words + " words (> 20): " + JSON.stringify(c.one));
  }

  // code syntax — three tiers:
  //   1. plain snippet -> vm.Script (CommonJS), async-wrap retry, then ESM via typescript
  //   2. "// @jsx" first line -> TSX syntax check via typescript.transpileModule
  //   (typescript comes from the repo's own node_modules — no new dependency)
  if (typeof c.code !== "string" || c.code.trim() === "") {
    flag(id, "code", "missing or empty");
  } else {
    const isJsx = /^\/\/\s*@jsx\b/.test(c.code.trimStart());
    let err = null;
    if (isJsx) {
      try {
        const ts = require("typescript");
        const out = ts.transpileModule(c.code, {
          compilerOptions: {
            jsx: ts.JsxEmit.React,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
          },
          reportDiagnostics: true,
        });
        const diag = (out.diagnostics || [])[0];
        if (diag) {
          err = "TSX syntax: " + ts.flattenDiagnosticMessageText(diag.messageText, " ");
        }
      } catch (e) {
        err = "TSX check failed: " + (e && e.message);
      }
    } else {
      try {
        new vm.Script(c.code);
      } catch (e1) {
        try {
          new vm.Script("(async()=>{\n" + c.code + "\n})()");
        } catch (e2) {
          try {
            const ts = require("typescript");
            const out = ts.transpileModule(c.code, {
              compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2020,
              },
              reportDiagnostics: true,
            });
            const diag = (out.diagnostics || [])[0];
            if (diag) {
              err = "ESM syntax: " + ts.flattenDiagnosticMessageText(diag.messageText, " ");
            }
          } catch (e3) {
            err = (e2 && e2.name === "SyntaxError" ? "SyntaxError: " : "") + ((e2 && e2.message) || String(e2));
          }
        }
      }
    }
    if (err) flag(id, "code:syntax", err);
  }
}

// ------------------------------------------------------------ PRD cross-check
const prdRows = {}; // cat -> [{ n, title, one, ref }]
let currentCat = null;
for (const line of prdText.split(/\r?\n/)) {
  const h = line.match(/^### (.+?) \((\d+)\)\s*$/);
  if (h) {
    currentCat = HEADING_TO_CAT[h[1]] || null;
    if (currentCat) prdRows[currentCat] = [];
    continue;
  }
  if (!currentCat) continue;
  const m = line.match(/^\|\s*(\d+)\s*\|(.*?)\|(.*?)\|(.*?)\|\s*$/);
  if (m) {
    prdRows[currentCat].push({ n: +m[1], title: m[2].trim(), one: m[3].trim(), ref: m[4].trim() });
  }
}

let prdRowsTotal = 0;
for (const cat of CATS) {
  const rows = prdRows[cat] || [];
  prdRowsTotal += rows.length;
  if (rows.length !== 25) flag(cat + " (prd)", "prd:count", "PRD appendix has " + rows.length + " rows for " + cat);
  const arr = data[cat.toUpperCase()];
  if (!Array.isArray(arr)) continue;
  if (arr.length !== 25) flag(cat + " (data)", "count", "data file has " + arr.length + " concepts (need 25)");
  const n = Math.min(rows.length, arr.length);
  for (let i = 0; i < n; i++) {
    const c = arr[i];
    const r = rows[i];
    const id = c && c.id;
    if (r.n !== i + 1) flag(id || cat + "/" + (i + 1), "prd:rownum", "PRD row #" + r.n + " at position " + (i + 1));
    if (c.title !== r.title) {
      flag(id, "prd:title", "data " + JSON.stringify(c.title) + " != prd " + JSON.stringify(r.title));
    }
    if (c.one !== r.one) {
      flag(id, "prd:one", "data " + JSON.stringify(c.one) + " != prd " + JSON.stringify(r.one));
    }
    if (c.ref !== r.ref) {
      flag(id, "prd:ref", "data " + JSON.stringify(c.ref) + " != prd " + JSON.stringify(r.ref));
    }
  }
}
if (prdRowsTotal !== 225) flag("prd.md", "prd:total", "parsed " + prdRowsTotal + " appendix rows (expected 225)");

// new (frontend) categories: not in prd.md — 25 concepts each, no PRD compare
for (const cat of NEW_CATS) {
  if (pending.includes(cat)) continue;
  const arr = data[cat.toUpperCase()];
  if (!Array.isArray(arr) || arr.length !== 25) {
    flag(cat + " (data)", "count", "data file has " + (arr && arr.length) + " concepts (need 25)");
  }
}

// -------------------------------------------------------------------- summary
const byCheck = {};
for (const p of problems) byCheck[p.check] = (byCheck[p.check] || 0) + 1;

console.log("=== content-audit ===");
console.log("concepts loaded: " + concepts.length + " (expect " + expectTotal + ")");
console.log("prd appendix rows parsed: " + prdRowsTotal + " (expect 225, legacy categories)");
if (pending.length) console.log("PENDING (missing/empty, non-fatal): " + pending.join(", "));
console.log("");
if (Object.keys(byCheck).length === 0) {
  console.log("problems by check: NONE");
} else {
  console.log("problems by check:");
  for (const k of Object.keys(byCheck).sort()) console.log("  " + k + ": " + byCheck[k]);
}
console.log("");
if (problems.length) {
  console.log("concept ids with problems:");
  const seen = new Set();
  for (const p of problems) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    console.log("  " + p.id);
  }
  console.log("");
  console.log("detail:");
  for (const p of problems) console.log("  [" + p.id + "] " + p.check + " — " + p.detail);
}

const strict = process.env.STRICT === "1";
const allPresent = pending.length === 0;
const pass = problems.length === 0 && concepts.length === expectTotal && prdRowsTotal === 225 && !sawFFFD
  && (!strict || allPresent);
console.log("");
console.log(pass ? "PASS: all content checks clean" : "FAIL: " + problems.length + " problem(s) found");
process.exit(pass ? 0 : 1);
