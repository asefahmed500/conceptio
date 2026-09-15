"use client";

import { useMemo, useState } from "react";

const KEYWORDS =
  "await|async|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|from|function|get|if|import|in|instanceof|let|new|of|return|set|static|super|switch|this|throw|try|typeof|var|void|while|yield";
const LITERALS = "true|false|null|undefined|NaN|Infinity";

const TOKEN_RE = new RegExp(
  [
    "(\\/\\/[^\\n]*)",
    "(\\/\\*[\\s\\S]*?\\*\\/)",
    "('(?:[^'\\\\\\n]|\\\\.)*'|\"(?:[^\"\\\\\\n]|\\\\.)*\"|`(?:[^`\\\\]|\\\\.)*`)",
    `\\b(${KEYWORDS})\\b`,
    `\\b(${LITERALS})\\b`,
    "\\b(0x[\\da-fA-F]+|\\d[\\d_]*(?:\\.\\d+)?)\\b",
    "([A-Za-z_$][\\w$]*)(?=\\s*\\()",
  ].join("|"),
  "g"
);

const TOKEN_STYLE: Record<number, string> = {
  1: "text-[#7d786b] italic",
  2: "text-[#7d786b] italic",
  3: "text-[#d9b06c]",
  4: "text-[#8ea7ea]",
  5: "text-[#8ea7ea]",
  6: "text-[#e0915f]",
  7: "text-[#9fc6de]",
};

type Span = { text: string; cls?: string };

function tokenize(code: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(code))) {
    if (m.index > last) spans.push({ text: code.slice(last, m.index) });
    let cls: string | undefined;
    for (let g = 1; g <= 7; g++) {
      if (m[g] !== undefined) {
        cls = TOKEN_STYLE[g];
        break;
      }
    }
    spans.push({ text: m[0], cls });
    last = m.index + m[0].length;
    if (m[0].length === 0) TOKEN_RE.lastIndex += 1;
  }
  if (last < code.length) spans.push({ text: code.slice(last) });
  return spans;
}

export default function CodeBlock({ code, title }: { code: string; title: string }) {
  const spans = useMemo(() => tokenize(code), [code]);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (insecure context) — silently ignore
    }
  };

  return (
    <div className="rounded-sm overflow-hidden border border-[#2a2822]">
      <div className="flex items-center justify-between bg-[#221F1A] px-3.5 py-2 border-b border-[#2a2822]">
        <span className="font-mono text-[11px] text-[#8a8578]">{title}</span>
        <button
          onClick={copy}
          className="text-[11px] font-medium px-2 py-0.5 rounded-sm border border-[#3a372f] text-[#b5b0a3] hover:text-white hover:border-[#55503f] transition-colors"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="bg-[#171512] text-[#d6d3cb] text-[12.5px] leading-[1.65] overflow-x-auto p-4 font-mono">
        <code>
          {spans.map((s, i) =>
            s.cls ? (
              <span key={i} className={s.cls}>
                {s.text}
              </span>
            ) : (
              <span key={i}>{s.text}</span>
            )
          )}
        </code>
      </pre>
    </div>
  );
}
