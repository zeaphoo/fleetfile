const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  copyFiles: (paths, operation) => ipcRenderer.invoke("clipboard:copy-files", { paths, operation }),
  readFiles: () => ipcRenderer.invoke("clipboard:read-files"),
});
