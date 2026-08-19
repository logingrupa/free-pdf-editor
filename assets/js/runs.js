// Editing the styled runs behind a text annotation: restyle a stretch of
// characters, restyle whole paragraphs, and keep both lined up with the text
// as it is typed. a.text stays a plain string; these only touch a.runs and
// a.paras, so nothing here knows about fonts or layout.

import { CHAR_KEYS, PARA_KEYS, baseStyle, spansOf } from './text.js';

const len = a => String(a.text || '').length;

/** a.runs as a full covering list, one entry per stretch, base filled in. */
function cover(a) {
  return spansOf(a).map(sp => {
    const r = { n: sp.text.length };
    for (const k of CHAR_KEYS) r[k] = sp.style[k];
    return r;
  });
}

const alike = (x, y) => CHAR_KEYS.every(k => (x[k] ?? null) === (y[k] ?? null));

/**
 * A run only records what it does differently from the box, so glue neighbours
 * that ended up wearing the same thing and drop the ones that say nothing.
 */
function tidy(runs, a) {
  const base = baseStyle(a);
  const out = [];
  for (const r of runs) {
    if (r.n <= 0) continue;
    const lean = { n: r.n };
    for (const k of CHAR_KEYS) if ((r[k] ?? null) !== (base[k] ?? null)) lean[k] = r[k];
    const last = out[out.length - 1];
    if (last && alike(last, lean)) last.n += lean.n;
    else out.push(lean);
  }
  // one run that says nothing is the box's own style, which is already recorded
  if (out.length === 1 && Object.keys(out[0]).length === 1) return null;
  return out.length ? out : null;
}

/** Restyle [from, to) of the text. An empty range restyles the whole box. */
export function styleRun(a, from, to, patch) {
  const n = len(a);
  const lo = Math.max(0, Math.min(from, n));
  const hi = Math.max(lo, Math.min(to, n));
  if (!n) return null;
  if (hi <= lo) {                                    // nothing picked out: all of it
    return tidy(cover(a).map(r => ({ ...r, ...patch })), a);
  }
  const out = [];
  let at = 0;
  for (const r of cover(a)) {
    const start = at, end = at + r.n;
    at = end;
    const cutLo = Math.max(start, lo), cutHi = Math.min(end, hi);
    if (cutHi <= cutLo) { out.push(r); continue; }    // wholly outside the range
    if (cutLo > start) out.push({ ...r, n: cutLo - start });
    out.push({ ...r, ...patch, n: cutHi - cutLo });
    if (end > cutHi) out.push({ ...r, n: end - cutHi });
  }
  return tidy(out, a);
}

/** Which paragraphs a character range touches. */
export function paraRange(text, from, to) {
  const parts = String(text || '').split('\n');
  const out = [];
  let at = 0;
  parts.forEach((p, i) => {
    const start = at, end = at + p.length;
    at = end + 1;
    if (start <= to && end >= from) out.push(i);
  });
  return out.length ? out : [0];
}

/** Restyle whole paragraphs. from = null means no caret: every one of them. */
export function styleParas(a, from, to, patch) {
  const count = String(a.text || '').split('\n').length;
  const touched = from == null ? null : paraRange(a.text, from, to);
  const out = [];
  for (let i = 0; i < count; i++) {
    const own = (a.paras && a.paras[i]) || {};
    out.push(!touched || touched.includes(i) ? { ...own, ...patch } : { ...own });
  }
  const clean = out.map(o => {
    const kept = {};
    for (const k of PARA_KEYS) if (o[k] !== undefined) kept[k] = o[k];
    return kept;
  });
  return clean.some(o => Object.keys(o).length) ? clean : null;
}

/** Where two strings stop matching, at each end. */
function edit(before, after) {
  const max = Math.min(before.length, after.length);
  let head = 0;
  while (head < max && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < max - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  return { head, cut: before.length - head - tail, add: after.length - head - tail };
}

/** Keep the runs lined up with the text after it has been typed in. */
export function reflowRuns(runs, before, after) {
  if (!runs || !runs.length || before === after) return runs;
  const { head, cut, add } = edit(before, after);
  const out = [];
  let at = 0, left = cut, grew = false;
  for (const r of runs) {
    let n = r.n;
    const start = at;
    at += r.n;
    if (left > 0 && at > head) {                     // this run loses some characters
      const gone = Math.min(left, at - Math.max(head, start));
      n -= gone;
      left -= gone;
    }
    // the typing lands in the run the cursor was sitting in
    if (!grew && add && head <= at && head >= start) { n += add; grew = true; }
    if (n > 0) out.push({ ...r, n });
  }
  if (!grew && add) {
    const last = out[out.length - 1];
    if (last) last.n += add;
    else out.push({ n: add });
  }
  return out.length ? out : null;
}

/** Keep per-paragraph settings on their paragraphs as newlines come and go. */
export function reflowParas(paras, before, after) {
  if (!paras || !paras.length || before === after) return paras;
  const { head, cut, add } = edit(before, after);
  const nl = s => (s.match(/\n/g) || []).length;
  const at = nl(before.slice(0, head));            // the paragraph the edit starts in
  const gone = nl(before.slice(head, head + cut));
  const born = nl(after.slice(head, head + add));
  if (gone === born || at >= paras.length) return paras;
  const out = paras.slice();
  // a paragraph split mid-text carries its settings into both halves
  out.splice(at + 1, gone, ...Array.from({ length: born }, () => ({ ...out[at] })));
  return out;
}
