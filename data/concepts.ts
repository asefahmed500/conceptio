import { CORE } from "./concepts/core";
import { WEB } from "./concepts/web";
import { DB } from "./concepts/db";
import { AUTH } from "./concepts/auth";
import { ARCH } from "./concepts/arch";
import { CACHE } from "./concepts/cache";
import { SCALE } from "./concepts/scale";
import { OPS } from "./concepts/ops";
import { SYSD } from "./concepts/sysd";
import type { Category, Concept } from "./types";

export type { Category, Concept, Subtopic } from "./types";

export const CATEGORIES: Category[] = [
  { id: "core", name: "Core Programming" },
  { id: "web", name: "Web Fundamentals" },
  { id: "db", name: "Databases" },
  { id: "auth", name: "Auth & Security" },
  { id: "arch", name: "Server Architecture" },
  { id: "cache", name: "Caching" },
  { id: "scale", name: "Scalability & Performance" },
  { id: "ops", name: "DevOps & Deployment" },
  { id: "sysd", name: "System Design" },
];

export const CONCEPTS: Concept[] = [
  ...CORE,
  ...WEB,
  ...DB,
  ...AUTH,
  ...ARCH,
  ...CACHE,
  ...SCALE,
  ...OPS,
  ...SYSD,
];
