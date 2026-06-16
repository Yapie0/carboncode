const WS_URL = `ws://${location.host}`;
let ws;
let messageHandlers = {};

export function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => console.log("[ws] connected");
  ws.onmessage = (ev) => {
    try {
      const { type, payload } = JSON.parse(ev.data);
      const handler = messageHandlers[type];
      if (handler) handler(payload);
    } catch (err) { console.error("[ws] parse error", err); }
  };
  ws.onclose = () => console.log("[ws] disconnected");
}

export function on(msgType, handler) { messageHandlers[msgType] = handler; }
export function send(type, payload = {}) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, payload })); }
export function isConnected() { return ws && ws.readyState === WebSocket.OPEN; }
