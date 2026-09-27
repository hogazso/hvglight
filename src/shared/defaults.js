/*
 * hvglight – közös konstansok, alapbeállítások és a beállítások tárolása.
 * Klasszikus scriptként töltődik be a content scriptben és az extension oldalakon is,
 * mindent a globalThis.hvglight névtérre tesz.
 */
(function (g) {
  'use strict';
  const S = (g.hvglight = g.hvglight || {});

  // Firefoxban a promise-alapú `browser`, Chrome/Edge alatt a `chrome` névtér.
  S.api = g.browser && g.browser.runtime ? g.browser : g.chrome;

  // hvg.hu rovatok: az URL első szakasza (hvg.hu/<slug>/2026..._cim).
  S.SECTIONS = [
    { slug: '360', label: 'hvg360' },
    { slug: 'itthon', label: 'Itthon' },
    { slug: 'vilag', label: 'Világ' },
    { slug: 'gazdasag', label: 'Gazdaság' },
    { slug: 'tudomany', label: 'Tech' },
    { slug: 'kultura', label: 'Kult' },
    { slug: 'eurologus', label: 'EUrologus' },
    { slug: 'elet', label: 'Élet+Stílus' },
    { slug: 'sport', label: 'Sport' },
    { slug: 'cegauto', label: 'Autó' },
    { slug: 'hvgkonyvek', label: 'HVG Könyvek' },
    { slug: 'zhvg', label: 'zhvg' },
    { slug: 'brandcontent', label: 'Szponzorált (brandcontent)' },
    { slug: 'brandchannel', label: 'Szponzorált (brandchannel)' },
  ];

  // Testvéroldalak, amelyek cikkei megjelennek a hvg.hu címlapján.
  // Az aldomainek is illeszkednek: a "hvgblog.hu" elkapja a nyomorszele.hvgblog.hu-t is.
  S.DOMAINS = [
    { host: 'pulzus.hvg.hu', label: 'Pulzus' },
    { host: 'eduline.hu', label: 'Eduline' },
    { host: 'adozona.hu', label: 'Adózóna' },
    { host: 'amu.hvg.hu', label: 'A mű' },
    { host: 'hvgblog.hu', label: 'hvg blogok' },
  ];

  // RSS-hírfolyamok: ezekből jönnek a cikkek címkéi. A content script az oldallal
  // azonos originről tölti le őket, ezért itt csak útvonal szerepel.
  S.FEEDS = [
    { slug: '', path: '/rss' },
    { slug: '360', path: '/rss/360' },
    { slug: 'itthon', path: '/rss/itthon' },
    { slug: 'vilag', path: '/rss/vilag' },
    { slug: 'gazdasag', path: '/rss/gazdasag' },
    { slug: 'tudomany', path: '/rss/tudomany' },
    { slug: 'kultura', path: '/rss/kultura' },
    { slug: 'eurologus', path: '/rss/eurologus' },
    { slug: 'elet', path: '/rss/elet' },
    { slug: 'sport', path: '/rss/sport' },
    { slug: 'cegauto', path: '/rss/cegauto' },
    { slug: 'hvgkonyvek', path: '/rss/hvgkonyvek' },
  ];
  // Más originről jövő folyamok: csak az extension oldalai (hírfolyam, beállítások) érik el.
  S.EXTRA_FEEDS = [{ slug: 'pulzus', url: 'https://pulzus.hvg.hu/rss' }];

  // Ha ezek valamelyikét nyitod meg, szándékosan keresel valamit: ott nincs szűrés.
  S.INTENT_PATHS = ['cimke', 'kereses', 'szerzok', 'szerzo'];

  S.DEFAULTS = Object.freeze({
    enabled: true,
    mode: 'hide', // 'hide' = elrejt, 'dim' = halványan mutatja, mit szűrne
    blockSections: ['elet', 'brandcontent', 'brandchannel'],
    allowSections: ['kultura'],
    blockDomains: ['pulzus.hvg.hu'],
    blockTags: [
      'színes', 'hírességek', 'divat', 'szépség', 'életmód', 'párkapcsolat',
      'horoszkóp', 'játék', 'ötös lottó', 'hatos lottó', 'skandináv lottó',
      'balhé', 'celeb', 'királyi család', 'valóságshow', 'HVGame', 'appajánló',
    ],
    allowTags: ['színház', 'irodalom', 'képzőművészet', 'komolyzene', 'Tóta W. Árpád'],
    blockKeywords: ['nyerőszám', 'lesifotó', 'bikini', 'le sem tagadhatná', 'babát vár'],
    allowKeywords: [],
    allowPremium: true,
    hideBlocks: ['Pulzus'],
    collapseEmpty: true,
    respectIntent: true,
    showPill: true,
  });

  const clone = (o) => JSON.parse(JSON.stringify(o));

  S.sectionLabel = (slug) => (S.SECTIONS.find((x) => x.slug === slug) || {}).label || slug;
  S.domainLabel = (host) => {
    const d = S.DOMAINS.find((x) => host === x.host || host.endsWith('.' + x.host));
    return d ? d.label : host;
  };

  // Ismeretlen vagy rossz típusú mezőket eldobja, a hiányzókat alapértékkel tölti.
  S.withDefaults = function (s) {
    const out = clone(S.DEFAULTS);
    if (s && typeof s === 'object') {
      for (const k of Object.keys(S.DEFAULTS)) {
        const def = S.DEFAULTS[k];
        const v = s[k];
        if (Array.isArray(def) ? Array.isArray(v) : typeof v === typeof def) out[k] = clone(v);
      }
      if (typeof s.updatedAt === 'number') out.updatedAt = s.updatedAt;
    }
    if (!['hide', 'dim'].includes(out.mode)) out.mode = 'hide';
    return out;
  };

  // A beállítás a sync és a local tárolóba is bekerül; olvasáskor a frissebb nyer.
  // Így ha a sync kvóta betelik (8 KB/elem), a helyi példány akkor is működik.
  S.loadSettings = async function () {
    const safe = (p) => Promise.resolve(p).catch(() => ({}));
    const [sy, lo] = await Promise.all([
      safe(S.api.storage.sync.get('settings')),
      safe(S.api.storage.local.get('settings')),
    ]);
    const a = sy && sy.settings;
    const b = lo && lo.settings;
    const pick = !a ? b : !b ? a : (a.updatedAt || 0) >= (b.updatedAt || 0) ? a : b;
    return S.withDefaults(pick);
  };

  S.saveSettings = async function (s, stamp) {
    const data = { ...S.withDefaults(s), updatedAt: stamp || Date.now() };
    await S.api.storage.local.set({ settings: data });
    let synced = true;
    try {
      await S.api.storage.sync.set({ settings: data });
    } catch (e) {
      synced = false;
    }
    return { settings: data, synced };
  };

  S.onSettingsChanged = function (cb) {
    let timer = null;
    S.api.storage.onChanged.addListener((changes, area) => {
      if (!changes.settings || (area !== 'sync' && area !== 'local')) return;
      clearTimeout(timer);
      timer = setTimeout(() => S.loadSettings().then(cb), 30);
    });
  };
})(globalThis);
