/*
 * Szita – szabálymotor. Egy cikkről eldönti, átmegy-e a szitán, és miért.
 *
 * Kiértékelési sorrend:
 *   1. Kivételek (mindig nyernek): prémium, kivétel rovat, kivétel címke, kivétel kulcsszó
 *   2. Tiltások: testvéroldal, rovat, címke, kulcsszó
 *   3. Egyébként marad.
 */
(function (g) {
  'use strict';
  const S = g.Szita;

  const lc = (s) => String(s || '').toLocaleLowerCase('hu-HU').trim();
  S.lc = lc;

  S.normUrl = function (href) {
    try {
      const u = new URL(href, 'https://hvg.hu/');
      if (!/^https?:$/.test(u.protocol)) return '';
      const host = u.hostname.toLowerCase().replace(/^www\./, '');
      return `https://${host}${u.pathname.replace(/\/+$/, '')}`;
    } catch (e) {
      return '';
    }
  };

  S.describeUrl = function (href) {
    const url = S.normUrl(href);
    if (!url) return null;
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    const isHvg = u.hostname === 'hvg.hu';
    return {
      url,
      host: u.hostname,
      isHvg,
      section: isHvg ? segs[0] || '' : '',
      // A hvg cikk-URL-ek mintája: /<rovat>/20260927_cim
      isArticle: segs.length >= 2 || /\d{8}_/.test(u.pathname),
    };
  };

  // "/minta/" alakban reguláris kifejezés, egyébként kis-nagybetűre érzéketlen részszöveg.
  const RE_LITERAL = /^\/(.+)\/([a-z]*)$/i;

  S.keywordError = function (k) {
    const m = String(k || '').trim().match(RE_LITERAL);
    if (!m) return '';
    try {
      new RegExp(m[1], m[2].replace(/[gyiu]/g, '') + 'iu');
      return '';
    } catch (e) {
      return e.message;
    }
  };

  function compileKeywords(list) {
    const out = [];
    for (const raw of list || []) {
      const k = String(raw || '').trim();
      if (!k) continue;
      const m = k.match(RE_LITERAL);
      if (m) {
        try {
          out.push({ raw: k, re: new RegExp(m[1], m[2].replace(/[gyiu]/g, '') + 'iu') });
        } catch (e) {
          /* hibás minta: kihagyjuk, a beállítások oldal jelzi */
        }
      } else {
        out.push({ raw: k, sub: lc(k) });
      }
    }
    return out;
  }

  S.compile = function (settings) {
    const s = S.withDefaults(settings);
    return {
      s,
      blockSections: new Set(s.blockSections),
      allowSections: new Set(s.allowSections),
      blockDomains: s.blockDomains.map(lc).filter(Boolean),
      blockTags: new Set(s.blockTags.map(lc)),
      allowTags: new Set(s.allowTags.map(lc)),
      blockKw: compileKeywords(s.blockKeywords),
      allowKw: compileKeywords(s.allowKeywords),
      hideBlocks: new Set(s.hideBlocks.map(lc)),
    };
  };

  const hostMatches = (host, d) => host === d || host.endsWith('.' + d);

  function matchKw(raw, lower, kws) {
    for (const k of kws) {
      if (k.re ? k.re.test(raw) : lower.includes(k.sub)) return k.raw;
    }
    return null;
  }

  const KEEP = Object.freeze({ keep: true, why: '', kind: 'default' });

  /**
   * @param {object} a  { host, isHvg, section, feeds[], title, lead, tags[], premium }
   * @param {object} c  S.compile() eredménye
   * @param {object} [ctx] { skipSection: 'elet' } – szándékos rovatoldalon az adott rovat nem tiltható
   */
  S.evaluate = function (a, c, ctx) {
    const raw = `${a.title || ''}\n${a.lead || ''}`;
    const lower = lc(raw);
    const tags = (a.tags || []).map(lc);
    const secs = new Set([a.section, ...(a.feeds || [])].filter(Boolean));

    if (c.s.allowPremium && a.premium) return { keep: true, why: 'Prémium', kind: 'premium' };
    for (const x of secs) {
      if (c.allowSections.has(x)) return { keep: true, why: `Kivétel rovat: ${S.sectionLabel(x)}`, kind: 'allow' };
    }
    for (const t of tags) {
      if (c.allowTags.has(t)) return { keep: true, why: `Kivétel címke: ${t}`, kind: 'allow' };
    }
    const ak = matchKw(raw, lower, c.allowKw);
    if (ak) return { keep: true, why: `Kivétel kulcsszó: ${ak}`, kind: 'allow' };

    const d = c.blockDomains.find((x) => hostMatches(a.host || '', x));
    if (d) return { keep: false, why: `Oldal: ${S.domainLabel(a.host)}`, kind: 'domain', key: d };
    if (a.isHvg && c.blockSections.has(a.section) && !(ctx && ctx.skipSection === a.section)) {
      return { keep: false, why: `Rovat: ${S.sectionLabel(a.section)}`, kind: 'section', key: a.section };
    }
    for (const t of tags) {
      if (c.blockTags.has(t)) return { keep: false, why: `Címke: ${t}`, kind: 'tag', key: t };
    }
    const bk = matchKw(raw, lower, c.blockKw);
    if (bk) return { keep: false, why: `Kulcsszó: ${bk}`, kind: 'keyword', key: bk };
    return KEEP;
  };
})(globalThis);
