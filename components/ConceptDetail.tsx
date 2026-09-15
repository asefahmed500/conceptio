"use client";

import { useState } from "react";
import { Concept } from "@/data/concepts";
import FlowDiagram from "./FlowDiagram";
import CodeBlock from "./CodeBlock";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted font-semibold mb-1.5">
      {children}
    </div>
  );
}

function Subtopics({ items }: { items: Concept["subtopics"] }) {
  const [open, setOpen] = useState<number | null>(0);
  if (!items?.length) return null;
  return (
    <div className="border border-line rounded-sm overflow-hidden">
      {items.map((s, i) => {
        const isOpen = open === i;
        return (
          <div key={i} className={i > 0 ? "border-t border-line" : ""}>
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-black/[0.02] transition-colors"
            >
              <span
                className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10.5px] font-bold transition-colors ${
                  isOpen ? "bg-accent text-white" : "bg-accentSoft text-accent"
                }`}
              >
                {i + 1}
              </span>
              <span className="text-[13px] font-semibold text-ink flex-1">{s.name}</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
                className={`text-muted shrink-0 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
              >
                <path d="M6 3l5 5-5 5V3z" />
              </svg>
            </button>
            {isOpen && (
              <div className="px-3.5 pb-3 pl-[52px] text-[12.5px] text-muted leading-relaxed">
                {s.detail}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ConceptDetail({
  concept,
  related,
  catName,
  onBack,
  onSelect,
}: {
  concept: Concept;
  related: Concept[];
  catName: string;
  onBack: () => void;
  onSelect: (c: Concept) => void;
}) {
  return (
    <div className="panel-enter bg-panel border border-line rounded-sm p-4 md:p-7 max-w-4xl">
      <button onClick={onBack} className="text-[12.5px] text-accent mb-5 hover:underline">
        ← Back to {catName}
      </button>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10.5px] uppercase tracking-[0.12em] font-semibold text-accent bg-accentSoft rounded-full px-2.5 py-0.5">
          {catName}
        </span>
        <span className="text-[11px] text-muted/80">Source: {concept.ref}</span>
      </div>
      <div className="text-[20px] font-semibold tracking-tight text-ink mb-1.5">
        {concept.title}
      </div>
      <div className="text-[13.5px] text-muted leading-relaxed max-w-xl mb-5">{concept.one}</div>

      <div className="border-t border-b border-line py-4 mb-6 -mx-2 px-2">
        <FlowDiagram steps={concept.steps} />
      </div>

      {(concept.why || concept.how || concept.when) && (
        <div className="grid md:grid-cols-3 gap-5 mb-7">
          {concept.why && (
            <div className="border-l-2 border-accent/60 pl-3.5">
              <SectionLabel>Why it exists</SectionLabel>
              <p className="text-[12.5px] text-ink/85 leading-relaxed">{concept.why}</p>
            </div>
          )}
          {concept.how && (
            <div className="border-l-2 border-line pl-3.5">
              <SectionLabel>How it works</SectionLabel>
              <p className="text-[12.5px] text-ink/85 leading-relaxed">{concept.how}</p>
            </div>
          )}
          {concept.when && (
            <div className="border-l-2 border-line pl-3.5">
              <SectionLabel>When to use it</SectionLabel>
              <p className="text-[12.5px] text-ink/85 leading-relaxed">{concept.when}</p>
            </div>
          )}
        </div>
      )}

      {concept.subtopics?.length > 0 && (
        <div className="mb-7">
          <SectionLabel>Subtopics</SectionLabel>
          <Subtopics items={concept.subtopics} />
        </div>
      )}

      {concept.code && (
        <div className="mb-7">
          <SectionLabel>Real example — JavaScript</SectionLabel>
          <CodeBlock code={concept.code} title={`${concept.id}.js`} />
        </div>
      )}

      {related.length > 0 && (
        <div>
          <div className="text-[11px] text-muted font-medium mb-2">Related in {catName}</div>
          <div className="flex gap-2 flex-wrap">
            {related.map((r) => (
              <button
                key={r.id}
                onClick={() => onSelect(r)}
                className="text-[12px] px-3 py-1.5 rounded-full border border-line bg-bg hover:border-accent/50 transition-colors text-ink"
              >
                {r.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
