/**
 * In-app drag & drop state. HTML5 DataTransfer cannot carry plain path strings
 * reliably between views, so we keep the dragged paths + operation here and
 * only use DataTransfer for visual feedback / external drops.
 */
let dragState = null;

export function setDrag(payload) {
  dragState = payload; // { paths: string[], operation: 'copy' | 'move' }
}

export function getDrag() {
  return dragState;
}

export function clearDrag() {
  dragState = null;
}
