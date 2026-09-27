/* Szita – popup: kapcsoló, mód, és az aktív lap statisztikája. */
(async function () {
  'use strict';
  const S = globalThis.Szita;
  const el = S.ui.el;
  const $ = (id) => document.getElementById(id);

  let settings = await S.loadSettings();
  let tabId = null;

  $('enabled').checked = settings.enabled;
  for (const r of document.querySelectorAll('input[name="mode"]')) {
    r.checked = r.value === settings.mode;
    r.addEventListener('change', () => save({ mode: r.value }));
  }
  $('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));

  async function save(patch) {
    settings = { ...settings, ...patch };
    await S.saveSettings(settings);
    setTimeout(loadStats, 120);
  }

  $('reader').addEventListener('click', () => {
    S.api.tabs.create({ url: S.api.runtime.getURL('src/reader/reader.html') });
    window.close();
  });
  $('options').addEventListener('click', () => {
    S.api.runtime.openOptionsPage();
    window.close();
  });
  $('refresh').addEventListener('click', async () => {
    $('index-age').textContent = 'Frissítés…';
    if (tabId != null) {
      try {
        await S.api.tabs.sendMessage(tabId, { type: 'szita:refresh' });
      } catch (e) {
        /* nincs content script */
      }
    }
    setTimeout(loadStats, 1500);
  });

  function render(st, isHvg) {
    const box = $('status');
    box.replaceChildren();
    $('refresh').hidden = !st;

    if (!st) {
      box.append(
        el('p', { class: 'big', text: isHvg ? 'Töltsd újra az oldalt.' : 'Nincs nyitva hvg.hu oldal.' }),
        el('p', {
          class: 'note',
          text: isHvg
            ? 'A szita a telepítés utáni első betöltéstől működik.'
            : 'Nyisd meg a hvg.hu-t, és itt látod, mit szűrtem ki, vagy olvass a tiszta hírfolyamban.',
        })
      );
      $('index-age').textContent = '';
      return;
    }

    if (!settings.enabled) {
      box.append(el('p', { class: 'big', text: 'A szűrés ki van kapcsolva.' }));
    } else if (st.intent === 'off') {
      box.append(
        el('p', { class: 'big', text: 'Ezen az oldalon nem szűrök.' }),
        el('p', { class: 'note', text: 'Címkét, szerzőt vagy keresést nyitottál meg: itt mindent látsz.' })
      );
    } else if (!st.blocked && !st.blocks) {
      box.append(el('p', { class: 'big', text: `Mind a ${st.total} cikk átment a szitán.` }));
    } else {
      box.append(
        el('p', { class: 'big' }, `${st.total} cikkből `, el('strong', { text: String(st.blocked) }), ' kiszűrve'),
        el(
          'ul',
          { class: 'reasons' },
          st.reasons.slice(0, 4).map(([why, n]) => el('li', null, el('span', { text: why }), el('span', { text: String(n) }))),
          st.blocks ? el('li', null, el('span', { text: 'Elrejtett címlap-blokk' }), el('span', { text: String(st.blocks) })) : null
        )
      );
      if (st.intent) {
        box.append(el('p', { class: 'note', text: `Rovatoldalon vagy (${S.sectionLabel(st.intent)}): itt a rovat tiltása nem él, csak a címkék és kulcsszavak.` }));
      }
    }
    $('index-age').textContent = `Címkék: ${S.ui.ago(st.indexAge)} (${st.indexSize} cikk)`;
  }

  async function loadStats() {
    let tab = null;
    try {
      [tab] = await S.api.tabs.query({ active: true, currentWindow: true });
    } catch (e) {
      /* nincs aktív lap */
    }
    tabId = tab ? tab.id : null;
    const isHvg = !!(tab && tab.url && /^https:\/\/(www\.)?hvg\.hu\//.test(tab.url));
    let st = null;
    if (tab && isHvg) {
      try {
        st = await S.api.tabs.sendMessage(tab.id, { type: 'szita:stats' });
      } catch (e) {
        st = null;
      }
    }
    render(st, isHvg);
  }

  loadStats();
})();
