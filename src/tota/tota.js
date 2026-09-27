/*
 * hvglight – Tóta W. Árpád-tár: a szerző cikkeinek önálló nézegetője, szűrés nélkül.
 * Lista forrása: hvg.hu/szerzok/tota-w-arpad(/<oldal>). A szerző sose kerül a szitára,
 * ez a nézet közvetlenül a hvg.hu-ról tölt, a beállításoktól függetlenül.
 */
(async function () {
  'use strict';
  const S = globalThis.hvglight;
  const el = S.ui.el;
  const $ = (id) => document.getElementById(id);

  const AUTHOR_PATH = '/szerzok/tota-w-arpad';
  const LIST_KEY = 'hvglightTotaList';
  const LIST_TTL = 2 * 3600 * 1000; // ennél frissebb gyorsítótár esetén nem kérdezzük újra az 1. oldalt induláskor

  const dateFmt = new Intl.DateTimeFormat('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });
  const lc = (s) => String(s || '').toLocaleLowerCase('hu');

  const state = {
    items: [], // {url,title,lead,thumb,date,premium,section:{label,href}}
    seen: new Set(),
    page: 0,
    maxPage: 1,
    query: '',
    loading: false,
    prefetching: false,
    error: '',
    fetchedAt: 0,
  };

  async function loadListCache() {
    try {
      const r = await S.api.storage.local.get(LIST_KEY);
      return (r && r[LIST_KEY]) || null;
    } catch (e) {
      return null;
    }
  }
  async function saveListCache() {
    try {
      await S.api.storage.local.set({
        [LIST_KEY]: { items: state.items, page: state.page, maxPage: state.maxPage, fetchedAt: state.fetchedAt },
      });
    } catch (e) {
      /* nem baj, csak nem gyorsítótárazunk */
    }
  }

  async function fetchPage(page) {
    const path = page > 1 ? `${AUTHOR_PATH}/${page}` : AUTHOR_PATH;
    const res = await fetch(`https://hvg.hu${path}`, { credentials: 'omit', cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const items = [];
    for (const art of doc.querySelectorAll('article.article-card')) {
      const a = art.querySelector('.article-card__title a[href]');
      if (!a) continue;
      const img = art.querySelector('.article-card__image-wrapper img');
      const lead = art.querySelector('.article-card__lead');
      const time = art.querySelector('time[datetime]');
      const tag = art.querySelector('.article-card__footer .article-tag');
      items.push({
        url: a.getAttribute('href') || '',
        title: (a.textContent || '').trim(),
        lead: lead ? lead.textContent.trim() : '',
        thumb: img ? img.getAttribute('src') || '' : '',
        date: time ? Date.parse(time.getAttribute('datetime')) || 0 : 0,
        premium: art.className.includes('is-premium'),
        section: tag ? { label: tag.textContent.trim(), href: tag.getAttribute('href') || '' } : null,
      });
    }
    let maxPage = page;
    for (const p of doc.querySelectorAll('.pagination .pagination__item[data-page]')) {
      const n = parseInt(p.getAttribute('data-page'), 10);
      if (!Number.isNaN(n)) maxPage = Math.max(maxPage, n);
    }
    return { items, maxPage };
  }

  function mergeItemsAtStart(newItems) {
    const fresh = newItems.filter((it) => it.url && !state.seen.has(it.url));
    for (const it of fresh) state.seen.add(it.url);
    state.items = [...fresh, ...state.items];
    return fresh.length;
  }
  function mergeItemsAtEnd(newItems) {
    let added = 0;
    for (const it of newItems) {
      if (!it.url || state.seen.has(it.url)) continue;
      state.seen.add(it.url);
      state.items.push(it);
      added++;
    }
    return added;
  }

  let pageLoadInFlight = null;
  async function loadNextPage() {
    if (state.page >= state.maxPage && state.page > 0) return false;
    if (pageLoadInFlight) return pageLoadInFlight;
    pageLoadInFlight = (async () => {
      const pageNum = state.page + 1;
      const { items, maxPage } = await fetchPage(pageNum);
      mergeItemsAtEnd(items);
      state.page = pageNum;
      state.maxPage = Math.max(state.maxPage, maxPage);
      state.fetchedAt = Date.now();
      saveListCache();
      return true;
    })();
    try {
      return await pageLoadInFlight;
    } finally {
      pageLoadInFlight = null;
    }
  }

  // A teljes archívumot csendben behúzzuk a háttérben, hogy a keresés a már letöltött
  // cikkek közt is működjön, ne csak a betöltött oldalakon.
  let prefetchStarted = false;
  async function prefetchArchive() {
    if (prefetchStarted) return;
    prefetchStarted = true;
    state.prefetching = true;
    updateMoreBtn();
    try {
      while (state.page < state.maxPage) {
        const ok = await loadNextPage().catch(() => false);
        if (!ok) break;
        render();
        await new Promise((r) => setTimeout(r, 150));
      }
    } finally {
      state.prefetching = false;
      updateMoreBtn();
    }
  }

  function filteredItems() {
    if (!state.query) return state.items;
    const q = state.query;
    return state.items.filter((it) => lc(`${it.title} ${it.lead}`).includes(q));
  }

  function updateMoreBtn() {
    const btn = $('more');
    if (!state.items.length && state.loading) {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    if (state.page >= state.maxPage) {
      btn.textContent = `Teljes archívum betöltve (${state.items.length} cikk)`;
      btn.disabled = true;
    } else if (state.prefetching) {
      btn.textContent = `Archívum betöltése… (${state.page}/${state.maxPage}. oldal)`;
      btn.disabled = true;
    } else {
      btn.textContent = `Több betöltése (${state.page}/${state.maxPage}. oldal betöltve)`;
      btn.disabled = false;
    }
  }

  function renderItem(it) {
    const date = it.date ? new Date(it.date) : null;
    return el(
      'article',
      { class: 't-item' },
      it.thumb
        ? el('a', { href: it.url, target: '_blank', rel: 'noopener', tabindex: '-1', 'aria-hidden': 'true' }, el('img', { class: 't-thumb', src: it.thumb, alt: '', loading: 'lazy' }))
        : el('div', { class: 't-thumb' }),
      el(
        'div',
        null,
        el('h3', null, el('a', { href: it.url, target: '_blank', rel: 'noopener', text: it.title || it.url })),
        el(
          'p',
          { class: 't-meta' },
          date ? el('time', { datetime: date.toISOString(), text: dateFmt.format(date) }) : null,
          it.section ? el('a', { href: it.section.href, target: '_blank', rel: 'noopener', text: it.section.label }) : null,
          it.premium ? el('span', { class: 't-prem', text: 'Prémium' }) : null
        ),
        it.lead ? el('p', { class: 't-lead', text: it.lead }) : null
      )
    );
  }

  function render() {
    const rows = filteredItems();
    $('sub').textContent = state.items.length
      ? `${state.items.length} betöltött cikk${state.query ? `, ${rows.length} találat` : ''}. Ez a nézet nem szűr semmit.`
      : 'A szerző cikkei, mindig szűrés nélkül';

    const list = $('list');
    if (!state.items.length) {
      list.replaceChildren(
        el(
          'div',
          { class: 'empty' },
          state.loading
            ? el('p', { text: 'Betöltöm Tóta W. Árpád cikkeit…' })
            : [
                el('p', {
                  text: state.error
                    ? `Nem sikerült elérni a hvg.hu-t (${state.error}). Ellenőrizd a netkapcsolatot, és próbáld újra.`
                    : 'Még nincs betöltött cikk.',
                }),
                el('button', { type: 'button', class: 'btn btn-primary', text: 'Letöltés most', onclick: () => refresh(true) }),
              ]
        )
      );
      updateMoreBtn();
      return;
    }
    if (!rows.length) {
      list.replaceChildren(el('div', { class: 'empty' }, el('p', { text: `Nincs találat erre: „${state.query}”.` })));
      updateMoreBtn();
      return;
    }
    list.replaceChildren(...rows.map(renderItem));
    updateMoreBtn();
  }

  async function refresh(force) {
    if (state.loading) return;
    if (!force && state.fetchedAt && Date.now() - state.fetchedAt < LIST_TTL) return;
    state.loading = true;
    state.error = '';
    $('refresh').disabled = true;
    $('refresh').textContent = 'Frissítés…';
    render();
    try {
      const { items, maxPage } = await fetchPage(1);
      mergeItemsAtStart(items);
      state.maxPage = Math.max(state.maxPage, maxPage);
      if (!state.page) state.page = 1;
      state.fetchedAt = Date.now();
      saveListCache();
    } catch (e) {
      state.error = e.message || String(e);
      if (state.items.length) S.ui.toast(`A frissítés nem sikerült: ${state.error}`);
    } finally {
      state.loading = false;
      $('refresh').disabled = false;
      $('refresh').textContent = 'Frissítés';
      render();
    }
  }

  $('refresh').addEventListener('click', () => refresh(true));
  $('more').addEventListener('click', async () => {
    $('more').disabled = true;
    $('more').textContent = 'Töltés…';
    try {
      await loadNextPage();
    } catch (e) {
      S.ui.toast(`Nem sikerült betölteni: ${e.message || e}`);
    } finally {
      render();
    }
  });
  let qTimer = 0;
  $('q').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      state.query = lc(e.target.value.trim());
      render();
    }, 120);
  });

  // ---------- indulás ----------
  const cached = await loadListCache();
  if (cached && cached.items && cached.items.length) {
    state.items = cached.items;
    for (const it of cached.items) state.seen.add(it.url);
    state.page = cached.page || 1;
    state.maxPage = cached.maxPage || 1;
    state.fetchedAt = cached.fetchedAt || 0;
    render();
  }
  await refresh(!cached);
  prefetchArchive();
})();
