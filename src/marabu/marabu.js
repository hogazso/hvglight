/*
 * hvglight – Marabu-tár: Marabu karikatúráinak nagyképernyős, léptethető és kereshető nézegetője.
 * Lista forrása: hvg.hu/cimke/marabu(/<oldal>) — a kártyák csak kis, vágott képet adnak,
 * ezért minden karikatúra teljes képét a cikkoldaláról (content-body) töltjük be, igény szerint.
 */
(async function () {
  'use strict';
  const S = globalThis.hvglight;
  const el = S.ui.el;

  const TAG = 'marabu';
  const LIST_KEY = 'hvglightMarabuList';
  const IMG_KEY = 'hvglightMarabuImgCache';
  const MIN_MATCHES = 6; // ennyi találatig csendben tovább lapoz kereséskor, ha van még oldal

  const dateFmt = new Intl.DateTimeFormat('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });
  const lc = (s) => String(s || '').toLocaleLowerCase('hu');

  const state = {
    items: [], // {url,title,lead,thumb,date}
    seen: new Set(),
    page: 0,
    maxPage: 1,
    index: -1,
    query: '',
    busy: false,
    searching: false,
  };
  let searchToken = 0;

  // ---------- perzisztencia ----------
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
        [LIST_KEY]: { items: state.items, page: state.page, maxPage: state.maxPage, fetchedAt: Date.now() },
      });
    } catch (e) {
      /* nem baj, csak nem gyorsítótárazunk */
    }
  }
  async function readImgCache(url) {
    try {
      const r = await S.api.storage.local.get(IMG_KEY);
      const all = (r && r[IMG_KEY]) || {};
      return all[url] || null;
    } catch (e) {
      return null;
    }
  }
  async function writeImgCache(url, src) {
    try {
      const r = await S.api.storage.local.get(IMG_KEY);
      const all = (r && r[IMG_KEY]) || {};
      all[url] = src;
      await S.api.storage.local.set({ [IMG_KEY]: all });
    } catch (e) {
      /* nem baj */
    }
  }

  // ---------- hvg.hu lekérés ----------
  async function fetchTagPage(page) {
    const path = page > 1 ? `/cimke/${TAG}/${page}` : `/cimke/${TAG}`;
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
      items.push({
        url: a.getAttribute('href') || '',
        title: (a.textContent || '').trim(),
        lead: lead ? lead.textContent.trim() : '',
        thumb: img ? img.getAttribute('src') || '' : '',
        date: time ? Date.parse(time.getAttribute('datetime')) || 0 : 0,
      });
    }
    let maxPage = page;
    for (const p of doc.querySelectorAll('.pagination .pagination__item[data-page]')) {
      const n = parseInt(p.getAttribute('data-page'), 10);
      if (!Number.isNaN(n)) maxPage = Math.max(maxPage, n);
    }
    return { items, maxPage };
  }

  async function fetchFullImage(url) {
    const res = await fetch(url, { credentials: 'omit', cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const img = doc.querySelector('.wp-block-hvg-custom-image__image, #free-body img, .content-body img');
    return img ? img.getAttribute('src') : '';
  }

  async function getFullImage(item) {
    if (item.full) return item.full;
    const cached = await readImgCache(item.url);
    if (cached) {
      item.full = cached;
      return cached;
    }
    const src = (await fetchFullImage(item.url)) || item.thumb;
    item.full = src;
    writeImgCache(item.url, src);
    return src;
  }

  function mergeItems(newItems) {
    let added = 0;
    for (const it of newItems) {
      if (!it.url || state.seen.has(it.url)) continue;
      state.seen.add(it.url);
      state.items.push(it);
      added++;
    }
    return added;
  }

  // Több hívó is kérheti egyszerre (a keresés, a "Több betöltése" gomb és a háttér-előtöltés is);
  // ez a zár garantálja, hogy ilyenkor ne induljon el kétszer ugyanannak az oldalnak a letöltése.
  let pageLoadInFlight = null;
  async function loadNextPage() {
    if (state.page >= state.maxPage && state.page > 0) return false;
    if (pageLoadInFlight) return pageLoadInFlight;
    pageLoadInFlight = (async () => {
      const pageNum = state.page + 1;
      const { items, maxPage } = await fetchTagPage(pageNum);
      mergeItems(items);
      state.page = pageNum;
      state.maxPage = Math.max(state.maxPage, maxPage);
      saveListCache();
      return true;
    })();
    try {
      return await pageLoadInFlight;
    } finally {
      pageLoadInFlight = null;
    }
  }

  // A teljes archívumot a háttérben, csendben behúzzuk, hogy a keresés ne a hvg.hu
  // élő lapozásától függjön: egy idő után minden karikatúra helyben van, és a keresés
  // (illetve a lépkedés) a már letöltött adatok közt azonnal, hálózat nélkül működik.
  let prefetchStarted = false;
  async function prefetchArchive() {
    if (prefetchStarted) return;
    prefetchStarted = true;
    state.prefetching = true;
    updateLoadMoreBtn();
    try {
      while (state.page < state.maxPage) {
        const ok = await loadNextPage().catch(() => false);
        if (!ok) break;
        renderMeta();
        await new Promise((r) => setTimeout(r, 150));
      }
    } finally {
      state.prefetching = false;
      updateLoadMoreBtn();
    }
  }

  // ---------- szűrés ----------
  function filteredList() {
    if (!state.query) return state.items;
    const q = state.query;
    return state.items.filter((it) => lc(`${it.title} ${it.lead}`).includes(q));
  }

  // ---------- megjelenítés ----------
  const gal = S.gallery.create(document.getElementById('gal'), {
    onPrev: () => stepBy(-1),
    onNext: () => stepBy(1),
    onFirst: () => jumpTo(0),
    onLast: () => jumpTo(filteredList().length - 1),
    onJump: (i) => jumpTo(i),
  });
  gal.setHeader({ title: 'Marabu-tár' });

  const searchInput = el('input', {
    type: 'search',
    class: 'mb-search',
    placeholder: 'Keresés a karikatúrák szövegében…',
    autocomplete: 'off',
  });
  const loadMoreBtn = el('button', { type: 'button', class: 'btn btn-quiet mb-more', onclick: () => onLoadMoreClick() }, 'Több betöltése');
  gal.headControls.append(el('label', { class: 'mb-searchbox' }, searchInput), loadMoreBtn);

  function updateLoadMoreBtn() {
    if (state.page >= state.maxPage) {
      loadMoreBtn.textContent = `Teljes archívum betöltve (${state.items.length} db)`;
      loadMoreBtn.disabled = true;
    } else if (state.prefetching) {
      loadMoreBtn.textContent = `Archívum betöltése… (${state.page}/${state.maxPage}. oldal)`;
      loadMoreBtn.disabled = true;
    } else {
      loadMoreBtn.textContent = `Több betöltése (${state.page}/${state.maxPage}. oldal betöltve)`;
      loadMoreBtn.disabled = false;
    }
  }

  async function onLoadMoreClick() {
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = 'Töltés…';
    try {
      await loadNextPage();
    } catch (e) {
      S.ui.toast(`Nem sikerült betölteni: ${e.message || e}`);
    } finally {
      updateLoadMoreBtn();
      renderMeta();
    }
  }

  // A színpadot (nagy kép) csak akkor rajzoljuk újra, ha maga a kiválasztott elem változik;
  // a lista/létszám változását a filmszalag és a "Több betöltése" gomb külön kezeli.
  function renderMeta() {
    const list = filteredList();
    if (state.index >= list.length) state.index = list.length - 1;
    gal.setFilm(
      list.map((it) => ({ thumb: it.thumb, label: it.title })),
      state.index
    );
    const more = state.page < state.maxPage;
    const searching = state.searching ? ' · keresek tovább…' : '';
    gal.setStatus(list.length ? `${state.index + 1} / ${list.length}${more ? '+' : ''}${searching}` : `0 találat${searching}`);
    gal.setNav({ prevEnabled: list.length > 0, nextEnabled: list.length > 0 });
    updateLoadMoreBtn();
  }

  async function showCurrent() {
    const list = filteredList();
    const item = list[state.index];
    renderMeta();
    if (!item) {
      gal.setStage({
        src: null,
        title: state.query ? 'Nincs találat' : 'Még nincs betöltve karikatúra',
        sub: state.query
          ? state.page < state.maxPage
            ? 'Még tart az archívum betöltése a háttérben, próbáld meg kicsit később újra.'
            : 'A teljes archívumban átnéztem, ilyen szöveggel nincs karikatúra.'
          : '',
        loading: false,
      });
      return;
    }
    const sub = item.lead
      ? `${item.lead}${item.date ? ' — ' + dateFmt.format(new Date(item.date)) : ''}`
      : item.date
        ? dateFmt.format(new Date(item.date))
        : '';
    gal.setStage({
      // A kártya-vágás más kivágás, mint a cikk teljes képe (hiányzik pl. a szövegbuborék),
      // ezért inkább várunk a teljes képre, nem villantjuk fel a hibás vágást átmenetileg.
      src: item.full || null,
      title: item.title,
      sub,
      href: item.url,
      loading: !item.full,
    });
    if (!item.full) {
      try {
        const src = await getFullImage(item);
        if (filteredList()[state.index] === item) {
          gal.setStage({ src, title: item.title, sub, href: item.url, loading: true });
        }
      } catch (e) {
        if (filteredList()[state.index] === item) {
          gal.setStage({ src: item.thumb, title: item.title, sub: item.lead, href: item.url, loading: false });
        }
      }
    }
  }

  function jumpTo(i) {
    const list = filteredList();
    if (!list.length) return;
    state.index = Math.max(0, Math.min(i, list.length - 1));
    showCurrent();
  }

  async function stepBy(delta) {
    if (state.busy) return;
    state.busy = true;
    try {
      let guard = 0;
      while (guard++ < 60) {
        const list = filteredList();
        const next = state.index + delta;
        if (next >= 0 && next < list.length) {
          state.index = next;
          return;
        }
        if (delta > 0 && state.page < state.maxPage) {
          await loadNextPage();
          renderMeta();
          continue;
        }
        S.ui.toast(delta > 0 ? 'Ez az utolsó betöltött karikatúra.' : 'Ez az első betöltött karikatúra.');
        return;
      }
    } catch (e) {
      S.ui.toast(`Nem sikerült betölteni: ${e.message || e}`);
    } finally {
      state.busy = false;
      await showCurrent();
    }
  }

  // Kereséskor csendben tovább lapoz, amíg elég találat nem gyűlik össze, vagy el nem fogy az archívum.
  async function onQueryChange(raw) {
    const myToken = ++searchToken;
    state.query = lc(raw.trim());
    const list = filteredList();
    state.index = list.length ? 0 : -1;
    await showCurrent();
    if (!state.query) return;
    state.searching = true;
    try {
      while (searchToken === myToken && filteredList().length < MIN_MATCHES && state.page < state.maxPage) {
        const ok = await loadNextPage().catch(() => false);
        if (searchToken !== myToken) return;
        if (!ok) break;
        if (state.index < 0 && filteredList().length) state.index = 0;
        renderMeta();
      }
    } finally {
      if (searchToken === myToken) {
        state.searching = false;
        renderMeta();
      }
    }
  }

  let qTimer = 0;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(qTimer);
    const v = e.target.value;
    qTimer = setTimeout(() => onQueryChange(v), 200);
  });

  // ---------- indulás ----------
  const cached = await loadListCache();
  if (cached && cached.items && cached.items.length) {
    state.items = cached.items;
    for (const it of cached.items) state.seen.add(it.url);
    state.page = cached.page || 1;
    state.maxPage = cached.maxPage || 1;
    state.index = 0;
    showCurrent();
  }

  try {
    const first = await fetchTagPage(1);
    const added = mergeItemsAtStart(first.items);
    state.maxPage = Math.max(state.maxPage, first.maxPage);
    if (!state.page) state.page = 1;
    if (added || !cached) {
      if (state.index < 0) state.index = 0;
      saveListCache();
      showCurrent();
    } else {
      renderMeta();
    }
  } catch (e) {
    if (!state.items.length) {
      gal.setStage({ src: null, title: 'Nem sikerült betölteni a Marabu-karikatúrákat', sub: e.message || String(e), loading: false });
    }
  }
  updateLoadMoreBtn();
  prefetchArchive();

  // Az első oldalról érkező új tételeket az elejére fűzi (ott jelennek meg a legfrissebbek),
  // a már ismerteket változatlanul hagyva.
  function mergeItemsAtStart(newItems) {
    const fresh = newItems.filter((it) => it.url && !state.seen.has(it.url));
    for (const it of fresh) state.seen.add(it.url);
    state.items = [...fresh, ...state.items];
    if (fresh.length && state.index >= 0) state.index += fresh.length;
    return fresh.length;
  }
})();
