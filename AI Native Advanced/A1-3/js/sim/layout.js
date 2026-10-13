/* ==========================================================================
   layout.js — 엔진 상태를 그래프 좌표로 편다

   js/graph.js 의 buildStageSvg 가 먹는 { commits, refs } 를 만든다.
   그리는 일은 하지 않는다. 렌더러를 두 벌로 만들면 좌표 규칙과 라벨 처리가
   반드시 어긋나므로, 그림은 기존 것을 그대로 쓴다.

   좌표 규칙 (graph.js 와 같은 약속)
     col : 뿌리에서의 깊이. 형제 커밋은 같은 칸에 선다
     row : 0 = 지금 작업본의 줄, 1 = 그 줄에 없는 커밋 (동료 커밋 등)
   ========================================================================== */

(function (root, factory) {
  const api = factory(root.CRGit);
  root.CRLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (git) {
  'use strict';

  const wt = git.worktree;

  /** 커밋 하나에서 첫 부모만 따라 올라간 줄. 여기 있는 것이 "내 줄"이다. */
  function firstParentChain(store, tip) {
    const set = Object.create(null);
    let cur = tip;
    while (cur && store[cur] && !set[cur]) {
      set[cur] = true;
      cur = (store[cur].parents || [])[0] || null;
    }
    return set;
  }

  /**
   * @param {Object} store   오브젝트 저장소 (state.objects 또는 state.github.objects)
   * @param {string[]} tips  그려야 할 끝점들
   * @param {string} primary 주 줄로 삼을 끝점
   * @param {Array} refs     [{ name, on, dashed }]
   * @param {Object} options { title, aria, highlight: [커밋id] }
   */
  function build(store, tips, primary, refs, options) {
    options = options || {};

    const included = Object.create(null);
    tips.filter(Boolean).forEach(function (t) {
      Object.keys(git.ancestorSet(store, t)).forEach(function (id) { included[id] = true; });
    });

    const list = Object.keys(included)
      .map(function (id) { return store[id]; })
      .filter(Boolean)
      .sort(function (a, b) { return a.n - b.n; });

    if (!list.length) return null;

    /* col 은 뿌리에서의 깊이다. n 오름차순이면 부모가 항상 먼저 나오므로 한 번에 계산된다. */
    const depth = Object.create(null);
    list.forEach(function (c) {
      let d = 0;
      (c.parents || []).forEach(function (p) {
        if (included[p] && depth[p] + 1 > d) d = depth[p] + 1;
      });
      depth[c.id] = d;
    });

    const mainLine = firstParentChain(store, primary);
    const highlight = options.highlight || [];

    const commits = list.map(function (c) {
      const parents = (c.parents || []).filter(function (p) { return included[p]; });
      return {
        id: c.id,
        parents: parents,
        col: depth[c.id],
        row: mainLine[c.id] ? 0 : 1,
        note: c.message,
        hi: highlight.indexOf(c.id) !== -1
      };
    });

    return {
      title: options.title || '',
      aria: options.aria || options.title || '커밋 그래프',
      commits: commits,
      refs: (refs || []).filter(function (r) { return r.on && included[r.on]; })
    };
  }

  /** 내 컴퓨터의 기록함 — 로컬 작업본과 원격 추적 이름표를 함께 그린다 */
  function localStage(state) {
    const tips = [];
    const refs = [];

    Object.keys(state.localBranches).forEach(function (b) {
      const tip = state.localBranches[b];
      if (!tip) return;
      tips.push(tip);
      refs.push({
        name: (wt(state).HEAD.type === 'branch' && wt(state).HEAD.name === b) ? 'HEAD -> ' + b : b,
        on: tip
      });
    });

    Object.keys(state.remoteTracking).forEach(function (r) {
      const tip = state.remoteTracking[r].tip;
      if (!tip) return;
      tips.push(tip);
      /* 점선 = "내 컴퓨터에 적어둔 메모". 색 말고도 구분되게 하는 기존 규칙이다. */
      refs.push({ name: r, on: tip, dashed: true });
    });

    /* 그림을 못 보는 사람에게 필요한 것은 "그래프가 있습니다"가 아니라
       어느 이름표가 어느 커밋에 있느냐다. 그것을 대체 텍스트에 그대로 적는다. */
    const where = refs.map(function (r) {
      return r.name + '은(는) ' + r.on + (r.dashed ? ' (마지막 fetch 때 적어둔 메모)' : '');
    }).join(', ');

    return build(state.objects, tips, git.headCommitId(state), refs, {
      title: '내 컴퓨터의 기록함',
      aria: '내 컴퓨터에 저장된 커밋 그래프. ' + (where || '이름표 없음') + '.'
    });
  }

  /** GitHub 쪽 — 저장소가 아예 다르므로 그래프도 따로 그린다 */
  function githubStage(state) {
    const tips = [];
    const refs = [];
    Object.keys(state.github.branches).forEach(function (b) {
      const tip = state.github.branches[b];
      if (!tip) return;
      tips.push(tip);
      refs.push({ name: b, on: tip });
    });

    const where = refs.map(function (r) { return r.name + '은(는) ' + r.on; }).join(', ');

    return build(state.github.objects, tips, state.github.branches.main || tips[0], refs, {
      title: 'GitHub의 기록',
      aria: 'GitHub 서버에 실제로 있는 커밋 그래프. ' + (where || '이름표 없음') + '.'
    });
  }

  return {
    build: build,
    localStage: localStage,
    githubStage: githubStage
  };
});
