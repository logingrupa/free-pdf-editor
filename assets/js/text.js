// Font loading + text layout. The same line breaking is used by the on-screen
// preview and by the PDF export, so what you see is what gets written.

import { loadScript } from './util.js';

const FILES = {
  'sans-r':  'DejaVuSans.ttf',
  'sans-b':  'DejaVuSans-Bold.ttf',
  'sans-i':  'DejaVuSans-Oblique.ttf',
  'sans-bi': 'DejaVuSans-BoldOblique.ttf',
  'serif-r':  'DejaVuSerif.ttf',
  'serif-b':  'DejaVuSerif-Bold.ttf',
  'serif-i':  'DejaVuSerif-Italic.ttf',
  'serif-bi': 'DejaVuSerif-BoldItalic.ttf',
  'mono-r':  'DejaVuSansMono.ttf',
  'mono-b':  'DejaVuSansMono-Bold.ttf',
  'mono-i':  'DejaVuSansMono-Oblique.ttf',
  'mono-bi': 'DejaVuSansMono-BoldOblique.ttf',
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
