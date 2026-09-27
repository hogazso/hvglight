/*
 * hvglight – RSS-index. A hvg.hu hírfolyamaiból felépít egy URL → {címkék, lead, rovatok}
 * térképet, és a storage.local-ban tárolja. A címlap kártyáin nincs címke, az RSS-ben van.
 */
(function (g) {
  'use strict';
  const S = g.hvglight;

  const KEY = 'hvglightIndex';
  const MAX_AGE = 4 * 24 * 3600 * 1000; // ennél régebbi cikkeket eldobunk
  const MAX_ITEMS = 1500;
  S.INDEX_TTL = 15 * 60 * 1000;

  const stripHtml = (s) =>
    String(s || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  function uniqCi(list) {
    const seen = new Set();
    const out = [];
    for (const x of list) {
      const k = S.lc(x);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(x.trim());
    }
    return out;
  }

  // Az RSS <author> mezője "cím@hvg.hu (Szerző Neve)" alakú; a zárójeles névvel
  // a szerző úgy viselkedik a szűrésben, mint egy szokásos címke (tiltható/kivétel).
  function authorName(raw) {
    const s = String(raw || '');
    const open = s.indexOf('(');
    const close = s.lastIndexOf(')');
    if (open < 0 || close <= open) return '';
    return s.slice(open + 1, close).replace(/\s+/g, ' ').trim();
  }

  S.parseRss = function (xmlText, feedSlug) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Hibás RSS');
    const items = [];
    for (const it of Array.from(doc.getElementsByTagName('item'))) {
      const txt = (name) => {
        const el = it.getElementsByTagName(name)[0];
        return el ? el.textContent.trim() : '';
      };
      const d = S.describeUrl(txt('link'));
      if (!d || !d.isArticle) continue;
      const cats = uniqCi(Array.from(it.getElementsByTagName('category')).map((c) => c.textContent || ''));
      const author = authorName(txt('author'));
      const media = it.getElementsByTagName('media:content')[0] || it.getElementsByTagName('enclosure')[0];
      items.push({
        url: d.url,
        title: txt('title'),
        lead: stripHtml(txt('description')),
        tags: author ? uniqCi([...cats, author]) : cats,
        rubric: cats[0] || '',
        author,
        date: Date.parse(txt('pubDate')) || 0,
        img: media ? media.getAttribute('url') || '' : '',
        feeds: feedSlug ? [feedSlug] : [],
      });
    }
    return items;
  };

  S.loadIndex = async function () {
    try {
      const r = await S.api.storage.local.get(KEY);
      const idx = r && r[KEY];
      if (idx && idx.items) return idx;
    } catch (e) {
      /* üres index */
    }
    return { t: 0, items: {} };
  };

  function merge(items, it) {
    const prev = items[it.url];
    if (!prev) {
      items[it.url] = it;
      return;
    }
    prev.feeds = uniqCi([...(prev.feeds || []), ...it.feeds]);
    prev.tags = uniqCi([...it.tags, ...(prev.tags || [])]);
    if (it.title) prev.title = it.title;
    if (it.lead) prev.lead = it.lead;
    if (it.img) prev.img = it.img;
    if (it.date) prev.date = it.date;
    if (!prev.rubric) prev.rubric = it.rubric;
    if (it.author) prev.author = it.author;
  }

  /**
   * @param {object} opts
   *   base  – a hvg.hu origin (content scriptben location.origin, így azonos originű a kérés)
   *   extra – az idegen originű folyamok is (csak extension oldalakról működik)
   */
  S.refreshIndex = async function ({ base = 'https://hvg.hu', extra = false } = {}) {
    const feeds = S.FEEDS.map((f) => ({ slug: f.slug, url: base + f.path }));
    if (extra) feeds.push(...S.EXTRA_FEEDS);

    const results = await Promise.allSettled(
      feeds.map(async (f) => {
        const res = await fetch(f.url, { credentials: 'omit', cache: 'no-cache' });
        if (!res.ok) throw new Error(`${f.url}: HTTP ${res.status}`);
        return S.parseRss(await res.text(), f.slug);
      })
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    if (!ok.length) {
      const first = results.find((r) => r.status === 'rejected');
      throw new Error(first ? String(first.reason && first.reason.message) : 'A hírfolyamok nem érhetők el');
    }

    const prev = await S.loadIndex();
    const items = { ...prev.items };
    for (const r of ok) for (const it of r.value) merge(items, it);

    // Régi elemek kiszórása, hogy a tároló kicsi maradjon.
    const cutoff = Date.now() - MAX_AGE;
    const kept = Object.values(items)
      .filter((it) => !it.date || it.date >= cutoff)
      .sort((a, b) => (b.date || 0) - (a.date || 0))
      .slice(0, MAX_ITEMS);
    // extraT: mikor jöttek utoljára a más originű folyamok (Pulzus). A content script
    // ezeket nem éri el, ezért az extension oldalak ez alapján döntik el, kell-e frissíteni.
    const index = {
      t: Date.now(),
      extraT: extra ? Date.now() : prev.extraT || 0,
      failed: results.length - ok.length,
      items: {},
    };
    for (const it of kept) index.items[it.url] = it;

    await S.api.storage.local.set({ [KEY]: index });
    return index;
  };

  S.INDEX_KEY = KEY;
})(globalThis);
