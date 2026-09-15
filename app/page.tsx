"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import ConceptCard from "@/components/ConceptCard";
import { CATEGORIES, CONCEPTS, Concept } from "@/data/concepts";

const ConceptDetail = dynamic(() => import("@/components/ConceptDetail"), {
  ssr: false,
  loading: () => (
    <div className="bg-panel border border-line rounded-sm p-4 md:p-7 max-w-4xl min-h-[720px]" />
  ),
});

export default function Home() {
  const [activeCat, setActiveCat] = useState("core");
  const [query, setQuery] = useState("");
  const [activeConcept, setActiveConcept] = useState<Concept | null>(null);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [activeConcept]);

  const filtered = useMemo(() => {
    if (query.trim()) {
      const q = query.toLowerCase();
      const hit = (s: string) => s.toLowerCase().includes(q);
      return CONCEPTS.filter(
        (c) =>
          hit(c.title) ||
          hit(c.one) ||
          hit(c.why) ||
          hit(c.how) ||
          hit(c.when) ||
          c.subtopics.some((s) => hit(s.name) || hit(s.detail))
      );
    }
    return CONCEPTS.filter((c) => c.cat === activeCat);
  }, [activeCat, query]);

  const related = useMemo(() => {
    if (!activeConcept) return [];
    return CONCEPTS.filter((c) => c.cat === activeConcept.cat && c.id !== activeConcept.id).slice(0, 5);
  }, [activeConcept]);

  const catName = (id: string) => CATEGORIES.find((c) => c.id === id)?.name ?? id;

  const selectCat = (id: string) => {
    setActiveCat(id);
    setActiveConcept(null);
    setQuery("");
  };

  return (
    <div className="flex min-h-screen bg-bg flex-col md:flex-row">
      <Sidebar
        active={activeCat}
        activeConcept={activeConcept}
        onSelect={selectCat}
        onOpenConcept={(c) => {
          setActiveCat(c.cat);
          setQuery("");
          setActiveConcept(c);
        }}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <div className="md:hidden border-b border-line px-4 py-3">
          <div className="mx-auto w-full max-w-5xl flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {CATEGORIES.map((c) => {
              const count = CONCEPTS.filter((x) => x.cat === c.id).length;
              const isActive = c.id === activeCat;
              return (
                <button
                  key={c.id}
                  onClick={() => selectCat(c.id)}
                  aria-current={isActive ? "true" : undefined}
                  className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full text-[12px] border transition-colors ${
                    isActive
                      ? "bg-accentSoft border-accent/40 text-accent font-semibold"
                      : "border-line bg-panel text-ink"
                  }`}
                >
                  {c.name} <span className="text-muted font-normal">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <header className="border-b border-line bg-panel/60">
          <div className="mx-auto w-full max-w-5xl px-4 md:px-8 py-4 md:py-5 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-[13px] text-muted">
                {query.trim() ? `Search results` : catName(activeCat)}
              </div>
              <div className="text-[18px] font-semibold tracking-tight text-ink">
                {query.trim() ? `"${query}"` : `${filtered.length} concepts`}
              </div>
            </div>
            <input
              value={query}
              aria-label="Search concepts"
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveConcept(null);
              }}
              placeholder={`Search all ${CONCEPTS.length} concepts…`}
              className="text-[13px] font-sans px-3.5 py-2 rounded-sm border border-line bg-panel outline-none w-full sm:w-64 focus:border-accent transition-colors"
            />
          </div>
        </header>

        <main className="flex-1 px-4 md:px-8 py-4 md:py-6">
          <div className="mx-auto w-full max-w-5xl">
            {!activeConcept && (
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}
              >
                {filtered.map((c) => (
                  <ConceptCard
                    key={c.id}
                    concept={c}
                    onOpen={setActiveConcept}
                    showCategory={Boolean(query.trim())}
                    catName={catName(c.cat)}
                  />
                ))}
                {filtered.length === 0 && (
                  <div className="text-muted text-[13px]">No concepts match &quot;{query}&quot;.</div>
                )}
              </div>
            )}

            {activeConcept && (
              <ConceptDetail
                key={activeConcept.id}
                concept={activeConcept}
                related={related}
                catName={catName(activeConcept.cat)}
                onBack={() => setActiveConcept(null)}
                onSelect={setActiveConcept}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
