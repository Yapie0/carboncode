import type { Puzzle, Point } from "./game-engine.js";
import { RANGE } from "./game-engine.js";

export interface PuzzleGenOptions { greenCount?: number; redCount?: number; }

export function generatePuzzle(opts: PuzzleGenOptions = {}): Puzzle {
  const greenCount = opts.greenCount ?? 3;
  const redCount = opts.redCount ?? 5;
  const greenDots: Point[] = [];
  const redDots: Point[] = [];
  const occupied = new Set<string>();

  while (greenDots.length < greenCount) {
    const p = randomPoint();
    const key = keyOf(p);
    if (occupied.has(key)) continue;
    occupied.add(key);
    greenDots.push(p);
  }
  while (redDots.length < redCount) {
    const p = randomPoint();
    const key = keyOf(p);
    if (occupied.has(key)) continue;
    occupied.add(key);
    redDots.push(p);
  }
  return { greenDots, redDots };
}

function randomPoint(): Point { return { x: randInt(-RANGE, RANGE), y: randInt(-RANGE, RANGE) }; }
function randInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }
function keyOf(p: Point): string { return `${p.x},${p.y}`; }
