// Bakes the annotation layer into a real PDF with pdf-lib.
// Annotations are stored in page display space; p.m maps that back to PDF user
// space, so rotated source pages land in the right place without special cases.

import { state, srcById } from './store.js';
import { loadScript, hexRgb, apply } from './util.js';
import { fontKey, loadFont, layout, measure } from './text.js';

const libUrl = new URL('../../vendor/pdf-lib.min.js', import.meta.url).href;

async function lib() {
  await loadScript(libUrl);
  return window.PDFLib;
}

export async function buildPdf() {
  const { PDFDocument, degrees, rgb, LineCapStyle } = await lib();
  const C = hex => { const c = hexRgb(hex); return rgb(c.r, c.g, c.b); };

  const out = await PDFDocument.create();
  const srcDocs = new Map();
  for (const s of state.sources) {
    srcDocs.set(s.id, await PDFDocument.load(s.bytes.slice(0), { ignoreEncryption: true }));
  }

  const fonts = new Map();
  for (const a of state.annots) {
    if ((a.type !== 'text' && a.type !== 'etext') || !a.text.trim()) continue;
    const key = fontKey(a);
    if (fonts.has(key)) continue;
    const f = await loadFont(key);          // also pulls in fontkit
    out.registerFontkit(window.fontkit);
    let embedded;
    try { embedded = await out.embedFont(f.bytes, { subset: true }); }
    catch { embedded = await out.embedFont(f.bytes, { subset: false }); }
    fonts.set(key, { f, embedded });
  }

  const images = new Map();
  const embedImage = async src => {
    if (!images.has(src)) {
      const bytes = Uint8Array.from(atob(src.slice(src.indexOf(',') + 1)), c => c.charCodeAt(0));
      images.set(src, src.startsWith('data:image/png') ? await out.embedPng(bytes) : await out.embedJpg(bytes));
    }
    return images.get(src);
  };

  for (const p of state.pages) {
    const [copied] = await out.copyPages(srcDocs.get(p.srcId), [p.index]);
    const page = out.addPage(copied);
    page.setRotation(degrees((p.rot0 + p.delta) % 360));

    const M = p.m;
    const U = (x, y) => { const [ux, uy] = apply(M, x, y); return { x: ux, y: uy }; };
    const rotate = degrees(Math.atan2(M[1], M[0]) * 180 / Math.PI);

    for (const a of state.annots.filter(x => x.page === p.id)) {
      if (a.type === 'pen' || a.type === 'arrow') {
        const segs = a.type === 'pen'
          ? a.pts.slice(1).map((pt, i) => [a.pts[i], pt])
          : [[[a.x1, a.y1], [a.x2, a.y2]], ...arrowHead(a)];
        for (const [s, e] of segs) {
          page.drawLine({
            start: U(s[0], s[1]), end: U(e[0], e[1]),
            thickness: a.width, color: C(a.color), lineCap: LineCapStyle.Round,
          });
        }
      } else if (a.type === 'rect' || a.type === 'highlight' || a.type === 'whiteout') {
        const anchor = U(a.x, a.y + a.h);
        page.drawRectangle({
          x: anchor.x, y: anchor.y, width: a.w, height: a.h, rotate,
          color: a.fill && a.fill !== 'none' ? C(a.fill) : undefined,
          opacity: a.fill && a.fill !== 'none' ? (a.opacity !== undefined ? a.opacity : 1) : undefined,
          borderColor: a.width ? C(a.color) : undefined,
          borderWidth: a.width || 0,
        });
      } else if (a.type === 'ellipse') {
        const c = U(a.x + a.w / 2, a.y + a.h / 2);
        page.drawEllipse({
          x: c.x, y: c.y, xScale: a.w / 2, yScale: a.h / 2, rotate,
          color: a.fill && a.fill !== 'none' ? C(a.fill) : undefined,
          borderColor: C(a.color), borderWidth: a.width,
        });
      } else if (a.type === 'image') {
        const img = await embedImage(a.src);
        const anchor = U(a.x, a.y + a.h);
        page.drawImage(img, { x: anchor.x, y: anchor.y, width: a.w, height: a.h, rotate });
      } else if (a.type === 'text' || a.type === 'etext') {
        if (a.type === 'etext') {
          const anchor = U(a.mx, a.my + a.mh);
          page.drawRectangle({ x: anchor.x, y: anchor.y, width: a.mw, height: a.mh, rotate, color: C(a.bg) });
        }
        if (!a.text.trim()) continue;
        const { f, embedded } = fonts.get(fontKey(a));
        for (const ln of layout(a, f).lines) {
          if (!ln.text.trim()) continue;
          const draw = (str, x, y) => {
            const at = U(x, y);
            page.drawText(str, { x: at.x, y: at.y, size: a.size, font: embedded, color: C(a.color), rotate });
          };
          if (!ln.ws) { draw(ln.text, ln.x, ln.y); continue; }
          let x = ln.x;                                  // widened gaps, so place each word
          for (const word of ln.text.split(' ')) {
            if (word) draw(word, x, ln.y);
            x += measure(f, word + ' ', a.size) + ln.ws;
          }
        }
      }
    }
  }

  out.setProducer('Edit PDF (client-side)');
  out.setModificationDate(new Date());
  const bytes = await out.save({ useObjectStreams: false });
  return new Blob([bytes], { type: 'application/pdf' });
}

function arrowHead(a) {
  const len = Math.max(7, a.width * 3.4);
  const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
  const tip = [a.x2, a.y2];
  const wing = t => [a.x2 - len * Math.cos(ang - t), a.y2 - len * Math.sin(ang - t)];
  return [[wing(0.42), tip], [wing(-0.42), tip]];
}
