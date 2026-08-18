// Font loading + text layout. The same line breaking is used by the on-screen
// preview and by the PDF export, so what you see is what gets written.

import { loadScript } from './util.js';

// Liberation shares its advance widths with Arial, Helvetica, Times New Roman
// and Courier New, so replacing a line of existing text does not reflow it.
const FILES = {
  'sans-r':  'LiberationSans-Regular.ttf',
  'sans-b':  'LiberationSans-Bold.ttf',
  'sans-i':  'LiberationSans-Italic.ttf',
  'sans-bi': 'LiberationSans-BoldItalic.ttf',
  'serif-r':  'LiberationSerif-Regular.ttf',
  'serif-b':  'LiberationSerif-Bold.ttf',
  'serif-i':  'LiberationSerif-Italic.ttf',
  'serif-bi': 'LiberationSerif-BoldItalic.ttf',
  'mono-r':  'LiberationMono-Regular.ttf',
  'mono-b':  'LiberationMono-Bold.ttf',
  'mono-i':  'LiberationMono-Italic.ttf',
  'mono-bi': 'LiberationMono-BoldItalic.ttf',
};
export const FAMILIES = ['sans', 'serif', 'mono'];
export const LINE_H = 1.28;
export const cssFamily = key => 'EditPdf-' + key.split('-')[0];

const base = new URL('../../vendor/', import.meta.url);
const cache = new Map();   // key -> Promise<face>
const ready = new Map();   // key -> face, once resolved
let fontkitP = null;

export function fontKey(a) {
  const fam = FAMILIES.includes(a.family) ? a.family : 'sans';
  return `${fam}-${a.bold ? (a.italic ? 'bi' : 'b') : (a.italic ? 'i' : 'r')}`;
}

function fontkit() {
  if (!fontkitP) {
    fontkitP = loadScript(new URL('fontkit.umd.min.js', base).href).then(() => window.fontkit);
  }
  return fontkitP;
}

/** Load a face once: returns {key, bytes, fk, upem, ascent, descent}. */
export function loadFont(key) {
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const [fk, buf] = await Promise.all([
        fontkit(),
        fetch(new URL(FILES[key], base)).then(r => r.arrayBuffer()),
      ]);
      const bytes = new Uint8Array(buf);
      const font = fk.create(bytes);
      // Register the same face for the DOM/SVG preview.
      const face = new FontFace(cssFamily(key), buf, {
        weight: key.endsWith('-b') || key.endsWith('-bi') ? '700' : '400',
        style: key.endsWith('-i') || key.endsWith('-bi') ? 'italic' : 'normal',
      });
      document.fonts.add(await face.load());
      const rec = { key, bytes, fk: font, upem: font.unitsPerEm, ascent: font.ascent, descent: font.descent };
      ready.set(key, rec);
      return rec;
    })());
  }
  return cache.get(key);
}

export const fontReady = key => ready.get(key) || null;

/** Width of a string at a size, matching pdf-lib's own measurement. */
export function measure(f, str, size) {
  if (!str) return 0;
  let units = 0;
  for (const g of f.fk.layout(str).glyphs) units += g.advanceWidth;
  return (units / f.upem) * size;
}

const VARIANTS = [['r', false, false], ['b', true, false], ['i', false, true], ['bi', true, true]];
const PLAIN = { bold: false, italic: false };
const SURE = 0.006;   // a true metric match measures inside this, so stop looking
const FITS = 0.015;   // the widest gap still counted as the same face

/** Fetch the faces a replacement is measured against, before a click needs them. */
export function warmFaces(families) {
  for (const fam of families) {
    for (const v of ['r', 'b']) loadFont(`${fam}-${v}`).catch(() => {});
  }
}

// A font descriptor carrying only the Nonsymbolic flag makes pdf.js call an
// embedded Times New Roman sans-serif, so the suggestion is checked, not trusted.
const OTHER = { sans: 'serif', serif: 'sans' };
const SHORT = 8;   // below this a width is not distinctive enough to judge

/**
 * Read family, weight and slant off a line's own advance width. Upright and
 * slanted share advances at the same weight, so a plain italic line reads as
 * regular; bold italic is narrower than bold and does come through. Faces are
 * fetched one at a time and only until a width is certain, nearest first.
 */
export async function matchFace(family, str, size, width) {
  const plain = { family, ...PLAIN };
  if (!(width > 0) || str.trim().length < SHORT) return plain;
  const families = OTHER[family] ? [family, OTHER[family]] : [family];
  try {
    const tried = [];
    for (const pass of [VARIANTS.slice(0, 2), VARIANTS.slice(2)]) {
      for (const fam of families) {
        for (const v of pass) {
          const f = await loadFont(`${fam}-${v[0]}`);
          const e = Math.abs(measure(f, str, size) - width) / width;
          if (e < SURE) return { family: fam, bold: v[1], italic: v[2] };
          tried.push({ fam, v, e });
        }
      }
    }
    let best = tried[0];
    for (const t of tried) if (t.e < best.e - 0.005) best = t;   // ties keep the first guess
    if (best.e > FITS) return plain;                             // unknown face, leave it alone
    return { family: best.fam, bold: best.v[1], italic: best.v[2] };
  } catch (e) {
    // the match is a nicety, never a reason to refuse the edit
    console.warn('font match failed, using regular', e);
    return plain;
  }
}

/* ---- styled runs ------------------------------------------------------ */
// The characters live in a.text, a plain string, so the editor stays a textarea
// and saved work keeps loading. a.runs styles stretches of it, a.paras styles
// whole paragraphs, and whatever either of them leaves out falls back to the
// settings on the annotation itself.

export const CHAR_KEYS = ['family', 'bold', 'italic', 'size', 'color', 'hl', 'under'];
export const PARA_KEYS = ['align', 'lh', 'before', 'after', 'indent'];

/** What a run wears when it says nothing of its own. */
export const baseStyle = a => ({
  family: FAMILIES.includes(a.family) ? a.family : 'sans',
  bold: !!a.bold, italic: !!a.italic, size: a.size, color: a.color,
  hl: a.hl || null, under: !!a.under,
});

const dressed = (base, r) => {
  const out = { ...base };
  for (const k of CHAR_KEYS) if (r[k] !== undefined) out[k] = r[k];
  return out;
};

export const sameStyle = (x, y) => CHAR_KEYS.every(k => (x[k] || null) === (y[k] || null));

/** The text as styled spans. Without runs the whole string wears the base. */
export function spansOf(a) {
  const base = baseStyle(a);
  const text = String(a.text || '');
  if (!a.runs || !a.runs.length) return [{ text, style: base }];
  const out = [];
  let at = 0;
  for (const r of a.runs) {
    if (at >= text.length) break;
    const n = Math.min(r.n, text.length - at);
    if (n > 0) out.push({ text: text.slice(at, at + n), style: dressed(base, r) });
    at += n;
  }
  if (at < text.length) out.push({ text: text.slice(at), style: base });
  return out;
}

/** The style one character wears, which is what the panel shows. */
export function styleAt(a, at) {
  let seen = 0;
  for (const sp of spansOf(a)) {
    seen += sp.text.length;
    if (at < seen) return sp.style;
  }
  return baseStyle(a);
}

/** Paragraph settings: the annotation's own unless that paragraph says otherwise. */
export function paraStyle(a, i) {
  const base = { align: a.align || 'left', lh: a.lh || LINE_H, before: 0, after: 0, indent: 0 };
  const own = a.paras && a.paras[i];
  if (!own) return base;
  const out = { ...base };
  for (const k of PARA_KEYS) if (own[k] !== undefined) out[k] = own[k];
  return out;
}

/** Every face this annotation draws with. */
export const facesOf = a => [...new Set(spansOf(a).map(sp => fontKey(sp.style)))];

/** Those faces, ready to measure with, or null while any is still loading. */
export function readyFaces(a) {
  const map = new Map();
  for (const key of facesOf(a)) {
    const f = fontReady(key);
    if (!f) return null;
    map.set(key, f);
  }
  return map;
}

/** Load whatever this annotation still needs. */
export const loadFaces = a => Promise.all(facesOf(a).map(loadFont));

/* ---- wrapping --------------------------------------------------------- */
const faceOf = (faces, style) => faces.get(fontKey(style));
const widthOf = (faces, frag) => measure(faceOf(faces, frag.style), frag.text, frag.style.size);
const wordWidth = (faces, w) => w.frags.reduce((n, fr) => n + widthOf(faces, fr), 0);
const charCount = w => w.frags.reduce((n, fr) => n + fr.text.length, 0);

/** Split a paragraph's spans into words and the gaps between them. */
function words(spans) {
  const out = [];
  let cur = null;
  for (const sp of spans) {
    for (const part of sp.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        out.push({ gap: true, frags: [{ text: part, style: sp.style }] });
        cur = null;
        continue;
      }
      if (!cur) { cur = { frags: [] }; out.push(cur); }
      cur.frags.push({ text: part, style: sp.style });
    }
  }
  return out;
}

/** Cut a word after n characters, each half keeping its fragments' styles. */
function splitWord(word, n) {
  const head = [], tail = [];
  let seen = 0;
  for (const fr of word.frags) {
    const start = seen, end = seen + fr.text.length;
    if (end <= n) head.push(fr);
    else if (start >= n) tail.push(fr);
    else {
      head.push({ text: fr.text.slice(0, n - start), style: fr.style });
      tail.push({ text: fr.text.slice(n - start), style: fr.style });
    }
    seen = end;
  }
  return [{ frags: head }, { frags: tail }];
}

/** A word wider than the column is cut where it stops fitting. */
function breakWord(faces, word, maxW) {
  const out = [];
  let rest = word;
  while (charCount(rest) > 1 && wordWidth(faces, rest) > maxW) {
    let n = 1;
    while (n < charCount(rest) && wordWidth(faces, splitWord(rest, n + 1)[0]) <= maxW) n++;
    const [head, tail] = splitWord(rest, n);
    out.push(head);
    rest = tail;
  }
  out.push(rest);
  return out;
}

/** Greedy wrap of one paragraph into lines of words and gaps. */
function wrapPara(items, faces, maxW, indent) {
  const lines = [];
  let cur = [], w = 0, gap = null;
  const room = () => maxW - (lines.length === 0 ? indent : 0);
  const flush = () => { lines.push({ items: cur, w }); cur = []; w = 0; gap = null; };

  for (const it of items) {
    if (it.gap) { gap = it; continue; }
    const gw = gap ? wordWidth(faces, gap) : 0;
    const ww = wordWidth(faces, it);
    if (cur.length && w + gw + ww > room()) flush();      // the break eats the gap
    if (cur.length && gap) { cur.push(gap); w += gw; }
    gap = null;
    if (!cur.length && ww > room()) {
      const parts = breakWord(faces, it, room());
      for (const part of parts.slice(0, -1)) { cur.push(part); w += wordWidth(faces, part); flush(); }
      const last = parts[parts.length - 1];
      cur.push(last);
      w += wordWidth(faces, last);
      continue;
    }
    cur.push(it);
    w += ww;
  }
  flush();
  return lines;
}

/** Text that shares a style and sits shoulder to shoulder draws as one piece. */
function mergePieces(list) {
  const out = [];
  for (const p of list) {
    const last = out[out.length - 1];
    if (last && sameStyle(last.style, p.style) && Math.abs(last.x + last.w - p.x) < 0.02) {
      last.text += p.text;
      last.w += p.w;
    } else {
      out.push({ ...p });
    }
  }
  return out;
}

/** The text split on newlines, each paragraph keeping its spans. */
function paragraphs(a) {
  const out = [[]];
  for (const sp of spansOf(a)) {
    sp.text.split('\n').forEach((t, i) => {
      if (i) out.push([]);
      if (t) out[out.length - 1].push({ text: t, style: sp.style });
    });
  }
  return out;
}

/**
 * Lay a text annotation out in page display space. Returns
 * {lines:[{y, asc, desc, height, pieces:[{text, x, w, style}]}], height, width}
 * where y is the baseline. faces is the map readyFaces() hands back.
 */
export function layout(a, faces) {
  const out = [];
  let top = a.y, widest = 0;

  paragraphs(a).forEach((spans, pi) => {
    const ps = paraStyle(a, pi);
    const items = words(spans.length ? spans : [{ text: '', style: baseStyle(a) }]);
    const lines = wrapPara(items, faces, a.w, ps.indent);
    top += ps.before;

    lines.forEach((ln, li) => {
      const seen = ln.items.flatMap(it => it.frags.map(fr => fr.style));
      const styles = seen.length ? seen : [baseStyle(a)];
      const big = Math.max(...styles.map(st => st.size));
      const asc = Math.max(...styles.map(st => ascentOf(faceOf(faces, st), st.size)));
      const desc = Math.min(...styles.map(st => descentOf(faceOf(faces, st), st.size)));
      const first = li === 0 ? ps.indent : 0;
      const room = a.w - first;
      const gaps = ln.items.filter(it => it.gap).length;
      // justified copy widens the gaps, and leaves the closing line alone
      const slack = ps.align === 'justify' && li < lines.length - 1 && ln.w < room ? room - ln.w : 0;
      const extra = gaps ? slack / gaps : 0;
      let x = a.x + first
        + (ps.align === 'center' ? (room - ln.w) / 2 : ps.align === 'right' ? room - ln.w : 0);

      const pieces = [];
      for (const it of ln.items) {
        for (const fr of it.frags) {
          const w = widthOf(faces, fr);
          pieces.push({ text: fr.text, x, w, style: fr.style });
          x += w;
        }
        if (it.gap) x += extra;
      }
      widest = Math.max(widest, ln.w + slack + first);
      out.push({ y: top + asc, asc, desc, height: big * ps.lh, pieces: mergePieces(pieces) });
      top += big * ps.lh;
    });
    top += ps.after;
  });

  return { lines: out, height: Math.max(a.size * (a.lh || LINE_H), top - a.y), width: widest };
}

/** The styled box behind a text annotation: the wrapping column plus padding. */
export function padBox(a, height) {
  const pad = a.pad || 0;
  return { x: a.x - pad, y: a.y - pad, w: a.w + pad * 2, h: height + pad * 2 };
}

export const hasBox = a => (a.boxFill && a.boxFill !== 'none')
  || (a.boxWidth > 0 && a.boxColor && a.boxColor !== 'none');

// Cubics only, so the SVG preview and pdf-lib read the same string.
const K = 0.5523;

/** Rectangle path, rounded when r says so. */
export function boxPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r || 0, w / 2, h / 2));
  const [x2, y2] = [x + w, y + h];
  if (!rr) return `M${x} ${y} L${x2} ${y} L${x2} ${y2} L${x} ${y2} Z`;
  const c = rr * K;
  return `M${x + rr} ${y} L${x2 - rr} ${y} C${x2 - rr + c} ${y} ${x2} ${y + rr - c} ${x2} ${y + rr}`
    + ` L${x2} ${y2 - rr} C${x2} ${y2 - rr + c} ${x2 - rr + c} ${y2} ${x2 - rr} ${y2}`
    + ` L${x + rr} ${y2} C${x + rr - c} ${y2} ${x} ${y2 - rr + c} ${x} ${y2 - rr}`
    + ` L${x} ${y + rr} C${x} ${y + rr - c} ${x + rr - c} ${y} ${x + rr} ${y} Z`;
}

/** Distance from the top of a text box to its first baseline. */
export const ascentOf = (f, size) => (f.ascent / f.upem) * size;

/** How far the letters hang below it, negative as the font reports it. */
export const descentOf = (f, size) => (f.descent / f.upem) * size;
