// UI wiring: drop zone, toolbar, properties, page list, keyboard, download.

import * as S from './store.js';
import * as V from './viewer.js';
import { buildPdf } from './exporter.js';
import { saveBlob, readAsDataURL } from './util.js';

const t = window.i18n.t;
const $ = id => document.getElementById(id);
const body = document.body;
const ui = {
  viewport: $('viewport'), rail: $('rail'), props: $('props'), thumbs: $('thumbs'),
  fileName: $('fileName'), fileMeta: $('fileMeta'), saveState: $('saveState'),
  fileInput: $('fileInput'), imgInput: $('imgInput'), toast: $('toast'),
  busy: $('busy'), busyText: $('busyText'), zoomVal: $('zoomVal'),
  undoBtn: $('undoBtn'), redoBtn: $('redoBtn'), downloadBtn: $('downloadBtn'),
};

const COLORS = ['#111827', '#ffffff', '#e11d48', '#f97316', '#f5c542', '#3ecf8e', '#3ea0cf', '#6d5efc'];
const HIGHLIGHTS = ['#ffe14d', '#a6f36b', '#7ad9ff', '#ff9ad5', '#ffb36b'];

/* ---- chrome ---------------------------------------------------------- */
let toastTimer = 0;
function toast(msg) {
  ui.toast.textContent = msg;
  ui.toast.hidden = false;
  requestAnimationFrame(() => ui.toast.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast.classList.remove('show');
    setTimeout(() => { ui.toast.hidden = true; }, 200);
  }, 2600);
}

function busy(on, text = t('msg.working')) {
  ui.busyText.textContent = text;
  ui.busy.hidden = !on;
}

const two = n => String(n).padStart(2, '0');
const hhmm = d => `${two(d.getHours())}:${two(d.getMinutes())}`;

/* ---- opening files --------------------------------------------------- */
async function openFiles(files) {
  const pdfs = [...files].filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!pdfs.length) { toast(t('msg.notPdf')); return; }
  busy(true, t('msg.reading'));
  try {
    for (const file of pdfs) {
      const { src, pages } = await V.buildSource(file.name, await file.arrayBuffer());
      if (!S.hasDoc()) {
        body.removeAttribute('data-empty');
        S.setDoc({ fileName: file.name, sources: [src], pages });
      } else {
        S.addSource(src, pages);
        toast(t('msg.added', { n: pages.length, name: file.name }));
      }
    }
  } catch (e) {
    console.error(e);
    toast(t('msg.openFailed'));
  } finally {
    busy(false);
  }
}

async function restoreSaved() {
  const saved = await S.loadSaved();
  if (!saved || !saved.pages || !saved.pages.length) return;
  body.removeAttribute('data-empty');
  S.setDoc(saved);
  toast(t('msg.restored', { name: saved.fileName, time: hhmm(new Date(saved.at)) }));
}

/* ---- top bar --------------------------------------------------------- */
function paintChrome() {
  const has = S.hasDoc();
  ui.downloadBtn.disabled = !has;
  ui.undoBtn.disabled = !S.canUndo();
  ui.redoBtn.disabled = !S.canRedo();
  ui.fileName.textContent = S.state.fileName || '';
  ui.fileMeta.textContent = has ? t('msg.pageCount', { n: S.state.pages.length }) : '';
  ui.zoomVal.textContent = Math.round(S.state.zoom * 100) + '%';
  if (!has) body.setAttribute('data-empty', '1');
}

ui.fileName.addEventListener('click', () => {
  ui.fileName.contentEditable = 'true';
  ui.fileName.focus();
  document.execCommand('selectAll', false, null);
});
ui.fileName.addEventListener('blur', () => {
  ui.fileName.contentEditable = 'false';
  const name = ui.fileName.textContent.trim();
  if (name && name !== S.state.fileName) { S.state.fileName = name; S.touch(null); }
  paintChrome();
});
ui.fileName.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); ui.fileName.blur(); }
  e.stopPropagation();
});

$('undoBtn').onclick = () => S.undo();
$('redoBtn').onclick = () => S.redo();
$('zoomIn').onclick = () => V.setZoom(S.state.zoom * 1.2);
$('zoomOut').onclick = () => V.setZoom(S.state.zoom / 1.2);
ui.zoomVal.onclick = () => V.setZoom(V.fitZoom(), true);
$('pickBtn').onclick = () => ui.fileInput.click();
$('pagesToggle').onclick = () => body.setAttribute('data-pages', body.dataset.pages === 'off' ? 'on' : 'off');

$('newBtn').onclick = () => {
  if (!confirm(t('msg.closeConfirm'))) return;
  S.closeDoc();
  body.setAttribute('data-empty', '1');
};

ui.downloadBtn.onclick = async () => {
  V.closeEditor(true);
  busy(true, t('msg.building'));
  try {
    const blob = await buildPdf();
    const name = S.state.fileName.replace(/\.pdf$/i, '') + '-edited.pdf';
    saveBlob(blob, name);
    toast(t('msg.downloaded', { name }));
  } catch (e) {
    console.error(e);
    toast(t('msg.exportFailed', { err: e.message }));
  } finally {
    busy(false);
  }
};

ui.fileInput.onchange = e => { openFiles(e.target.files); e.target.value = ''; };
ui.imgInput.onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  V.setPendingImage(await readAsDataURL(f));
  S.setTool('image');
  toast(t('msg.placeImage'));
};

/* ---- drag and drop --------------------------------------------------- */
let dragDepth = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); if (dragDepth++ === 0) body.classList.add('dragging'); });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; body.classList.remove('dragging'); } });
window.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  body.classList.remove('dragging');
  if (e.dataTransfer.files.length) openFiles(e.dataTransfer.files);
});

/* ---- tool rail ------------------------------------------------------- */
ui.rail.addEventListener('click', e => {
  const b = e.target.closest('.tool');
  if (!b) return;
  if (b.dataset.tool === 'image') { ui.imgInput.click(); return; }
  S.setTool(b.dataset.tool);
});
S.on('needimage', () => ui.imgInput.click());
S.on('placed', () => S.setTool('select'));

function paintRail() {
  ui.rail.querySelectorAll('.tool').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === S.state.tool)));
}

/* ---- properties panel ------------------------------------------------ */
const FIELDS = {
  pen: ['color', 'width'],
  arrow: ['color', 'width'],
  rect: ['color', 'width', 'fill'],
  ellipse: ['color', 'width', 'fill'],
  highlight: ['fill', 'opacity'],
  whiteout: ['fill'],
  text: ['color', 'size', 'family', 'face', 'align'],
  etext: ['color', 'size', 'family', 'face', 'align'],
  image: [],
  select: [],
  edit: [],
};

const typeName = type => t('type.' + type);

function target() {
  const a = S.annotById(S.state.sel);
  return a ? { obj: a, type: a.type, annot: true } : { obj: S.state.style[S.state.tool], type: S.state.tool, annot: false };
}

// repaint rebuilds the panel, so a control still under the pointer asks not to
function setProp(patch, repaint = true) {
  const cur = target();
  if (cur.annot) S.updateAnnot(cur.obj.id, patch);
  else Object.assign(cur.obj, patch);
  if (repaint) paintProps();
}

let rowSeq = 0;

function row(labelText, node) {
  const r = document.createElement('div');
  r.className = 'row';
  if (labelText) {
    const l = document.createElement('label');
    l.id = `rowlab${++rowSeq}`;
    l.textContent = labelText;
    r.append(l);
    // the label is visual only, so name the controls it describes
    for (const c of node.querySelectorAll('input,button')) {
      if (!c.hasAttribute('aria-label')) c.setAttribute('aria-labelledby', l.id);
    }
  }
  r.append(node);
  return r;
}

function swatches(list, current, onPick, withNone) {
  const wrap = document.createElement('div');
  wrap.className = 'swatches';
  const add = (value, label, style) => {
    const b = document.createElement('button');
    b.className = 'sw';
    b.title = label;
    b.style.cssText = style;
    b.setAttribute('aria-pressed', String(value === current));
    b.onclick = () => onPick(value);
    wrap.append(b);
  };
  if (withNone) add('none', t('prop.noFill'), 'background:repeating-linear-gradient(45deg,#8884 0 4px,transparent 4px 8px)');
  list.forEach(c => add(c, c, `background:${c}`));
  const custom = document.createElement('button');
  custom.className = 'sw custom';
  custom.title = t('prop.customColour');
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.value = list.includes(current) || !current || current === 'none' ? '#6d5efc' : current;
  inp.oninput = () => onPick(inp.value);
  custom.append(inp);
  wrap.append(custom);
  return wrap;
}

const trim = v => String(Math.round(v * 100) / 100);

/**
 * Coarse drag plus an exact number to type into. onInput(value, settled) is
 * called on every change; settled is true only when the gesture is over, so a
 * live drag never triggers a panel rebuild under the pointer. The slider covers
 * the everyday range; hardMax lets the typed value go past it.
 */
function slider(min, max, step, value, unit, onInput, hardMax = max) {
  const wrap = document.createElement('div');
  wrap.className = 'num';
  const clamp = v => Math.min(hardMax, Math.max(min, v));

  const r = document.createElement('input');
  r.type = 'range';
  r.min = min; r.max = max; r.step = step;
  r.value = Math.min(max, Math.max(min, value));   // pins rather than misreports

  const n = document.createElement('input');
  n.type = 'number';
  n.min = min; n.max = hardMax; n.step = step; n.value = trim(value);

  r.oninput = () => { n.value = trim(+r.value); onInput(+r.value, false); };
  r.onchange = () => onInput(+r.value, true);
  n.oninput = () => {
    const v = parseFloat(n.value);
    if (!Number.isFinite(v)) return;
    r.value = clamp(v);
    onInput(clamp(v), false);
  };
  n.onchange = () => {
    const v = clamp(Number.isFinite(parseFloat(n.value)) ? parseFloat(n.value) : min);
    n.value = trim(v);
    onInput(v, true);
  };

  wrap.append(r, n);
  if (unit.trim()) {
    const u = document.createElement('span');
    u.className = 'unit';
    u.textContent = unit.trim();
    wrap.append(u);
  }
  return wrap;
}

function segmented(options, isPressed, onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'seg';
  options.forEach(([value, label, style, title]) => {
    const b = document.createElement('button');
    b.innerHTML = label;
    if (style) b.style.cssText = style;
    if (title) b.title = title;
    b.setAttribute('aria-pressed', String(isPressed(value)));
    b.onclick = () => onPick(value);
    wrap.append(b);
  });
  return wrap;
}

function paintProps() {
  const cur = target();
  const p = ui.props;
  p.textContent = '';
  if (!S.hasDoc()) return;

  const title = document.createElement('h3');
  title.textContent = cur.annot ? t('prop.selected', { name: typeName(cur.type) }) : typeName(cur.type);
  p.append(title);

  const fields = FIELDS[cur.type] || [];
  const o = cur.obj;
  const shape = cur.type === 'rect' || cur.type === 'ellipse';

  for (const f of fields) {
    if (f === 'color') p.append(row(t('prop.colour'), swatches(COLORS, o.color, v => setProp({ color: v }))));
    if (f === 'fill') {
      const list = cur.type === 'highlight' ? HIGHLIGHTS : COLORS;
      p.append(row(shape ? t('prop.fill') : t('prop.colour'),
        swatches(list, o.fill, v => setProp({ fill: v }), shape)));
    }
    if (f === 'width') p.append(row(t('prop.stroke'), slider(0.5, 12, 0.5, o.width, ' pt', (v, done) => setProp({ width: v }, done))));
    if (f === 'opacity') p.append(row(t('prop.opacity'), slider(0.1, 1, 0.05, o.opacity, '', (v, done) => setProp({ opacity: v }, done))));
    if (f === 'size') p.append(row(t('prop.size'), slider(4, 72, 0.1, o.size, ' pt', (v, done) => setProp({ size: v }, done), 400)));
    if (f === 'face') {
      p.append(row(t('prop.style'), segmented(
        [['b', `<b>${t('prop.boldLetter')}</b>`, 'font-weight:700', t('prop.bold')],
          ['i', `<i>${t('prop.italicLetter')}</i>`, 'font-style:italic', t('prop.italic')]],
        v => (v === 'b' ? !!o.bold : !!o.italic),
        v => setProp(v === 'b' ? { bold: !o.bold } : { italic: !o.italic }),
      )));
    }
    if (f === 'family') {
      p.append(row(t('prop.font'), segmented(
        [['sans', 'Aa', 'font-family:ui-sans-serif,sans-serif', 'Sans'],
          ['serif', 'Aa', 'font-family:Georgia,serif', 'Serif'],
          ['mono', 'Aa', 'font-family:ui-monospace,monospace', 'Mono']],
        v => v === (o.family || 'sans'),
        v => setProp({ family: v }),
      )));
    }
    if (f === 'align') {
      p.append(row(t('prop.align'), segmented(
        [['left', t('prop.alignLeftLetter'), '', t('prop.alignLeft')],
          ['center', t('prop.alignCenterLetter'), '', t('prop.alignCenter')],
          ['right', t('prop.alignRightLetter'), '', t('prop.alignRight')]],
        v => v === o.align,
        v => setProp({ align: v }),
      )));
    }
  }

  if (cur.annot) {
    const del = document.createElement('button');
    del.className = 'btn wide del';
    del.textContent = t('prop.delete');
    del.onclick = () => S.removeAnnot(cur.obj.id);
    p.append(row('', del));
    if (cur.type === 'text' || cur.type === 'etext') {
      const ed = document.createElement('button');
      ed.className = 'btn wide';
      ed.textContent = t('prop.editText');
      ed.onclick = () => V.openEditor(S.pageById(cur.obj.page), cur.obj, false);
      p.append(row('', ed));
    }
  }

  p.classList.toggle('empty', !p.querySelector('.row'));

  const tip = document.createElement('div');
  tip.className = 'tipbox';
  tip.textContent = cur.annot
    ? t('tip.annot')
    : cur.type === 'edit'
      ? t('tip.edit')
      : cur.type === 'select'
        ? t('tip.select')
        : t('tip.draw');
  p.append(tip);
}

/* ---- page thumbnails ------------------------------------------------- */
const ICON = {
  rotL: '<svg viewBox="0 0 24 24"><path d="M3 8h10a5 5 0 0 1 0 10H8"/><path d="M6 5L3 8l3 3"/></svg>',
  rotR: '<svg viewBox="0 0 24 24"><path d="M21 8H11a5 5 0 0 0 0 10h5"/><path d="M18 5l3 3-3 3"/></svg>',
  del: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
};

let thumbQueue = Promise.resolve();
function paintThumbs() {
  ui.thumbs.textContent = '';
  S.state.pages.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'thumb';
    d.draggable = true;
    d.dataset.index = i;
    const c = document.createElement('canvas');
    c.style.aspectRatio = `${V.dispW(p)} / ${V.dispH(p)}`;
    const n = document.createElement('div');
    n.className = 'thumb-n';
    n.textContent = i + 1;
    const acts = document.createElement('div');
    acts.className = 'thumb-acts';
    acts.innerHTML = `<button data-a="rotL" title="${t('thumb.rotL')}">${ICON.rotL}</button>`
      + `<button data-a="rotR" title="${t('thumb.rotR')}">${ICON.rotR}</button>`
      + `<button data-a="del" title="${t('thumb.del')}">${ICON.del}</button>`;
    acts.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.a === 'del') {
        if (S.state.pages.length === 1) { toast(t('msg.lastPage')); return; }
        S.deletePage(p.id);
      } else S.rotatePage(p.id, b.dataset.a === 'rotL' ? -1 : 1);
    };
    d.append(c, n, acts);
    d.onclick = () => V.scrollToPage(p.id);
    d.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', String(i)));
    d.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); d.classList.add('drag-over'); });
    d.addEventListener('dragleave', () => d.classList.remove('drag-over'));
    d.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      d.classList.remove('drag-over');
      const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (!Number.isNaN(from)) S.movePage(from, i);
    });
    ui.thumbs.append(d);
    thumbQueue = thumbQueue.then(() => V.renderThumb(p, c, 150)).catch(() => {});
  });
}

/* ---- keyboard -------------------------------------------------------- */
const KEYS = { e: 'edit', v: 'select', t: 'text', p: 'pen', h: 'highlight', r: 'rect', o: 'ellipse', a: 'arrow', w: 'whiteout' };
window.addEventListener('keydown', e => {
  if (V.isEditing() || e.target.isContentEditable || /input|textarea/i.test(e.target.tagName)) return;
  const meta = e.ctrlKey || e.metaKey;
  if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? S.redo() : S.undo(); return; }
  if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); S.redo(); return; }
  if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); ui.downloadBtn.click(); return; }
  if (meta && (e.key === '=' || e.key === '+')) { e.preventDefault(); V.setZoom(S.state.zoom * 1.2); return; }
  if (meta && e.key === '-') { e.preventDefault(); V.setZoom(S.state.zoom / 1.2); return; }
  if (meta) return;
  if (e.key === 'Escape') { S.setTool('select'); S.select(null); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.state.sel) { e.preventDefault(); S.removeAnnot(S.state.sel); return; }
  if (e.key === 'i') { ui.imgInput.click(); return; }
  const tool = KEYS[e.key.toLowerCase()];
  if (tool && S.hasDoc()) S.setTool(tool);
});

/* ---- events ---------------------------------------------------------- */
S.on('doc', () => { paintChrome(); paintThumbs(); paintProps(); });
S.on('annots', () => paintChrome());
S.on('sel', () => paintProps());
S.on('tool', () => { paintRail(); paintProps(); });
S.on('history', () => paintChrome());
S.on('zoom', () => paintChrome());
S.on('dirty', () => { ui.saveState.hidden = false; ui.saveState.classList.remove('on'); ui.saveState.textContent = t('save.saving'); });
S.on('saved', at => { ui.saveState.classList.add('on'); ui.saveState.textContent = t('save.saved', { time: hhmm(new Date(at)) }); });
S.on('saveerror', () => { ui.saveState.classList.remove('on'); ui.saveState.textContent = t('save.failed'); });

/* ---- boot ------------------------------------------------------------ */
V.init(ui.viewport);
paintRail();
paintChrome();
restoreSaved();
