/* ==========================================================================
   lab.js — 실습실 화면 배선

   상태를 들고 있는 유일한 곳이다. 엔진은 순수하고 렌더러는 문자열만 만든다.
   여기서만 setState 를 부른다.

   되감기는 상태 스냅샷 스택이다. 엔진이 매번 새 상태를 돌려주므로
   이전 것을 그대로 밀어 넣으면 된다 (되돌리는 로직을 따로 만들 필요가 없다).
   ========================================================================== */

(function () {
  'use strict';

  const git = window.CRGit;
  const scenarios = window.CRScenarios;
  const render = window.CRRender;
  const toast = window.CRUtil.toast;
  const replace = window.CRDom.replace;
  const wt = git.worktree;

  const el = {
    brief: document.getElementById('labBrief'),
    threeMains: document.getElementById('threeMains'),
    conflict: document.getElementById('conflictPanel'),
    wtabs: document.getElementById('worktreeTabs'),
    work: document.getElementById('workPanel'),
    stage: document.getElementById('stagePanel'),
    stash: document.getElementById('stashPanel'),
    localGraph: document.getElementById('localGraph'),
    github: document.getElementById('githubPanel'),
    log: document.getElementById('terminalLog'),
    form: document.getElementById('cmdForm'),
    input: document.getElementById('cmdInput'),
    suggest: document.getElementById('cmdSuggest'),
    undo: document.getElementById('undoBtn'),
    restart: document.getElementById('restartBtn'),
    collab: document.getElementById('collabBtn'),
    select: document.getElementById('scenarioSelect'),
    askAi: document.getElementById('askAiLink')
  };
  if (!el.form) return;   // 실습실 페이지가 아니면 아무것도 하지 않는다

  let scenario = null;
  let state = null;
  let past = [];
  let solved = false;
  let newFileSeq = 0;
  let editSeq = 0;

  /* ---------------------------------------------------------------- 시각 */

  /* origin/main 배지에 붙는 "마지막 확인" 문구. 엔진은 시각을 모른다 —
     결정론적이어야 테스트가 되기 때문이다. 그래서 화면이 넣어준다. */
  function nowLabel() {
    const d = new Date();
    return d.getHours() + '시 ' + String(d.getMinutes()).padStart(2, '0') + '분';
  }

  /* ---------------------------------------------------------------- 그리기 */

  /** 내용이 없으면 상자째 감춘다 — 빈 테두리만 남기지 않으려고 */
  function fill(target, node) {
    replace(target, node);
    target.hidden = !node;
  }

  function paint() {
    fill(el.wtabs, render.worktreeTabs(state));
    fill(el.conflict, render.conflictPanel(state));
    fill(el.stash, render.stashPanel(state));

    replace(el.threeMains, render.threeMains(state));
    replace(el.work, render.workPanel(state));
    replace(el.stage, render.stagePanel(state));
    replace(el.localGraph, render.localGraph(state));
    replace(el.github, render.githubPanel(state));
    replace(el.brief, render.brief(scenario, solved));
    el.undo.disabled = past.length === 0;
  }

  function append(node) {
    if (node) el.log.appendChild(node);
    el.log.scrollTop = el.log.scrollHeight;
  }

  function checkSolved() {
    if (solved || typeof scenario.검증 !== 'function') return;
    let done = false;
    try { done = !!scenario.검증(state); } catch (e) { done = false; }
    if (!done) return;
    solved = true;
    toast('목표를 달성했습니다');
  }

  /* --------------------------------------------------------------- 상태 변경 */

  /** 되감기를 위해 이전 상태를 밀어 넣고 새 상태로 바꾼다 */
  function commit(nextState) {
    past.push(state);
    state = nextState;
    checkSolved();
    paint();
  }

  function loadScenario(id, options) {
    options = options || {};
    scenario = scenarios.resolve(id);
    state = scenario.build();
    past = [];
    solved = false;
    newFileSeq = 0;
    editSeq = 0;
    replace(el.log, null);
    el.select.value = scenario.id;

    /* 링크를 그대로 공유할 수 있게 주소도 맞춘다. 방문 기록은 늘리지 않는다. */
    if (!options.keepUrl && window.history && window.history.replaceState) {
      window.history.replaceState(null, '', 'lab.html?scenario=' + encodeURIComponent(scenario.id));
    }
    if (el.askAi) el.askAi.href = 'index.html#rescue';

    append(render.noteLine('**' + scenario.제목 + '** 상황으로 시작합니다. ' +
      '여기서 무엇을 하든 실제 저장소는 바뀌지 않습니다.'));
    paint();
  }

  /* ---------------------------------------------------------------- 명령 실행 */

  function execute(line) {
    const input = String(line || '').trim();
    if (!input) return;

    /* 엔진은 시각을 모르므로, fetch·push 가 적을 "마지막 확인" 문구만 넣어준다 */
    const withNow = git.clone(state);
    withNow.now = nowLabel();

    const r = git.run(withNow, input);
    append(render.terminalLine(input, r));

    if (r.ok) {
      const next = r.state;
      delete next.now;
      commit(next);
    } else {
      /* 실패해도 화면은 다시 그린다 — 되감기 버튼 상태와 스크롤이 어긋나지 않게 */
      paint();
    }
    el.input.value = '';
    /* 방금 친 글자로 걸러둔 목록이 남아 있으면 입력창은 비었는데 제안은 옛것이 된다 */
    complete.hide();
    el.input.focus();
  }

  el.form.addEventListener('submit', function (e) {
    e.preventDefault();
    execute(el.input.value);
  });

  /* ---------------------------------------------------------------- 되감기 */

  el.undo.addEventListener('click', function () {
    if (!past.length) return;
    state = past.pop();
    solved = false;
    append(render.noteLine('한 단계 되감았습니다. 터미널 기록은 무엇을 했는지 알 수 있게 그대로 둡니다.'));
    paint();
  });

  el.restart.addEventListener('click', function () {
    loadScenario(scenario.id);
  });

  /* ------------------------------------------------------------- 가상 동료 */

  el.collab.addEventListener('click', function () {
    if (!Object.keys(state.github.branches).length) {
      toast('아직 GitHub에 올라간 것이 없어 동료도 받아갈 수 없습니다');
      return;
    }
    const next = git.collaboratorPush(state, {
      message: '동료의 작업 ' + (Object.keys(state.github.objects).length),
      path: '동료메모.txt',
      content: '동료가 쓴 내용 ' + Object.keys(state.github.objects).length
    });
    append(render.noteLine(
      '동료가 GitHub의 `main`에 커밋을 하나 올렸습니다. ' +
      '**내 컴퓨터의 `origin/main` 메모는 움직이지 않았습니다.** ' +
      '`git log`에도 아직 보이지 않습니다 — 그 커밋은 아직 내 기록함에 없기 때문입니다. ' +
      '`git fetch`를 해보세요.'));
    commit(next);
  });

  /* --------------------------------------------------- 작업 폴더 조작 (위임) */

  el.work.addEventListener('click', function (e) {
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      const path = edit.getAttribute('data-edit');
      editSeq += 1;
      const next = git.editFile(state, path, (wt(state).files[path] || '') + '\n고친 줄 ' + editSeq);
      append(render.noteLine('`' + path + '`을 고쳤습니다. ' +
        '**작업 폴더만 바뀝니다** — 스테이징에도, 커밋에도 아직 반영되지 않았습니다.'));
      commit(next);
      return;
    }
    if (e.target.id === 'newFileBtn') {
      newFileSeq += 1;
      const name = '새파일' + newFileSeq + '.txt';
      append(render.noteLine('`' + name + '`을 만들었습니다. ' +
        'Git은 아직 이 파일을 지켜보지 않습니다(untracked).'));
      commit(git.editFile(state, name, '새 파일 내용'));
    }
  });

  /* -------------------------------------------------------- 작업 공간 이동 */

  /* 폴더를 오가는 것은 git 명령이 아니라 `cd` 다. 그래서 터미널이 아니라 탭으로 둔다 —
     "worktree 를 만들면 git 명령으로 오가는 것"이라는 오해를 만들지 않기 위해서다. */
  el.wtabs.addEventListener('click', function (e) {
    const tab = e.target.closest('[data-worktree]');
    if (!tab) return;
    const name = tab.getAttribute('data-worktree');
    if (name === state.현재작업공간) return;

    append(render.noteLine(
      '`' + name + '` 폴더로 옮겨왔습니다(터미널에서는 `cd`). ' +
      '**작업 폴더와 스테이징이 저쪽 것으로 바뀌었지만, 커밋 기록과 작업본 목록은 그대로입니다** — ' +
      '기록함은 하나이기 때문입니다.'));
    commit(git.useWorktree(state, name));
  });

  /* ---------------------------------------------------------- 충돌 해결 */

  /* 마커를 걷어내는 것은 git 명령이 아니라 **사람이 편집기로 하는 일**이다.
     그래서 명령으로 만들지 않고 파일 편집으로 처리한다 — 그다음 `git add`가 따로 필요한
     이유가 여기서 자연스럽게 드러난다. */
  const SIDE_LABEL = { ours: '내 것', theirs: '저쪽 것', both: '양쪽 다' };

  el.conflict.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-resolve]');
    if (!btn) return;

    const path = btn.getAttribute('data-path');
    const side = btn.getAttribute('data-resolve');
    const next = git.editFile(state, path, git.chooseSide(wt(state).files[path], side));

    append(render.noteLine(
      '`' + path + '`에서 **' + SIDE_LABEL[side] + '**만 남기고 충돌 표시를 지웠습니다. ' +
      '여기까지는 그냥 파일을 고친 것입니다 — Git은 아직 모릅니다. ' +
      '`git add ' + path + '`로 "내가 정했다"고 알려주세요.'));
    commit(next);
  });

  /* ------------------------------------------------------------- 자동 완성 */

  /* 지금 저장소에 실제로 있는 이름을 목록에 채워 넣는다.
     `git add <파일>` 대신 `git add 설정.txt` 가 바로 나오면 한 번에 끝난다. */
  const complete = window.CRComplete.attach(el.input, el.suggest, function () {
    return {
      files: Object.keys(wt(state).files).sort(),
      branches: Object.keys(state.localBranches).sort()
    };
  });

  /* 안내에 적힌 힌트도 같은 통로로 넣는다 — 자리표시자 선택까지 똑같이 동작한다 */
  document.addEventListener('click', function (e) {
    const fillBtn = e.target.closest('[data-fill]');
    if (fillBtn) complete.fill(fillBtn.getAttribute('data-fill'));
  });

  /* ------------------------------------------------------------ 시나리오 선택 */

  scenarios.LIST.forEach(function (s) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.제목;
    el.select.appendChild(opt);
  });

  el.select.addEventListener('change', function () {
    loadScenario(el.select.value);
  });

  /* ------------------------------------------------------------------ 시작 */

  const requested = new URLSearchParams(window.location.search).get('scenario');
  loadScenario(requested, { keepUrl: !requested });
})();
