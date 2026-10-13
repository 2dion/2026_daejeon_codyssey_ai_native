/* ==========================================================================
   graph.js — V2 커밋 그래프 렌더러 (기획서 4.2절)

   그리는 요소는 네 가지뿐이다: 커밋 원 / 부모 연결선 / 브랜치·HEAD 라벨 / 강조 색상.
   좌표 규칙
     반지름  r   = 13
     원 간격 gap = 110
     시작 x  x0  = 40
     중심 y  y   = 60  (두 번째 브랜치는 y = 130)
     i번째 원의 x = x0 + col * gap
     라벨 알약   원 중심 위 y - 34, 폭 = 글자수 * 8 + 20
   ========================================================================== */

(function () {
  'use strict';

  const h = window.CRDom.h;
  const svgEl = window.CRDom.svg;

  /* ------------------------------- 공용 유틸 ------------------------------- */
  const util = {
    /* 이제 화면은 노드로 만든다(js/dom.js). 이 함수는 남은 소비자가 없어질 때까지만 둔다. */
    escapeHtml: function (value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },
    toast: function (message) {
      const el = document.getElementById('toast');
      if (!el) return;
      el.textContent = message;
      el.hidden = false;
      clearTimeout(el._timer);
      el._timer = setTimeout(function () { el.hidden = true; }, 2000);
    },
    /* 위험도 배지 — presets.js 와 rescue.js 가 각자 같은 표를 들고 있었다.
       한쪽만 고치면 조용히 어긋나므로 여기 한 곳에만 둔다.
       색 외에 아이콘과 텍스트로도 구분한다 (기획서 8.2절). */
    RISK_CLASS: { '안전': 'safe', '주의': 'warn', '위험': 'danger' },
    RISK_ICON: { '안전': '✓', '주의': '!', '위험': '⚠' },
    /** @returns {HTMLElement} 노드를 돌려준다 — 문자열이 아니다 */
    riskBadge: function (level, options) {
      const opts = options || {};
      /* 표에 없는 값이 오면 프로토타입 체인까지 올라간다.
         RISK_CLASS['constructor'] 는 undefined 가 아니라 Object 생성자를 준다.
         지금은 서버가 위험도를 세 값으로 정규화해서 닿지 않지만,
         가져온 값을 그대로 쓰는 자리는 조건이 하나만 바뀌어도 어긋난다. */
      const own = Object.prototype.hasOwnProperty;
      const cls = own.call(util.RISK_CLASS, level) ? util.RISK_CLASS[level] : 'warn';
      const icon = own.call(util.RISK_ICON, level) ? util.RISK_ICON[level] : '!';

      return h('span', { class: 'risk risk--' + cls }, [
        h('span', { 'aria-hidden': 'true' }, icon),
        ' ' + (opts.prefix ? '위험도 ' : '') + String(level == null ? '' : level)
      ]);
    },
    copyText: function (text) {
      if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
      }
      // 구형 브라우저 / http 환경 대비
      return new Promise(function (resolve, reject) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy') ? resolve() : reject(new Error('copy failed'));
        } catch (e) {
          reject(e);
        } finally {
          document.body.removeChild(ta);
        }
      });
    }
  };
  window.CRUtil = util;

  /* ------------------------------- 렌더링 ------------------------------- */
  const R = 13, GAP = 110, X0 = 40, Y0 = 60, ROW_GAP = 70;

  function cx(commit) { return X0 + commit.col * GAP; }
  function cy(commit) { return Y0 + (commit.row || 0) * ROW_GAP; }

  /**
   * 한 단계(before 또는 after)를 SVG 노드로 만든다.
   * @param {Object} stage { title, commits, refs }
   * @returns {SVGElement|null} 그릴 커밋이 없으면 null
   */
  function buildStageSvg(stage) {
    const commits = stage.commits || [];
    if (!commits.length) return null;

    const byId = {};
    commits.forEach(function (c) { byId[c.id] = c; });

    const refsByCommit = {};
    (stage.refs || []).forEach(function (ref) {
      (refsByCommit[ref.on] = refsByCommit[ref.on] || []).push(ref);
    });

    const parts = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    function track(x, y) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    /* 1) 부모 연결선 — 원 뒤에 깔리도록 먼저 그린다 */
    commits.forEach(function (c) {
      const parents = c.parents || (c.parent ? [c.parent] : []);
      parents.forEach(function (pid) {
        const p = byId[pid];
        if (!p) return;
        const px = cx(p), py = cy(p), qx = cx(c), qy = cy(c);
        let d;
        if (py === qy) {
          d = 'M' + (px + R) + ',' + py + ' L' + (qx - R) + ',' + qy;
        } else {
          // 브랜치가 갈리거나 합쳐지는 구간은 곡선 하나로 잇는다
          d = 'M' + (px + R) + ',' + py + ' Q' + (qx - 40) + ',' + py + ' ' + (qx - R) + ',' + qy;
        }
        parts.push(svgEl('path', { class: 'cg-link', d: d }));
        track(px, py); track(qx, qy);
      });
    });

    /* 2) 커밋 원 + 해시 + 메모 + 라벨 알약 */
    commits.forEach(function (c) {
      const x = cx(c), y = cy(c), isRow1 = (c.row || 0) === 1;
      track(x - R, y - R); track(x + R, y + R);

      parts.push(svgEl('circle', {
        class: 'cg-node' + (c.hi ? ' is-hi' : ''), cx: x, cy: y, r: R
      }));
      parts.push(svgEl('text', {
        class: 'cg-id', x: x, y: y + 4, 'text-anchor': 'middle',
        fill: c.hi ? '#fff' : null
      }, c.id.slice(0, 3)));

      const refs = refsByCommit[c.id] || [];
      refs.forEach(function (ref, i) {
        // row 0 은 위로, row 1 은 아래로 쌓는다 (두 줄이 서로 겹치지 않게)
        const centerY = isRow1 ? (y + 34 + i * 24) : (y - 34 - i * 24);
        const w = ref.name.length * 8 + 20;
        const boxX = x - w / 2, boxY = centerY - 10;

        parts.push(svgEl('rect', {
          class: 'cg-ref-box' + (ref.dashed ? ' is-dashed' : ''),
          x: boxX, y: boxY, width: w, height: 20, rx: 10
        }));
        parts.push(svgEl('text', {
          class: 'cg-ref-text', x: x, y: centerY + 4, 'text-anchor': 'middle'
        }, ref.name));
        track(boxX, boxY); track(boxX + w, boxY + 20);
      });

      if (c.note) {
        const noteY = isRow1
          ? y + 34 + (refs.length ? refs.length * 24 + 4 : 0)
          : y + 34;
        parts.push(svgEl('text', {
          class: 'cg-note', x: x, y: noteY, 'text-anchor': 'middle'
        }, c.note));
        const noteHalf = Math.max(40, c.note.length * 6);
        track(x - noteHalf, noteY - 11); track(x + noteHalf, noteY + 4);
      }
    });

    const pad = 8;
    const vbX = Math.floor(minX - pad);
    const vbY = Math.floor(minY - pad);
    const vbW = Math.ceil(maxX - minX + pad * 2);
    const vbH = Math.ceil(maxY - minY + pad * 2);

    /* 대체 텍스트는 stage 가 정한다.
       검증된 템플릿은 "개념 예시"지만, 실습실 그래프는 그 실습실 안의 실제 상태다.
       여기에 "개념 예시"를 박아두면 실습실에서 사실과 다른 말을 하게 된다. */
    const aria = stage.aria || ((stage.title || '커밋 그래프') + ' 개념 예시');

    return svgEl('svg', {
      class: 'commit-graph',
      viewBox: vbX + ' ' + vbY + ' ' + vbW + ' ' + vbH,
      width: vbW, height: vbH,
      role: 'img', 'aria-label': aria
    }, parts);
  }

  /**
   * 템플릿 ID로 그래프 블록 전체(안내 문구 + before/after)를 만든다.
   * @param {string} templateId
   * @returns {HTMLElement|null} 템플릿이 없거나 'none'이면 null
   */
  function renderGraphTemplate(templateId) {
    const tpl = window.GRAPH_TEMPLATES[templateId];
    if (!templateId || templateId === 'none' || !tpl) return null;

    const stages = [tpl.before, tpl.after].filter(Boolean);

    return h('div', { class: 'graph-box' }, [
      h('p', { class: 'graph-notice' }, [
        h('span', { 'aria-hidden': 'true' }, 'ℹ️'),
        h('span', null, [
          '이 그림은 ', h('strong', null, '개념 예시'),
          '입니다. 현재 저장소의 실제 그래프가 아닙니다.'
        ])
      ]),
      stages.map(function (stage) {
        return h('div', { class: 'graph-stage' }, [
          h('p', { class: 'graph-stage__label' }, stage.title || ''),
          h('div', { class: 'graph-scroll' }, buildStageSvg(stage))
        ]);
      }),
      tpl.caption ? h('p', { class: 'graph-caption' }, tpl.caption) : null
    ]);
  }

  window.renderGraphTemplate = renderGraphTemplate;

  /* 실습실(js/sim/)이 같은 렌더러로 살아 있는 상태를 그린다.
     좌표 규칙·라벨 알약·점선 처리·이스케이프를 두 벌로 만들면 반드시 어긋난다. */
  window.CRGraph = {
    buildStageSvg: buildStageSvg,
    renderGraphTemplate: renderGraphTemplate
  };
})();
