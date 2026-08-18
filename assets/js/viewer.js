// Page rendering (pdf.js canvas), the SVG annotation layer, the existing-text
// layer and all pointer work.

import { state, on, emit, pageById, annotsOf, annotById, srcById, select, commit, addAnnot, discardAnnot, touch } from './store.js';
import { uid, clamp, invert, mul } from './util.js';
import { FAMILIES, LINE_H, cssFamily, fontKey, loadFont, fontReady, layout, ascentOf, matchFace, warmFaces } from './text.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const DPR = Math.min(window.devicePixelRatio || 1, 2);
const pdfjs = window.pdfjsLib;
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdf.worker.min.js', import.meta.url).href;

const docs = new Map();      // srcId -> Promise<PDFDocumentProxy>
const wraps = new Map();     // pageId -> {wrap, page, canvas, svg, g, rendered, task}
const lineCache = new Map(); // pageId -> [text line]
let viewport = null;
let pendingImage = null;     // dataURL waiting to be placed
let editor = null;

export const getDoc = srcId => {
  if (!docs.has(srcId)) docs.set(srcId, pdfjs.getDocument({ data: srcById(srcId).bytes.slice(0) }).promise);
  return docs.get(srcId);
};

/** Read a dropped PDF into a source record + page records. */
export async function buildSource(name, bytes) {
  const src = { id: uid(), name, bytes };
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  docs.set(src.id, Promise.resolve(doc));
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i);
    const vp = pg.getViewport({ scale: 1 });
    pages.push({
      id: uid(), srcId: src.id, index: i - 1,
      rot0: ((pg.rotate % 360) + 360) % 360, delta: 0,
      w: vp.width, h: vp.height, m: invert(vp.transform),
    });
  }
  return { src, pages };
}

export const setPendingImage = d => { pendingImage = d; };

/* ---- geometry -------------------------------------------------------- */
const swapped = p => p.delta % 180 !== 0;
export const dispW = p => (swapped(p) ? p.h : p.w);
export const dispH = p => (swapped(p) ? p.w : p.h);

function rotTransform(p) {
  if (p.delta === 90) return `translate(${p.h} 0) rotate(90)`;
  if (p.delta === 180) return `translate(${p.w} ${p.h}) rotate(180)`;
  if (p.delta === 270) return `translate(0 ${p.w}) rotate(270)`;
  return '';
}

/** Base display point -> pixel in the rendered canvas. */
function toCanvas(p, rec, x, y) {
  let X = x, Y = y;
  if (p.delta === 90) { X = p.h - y; Y = x; }
  else if (p.delta === 180) { X = p.w - x; Y = p.h - y; }
  else if (p.delta === 270) { X = y; Y = p.w - x; }
  return [X * (rec.canvas.width / dispW(p)), Y * (rec.canvas.height / dispH(p))];
}

const el = (tag, attrs) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
  return n;
};

/* ---- annotation drawing ---------------------------------------------- */
function penPath(a) {
  return a.pts.map((pt, i) => (i ? 'L' : 'M') + pt[0].toFixed(2) + ' ' + pt[1].toFixed(2)).join(' ');
}

export function box(a) {
  if (a.type === 'pen') {
    const xs = a.pts.map(p => p[0]), ys = a.pts.map(p => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  if (a.type === 'arrow') {
    return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
  }
  if (a.type === 'text' || a.type === 'etext') {
    const f = fontReady(fontKey(a));
    const h = f ? layout(a, f).height : a.size * LINE_H;
    if (a.type !== 'etext') return { x: a.x, y: a.y, w: a.w, h };
    const x = Math.min(a.x, a.mx), y = Math.min(a.y, a.my);
    return { x, y, w: Math.max(a.x + a.w, a.mx + a.mw) - x, h: Math.max(a.y + h, a.my + a.mh) - y };
  }
  return { x: a.x, y: a.y, w: a.w, h: a.h };
}

/** Arrow head as a path, sized off the stroke width. */
function headPath(a) {
  const len = Math.max(7, a.width * 3.4);
  const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
  const p = t => [a.x2 - len * Math.cos(ang - t), a.y2 - len * Math.sin(ang - t)];
  const [lx, ly] = p(0.42), [rx, ry] = p(-0.42);
  return `M${lx} ${ly} L${a.x2} ${a.y2} L${rx} ${ry}`;
}

/** Shared by the plain text box and the replaced-text annotation. */
function appendText(g, a) {
  const key = fontKey(a);
  const f = fontReady(key);
  if (!f) { loadFont(key).then(() => emit('annots', a.page)); return; }
  const { lines, height, width } = layout(a, f);
  const left = lines.length ? Math.min(...lines.map(l => l.x)) : a.x;
  g.append(el('rect', { class: 'hit', x: left, y: a.y, width: Math.max(width, 12), height, 'pointer-events': 'all', stroke: 'none' }));
  for (const ln of lines) {
    if (!ln.text) continue;
    const t = el('text', {
      x: ln.x, y: ln.y, fill: a.color, 'font-family': cssFamily(key), 'font-size': a.size,
      'font-weight': a.bold ? 700 : 400, 'font-style': a.italic ? 'italic' : 'normal',
      'pointer-events': 'none', 'xml:space': 'preserve',
    });
    t.textContent = ln.text;
    g.append(t);
  }
}

function drawAnnot(a) {
  const g = el('g', { class: 'an', 'data-id': a.id });
  const stroke = { stroke: a.color, 'stroke-width': a.width, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };

  if (a.type === 'pen') {
    g.append(el('path', { d: penPath(a), ...stroke, 'pointer-events': 'none' }));
    g.append(el('path', { class: 'hit', d: penPath(a), fill: 'none', 'stroke-width': Math.max(a.width, 10), 'pointer-events': 'stroke' }));
  } else if (a.type === 'arrow') {
    g.append(el('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, ...stroke, 'pointer-events': 'none' }));
    g.append(el('path', { d: headPath(a), ...stroke, 'pointer-events': 'none' }));
    g.append(el('line', { class: 'hit', x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, 'stroke-width': 12, 'pointer-events': 'stroke' }));
  } else if (a.type === 'rect' || a.type === 'whiteout' || a.type === 'highlight') {
    g.append(el('rect', {
      x: a.x, y: a.y, width: Math.max(a.w, 0), height: Math.max(a.h, 0),
      fill: a.fill && a.fill !== 'none' ? a.fill : 'none',
      'fill-opacity': a.opacity !== undefined ? a.opacity : 1,
      stroke: a.width ? a.color : 'none', 'stroke-width': a.width || 0,
      'pointer-events': 'all',
    }));
  } else if (a.type === 'ellipse') {
    g.append(el('ellipse', {
      cx: a.x + a.w / 2, cy: a.y + a.h / 2, rx: Math.abs(a.w / 2), ry: Math.abs(a.h / 2),
      fill: a.fill && a.fill !== 'none' ? a.fill : 'none',
      stroke: a.color, 'stroke-width': a.width, 'pointer-events': 'all',
    }));
  } else if (a.type === 'image') {
    g.append(el('image', { href: a.src, x: a.x, y: a.y, width: a.w, height: a.h, preserveAspectRatio: 'none', 'pointer-events': 'all' }));
  } else if (a.type === 'etext') {
    g.append(el('rect', { x: a.mx, y: a.my, width: a.mw, height: a.mh, fill: a.bg, stroke: 'none', 'pointer-events': 'all' }));
    appendText(g, a);
  } else if (a.type === 'text') {
    appendText(g, a);
  }
  return g;
}

/* ---- existing page text ---------------------------------------------- */
const famOf = css => (/mono/i.test(css || '') ? 'mono'
  : /serif/i.test(css || '') && !/sans/i.test(css || '') ? 'serif' : 'sans');

/** Group the page's own text items into editable lines, in display space. */
async function getLines(p) {
  if (lineCache.has(p.id)) return lineCache.get(p.id);
  const doc = await getDoc(p.srcId);
  const pg = await doc.getPage(p.index + 1);
  const vp = pg.getViewport({ scale: 1 });
  const tc = await pg.getTextContent();

  const parts = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const tx = mul(vp.transform, it.transform);
    const size = Math.hypot(tx[2], tx[3]);
    if (size < 2 || Math.abs(Math.atan2(tx[1], tx[0])) > 0.02) continue;   // upright text only
    const st = tc.styles[it.fontName] || {};
    parts.push({
      str: it.str, x: tx[4], y: tx[5], size, w: it.width,
      fam: famOf(st.fontFamily), asc: st.ascent || 0.83, desc: st.descent || -0.21,
    });
  }
  parts.sort((a, b) => (a.y - b.y) || (a.x - b.x));

  const lines = [];
  let cur = null;
  for (const it of parts) {
    const sameLine = cur && Math.abs(it.y - cur.y) <= cur.size * 0.35
      && it.x >= cur.x2 - cur.size && it.x - cur.x2 <= cur.size * 2;
    if (sameLine) {
      const gap = it.x - cur.x2;
      const space = gap > cur.size * 0.18 && !/\s$/.test(cur.str) && !/^\s/.test(it.str);
      cur.str += (space ? ' ' : '') + it.str;
      cur.x2 = it.x + it.w;
      cur.size = Math.max(cur.size, it.size);
    } else {
      if (cur) lines.push(cur);
      cur = {
        id: `${p.id}:${lines.length}`, x: it.x, y: it.y, x2: it.x + it.w,
        size: it.size, str: it.str, fam: it.fam, asc: it.asc, desc: it.desc,
      };
    }
  }
  if (cur) lines.push(cur);
  lineCache.set(p.id, lines);
  return lines;
}

const lineBox = ln => ({
  x: ln.x - ln.size * 0.1,
  y: ln.y - ln.size * ln.asc - ln.size * 0.06,
  w: Math.max(6, ln.x2 - ln.x) + ln.size * 0.2,
  h: ln.size * (ln.asc - ln.desc) + ln.size * 0.12,
});

/** Read the ink and paper colour straight off the rendered page. */
function sampleColors(p, rec, b) {
  const fallback = { bg: '#ffffff', fg: '#111827' };
  const c1 = toCanvas(p, rec, b.x, b.y), c2 = toCanvas(p, rec, b.x + b.w, b.y + b.h);
  const x = Math.max(0, Math.floor(Math.min(c1[0], c2[0])));
  const y = Math.max(0, Math.floor(Math.min(c1[1], c2[1])));
  const w = Math.floor(Math.min(rec.canvas.width - x, Math.abs(c2[0] - c1[0])));
  const h = Math.floor(Math.min(rec.canvas.height - y, Math.abs(c2[1] - c1[1])));
  if (w < 1 || h < 1) return fallback;
  let d;
  try { d = rec.canvas.getContext('2d').getImageData(x, y, w, h).data; } catch { return fallback; }

  const counts = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let bgk = 0, best = -1;
  for (const [k, n] of counts) if (n > best) { best = n; bgk = k; }
  // average the real pixels of that bucket, so plain white stays exactly white
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
    if (k === bgk) { sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; n++; }
  }
  const bg = [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)];

  let fg = null, far = -1;
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
    if (dist > far) { far = dist; fg = [d[i], d[i + 1], d[i + 2]]; }
  }
  const hex = c => '#' + c.map(v => Math.min(255, v).toString(16).padStart(2, '0')).join('');
  return { bg: hex(bg), fg: far > 40 ? hex(fg) : fallback.fg };
}

/** Cover one line of the original text and drop an editable copy on top. */
async function replaceLine(p, ln) {
  const rec = wraps.get(p.id);
  const b = lineBox(ln);
  const { bg, fg } = sampleColors(p, rec, b);
  const family = FAMILIES.includes(ln.fam) ? ln.fam : 'sans';
  const { bold, italic } = await matchFace(family, ln.str, ln.size, ln.x2 - ln.x);
  const f = await loadFont(fontKey({ family, bold, italic }));
  const a = addAnnot({
    page: p.id, type: 'etext', src: ln.id,
    mx: b.x, my: b.y, mw: b.w, mh: b.h, bg,
    x: ln.x, y: ln.y - ascentOf(f, ln.size), w: Math.max(ln.size * 4, p.w - ln.x - 6),
    text: ln.str, size: ln.size, color: fg, family, bold, italic, align: 'left',
  });
  select(a.id);
  paintOverlay(p.id);
  openEditor(p, a, true);
}

function paintTextLayer(p, host) {
  if (state.tool !== 'edit' || !isNear(wraps.get(p.id).wrap)) return;
  const lines = lineCache.get(p.id);
  if (!lines) { getLines(p).then(() => paintOverlay(p.id)); return; }
  // a click measures against these faces, so fetch them while a line is chosen
  warmFaces(new Set(lines.map(ln => (FAMILIES.includes(ln.fam) ? ln.fam : 'sans'))));
  const used = new Set(annotsOf(p.id).filter(a => a.src).map(a => a.src));
  const layer = el('g', { class: 'tlayer' });
  for (const ln of lines) {
    if (used.has(ln.id)) continue;
    const b = lineBox(ln);
    layer.append(el('rect', { class: 'tl', 'data-line': ln.id, x: b.x, y: b.y, width: b.w, height: b.h, rx: 2 }));
  }
  host.append(layer);
}

/* ---- overlay --------------------------------------------------------- */
function drawSelection(p, host) {
  const a = annotById(state.sel);
  if (!a || a.page !== p.id) return;
  const b = box(a);
  const s = 7 / (state.zoom || 1);           // handles keep a constant screen size
  const sel = el('g', { class: 'sel' });
  sel.append(el('rect', { class: 'selbox', x: b.x - 2, y: b.y - 2, width: b.w + 4, height: b.h + 4 }));

  const handle = (hx, hy, name) => el('rect', { class: 'h', 'data-h': name, x: hx - s / 2, y: hy - s / 2, width: s, height: s, rx: s / 4 });
  if (a.type === 'arrow') {
    sel.append(handle(a.x1, a.y1, 'p1'), handle(a.x2, a.y2, 'p2'));
  } else if (a.type === 'text' || a.type === 'etext') {
    sel.append(handle(a.x, b.y + b.h / 2, 'w'), handle(a.x + a.w, b.y + b.h / 2, 'e'));
  } else if (a.type !== 'pen') {
    sel.append(
      handle(b.x, b.y, 'nw'), handle(b.x + b.w, b.y, 'ne'),
      handle(b.x, b.y + b.h, 'sw'), handle(b.x + b.w, b.y + b.h, 'se'),
    );
  }
  host.append(sel);
}

function paintOverlay(pageId) {
  const rec = wraps.get(pageId);
  if (!rec) return;
  const p = pageById(pageId);
  rec.g.textContent = '';
  for (const a of annotsOf(pageId)) rec.g.append(drawAnnot(a));
  paintTextLayer(p, rec.g);
  drawSelection(p, rec.g);
}

/* ---- page canvases --------------------------------------------------- */
async function paintCanvas(p) {
  const rec = wraps.get(p.id);
  if (!rec) return;
  const key = `${p.delta}:${state.zoom.toFixed(3)}`;
  if (rec.rendered === key) return;
  rec.rendered = key;
  const doc = await getDoc(p.srcId);
  const pg = await doc.getPage(p.index + 1);
  const vp = pg.getViewport({ scale: state.zoom * DPR, rotation: (p.rot0 + p.delta) % 360 });
  const c = rec.canvas;
  if (rec.task) rec.task.cancel();
  c.width = Math.ceil(vp.width);
  c.height = Math.ceil(vp.height);
  rec.task = pg.render({ canvasContext: c.getContext('2d', { alpha: false, willReadFrequently: true }), viewport: vp });
  try { await rec.task.promise; } catch { /* superseded render */ }
  rec.task = null;
}

function sizePage(p) {
  const rec = wraps.get(p.id);
  const w = dispW(p) * state.zoom, h = dispH(p) * state.zoom;
  rec.wrap.style.width = w + 'px';
  rec.page.style.width = w + 'px';
  rec.page.style.height = h + 'px';
  rec.svg.setAttribute('viewBox', `0 0 ${dispW(p)} ${dispH(p)}`);
  rec.g.setAttribute('transform', rotTransform(p));
}

const io = new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) {
    const p = pageById(e.target.dataset.id);
    if (p) paintCanvas(p).then(() => paintOverlay(p.id));
  }
}, { rootMargin: '400px 0px' });

function buildAll() {
  closeEditor(false);
  for (const rec of wraps.values()) io.unobserve(rec.wrap);
  wraps.clear();
  viewport.textContent = '';
  state.pages.forEach((p, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'pagewrap';
    wrap.dataset.id = p.id;
    wrap.dataset.tool = state.tool;
    const page = document.createElement('div');
    page.className = 'page';
    const canvas = document.createElement('canvas');
    const svg = el('svg', { class: 'ov', preserveAspectRatio: 'none' });
    const g = el('g', { class: 'rot' });
    svg.append(g);
    page.append(canvas, svg);
    const num = document.createElement('div');
    num.className = 'pagenum';
    num.textContent = `${i + 1} / ${state.pages.length}`;
    wrap.append(page, num);
    viewport.append(wrap);
    wraps.set(p.id, { wrap, page, canvas, svg, g, rendered: null, task: null });
    sizePage(p);
    paintOverlay(p.id);
    svg.addEventListener('pointerdown', ev => onDown(ev, p));
    svg.addEventListener('dblclick', ev => onDblClick(ev, p));
    io.observe(wrap);
  });
  state.pages.forEach(p => { if (isNear(wraps.get(p.id).wrap)) paintCanvas(p); });
}

function isNear(elm) {
  const r = elm.getBoundingClientRect();
  return r.top < window.innerHeight + 400 && r.bottom > -400;
}

function resize() {
  for (const p of state.pages) { sizePage(p); if (isNear(wraps.get(p.id).wrap)) paintCanvas(p); }
  closeEditor(true);
}

/** Zoom so the widest page fits the stage. */
export function fitZoom() {
  if (!state.pages.length || !viewport) return 1;
  const avail = (viewport.parentElement || viewport).clientWidth - 52;
  const widest = Math.max(...state.pages.map(dispW));
  return clamp(avail / widest, 0.15, 3);
}

export function setZoom(z, fit = false) {
  state.zoom = clamp(z, 0.15, 5);
  state.fit = fit;
  resize();
  emit('zoom');
}

export function scrollToPage(id) {
  const rec = wraps.get(id);
  if (rec) rec.wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---- pointer --------------------------------------------------------- */
// whatever single-finger gesture is running, so a second finger can end it
let endGesture = null;

const local = (rec, ev) => {
  const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(rec.g.getScreenCTM().inverse());
  return { x: pt.x, y: pt.y };
};

/** Run fn at most once per frame. Pointer events outpace paints. */
function onFrame(fn) {
  let id = 0;
  const run = () => { if (!id) id = requestAnimationFrame(() => { id = 0; fn(); }); };
  run.cancel = () => { if (id) { cancelAnimationFrame(id); id = 0; } };
  return run;
}

const styleFor = tool => ({ ...state.style[tool] });

function onDown(ev, p) {
  if (ev.button !== 0) return;
  const rec = wraps.get(p.id);
  const pt = local(rec, ev);
  const tool = state.tool;

  if (tool === 'edit') {
    const tl = ev.target.closest('.tl');
    if (tl) {
      const ln = (lineCache.get(p.id) || []).find(l => l.id === tl.dataset.line);
      ev.preventDefault();
      // a failure here used to leave the click doing nothing at all
      if (ln) replaceLine(p, ln).catch(err => console.error('could not replace the line', err));
      return;
    }
  }

  if (tool === 'select' || tool === 'edit') {
    const h = ev.target.closest('.h');
    if (h && state.sel) return startResize(ev, p, annotById(state.sel), h.dataset.h);
    const hit = ev.target.closest('.an');
    if (hit) {
      select(hit.dataset.id);
      paintOverlay(p.id);
      return startMove(ev, p, annotById(hit.dataset.id));
    }
    if (ev.pointerType === 'touch') { startPan(ev, p); return; }
    select(null);
    paintOverlay(p.id);
    return;
  }

  if (tool === 'image') {
    if (!pendingImage) { emit('needimage'); return; }
    placeImage(p, pt);
    return;
  }

  if (tool === 'text') {
    ev.preventDefault();
    const a = addAnnot({
      page: p.id, type: 'text', x: pt.x, y: pt.y - state.style.text.size * 0.6,
      w: Math.min(260, Math.max(80, p.w - pt.x - 12)), text: '', ...styleFor('text'),
    });
    paintOverlay(p.id);
    openEditor(p, a, true);
    return;
  }

  ev.preventDefault();
  rec.svg.setPointerCapture(ev.pointerId);
  const a = startAnnot(tool, p, pt);
  paintOverlay(p.id);
  let node = rec.g.querySelector(`[data-id="${a.id}"]`);

  // every point is kept, only the redraw waits for the frame
  const redraw = onFrame(() => {
    const fresh = drawAnnot(a);
    node.replaceWith(fresh);
    node = fresh;
  });
  const move = e => {
    extendAnnot(a, local(rec, e));
    redraw();
  };
  const up = () => {
    endGesture = null;
    redraw.cancel();
    rec.svg.removeEventListener('pointermove', move);
    rec.svg.removeEventListener('pointerup', up);
    rec.svg.removeEventListener('pointercancel', up);
    normalize(a);
    if (isTiny(a)) discardAnnot(a.id);
    else if (state.tool !== 'pen') select(a.id);
    touch(p.id);
    paintOverlay(p.id);
  };
  endGesture = up;
  rec.svg.addEventListener('pointermove', move);
  rec.svg.addEventListener('pointerup', up);
  rec.svg.addEventListener('pointercancel', up);
}

function startAnnot(tool, p, pt) {
  const common = { page: p.id, type: tool };
  if (tool === 'pen') return addAnnot({ ...common, pts: [[pt.x, pt.y]], ...styleFor('pen') });
  if (tool === 'arrow') return addAnnot({ ...common, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y, ...styleFor('arrow') });
  if (tool === 'highlight') return addAnnot({ ...common, x: pt.x, y: pt.y, w: 0, h: 0, width: 0, ...styleFor('highlight') });
  if (tool === 'whiteout') return addAnnot({ ...common, x: pt.x, y: pt.y, w: 0, h: 0, width: 0, opacity: 1, ...styleFor('whiteout') });
  if (tool === 'rect') return addAnnot({ ...common, x: pt.x, y: pt.y, w: 0, h: 0, ...styleFor('rect'), opacity: 1 });
  return addAnnot({ ...common, x: pt.x, y: pt.y, w: 0, h: 0, ...styleFor('ellipse') });
}

function extendAnnot(a, q) {
  if (a.type === 'pen') {
    const last = a.pts[a.pts.length - 1];
    if (Math.hypot(q.x - last[0], q.y - last[1]) > 1.2) a.pts.push([q.x, q.y]);
  } else if (a.type === 'arrow') {
    a.x2 = q.x; a.y2 = q.y;
  } else {
    a.w = q.x - a.x; a.h = q.y - a.y;
  }
}

function normalize(a) {
  if (a.w < 0) { a.x += a.w; a.w = -a.w; }
  if (a.h < 0) { a.y += a.h; a.h = -a.h; }
}

function isTiny(a) {
  if (a.type === 'pen') return a.pts.length < 2;
  if (a.type === 'arrow') return Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < 4;
  return a.w < 4 || a.h < 4;
}

/** One finger on empty page space scrolls the document; a tap still deselects. */
function startPan(ev, p) {
  const sx = ev.clientX, sy = ev.clientY;
  const left = viewport.scrollLeft, top = viewport.scrollTop;
  let moved = false;

  const move = e => {
    if (e.pointerId !== ev.pointerId) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && Math.hypot(dx, dy) < 6) return;
    moved = true;
    viewport.scrollLeft = left - dx;
    viewport.scrollTop = top - dy;
  };
  const up = () => {
    endGesture = null;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (!moved) { select(null); paintOverlay(p.id); }
  };
  endGesture = up;
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/* ---- pinch to zoom --------------------------------------------------- */
// The overlay sets touch-action:none so the tools get every touch, which also
// means the browser will not zoom for us. Two fingers are handled here instead.
const grip = new Map();
let pinch = null;

function spread() {
  const [a, b] = [...grip.values()];
  return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
}

function pinchDown(ev) {
  if (ev.pointerType !== 'touch') return;
  grip.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (grip.size !== 2) return;
  ev.preventDefault();
  ev.stopPropagation();
  if (endGesture) endGesture();
  closeEditor(true);
  const { d, cx, cy } = spread();
  const r = viewport.getBoundingClientRect();
  // the point between the fingers, in unscaled content space, stays put
  pinch = {
    d,
    zoom: state.zoom,
    ax: (viewport.scrollLeft + cx - r.left) / state.zoom,
    ay: (viewport.scrollTop + cy - r.top) / state.zoom,
  };
}

function pinchMove(ev) {
  if (!grip.has(ev.pointerId)) return;
  grip.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (!pinch || grip.size !== 2) return;
  ev.preventDefault();
  ev.stopPropagation();
  const { d, cx, cy } = spread();
  state.zoom = clamp(pinch.zoom * (d / pinch.d), 0.15, 5);
  state.fit = false;
  // only resize: the rendered bitmap stretches, and a sharp one lands on release
  for (const p of state.pages) sizePage(p);
  const r = viewport.getBoundingClientRect();
  viewport.scrollLeft = pinch.ax * state.zoom - (cx - r.left);
  viewport.scrollTop = pinch.ay * state.zoom - (cy - r.top);
  emit('zoom');
}

function pinchUp(ev) {
  if (!grip.delete(ev.pointerId) || !pinch) return;
  pinch = null;
  setZoom(state.zoom);
}

/** Offset an annotation by a page-space delta, from a pre-drag snapshot. */
function shift(a, from, dx, dy) {
  if (a.type === 'pen') a.pts = from.pts.map(pt => [pt[0] + dx, pt[1] + dy]);
  else if (a.type === 'arrow') { a.x1 = from.x1 + dx; a.y1 = from.y1 + dy; a.x2 = from.x2 + dx; a.y2 = from.y2 + dy; }
  else { a.x = from.x + dx; a.y = from.y + dy; }
  if (a.type === 'etext') { a.mx = from.mx + dx; a.my = from.my + dy; }
}

// A move is a pure translation, so the drag only transforms the existing nodes
// and the model is written once on release. Rebuilding the overlay per event
// re-ran the text layout for every annotation on the page.
function startMove(ev, p, a) {
  const rec = wraps.get(p.id);
  const m = rec.g.getScreenCTM();          // scrolling shifts e and f, not a and d
  const sx = m.a || 1, sy = m.d || 1;
  const from = JSON.parse(JSON.stringify(a));
  let node = null, sel = null, moved = false, dx = 0, dy = 0;

  const live = () => {
    if (!node || !node.isConnected) node = rec.g.querySelector(`[data-id="${a.id}"]`);
    if (!sel || !sel.isConnected) sel = rec.g.querySelector('.sel');
    return [node, sel];
  };
  const paint = onFrame(() => {
    const tr = `translate(${dx} ${dy})`;
    for (const n of live()) if (n) n.setAttribute('transform', tr);
  });

  rec.svg.setPointerCapture(ev.pointerId);

  const move = e => {
    if (!moved && Math.hypot(e.clientX - ev.clientX, e.clientY - ev.clientY) < 3) return;
    if (!moved) { moved = true; commit(); }
    dx = (e.clientX - ev.clientX) / sx;
    dy = (e.clientY - ev.clientY) / sy;
    paint();
  };
  const up = () => {
    endGesture = null;
    paint.cancel();
    rec.svg.removeEventListener('pointermove', move);
    rec.svg.removeEventListener('pointerup', up);
    rec.svg.removeEventListener('pointercancel', up);
    if (!moved) return;
    for (const n of live()) if (n) n.removeAttribute('transform');
    shift(a, from, dx, dy);
    touch(p.id);
    paintOverlay(p.id);
  };
  endGesture = up;
  rec.svg.addEventListener('pointermove', move);
  rec.svg.addEventListener('pointerup', up);
  rec.svg.addEventListener('pointercancel', up);
}

function startResize(ev, p, a, h) {
  ev.stopPropagation();
  const rec = wraps.get(p.id);
  const from = JSON.parse(JSON.stringify(a));
  let moved = false;
  rec.svg.setPointerCapture(ev.pointerId);
  const repaint = onFrame(() => paintOverlay(p.id));

  const move = e => {
    const q = local(rec, e);
    if (!moved) { moved = true; commit(); }
    if (a.type === 'arrow') {
      if (h === 'p1') { a.x1 = q.x; a.y1 = q.y; } else { a.x2 = q.x; a.y2 = q.y; }
    } else if (a.type === 'text' || a.type === 'etext') {
      if (h === 'e') a.w = Math.max(24, q.x - a.x);
      else { const right = from.x + from.w; a.x = Math.min(q.x, right - 24); a.w = right - a.x; }
    } else {
      const r = from.x + from.w, b = from.y + from.h;
      if (h.includes('w')) { a.x = Math.min(q.x, r - 6); a.w = r - a.x; }
      if (h.includes('e')) a.w = Math.max(6, q.x - a.x);
      if (h.includes('n')) { a.y = Math.min(q.y, b - 6); a.h = b - a.y; }
      if (h.includes('s')) a.h = Math.max(6, q.y - a.y);
    }
    repaint();
  };
  const up = () => {
    endGesture = null;
    repaint.cancel();
    rec.svg.removeEventListener('pointermove', move);
    rec.svg.removeEventListener('pointerup', up);
    rec.svg.removeEventListener('pointercancel', up);
    if (moved) { touch(p.id); paintOverlay(p.id); }
  };
  endGesture = up;
  rec.svg.addEventListener('pointermove', move);
  rec.svg.addEventListener('pointerup', up);
  rec.svg.addEventListener('pointercancel', up);
}

function onDblClick(ev, p) {
  const hit = ev.target.closest('.an');
  if (!hit) return;
  const a = annotById(hit.dataset.id);
  if (a && (a.type === 'text' || a.type === 'etext')) { select(a.id); openEditor(p, a, false); }
}

async function placeImage(p, pt) {
  const img = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = pendingImage; });
  const w = Math.min(img.naturalWidth * 0.75, p.w * 0.45);
  const a = addAnnot({
    page: p.id, type: 'image', src: pendingImage,
    x: pt.x, y: pt.y, w, h: w * (img.naturalHeight / img.naturalWidth),
  });
  pendingImage = null;
  select(a.id);
  paintOverlay(p.id);
  emit('placed');
}

/* ---- text editor ----------------------------------------------------- */
export function openEditor(p, a, isNew) {
  closeEditor(false);
  const rec = wraps.get(p.id);
  const key = fontKey(a);
  loadFont(key).then(() => {
    const m = rec.g.getScreenCTM();
    const ta = document.createElement('textarea');
    ta.className = 'editbox';
    ta.value = a.text;
    const st = ta.style;
    st.position = 'fixed';
    st.left = '0';
    st.top = '0';
    st.transformOrigin = '0 0';
    st.transform = `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f}) translate(${a.x}px,${a.y}px)`;
    st.width = a.w + 'px';
    st.fontFamily = `${cssFamily(key)}, sans-serif`;
    st.fontSize = a.size + 'px';
    st.lineHeight = LINE_H;
    st.fontWeight = a.bold ? 700 : 400;
    st.fontStyle = a.italic ? 'italic' : 'normal';
    st.color = a.color;
    st.textAlign = a.align;
    document.body.append(ta);
    editor = { ta, a, p, isNew, was: a.text };

    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(a.size * LINE_H, ta.scrollHeight) + 'px'; };
    grow();
    ta.addEventListener('input', () => { a.text = ta.value; grow(); });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); closeEditor(true); }
      e.stopPropagation();
    });
    const node = rec.g.querySelector(`[data-id="${a.id}"]`);
    if (node) node.style.display = 'none';        // hide the rendered copy while editing
    // focus after the click that opened it settles, or that mouseup blurs us straight away
    requestAnimationFrame(() => {
      if (editor && editor.ta === ta) {
        ta.focus();
        if (isNew) ta.select();
        ta.addEventListener('blur', () => closeEditor(true));
      }
    });
  });
}

export function closeEditor(persist) {
  if (!editor) return;
  const { ta, a, p, isNew, was } = editor;
  editor = null;
  a.text = ta.value;
  ta.remove();
  if (!a.text.trim() && a.type === 'text') discardAnnot(a.id);   // an empty cover-up is a deletion
  // a cancelled click on printed text must leave the page as it was
  else if (isNew && a.type === 'etext' && a.text === was) discardAnnot(a.id);
  paintOverlay(p.id);
  if (persist || isNew) touch(p.id);
}

export const isEditing = () => !!editor;

/* ---- thumbnails ------------------------------------------------------ */
export async function renderThumb(p, canvas, cssWidth) {
  const doc = await getDoc(p.srcId);
  const pg = await doc.getPage(p.index + 1);
  const vp = pg.getViewport({ scale: (cssWidth / dispW(p)) * DPR, rotation: (p.rot0 + p.delta) % 360 });
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  await pg.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: vp }).promise;
}

/* ---- wiring ---------------------------------------------------------- */
export function init(viewportEl) {
  viewport = viewportEl;
  viewport.addEventListener('pointerdown', pinchDown, { capture: true });
  viewport.addEventListener('pointermove', pinchMove, { capture: true });
  viewport.addEventListener('pointerup', pinchUp, { capture: true });
  viewport.addEventListener('pointercancel', pinchUp, { capture: true });
  on('doc', () => { buildAll(); if (state.fit) setZoom(fitZoom(), true); });
  on('annots', id => paintOverlay(id));
  on('sel', () => state.pages.forEach(p => paintOverlay(p.id)));
  on('tool', () => {
    closeEditor(true);
    wraps.forEach(r => { r.wrap.dataset.tool = state.tool; });
    state.pages.forEach(p => paintOverlay(p.id));
  });
  window.addEventListener('resize', () => { if (state.fit) setZoom(fitZoom(), true); else resize(); });
}
