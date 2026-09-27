/* hvglight – tiszta hírfolyam az RSS-indexből, ugyanazokkal a szabályokkal, mint a hvg.hu-n. */
(async function () {
  'use strict';
  const S = globalThis.hvglight;
  const el = S.ui.el;
  const $ = (id) => document.getElementById(id);

  const STALE = 5 * 60 * 1000;
  const state = {
    settings: await S.loadSettings(),
    compiled: null,
    index: { t: 0, items: {} },
    filter: '',
    q: '',
    showChaff: false,
    loading: false,
    error: '',
  };
  state.compiled = S.compile(state.settings);

  const dayFmt = new Intl.DateTimeFormat('hu-HU', { month: 'long', day: 'numeric', weekday: 'long' });
  const timeFmt = new Intl.DateTimeFormat('hu-HU', { hour: '2-digit', minute: '2-digit' });

  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const key = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
    if (key(d) === key(today)) return 'Ma';
    const y = new Date(today);
    y.setDate(today.getDate() - 1);
    if (key(d) === key(y)) return 'Tegnap';
    return dayFmt.format(d);
  }

  function rovatOf(it, d) {
    if (d.isHvg) return { key: d.section, label: S.sectionLabel(d.section) };
    return { key: d.host, label: S.domainLabel(d.host) };
  }

  // Minden elem kiértékelése egyszer, rendereléskor csak szűrünk.
  function evaluateAll() {
    const out = [];
    for (const it of Object.values(state.index.items)) {
      const d = S.describeUrl(it.url);
      if (!d) continue;
      const a = { ...d, title: it.title, lead: it.lead, tags: it.tags, feeds: it.feeds, premium: d.section === '360' };
      const v = S.evaluate(a, state.compiled);
      out.push({ it, d, v, rov: rovatOf(it, d) });
    }
    out.sort((x, y) => (y.it.date || 0) - (x.it.date || 0));
    return out;
  }

  function renderFilters(all) {
    const counts = new Map();
    for (const x of all) {
      if (!x.v.keep && !state.showChaff) continue;
      const c = counts.get(x.rov.key) || { label: x.rov.label, n: 0 };
      c.n++;
      counts.set(x.rov.key, c);
    }
    if (state.filter && !counts.has(state.filter)) state.filter = '';
    const order = S.SECTIONS.map((s) => s.slug);
    const keys = [...counts.keys()].sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    const total = [...counts.values()].reduce((s, c) => s + c.n, 0);
    const btn = (key, label, n) =>
      el(
        'button',
        {
          type: 'button',
          class: 'filter',
          'aria-pressed': String(state.filter === key),
          onclick: () => {
            state.filter = key;
            render();
          },
        },
        label,
        el('span', { class: 'n', text: String(n) })
      );
    $('filters').replaceChildren(btn('', 'Minden', total), ...keys.map((k) => btn(k, counts.get(k).label, counts.get(k).n)));
  }

  function tagButtons(it) {
    const tags = (it.tags || []).filter((t) => S.lc(t) !== S.lc(it.rubric));
    if (!tags.length) return null;
    const nodes = [];
    tags.forEach((t, i) => {
      const k = S.lc(t);
      const cls = state.compiled.blockTags.has(k) ? 'tag is-block' : state.compiled.allowTags.has(k) ? 'tag is-allow' : 'tag';
      if (i) nodes.push(', ');
      nodes.push(
        el('button', {
          type: 'button',
          class: cls,
          text: t,
          'aria-haspopup': 'menu',
          onclick: (ev) => S.ui.tagMenu(ev.currentTarget, t, state.settings, commit),
        })
      );
    });
    return el('p', { class: 'tags' }, nodes);
  }

  function renderItem(x) {
    const { it, v, rov } = x;
    const date = it.date ? new Date(it.date) : null;
    return el(
      'article',
      { class: v.keep ? 'item' : 'item chaff', 'data-url': it.url },
      el(
        'div',
        { class: 'gut' },
        date ? el('time', { datetime: date.toISOString(), text: timeFmt.format(date) }) : null,
        el('span', { class: 'rov', text: rov.label })
      ),
      el(
        'div',
        { class: 'body' },
        el(
          'h3',
          null,
          el('a', { href: it.url, target: '_blank', rel: 'noopener', text: it.title || it.url }),
          x.d.section === '360' ? el('span', { class: 'prem', title: 'hvg360, prémium', text: '360' }) : null
        ),
        it.lead ? el('p', { class: 'lead', text: it.lead }) : null,
        v.keep ? null : el('p', { class: 'why', text: `Kiszűrve. ${v.why}` }),
        tagButtons(it)
      )
    );
  }

  function render() {
    const all = evaluateAll();
    const kept = all.filter((x) => x.v.keep).length;
    const chaff = all.length - kept;
    $('chaff-count').textContent = chaff ? `(${chaff})` : '';
    renderFilters(all);

    const t = state.index.t;
    $('sub').textContent = all.length
      ? `${all.length} cikk az elmúlt napokból, ebből ${kept} ment át a szitán. Frissítve ${S.ui.ago(t ? Date.now() - t : null)}.`
      : 'hvg.hu, a saját szabályaid szerint';

    const q = S.lc(state.q);
    const rows = all.filter(
      (x) =>
        (x.v.keep || state.showChaff) &&
        (!state.filter || x.rov.key === state.filter) &&
        (!q || S.lc(`${x.it.title} ${x.it.lead}`).includes(q))
    );

    const list = $('list');
    if (!all.length) {
      list.replaceChildren(
        el(
          'div',
          { class: 'empty' },
          state.loading
            ? el('p', { text: 'Betöltöm a hvg.hu hírfolyamait…' })
            : [
                el('p', {
                  text: state.error
                    ? `Nem értem el a hvg.hu hírfolyamait (${state.error}). Ellenőrizd a netkapcsolatot, és próbáld újra.`
                    : 'Még nincs letöltött cikk.',
                }),
                el('button', { type: 'button', class: 'btn btn-primary', text: 'Letöltés most', onclick: () => refresh(true) }),
              ]
        )
      );
      return;
    }
    if (!rows.length) {
      list.replaceChildren(
        el(
          'div',
          { class: 'empty' },
          el('p', { text: q ? `Nincs találat erre: „${state.q}”.` : 'Ebben a nézetben nincs cikk.' }),
          !state.showChaff && chaff
            ? el('button', {
                type: 'button',
                class: 'btn',
                text: 'Kiszűrtek mutatása',
                onclick: () => {
                  $('show-chaff').checked = true;
                  state.showChaff = true;
                  render();
                },
              })
            : null,
          state.filter
            ? el('button', { type: 'button', class: 'btn', text: 'Minden rovat', onclick: () => ((state.filter = ''), render()) })
            : null
        )
      );
      return;
    }

    const frag = document.createDocumentFragment();
    let curDay = null;
    let section = null;
    for (const x of rows) {
      const label = x.it.date ? dayLabel(x.it.date) : 'Dátum nélkül';
      if (label !== curDay) {
        curDay = label;
        section = el('section', { class: 'day' }, el('h2', { text: label }));
        frag.append(section);
      }
      section.append(renderItem(x));
    }
    frag.append(el('footer', { class: 'end', text: 'Ennyi volt az elmúlt napokból. A régebbi cikkek a hvg.hu archívumában vannak.' }));
    list.replaceChildren(frag);
  }

  // Mentés után a görgetési pozíciót a kattintott cikkhez igazítjuk, hogy ne ugráljon a lista.
  async function commit(next) {
    const anchor = document.activeElement && document.activeElement.closest && document.activeElement.closest('.item');
    const url = anchor ? anchor.getAttribute('data-url') : null;
    const before = anchor ? anchor.getBoundingClientRect().top : 0;
    const res = await S.saveSettings(next);
    state.settings = res.settings;
    state.compiled = S.compile(state.settings);
    render();
    if (url) {
      const again = document.querySelector(`.item[data-url="${CSS.escape(url)}"]`);
      if (again) window.scrollBy(0, again.getBoundingClientRect().top - before);
    }
  }

  async function refresh(force) {
    if (state.loading) return;
    const age = Date.now() - Math.min(state.index.t || 0, state.index.extraT || 0);
    if (!force && age < STALE) return;
    state.loading = true;
    state.error = '';
    $('refresh').disabled = true;
    $('refresh').textContent = 'Frissítés…';
    if (!Object.keys(state.index.items).length) render();
    try {
      state.index = await S.refreshIndex({ extra: true });
    } catch (e) {
      state.error = e.message || String(e);
      if (Object.keys(state.index.items).length) S.ui.toast(`A frissítés nem sikerült: ${state.error}`);
    } finally {
      state.loading = false;
      $('refresh').disabled = false;
      $('refresh').textContent = 'Frissítés';
      render();
    }
  }

  $('refresh').addEventListener('click', () => refresh(true));
  $('show-chaff').addEventListener('change', (e) => {
    state.showChaff = e.target.checked;
    render();
  });
  let qTimer = 0;
  $('q').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      state.q = e.target.value;
      render();
    }, 120);
  });

  S.onSettingsChanged((s) => {
    if (s.updatedAt === state.settings.updatedAt) return;
    state.settings = s;
    state.compiled = S.compile(s);
    render();
  });

  state.index = await S.loadIndex();
  render();
  refresh(false);
})();
