// Page rendering (pdf.js canvas), the SVG annotation layer, the existing-text
// layer and all pointer work.

import { state, on, emit, pageById, annotsOf, annotById, srcById, select, commit, addAnnot, updateAnnot, discardAnnot, removeAnnot, duplicateAnnot, restackAnnot, rotatePage, deletePage, duplicatePage, touch } from './store.js';
import { uid, clamp, invert, mul, turn, canTurn, rotCenter } from './util.js';
import { ICON } from './icons.js';
import { openMenu, closeMenu, onLongPress } from './menu.js';
import { METRIC, LINE_H, cssFamily, fontKey, loadFont, loadFaces, readyFaces, layout, ascentOf, styleAt, paraStyle, padBox, hasBox, boxPath, matchFace, warmFaces } from './text.js';
import { styleRun, styleParas, paraRange, reflowRuns, reflowParas } from './runs.js';

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

/** How tall a text box lays out, with a guess while a face is still loading. */
function laidHeight(a) {
  const faces = readyFaces(a);
  return faces ? layout(a, faces).height : a.size * LINE_H;
}

/** The middle of the drawn geometry, which is what a rotation turns about. */
const spinOrigin = a => rotCenter(a, a.type === 'text' ? laidHeight(a) : 0);

const spin = a => (a.rot ? `rotate(${a.rot} ${spinOrigin(a).map(v => v.toFixed(2)).join(' ')})` : '');

export function box(a) {
  if (a.type === 'pen') {
    const xs = a.pts.map(p => p[0]), ys = a.pts.map(p => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  if (a.type === 'arrow') {
    return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
  }
  if (a.type === 'text' || a.type === 'etext') {
    // the handles wrap what is drawn: the padded box, its border and its shadow
    const b = padBox(a, laidHeight(a));
    const grow = (hasBox(a) ? (a.boxWidth || 0) / 2 : 0);
    const x0 = b.x - grow, y0 = b.y - grow;
    const x1 = b.x + b.w + grow + (a.shadow || 0), y1 = b.y + b.h + grow + (a.shadow || 0);
    if (a.type !== 'etext') return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const x = Math.min(x0, a.mx), y = Math.min(y0, a.my);
    return { x, y, w: Math.max(x1, a.mx + a.mw) - x, h: Math.max(y1, a.my + a.mh) - y };
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

/** One stretch of same-styled text, offset and recoloured for a shadow pass. */
function pieceEl(pc, ln, off, fill) {
  const key = fontKey(pc.style);
  const t = el('text', {
    x: pc.x + off, y: ln.y + off, fill: fill || pc.style.color,
    'font-family': cssFamily(key), 'font-size': pc.style.size,
    'pointer-events': 'none',
  });
  t.textContent = pc.text;
  return t;
}

const eachPiece = (lines, fn) => lines.forEach(ln => ln.pieces.forEach(pc => fn(pc, ln)));

/** Shared by the plain text box and the replaced-text annotation. */
function appendText(g, a) {
  const faces = readyFaces(a);
  if (!faces) { loadFaces(a).then(() => emit('annots', a.page)); return; }
  const { lines, height, width } = layout(a, faces);
  const b = padBox(a, height);
  const boxed = hasBox(a);
  const off = a.shadow || 0;

  if (boxed && off) {
    g.append(el('path', {
      d: boxPath(b.x + off, b.y + off, b.w, b.h, a.radius),
      fill: a.shadowColor || '#111827', stroke: 'none', 'pointer-events': 'none',
    }));
  }
  if (boxed) {
    g.append(el('path', {
      d: boxPath(b.x, b.y, b.w, b.h, a.radius),
      fill: a.boxFill && a.boxFill !== 'none' ? a.boxFill : 'none',
      stroke: a.boxWidth && a.boxColor && a.boxColor !== 'none' ? a.boxColor : 'none',
      'stroke-width': a.boxWidth || 0, 'pointer-events': 'all',
    }));
  }

  // the colour behind the letters sits under everything the letters do
  eachPiece(lines, (pc, ln) => {
    if (!pc.style.hl) return;
    g.append(el('rect', {
      x: pc.x, y: ln.y - ln.asc, width: pc.w, height: ln.asc - ln.desc,
      fill: pc.style.hl, stroke: 'none', 'pointer-events': 'none',
    }));
  });

  const left = lines.length ? Math.min(...lines.map(ln => (ln.pieces[0] ? ln.pieces[0].x : a.x))) : a.x;
  g.append(el('rect', { class: 'hit', x: left, y: a.y, width: Math.max(width, 12), height, 'pointer-events': 'all', stroke: 'none' }));

  const tsh = a.tsh || 0;
  if (tsh) eachPiece(lines, (pc, ln) => { if (pc.text.trim()) g.append(pieceEl(pc, ln, tsh, a.tshColor || '#111827')); });
  eachPiece(lines, (pc, ln) => { if (pc.text.trim()) g.append(pieceEl(pc, ln, 0, null)); });
  eachPiece(lines, (pc, ln) => {
    if (!pc.style.under || !pc.text.trim()) return;
    g.append(el('rect', {
      x: pc.x, y: ln.y + pc.style.size * 0.12, width: pc.w,
      height: Math.max(0.4, pc.style.size * 0.055),
      fill: pc.style.color, stroke: 'none', 'pointer-events': 'none',
    }));
  });
}

function drawAnnot(a) {
  const g = el('g', { class: 'an', 'data-id': a.id });
  // a drag writes the outer transform, so a rotation gets a group of its own
  const spun = a.rot ? el('g', { transform: spin(a) }) : g;
  const stroke = { stroke: a.color, 'stroke-width': a.width, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };

  if (a.type === 'pen') {
    spun.append(el('path', { d: penPath(a), ...stroke, 'pointer-events': 'none' }));
    spun.append(el('path', { class: 'hit', d: penPath(a), fill: 'none', 'stroke-width': Math.max(a.width, 10), 'pointer-events': 'stroke' }));
  } else if (a.type === 'arrow') {
    spun.append(el('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, ...stroke, 'pointer-events': 'none' }));
    spun.append(el('path', { d: headPath(a), ...stroke, 'pointer-events': 'none' }));
    spun.append(el('line', { class: 'hit', x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, 'stroke-width': 12, 'pointer-events': 'stroke' }));
  } else if (a.type === 'rect' || a.type === 'whiteout' || a.type === 'highlight') {
    spun.append(el('rect', {
      x: a.x, y: a.y, width: Math.max(a.w, 0), height: Math.max(a.h, 0),
      fill: a.fill && a.fill !== 'none' ? a.fill : 'none',
      'fill-opacity': a.opacity !== undefined ? a.opacity : 1,
      stroke: a.width ? a.color : 'none', 'stroke-width': a.width || 0,
      'pointer-events': 'all',
    }));
  } else if (a.type === 'ellipse') {
    spun.append(el('ellipse', {
      cx: a.x + a.w / 2, cy: a.y + a.h / 2, rx: Math.abs(a.w / 2), ry: Math.abs(a.h / 2),
      fill: a.fill && a.fill !== 'none' ? a.fill : 'none',
      stroke: a.color, 'stroke-width': a.width, 'pointer-events': 'all',
    }));
  } else if (a.type === 'image') {
    spun.append(el('image', { href: a.src, x: a.x, y: a.y, width: a.w, height: a.h, preserveAspectRatio: 'none', 'pointer-events': 'all' }));
  } else if (a.type === 'etext') {
    spun.append(el('rect', { x: a.mx, y: a.my, width: a.mw, height: a.mh, fill: a.bg, stroke: 'none', 'pointer-events': 'all' }));
    appendText(spun, a);
  } else if (a.type === 'text') {
    appendText(spun, a);
  }
  if (spun !== g) g.append(spun);
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
      str: it.str, x: tx[4], y: tx[5], size, w: it.width, fname: it.fontName,
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
        size: it.size, str: it.str, fam: it.fam, asc: it.asc, desc: it.desc, fname: it.fname,
      };
    }
  }
  if (cur) lines.push(cur);

  const seen = new Map();
  const bucket = ln => Math.round((ln.x2 - ln.x) * 20) / 20;
  for (const ln of lines) seen.set(bucket(ln), (seen.get(bucket(ln)) || 0) + 1);
  for (const ln of lines) ln.locked = seen.get(bucket(ln)) > 1;

  lineCache.set(p.id, lines);
  blockCache.delete(p.id);
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

const blockCache = new Map();  // pageId -> [block]

/** Union of the line boxes a block covers. */
function blockBox(lines) {
  const boxes = lines.map(lineBox);
  const x = Math.min(...boxes.map(b => b.x));
  const y = Math.min(...boxes.map(b => b.y));
  return {
    x, y,
    w: Math.max(...boxes.map(b => b.x + b.w)) - x,
    h: Math.max(...boxes.map(b => b.y + b.h)) - y,
  };
}

/** The right edge most lines share, which is the justified column edge. */
function columnRight(lines) {
  const seen = new Map();
  for (const ln of lines) {
    const k = Math.round(ln.x2 * 20) / 20;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  let right = 0, most = 2;                 // fewer than three agreeing proves nothing
  for (const [k, n] of seen) if (n > most) { most = n; right = k; }
  return right;
}

function finishBlock(lines, step, colRight) {
  const first = lines[0];
  const left = Math.min(...lines.map(l => l.x));
  const right = Math.max(...lines.map(l => l.x2));
  // justified copy runs every line but the last out to the column edge
  const justified = lines.length >= 2 && colRight > 0
    && lines.slice(0, -1).every(l => Math.abs(l.x2 - colRight) < 0.8);
  return {
    id: first.id, ids: lines.map(l => l.id), lines,
    x: left, y: first.y, size: first.size, fname: first.fname, fam: first.fam,
    asc: first.asc, desc: first.desc,
    str: lines.map(l => l.str).join(' ').replace(/\s+/g, ' ').trim(),
    w: (justified ? colRight : right) - left,
    lh: step ? step / first.size : LINE_H,
    align: justified ? 'justify' : 'left',
    box: blockBox(lines),
  };
}

/**
 * Group lines that read as one paragraph: same font and size, a left edge that
 * lines up, and an even baseline step. A heading stays a block of one.
 */
function getBlocks(p, lines) {
  if (blockCache.has(p.id)) return blockCache.get(p.id);
  const blocks = [];
  const colRight = columnRight(lines);
  let cur = null, step = 0;
  const flush = () => { if (cur) blocks.push(finishBlock(cur, step, colRight)); cur = null; step = 0; };

  for (const ln of lines) {
    if (cur) {
      const prev = cur[cur.length - 1];
      const gap = ln.y - prev.y;
      const right = Math.max(...cur.map(l => l.x2));
      // nothing but a short line marks the end of a paragraph in justified copy
      const runsOn = prev.x2 >= right - ln.size * 1.5;
      const joins = runsOn
        && ln.fname === prev.fname
        && Math.abs(ln.size - prev.size) < 0.05
        && gap > ln.size * 0.8 && gap < ln.size * 2.4
        && (!step || Math.abs(gap - step) <= Math.max(0.6, step * 0.12))
        && Math.abs(ln.x - cur[0].x) <= ln.size * 0.9;
      if (joins) { cur.push(ln); step = step || gap; continue; }
    }
    flush();
    cur = [ln];
  }
  flush();
  blockCache.set(p.id, blocks);
  return blocks;
}

const faceCache = new Map();   // srcId:fontName -> Promise<{family, bold, italic}>

/**
 * Decide what a document font really is, once, from the longest line that is not
 * part of a justified block. A justified line is padded out to the column width,
 * so its width says nothing about the face that drew it.
 */
function classifyFont(p, ln) {
  const key = `${p.srcId}:${ln.fname}`;
  if (!faceCache.has(key)) {
    const same = (lineCache.get(p.id) || [ln]).filter(l => l.fname === ln.fname);
    const usable = same.filter(l => !l.locked && l.str.trim().length >= 8);
    const pool = usable.length ? usable : (same.length ? same : [ln]);
    const sample = pool.reduce((a, b) => (b.str.length > a.str.length ? b : a));
    const suggested = METRIC.includes(sample.fam) ? sample.fam : 'sans';
    faceCache.set(key, matchFace(suggested, sample.str, sample.size, sample.x2 - sample.x));
  }
  return faceCache.get(key);
}

/** Cover a paragraph of the original text and drop an editable copy on top. */
async function replaceLine(p, blk) {
  const rec = wraps.get(p.id);
  const b = blk.box;
  const { bg, fg } = sampleColors(p, rec, b);
  const { family, weight, italic } = await classifyFont(p, blk);
  const f = await loadFont(fontKey({ family, weight, italic }));
  const a = addAnnot({
    page: p.id, type: 'etext', src: blk.ids,
    mx: b.x, my: b.y, mw: b.w, mh: b.h, bg,
    x: blk.x, y: blk.y - ascentOf(f, blk.size),
    w: Math.max(blk.w + (blk.align === 'justify' ? 0 : blk.size * 0.6), blk.size * 4),
    text: blk.str, size: blk.size, color: fg, family, weight, italic,
    align: blk.align, lh: blk.lh,
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
  warmFaces(new Set(lines.map(ln => (METRIC.includes(ln.fam) ? ln.fam : 'sans'))));
  const used = new Set(annotsOf(p.id).flatMap(a => (a.src ? [].concat(a.src) : [])));
  const layer = el('g', { class: 'tlayer' });
  for (const blk of getBlocks(p, lines)) {
    if (blk.ids.some(id => used.has(id))) continue;
    const b = blk.box;
    layer.append(el('rect', { class: 'tl', 'data-line': blk.id, x: b.x, y: b.y, width: b.w, height: b.h, rx: 2 }));
  }
  host.append(layer);
}

/* ---- overlay --------------------------------------------------------- */
const SPIN_ARM = 22;        // screen px from the bottom edge to the turn handle

function drawSelection(p, host) {
  const a = annotById(state.sel);
  if (!a || a.page !== p.id) return;
  const b = box(a);
  const s = 7 / (state.zoom || 1);           // handles keep a constant screen size
  const sel = el('g', { class: 'sel', transform: spin(a) });
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
  // below the box, where the toolbar over the selection cannot cover it
  if (canTurn(a)) {
    const mid = b.x + b.w / 2, arm = b.y + b.h + SPIN_ARM / (state.zoom || 1);
    sel.append(el('line', { class: 'spinarm', x1: mid, y1: b.y + b.h + 2, x2: mid, y2: arm }));
    sel.append(el('circle', { class: 'h spinner', 'data-h': 'spin', cx: mid, cy: arm, r: s * 0.62 }));
  }
  host.append(sel);
}

/* ---- the stretch picked out in the editor ----------------------------- */
// Character styling needs to know what the caret has hold of. The editor is a
// textarea, so the stretch is just its selection, and it outlives the editor so
// the panel can keep restyling it after a control has taken the focus.
let range = null;         // {id, from, to}
let lastDown = null;      // what was pressed last, for browsers that lose track
let lastDownAt = 0;
window.addEventListener('pointerdown', ev => {
  lastDown = ev.target;
  lastDownAt = performance.now();
  // a press anywhere else always ends the edit, even after a panel control
  // took the focus and left the textarea nothing to blur from
  if (editor && ev.target !== editor.ta
    && !(ev.target.closest && ev.target.closest('.props, .selbar, .menu'))) closeEditor(true);
}, true);

export const textRange = () => (range && annotById(range.id) ? range : null);
const rangeOf = a => (range && range.id === a.id ? range : { from: 0, to: 0 });

function readRange(ta, a) {
  const next = { id: a.id, from: ta.selectionStart, to: ta.selectionEnd };
  if (range && range.id === next.id && range.from === next.from && range.to === next.to) return;
  range = next;
  emit('range');
}

/** The style the panel should show: what the caret is sitting on. */
export function styleHere(a) {
  const r = rangeOf(a);
  // a collapsed caret sits after a character and wears that character's style
  return styleAt(a, r.to > r.from ? r.from : Math.max(0, r.from - 1));
}

/** The paragraph settings of the paragraph the caret is in. */
export function paraHere(a) {
  const r = rangeOf(a);
  return paraStyle(a, paraRange(a.text, r.from, r.to)[0]);
}

/** Restyle the picked-out characters, or the whole box when none are. */
export function styleText(a, patch) {
  const r = rangeOf(a);
  if (r.to > r.from) {
    const runs = styleRun(a, r.from, r.to, patch);
    // everything in one run is the box's own style wearing a disguise: promote
    // it, so the editor and the panel read the box and see the truth
    if (runs && runs.length === 1 && runs[0].n >= String(a.text || '').length) {
      const { n, ...deltas } = runs[0];
      updateAnnot(a.id, { ...deltas, runs: null });
    } else {
      updateAnnot(a.id, { runs });
    }
  } else {
    // nothing picked out, so the box's own style moves and the runs follow it
    const next = { ...a, ...patch };
    updateAnnot(a.id, { ...patch, runs: styleRun(next, 0, 0, patch) });
  }
  keepEditing();
}

/** Restyle the paragraphs the caret touches, or all of them when there is none. */
export function styleParagraph(a, patch) {
  // a live caret means a paragraph, wherever it sits; no caret means all of them
  const r = range && range.id === a.id ? range : null;
  if (r) updateAnnot(a.id, { paras: styleParas(a, r.from, r.to, patch) });
  else updateAnnot(a.id, { ...patch, paras: styleParas({ ...a, ...patch }, null, 0, patch) });
  keepEditing();
}

/** Put the caret back where it was, so a second style lands on the same words. */
function keepEditing() {
  if (!editor || !range || editor.a.id !== range.id) return;
  const { ta } = editor;
  requestAnimationFrame(() => {
    if (!editor || editor.ta !== ta) return;
    ta.focus();
    ta.setSelectionRange(range.from, range.to);
  });
}

/* ---- selection toolbar ------------------------------------------------ */
// HTML, not SVG: the buttons keep their size and their touch area at any zoom.
let bar = null;        // the one toolbar, moved from page to page
let barFor = '';       // what it was built for
let barMuted = false;  // a running gesture owns the screen instead

const T = k => window.i18n.t(k);

function barButton(act, label, run) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'selbar-btn';
  b.dataset.act = act;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = ICON[act];
  b.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); run(); });
  return b;
}

function buildBar(a) {
  const n = document.createElement('div');
  n.className = 'selbar';
  n.setAttribute('role', 'toolbar');
  n.setAttribute('aria-label', T('app.objectActions'));
  if (a.type === 'text' || a.type === 'etext') {
    n.append(barButton('edit', T('prop.editText'), () => openEditor(pageById(a.page), annotById(a.id), false)));
  }
  n.append(
    barButton('copy', T('prop.duplicate'), () => duplicateAnnot(a.id)),
    barButton('up', T('prop.forward'), () => restackAnnot(a.id, 1)),
    barButton('down', T('prop.backward'), () => restackAnnot(a.id, -1)),
    barButton('del', T('prop.delete'), () => removeAnnot(a.id)),
  );
  return n;
}

/** Sit the toolbar clear of the selection, flipped below when the top is tight. */
function placeBar(rec, a) {
  const b = box(a);
  const [cx, cy] = spinOrigin(a);
  const m = rec.g.getScreenCTM();
  const host = rec.page.getBoundingClientRect();
  const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]
    .map(([x, y]) => turn(cx, cy, x, y, a.rot || 0))
    .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
  const xs = pts.map(q => q.x - host.left), ys = pts.map(q => q.y - host.top);
  const gap = 9;
  const w = bar.offsetWidth, h = bar.offsetHeight;
  const y = Math.min(...ys) - h - gap;
  bar.style.left = clamp((Math.min(...xs) + Math.max(...xs)) / 2 - w / 2, 2, Math.max(2, host.width - w - 2)) + 'px';
  // above the page top would land on the page before it, so flip under the box,
  // clearing the turn handle that hangs there
  const under = Math.max(...ys) + (canTurn(a) ? SPIN_ARM + gap + 5 : gap);
  bar.style.top = (y < 2 ? under : y) + 'px';
}

/** Show, move or drop the one toolbar, from whatever the selection now is. */
function updateBar() {
  const a = annotById(state.sel);
  const rec = a && wraps.get(a.page);
  if (!a || !rec || editor || barMuted) {
    if (bar) { bar.remove(); bar = null; barFor = ''; }
    return;
  }
  const want = `${a.id}:${a.type}:${window.i18n.lang}`;
  if (barFor !== want) {
    if (bar) bar.remove();
    bar = buildBar(a);
    barFor = want;
  }
  if (bar.parentElement !== rec.page) rec.page.append(bar);
  placeBar(rec, a);
}

/** Hide the toolbar while a gesture runs, and bring it back on release. */
function muteBar(on) {
  barMuted = on;
  updateBar();
}

/* ---- context menus ---------------------------------------------------- */
/** What can be done to one object, in the menu and on the toolbar alike. */
export function objectItems(a) {
  const items = [];
  if (a.type === 'text' || a.type === 'etext') {
    items.push({ icon: ICON.edit, label: T('prop.editText'), run: () => openEditor(pageById(a.page), annotById(a.id), false) });
  }
  items.push(
    { icon: ICON.copy, label: T('prop.duplicate'), run: () => duplicateAnnot(a.id) },
    { icon: ICON.up, label: T('prop.forward'), run: () => restackAnnot(a.id, 1) },
    { icon: ICON.down, label: T('prop.backward'), run: () => restackAnnot(a.id, -1) },
    'sep',
    { icon: ICON.del, label: T('prop.delete'), danger: true, run: () => removeAnnot(a.id) },
  );
  return items;
}

/** What can be done to one page. */
export function pageItems(p) {
  return [
    { icon: ICON.rotL, label: T('thumb.rotL'), run: () => rotatePage(p.id, -1) },
    { icon: ICON.rotR, label: T('thumb.rotR'), run: () => rotatePage(p.id, 1) },
    { icon: ICON.copy, label: T('thumb.dup'), run: () => duplicatePage(p.id) },
    'sep',
    {
      icon: ICON.del, label: T('thumb.del'), danger: true,
      disabled: state.pages.length < 2, run: () => deletePage(p.id),
    },
  ];
}

/** Right click, or a held touch, on the page: the object under it, else the page. */
function onMenu(x, y, target, p) {
  const hit = target && target.closest ? target.closest('.an') : null;
  if (hit) {
    select(hit.dataset.id);
    paintOverlay(p.id);
    openMenu({ x, y, items: objectItems(annotById(hit.dataset.id)), label: T('app.objectActions') });
  } else {
    openMenu({ x, y, items: pageItems(p), label: T('app.pageActions') });
  }
}

function paintOverlay(pageId) {
  const rec = wraps.get(pageId);
  if (!rec) return;
  const p = pageById(pageId);
  rec.g.textContent = '';
  for (const a of annotsOf(pageId)) rec.g.append(drawAnnot(a));
  if (editor && editor.a.page === pageId) {
    const n = rec.g.querySelector(`[data-id="${editor.a.id}"]`);
    if (n) n.style.display = 'none';       // the textarea stands in for it
  }
  paintTextLayer(p, rec.g);
  drawSelection(p, rec.g);
  updateBar();
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
  closeMenu();
  if (bar) { bar.remove(); bar = null; barFor = ''; }
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
    svg.addEventListener('contextmenu', ev => { ev.preventDefault(); onMenu(ev.clientX, ev.clientY, ev.target, p); });
    onLongPress(svg, (x, y, ev) => {
      if (state.tool !== 'select' && state.tool !== 'edit') return;   // a drawing gesture is running
      if (endGesture) endGesture();
      onMenu(x, y, ev.target, p);
    });
    // a placed image is draggable to the browser, which would hijack a resize
    svg.addEventListener('dragstart', ev => ev.preventDefault());
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
  updateBar();
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
      const ln = getBlocks(p, lineCache.get(p.id) || []).find(l => l.id === tl.dataset.line);
      ev.preventDefault();
      // a failure here used to leave the click doing nothing at all
      if (ln) replaceLine(p, ln).catch(err => console.error('could not replace the line', err));
      return;
    }
  }

  if (tool === 'select' || tool === 'edit') {
    const h = ev.target.closest('.h');
    if (h && state.sel) {
      ev.preventDefault();               // the drag must not start a text selection
      const held = annotById(state.sel);
      return h.dataset.h === 'spin' ? startSpin(ev, p, held) : startResize(ev, p, held, h.dataset.h);
    }
    const hit = ev.target.closest('.an');
    if (hit) {
      ev.preventDefault();
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
    rec.svg.setPointerCapture(ev.pointerId);
    const guide = el('rect', { class: 'guide', x: pt.x, y: pt.y, width: 0, height: 0 });
    rec.g.append(guide);
    let now = pt;
    const draw = onFrame(() => {
      guide.setAttribute('x', Math.min(pt.x, now.x));
      guide.setAttribute('y', Math.min(pt.y, now.y));
      guide.setAttribute('width', Math.abs(now.x - pt.x));
      guide.setAttribute('height', Math.abs(now.y - pt.y));
    });
    const move = e => { now = local(rec, e); draw(); };
    const up = () => {
      endGesture = null;
      draw.cancel();
      guide.remove();
      rec.svg.removeEventListener('pointermove', move);
      rec.svg.removeEventListener('pointerup', up);
      rec.svg.removeEventListener('pointercancel', up);
      const style = styleFor('text');
      const drawn = Math.abs(now.x - pt.x);
      const dragged = drawn > style.size;          // anything less was a click
      const a = addAnnot({
        page: p.id, type: 'text',
        x: dragged ? Math.min(pt.x, now.x) : pt.x,
        y: dragged ? Math.min(pt.y, now.y) : pt.y - style.size * 0.6,
        w: dragged ? drawn : Math.min(260, Math.max(80, p.w - pt.x - 12)),
        text: '', ...style,
      });
      select(a.id);              // so the panel styles the new box, not the tool
      paintOverlay(p.id);
      openEditor(p, a, true);
    };
    endGesture = up;
    rec.svg.addEventListener('pointermove', move);
    rec.svg.addEventListener('pointerup', up);
    rec.svg.addEventListener('pointercancel', up);
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
  muteBar(true);
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
  barMuted = false;
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
    const [node2, sel2] = live();
    if (node2) node2.setAttribute('transform', tr);
    if (sel2) sel2.setAttribute('transform', `${tr} ${spin(a)}`);   // the frame keeps its angle
  });

  rec.svg.setPointerCapture(ev.pointerId);

  const move = e => {
    if (!moved && Math.hypot(e.clientX - ev.clientX, e.clientY - ev.clientY) < 3) return;
    if (!moved) { moved = true; commit(); muteBar(true); }
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
    barMuted = false;
    touch(p.id);
    paintOverlay(p.id);
    emit('settled');
  };
  endGesture = up;
  rec.svg.addEventListener('pointermove', move);
  rec.svg.addEventListener('pointerup', up);
  rec.svg.addEventListener('pointercancel', up);
}

/** Drag the handle above the box to turn it. Shift snaps to a 15 degree step. */
function startSpin(ev, p, a) {
  ev.stopPropagation();
  const rec = wraps.get(p.id);
  const [cx, cy] = spinOrigin(a);       // turning does not move it, so read it once
  const start = local(rec, ev);
  const base = a.rot || 0;
  const from = Math.atan2(start.y - cy, start.x - cx) * 180 / Math.PI;
  let moved = false;
  rec.svg.setPointerCapture(ev.pointerId);
  const repaint = onFrame(() => paintOverlay(p.id));

  const move = e => {
    if (!moved) { moved = true; commit(); muteBar(true); }
    const q = local(rec, e);
    let deg = base + Math.atan2(q.y - cy, q.x - cx) * 180 / Math.PI - from;
    if (e.shiftKey) deg = Math.round(deg / 15) * 15;
    a.rot = ((Math.round(deg * 10) / 10) % 360 + 360) % 360;
    repaint();
  };
  const up = () => {
    endGesture = null;
    repaint.cancel();
    rec.svg.removeEventListener('pointermove', move);
    rec.svg.removeEventListener('pointerup', up);
    rec.svg.removeEventListener('pointercancel', up);
    if (!moved) return;
    barMuted = false;
    touch(p.id);
    paintOverlay(p.id);
    emit('settled');
  };
  endGesture = up;
  rec.svg.addEventListener('pointermove', move);
  rec.svg.addEventListener('pointerup', up);
  rec.svg.addEventListener('pointercancel', up);
}

/** The corner a resize holds still: the one opposite the handle being dragged. */
function fixedCorner(from, h) {
  if (h === 'e') return { x: from.x, y: from.y };
  if (h === 'w') return { x: from.x + from.w, y: from.y };
  return { x: h.includes('w') ? from.x + from.w : from.x, y: h.includes('n') ? from.y + from.h : from.y };
}

function startResize(ev, p, a, h) {
  ev.stopPropagation();
  const rec = wraps.get(p.id);
  const from = JSON.parse(JSON.stringify(a));
  const rot = a.rot || 0;
  // a turned box is resized in its own frame, with the opposite corner pinned
  // where it is on screen, so the box grows the way it looks like it should
  const anchor = fixedCorner(from, h);
  const [c0x, c0y] = spinOrigin(from);
  const [px, py] = turn(c0x, c0y, anchor.x, anchor.y, rot);
  let moved = false;
  rec.svg.setPointerCapture(ev.pointerId);
  const repaint = onFrame(() => paintOverlay(p.id));

  const move = e => {
    if (!moved) { moved = true; commit(); muteBar(true); }
    const s = local(rec, e);
    if (a.type === 'arrow') {
      if (h === 'p1') { a.x1 = s.x; a.y1 = s.y; } else { a.x2 = s.x; a.y2 = s.y; }
      repaint();
      return;
    }
    const [tx, ty] = turn(px, py, s.x, s.y, -rot);
    const q = { x: anchor.x + tx - px, y: anchor.y + ty - py };
    // every frame starts from the box as it was, so the pinning never compounds
    a.x = from.x; a.y = from.y; a.w = from.w;
    if (from.h !== undefined) a.h = from.h;
    if (a.type === 'text' || a.type === 'etext') {
      if (h === 'e') a.w = Math.max(24, q.x - a.x);
      else { const right = from.x + from.w; a.x = Math.min(q.x, right - 24); a.w = right - a.x; }
    } else {
      const r = from.x + from.w, b = from.y + from.h;
      if (h.includes('w')) { a.x = Math.min(q.x, r - 6); a.w = r - a.x; }
      if (h.includes('e')) a.w = Math.max(6, q.x - a.x);
      if (h.includes('n')) { a.y = Math.min(q.y, b - 6); a.h = b - a.y; }
      if (h.includes('s')) a.h = Math.max(6, q.y - a.y);
    }
    if (rot) {
      const [ax, ay] = turn(...spinOrigin(a), anchor.x, anchor.y, rot);
      a.x += px - ax;
      a.y += py - ay;
    }
    repaint();
  };
  const up = () => {
    endGesture = null;
    repaint.cancel();
    rec.svg.removeEventListener('pointermove', move);
    rec.svg.removeEventListener('pointerup', up);
    rec.svg.removeEventListener('pointercancel', up);
    if (!moved) return;
    barMuted = false;
    touch(p.id);
    paintOverlay(p.id);
    emit('settled');
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
  loadFaces(a).then(() => {
    // a textarea shows one style, so it wears what the first letters wear:
    // uniformly restyled text then looks in the editor as it does on the page
    const st0 = styleAt(a, 0);
    const ps0 = paraStyle(a, 0);
    const key = fontKey(st0);
    const m = rec.g.getScreenCTM();
    const ta = document.createElement('textarea');
    ta.className = 'editbox';
    ta.value = a.text;
    const st = ta.style;
    st.position = 'fixed';
    st.left = '0';
    st.top = '0';
    st.transformOrigin = '0 0';
    const [cx, cy] = spinOrigin(a);
    const spun = a.rot ? `translate(${cx}px,${cy}px) rotate(${a.rot}deg) translate(${-cx}px,${-cy}px) ` : '';
    st.transform = `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f}) ${spun}translate(${a.x}px,${a.y}px)`;
    st.width = a.w + 'px';
    st.fontFamily = `${cssFamily(key)}, sans-serif`;
    st.fontSize = st0.size + 'px';
    st.lineHeight = ps0.lh;
    st.color = st0.color;
    st.textAlign = ps0.align;
    document.body.append(ta);
    editor = { ta, a, p, isNew, was: a.text };
    range = { id: a.id, from: 0, to: 0 };
    updateBar();                                  // the box is being typed in, not handled

    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(st0.size * ps0.lh, ta.scrollHeight) + 'px'; };
    grow();
    ta.addEventListener('input', () => {
      const before = a.text;
      a.text = ta.value;
      if (a.runs) a.runs = reflowRuns(a.runs, before, a.text);
      if (a.paras) a.paras = reflowParas(a.paras, before, a.text);
      readRange(ta, a);
      grow();
    });
    for (const evt of ['select', 'keyup', 'mouseup', 'pointerup']) {
      ta.addEventListener(evt, () => readRange(ta, a));
    }
    ta.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); closeEditor(true, true); }
      e.stopPropagation();
    });
    const node = rec.g.querySelector(`[data-id="${a.id}"]`);
    if (node) node.style.display = 'none';        // hide the rendered copy while editing
    // focus after the click that opened it settles, or that mouseup blurs us straight away
    requestAnimationFrame(() => {
      if (editor && editor.ta === ta) {
        ta.focus();
        if (isNew) ta.select();
        readRange(ta, a);
        ta.addEventListener('blur', ev => {
          // reaching for a property keeps the edit alive, and the words held.
          // relatedTarget is empty in the browsers that do not focus a button
          // on click, so the last thing pressed answers for them.
          const fresh = performance.now() - lastDownAt < 400 ? lastDown : null;
          const to = ev.relatedTarget || fresh;
          if (to && to.closest && to.closest('.props, .selbar, .menu')) return;
          closeEditor(true);
        });
      }
    });
  });
}

export function closeEditor(persist, cancelled) {
  if (!editor) return;
  const { ta, a, p, isNew, was } = editor;
  editor = null;
  range = null;              // nothing is held once the caret has gone
  a.text = ta.value;
  ta.remove();
  if (!a.text.trim() && a.type === 'text') discardAnnot(a.id);   // an empty cover-up is a deletion
  // escape on a fresh replacement leaves the printed line as it was
  else if (cancelled && isNew && a.type === 'etext' && a.text === was) discardAnnot(a.id);
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
  on('sel', () => {
    if (range && range.id !== state.sel) range = null;   // words held in another box
    state.pages.forEach(p => paintOverlay(p.id));
  });
  on('tool', () => {
    closeEditor(true);
    wraps.forEach(r => { r.wrap.dataset.tool = state.tool; });
    state.pages.forEach(p => paintOverlay(p.id));
  });
  window.addEventListener('resize', () => { if (state.fit) setZoom(fitZoom(), true); else resize(); });
}
