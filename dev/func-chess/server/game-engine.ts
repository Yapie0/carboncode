/**
 * 函数棋 — 游戏引擎核心。
 *
 * 16×16 网格，笛卡尔坐标系原点居中。
 * 支持函数解析、路径计算、胜负判定。
 *
 * 参考 MWH:
 * - idempotent-consumer: 判定函数幂等（重复提交不重复计分）
 * - circuit-breaker: eval 超时保护
 */

import { create, all } from "mathjs";

const math = create(all, {});

export const GRID_SIZE = 16;
export const RANGE = 8;
const STEP = 0.05;
const EVAL_TIMEOUT_MS = 500;
const Y_CLAMP = 10;

export interface Point { x: number; y: number; }
export interface Puzzle { greenDots: Point[]; redDots: Point[]; }
export interface EvalResult {
  pathPoints: Point[];
  passGreen: number;
  totalGreen: number;
  hitRed: boolean;
  error?: string;
}
export interface SubmitResult {
  solved: boolean;
  passGreen: number;
  totalGreen: number;
  hitRed: boolean;
  elapsedMs: number;
  error?: string;
}

export function evaluateFunction(expr: string): EvalResult {
  const normalized = expr.replace(/X/g, "x");
  let compiled: math.EvalFunction;
  try {
    compiled = math.compile(normalized);
  } catch (err) {
    return emptyResult(`表达式语法错误: ${(err as Error).message}`);
  }

  const pathPoints: Point[] = [];
  const seen = new Set<string>();
  const start = Date.now();

  for (let x = -RANGE; x <= RANGE; x += STEP) {
    if (Date.now() - start > EVAL_TIMEOUT_MS) {
      return emptyResult(`函数求值超时（>${EVAL_TIMEOUT_MS}ms），请简化表达式`);
    }
    let y: number;
    try {
      y = math.evaluate(normalized, { x });
    } catch { continue; }
    if (!Number.isFinite(y)) continue;
    if (Math.abs(y) > Y_CLAMP) continue;
    const gx = Math.round(x);
    const gy = Math.round(y);
    if (Math.abs(gx) > RANGE || Math.abs(gy) > RANGE) continue;
    const key = `${gx},${gy}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pathPoints.push({ x: gx, y: gy });
  }

  return { pathPoints, passGreen: 0, totalGreen: 0, hitRed: false };
}

const submittedCache = new Set<string>();

export function submitSolution(expr: string, puzzle: Puzzle, startedAt: number): SubmitResult {
  const cacheKey = `${JSON.stringify(puzzle)}::${expr}`;
  if (submittedCache.has(cacheKey)) {
    return { solved: false, passGreen: 0, totalGreen: puzzle.greenDots.length, hitRed: false, elapsedMs: Date.now() - startedAt, error: "该表达式已提交过" };
  }
  submittedCache.add(cacheKey);

  const evalResult = evaluateFunction(expr);
  if (evalResult.error) {
    return { solved: false, passGreen: 0, totalGreen: puzzle.greenDots.length, hitRed: false, elapsedMs: Date.now() - startedAt, error: evalResult.error };
  }

  const pathSet = new Set(evalResult.pathPoints.map(p => `${p.x},${p.y}`));
  let passGreen = 0;
  for (const g of puzzle.greenDots) {
    if (pathSet.has(`${g.x},${g.y}`)) passGreen++;
  }
  let hitRed = false;
  for (const r of puzzle.redDots) {
    if (pathSet.has(`${r.x},${r.y}`)) { hitRed = true; break; }
  }

  return { solved: passGreen === puzzle.greenDots.length && !hitRed, passGreen, totalGreen: puzzle.greenDots.length, hitRed, elapsedMs: Date.now() - startedAt };
}

export function clearSubmissionCache(): void { submittedCache.clear(); }

function emptyResult(error: string): EvalResult { return { pathPoints: [], passGreen: 0, totalGreen: 0, hitRed: false, error }; }
