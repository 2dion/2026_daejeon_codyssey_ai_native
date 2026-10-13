/* ==========================================================================
   scenarios.test.js — 시작 상태와 힌트가 실제로 맞는지

   이 파일이 지키는 약속은 하나다.
   **화면에 적어둔 힌트 순서를 그대로 치면 목표가 실제로 달성된다.**

   틀린 힌트는 틀린 설명보다 나쁘다. 사용자는 그대로 따라 치고, 안 되면
   자기가 잘못 쳤다고 생각한다. 그래서 사람이 아니라 테스트가 확인한다.
   ========================================================================== */

const test = require('node:test');
const assert = require('node:assert');

const fs = require('node:fs');
const path = require('node:path');

const git = require('../js/sim/engine.js');
const scenarios = require('../js/sim/scenarios.js');

/* graph-templates.js 는 브라우저 전용 파일(window 에 붙인다)이라 require 로는 못 읽는다.
   가짜 window 를 하나 주고 실행해서 진짜 id 목록을 꺼낸다.
   목록을 여기에 베껴 적으면 저쪽에서 이름을 바꿔도 테스트가 모른다. */
function graphTemplateIds() {
  const src = fs.readFileSync(path.join(__dirname, '../js/graph-templates.js'), 'utf8');
  const win = {};
  new Function('window', src)(win);
  return win.GRAPH_TEMPLATE_IDS;
}
const templates = { IDS: graphTemplateIds() };

test('모든 시나리오가 실제 명령만으로 조립된다', function () {
  scenarios.LIST.forEach(function (s) {
    const state = s.build();
    assert.ok(state && typeof state === 'object', s.id + ' 가 상태를 돌려주지 않았다');
    assert.ok(s.제목 && s.상황 && s.목표, s.id + ' 에 설명이 빠졌다');
    assert.ok(s.힌트.length, s.id + ' 에 힌트가 없다');
    s.힌트.forEach(function (h) {
      assert.ok(typeof h === 'string' || (h.안내 && (h.해결 || h.이동)),
        s.id + ' 의 힌트 모양이 이상하다');
    });
  });
});

test('시나리오 상태는 결정론적이다 — 다시 열어도 같은 커밋 id 가 나온다', function () {
  scenarios.LIST.forEach(function (s) {
    assert.strictEqual(JSON.stringify(s.build()), JSON.stringify(s.build()), s.id);
  });
});

test('힌트 순서를 그대로 치면 목표가 달성된다', function () {
  scenarios.LIST.forEach(function (s) {
    let state = s.build();
    s.힌트.forEach(function (step) {
      if (typeof step !== 'string') {
        // 명령이 아닌 단계 — 편집기로 고르거나(해결), 폴더를 옮기거나(이동)
        if (step.이동) { state = git.useWorktree(state, step.이동); return; }
        const w = git.worktree(state);
        state = git.editFile(state, step.해결.path,
          git.chooseSide(w.files[step.해결.path], step.해결.side));
        return;
      }
      const r = git.run(state, step);
      state = r.state;   // 일부러 거절되는 단계가 있다 (push 거절, init 전 status)
    });
    assert.ok(s.검증(state), s.id + ' — 힌트를 다 쳤는데 목표에 도달하지 못했다');
  });
});

test('안내한 명령은 모두 실습실이 아는 명령이다', function () {
  const parser = require('../js/sim/parser.js');
  scenarios.LIST.forEach(function (s) {
    s.힌트.forEach(function (line) {
      if (typeof line !== 'string') return;   // 편집 단계는 명령이 아니다
      const p = parser.parse(line);
      assert.ok(p.ok, s.id + ' — 파서가 모르는 힌트: ' + line + ' (' + p.message + ')');
    });
  });
});

/* ====================================================================== */
/*  AI 결과 → 재현 대응표                                                   */
/* ====================================================================== */

test('대응표의 시나리오 id 는 전부 실재한다', function () {
  const ids = scenarios.LIST.map(function (s) { return s.id; });
  Object.keys(scenarios.TEMPLATE_TO_SCENARIO).forEach(function (tpl) {
    const id = scenarios.TEMPLATE_TO_SCENARIO[tpl];
    assert.ok(ids.indexOf(id) !== -1, tpl + ' 이 없는 시나리오 ' + id + ' 를 가리킨다');
  });
});

test('대응표의 템플릿 id 는 전부 검증된 그래프 템플릿이다', function () {
  Object.keys(scenarios.TEMPLATE_TO_SCENARIO).forEach(function (tpl) {
    assert.ok(templates.IDS.indexOf(tpl) !== -1,
      tpl + ' 은 js/graph-templates.js 에 없는 템플릿이다');
  });
});

test('모르는 템플릿에는 재현 버튼을 붙이지 않는다', function () {
  // 억지로 아무 상태나 만들어 보여주지 않는 것이 이 서비스의 원칙이다
  assert.strictEqual(scenarios.scenarioFor('none'), null);
  assert.strictEqual(scenarios.scenarioFor('remove-secret'), null);
  assert.strictEqual(scenarios.scenarioFor('constructor'), null);
  assert.strictEqual(scenarios.scenarioFor('__proto__'), null);
});

/* ====================================================================== */
/*  자동 완성 목록                                                          */
/* ====================================================================== */

/* complete.js 도 브라우저 전용이다(CRDom 을 쓴다). 가짜 window 를 주고 실행한다.
   여기서 꺼내는 것은 CATALOG(순수 데이터)뿐이라 DOM 함수는 호출되지 않는다. */
function completeCatalog() {
  const src = fs.readFileSync(path.join(__dirname, '../js/sim/complete.js'), 'utf8');
  const win = { CRDom: { h: function () {}, replace: function () {} } };
  new Function('window', 'globalThis', 'return (function(){' + src + '; return window.CRComplete;})()')(win, win);
  return win.CRComplete.CATALOG;
}

test('제안하는 명령은 전부 실습실이 실행할 수 있는 명령이다', function () {
  const parser = require('../js/sim/parser.js');
  completeCatalog().forEach(function (e) {
    /* <자리표시자> 는 사용자가 채울 자리다. 실제 값처럼 바꿔서 검사한다 —
       자리표시자 그대로는 파서가 꺾쇠를 셸 문자로 볼 수 있다. */
    const line = e.cmd.replace(/<[^<>]+>/g, '값');
    const p = parser.parse(line);
    assert.ok(p.ok, '제안하는데 파서가 모른다: ' + e.cmd + ' (' + p.message + ')');
  });
});

test('제안 항목에는 어느 칸이 바뀌는지가 함께 적혀 있다', function () {
  // 고르는 동안에도 그것을 읽게 하는 것이 이 목록의 절반이다
  completeCatalog().forEach(function (e) {
    assert.ok(e.설명 && e.칸, e.cmd + ' 에 설명이나 칸 표시가 빠졌다');
  });
});

test('되돌릴 수 없는 명령에는 위험 표시가 붙어 있다', function () {
  const byCmd = {};
  completeCatalog().forEach(function (e) { byCmd[e.cmd] = e; });
  ['git reset --hard HEAD~1', 'git restore <파일>'].forEach(function (c) {
    assert.ok(byCmd[c] && byCmd[c].위험, c + ' 에 위험 표시가 없다');
  });
  assert.ok(!byCmd['git reset --soft HEAD~1'].위험, 'soft 는 위험이 아니다');
});

test('URL 로 넘어온 시나리오 id 는 목록에 있을 때만 받는다', function () {
  assert.strictEqual(scenarios.resolve('non-fast-forward').id, 'non-fast-forward');
  assert.strictEqual(scenarios.resolve('없는거').id, scenarios.DEFAULT_ID);
  assert.strictEqual(scenarios.resolve('__proto__').id, scenarios.DEFAULT_ID);
  assert.strictEqual(scenarios.resolve(undefined).id, scenarios.DEFAULT_ID);
});
