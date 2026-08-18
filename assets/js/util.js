// Small shared helpers. No app state lives here.

export const uid = () => Math.random().toString(36).slice(2, 10);

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function debounce(fn, ms) {
  let t = 0;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const scripts = new Map();
export function loadScript(url) {
  if (!scripts.has(url)) {
    scripts.set(url, new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = res;
      s.onerror = () => rej(new Error('Failed to load ' + url));
      document.head.appendChild(s);
    }));
  }
  return scripts.get(url);
}

/** '#ff8800' -> {r:1, g:0.53, b:0} */
export function hexRgb(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return {
    r: parseInt(n.slice(0, 2), 16) / 255,
    g: parseInt(n.slice(2, 4), 16) / 255,
    b: parseInt(n.slice(4, 6), 16) / 255,
  };
}

/** Invert a 2D affine matrix given as [a,b,c,d,e,f]. */
export function invert([a, b, c, d, e, f]) {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** Concatenate two 2D affine matrices (m1 applied after m2). */
export const mul = (m1, m2) => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];

/** Apply [a,b,c,d,e,f] to a point. */
export const apply = ([a, b, c, d, e, f], x, y) => [a * x + c * y + e, b * x + d * y + f];

/** Turn a point about a centre. Display space is y down, so this reads clockwise. */
export function turn(cx, cy, x, y, deg) {
  if (!deg) return [x, y];
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const dx = x - cx, dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

// A rotation turns a text box about the middle of its padded box, and the
// padding falls out of that middle, so only the laid-out height is needed.
export const canTurn = a => a.type !== 'etext' && a.type !== 'pen' && a.type !== 'arrow';

/** The point an annotation turns about: the middle of what it draws. */
export const rotCenter = (a, height = 0) =>
  (a.type === 'text' ? [a.x + a.w / 2, a.y + height / 2] : [a.x + a.w / 2, a.y + a.h / 2]);

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function readAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}
