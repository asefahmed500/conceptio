"use client";

import { useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  Node,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";

const NODE_W = 190;
const NODE_H = 56;
const GAP_X = 70;
const ROW_MAX = 4;
const STEP_MS = 1250;

type StepState = "upcoming" | "active" | "done";

function StepNode({ data }: { data: { label: string; index: number; state: StepState } }) {
  const { label, index, state } = data;
  const isActive = state === "active";
  const isDone = state === "done";
  const borderColor = isActive ? "#2F4B9A" : isDone ? "#2F4B9A73" : "#D9D5C9";
  const background = isActive ? "#EDF0F9" : isDone ? "#F6F7FB" : "#FFFFFF";
  return (
    <div
      style={{
        width: NODE_W,
        minHeight: NODE_H,
        borderRadius: 4,
        border: `${isActive ? 2 : 1.4}px solid ${borderColor}`,
        background,
        display: "flex",
        alignItems: "center",
        gap: 8,
        textAlign: "left",
        padding: "8px 12px",
        fontFamily: "var(--font-inter), Inter, sans-serif",
        fontSize: 12.5,
        fontWeight: isActive ? 600 : 500,
        color: state === "upcoming" ? "#8A8578" : "#1B1A18",
        lineHeight: 1.3,
        boxShadow: isActive ? "0 3px 10px rgba(47, 75, 154, 0.18)" : "none",
        transform: isActive ? "scale(1.04)" : "none",
        transition: "box-shadow 0.25s ease, transform 0.25s ease",
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 999,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          fontWeight: 700,
          background: isActive || isDone ? "#2F4B9A" : "#EFEDE5",
          color: isActive || isDone ? "#FFFFFF" : "#8A8578",
        }}
      >
        {index + 1}
      </span>
      <span>{label}</span>
    </div>
  );
}

const nodeTypes = { step: StepNode };

function Icon({ path }: { path: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  play: "M4 2.5v11l9-5.5-9-5.5z",
  pause: "M3.5 2.5h3v11h-3v-11zm6 0h3v11h-3v-11z",
  prev: "M11 2.5v11L4 8l7-5.5z",
  next: "M5 2.5v11L12 8 5 2.5z",
  replay: "M8 3a5 5 0 1 1-4.9 6h1.55A3.5 3.5 0 1 0 8 4.5V7L4.5 4 8 1v2z",
};

export default function FlowDiagram({ steps }: { steps: string[] }) {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    setActive(0);
    setPlaying(true);
  }, [steps]);

  useEffect(() => {
    if (!playing) return;
    if (active >= steps.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setActive((a) => a + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [playing, active, steps.length]);

  const { nodes, edges } = useMemo(() => {
    const perRow = Math.min(ROW_MAX, steps.length);
    const nodes: Node[] = steps.map((label, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const displayCol = row % 2 === 0 ? col : perRow - 1 - col;
      const state: StepState = i < active ? "done" : i === active ? "active" : "upcoming";
      return {
        id: `n${i}`,
        type: "step",
        position: { x: displayCol * (NODE_W + GAP_X), y: row * 110 },
        data: { label, index: i, state },
        sourcePosition: row % 2 === 0 ? Position.Right : Position.Left,
        targetPosition: row % 2 === 0 ? Position.Left : Position.Right,
        draggable: false,
      };
    });

    const edges: Edge[] = steps.slice(1).map((_, i) => ({
      id: `e${i}`,
      source: `n${i}`,
      target: `n${i + 1}`,
      animated: i === active,
      type: "smoothstep",
      style: {
        stroke: i < active ? "#2F4B9A" : i === active ? "#2F4B9A" : "#D9D5C9",
        strokeWidth: i <= active ? 1.8 : 1.2,
      },
    }));

    return { nodes, edges };
  }, [steps, active]);

  const rows = Math.ceil(steps.length / Math.min(ROW_MAX, steps.length));
  const height = Math.max(160, rows * 110 + 40);

  const goTo = (i: number) => {
    setPlaying(false);
    setActive(Math.min(steps.length - 1, Math.max(0, i)));
  };

  const togglePlay = () => {
    if (!playing && active >= steps.length - 1) setActive(0);
    setPlaying((p) => !p);
  };

  return (
    <div>
      <div style={{ height, width: "100%" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          nodesConnectable={false}
          nodesDraggable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          panOnDrag={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#E4E1D8" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <div className="flex items-center gap-1.5 mt-2 px-1 select-none">
        <button
          onClick={togglePlay}
          aria-label={playing ? "Pause animation" : "Play animation"}
          className="w-7 h-7 flex items-center justify-center rounded-sm border border-line bg-panel text-accent hover:border-accent/50 transition-colors"
        >
          <Icon path={playing ? ICONS.pause : ICONS.play} />
        </button>
        <button
          onClick={() => goTo(active - 1)}
          aria-label="Previous step"
          className="w-7 h-7 flex items-center justify-center rounded-sm border border-line bg-panel text-ink hover:border-accent/50 transition-colors"
        >
          <Icon path={ICONS.prev} />
        </button>
        <button
          onClick={() => goTo(active + 1)}
          aria-label="Next step"
          className="w-7 h-7 flex items-center justify-center rounded-sm border border-line bg-panel text-ink hover:border-accent/50 transition-colors"
        >
          <Icon path={ICONS.next} />
        </button>
        <button
          onClick={() => {
            setActive(0);
            setPlaying(true);
          }}
          aria-label="Replay animation"
          className="w-7 h-7 flex items-center justify-center rounded-sm border border-line bg-panel text-ink hover:border-accent/50 transition-colors"
        >
          <Icon path={ICONS.replay} />
        </button>

        <div className="flex items-center gap-1 ml-2">
          {steps.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={`Go to step ${i + 1}`}
              aria-current={i === active ? "step" : undefined}
              className="p-1 group"
            >
              <span
                className={`block w-1.5 h-1.5 rounded-full transition-colors ${
                  i === active
                    ? "bg-accent ring-2 ring-accent/25"
                    : i < active
                      ? "bg-accent/60 group-hover:bg-accent"
                      : "bg-line group-hover:bg-muted"
                }`}
            />
            </button>
          ))}
        </div>

        <span className="ml-auto text-[11px] text-muted font-mono">
          {active + 1} / {steps.length}
        </span>
      </div>
    </div>
  );
}
