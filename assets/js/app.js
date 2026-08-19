// UI wiring: drop zone, toolbar, properties, page list, keyboard, download.

import * as S from './store.js';
import * as V from './viewer.js';
import { buildPdf } from './exporter.js';
import { ICON } from './icons.js';
import { openMenu, openPanel, closeMenu, onLongPress } from './menu.js';
import { FONTS, FAMILIES, WEIGHT_NAME, cssFamily, fontKey, loadFont, weightOf, weightsOf } from './text.js';
import { saveBlob, readAsDataURL } from './util.js';

const t = window.i18n.t;
const $ = id => document.getElementById(id);
const body = document.body;
const ui = {
  viewport: $('viewport'), rail: $('rail'), props: $('props'), thumbs: $('thumbs'),
  side: $('sidePanel'), layers: $('layers'),
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
$('sideToggle').onclick = () => {
  const off = body.dataset.side !== 'off';
  body.setAttribute('data-side', off ? 'off' : 'on');
  $('sideToggle').title = t(off ? 'app.sideShow' : 'app.sideHide');
};

/* ---- side panel: pages or layers ------------------------------------- */
const PIN_KEY = 'edit-pdf:side';
const heldView = localStorage.getItem(PIN_KEY);
let pinned = heldView === 'pages' || heldView === 'layers' ? heldView : null;
let tabPick = null;                       // a tab click, until the selection moves on

// pinned wins, then the last tab click, then the work: a selection means layers
const sideView = () => pinned || tabPick || (S.state.sel ? 'layers' : 'pages');

function paintSide() {
  const view = sideView();
  ui.side.dataset.view = view;
  ui.side.querySelectorAll('.side-tab').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  const held = pinned === view;
  $('pinToggle').setAttribute('aria-pressed', String(held));
  $('pinToggle').title = t(held ? 'app.unpin' : 'app.pin');
}

function setPin(view) {
  pinned = view;
  if (view) localStorage.setItem(PIN_KEY, view);
  else localStorage.removeItem(PIN_KEY);
  paintSide();
  paintLayers();
}

$('sideTabs').onclick = e => {
  const b = e.target.closest('.side-tab');
  if (!b) return;
  tabPick = b.dataset.view;
  if (pinned) setPin(tabPick);
  else { paintSide(); paintLayers(); }
};
$('pinToggle').onclick = () => setPin(pinned === sideView() ? null : sideView());

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
// only a file from outside opens the drop screen: pages, layers and a grabbed
// image all drag inside the app
const hasFiles = e => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files');
window.addEventListener('dragenter', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (dragDepth++ === 0) body.classList.add('dragging');
});
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', e => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) { dragDepth = 0; body.classList.remove('dragging'); }
});
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
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
  rect: ['color', 'width', 'fill', 'angle'],
  ellipse: ['color', 'width', 'fill', 'angle'],
  highlight: ['fill', 'opacity', 'angle'],
  whiteout: ['fill', 'angle'],
  text: ['color', 'size', 'family', 'weight', 'face', 'hl', 'angle', 'para', 'effects', 'box'],
  etext: ['color', 'size', 'family', 'weight', 'face', 'hl', 'para', 'effects', 'box'],
  image: ['angle'],
  select: [],
  edit: [],
};

const typeName = type => t('type.' + type);

function target() {
  const a = S.annotById(S.state.sel);
  return a ? { obj: a, type: a.type, annot: true } : { obj: S.state.style[S.state.tool], type: S.state.tool, annot: false };
}

// Text carries three levels: one character style per stretch of letters, one
// setting per paragraph, and the rest on the box. A property is routed by which
// of the three it belongs to, so the caret decides how far a change reaches.
const CHAR_PROPS = ['color', 'size', 'family', 'weight', 'italic', 'hl', 'under'];
const PARA_PROPS = ['align', 'lh', 'before', 'after', 'indent'];
const only = (patch, list) => Object.keys(patch).every(k => list.includes(k));

// repaint rebuilds the panel, so a control still under the pointer asks not to
function setProp(patch, repaint = true) {
  const cur = target();
  const texty = cur.annot && (cur.type === 'text' || cur.type === 'etext');
  if (texty && only(patch, CHAR_PROPS)) V.styleText(cur.obj, patch);
  else if (texty && only(patch, PARA_PROPS)) V.styleParagraph(cur.obj, patch);
  else if (cur.annot) S.updateAnnot(cur.obj.id, patch);
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

/* ---- fonts ----------------------------------------------------------- */
const CARET = '<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5"/></svg>';

/** Set a node in one face, once that face has come down the wire. */
function inFace(node, family, weight, italic) {
  const key = fontKey({ family, weight, italic });
  loadFont(key).then(() => { node.style.fontFamily = `${cssFamily(key)}, sans-serif`; }).catch(() => {});
}

function pickButton(label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pick';
  const name = document.createElement('span');
  name.className = 'pick-name';
  name.textContent = label;
  const caret = document.createElement('span');
  caret.className = 'pick-caret';
  caret.innerHTML = CARET;
  b.append(name, caret);
  return b;
}

/** The font list: every family, its name set in itself, filtered as you type. */
function fontPicker(style, onPick) {
  const now = FONTS[style.family] ? style.family : 'sans';
  const b = pickButton(FONTS[now].label);
  inFace(b.querySelector('.pick-name'), now, 400, false);
  b.onclick = () => {
    const node = document.createElement('div');
    node.className = 'menu picker';
    const find = document.createElement('input');
    find.type = 'search';
    find.className = 'picker-find';
    find.placeholder = t('prop.searchFonts');
    find.setAttribute('aria-label', t('prop.searchFonts'));
    const list = document.createElement('div');
    list.className = 'picker-list';
    const empty = document.createElement('p');
    empty.className = 'picker-empty';
    empty.textContent = t('prop.noFont');
    empty.hidden = true;

    const rows = FAMILIES.map(fam => {
      const it = document.createElement('button');
      it.type = 'button';
      it.className = 'menu-item';
      it.setAttribute('role', 'menuitem');
      it.tabIndex = -1;
      it.dataset.family = fam;
      if (fam === now) it.setAttribute('aria-current', 'true');
      const label = document.createElement('span');
      label.textContent = FONTS[fam].label;
      const count = document.createElement('span');
      count.className = 'picker-weights';
      count.textContent = weightsOf(fam, false).length;
      it.append(label, count);
      inFace(label, fam, 400, false);
      it.onclick = () => { closeMenu(); onPick(fam); };
      it.addEventListener('pointerenter', () => it.focus());
      list.append(it);
      return it;
    });

    find.addEventListener('input', () => {
      const q = find.value.trim().toLowerCase();
      let seen = 0;
      for (const it of rows) {
        const hit = !q || FONTS[it.dataset.family].label.toLowerCase().includes(q);
        it.hidden = !hit;
        if (hit) seen++;
      }
      empty.hidden = seen > 0;
    });
    find.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter') return;
      const first = rows.find(it => !it.hidden);
      if (first) first.click();
    });

    node.append(find, list, empty);
    const r = b.getBoundingClientRect();
    openPanel({ x: r.left, y: r.bottom + 6, node, label: t('prop.font'), opener: b });
    find.focus();
  };
  return b;
}

/** Only the weights the family really ships, each named in its own weight. */
function weightPicker(style, onPick) {
  const list = weightsOf(style.family, style.italic);
  const now = list.reduce((best, w) =>
    (Math.abs(w - weightOf(style)) < Math.abs(best - weightOf(style)) ? w : best), list[0]);
  const b = pickButton(WEIGHT_NAME[now]);
  inFace(b.querySelector('.pick-name'), style.family, now, style.italic);
  b.onclick = () => {
    const r = b.getBoundingClientRect();
    const node = openMenu({
      x: r.left, y: r.bottom + 6, label: t('prop.weight'), opener: b,
      items: list.map(w => ({ label: WEIGHT_NAME[w], run: () => onPick(w) })),
    });
    [...node.querySelectorAll('.menu-item')].forEach((it, i) => {
      inFace(it, style.family, list[i], style.italic);
      if (list[i] === now) it.setAttribute('aria-current', 'true');
    });
  };
  return b;
}

const bars = tops => `<svg viewBox="0 0 24 24"><path d="M4 6h16M${tops[0]} 10h${tops[1]}M4 14h16M${tops[0]} 18h${tops[1]}"/></svg>`;
const ALIGN_ICON = {
  left: bars([4, 10]), center: bars([7, 10]), right: bars([10, 10]), justify: bars([4, 16]),
};

/** The box behind the text: background, border, corner, padding, shadow. */
function boxFold(o) {
  const d = fold('box', t('prop.box'));
  // a border colour on its own would draw nothing, so give it a width to show
  d.append(row(t('prop.background'), swatches(COLORS, o.boxFill || 'none', v => setProp({ boxFill: v }), true)));
  d.append(row(t('prop.border'), swatches(COLORS, o.boxColor || 'none',
    v => setProp(v !== 'none' && !(o.boxWidth > 0) ? { boxColor: v, boxWidth: 1 } : { boxColor: v }), true)));
  d.append(row(t('prop.borderWidth'), slider(0, 8, 0.5, o.boxWidth || 0, ' pt', (v, done) => setProp({ boxWidth: v }, done))));
  d.append(row(t('prop.radius'), slider(0, 24, 0.5, o.radius || 0, ' pt', (v, done) => setProp({ radius: v }, done))));
  d.append(row(t('prop.padding'), slider(0, 40, 0.5, o.pad || 0, ' pt', (v, done) => setProp({ pad: v }, done))));
  d.append(row(t('prop.shadow'), slider(0, 12, 0.5, o.shadow || 0, ' pt', (v, done) => setProp({ shadow: v }, done))));
  d.append(row(t('prop.shadowColour'), swatches(COLORS, o.shadowColor || '#111827', v => setProp({ shadowColor: v }))));

  const hint = document.createElement('p');
  hint.className = 'fold-hint';
  hint.textContent = t('prop.boxHint');
  d.append(hint);
  return d;
}

/** A fold that remembers whether it was left open. */
const foldOpen = {};
function fold(name, label) {
  const d = document.createElement('details');
  d.className = 'fold';
  d.dataset.fold = name;
  d.dataset.label = label;
  d.dataset.tab = name;
  d.open = !!foldOpen[name];
  d.addEventListener('toggle', () => { foldOpen[name] = d.open; });
  const sum = document.createElement('summary');
  sum.textContent = label;
  d.append(sum);
  return d;
}

/** Settings that belong to whole paragraphs, not to single letters. */
function paraFold(ps) {
  const d = fold('para', t('prop.paragraph'));
  d.append(row(t('prop.align'), segmented(
    [['left', ALIGN_ICON.left, '', t('prop.alignLeft')],
      ['center', ALIGN_ICON.center, '', t('prop.alignCenter')],
      ['right', ALIGN_ICON.right, '', t('prop.alignRight')],
      ['justify', ALIGN_ICON.justify, '', t('prop.alignJustify')]],
    v => v === ps.align,
    v => setProp({ align: v }),
  )));
  d.append(row(t('prop.lineHeight'), slider(0.8, 3, 0.05, ps.lh, '', (v, done) => setProp({ lh: v }, done))));
  d.append(row(t('prop.spaceBefore'), slider(0, 40, 0.5, ps.before || 0, ' pt', (v, done) => setProp({ before: v }, done))));
  d.append(row(t('prop.spaceAfter'), slider(0, 40, 0.5, ps.after || 0, ' pt', (v, done) => setProp({ after: v }, done))));
  d.append(row(t('prop.indent'), slider(0, 80, 0.5, ps.indent || 0, ' pt', (v, done) => setProp({ indent: v }, done))));
  return d;
}

/** What the letters do beyond their own colour. */
function effectsFold(o) {
  const d = fold('effects', t('prop.effects'));
  d.append(row(t('prop.textShadow'), slider(0, 12, 0.5, o.tsh || 0, ' pt', (v, done) => setProp({ tsh: v }, done))));
  d.append(row(t('prop.textShadowColour'), swatches(COLORS, o.tshColor || '#111827', v => setProp({ tshColor: v }))));
  return d;
}

/** Which page the layer list is about: the selection's, else the first with work. */
function layersPage() {
  const sel = S.annotById(S.state.sel);
  if (sel) return S.pageById(sel.page);
  const first = S.state.pages.find(pg => S.annotsOf(pg.id).length);
  return first || S.state.pages[0] || null;
}

// the kind chip already names the type, so the row name is the text or nothing
const layerLabel = a => (a.text || '').trim().replace(/\s+/g, ' ').slice(0, 38);

/** The page's annotations, topmost first, reorderable by dragging. */
let layerKey = '';
function paintLayers() {
  const pg = layersPage();
  const list = pg ? S.annotsOf(pg.id) : [];
  // a drag emits an annots event per pointermove, so only a real change rebuilds
  const key = [ui.side.dataset.view, pg && pg.id, S.state.pages.length, S.state.sel,
    list.map(a => a.id + ':' + layerLabel(a)).join('|')].join('#');
  if (key === layerKey) return;
  layerKey = key;

  const box = ui.layers;
  box.textContent = '';
  if (!pg) return;

  if (S.state.pages.length > 1) {
    const cap = document.createElement('p');
    cap.className = 'layers-page';
    cap.textContent = t('app.layersPage', { n: S.state.pages.indexOf(pg) + 1 });
    box.append(cap);
  }

  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'layers-empty';
    empty.textContent = t('app.layersEmpty');
    box.append(empty);
    return;
  }

  // drawn last means on top, so the list reads the other way round
  const rows = [...list].reverse();
  rows.forEach((a, i) => {
    const row = document.createElement('div');
    row.className = 'layer';
    row.draggable = true;
    row.tabIndex = 0;
    row.setAttribute('aria-pressed', String(a.id === S.state.sel));
    const kind = document.createElement('span');
    kind.className = 'layer-kind';
    kind.textContent = typeName(a.type);
    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = layerLabel(a);
    row.append(kind, name);
    row.onclick = () => S.select(a.id);
    row.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); } };
    const menu = (x, y) => {
      S.select(a.id);
      openMenu({ x, y, items: V.objectItems(a), label: t('app.objectActions'), opener: row });
    };
    row.addEventListener('contextmenu', e => { e.preventDefault(); menu(e.clientX, e.clientY); });
    onLongPress(row, menu);
    row.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', String(i)));
    row.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); row.classList.add('drag-over'); });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove('drag-over');
      const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (Number.isNaN(from) || from === i) return;
      const last = rows.length - 1;
      S.moveAnnot(pg.id, last - from, last - i);   // back to draw order
    });
    box.append(row);
  });

  const hint = document.createElement('p');
  hint.className = 'layers-hint';
  hint.textContent = t('app.layersHint');
  box.append(hint);
}

// the panel is off screen on a phone, so the list rides with the properties there
const narrow = window.matchMedia('(max-width:760px)');
narrow.addEventListener('change', () => {
  (narrow.matches ? ui.props : ui.side).append(ui.layers);
  paintProps();
});

/* ---- the phone sheet -------------------------------------------------- */
// A phone has room for one section at a time, so the panel becomes a sheet and
// the sections it already has become its tabs. On a wide screen they all show.
let sheetTab = 'text';

function paintSheet() {
  const p = ui.props;
  const sections = [...p.querySelectorAll('[data-label]')];
  p.classList.toggle('sheet', narrow.matches && sections.length > 1);
  if (!p.classList.contains('sheet')) {
    sections.forEach(n => n.classList.remove('on'));
    return;
  }
  if (!sections.some(n => n.dataset.label && n.dataset.tab === sheetTab)) sheetTab = sections[0].dataset.tab;

  const tabs = document.createElement('div');
  tabs.className = 'sheet-tabs';
  tabs.setAttribute('role', 'tablist');
  for (const n of sections) {
    const on = n.dataset.tab === sheetTab;
    n.classList.toggle('on', on);
    if (n.tagName === 'DETAILS') n.open = true;      // the tab is the disclosure here
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sheet-tab';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(on));
    b.textContent = n.dataset.label;
    b.onclick = () => { sheetTab = n.dataset.tab; paintProps(); };
    tabs.append(b);
  }
  p.prepend(tabs);
}

function paintProps() {
  const cur = target();
  const p = ui.props;
  p.textContent = '';
  if (!S.hasDoc()) return;

  const title = document.createElement('h3');
  title.textContent = cur.annot ? t('prop.selected', { name: typeName(cur.type) }) : typeName(cur.type);
  p.append(title);

  // the rows that are not in a fold still need a home, so the sheet can show
  // them on their own tab
  const main = document.createElement('div');
  main.className = 'group';
  main.dataset.label = t('prop.text');
  main.dataset.tab = 'text';
  p.append(main);

  const fields = FIELDS[cur.type] || [];
  const o = cur.obj;
  const shape = cur.type === 'rect' || cur.type === 'ellipse';
  const texty = cur.annot && (cur.type === 'text' || cur.type === 'etext');
  // a text box shows what the caret has hold of, which need not be the box style
  const cs = texty ? V.styleHere(o) : o;
  const ps = texty ? V.paraHere(o) : o;

  for (const f of fields) {
    if (f === 'color') main.append(row(t('prop.colour'), swatches(COLORS, cs.color, v => setProp({ color: v }))));
    if (f === 'fill') {
      const list = cur.type === 'highlight' ? HIGHLIGHTS : COLORS;
      main.append(row(shape ? t('prop.fill') : t('prop.colour'),
        swatches(list, o.fill, v => setProp({ fill: v }), shape)));
    }
    if (f === 'width') main.append(row(t('prop.stroke'), slider(0.5, 12, 0.5, o.width, ' pt', (v, done) => setProp({ width: v }, done))));
    if (f === 'opacity') main.append(row(t('prop.opacity'), slider(0.1, 1, 0.05, o.opacity, '', (v, done) => setProp({ opacity: v }, done))));
    if (f === 'size') main.append(row(t('prop.size'), slider(4, 72, 0.1, cs.size, ' pt', (v, done) => setProp({ size: v }, done), 400)));
    if (f === 'face') {
      main.append(row(t('prop.style'), segmented(
        [['b', `<b>${t('prop.boldLetter')}</b>`, 'font-weight:700', t('prop.bold')],
          ['i', `<i>${t('prop.italicLetter')}</i>`, 'font-style:italic', t('prop.italic')],
          ['u', `<u>${t('prop.underlineLetter')}</u>`, 'text-decoration:underline', t('prop.underline')]],
        v => (v === 'b' ? weightOf(cs) >= 600 : v === 'i' ? !!cs.italic : !!cs.under),
        v => setProp(v === 'b' ? { weight: weightOf(cs) >= 600 ? 400 : 700 }
          : v === 'i' ? { italic: !cs.italic } : { under: !cs.under }),
      )));
    }
    if (f === 'hl') {
      main.append(row(t('prop.highlight'),
        swatches(HIGHLIGHTS, cs.hl || 'none', v => setProp({ hl: v === 'none' ? null : v }), true)));
    }
    if (f === 'para') p.append(paraFold(ps));
    if (f === 'effects') p.append(effectsFold(o));
    if (f === 'family') main.append(row(t('prop.font'), fontPicker(cs, v => setProp({ family: v }))));
    if (f === 'weight') main.append(row(t('prop.weight'), weightPicker(cs, v => setProp({ weight: v }))));
    // an angle belongs to one object, never to a tool that has not drawn yet
    if (f === 'angle' && cur.annot) {
      main.append(row(t('prop.angle'),
        slider(0, 359, 1, o.rot || 0, ' deg', (v, done) => setProp({ rot: v }, done))));
    }
    if (f === 'box') p.append(boxFold(o));
  }

  if (!main.childElementCount) main.remove();

  if (texty) {
    const r = V.textRange();
    const held = r && r.to > r.from ? r.to - r.from : 0;
    const reach = document.createElement('p');
    reach.className = 'reach';
    reach.textContent = held ? t('prop.someLetters', { n: held }) : t('prop.wholeBox');
    p.append(reach);
  }

  // edit, duplicate, restack and delete live on the toolbar over the selection
  p.classList.toggle('empty', !p.querySelector('.row'));
  if (narrow.matches) p.append(ui.layers);
  paintSheet();

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
let thumbQueue = Promise.resolve();
function paintThumbs() {
  ui.thumbs.textContent = '';
  S.state.pages.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'thumb';
    d.draggable = true;
    d.tabIndex = 0;
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
    d.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); d.click(); } };
    const menu = (x, y) => openMenu({ x, y, items: V.pageItems(p), label: t('app.pageActions'), opener: d });
    d.addEventListener('contextmenu', e => { e.preventDefault(); menu(e.clientX, e.clientY); });
    onLongPress(d, menu);
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
    thumbQueue = thumbQueue.then(() => V.renderThumb(p, c, 164)).catch(() => {});
  });
}

/* ---- keyboard -------------------------------------------------------- */
const KEYS = { e: 'edit', v: 'select', t: 'text', p: 'pen', h: 'highlight', r: 'rect', o: 'ellipse', a: 'arrow', w: 'whiteout' };
window.addEventListener('keydown', e => {
  if (V.isEditing() || e.target.isContentEditable || /input|textarea/i.test(e.target.tagName)) {
    // the editor handles its own Escape only while it holds the focus
    if (e.key === 'Escape' && V.isEditing()) V.closeEditor(true);
    return;
  }
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
S.on('doc', () => { paintChrome(); paintThumbs(); paintSide(); paintLayers(); paintProps(); });
S.on('annots', () => { paintChrome(); paintLayers(); });
S.on('sel', () => { tabPick = null; paintSide(); paintLayers(); paintProps(); });
S.on('tool', () => { paintRail(); paintProps(); });
S.on('range', () => paintProps());
S.on('history', () => paintChrome());
S.on('zoom', () => paintChrome());
S.on('dirty', () => { ui.saveState.hidden = false; ui.saveState.classList.remove('on'); ui.saveState.textContent = t('save.saving'); });
S.on('saved', at => { ui.saveState.classList.add('on'); ui.saveState.textContent = t('save.saved', { time: hhmm(new Date(at)) }); });
S.on('saveerror', () => { ui.saveState.classList.remove('on'); ui.saveState.textContent = t('save.failed'); });

/* ---- boot ------------------------------------------------------------ */
ui.layers.dataset.label = t('app.layers');
ui.layers.dataset.tab = 'layers';

V.init(ui.viewport);
paintRail();
paintChrome();
paintSide();
paintLayers();
restoreSaved();
