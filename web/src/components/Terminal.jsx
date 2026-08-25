import { useEffect, useRef, useState } from "react";

/**
 * Minimal ANSI terminal renderer for the pty WebSocket.
 * Supports: SGR colors (16 + bright), cursor moves, line/scroll clears,
 * CR/LF/BS/TAB. Input is forwarded as raw bytes.
 */

const RESET = "color:inherit";
function fgColor(code) {
  // 30-37 / 90-97
  const base = [
    "#000000", "#cc0000", "#4e9a06", "#c4a000", "#3465a4", "#75507b", "#06989a", "#d3d7cf",
  ];
  if (code >= 90 && code <= 97) {
    const bright = ["#555753", "#ef2929", "#8ae234", "#fce94f", "#729fcf", "#ad7fa8", "#34e2e2", "#eeeeec"];
    return bright[code - 90];
  }
  if (code >= 30 && code <= 37) return base[code - 30];
  return null;
}
function bgColor(code) {
  const base = ["#000000", "#cc0000", "#4e9a06", "#c4a000", "#3465a4", "#75507b", "#06989a", "#d3d7cf"];
  if (code >= 100 && code <= 107) {
    const bright = ["#555753", "#ef2929", "#8ae234", "#fce94f", "#729fcf", "#ad7fa8", "#34e2e2", "#eeeeec"];
    return bright[code - 100];
  }
  if (code >= 40 && code <= 47) return base[code - 40];
  return null;
}

export function Terminal({ wsUrl, cwd, cols, rows, onExit }) {
  const [lines, setLines] = useState([{ cells: [], text: "" }]); // rows of {cells: [{ch, style}]}
  const gridRef = useRef(null);
  const wsRef = useRef(null);
  const stateRef = useRef({
    rows: [],
    row: 0,
    col: 0,
    style: "",
    // parser state
    esc: false,
    osc: false,
    csi: null,
    scrollback: 500,
  });
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;

  const pushRender = () => {
    const st = stateRef.current;
    setLines(
      st.rows.map((row) => ({
        cells: row,
        text: row.map((c) => c.ch).join(""),
      })),
    );
  };

  const ensureRows = (n) => {
    const st = stateRef.current;
    while (st.rows.length < n) {
      st.rows.push([]);
    }
    if (st.rows.length > st.scrollback + 200) {
      st.rows.splice(0, st.rows.length - st.scrollback);
      st.row = Math.max(0, st.row - (st.rows.length - (st.scrollback)));
    }
  };

  const putChar = (ch) => {
    const st = stateRef.current;
    ensureRows(st.row + 1);
    const row = st.rows[st.row];
    if (ch === "\n") {
      st.row += 1;
      st.col = 0;
      return;
    }
    if (ch === "\r") {
      st.col = 0;
      return;
    }
    if (ch === "\t") {
      const tabStop = 8;
      st.col = Math.ceil((st.col + 1) / tabStop) * tabStop;
      return;
    }
    if (ch === "\x08") {
      st.col = Math.max(0, st.col - 1);
      if (row[st.col]) row[st.col] = { ch: " ", style: st.style };
      return;
    }
    const cell = { ch, style: st.style };
    if (st.col < row.length) {
      row[st.col] = cell;
    } else {
      while (row.length < st.col) row.push({ ch: " ", style: st.style });
      row.push(cell);
    }
    st.col += 1;
  };

  const processText = (text) => {
    const st = stateRef.current;
    for (const ch of text) {
      if (st.esc) {
        if (ch === "[") {
          st.esc = false;
          st.csi = "";
        } else {
          // unsupported escape (e.g. ']' OSC) — swallow until BEL/ST
          st.esc = false;
          if (ch === "]") {
            st.osc = true;
          }
        }
        continue;
      }
      if (st.osc) {
        if (ch === "\x07" || ch === "\x1b") st.osc = false;
        continue;
      }
      if (st.csi !== null) {
        if ((ch >= "0" && ch <= "9") || ch === ";" || ch === "?") {
          st.csi += ch;
          continue;
        }
        const params = st.csi
          .split(";")
          .map((p) => parseInt(p, 10))
          .map((p) => (Number.isNaN(p) ? 0 : p));
        st.csi = null;
        handleCsi(ch, params, st);
        continue;
      }
      if (ch === "\x1b") {
        st.esc = true;
        st.osc = false;
        continue;
      }
      putChar(ch);
    }
    pushRender();
  };

  const handleCsi = (final, params, st) => {
    const p = (i, d) => (params.length > i && params[i] ? params[i] : d);
    switch (final) {
      case "m": {
        if (params.length === 0 || params[0] === 0) {
          st.style = "";
          break;
        }
        let fg = null;
        let bg = null;
        let bold = false;
        for (let i = 0; i < params.length; i++) {
          const c = params[i];
          if (c === 0) {
            fg = null;
            bg = null;
            bold = false;
          } else if (c === 1) {
            bold = true;
          } else if (c >= 30 && c <= 37) {
            fg = fgColor(c);
          } else if (c >= 90 && c <= 97) {
            fg = fgColor(c);
          } else if (c >= 40 && c <= 47) {
            bg = bgColor(c);
          } else if (c >= 100 && c <= 107) {
            bg = bgColor(c);
          }
        }
        const parts = [];
        if (bold) parts.push("font-weight:bold");
        if (fg) parts.push(`color:${fg}`);
        if (bg) parts.push(`background:${bg}`);
        st.style = parts.join(";");
        break;
      }
      case "A": // cursor up
        st.row = Math.max(0, st.row - p(0, 1));
        break;
      case "B": // cursor down
        st.row += p(0, 1);
        break;
      case "C": // forward
        st.col += p(0, 1);
        break;
      case "D": // backward
        st.col = Math.max(0, st.col - p(0, 1));
        break;
      case "G": // column
        st.col = p(0, 1) - 1;
        break;
      case "H":
      case "f": // cursor position
        st.row = p(0, 1) - 1;
        st.col = p(1, 1) - 1;
        break;
      case "J": {
        const mode = p(0, 0);
        if (mode === 2 || mode === 3) {
          st.rows = [];
          st.row = 0;
          st.col = 0;
        }
        break;
      }
      case "K": {
        const mode = p(0, 0);
        const row = st.rows[st.row] || [];
        if (mode === 0) row.length = Math.min(row.length, st.col);
        else if (mode === 2) row.length = 0;
        break;
      }
      default:
        break;
    }
  };

  // WebSocket wiring
  useEffect(() => {
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "spawn",
          id: "t1",
          cwd: cwdRef.current || "/",
          cols: cols || 80,
          rows: rows || 24,
        }),
      );
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === "output") {
        // feed in chunks so large outputs don't jank
        processText(msg.data);
      } else if (msg.type === "exit") {
        onExit?.(msg.code);
      }
    };
    return () => {
      try {
        ws.send(JSON.stringify({ type: "kill", id: "t1" }));
      } catch {
        /* noop */
      }
      ws.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  // resize reporting
  useEffect(() => {
    const report = () => {
      const el = gridRef.current;
      if (!el || !wsRef.current || wsRef.current.readyState !== 1) return;
      const charW = 8.2;
      const charH = 18;
      const c = Math.max(20, Math.floor(el.clientWidth / charW));
      const r = Math.max(5, Math.floor(el.clientHeight / charH));
      wsRef.current.send(JSON.stringify({ type: "resize", id: "t1", cols: c, rows: r }));
    };
    const t = setTimeout(report, 300);
    window.addEventListener("resize", report);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", report);
    };
  }, []);

  // input
  const onKeyDown = (e) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    e.preventDefault();
    let data = null;
    if (e.key === "Enter") data = "\r";
    else if (e.key === "Backspace") data = "\x7f";
    else if (e.key === "Tab") data = "\t";
    else if (e.key === "ArrowUp") data = "\x1b[A";
    else if (e.key === "ArrowDown") data = "\x1b[B";
    else if (e.key === "ArrowRight") data = "\x1b[C";
    else if (e.key === "ArrowLeft") data = "\x1b[D";
    else if (e.key === "Home") data = "\x1b[H";
    else if (e.key === "End") data = "\x1b[F";
    else if (e.key.length === 1) {
      if (e.ctrlKey) {
        const ch = e.key.toLowerCase();
        if (ch >= "a" && ch <= "z") data = String.fromCharCode(ch.charCodeAt(0) - 96);
      } else {
        data = e.key;
      }
    }
    if (data) ws.send(JSON.stringify({ type: "write", id: "t1", data }));
  };

  return (
    <div
      ref={gridRef}
      className="h-full w-full overflow-auto bg-black p-2 font-mono text-[13px] leading-[18px] text-slate-200 outline-none"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onClick={() => gridRef.current?.focus()}
    >
      {lines.map((line, i) => (
        <div key={i} className="whitespace-pre-wrap break-all">
          {line.cells.map((cell, j) =>
            cell.style ? (
              <span key={j} style={{ ...parseStyle(cell.style) }}>
                {cell.ch}
              </span>
            ) : (
              <span key={j}>{cell.ch}</span>
            ),
          )}
        </div>
      ))}
    </div>
  );
}

function parseStyle(style) {
  const out = {};
  for (const part of style.split(";")) {
    if (!part) continue;
    const [k, v] = part.split(":");
    if (k === "color") out.color = v;
    if (k === "background") out.background = v;
    if (k === "font-weight") out.fontWeight = v;
  }
  return out;
}
