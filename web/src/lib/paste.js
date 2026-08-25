import { api, errMsg, joinPath } from "@/lib/api";

/**
 * Paste clipboard files into targetPath.
 * Adapted from xplorer paste-helpers: pre-check conflicts, ask user per
 * conflict (skip/replace/keep-both with apply-to-all), then copy or move.
 * `op` is a client batch id forwarded to the server so all files in the batch
 * share one progress stream.
 */
export async function executePaste({ files, operation, targetPath, op, askConflict }) {
  const isCut = operation === "cut";
  let conflictMap = new Map();
  try {
    const conflicts = await api.checkConflicts(
      files.map((f) => f.path),
      targetPath,
    );
    for (const c of conflicts) {
      conflictMap.set(c.source.name, c);
    }
  } catch {
    // fall through to per-file existence check
  }

  let succeeded = 0;
  const errors = [];
  let applyToAllRes = null;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      let destination = joinPath(targetPath, file.name);

      const norm = (p) => p.replace(/[/\\]/g, "/").toLowerCase();
      if (norm(file.path) === norm(destination) && !isCut) {
        // pasting into the same dir: duplicate with "name (1).ext"
        destination = await api.getRenameDestination(targetPath, file.name);
      } else if (conflictMap.has(file.name)) {
        let resolution = applyToAllRes;
        if (!resolution && askConflict) {
          const conflict = conflictMap.get(file.name);
          const result = await askConflict({
            file,
            conflict,
            remaining: files.length - i - 1,
          });
          resolution = result.resolution;
          if (result.applyToAll) applyToAllRes = resolution;
        }
        if (!resolution) resolution = "replace";
        if (resolution === "skip") {
          succeeded++;
          continue;
        }
        if (resolution === "keep-both") {
          destination = await api.getRenameDestination(targetPath, file.name);
        }
        if (resolution === "replace") {
          try {
            await api.deleteEntry(destination, false);
          } catch {
            // destination may be gone already
          }
        }
      }

      if (isCut) {
        await api.moveEntry(file.path, destination, op);
      } else {
        await api.copyEntry(file.path, destination, op);
      }
      succeeded++;
    } catch (e) {
      errors.push(`${file.name}: ${errMsg(e)}`);
    }
  }

  return { succeeded, errors, isCut };
}
