/* ==========================================================================
   dom.js — 문자열이 아니라 노드를 만든다

   왜 만들었나
   ----------
   지금까지 화면은 HTML 문자열을 이어 붙이고 innerHTML 로 넣었다. 값이 닿는 자리마다
   escapeHtml 을 불렀고, 실제로 전수 점검도 했다. 그런데 그 방식은 **한 군데만 빠뜨리면
   구멍이 뚫린다.** 안전이 사람의 주의력에 걸려 있는 구조다.

   여기서는 값이 textContent 와 setAttribute 로만 들어간다. 그래서
   **데이터가 마크업이 될 경로 자체가 없다.** 이스케이프를 잊는 실수를 할 수가 없다.

   쓰는 법
   ------
     h('p', { class: 'note' }, '그냥 글자')
     h('li', null, [ h('code', null, cmd), ' 를 실행합니다' ])
     svg('circle', { cx: 10, cy: 10, r: 4 })

   children 은 문자열 · 노드 · 배열 · null 을 섞어 쓸 수 있다.
   문자열은 항상 텍스트 노드가 된다 — 태그로 해석되지 않는다.
   ========================================================================== */

(function (root) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /* 값을 프로퍼티로 넣어야 하는 속성. setAttribute 로는 기대대로 동작하지 않거나
     (checked/value) 불리언 처리가 어색해지는 것들이다. */
  const PROPS = { disabled: 1, checked: 1, hidden: 1, value: 1, selected: 1 };

  /**
   * 주소 자리에 들어갈 값을 검사한다.
   * href/src 는 텍스트가 아니라 **동작**이라 이스케이프로 막을 수 없다 —
   * `javascript:` 하나면 클릭 한 번에 실행된다. 그래서 스킴을 화이트리스트로 본다.
   */
  function safeUrl(value) {
    const v = String(value == null ? '' : value).trim();
    if (!v) return null;

    /* 스킴을 보기 전에 **제어문자와 공백을 전부 걷어낸다.**
       브라우저는 URL 을 읽을 때 이것들을 무시하므로, 걷어내지 않고 검사하면
       `java\tscript:` 가 스킴 없는 상대 경로처럼 보인다. 그대로 href 에 넣으면
       브라우저가 탭을 지우고 javascript: 로 실행한다. 실제로 뚫렸던 자리다. */
    const bare = v.replace(/[\u0000-\u0020\u007f-\u00a0\u00ad\u200b-\u200f\u2028\u2029\u202f\u2060\ufeff]/g, '');
    if (!bare) return null;

    // 상대 경로와 앵커는 통과. 절대 주소는 http/https 만.
    if (/^[a-z][a-z0-9+.-]*:/i.test(bare)) {
      return /^https?:/i.test(bare) ? v : null;
    }
    /* 스킴이 없어 보여도 `//evil.com` 은 프로토콜 상대 주소라 바깥으로 나간다.
       이 서비스는 외부로 링크하지 않으므로 막는다. */
    if (bare.slice(0, 2) === '//') return null;
    return v;
  }

  function appendChild(el, child) {
    if (child === null || child === undefined || child === false) return;

    if (Array.isArray(child)) {
      child.forEach(function (c) { appendChild(el, c); });
      return;
    }
    if (child.nodeType) {           // 이미 노드면 그대로
      el.appendChild(child);
      return;
    }
    // 그 밖의 것은 전부 글자다. 태그처럼 생겼어도 글자로 들어간다.
    el.appendChild(document.createTextNode(String(child)));
  }

  function applyAttrs(el, attrs) {
    if (!attrs) return;

    Object.keys(attrs).forEach(function (key) {
      const value = attrs[key];
      if (value === null || value === undefined || value === false) return;

      if (key === 'class') { el.setAttribute('class', String(value)); return; }

      /* on* 은 받지 않는다. 이벤트는 addEventListener 로만 단다 —
         속성으로 열어두면 문자열이 코드가 되는 통로가 다시 생긴다. */
      if (/^on/i.test(key)) {
        throw new Error('이벤트는 addEventListener 로 답니다: ' + key);
      }

      if (key === 'href' || key === 'src') {
        const url = safeUrl(value);
        if (url === null) return;   // 위험한 스킴은 조용히 버린다
        el.setAttribute(key, url);
        return;
      }

      if (PROPS[key]) {
        if (value === true) el.setAttribute(key, '');
        else el[key] = value;
        return;
      }

      el.setAttribute(key, String(value));
    });
  }

  /** HTML 요소 하나 */
  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    applyAttrs(el, attrs);
    appendChild(el, children);
    return el;
  }

  /** SVG 요소 하나. HTML 과 네임스페이스가 달라 createElement 로는 안 그려진다. */
  function svg(tag, attrs, children) {
    const el = document.createElementNS(SVG_NS, tag);
    applyAttrs(el, attrs);
    appendChild(el, children);
    return el;
  }

  /** 여러 노드를 한 덩어리로 */
  function frag(children) {
    const f = document.createDocumentFragment();
    appendChild(f, children);
    return f;
  }

  /** 안을 비우고 새 내용으로 갈아끼운다 */
  function replace(el, children) {
    if (!el) return el;
    el.replaceChildren();
    appendChild(el, children);
    return el;
  }

  root.CRDom = {
    h: h,
    svg: svg,
    frag: frag,
    replace: replace,
    safeUrl: safeUrl
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
