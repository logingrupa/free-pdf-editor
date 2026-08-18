// Document state, undo history and IndexedDB autosave.
// Geometry lives in "page display space": origin top-left, units = PDF points,
// measured on the page as it looks before the user rotates it (delta = 0).

import { uid, debounce } from './util.js';

export const state = {
  fileName: '',
  sources: [],   // [{id, name, bytes:ArrayBuffer}]
  pages: [],     // [{id, srcId, index, rot0, delta, w, h, m}]
  annots: [],    // [{id, page, type, ...}]
  zoom: 1,
  fit: true,
  tool: 'edit',
  sel: null,
  style: {
    pen:       { color: '#e11d48', width: 2.5 },
    highlight: { fill: '#ffe14d', opacity: 0.4 },
    rect:      { color: '#e11d48', width: 2, fill: 'none' },
    ellipse:   { color: '#e11d48', width: 2, fill: 'none' },
    arrow:     { color: '#e11d48', width: 2.5 },
    whiteout:  { fill: '#ffffff' },
    text:      {
      color: '#111827', size: 14, family: 'sans', bold: false, italic: false, align: 'left',
      pad: 4, boxFill: 'none', boxColor: 'none', boxWidth: 0, radius: 0, shadow: 0, shadowColor: '#111827',
    },
  },
};

/* ---- events ---------------------------------------------------------- */
const subs = new Map();
export function on(evt, fn) { (subs.get(evt) || subs.set(evt, []).get(evt)).push(fn); }
export function emit(evt, data) { (subs.get(evt) || []).forEach(fn => fn(data)); }

/* ---- lookups --------------------------------------------------------- */
export const pageById = id => state.pages.find(p => p.id === id);
export const annotsOf = id => state.annots.filter(a => a.page === id);
export const annotById = id => state.annots.find(a => a.id === id);
export const srcById = id => state.sources.find(s => s.id === id);
export const hasDoc = () => state.pages.length > 0;

/* ---- history --------------------------------------------------------- */
let past = [], future = [];
const snap = () => JSON.stringify({ pages: state.pages, annots: state.annots, fileName: state.fileName });

function restore(json) {
  const d = JSON.parse(json);
  state.pages = d.pages;
  state.annots = d.annots;
  state.fileName = d.fileName;
  state.sel = null;
  emit('doc');
  emit('sel');
  changed();
}

/** Snapshot the current document. Call once, right before mutating. */
export function commit() {
  past.push(snap());
  if (past.length > 80) past.shift();
  future.length = 0;
  emit('history');
}
export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;
export function undo() { if (!past.length) return; future.push(snap()); restore(past.pop()); emit('history'); }
export function redo() { if (!future.length) return; past.push(snap()); restore(future.pop()); emit('history'); }
function clearHistory() { past = []; future = []; emit('history'); }

/* ---- mutations ------------------------------------------------------- */
export function setDoc({ fileName, sources, pages, annots }) {
  state.fileName = fileName;
  state.sources = sources;
  state.pages = pages;
  state.annots = annots || [];
  state.sel = null;
  clearHistory();
  emit('doc');
  emit('sel');
  changed();
}

export function addSource(src, pages) {
  commit();
  state.sources.push(src);
  state.pages.push(...pages);
  emit('doc');
  changed();
}

export function closeDoc() {
  state.fileName = '';
  state.sources = [];
  state.pages = [];
  state.annots = [];
  state.sel = null;
  clearHistory();
  emit('doc');
  emit('sel');
  wipe();
}

export function addAnnot(a) {
  commit();
  a.id = uid();
  state.annots.push(a);
  emit('annots', a.page);
  changed();
  return a;
}

/** patch an annotation; pass {silent:true} while dragging to skip a history entry */
export function updateAnnot(id, patch, opts = {}) {
  const a = annotById(id);
  if (!a) return;
  if (!opts.silent) commit();
  Object.assign(a, patch);
  emit('annots', a.page);
  if (!opts.silent) changed();
}

export function touch(pageId) { emit('annots', pageId); changed(); }

export function removeAnnot(id) {
  const a = annotById(id);
  if (!a) return;
  commit();
  state.annots = state.annots.filter(x => x.id !== id);
  if (state.sel === id) { state.sel = null; emit('sel'); }
  emit('annots', a.page);
  changed();
}

/** Drop an annotation without touching history (cancelled drags, empty text). */
export function discardAnnot(id) {
  state.annots = state.annots.filter(x => x.id !== id);
  if (state.sel === id) { state.sel = null; emit('sel'); }
}

/** Copy an annotation just above the original, offset so the copy is visible. */
export function duplicateAnnot(id) {
  const a = annotById(id);
  if (!a) return null;
  commit();
  const copy = JSON.parse(JSON.stringify(a));
  copy.id = uid();
  const d = 12;
  if (copy.type === 'pen') copy.pts = copy.pts.map(pt => [pt[0] + d, pt[1] + d]);
  else if (copy.type === 'arrow') { copy.x1 += d; copy.y1 += d; copy.x2 += d; copy.y2 += d; }
  else { copy.x += d; copy.y += d; }
  // the copy covers no printed line of its own, so it frees the one it came from
  if (copy.type === 'etext') { copy.mx += d; copy.my += d; delete copy.src; }
  state.annots.splice(state.annots.indexOf(a) + 1, 0, copy);
  state.sel = copy.id;
  emit('annots', copy.page);
  emit('sel');
  changed();
  return copy;
}

/** One step up or down the page's draw order. */
export function restackAnnot(id, dir) {
  const a = annotById(id);
  if (!a) return;
  const mine = state.annots.filter(x => x.page === a.page);
  const from = mine.indexOf(a);
  moveAnnot(a.page, from, Math.min(mine.length - 1, Math.max(0, from + dir)));
}

export function select(id) {
  if (state.sel === id) return;
  state.sel = id;
  emit('sel');
}

export function setTool(tool) {
  state.tool = tool;
  if (tool !== 'select') select(null);
  emit('tool');
}

export function rotatePage(id, dir) {
  const p = pageById(id);
  commit();
  p.delta = (p.delta + dir * 90 + 360) % 360;
  emit('doc');
  changed();
}

export function deletePage(id) {
  commit();
  state.pages = state.pages.filter(p => p.id !== id);
  state.annots = state.annots.filter(a => a.page !== id);
  emit('doc');
  changed();
}

export function movePage(from, to) {
  if (from === to) return;
  commit();
  const [p] = state.pages.splice(from, 1);
  state.pages.splice(to, 0, p);
  emit('doc');
  changed();
}

/**
 * Reorder one page's annotations. Draw order is stack order, so this is what
 * decides which annotation covers which. Other pages keep their slots.
 */
export function moveAnnot(pageId, from, to) {
  if (from === to) return;
  const mine = state.annots.filter(a => a.page === pageId);
  if (from < 0 || to < 0 || from >= mine.length || to >= mine.length) return;
  commit();
  const [moved] = mine.splice(from, 1);
  mine.splice(to, 0, moved);
  const slots = [];
  state.annots.forEach((a, i) => { if (a.page === pageId) slots.push(i); });
  slots.forEach((slot, k) => { state.annots[slot] = mine[k]; });
  emit('annots', pageId);
  changed();
}

/* ---- persistence ----------------------------------------------------- */
const DB = 'edit-pdf', STORE = 'doc', KEY = 'current';
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  return dbp;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const rq = fn(t.objectStore(STORE));
    t.oncomplete = () => res(rq && rq.result);
    t.onerror = () => rej(t.error);
  });
}

const save = debounce(async () => {
  if (!hasDoc()) return;
  try {
    await tx('readwrite', s => s.put({
      fileName: state.fileName,
      sources: state.sources,
      pages: state.pages,
      annots: state.annots,
      at: Date.now(),
    }, KEY));
    emit('saved', Date.now());
  } catch (e) {
    emit('saveerror', e);
  }
}, 500);

function changed() { emit('dirty'); save(); }

export async function loadSaved() {
  try { return await tx('readonly', s => s.get(KEY)); }
  catch { return null; }
}

export async function wipe() {
  try { await tx('readwrite', s => s.delete(KEY)); } catch { /* nothing saved */ }
}
