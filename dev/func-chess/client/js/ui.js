import { connect, on, send } from "./network.js";
import { init, drawBoard } from "./renderer.js";

// ─── 本地函数预览 ──────────────────────────────────────────────────
const GRID_RANGE = 8;
const PREVIEW_STEP = 0.05;
const Y_CLAMP = 10;

function localEvaluate(expr) {
  const points = [];
  const seen = new Set();
  const normalized = expr.replace(/X/g, "x");
  for (let x = -GRID_RANGE; x <= GRID_RANGE; x += PREVIEW_STEP) {
    try {
      const y = math.evaluate(normalized, { x });
      if (!Number.isFinite(y) || Math.abs(y) > Y_CLAMP) continue;
      const gx = Math.round(x);
      const gy = Math.round(y);
      if (Math.abs(gx) > GRID_RANGE || Math.abs(gy) > GRID_RANGE) continue;
      const key = `${gx},${gy}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({ x: gx, y: gy });
    } catch { continue; }
  }
  return points;
}

// ─── UI 控制器 ─────────────────────────────────────────────────────

let state = { playerId: null, playerName: "玩家", roomCode: null, puzzle: null, mySubmission: null, opponent: null, timerInterval: null, startedAt: null, gameOver: false };

const $ = (id) => document.getElementById(id);
const lobby = $("lobby"), game = $("game"), board = $("board"), funcInput = $("func-input");
const submitBtn = $("submit-btn"), clearBtn = $("clear-btn"), createBtn = $("create-btn"), listBtn = $("list-btn");
const chatInput = $("chat-input"), chatSend = $("chat-send"), chatMessages = $("chat-messages");
const rematchBtn = $("rematch-btn"), leaveBtn = $("leave-btn"), roomCodeDisplay = $("room-code-display");
const timerDisplay = $("timer"), previewError = $("preview-error"), nameInput = $("name-input"), roomList = $("room-list");

init(board); connect();

createBtn.addEventListener("click", () => { state.playerName = nameInput.value || "玩家"; send("create_room", { name: state.playerName }); });
listBtn.addEventListener("click", () => send("list_rooms"));
submitBtn.addEventListener("click", submitFunc);
clearBtn.addEventListener("click", () => { funcInput.value = ""; previewError.textContent = ""; drawBoard(state.puzzle || { greenDots: [], redDots: [] }, [], []); });
let previewTimer = 0;
funcInput.addEventListener("input", () => {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const expr = funcInput.value.trim();
    if (!expr || !state.puzzle) { drawBoard(state.puzzle || { greenDots: [], redDots: [] }, [], []); previewError.textContent = ""; return; }
    try {
      const pts = localEvaluate(expr);
      drawBoard(state.puzzle, pts, []);
      previewError.textContent = "";
    } catch (err) { previewError.textContent = "预览错误: " + (err && err.message ? err.message : "无法计算"); }
  }, 150);
});
funcInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitFunc(); });
chatSend.addEventListener("click", sendChat);
chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
rematchBtn.addEventListener("click", () => send("rematch", { code: state.roomCode }));
leaveBtn.addEventListener("click", () => location.reload());

on("room_created", (p) => enterRoom(p.room, p.playerId));
on("room_joined", (p) => enterRoom(p.room, p.playerId));
on("game_start", (p) => updateRoom(p.room));
on("room_list", (p) => {
  const rooms = p.rooms || [];
  roomList.innerHTML = rooms.length === 0 ? '<div class="room-entry">暂无等待中的房间，创建一个吧！</div>'
    : rooms.map(r => `<div class="room-entry"><span>🏠 房间 ${r.code} — ${r.players[0]?.name || "?"} (等待对手)</span><button onclick="window.joinRoom('${r.code}')">加入</button></div>`).join("");
});

on("player_submitted", (p) => {
  if (p.playerId === state.playerId) { state.mySubmission = p.result; updatePlayerCards(); }
  else { state.opponent = { ...state.opponent, submission: p.result }; updatePlayerCards(); }
  if (p.result.error) addChat("system", `❌ ${p.playerName}: ${p.result.error}`);
  else if (p.result.solved) addChat("system", `🏆 ${p.playerName} 解出了这道题！`);
  else addChat("system", `📊 ${p.playerName}: ${p.result.passGreen}/${p.result.totalGreen} 绿点${p.result.hitRed ? " ⚠️碰到红点" : ""}`);
});

on("game_over", (p) => { state.gameOver = true; stopTimer(); updatePlayerCards(); rematchBtn.style.display = "block"; addChat("system", `🎉 ${p.winnerName} 获胜！`); });
on("rematch", (p) => {
  state.puzzle = p.room.puzzle; state.mySubmission = null; state.opponent = null;
  state.gameOver = false; state.startedAt = Date.now(); startTimer();
  funcInput.value = ""; previewError.textContent = ""; rematchBtn.style.display = "none";
  drawBoard(state.puzzle, [], []); updatePlayerCards(); addChat("system", "🔄 新题目已生成！");
});
on("chat", (p) => addChat(p.playerName, p.text));
on("error", (p) => addChat("system", `⚠️ ${p.message}`));

function enterRoom(room, playerId) {
  state.roomCode = room.code; state.playerId = playerId; state.puzzle = room.puzzle;
  state.mySubmission = null; state.opponent = null; state.gameOver = false; state.startedAt = room.startedAt || Date.now();
  lobby.style.display = "none"; game.style.display = "flex";
  roomCodeDisplay.textContent = `房间: ${room.code}`;
  funcInput.value = ""; previewError.textContent = ""; rematchBtn.style.display = "none";
  drawBoard(state.puzzle, [], []); updatePlayerCards(); startTimer();
}

function updateRoom(room) {
  state.puzzle = room.puzzle; state.startedAt = room.startedAt || Date.now(); state.gameOver = room.status === "finished";
  const opp = room.players.find(p => p.id !== state.playerId);
  if (opp) state.opponent = { name: opp.name, solved: opp.solved, submission: opp.submission };
  updatePlayerCards(); drawBoard(state.puzzle, [], []);
}

function updatePlayerCards() {
  const me = state.mySubmission;
  $("player-me").className = "player-card me" + (me?.solved ? " solved" : "");
  $("player-me").innerHTML = `<div class="name">👤 ${state.playerName} (你)</div>${me ? `<div class="score">${me.passGreen}/${me.totalGreen} 绿点${me.hitRed ? " ⚠️红点" : ""}${me.error ? " ❌" : ""}${me.solved ? " ✅" : ""}</div>` : '<div class="score">未提交</div>'}`;
  const op = state.opponent;
  if (op) {
    $("player-opponent").style.display = "block";
    $("player-opponent").className = "player-card" + (op.solved ? " solved" : "");
    $("player-opponent").innerHTML = `<div class="name">🤖 ${op.name}</div>${op.submission ? `<div class="score">${op.submission.passGreen}/${op.submission.totalGreen} 绿点${op.submission.hitRed ? " ⚠️红点" : ""}${op.submission.solved ? " ✅" : ""}</div>` : '<div class="score">未提交</div>'}`;
  } else {
    $("player-opponent").style.display = "block";
    $("player-opponent").className = "player-card";
    $("player-opponent").innerHTML = '<div class="name">⏳ 等待对手加入...</div>';
  }
}

function submitFunc() {
  if (!state.roomCode || state.gameOver) return;
  const expr = funcInput.value.trim();
  if (!expr) return;
  send("submit", { expr, code: state.roomCode });
}

function sendChat() {
  const text = chatInput.value.trim();
  if (!text || !state.roomCode) return;
  send("chat", { text, code: state.roomCode });
  chatInput.value = "";
}

function addChat(sender, text) {
  const div = document.createElement("div");
  div.className = "msg" + (sender === "system" ? " system" : "");
  if (sender === "system") div.textContent = text;
  else div.innerHTML = `<span class="name">${sender}:</span> ${esc(text)}`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function startTimer() { stopTimer(); state.startedAt = Date.now(); state.timerInterval = setInterval(updateTimer, 1000); updateTimer(); }
function stopTimer() { if (state.timerInterval) clearInterval(state.timerInterval); }
function updateTimer() {
  const elapsed = Math.floor((Date.now() - (state.startedAt || Date.now())) / 1000);
  timerDisplay.textContent = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
}
function esc(text) { const d = document.createElement("div"); d.textContent = text; return d.innerHTML; }

window.joinRoom = (code) => { state.playerName = nameInput.value || "玩家"; send("join_room", { code, name: state.playerName }); };
