const { app, BrowserWindow, shell, ipcMain, clipboard } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const { pathToFileURL, fileURLToPath } = require("url");

let serverProcess = null;
let mainWindow = null;
const SERVER_PORT = 3380;

// ── OS clipboard file-list interop ─────────────────────────────────────────
// Copies a list of file paths to the OS clipboard as a URI list (and plain
// text) so other file managers can paste them; reads the same on paste.

function toFileUris(paths) {
  return paths.map((p) => {
    try {
      return pathToFileURL(path.resolve(p)).href;
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function parseClipboardFileList(raw) {
  const paths = [];
  for (const line of String(raw || "").split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    if (s.startsWith("file://")) {
      try {
        const p = fileURLToPath(s);
        if (p) paths.push(p);
      } catch {
        /* skip malformed uris */
      }
    } else if (!s.startsWith("http://") && !s.startsWith("https://") && /[/\\]/.test(s)) {
      // plain text path (what we write on Windows)
      paths.push(s);
    }
  }
  return paths;
}

ipcMain.handle("clipboard:copy-files", (_event, { paths, operation }) => {
  if (!Array.isArray(paths) || paths.length === 0) return false;
  const uris = toFileUris(paths);
  if (!uris.length) return false;
  const text = uris.join("\n");
  clipboard.write({ text });
  if (process.platform === "linux") {
    try {
      clipboard.writeBuffer("text/uri-list", Buffer.from(text + "\n", "utf8"));
    } catch {
      /* buffer formats are best-effort */
    }
  }
  return true;
});

ipcMain.handle("clipboard:read-files", () => {
  let raw = "";
  try {
    raw = clipboard.read("text/uri-list") || clipboard.readText();
  } catch {
    raw = clipboard.readText();
  }
  return parseClipboardFileList(raw);
});

function getServerBinaryPath() {
  if (app.isPackaged) {
    const ext = process.platform === "win32" ? ".exe" : "";
    return path.join(process.resourcesPath, "bin", `fleetfile-server${ext}`);
  }
  return path.join(__dirname, "..", "target", "debug", "fleetfile-server");
}

function getWebDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "web");
  }
  return path.join(__dirname, "..", "web", "dist");
}

function startServer() {
  const binPath = getServerBinaryPath();
  const webDir = getWebDir();

  serverProcess = spawn(binPath, [], {
    env: {
      ...process.env,
      FLEETFILE_PORT: String(SERVER_PORT),
      FLEETFILE_WEB_DIR: webDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (data) => {
    console.log(`[server] ${data.toString().trim()}`);
  });

  serverProcess.stderr.on("data", (data) => {
    console.error(`[server] ${data.toString().trim()}`);
  });

  serverProcess.on("exit", (code) => {
    console.log(`Server exited with code ${code}`);
    serverProcess = null;
  });
}

function waitForServer(maxRetries = 50, interval = 200) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const req = http.get(`http://127.0.0.1:${SERVER_PORT}/api/drives`, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        attempts++;
        if (attempts >= maxRetries) {
          reject(new Error("Server did not start in time"));
        } else {
          setTimeout(check, interval);
        }
      });
    };
    check();
  });
}

function killServer() {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "FleetFile",
    // Native window frame (system title bar). The web UI does not draw one.
    icon: path.join(__dirname, "icons", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${SERVER_PORT}`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  startServer();
  try {
    await waitForServer();
    createWindow();
  } catch (err) {
    console.error("Failed to start server:", err);
    killServer();
    app.quit();
  }
});

app.on("window-all-closed", () => {
  killServer();
  app.quit();
});

app.on("before-quit", () => {
  killServer();
});
