/*
 * hvglight – közös, nagyképernyős, léptethető képnézegető a Címlaptárhoz és a Marabu-tárhoz.
 * Csak a megjelenítést és a billentyűzetes/érintős navigációt tudja; az adatokat
 * (mit mutat, mi jön előtte/utána) mindig a hívó oldal (covers.js / marabu.js) adja.
 */
(function (g) {
  'use strict';
  const S = g.hvglight;
  const el = S.ui.el;
  const GAL = (S.gallery = {});

  GAL.create = function (root, handlers) {
    const h = handlers || {};

    const img = el('img', { class: 'gal-img', alt: '' });
    const spinner = el('div', { class: 'gal-spinner', 'aria-hidden': 'true' });
    const errorBox = el('div', { class: 'gal-error', text: 'A kép nem tölthető be.' });
    errorBox.hidden = true;

    const capTitle = el('h2', { class: 'gal-cap-title' });
    const capSub = el('p', { class: 'gal-cap-sub' });
    const capLink = el('a', { class: 'gal-cap-link', target: '_blank', rel: 'noopener', text: 'Megnyitás a hvg.hu-n ↗' });
    const status = el('span', { class: 'gal-status' });
    const headTitle = el('h1', { class: 'gal-title' });
    const headControls = el('div', { class: 'gal-head-controls' });
    const film = el('div', { class: 'gal-film', role: 'listbox', 'aria-label': 'Lapozó' });
    const filmWrap = el('footer', { class: 'gal-film-wrap' }, film);

    const prevBtn = el(
      'button',
      { type: 'button', class: 'gal-nav prev', 'aria-label': 'Előző', onclick: () => h.onPrev && h.onPrev() },
      el('span', { 'aria-hidden': 'true', text: '‹' })
    );
    const nextBtn = el(
      'button',
      { type: 'button', class: 'gal-nav next', 'aria-label': 'Következő', onclick: () => h.onNext && h.onNext() },
      el('span', { 'aria-hidden': 'true', text: '›' })
    );
    const fsBtn = el(
      'button',
      { type: 'button', class: 'gal-fullscreen', 'aria-label': 'Teljes képernyő', onclick: () => toggleFullscreen() },
      el('span', { 'aria-hidden': 'true', text: '⤢' })
    );

    const backdrop = el('div', { class: 'gal-backdrop' });
    const stageInner = el('div', { class: 'gal-stage-inner' }, img, spinner, errorBox);
    const caption = el('div', { class: 'gal-caption' }, capTitle, capSub, capLink);
    const stage = el('div', { class: 'gal-stage' }, stageInner, caption);

    root.replaceChildren(
      backdrop,
      el('header', { class: 'gal-head' }, el('div', { class: 'gal-head-left' }, headTitle, status), headControls),
      el('main', { class: 'gal-stage-wrap' }, prevBtn, stage, nextBtn),
      fsBtn,
      filmWrap
    );

    function toggleFullscreen() {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (root.requestFullscreen) root.requestFullscreen().catch(() => {});
    }

    function onKey(e) {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (typing && e.key !== 'Escape') return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        h.onPrev && h.onPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        h.onNext && h.onNext();
      } else if (e.key === 'Home') {
        e.preventDefault();
        h.onFirst && h.onFirst();
      } else if (e.key === 'End') {
        e.preventDefault();
        h.onLast && h.onLast();
      } else if ((e.key === 'f' || e.key === 'F') && !typing) {
        toggleFullscreen();
      }
    }
    document.addEventListener('keydown', onKey);

    img.addEventListener('load', () => {
      spinner.hidden = true;
      errorBox.hidden = true;
      backdrop.style.setProperty('--bg-img', `url("${img.src}")`);
      backdrop.classList.add('is-visible');
    });
    img.addEventListener('error', () => {
      spinner.hidden = true;
      if (img.getAttribute('src')) errorBox.hidden = false;
    });

    return {
      headControls,
      setHeader({ title }) {
        headTitle.textContent = title || '';
      },
      setStatus(text) {
        status.textContent = text || '';
      },
      setNav({ prevEnabled, nextEnabled }) {
        prevBtn.disabled = !prevEnabled;
        nextBtn.disabled = !nextEnabled;
      },
      setStage({ src, title, sub, href, loading }) {
        errorBox.hidden = true;
        spinner.hidden = !loading;
        if (src) img.src = src;
        else img.removeAttribute('src');
        capTitle.textContent = title || '';
        capSub.textContent = sub || '';
        if (href) {
          capLink.href = href;
          capLink.hidden = false;
        } else {
          capLink.hidden = true;
        }
      },
      setFilm(items, active) {
        film.replaceChildren(
          ...items.map((it, i) =>
            el(
              'button',
              {
                type: 'button',
                class: i === active ? 'gal-thumb is-active' : 'gal-thumb',
                role: 'option',
                'aria-selected': String(i === active),
                title: it.label || '',
                onclick: () => h.onJump && h.onJump(i),
              },
              el('img', { src: it.thumb, alt: '', loading: 'lazy' })
            )
          )
        );
        const activeBtn = film.children[active];
        if (activeBtn) activeBtn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      },
      destroy() {
        document.removeEventListener('keydown', onKey);
      },
    };
  };
})(globalThis);
