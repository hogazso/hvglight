/*
 * hvglight – Címlaptár: a hvg.hu heti címlapjainak nagyképernyős, léptethető nézegetője.
 * Forrás: hvg.hu/hetilapok/<év>, ahonnan minden év kártyáit (hét, kép, link) kiolvassuk.
 */
(async function () {
  'use strict';
  const S = globalThis.hvglight;
  const el = S.ui.el;

  const CACHE_KEY = 'hvglightCoversCache';
  const CUR_YEAR_TTL = 6 * 3600 * 1000; // a folyó évet néhány óránként újranézzük (új lapszám)
  const OTHER_YEAR_TTL = 30 * 24 * 3600 * 1000; // a lezárt évek gyakorlatilag nem változnak
  const NOW_YEAR = new Date().getFullYear();

  const state = {
    years: new Map(), // év -> { issues:[{year,week,url,img,label}], invalid, fetchedAt }
    year: NOW_YEAR,
    index: 0,
    busy: false,
  };

  async function readCacheYear(year) {
    try {
      const r = await S.api.storage.local.get(CACHE_KEY);
      const all = (r && r[CACHE_KEY]) || {};
      return all[year] || null;
    } catch (e) {
      return null;
    }
  }
  async function writeCacheYear(year, rec) {
    try {
      const r = await S.api.storage.local.get(CACHE_KEY);
      const all = (r && r[CACHE_KEY]) || {};
      all[year] = rec;
      await S.api.storage.local.set({ [CACHE_KEY]: all });
    } catch (e) {
      /* nem baj, csak nem gyorsítótárazunk */
    }
  }

  async function fetchYear(year) {
    const res = await fetch(`https://hvg.hu/hetilapok/${year}`, { credentials: 'omit', cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const curEl = doc.querySelector('.stepper__item.stepper__current');
    const cur = curEl ? parseInt(curEl.textContent.trim(), 10) : NaN;
    if (cur !== year) return { issues: [], invalid: true };

    const issues = [];
    for (const fig of doc.querySelectorAll('.newspaper-card')) {
      const a = fig.querySelector('.newspaper-card__img a[href]');
      const img = fig.querySelector('img');
      if (!a || !img) continue;
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/hetilap\/(\d{4})-(\d{1,2})\s*$/);
      if (!m) continue;
      const cap = fig.querySelector('figcaption');
      issues.push({
        year: parseInt(m[1], 10),
        week: parseInt(m[2], 10),
        url: href,
        img: img.getAttribute('src') || '',
        label: (cap ? cap.textContent.trim() : '') || `${m[1]} ${m[2]}. lapszám`,
      });
    }
    issues.sort((a, b) => a.week - b.week);
    return { issues, invalid: !issues.length };
  }

  async function ensureYear(year) {
    if (state.years.has(year)) return state.years.get(year);
    const cached = await readCacheYear(year);
    const ttl = year >= NOW_YEAR ? CUR_YEAR_TTL : OTHER_YEAR_TTL;
    if (cached && Date.now() - (cached.fetchedAt || 0) < ttl) {
      state.years.set(year, cached);
      return cached;
    }
    let rec;
    try {
      const data = await fetchYear(year);
      rec = { ...data, fetchedAt: Date.now() };
    } catch (e) {
      if (cached) rec = cached; // hálózati hiba esetén a régi (akár lejárt) gyorsítótár is jobb a semminél
      else rec = { issues: [], invalid: false, error: e.message || String(e) };
    }
    state.years.set(year, rec);
    writeCacheYear(year, rec);
    return rec;
  }

  const gal = S.gallery.create(document.getElementById('gal'), {
    onPrev: () => step(-1),
    onNext: () => step(1),
    onFirst: () => jumpWithin(0),
    onLast: () => jumpWithin(Infinity),
    onJump: (i) => jumpWithin(i),
  });
  gal.setHeader({ title: 'HVG címlaptár' });

  // ---------- fejléc: év-léptető + ugrás mező ----------
  const yearLabel = el('span', { class: 'cv-year' });
  const yearPrev = el('button', { type: 'button', class: 'cv-yearbtn', 'aria-label': 'Előző év', onclick: () => goYear(-1) }, '‹');
  const yearNext = el('button', { type: 'button', class: 'cv-yearbtn', 'aria-label': 'Következő év', onclick: () => goYear(1) }, '›');
  const jumpInput = el('input', {
    type: 'text',
    class: 'cv-jump',
    placeholder: 'Ugrás: év vagy év-hét, pl. 2020-15',
    inputmode: 'numeric',
  });
  const jumpForm = el(
    'form',
    {
      class: 'cv-jumpform',
      onsubmit: (e) => {
        e.preventDefault();
        doJump(jumpInput.value);
      },
    },
    jumpInput,
    el('button', { type: 'submit', class: 'btn btn-quiet cv-jumpbtn' }, 'Ugrás')
  );
  gal.headControls.append(el('div', { class: 'cv-yearnav' }, yearPrev, yearLabel, yearNext), jumpForm);

  function render() {
    const rec = state.years.get(state.year);
    if (!rec || !rec.issues.length) {
      gal.setStage({ src: null, title: 'Nincs betölthető címlap', sub: rec && rec.error ? rec.error : '', loading: false });
      gal.setFilm([], -1);
      gal.setStatus('');
      yearLabel.textContent = String(state.year);
      return;
    }
    const issue = rec.issues[state.index];
    gal.setStage({
      src: issue.img,
      title: issue.label,
      sub: `${issue.year}, ${issue.week}. hét`,
      href: issue.url,
      loading: true,
    });
    gal.setFilm(
      rec.issues.map((it) => ({ thumb: it.img, label: it.label })),
      state.index
    );
    gal.setStatus(`${state.index + 1} / ${rec.issues.length}`);
    gal.setNav({ prevEnabled: true, nextEnabled: true });
    yearLabel.textContent = String(state.year);
  }

  async function step(delta) {
    if (state.busy) return;
    state.busy = true;
    try {
      let year = state.year;
      let idx = state.index + delta;
      let rec = state.years.get(year);
      let guard = 0;
      while (guard++ < 200) {
        if (!rec) rec = await ensureYear(year);
        if (idx >= 0 && idx < rec.issues.length) {
          state.year = year;
          state.index = idx;
          return;
        }
        if (idx < 0) {
          const py = year - 1;
          const prec = await ensureYear(py);
          if (!prec.issues.length) {
            S.ui.toast('Ez a legkorábbi elérhető lapszám.');
            return;
          }
          year = py;
          idx = prec.issues.length - 1;
          rec = prec;
        } else {
          const ny = year + 1;
          if (ny > NOW_YEAR + 1) {
            S.ui.toast('Ez a legfrissebb elérhető lapszám.');
            return;
          }
          const nrec = await ensureYear(ny);
          if (!nrec.issues.length) {
            S.ui.toast('Ez a legfrissebb elérhető lapszám.');
            return;
          }
          year = ny;
          idx = 0;
          rec = nrec;
        }
      }
    } catch (e) {
      S.ui.toast(`Nem sikerült betölteni: ${e.message || e}`);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function goYear(dir) {
    if (state.busy) return;
    state.busy = true;
    try {
      const curRec = state.years.get(state.year);
      const curWeek = curRec && curRec.issues[state.index] ? curRec.issues[state.index].week : 1;
      const targetYear = state.year + dir;
      const rec = await ensureYear(targetYear);
      if (!rec.issues.length) {
        S.ui.toast(dir < 0 ? 'Ez a legkorábbi elérhető év.' : 'Ez a legfrissebb elérhető év.');
        return;
      }
      const exact = rec.issues.findIndex((it) => it.week === curWeek);
      state.year = targetYear;
      state.index =
        exact >= 0
          ? exact
          : rec.issues.reduce(
              (best, it, i) => (Math.abs(it.week - curWeek) < Math.abs(rec.issues[best].week - curWeek) ? i : best),
              0
            );
    } catch (e) {
      S.ui.toast(`Nem sikerült betölteni: ${e.message || e}`);
    } finally {
      state.busy = false;
      render();
    }
  }

  function jumpWithin(idx) {
    const rec = state.years.get(state.year);
    if (!rec || !rec.issues.length) return;
    state.index = Math.max(0, Math.min(idx, rec.issues.length - 1));
    render();
  }

  async function doJump(raw) {
    // Elnéző bemenet: "2020-15", "2020/15", "2020. 15.", "2020 15. hét" mind ugyanazt jelenti;
    // ha nincs benne év, a jelenleg mutatott év adott hetének értjük ("15" vagy "15. hét").
    const s = raw
      .trim()
      .toLowerCase()
      .replace(/hetében|heteben|héten|heten|hete|hét|het/g, '')
      .replace(/[.,]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    let year, week;
    const full = s.match(/^(\d{4})(?:[\s\-/]+(\d{1,2}))?$/);
    const weekOnly = s.match(/^(\d{1,2})$/);
    if (full) {
      year = parseInt(full[1], 10);
      week = full[2] ? parseInt(full[2], 10) : null;
    } else if (weekOnly) {
      year = state.year;
      week = parseInt(weekOnly[1], 10);
    } else {
      S.ui.toast('Ezt így nem értem. Írj évet (2020), év-hetet (2020-15), vagy csak egy hetet (15) a jelenlegi évben.');
      return;
    }
    if (state.busy) return;
    state.busy = true;
    try {
      const rec = await ensureYear(year);
      if (!rec.issues.length) {
        S.ui.toast(`${year}-re nincs elérhető címlap.`);
        return;
      }
      let idx = 0;
      if (week != null) {
        const found = rec.issues.findIndex((it) => it.week === week);
        if (found < 0) {
          S.ui.toast(`${year} ${week}. hetéhez nincs lapszám, a legközelebbit mutatom.`);
          idx = rec.issues.reduce(
            (best, it, i) => (Math.abs(it.week - week) < Math.abs(rec.issues[best].week - week) ? i : best),
            0
          );
        } else {
          idx = found;
        }
      } else {
        idx = rec.issues.length - 1;
      }
      state.year = year;
      state.index = idx;
    } catch (e) {
      S.ui.toast(`Nem sikerült betölteni: ${e.message || e}`);
    } finally {
      state.busy = false;
      render();
    }
  }

  // Kezdéskor a folyó év legutolsó (legfrissebb) lapszáma.
  const initial = await ensureYear(NOW_YEAR);
  state.index = Math.max(0, initial.issues.length - 1);
  render();
})();
