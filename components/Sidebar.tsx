"use client";

import { useState } from "react";
import { CATEGORIES, CONCEPTS, Concept } from "@/data/concepts";

export default function Sidebar({
  active,
  activeConcept,
  onSelect,
  onOpenConcept,
}: {
  active: string;
  activeConcept: Concept | null;
  onSelect: (id: string) => void;
  onOpenConcept: (c: Concept) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([active]));

  const select = (id: string) => {
    onSelect(id);
    setExpanded((prev) => new Set(prev).add(id));
  };

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <nav className="hidden md:block w-[264px] shrink-0 border-r border-line bg-panel/60 py-5 px-3 sticky top-0 h-screen overflow-y-auto">
      <div className="px-3 mb-4">
        <div className="text-[15px] font-semibold tracking-tight text-ink">Backend Atlas</div>
        <div className="text-[11.5px] text-muted mt-1 leading-snug">
          {CONCEPTS.length} concepts · {CATEGORIES.length} categories · why / how / when
        </div>
      </div>

      {CATEGORIES.map((cat) => {
        const concepts = CONCEPTS.filter((x) => x.cat === cat.id);
        const isActive = cat.id === active;
        const isOpen = expanded.has(cat.id);
        return (
          <div key={cat.id} className="mb-0.5">
            <div
              className={`w-full flex items-center gap-1 rounded-sm text-[13px] transition-colors ${
                isActive ? "text-accent" : "text-ink"
              }`}
            >
              <button
                onClick={() => toggle(cat.id)}
                aria-label={isOpen ? "Collapse section" : "Expand section"}
                aria-expanded={isOpen}
                className="w-6 h-7 flex items-center justify-center shrink-0 hover:text-accent"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  aria-hidden="true"
                  className={`transition-transform duration-200 ${isOpen ? "rotate-90" : ""} ${
                    isActive ? "text-accent" : "text-muted"
                  }`}
                >
                  <path d="M6 3l5 5-5 5V3z" />
                </svg>
              </button>
              <button
                onClick={() => select(cat.id)}
                aria-current={isActive ? "true" : undefined}
                className={`flex-1 flex items-center justify-between text-left py-2 pr-2 rounded-sm ${
                  isActive ? "font-semibold" : "font-medium hover:text-accent"
                }`}
              >
                <span>{cat.name}</span>
                <span className="text-[11px] text-muted font-normal">{concepts.length}</span>
              </button>
            </div>

            {isOpen && (
              <div className="ml-6 mb-1.5 border-l border-line pl-2">
                {concepts.map((c) => {
                  const isCurrent = activeConcept?.id === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => onOpenConcept(c)}
                      title={c.one}
                      className={`w-full text-left text-[12px] leading-snug px-2 py-[5px] rounded-sm truncate transition-colors ${
                        isCurrent
                          ? "bg-accentSoft text-accent font-semibold"
                          : "text-muted hover:text-ink hover:bg-black/[0.03]"
                      }`}
                    >
                      {c.title}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
