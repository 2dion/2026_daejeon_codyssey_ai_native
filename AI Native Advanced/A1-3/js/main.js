/* ==========================================================================
   main.js — 네비게이션, 햄버거 메뉴, 스크롤 활성 표시, 테마, 복사 버튼
   ========================================================================== */

(function () {
  'use strict';

  const toast = window.CRUtil.toast;
  const copyText = window.CRUtil.copyText;

  /* ------------------------------ 햄버거 메뉴 ------------------------------ */
  const toggle = document.getElementById('navToggle');
  const menu = document.getElementById('navMenu');

  function closeMenu() {
    if (!menu) return;
    menu.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', '메뉴 열기');
  }
  function openMenu() {
    menu.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', '메뉴 닫기');
  }

  if (toggle && menu) {
    toggle.addEventListener('click', function () {
      menu.classList.contains('is-open') ? closeMenu() : openMenu();
    });

    // 메뉴 안의 링크를 고르면 닫는다 (키보드 이동 포함)
    menu.addEventListener('click', function (e) {
      if (e.target.closest('.nav__link')) closeMenu();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('is-open')) {
        closeMenu();
        toggle.focus();
      }
    });

    document.addEventListener('click', function (e) {
      if (!menu.classList.contains('is-open')) return;
      if (e.target.closest('.nav__inner')) return;
      closeMenu();
    });

    // 데스크톱 폭으로 돌아오면 인라인 상태를 초기화한다
    window.addEventListener('resize', function () {
      if (window.innerWidth >= 768) closeMenu();
    });
  }

  /* --------------------------- 스크롤 활성 표시 --------------------------- */
  const links = Array.prototype.slice.call(document.querySelectorAll('.nav__link'));

  /* 메뉴에는 두 종류가 섞여 있다.
       같은 페이지 안 앵커 (#rescue)  → 스크롤 위치로 활성 표시
       다른 페이지 (lab.html)        → 지금 열린 파일 이름으로 활성 표시
     앵커가 아닌 href 를 querySelector 에 넘기면 엉뚱한 것을 찾거나 null 이 되므로 나눠 다룬다. */
  const here = window.location.pathname.split('/').pop() || 'index.html';

  function pageOf(href) {
    const path = href.split('#')[0];
    return path === '' ? here : path;
  }

  const anchorLinks = links.filter(function (a) {
    const href = a.getAttribute('href');
    return href.charAt(0) === '#' || pageOf(href) === here;
  });

  const sections = anchorLinks
    .map(function (a) {
      const hash = a.getAttribute('href').split('#')[1];
      return hash ? document.getElementById(hash) : null;
    })
    .filter(Boolean);

  function setActive(id) {
    links.forEach(function (a) {
      const href = a.getAttribute('href');
      const samePage = pageOf(href) === here;
      const hash = href.split('#')[1] || '';
      /* 앵커가 없는 페이지 링크(lab.html)는 그 페이지에 있을 때만 켠다 */
      const on = samePage && (id ? hash === id : !hash);
      a.classList.toggle('is-active', on);
      if (on) { a.setAttribute('aria-current', 'page'); } else { a.removeAttribute('aria-current'); }
    });
  }

  if (!sections.length) setActive(null);

  if ('IntersectionObserver' in window && sections.length) {
    const visible = {};
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        visible[entry.target.id] = entry.isIntersecting ? entry.intersectionRatio : 0;
      });
      let best = null, bestRatio = 0;
      sections.forEach(function (s) {
        const r = visible[s.id] || 0;
        if (r > bestRatio) { bestRatio = r; best = s.id; }
      });
      if (best) setActive(best);
    }, { rootMargin: '-70px 0px -55% 0px', threshold: [0, 0.15, 0.4, 0.75, 1] });

    sections.forEach(function (s) { observer.observe(s); });
  }

  /* ------------------------------- 테마 토글 ------------------------------- */
  const themeBtn = document.getElementById('themeToggle');

  function paintThemeButton(theme) {
    if (!themeBtn) return;
    const isDark = theme === 'dark';
    themeBtn.querySelector('.theme-toggle__icon').textContent = isDark ? '☀️' : '🌙';
    themeBtn.querySelector('.theme-toggle__text').textContent = isDark ? '라이트 모드' : '다크 모드';
    themeBtn.setAttribute('aria-pressed', String(isDark));
    themeBtn.setAttribute('aria-label', isDark ? '라이트 모드로 바꾸기' : '다크 모드로 바꾸기');
  }

  paintThemeButton(document.documentElement.getAttribute('data-theme'));

  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('cr-theme', next); } catch (e) { /* noop */ }
      paintThemeButton(next);
    });
  }

  /* ------------------------------- 복사 버튼 ------------------------------- */
  // 결과 영역은 동적으로 그려지므로 문서 단위 위임으로 처리한다
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.copy-btn');
    if (!btn || btn.disabled) return;

    let text = btn.dataset.copy;
    if (!text) {
      const pre = btn.parentElement.querySelector('pre');
      text = pre ? pre.textContent : '';
    }
    copyText(text).then(function () {
      toast('복사했습니다');
      const old = btn.textContent;
      btn.textContent = '복사됨';
      setTimeout(function () { btn.textContent = old; }, 1400);
    }).catch(function () {
      toast('복사에 실패했습니다. 직접 선택해 복사해주세요.');
    });
  });
})();
