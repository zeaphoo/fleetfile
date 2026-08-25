/**
 * OS clipboard interop for file lists (copy/cut file paths).
 * Wired through the Electron preload bridge when running inside the app;
 * silently degrades to in-app clipboard in a plain browser.
 */

export async function writeClipboardFiles(paths, operation) {
  if (window.electronAPI?.copyFiles) {
    try {
      await window.electronAPI.copyFiles(paths, operation);
      return true;
    } catch {
      /* fall through */
    }
  }
  return false;
}

/**
 * Returns an array of file paths from the OS clipboard, or null when the
 * clipboard holds no file list.
 */
export async function readClipboardFiles() {
  if (window.electronAPI?.readFiles) {
    try {
      const files = await window.electronAPI.readFiles();
      if (Array.isArray(files) && files.length > 0) return files;
    } catch {
      /* fall through */
    }
  }
  return null;
}
