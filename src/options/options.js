/* Szita – beállítások oldal. Minden változás automatikusan mentődik. */
(async function () {
  'use strict';
  const S = globalThis.Szita;
  const el = S.ui.el;
  const $ = (id) => document.getElementById(id);

  const state = {
    settings: await S.loadSettings(),
    index: await S.loadIndex(),
  };
  const redrawers = []; // a mentés után frissítendő részek

  // ---------- mentés ----------
  let saveTimer = 0;
  function update(mutator, { now = false } = {}) {
    mutator(state.settings);
    redrawers.forEach((fn) => fn());
    drawImpact();
    clearTimeout(saveTimer);
    $('saved').textContent = 'Mentés…';
    saveTimer = setTimeout(persist, now ? 0 : 350);
  }
  async function persist() {
    clearTimeout(saveTimer);
    const stamp = Date.now();
    state.settings.updatedAt = stamp; // a saját mentésünket így ismerjük fel az onChanged-ben
    const res = await S.saveSettings(state.settings, stamp);
    $('saved').textContent = res.synced ? 'Mentve' : 'Mentve helyben (a böngésző-szinkron tárhelye megtelt)';
  }
  // A popup, a hírfolyam vagy egy másik lap is módosíthat: ilyenkor újraépítjük az űrlapot.
  S.onSettingsChanged((s) => {
    if (s.updatedAt === state.settings.updatedAt) return;
    state.settings = s;
    build();
  });

  // ---------- hatás: hány friss cikk akad fenn ----------
  function drawImpact() {
    const items = Object.values(state.index.items || {});
    if (!items.length) {
      $('impact').textContent = 'Még nincs letöltött cikk, ezért nem tudom megmutatni a szabályok hatását.';
      return;
    }
    const c = S.compile(state.settings);
    let out = 0;
    for (const it of items) {
      const d = S.describeUrl(it.url);
      if (!d) continue;
      const v = S.evaluate({ ...d, title: it.title, lead: it.lead, tags: it.tags, feeds: it.feeds, premium: d.section === '360' }, c);
      if (!v.keep) out++;
    }
    $('impact').replaceChildren(`${items.length} friss cikkből `, el('strong', { text: String(out) }), ' akad fenn a szitán.');
  }

  // ---------- építőelemek ----------
  const group = (title, hint, ...body) =>
    el('section', { class: 'group' }, el('h2', { text: title }), hint ? el('p', { class: 'hint' }, hint) : null, body);

  function checkbox(key, label, help) {
    return el(
      'label',
      { class: 'opt' },
      el('input', {
        type: 'checkbox',
        checked: state.settings[key],
        onchange: (e) => update((s) => (s[key] = e.target.checked)),
      }),
      el('span', null, label, help ? el('small', { text: help }) : null)
    );
  }

  let segId = 0;
  function seg(options, current, onPick, extraClass) {
    const name = `seg${++segId}`;
    return el(
      'div',
      { class: `seg ${extraClass || ''}`, role: 'radiogroup' },
      options.map(([value, label, cls]) =>
        el(
          'label',
          { class: cls || '' },
          el('input', { type: 'radio', name, value, checked: value === current, onchange: () => onPick(value) }),
          el('span', { text: label })
        )
      )
    );
  }

  const ciHas = (list, v) => list.some((x) => S.lc(x) === S.lc(v));
  const ciWithout = (list, v) => list.filter((x) => S.lc(x) !== S.lc(v));

  function chipEditor(key, kind, placeholder) {
    const chips = el('div', { class: 'chips' });
    const draw = () =>
      chips.replaceChildren(
        ...state.settings[key].map((v) =>
          el(
            'span',
            { class: `chip chip-${kind}` },
            v,
            el('button', {
              type: 'button',
              'aria-label': `${v} törlése`,
              text: '×',
              onclick: () => update((s) => (s[key] = ciWithout(s[key], v))),
            })
          )
        )
      );
    const add = (raw) => {
      const vals = raw.split(',').map((x) => x.trim()).filter(Boolean);
      if (!vals.length) return;
      update((s) => {
        for (const v of vals) if (!ciHas(s[key], v)) s[key].push(v);
        // Ugyanaz a címke nem lehet egyszerre tiltott és kivétel.
        const other = key === 'blockTags' ? 'allowTags' : key === 'allowTags' ? 'blockTags' : null;
        if (other) for (const v of vals) s[other] = ciWithout(s[other], v);
      });
    };
    const input = el('input', {
      type: 'text',
      placeholder,
      'aria-label': placeholder,
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          add(input.value);
          input.value = '';
        } else if (e.key === 'Backspace' && !input.value && state.settings[key].length) {
          update((s) => s[key].pop());
        }
      },
      onblur: () => {
        if (input.value.trim()) {
          add(input.value);
          input.value = '';
        }
      },
    });
    redrawers.push(draw);
    draw();
    return el('div', { class: 'chip-editor' }, chips, input);
  }

  // ---------- szakaszok ----------
  function generalGroup() {
    return group(
      'Általános',
      null,
      el(
        'div',
        { class: 'opts' },
        el(
          'div',
          { class: 'line' },
          el(
            'label',
            { class: 'switch' },
            el('input', { type: 'checkbox', checked: state.settings.enabled, onchange: (e) => update((s) => (s.enabled = e.target.checked)) }),
            el('span', { class: 'track' }),
            el('span', { text: 'Szűrés a hvg.hu oldalain' })
          ),
          seg(
            [
              ['hide', 'Elrejtés'],
              ['dim', 'Halványítás'],
            ],
            state.settings.mode,
            (v) => update((s) => (s.mode = v))
          )
        ),
        checkbox('allowPremium', 'A prémium (hvg360) cikkek mindig látszanak', 'Ezekért fizetsz, ezért minden tiltás elé kerülnek.'),
        checkbox('collapseEmpty', 'Kiürült címlap-blokkok elrejtése', 'Ha egy blokk minden cikke kiesik, a fejléce se maradjon ott.'),
        checkbox(
          'respectIntent',
          'Ahol szándékosan keresel, ott ne szűrjön',
          'Címke-, szerző- és keresőoldalon kikapcsol; egy rovat nyitóoldalán (pl. hvg.hu/elet) az adott rovat tiltása nem él.'
        ),
        checkbox('showPill', 'Számláló a bal alsó sarokban', 'Rákattintva halványan megmutatja, mit rejtett el az oldalon.')
      )
    );
  }

  function sectionsGroup() {
    const rows = el('div', { class: 'rows' });
    const known = S.SECTIONS.map((x) => x.slug);
    const extra = [...state.settings.blockSections, ...state.settings.allowSections].filter((x) => !known.includes(x));
    const draw = () =>
      rows.replaceChildren(
        ...[...known, ...new Set(extra)].map((slug) => {
          const st = state.settings.blockSections.includes(slug) ? 'block' : state.settings.allowSections.includes(slug) ? 'allow' : 'default';
          const row = el(
            'div',
            { class: `rowx is-${st}` },
            el('span', { class: 'name' }, el('span', { text: S.sectionLabel(slug) }), el('small', { text: `hvg.hu/${slug}` })),
            seg(
              [
                ['block', 'Elrejt', 'seg-block'],
                ['default', 'Alap'],
                ['allow', 'Mindig mutat', 'seg-allow'],
              ],
              st,
              (v) => {
                row.className = `rowx is-${v}`;
                update((s) => {
                  s.blockSections = s.blockSections.filter((x) => x !== slug);
                  s.allowSections = s.allowSections.filter((x) => x !== slug);
                  if (v === 'block') s.blockSections.push(slug);
                  if (v === 'allow') s.allowSections.push(slug);
                });
              }
            )
          );
          return row;
        })
      );
    draw();
    return group(
      'Rovatok',
      [
        'Az Elrejt az egész rovatot kiveszi. A Mindig mutat kivétel: az a cikk is átmegy, amelyet a hvg több rovatba is besorolt. Például a Kult rovatba sorolt Élet+Stílus cikkek így megmaradnak, a celebhírek nem.',
      ],
      rows
    );
  }

  function domainsGroup() {
    const rows = el('div', { class: 'rows' });
    const draw = () => {
      const custom = state.settings.blockDomains.filter((d) => !S.DOMAINS.some((x) => x.host === d));
      const all = [...S.DOMAINS.map((x) => ({ host: x.host, label: x.label })), ...custom.map((h) => ({ host: h, label: h }))];
      rows.replaceChildren(
        ...all.map(({ host, label }) => {
          const blocked = state.settings.blockDomains.includes(host);
          const row = el(
            'div',
            { class: `rowx ${blocked ? 'is-block' : ''}` },
            el('span', { class: 'name' }, el('span', { text: label }), label !== host ? el('small', { text: host }) : null),
            seg(
              [
                ['block', 'Elrejt', 'seg-block'],
                ['show', 'Mutat'],
              ],
              blocked ? 'block' : 'show',
              (v) => {
                row.className = `rowx ${v === 'block' ? 'is-block' : ''}`;
                update((s) => {
                  s.blockDomains = s.blockDomains.filter((x) => x !== host);
                  if (v === 'block') s.blockDomains.push(host);
                });
              }
            )
          );
          return row;
        })
      );
    };
    draw();
    const input = el('input', { type: 'text', placeholder: 'pl. valami.hvg.hu', 'aria-label': 'Tiltandó oldal címe' });
    const addDomain = () => {
      const host = input.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
      if (!host || !host.includes('.')) return;
      input.value = '';
      update((s) => {
        if (!s.blockDomains.includes(host)) s.blockDomains.push(host);
      });
      draw();
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && addDomain());
    return group(
      'Testvéroldalak',
      'A hvg.hu címlapján más oldalak cikkei is megjelennek. Az aldomainek is számítanak: a hvgblog.hu tiltása minden hvg-blogot elrejt.',
      rows,
      el('div', { class: 'add' }, input, el('button', { type: 'button', class: 'btn', text: 'Tiltás', onclick: addDomain }))
    );
  }

  function tagsGroup() {
    const sugBox = el('div', { class: 'chips' });
    const drawSug = () => {
      const counts = new Map();
      const rubrics = new Set();
      for (const it of Object.values(state.index.items || {})) {
        if (it.rubric) rubrics.add(S.lc(it.rubric));
        for (const t of it.tags || []) {
          const k = S.lc(t);
          const c = counts.get(k) || { tag: t, n: 0 };
          c.n++;
          counts.set(k, c);
        }
      }
      const blocked = new Set(state.settings.blockTags.map(S.lc));
      const allowed = new Set(state.settings.allowTags.map(S.lc));
      const top = [...counts.entries()]
        .filter(([k, c]) => !rubrics.has(k) && c.n >= 2)
        .sort((a, b) => b[1].n - a[1].n)
        .slice(0, 70);
      sugBox.replaceChildren(
        ...(top.length
          ? top.map(([k, c]) =>
              el(
                'button',
                {
                  type: 'button',
                  class: `sug ${blocked.has(k) ? 'is-block' : allowed.has(k) ? 'is-allow' : ''}`,
                  'aria-haspopup': 'menu',
                  onclick: (ev) =>
                    S.ui.tagMenu(ev.currentTarget, c.tag, state.settings, async (next) => {
                      state.settings = S.withDefaults({ ...next, updatedAt: state.settings.updatedAt });
                      redrawers.forEach((fn) => fn());
                      drawImpact();
                      await persist();
                    }),
                },
                c.tag,
                el('span', { class: 'n', text: String(c.n) })
              )
            )
          : [el('span', { class: 'hint', text: 'Nyisd meg egyszer a hvg.hu-t vagy a tiszta hírfolyamot, és itt megjelennek a gyakori címkék.' })])
      );
    };
    redrawers.push(drawSug);
    drawSug();
    return group(
      'Címkék',
      'A hvg minden cikket címkékkel lát el (pl. színes, hírességek, foci). Ezek a legpontosabb bulvárjelzők. Pontos egyezés számít, kis- és nagybetűtől függetlenül.',
      el(
        'div',
        { class: 'pair' },
        el('div', null, el('h3', { class: 'block', text: 'Tiltott címkék' }), chipEditor('blockTags', 'block', 'Új címke, Enter')),
        el('div', null, el('h3', { class: 'allow', text: 'Kivételek, mindig látszanak' }), chipEditor('allowTags', 'allow', 'Új címke, Enter'))
      ),
      el(
        'div',
        { class: 'suggest' },
        el('h3', { text: 'Gyakori címkék a friss cikkekben' }),
        el('p', { class: 'hint', text: 'Kattints egy címkére, és eldöntheted, mi legyen vele. A szám azt mutatja, hány friss cikken szerepel.' }),
        sugBox
      )
    );
  }

  function keywordArea(key, label, cls) {
    const err = el('p', { class: 'kw-err', hidden: true });
    const ta = el('textarea', { spellcheck: 'false', 'aria-label': label });
    ta.value = state.settings[key].join('\n');
    ta.addEventListener('input', () => {
      const lines = ta.value.split('\n').map((x) => x.trim()).filter(Boolean);
      const bad = lines.map((l) => [l, S.keywordError(l)]).filter(([, e]) => e);
      err.hidden = !bad.length;
      err.textContent = bad.map(([l, e]) => `${l}: ${e}`).join(' | ');
      update((s) => (s[key] = lines));
    });
    return el('div', null, el('h3', { class: cls, text: label }), ta, err);
  }

  function keywordsGroup() {
    return group(
      'Kulcsszavak',
      'A cím és a bevezető szövegében keres. Soronként egy kifejezés, kis- és nagybetűtől függetlenül.',
      el('div', { class: 'pair' }, keywordArea('blockKeywords', 'Tiltó kifejezések', 'block'), keywordArea('allowKeywords', 'Kivételek', 'allow')),
      el(
        'p',
        { class: 'kw-help' },
        'Perjelek között reguláris kifejezés is lehet, például ',
        el('code', { text: '/– videó$/' }),
        ' vagy ',
        el('code', { text: '/(megszületett|babát vár).*(unokája|kislánya|kisfia)/' }),
        '. Kerüld az általános szavakat: a „kiderült” a komoly cikkekben is gyakori.'
      )
    );
  }

  function blocksGroup() {
    return group(
      'Címlap-blokkok',
      'A hvg.hu címlapján egy blokk fejlécében álló cím (pl. Pulzus, Podcastok, HVG Könyvek). Az így megnevezett blokk teljesen eltűnik.',
      chipEditor('hideBlocks', 'block', 'Blokk címe, Enter')
    );
  }

  function backupGroup() {
    const file = el('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden' });
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        const before = JSON.parse(JSON.stringify(state.settings));
        state.settings = S.withDefaults(data.settings || data);
        await persist();
        build();
        S.ui.toast('Szabályok betöltve.', {
          label: 'Visszavonás',
          run: async () => {
            state.settings = before;
            await persist();
            build();
          },
        });
      } catch (e) {
        S.ui.toast(`Ez a fájl nem Szita-szabálykészlet (${e.message}).`);
      }
      file.value = '';
    });
    const exportJson = () => {
      const { updatedAt, ...rest } = state.settings;
      const blob = new Blob([JSON.stringify({ szita: 1, settings: rest }, null, 2)], { type: 'application/json' });
      const a = el('a', { href: URL.createObjectURL(blob), download: 'szita-szabalyok.json' });
      document.body.append(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
    };
    const reset = async () => {
      if (!confirm('Visszaállítod az összes szabályt az alapértelmezettre?')) return;
      const before = JSON.parse(JSON.stringify(state.settings));
      state.settings = S.withDefaults(null);
      await persist();
      build();
      S.ui.toast('Alapértelmezett szabályok visszaállítva.', {
        label: 'Visszavonás',
        run: async () => {
          state.settings = before;
          await persist();
          build();
        },
      });
    };
    return group(
      'Mentés és visszaállítás',
      'A szabályok a böngésző fiókodon keresztül szinkronizálódnak. Fájlba mentve másik böngészőbe is átviheted őket.',
      el(
        'div',
        { class: 'tools' },
        el('button', { type: 'button', class: 'btn', text: 'Exportálás fájlba', onclick: exportJson }),
        el('button', { type: 'button', class: 'btn', text: 'Importálás fájlból', onclick: () => file.click() }),
        el('button', { type: 'button', class: 'btn btn-quiet', text: 'Alapértelmezés visszaállítása', onclick: reset }),
        file
      )
    );
  }

  function build() {
    redrawers.length = 0;
    $('form').replaceChildren(
      generalGroup(),
      sectionsGroup(),
      tagsGroup(),
      keywordsGroup(),
      domainsGroup(),
      blocksGroup(),
      backupGroup(),
      el('div', { class: 'end' })
    );
    drawImpact();
  }

  build();

  // Ha az index üres vagy régi, frissítjük, hogy a javaslatok és a hatás pontosak legyenek.
  if (Date.now() - Math.min(state.index.t || 0, state.index.extraT || 0) > S.INDEX_TTL) {
    S.refreshIndex({ extra: true })
      .then((idx) => {
        state.index = idx;
        redrawers.forEach((fn) => fn());
        drawImpact();
      })
      .catch(() => {});
  }
})();
