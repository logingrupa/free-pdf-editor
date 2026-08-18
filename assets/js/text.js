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

/**
 * Read weight and slant off a line's own advance width. Upright and slanted
 * share advances at the same weight, so a plain italic line reads as regular;
 * bold italic is narrower than bold and does come through. Faces are fetched one
 * at a time and only until the answer is certain, so ordinary text costs one.
 */
export async function matchFace(family, str, size, width) {
  if (!(width > 0) || !str.trim()) return PLAIN;
  try {
    const tried = [];
    for (const v of VARIANTS) {
      const f = await loadFont(`${family}-${v[0]}`);
      const e = Math.abs(measure(f, str, size) - width) / width;
      if (e < SURE) return { bold: v[1], italic: v[2] };
      tried.push({ v, e });
    }
    let best = tried[0];
    for (const t of tried) if (t.e < best.e - 0.005) best = t;   // ties keep the simpler face
    if (best.e > FITS) return PLAIN;                             // unknown face, stay upright
    return { bold: best.v[1], italic: best.v[2] };
  } catch (e) {
    // the weight is a nicety, never a reason to refuse the edit
    console.warn('font match failed, using regular', e);
    return PLAIN;
  }
}

function breakWord(f, word, size, maxW) {
  const out = [];
  let cur = '';
  for (const ch of word) {
    if (cur && measure(f, cur + ch, size) > maxW) { out.push(cur); cur = ch; }
    else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Greedy word wrap inside maxW. Honours explicit newlines. */
export function wrap(f, text, size, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let cur = '';
    for (const word of para.split(' ')) {
      const next = cur ? cur + ' ' + word : word;
      if (measure(f, next, size) <= maxW) { cur = next; continue; }
      if (cur) { lines.push(cur); cur = ''; }
      if (measure(f, word, size) > maxW) {
        const parts = breakWord(f, word, size, maxW);
        lines.push(...parts.slice(0, -1));
        cur = parts[parts.length - 1] || '';
      } else {
        cur = word;
      }
    }
    lines.push(cur);
  }
  return lines;
}

/**
 * Lay a text annotation out in page display space.
 * Returns {lines:[{text,x,y}], height} where y is the baseline.
 */
export function layout(a, f) {
  const size = a.size;
  const lh = size * LINE_H;
  const asc = (f.ascent / f.upem) * size;
  const lines = wrap(f, a.text, size, a.w);
  let widest = 0;
  const out = lines.map((text, i) => {
    const w = measure(f, text, size);
    widest = Math.max(widest, w);
    const x = a.align === 'center' ? a.x + (a.w - w) / 2
      : a.align === 'right' ? a.x + a.w - w
        : a.x;
    return { text, x, y: a.y + asc + i * lh };
  });
  return { lines: out, height: Math.max(lh, lines.length * lh), width: widest };
}

/** Distance from the top of a text box to its first baseline. */
export const ascentOf = (f, size) => (f.ascent / f.upem) * size;
