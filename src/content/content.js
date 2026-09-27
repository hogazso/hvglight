/*
 * hvglight – content script a hvg.hu oldalain.
 *
 * A kártyákra csak data-attribútumokat tesz (data-hvglight-card="keep|block"),
 * a láthatóságot a <html data-hvglight-mode="hide|dim|off"> és a content.css dönti el.
 * Így a mód váltása azonnali, újraszámolás nélkül.
 */
(function () {
  'use strict';
  const S = globalThis.hvglight;
  if (!S || !S.api || window.__hvglightLoaded) return;
  window.__hvglightLoaded = true;

  const root = document.documentElement;
  // Amíg a beállítások be nem töltődnek, a még nem minősített kártyák láthatatlanok
  // (nem villan fel a bulvár). Biztonsági időzítő: 2,5 mp után mindenképp feloldjuk.
  root.classList.add('hvglight-pending');
  const release = () => root.classList.remove('hvglight-pending');
  const safety = setTimeout(release, 2500);

  const CARD = 'article.article-card';
  const WRAP = '[class*="col-"], .carousel-item, .showroom-carousel__content__item';
  const SECTION = 'section.card-section';
  const OTHER_CONTENT = '.podcast-card, .media-card, iframe, video';

  let settings = null;
  let compiled = null;
  let index = {};
  let indexT = 0;
  let ctx = {};
  let ready = false;
  let peek = false;
  let pill = null;

  // ---------- oldal-kontextus ----------
  function pageContext() {
    if (!settings.respectIntent) return {};
    const segs = location.pathname.split('/').filter(Boolean);
    if (segs.length && S.INTENT_PATHS.includes(segs[0])) return { off: true };
    // Ha egy rovat nyitóoldalát nyitod meg (pl. hvg.hu/elet), azt a rovatot ott nem tiltjuk.
    if (segs.length === 1 && S.SECTIONS.some((x) => x.slug === segs[0])) return { skipSection: segs[0] };
    return {};
  }

  function effectiveMode() {
    if (!settings.enabled || ctx.off) return 'off';
    if (!peek) return settings.mode;
    return settings.mode === 'hide' ? 'dim' : 'hide';
  }

  function setMode() {
    root.setAttribute('data-hvglight-mode', effectiveMode());
  }

  // ---------- kártyák ----------
  function readCard(card) {
    const link = card.querySelector('.article-card__title a[href]') || card.querySelector('a[href]');
    if (!link) return null;
    const d = S.describeUrl(link.href);
    if (!d || !d.isArticle) return null;
    const meta = index[d.url];
    const titleEl = card.querySelector('.article-card__title');
    const leadEl = card.querySelector('.article-card__lead');
    return {
      ...d,
      title: ((titleEl && titleEl.textContent) || card.getAttribute('aria-label') || (meta && meta.title) || '').trim(),
      lead: ((leadEl && leadEl.textContent) || (meta && meta.lead) || '').trim(),
      tags: meta ? meta.tags || [] : [],
      feeds: meta ? meta.feeds || [] : [],
      premium: card.classList.contains('is-premium') || d.section === '360',
    };
  }

  function apply(card) {
    const a = readCard(card);
    if (!a) {
      card.setAttribute('data-hvglight-card', 'skip');
      return;
    }
    const v = S.evaluate(a, compiled, ctx);
    card.setAttribute('data-hvglight-card', v.keep ? 'keep' : 'block');
    card.setAttribute('data-hvglight-url', a.url);
    if (v.keep) {
      card.removeAttribute('data-hvglight-why');
    } else {
      card.setAttribute('data-hvglight-why', v.why);
    }
  }

  // Blokkok cím szerint, és az üressé vált oszlopok/blokkok összecsukása.
  function collapse() {
    document.querySelectorAll('[data-hvglight-empty]').forEach((el) => el.removeAttribute('data-hvglight-empty'));
    document.querySelectorAll('[data-hvglight-section]').forEach((el) => {
      el.removeAttribute('data-hvglight-section');
      el.removeAttribute('data-hvglight-why');
    });

    document.querySelectorAll('.card-section__header__title').forEach((h) => {
      const title = S.lc(h.textContent);
      if (!title || !compiled.hideBlocks.has(title)) return;
      const sec = h.closest('section') || h.closest('.card-section');
      if (!sec) return;
      sec.setAttribute('data-hvglight-section', 'block');
      sec.setAttribute('data-hvglight-why', `Blokk: ${h.textContent.trim()}`);
    });

    if (settings.collapseEmpty) {
      const candidates = new Set();
      document.querySelectorAll('[data-hvglight-card="block"]').forEach((card) => {
        let p = card.parentElement;
        for (let i = 0; p && i < 5; i++, p = p.parentElement) {
          if (p === document.body || p.matches('main')) break;
          if (p.matches(WRAP) || p.matches(SECTION)) candidates.add(p);
          if (p.matches(SECTION)) break;
        }
      });
      for (const el of candidates) {
        const cards = el.querySelectorAll(CARD);
        if (!cards.length || el.querySelector(OTHER_CONTENT)) continue;
        let allBlocked = true;
        for (const c of cards) {
          if (c.getAttribute('data-hvglight-card') !== 'block') {
            allBlocked = false;
            break;
          }
        }
        if (allBlocked) el.setAttribute('data-hvglight-empty', '');
      }
    }
    updatePill();
  }

  let raf = 0;
  function scheduleCollapse() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      collapse();
    });
  }

  function reapply() {
    document.querySelectorAll(CARD).forEach(apply);
    collapse();
  }

  // ---------- statisztika (a popupnak és a pirulának) ----------
  function stats() {
    const byUrl = new Map();
    document.querySelectorAll('[data-hvglight-card="keep"], [data-hvglight-card="block"]').forEach((c) => {
      const u = c.getAttribute('data-hvglight-url');
      if (u && !byUrl.has(u)) byUrl.set(u, c);
    });
    let blocked = 0;
    const reasons = {};
    for (const c of byUrl.values()) {
      if (c.getAttribute('data-hvglight-card') !== 'block') continue;
      blocked++;
      const w = c.getAttribute('data-hvglight-why') || '?';
      reasons[w] = (reasons[w] || 0) + 1;
    }
    return {
      total: byUrl.size,
      blocked,
      blocks: document.querySelectorAll('[data-hvglight-section]').length,
      reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]),
      mode: effectiveMode(),
      settingsMode: settings.mode,
      peek,
      intent: ctx.off ? 'off' : ctx.skipSection || '',
      indexAge: indexT ? Date.now() - indexT : null,
      indexSize: Object.keys(index).length,
    };
  }

  // ---------- lebegő pirula: gyors betekintés a kiszűrtekbe ----------
  function updatePill() {
    const st = settings && ready ? stats() : null;
    const show = st && settings.showPill && st.mode !== 'off' && st.blocked > 0 && document.body;
    if (!show) {
      if (pill) pill.remove();
      pill = null;
      return;
    }
    if (!pill) {
      pill = document.createElement('button');
      pill.type = 'button';
      pill.id = 'hvglight-pill';
      document.body.appendChild(pill);
    }
    const label =
      st.mode === 'dim'
        ? `${st.blocked} kiszűrt cikk halványan látszik`
        : `${st.blocked} cikk kiszűrve`;
    if (pill.textContent !== label) pill.textContent = label;
    pill.title =
      st.mode === 'dim' ? 'Kattints, és elrejtem őket' : 'Kattints, és halványan megmutatom, mit rejtettem el';
    pill.setAttribute('aria-pressed', String(st.mode === 'dim'));
  }

  // A hvg.hu scriptjei a capture fázisban elnyelik a kattintásokat, ezért a pirula
  // kattintását a window capture fázisában kapjuk el. document_start-kor iratkozunk fel,
  // így minden oldali script előtt futunk.
  function onPillActivate(ev) {
    if (!pill || !(ev.target instanceof Node) || !pill.contains(ev.target)) return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    peek = !peek;
    setMode();
    updatePill();
  }
  window.addEventListener('click', onPillActivate, true);

  // ---------- DOM-figyelés ----------
  const queue = new Set();
  const mo = new MutationObserver((muts) => {
    if (!ready) return;
    let headerTouched = false;
    for (const m of muts) {
      const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (!t || (pill && pill.contains(t))) continue;
      const c = t.closest(CARD);
      if (c) queue.add(c);
      if (!headerTouched && t.closest('.card-section__header')) headerTouched = true;
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches(CARD)) queue.add(n);
        else if (n.firstElementChild) n.querySelectorAll(CARD).forEach((x) => queue.add(x));
        if (!headerTouched && (n.matches(SECTION) || n.querySelector('.card-section__header'))) headerTouched = true;
      }
    }
    if (queue.size) {
      queue.forEach(apply);
      queue.clear();
      scheduleCollapse();
    } else if (headerTouched) {
      scheduleCollapse();
    }
  });
  mo.observe(root, { childList: true, subtree: true });

  // ---------- RSS-index frissítése ----------
  let refreshing = false;
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const idx = await S.refreshIndex({ base: location.origin });
      index = idx.items;
      indexT = idx.t;
      reapply();
    } catch (e) {
      console.debug('[hvglight] Az RSS-frissítés nem sikerült:', e);
    } finally {
      refreshing = false;
    }
  }

  // ---------- üzenetek a popupból ----------
  S.api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('hvglight:')) return;
    if (msg.type === 'hvglight:peek') {
      peek = !!msg.value;
      setMode();
      updatePill();
    }
    if (msg.type === 'hvglight:refresh') refresh();
    sendResponse(ready ? stats() : null);
  });

  S.onSettingsChanged((s) => {
    settings = s;
    compiled = S.compile(s);
    ctx = pageContext();
    setMode();
    reapply();
  });

  // ---------- indulás ----------
  (async function init() {
    try {
      const [s, idx] = await Promise.all([S.loadSettings(), S.loadIndex()]);
      settings = s;
      compiled = S.compile(s);
      index = idx.items || {};
      indexT = idx.t || 0;
      ctx = pageContext();
      setMode();
      ready = true;
      reapply();
    } finally {
      clearTimeout(safety);
      release();
    }
    document.addEventListener('DOMContentLoaded', () => ready && collapse(), { once: true });
    if (Date.now() - indexT > S.INDEX_TTL) refresh();
  })();
})();
