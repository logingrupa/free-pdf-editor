// The menu that opens where the pointer is. There is no React here, so this is
// hand written, but it behaves the way a shadcn/Radix menu does: portalled to
// the body, closed by Escape, by a pointer outside it, by a scroll or a resize,
// walked with the arrow keys, announced as a menu, and flipped away from the
// edge it would otherwise hang over.

let live = null;   // {node, opener, off}

export function closeMenu() {
  if (!live) return;
  const { node, opener, off } = live;
  live = null;
  off();
  node.remove();
  if (opener && opener.isConnected) opener.focus();
}

export const menuOpen = () => !!live;

const itemsOf = node => [...node.querySelectorAll('.menu-item:not([disabled])')];

function step(node, dir) {
  const list = itemsOf(node);
  if (!list.length) return;
  const at = list.indexOf(document.activeElement);
  const next = at < 0 ? (dir > 0 ? 0 : list.length - 1) : (at + dir + list.length) % list.length;
  list[next].focus();
}

/** Keep the whole menu on screen: flip past the pointer, then pin to the edge. */
function place(node, x, y) {
  const pad = 8;
  const w = node.offsetWidth, h = node.offsetHeight;
  let left = x + w + pad > window.innerWidth ? x - w : x;
  let top = y + h + pad > window.innerHeight ? y - h : y;
  left = Math.min(Math.max(pad, left), Math.max(pad, window.innerWidth - w - pad));
  top = Math.min(Math.max(pad, top), Math.max(pad, window.innerHeight - h - pad));
  node.style.left = left + 'px';
  node.style.top = top + 'px';
}

function buildItem(it) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'menu-item' + (it.danger ? ' danger' : '');
  b.setAttribute('role', 'menuitem');
  b.tabIndex = -1;
  if (it.disabled) b.disabled = true;
  const icon = document.createElement('span');
  icon.className = 'menu-icon';
  icon.innerHTML = it.icon || '';
  const label = document.createElement('span');
  label.textContent = it.label;
  b.append(icon, label);
  b.addEventListener('click', ev => {
    ev.preventDefault();
    closeMenu();
    it.run();
  });
  // a pointer crossing the list moves the focus with it, as a real menu does
  b.addEventListener('pointerenter', () => b.focus());
  return b;
}

/**
 * items: [{label, icon, run, danger, disabled}] with the string 'sep' for a rule.
 * opener is the element that gets the focus back, when there is one.
 */
export function openMenu({ x, y, items, label, opener = null }) {
  closeMenu();
  const node = document.createElement('div');
  node.className = 'menu';
  node.setAttribute('role', 'menu');
  node.setAttribute('aria-label', label);
  node.tabIndex = -1;
  for (const it of items) {
    if (it === 'sep') {
      const s = document.createElement('div');
      s.className = 'menu-sep';
      s.setAttribute('role', 'separator');
      node.append(s);
    } else {
      node.append(buildItem(it));
    }
  }
  document.body.append(node);
  place(node, x, y);
  node.focus();

  const outside = ev => { if (!node.contains(ev.target)) closeMenu(); };
  const away = () => closeMenu();
  const keys = ev => {
    // the app reads plain keys as tool shortcuts, so the menu keeps its own
    ev.stopPropagation();
    if (ev.key === 'Escape') { ev.preventDefault(); closeMenu(); return; }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); step(node, 1); return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); step(node, -1); return; }
    if (ev.key === 'Home') { ev.preventDefault(); itemsOf(node)[0].focus(); return; }
    if (ev.key === 'End') { ev.preventDefault(); itemsOf(node).pop().focus(); return; }
    if (ev.key === 'Tab') { ev.preventDefault(); closeMenu(); }
  };
  node.addEventListener('keydown', keys);
  window.addEventListener('pointerdown', outside, true);
  window.addEventListener('scroll', away, true);
  window.addEventListener('resize', away);
  window.addEventListener('blur', away);

  live = {
    node,
    opener,
    off() {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
      window.removeEventListener('blur', away);
    },
  };
  return node;
}

/** Touch has no right button, so a press held in place opens the same menu. */
export function onLongPress(el, run) {
  let timer = 0, at = null;
  const cancel = () => { clearTimeout(timer); timer = 0; at = null; };
  el.addEventListener('pointerdown', ev => {
    if (ev.pointerType !== 'touch') return;
    at = { x: ev.clientX, y: ev.clientY };
    timer = setTimeout(() => { timer = 0; run(at.x, at.y, ev); at = null; }, 480);
  });
  el.addEventListener('pointermove', ev => {
    if (at && Math.hypot(ev.clientX - at.x, ev.clientY - at.y) > 9) cancel();
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
}
