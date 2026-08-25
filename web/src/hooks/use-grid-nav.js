import { useCallback, useEffect, useRef } from "react";

/**
 * Arrow-key navigation over a grid/list of files.
 * Returns { onKeyDown } to attach to a focusable container.
 */
export function useGridKeyboardNav({
  entries,
  selection,
  selectIndex,
  select,
  onEnter,
  containerRef,
  itemWidth = 112,
  gap = 8,
  enabled = true,
}) {
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const onKeyDown = useCallback(
    (e) => {
      if (!enabled) return;
      const list = entriesRef.current;
      if (!list.length) return;
      const sel = selection || [];

      const currentIndex = () => {
        if (!sel.length) return -1;
        const last = sel[sel.length - 1];
        return list.findIndex((x) => x.path === last.path);
      };

      const move = (next) => {
        if (next < 0) next = 0;
        if (next >= list.length) next = list.length - 1;
        if (next === currentIndex()) return;
        if (e.shiftKey) {
          // extend selection toward the new index
          select?.(list[next], { shift: true });
        } else {
          selectIndex?.(next);
        }
        const el = containerRef?.current?.querySelector(
          `[data-file-index="${next}"]`,
        );
        el?.scrollIntoView({ block: "nearest" });
      };

      const cols = () => {
        const w = containerRef?.current?.clientWidth || 600;
        return Math.max(1, Math.floor((w + gap) / (itemWidth + gap)));
      };

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          move(currentIndex() + (e.ctrlKey || e.metaKey ? 0 : 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          move(currentIndex() - (e.ctrlKey || e.metaKey ? 0 : 1));
          break;
        case "ArrowRight":
          e.preventDefault();
          move(currentIndex() + 1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          move(currentIndex() - 1);
          break;
        case "Home":
          e.preventDefault();
          move(0);
          break;
        case "End":
          e.preventDefault();
          move(list.length - 1);
          break;
        case "Enter":
          e.preventDefault();
          if (currentIndex() >= 0) onEnter?.(list[currentIndex()]);
          break;
        default:
          break;
      }
    },
    [selection, selectIndex, select, onEnter, containerRef, itemWidth, gap, enabled],
  );

  useEffect(() => {
    if (!enabled) return;
    const el = containerRef?.current;
    if (!el) return;
    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [enabled, onKeyDown, containerRef]);

  return { onKeyDown };
}
