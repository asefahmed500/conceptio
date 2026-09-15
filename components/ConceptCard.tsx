"use client";

import { Concept } from "@/data/concepts";

export default function ConceptCard({
  concept,
  onOpen,
  showCategory = false,
  catName = "",
}: {
  concept: Concept;
  onOpen: (c: Concept) => void;
  showCategory?: boolean;
  catName?: string;
}) {
  return (
    <button
      onClick={() => onOpen(concept)}
      className="text-left bg-panel border border-line rounded-sm p-4 flex flex-col gap-2 hover:border-accent/40 transition-colors"
    >
      {showCategory && catName && (
        <div className="text-[10.5px] uppercase tracking-wide text-muted">{catName}</div>
      )}
      <div className="text-[13.5px] font-semibold text-ink leading-snug">{concept.title}</div>
      <div className="text-[12px] text-muted leading-relaxed">{concept.one}</div>
      <div className="text-[10.5px] text-muted/80 mt-1 pt-2 border-t border-line">
        Source: {concept.ref}
      </div>
    </button>
  );
}
