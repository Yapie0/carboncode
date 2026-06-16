const CANVAS_SIZE = 600;
const GRID_COUNT = 16;
const CELL = CANVAS_SIZE / GRID_COUNT;
const CENTER = CANVAS_SIZE / 2;
let ctx;

export function init(canvas) { ctx = canvas.getContext("2d"); }

export function drawBoard(puzzle, previewPoints = [], opponentPoints = []) {
  if (!ctx) return;
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  drawGrid();
  drawAxes();
  drawLabels();
  if (opponentPoints.length > 0) drawCurve(opponentPoints, "rgba(59,130,246,0.15)", "rgba(59,130,246,0.4)", 1.5);
  if (previewPoints.length > 0) drawCurve(previewPoints, "rgba(74,222,128,0.1)", "rgba(74,222,128,0.6)", 2);
  for (const p of puzzle.greenDots) drawDot(p, "#4ade80", 8);
  for (const p of puzzle.redDots) drawDot(p, "#f87171", 8);
}

function drawGrid() {
  ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 1;
  for (let i = 0; i <= GRID_COUNT; i++) {
    ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, CANVAS_SIZE); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(CANVAS_SIZE, i * CELL); ctx.stroke();
  }
}

function drawAxes() {
  ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(CENTER, 0); ctx.lineTo(CENTER, CANVAS_SIZE); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, CENTER); ctx.lineTo(CANVAS_SIZE, CENTER); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.beginPath(); ctx.arc(CENTER, CENTER, 3, 0, Math.PI * 2); ctx.fill();
}

function drawLabels() {
  ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.font = "10px monospace"; ctx.textAlign = "center";
  for (let i = -8; i <= 8; i += 2) { if (i === 0) continue; ctx.fillText(String(i), CENTER + i * CELL, CENTER + 14); }
  ctx.textAlign = "right";
  for (let i = -8; i <= 8; i += 2) { if (i === 0) continue; ctx.fillText(String(i), CENTER - 4, CENTER - i * CELL + 4); }
}

function drawDot(point, color, radius) {
  const cx = CENTER + point.x * CELL;
  const cy = CENTER - point.y * CELL;
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 1; ctx.stroke();
}

function drawCurve(points, fillColor, strokeColor, lineWidth) {
  if (points.length < 2) return;
  ctx.fillStyle = fillColor; ctx.beginPath();
  const first = gridToPixel(points[0]); ctx.moveTo(first.px, first.py);
  for (let i = 1; i < points.length; i++) { const { px, py } = gridToPixel(points[i]); ctx.lineTo(px, py); }
  ctx.strokeStyle = strokeColor; ctx.lineWidth = lineWidth; ctx.stroke();
  ctx.fillStyle = strokeColor;
  for (const p of points) { const { px, py } = gridToPixel(p); ctx.fillRect(px - 3, py - 3, 6, 6); }
}

function gridToPixel(p) { return { px: CENTER + p.x * CELL, py: CENTER - p.y * CELL }; }
