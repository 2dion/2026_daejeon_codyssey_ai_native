/* theme.js — 첫 페인트 전에 테마를 정한다.

   여기만 defer 없이 불러온다. 이 코드가 첫 페인트보다 늦으면
   다크 모드에서 흰 화면이 한 번 번쩍인다 (기획서 8.3절).

   원래는 <head> 안의 인라인 <script> 였다. CSP 를 걸면서 파일로 뺐다.
   인라인 스크립트 하나 때문에 script-src 에 'unsafe-inline' 을 넣으면
   CSP 가 XSS 를 막는 기능이 통째로 꺼진다. 공격자가 심는 것도 인라인이다. */
(function () {
  'use strict';
  try {
    const saved = localStorage.getItem('cr-theme');
    const theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
