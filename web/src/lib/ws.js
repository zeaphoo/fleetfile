/**
 * WebSocket client for the fleetfile server.
 * Events (server -> client):
 *   { type: "dir-changed", path }      — a watched directory changed on disk
 *   { type: "progress", op, done, total } — copy/move progress (bytes)
 *   { type: "op-done", op }
 *   { type: "op-error", op, error, cancelled }
 * Messages (client -> server):
 *   { type: "watch", path } | { type: "unwatch", path }
 *   { type: "cancel", op } | { type: "ping" }
 */

let ws = null;
let retryCount = 0;
let watched = new Set();
let handlers = {
  dirChanged: () => {},
  progress: () => {},
  opDone: () => {},
  opError: () => {},
};

export function setWsHandlers(h) {
  handlers = { ...handlers, ...h };
}

function connect() {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${window.location.host}/api/ws`);

  ws.onopen = () => {
    retryCount = 0;
    for (const p of watched) {
      ws.send(JSON.stringify({ type: "watch", path: p }));
    }
  };

  ws.onmessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    switch (msg.type) {
      case "dir-changed":
        handlers.dirChanged?.(msg.path);
        break;
      case "progress":
        handlers.progress?.(msg);
        break;
      case "op-done":
        handlers.opDone?.(msg.op);
        break;
      case "op-error":
        handlers.opError?.(msg);
        break;
      default:
        break;
    }
  };

  ws.onclose = () => {
    ws = null;
    setTimeout(connect, Math.min(1000 * 2 ** retryCount, 10000));
    retryCount += 1;
  };

  ws.onerror = () => {
    try {
      ws?.close();
    } catch {
      /* noop */
    }
  };
}

export function connectWS() {
  if (!ws) connect();
}

export function sendWS(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/** Keep the server watching exactly this set of directories. */
export function syncWatches(paths) {
  const next = new Set(
    (paths || [])
      .filter(Boolean)
      .map((p) => p.replace(/[\\/]+$/, "")),
  );
  for (const p of next) {
    if (!watched.has(p)) sendWS({ type: "watch", path: p });
  }
  for (const p of watched) {
    if (!next.has(p)) sendWS({ type: "unwatch", path: p });
  }
  watched = next;
}

export function cancelOp(op) {
  sendWS({ type: "cancel", op });
}
