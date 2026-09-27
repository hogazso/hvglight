/* Szita – apró DOM-segédek az extension oldalaihoz (popup, beállítások, hírfolyam). */
(function (g) {
  'use strict';
  const S = g.Szita;
  const UI = (S.ui = {});

  UI.el = function (tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : String(kid));
    }
    return e;
  };
  const el = UI.el;

  // ---------- toast visszavonással ----------
  let toastEl = null;
  let toastTimer = 0;
  UI.toast = function (msg, action) {
    if (toastEl) toastEl.remove();
    clearTimeout(toastTimer);
    toastEl = el('div', { class: 'toast', role: 'status' }, el('span', { text: msg }));
    if (action) {
      toastEl.append(
        el('button', {
          type: 'button',
          text: action.label,
          onclick: () => {
            action.run();
            toastEl.remove();
            toastEl = null;
          },
        })
      );
    }
    document.body.append(toastEl);
    toastTimer = setTimeout(() => {
      if (toastEl) toastEl.remove();
      toastEl = null;
    }, 6000);
  };

  // ---------- felugró menü ----------
  let popEl = null;
  let popAnchor = null;
  function outside(ev) {
    if (popEl && !popEl.contains(ev.target) && ev.target !== popAnchor) UI.closePop();
  }
  function onKey(ev) {
    if (ev.key === 'Escape') {
      const a = popAnchor;
      UI.closePop();
      if (a) a.focus();
    }
  }
  UI.closePop = function () {
    if (popEl) popEl.remove();
    popEl = null;
    popAnchor = null;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  UI.popover = function (anchor, title, items) {
    const again = popAnchor === anchor;
    UI.closePop();
    if (again) return;
    popAnchor = anchor;
    popEl = el(
      'div',
      { class: 'pop', role: 'menu' },
      title ? el('div', { class: 'pop-title', text: title }) : null,
      items.map((it) =>
        el('button', {
          type: 'button',
          role: 'menuitem',
          text: it.label,
          onclick: () => {
            UI.closePop();
            it.run();
          },
        })
      )
    );
    document.body.append(popEl);
    const r = anchor.getBoundingClientRect();
    const w = popEl.offsetWidth;
    const left = Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - w - 8);
    popEl.style.left = `${Math.max(8, left)}px`;
    popEl.style.top = `${window.scrollY + r.bottom + 4}px`;
    const first = popEl.querySelector('button');
    if (first) first.focus();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey, true);
  };

  // ---------- címke-műveletek (tiltás / kivétel), visszavonással ----------
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const without = (list, k) => list.filter((t) => S.lc(t) !== k);

  /**
   * @param {Element} anchor
   * @param {string} tag
   * @param {object} settings  aktuális beállítások
   * @param {(s:object)=>Promise} commit  ment és újrarajzol
   */
  UI.tagMenu = function (anchor, tag, settings, commit) {
    const k = S.lc(tag);
    const blocked = settings.blockTags.some((t) => S.lc(t) === k);
    const allowed = settings.allowTags.some((t) => S.lc(t) === k);
    const change = (fn, msg) => {
      const before = clone(settings);
      const next = clone(settings);
      fn(next);
      commit(next).then(() => UI.toast(msg, { label: 'Visszavonás', run: () => commit(before) }));
    };
    const items = [];
    if (!blocked) {
      items.push({
        label: 'Tiltom ezt a címkét',
        run: () =>
          change((s) => {
            s.allowTags = without(s.allowTags, k);
            s.blockTags = [...without(s.blockTags, k), tag];
          }, `„${tag}” címke tiltva.`),
      });
    } else {
      items.push({
        label: 'Tiltás feloldása',
        run: () => change((s) => (s.blockTags = without(s.blockTags, k)), `„${tag}” már nincs tiltva.`),
      });
    }
    if (!allowed) {
      items.push({
        label: 'Mindig mutasd (kivétel)',
        run: () =>
          change((s) => {
            s.blockTags = without(s.blockTags, k);
            s.allowTags = [...without(s.allowTags, k), tag];
          }, `„${tag}” mindig látszik.`),
      });
    } else {
      items.push({
        label: 'Kivétel törlése',
        run: () => change((s) => (s.allowTags = without(s.allowTags, k)), `„${tag}” már nem kivétel.`),
      });
    }
    UI.popover(anchor, `Címke: ${tag}`, items);
  };

  // Relatív idő magyarul ("3 perce", "2 órája").
  UI.ago = function (ms) {
    if (ms == null) return 'még soha';
    const m = Math.round(ms / 60000);
    if (m < 1) return 'most';
    if (m < 60) return `${m} perce`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} órája`;
    return `${Math.round(h / 24)} napja`;
  };
})(globalThis);
