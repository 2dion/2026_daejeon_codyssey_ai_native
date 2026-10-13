/* ==========================================================================
   engine.js — 실습실 Git 상태 엔진

   DOM 을 모른다. 화면도 모른다. 입력은 (상태, 명령 문자열), 출력은 새 상태와
   터미널 출력이다. 그래서 node 에서 그대로 테스트할 수 있다.

   ── 이 파일의 핵심 결정 ──────────────────────────────────────────────────
   오브젝트 저장소를 둘로 나눈다.

     state.objects          내 컴퓨터의 .git
     state.github.objects   GitHub 서버

   그리고 origin/main 은 **state.objects 만** 가리킨다. github 를 가리키지 않는다.

   이렇게 두면 "동료가 push 해도 내 origin/main 은 안 움직인다"가 연출이 아니라
   구조적으로 그럴 수밖에 없는 일이 된다. git log 가 GitHub 의 새 커밋을 못 보는 것도
   자동으로 참이 된다. 이 서비스가 4칸이 아니라 5칸으로 그리는 이유가 여기에 있다.

   ── 영역 키 ──────────────────────────────────────────────────────────────
   js/areas.js 의 AREA_META 키와 1:1 로 맞춘다. 어긋나면 화면의 칸 표시가 조용히 빈다.
     work / staging / local / origin-tracking / remote
   ========================================================================== */

(function (root, factory) {
  /* 파서는 브라우저에서는 먼저 로드된 전역, node 에서는 require 로 받는다.
     한 곳에서 정하고 아래로 넘긴다 — 함수 안에서 require 를 부르면
     번들러가 정적으로 못 읽고, 호출마다 조건 분기가 반복된다. */
  const parser = (typeof module !== 'undefined' && module.exports)
    ? require('./parser.js')
    : root.CRParse;

  const api = factory(parser);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CRGit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (parser) {
  'use strict';

  const AREAS = ['work', 'staging', 'local', 'origin-tracking', 'remote'];

  /** 바뀐 칸을 주면 나머지를 유지 칸으로 돌려준다. 둘을 손으로 적으면 반드시 어긋난다. */
  function rest(changed) {
    return AREAS.filter(function (a) { return changed.indexOf(a) === -1; });
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /* ====================================================================== */
  /*  상태                                                                   */
  /* ====================================================================== */

  const MAIN_WORKTREE = '연습폴더';

  /* 작업 공간 하나. 기록함(objects·branches)은 저장소가 공유하고, 이 세 가지만 각자 갖는다.
     worktree 를 다루려면 이 구분이 상태 모양에 그대로 있어야 한다 —
     "무엇이 공유되고 무엇이 따로인가"가 worktree 수업의 전부이기 때문이다. */
  function emptyWorktree(name) {
    return {
      이름: name,
      files: {},                 // 작업 폴더  { 'memo.txt': '내용' }
      index: {},                 // 스테이징   { 'memo.txt': '내용' } — 다음 커밋이 될 스냅샷 전체
      HEAD: { type: 'branch', name: 'main' },
      진행중: null               // merge/rebase 처럼 여러 명령에 걸친 작업
    };
  }

  function emptyState() {
    const state = {
      initialized: false,

      /* ── 저장소가 공유하는 것 ── */
      objects: {},               // 내 컴퓨터의 커밋들
      localBranches: {},         // { main: '커밋id' }
      remoteTracking: {},        // { 'origin/main': { tip, lastFetchedAt } }
      remotes: {},               // { origin: 'https://…' }
      upstream: {},              // { main: 'origin/main' }
      stash: [],                 // 서랍. 작업 공간이 여러 개여도 서랍은 하나다
      github: { objects: {}, branches: {} },

      /* ── 작업 공간마다 따로인 것 ── */
      worktrees: {},
      현재작업공간: MAIN_WORKTREE,

      seq: 0,
      clock: 0
    };
    state.worktrees[MAIN_WORKTREE] = emptyWorktree(MAIN_WORKTREE);
    state.worktrees[MAIN_WORKTREE].주작업 = true;
    return state;
  }

  /** 지금 보고 있는 작업 공간. 이름을 주면 그 작업 공간. */
  function wt(state, name) {
    return state.worktrees[name || state.현재작업공간];
  }

  /* 커밋 id — 결정론적이다. 같은 시나리오를 열면 항상 같은 id 가 나온다.
     진짜 해시처럼 보이되 진짜 해시가 아니다. graph-templates.js 의 표기(7자리)와 맞춘다. */
  function nextId(state) {
    const HEX = '0123456789abcdef';
    for (let attempt = 0; attempt < 64; attempt++) {
      state.seq += 1;
      let h = (state.seq * 2654435761) >>> 0;
      let s = '';
      for (let i = 0; i < 7; i++) {
        s += HEX[h & 15];
        h = ((h >>> 4) ^ (h << 13)) >>> 0;
      }
      if (!state.objects[s] && !state.github.objects[s]) return s;
    }
    throw new Error('커밋 id를 만들지 못했습니다');
  }

  /* ------------------------------ 조회 도우미 ------------------------------ */

  function headBranch(state) {
    return wt(state).HEAD.type === 'branch' ? wt(state).HEAD.name : null;
  }

  function headCommitId(state) {
    if (wt(state).HEAD.type === 'detached') return wt(state).HEAD.id;
    const name = wt(state).HEAD.name;
    return Object.prototype.hasOwnProperty.call(state.localBranches, name)
      ? state.localBranches[name] : null;
  }

  function commitFiles(store, id) {
    if (!id || !store[id]) return {};
    return clone(store[id].files || {});
  }

  /** id 에서 부모를 따라 올라가며 만나는 모든 커밋 id 집합 */
  function ancestorSet(store, id) {
    const seen = Object.create(null);
    const stack = id ? [id] : [];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || seen[cur] || !store[cur]) continue;
      seen[cur] = true;
      (store[cur].parents || []).forEach(function (p) { stack.push(p); });
    }
    return seen;
  }

  /** 최신 → 과거 순으로 커밋 목록. 여러 부모가 있으면 순서는 커밋 번호 역순으로 안정화한다. */
  function history(store, id) {
    const seen = Object.create(null);
    const out = [];
    const stack = id ? [id] : [];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || seen[cur] || !store[cur]) continue;
      seen[cur] = true;
      out.push(store[cur]);
      (store[cur].parents || []).forEach(function (p) { stack.push(p); });
    }
    return out.sort(function (a, b) { return b.n - a.n; });
  }

  function isAncestor(store, maybeAncestor, id) {
    if (!maybeAncestor) return true;          // 아무것도 없는 상태는 모든 것의 조상이다
    return !!ancestorSet(store, id)[maybeAncestor];
  }

  /** local 이 tracking 보다 몇 개 앞섰고 몇 개 뒤졌는가 */
  function aheadBehind(store, localTip, trackingTip) {
    const a = ancestorSet(store, localTip);
    const b = ancestorSet(store, trackingTip);
    let ahead = 0, behind = 0;
    Object.keys(a).forEach(function (k) { if (!b[k]) ahead++; });
    Object.keys(b).forEach(function (k) { if (!a[k]) behind++; });
    return { ahead: ahead, behind: behind };
  }

  /** from 저장소에서 tip 까지 필요한 커밋을 to 저장소로 복사한다. 경계를 넘는 유일한 통로다. */
  function copyObjects(from, to, tip) {
    const needed = ancestorSet(from, tip);
    let copied = 0;
    Object.keys(needed).forEach(function (id) {
      if (!to[id]) { to[id] = clone(from[id]); copied++; }
    });
    return copied;
  }

  function sameFiles(a, b) {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(function (k) { return b[k] === a[k]; });
  }

  /* ====================================================================== */
  /*  줄 단위 비교 — diff 와 충돌 병합이 같은 뿌리를 쓴다                       */
  /* ====================================================================== */

  /* 파일 내용은 여러 줄 문자열이다. 통째로 비교하면 "한 글자만 달라도 파일 전체가 바뀐 것"이
     되어 diff 출력도 병합도 쓸모가 없어진다. 그래서 줄로 쪼개서 다룬다. */
  function lines(content) {
    return content == null ? [] : String(content).split('\n');
  }
  function joinLines(arr) { return arr.join('\n'); }

  function sameLines(a, b) {
    return a.length === b.length && a.every(function (v, i) { return b[i] === v; });
  }

  /**
   * 최장 공통 부분 수열의 맞물린 자리들. [aIndex, bIndex] 가 증가 순서로 나온다.
   * 실습실 파일은 몇 줄짜리라 O(n·m) 표로 충분하다.
   */
  function lcsMatches(a, b) {
    const n = a.length, m = b.length;
    const dp = [];
    for (let i = 0; i <= n; i++) dp.push(new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { out.push([i, j]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return out;
  }

  /** 줄 단위 변경 목록. { 기호: ' '|'-'|'+', text } */
  function lineDiff(before, after) {
    const a = lines(before), b = lines(after);
    const matches = lcsMatches(a, b);
    const out = [];
    let i = 0, j = 0;

    matches.forEach(function (pair) {
      while (i < pair[0]) out.push({ 기호: '-', text: a[i++] });
      while (j < pair[1]) out.push({ 기호: '+', text: b[j++] });
      out.push({ 기호: ' ', text: a[i] });
      i++; j++;
    });
    while (i < a.length) out.push({ 기호: '-', text: a[i++] });
    while (j < b.length) out.push({ 기호: '+', text: b[j++] });
    return out;
  }

  const CONFLICT_START = '<<<<<<< HEAD';
  const CONFLICT_MID = '=======';
  const CONFLICT_END = '>>>>>>> ';

  /**
   * 세 갈래 줄 병합(diff3). 양쪽이 **같은 줄 자리**를 다르게 고쳤을 때만 충돌이다.
   * 서로 다른 줄을 고쳤으면 둘 다 살린다 — 이게 파일 통째 비교와 결정적으로 다른 점이고,
   * 초보자가 "왜 어떤 건 알아서 합쳐지고 어떤 건 안 되나"를 이해하는 자리다.
   *
   * @returns {{lines:string[], 충돌:boolean}}
   */
  function mergeLines(base, ours, theirs, theirName) {
    const oAt = {}, tAt = {};
    lcsMatches(base, ours).forEach(function (p) { oAt[p[0]] = p[1]; });
    lcsMatches(base, theirs).forEach(function (p) { tAt[p[0]] = p[1]; });

    const out = [];
    let 충돌 = false;
    let bi = 0, oi = 0, ti = 0;

    function chunk(bEnd, oEnd, tEnd) {
      const b = base.slice(bi, bEnd), o = ours.slice(oi, oEnd), t = theirs.slice(ti, tEnd);
      if (sameLines(o, t)) { out.push.apply(out, o); return; }   // 둘이 똑같이 고쳤다
      if (sameLines(o, b)) { out.push.apply(out, t); return; }   // 저쪽만 고쳤다
      if (sameLines(t, b)) { out.push.apply(out, o); return; }   // 내쪽만 고쳤다

      충돌 = true;
      out.push(CONFLICT_START);
      out.push.apply(out, o);
      out.push(CONFLICT_MID);
      out.push.apply(out, t);
      out.push(CONFLICT_END + (theirName || 'other'));
    }

    /* 양쪽 모두에 살아남은 base 줄이 "흔들리지 않는 자리"다. 그 사이만 따져보면 된다. */
    for (let i = 0; i < base.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(oAt, i) ||
          !Object.prototype.hasOwnProperty.call(tAt, i)) continue;
      chunk(i, oAt[i], tAt[i]);
      out.push(base[i]);
      bi = i + 1; oi = oAt[i] + 1; ti = tAt[i] + 1;
    }
    chunk(base.length, ours.length, theirs.length);

    return { lines: out, 충돌: 충돌 };
  }

  function hasConflictMarkers(content) {
    return lines(content).some(function (l) {
      return l === CONFLICT_START || l === CONFLICT_MID || l.indexOf(CONFLICT_END) === 0;
    });
  }

  /**
   * 충돌 마커를 걷어내고 한쪽(또는 양쪽)만 남긴다.
   * 이건 git 명령이 아니라 **사람이 편집기로 하는 일**이다. 화면의 해결 버튼이 부른다.
   * @param {string} side 'ours' | 'theirs' | 'both'
   */
  function chooseSide(content, side) {
    const out = [];
    let mode = 'normal';
    lines(content).forEach(function (l) {
      if (l === CONFLICT_START) { mode = 'ours'; return; }
      if (l === CONFLICT_MID && mode === 'ours') { mode = 'theirs'; return; }
      if (l.indexOf(CONFLICT_END) === 0 && mode === 'theirs') { mode = 'normal'; return; }
      if (mode === 'normal') { out.push(l); return; }
      if (mode === 'ours' && (side === 'ours' || side === 'both')) out.push(l);
      if (mode === 'theirs' && (side === 'theirs' || side === 'both')) out.push(l);
    });
    return joinLines(out);
  }

  /** 지금 진행 중인 여러 단계짜리 작업 (merge · rebase) */
  function ongoing(state) {
    return wt(state).진행중 || null;
  }

  function conflictPaths(state) {
    const o = ongoing(state);
    return o && o.충돌파일 ? o.충돌파일.slice() : [];
  }

  /** merge·rebase 중에는 상태를 흔드는 다른 명령을 막는다. 실제 git 과 같다. */
  function needNoOngoing(state, what) {
    const o = ongoing(state);
    if (!o) return null;
    const 이름 = o.종류 === 'merge' ? '합치기(merge)' : '재작성(rebase)';
    return fail(state,
      o.종류 === 'merge'
        ? 'error: you have not concluded your merge (MERGE_HEAD exists).\nfatal: Exiting because of unfinished merge.'
        : 'fatal: It seems that there is already a rebase directory, and I wonder if you are in the middle of another rebase.',
      '아직 ' + 이름 + '가 끝나지 않았습니다. 먼저 마무리하거나 `git ' + o.종류 + ' --abort`로 되돌린 뒤에 ' +
      (what || '다른 명령') + '을(를) 실행할 수 있습니다.',
      { 오류이름: 'ongoing-' + o.종류 });
  }

  /* ====================================================================== */
  /*  결과 만들기                                                            */
  /* ====================================================================== */

  function ok(state, output, changed, explain, extra) {
    const result = {
      ok: true,
      state: state,
      output: output,
      변경영역: changed,
      유지영역: rest(changed),
      설명: explain
    };
    if (extra) Object.keys(extra).forEach(function (k) { result[k] = extra[k]; });
    return result;
  }

  /** 실패는 상태를 바꾸지 않는다. 그래서 원래 상태를 그대로 돌려준다. */
  function fail(state, output, explain, extra) {
    const result = {
      ok: false,
      state: state,
      output: output,
      변경영역: [],
      유지영역: AREAS.slice(),
      설명: explain
    };
    if (extra) Object.keys(extra).forEach(function (k) { result[k] = extra[k]; });
    return result;
  }

  const NOT_A_REPO =
    'fatal: not a git repository (or any of the parent directories): .git';

  function needRepo(state) {
    if (state.initialized) return null;
    return fail(state, NOT_A_REPO,
      '아직 이 폴더에 기록함(.git)이 없습니다. `git init`으로 먼저 만들어야 나머지 명령이 동작합니다.');
  }

  /* ====================================================================== */
  /*  status / log / diff — 상태를 바꾸지 않는 명령                            */
  /* ====================================================================== */

  function trackingLine(state) {
    const branch = headBranch(state);
    const track = branch && state.upstream[branch];
    if (!track || !state.remoteTracking[track]) return '';

    const cmp = aheadBehind(state.objects, state.localBranches[branch], state.remoteTracking[track].tip);
    if (!cmp.ahead && !cmp.behind) return "Your branch is up to date with '" + track + "'.\n";
    if (cmp.ahead && !cmp.behind) {
      return "Your branch is ahead of '" + track + "' by " + cmp.ahead + " commit(s).\n" +
        '  (use "git push" to publish your local commits)\n';
    }
    if (!cmp.ahead && cmp.behind) {
      return "Your branch is behind '" + track + "' by " + cmp.behind + " commit(s), and can be fast-forwarded.\n" +
        '  (use "git pull" to update your local branch)\n';
    }
    return "Your branch and '" + track + "' have diverged,\n" +
      'and have ' + cmp.ahead + ' and ' + cmp.behind + ' different commits each, respectively.\n';
  }

  /** 작업 폴더·스테이징·HEAD 세 스냅샷을 비교해 status 에 쓸 분류를 만든다 */
  function classify(state) {
    const head = commitFiles(state.objects, headCommitId(state));
    const staged = [];      // HEAD ≠ index
    const notStaged = [];   // index ≠ 작업 폴더
    const untracked = [];   // 작업 폴더에만 있음

    /* 충돌 중인 파일은 "스테이징됨"도 "안 됨"도 아니다. 실제 git 도 별도 묶음으로 보여준다.
       여기서 섞어버리면 화면이 "이미 커밋할 준비가 됐다"고 거짓말을 하게 된다. */
    const unmerged = conflictPaths(state);

    const all = {};
    [head, wt(state).index, wt(state).files].forEach(function (m) {
      Object.keys(m).forEach(function (k) { all[k] = true; });
    });

    Object.keys(all).sort().forEach(function (path) {
      if (unmerged.indexOf(path) !== -1) return;
      const inHead = Object.prototype.hasOwnProperty.call(head, path);
      const inIndex = Object.prototype.hasOwnProperty.call(wt(state).index, path);
      const inWork = Object.prototype.hasOwnProperty.call(wt(state).files, path);

      if (inIndex && !inHead) staged.push({ path: path, kind: 'new file' });
      else if (inIndex && inHead && head[path] !== wt(state).index[path]) staged.push({ path: path, kind: 'modified' });
      else if (!inIndex && inHead) staged.push({ path: path, kind: 'deleted' });

      if (inIndex && inWork && wt(state).index[path] !== wt(state).files[path]) notStaged.push({ path: path, kind: 'modified' });
      else if (inIndex && !inWork) notStaged.push({ path: path, kind: 'deleted' });

      if (!inIndex && !inHead && inWork) untracked.push(path);
    });

    return { staged: staged, notStaged: notStaged, untracked: untracked, unmerged: unmerged };
  }

  function pad(kind) {
    // 'both modified:' 가 14자라 12 로는 뒤에 공백이 하나도 안 붙는다
    return (kind + ':').padEnd(17, ' ');
  }

  function cmdStatus(state) {
    const guard = needRepo(state);
    if (guard) return guard;

    const branch = headBranch(state);
    const hasCommit = !!headCommitId(state);
    const c = classify(state);

    let out = wt(state).HEAD.type === 'detached'
      ? 'HEAD detached at ' + wt(state).HEAD.id + '\n'
      : 'On branch ' + branch + '\n';

    if (!hasCommit && wt(state).HEAD.type === 'branch') out += '\nNo commits yet\n';
    out += trackingLine(state);

    const o = ongoing(state);
    if (o && o.종류 === 'merge') {
      out += c.unmerged.length
        ? '\nYou have unmerged paths.\n  (fix conflicts and run "git commit")\n  (use "git merge --abort" to abort the merge)\n'
        : '\nAll conflicts fixed but you are still merging.\n  (use "git commit" to conclude merge)\n';
    } else if (o && o.종류 === 'rebase') {
      out += '\ninteractive rebase in progress; onto ' + o.대상커밋 + '\n' +
        (c.unmerged.length
          ? '  (fix conflicts and then run "git rebase --continue")\n  (use "git rebase --abort" to check out the original branch)\n'
          : '  (all conflicts fixed: run "git rebase --continue")\n');
    }

    if (c.unmerged.length) {
      out += '\nUnmerged paths:\n  (use "git add <file>..." to mark resolution)\n';
      c.unmerged.forEach(function (p) { out += '\t' + pad('both modified') + p + '\n'; });
    }

    if (c.staged.length) {
      out += '\nChanges to be committed:\n  (use "git restore --staged <file>..." to unstage)\n';
      c.staged.forEach(function (f) { out += '\t' + pad(f.kind) + f.path + '\n'; });
    }
    if (c.notStaged.length) {
      out += '\nChanges not staged for commit:\n' +
        '  (use "git add <file>..." to update what will be committed)\n' +
        '  (use "git restore <file>..." to discard changes in working directory)\n';
      c.notStaged.forEach(function (f) { out += '\t' + pad(f.kind) + f.path + '\n'; });
    }
    if (c.untracked.length) {
      out += '\nUntracked files:\n  (use "git add <file>..." to include in what will be committed)\n';
      c.untracked.forEach(function (p) { out += '\t' + p + '\n'; });
    }

    let explain;
    if (c.unmerged.length) {
      explain = '**Unmerged paths**가 지금 해결해야 할 것입니다. 양쪽이 같은 줄을 다르게 고쳐서 ' +
        'Git이 어느 쪽이 맞는지 판단하지 않고 넘긴 파일입니다. 파일을 열어 고른 뒤 `git add`로 ' +
        '"정했다"고 알리고, 전부 정하면 `git commit`으로 마무리합니다.';
    } else if (ongoing(state)) {
      explain = '충돌은 다 정리했지만 **아직 합치기가 끝나지 않았습니다.** `git commit`을 해야 합치기 커밋이 만들어집니다.';
    } else if (!c.staged.length && !c.notStaged.length && !c.untracked.length) {
      out += '\nnothing to commit, working tree clean\n';
      explain = '작업 폴더와 스테이징이 마지막 버전과 같습니다. 남길 것이 없습니다.';
    } else if (!c.staged.length && !c.notStaged.length) {
      out += '\nnothing added to commit but untracked files present (use "git add" to track)\n';
      explain = 'Git이 아직 지켜보지 않는 파일이 있습니다. `git add`로 골라야 다음 버전에 들어갑니다.';
    } else {
      explain = '위 세 묶음이 각각 다른 칸입니다. ' +
        '"Changes to be committed"는 스테이징, "Changes not staged"는 작업 폴더, ' +
        '"Untracked"는 Git이 아직 모르는 파일입니다.';
    }

    return ok(state, out, [], explain);
  }

  function refsAt(state, id) {
    const names = [];
    const head = headCommitId(state);
    Object.keys(state.localBranches).forEach(function (b) {
      if (state.localBranches[b] === id) {
        names.push(wt(state).HEAD.type === 'branch' && wt(state).HEAD.name === b ? 'HEAD -> ' + b : b);
      }
    });
    Object.keys(state.remoteTracking).forEach(function (r) {
      if (state.remoteTracking[r].tip === id) names.push(r);
    });
    if (wt(state).HEAD.type === 'detached' && head === id) names.unshift('HEAD');
    return names;
  }

  function cmdLog(state, cmd) {
    const guard = needRepo(state);
    if (guard) return guard;

    const showAll = !!cmd.flags['--all'];
    let tips = [headCommitId(state)];
    if (showAll) {
      Object.keys(state.localBranches).forEach(function (b) { tips.push(state.localBranches[b]); });
      Object.keys(state.remoteTracking).forEach(function (r) { tips.push(state.remoteTracking[r].tip); });
    }

    const seen = Object.create(null);
    let list = [];
    tips.filter(Boolean).forEach(function (t) {
      history(state.objects, t).forEach(function (c) {
        if (!seen[c.id]) { seen[c.id] = true; list.push(c); }
      });
    });
    list.sort(function (a, b) { return b.n - a.n; });

    if (!list.length) {
      return fail(state,
        "fatal: your current branch 'main' does not have any commits yet",
        '아직 커밋이 하나도 없습니다. `git add` 후 `git commit -m "메시지"`로 첫 버전을 남겨보세요.');
    }

    const limit = cmd.flags['-n'] ? parseInt(cmd.flags['-n'], 10) : list.length;
    let out = '';
    list.slice(0, isNaN(limit) ? list.length : limit).forEach(function (c) {
      const names = refsAt(state, c.id);
      out += c.id + (names.length ? ' (' + names.join(', ') + ')' : '') + ' ' + c.message + '\n';
    });

    const hidden = Object.keys(state.github.branches).some(function (b) {
      return state.github.branches[b] && !state.objects[state.github.branches[b]];
    });

    return ok(state, out, [],
      hidden
        ? 'log는 내 컴퓨터의 기록함만 읽습니다. GitHub에만 있고 아직 받아오지 않은 커밋은 여기 나오지 않습니다. `git fetch`를 해야 보입니다.'
        : 'log는 내 컴퓨터의 기록함만 읽습니다. 네트워크를 쓰지 않습니다.');
  }

  function diffBlock(path, before, after) {
    /* 줄마다 부호를 붙인다. 예전에는 파일 내용을 통째로 한 줄인 양 `-`/`+` 하나만 붙여서,
       두 줄짜리 파일부터 둘째 줄에 부호가 빠진 채로 나왔다. */
    const body = lineDiff(before, after).map(function (d) {
      return d.기호 + d.text;
    }).join('\n');

    return 'diff --git a/' + path + ' b/' + path + '\n' +
      '--- ' + (before === undefined ? '/dev/null' : 'a/' + path) + '\n' +
      '+++ ' + (after === undefined ? '/dev/null' : 'b/' + path) + '\n' +
      body + '\n';
  }

  function cmdDiff(state, cmd) {
    const guard = needRepo(state);
    if (guard) return guard;

    const staged = !!(cmd.flags['--staged'] || cmd.flags['--cached']);
    const left = staged ? commitFiles(state.objects, headCommitId(state)) : wt(state).index;
    const right = staged ? wt(state).index : wt(state).files;

    const paths = {};
    Object.keys(left).forEach(function (k) { paths[k] = true; });
    Object.keys(right).forEach(function (k) { paths[k] = true; });

    let out = '';
    Object.keys(paths).sort().forEach(function (p) {
      if (left[p] === right[p]) return;
      out += diffBlock(p, left[p], right[p]);
    });

    if (!out) {
      return ok(state, '', [], staged
        ? '스테이징과 마지막 버전이 같습니다. 지금 커밋하면 남길 것이 없습니다.'
        : '작업 폴더와 스테이징이 같습니다. `git add`할 것이 없습니다.');
    }
    return ok(state, out, [], staged
      ? '`--staged`는 **스테이징 ↔ 마지막 버전**을 비교합니다. 커밋하면 남을 내용이 이것입니다.'
      : '옵션 없는 diff는 **작업 폴더 ↔ 스테이징**을 비교합니다. 아직 `git add`하지 않은 것만 보입니다.');
  }

  /* ====================================================================== */
  /*  상태를 바꾸는 로컬 명령                                                  */
  /* ====================================================================== */

  function cmdInit(state) {
    if (state.initialized) {
      return fail(state,
        'Reinitialized existing Git repository in /연습폴더/.git/',
        '이미 기록함이 있습니다. `git init`을 다시 해도 기존 기록은 지워지지 않습니다.');
    }
    const next = clone(state);
    next.initialized = true;
    wt(next).HEAD = { type: 'branch', name: 'main' };
    return ok(next,
      'Initialized empty Git repository in /연습폴더/.git/',
      ['local'],
      '이 폴더에 기록함(.git)이 생겼습니다. 아직 버전은 하나도 없고, 작업 폴더의 파일도 그대로입니다.');
  }

  function cmdAdd(state, cmd) {
    const guard = needRepo(state);
    if (guard) return guard;

    const all = cmd.flags['-A'] || cmd.flags['--all'];
    let targets = cmd.args.slice();
    if (all && !targets.length) targets = ['.'];

    if (!targets.length) {
      return fail(state,
        "Nothing specified, nothing added.\nhint: Maybe you wanted to say 'git add .'?",
        '어떤 파일을 고를지 적어주세요. 전부 고르려면 `git add .`입니다.');
    }

    const next = clone(state);
    const added = [];

    if (targets.indexOf('.') !== -1) {
      Object.keys(wt(next).files).forEach(function (p) {
        if (wt(next).index[p] !== wt(next).files[p]) added.push(p);
        wt(next).index[p] = wt(next).files[p];
      });
    } else {
      for (let i = 0; i < targets.length; i++) {
        const p = targets[i];
        if (!Object.prototype.hasOwnProperty.call(wt(next).files, p)) {
          return fail(state,
            "fatal: pathspec '" + p + "' did not match any files",
            '작업 폴더에 `' + p + '`라는 파일이 없습니다. 이름을 다시 확인해주세요.');
        }
        if (wt(next).index[p] !== wt(next).files[p]) added.push(p);
        wt(next).index[p] = wt(next).files[p];
      }
    }

    /* 충돌 중이라면 add 의 뜻이 하나 더 있다 — "이 파일은 내가 정했다"는 표시.
       실제 git 도 같은 명령에 두 가지 뜻을 겹쳐 쓰는데, 초보자가 가장 헷갈리는 자리라 말로 설명한다. */
    const o = ongoing(next);
    const 해결 = [];
    let 마커남음 = false;
    if (o && o.충돌파일.length) {
      added.concat(targets).forEach(function (p) {
        const i = o.충돌파일.indexOf(p);
        if (i === -1) return;
        o.충돌파일.splice(i, 1);
        해결.push(p);
        if (hasConflictMarkers(wt(next).files[p])) 마커남음 = true;
      });
      if (targets.indexOf('.') !== -1) {
        o.충돌파일.slice().forEach(function (p) {
          o.충돌파일.splice(o.충돌파일.indexOf(p), 1);
          해결.push(p);
          if (hasConflictMarkers(wt(next).files[p])) 마커남음 = true;
        });
      }
    }

    if (해결.length) {
      const 남은 = o.충돌파일.length;
      return ok(next, '', ['staging'],
        '`' + 해결.join(', ') + '`을(를) **"내가 정했다"고 표시했습니다.** ' +
        '충돌 중의 `add`는 파일을 고르는 것뿐 아니라 해결을 선언하는 뜻도 함께 갖습니다.' +
        (마커남음
          ? '\n**주의: 파일에 `<<<<<<<` 표시가 아직 남아 있습니다.** Git은 확인해주지 않으므로 그대로 커밋됩니다. 파일을 다시 보세요.'
          : '') +
        (남은
          ? '\n아직 ' + 남은 + '개가 남았습니다.'
          : '\n남은 충돌이 없습니다. 이제 `git commit`으로 합치기를 마무리하세요.'),
        { 충돌: 마커남음 });
    }

    if (!added.length) {
      return ok(state, '', [], '이미 스테이징에 같은 내용이 올라가 있습니다. 바뀐 칸이 없습니다.');
    }

    return ok(next, '', ['staging'],
      '고른 파일이 스테이징에 올라갔습니다(' + added.join(', ') + '). ' +
      '**작업 폴더는 그대로이고, 커밋 기록도 아직 만들어지지 않았습니다.**');
  }

  function cmdCommit(state, cmd) {
    const guard = needRepo(state);
    if (guard) return guard;

    const message = cmd.flags['-m'] || cmd.flags['--message'];
    const amend = !!cmd.flags['--amend'];

    if (wt(state).HEAD.type === 'detached') {
      return fail(state, 'fatal: HEAD is detached, 이 실습실에서는 작업본 위에서만 커밋합니다',
        '지금은 특정 커밋을 직접 보고 있는 상태(detached HEAD)입니다. `git switch main`으로 작업본에 올라간 뒤 커밋해주세요.');
    }

    const branch = headBranch(state);
    const headId = headCommitId(state);

    const o = ongoing(state);
    if (o && o.종류 === 'rebase') {
      return fail(state,
        'fatal: You are in the middle of a rebase -- cannot commit.',
        'rebase 중에는 커밋을 직접 만들지 않습니다. 고른 뒤 `git add`로 표시하고 ' +
        '`git rebase --continue`를 쓰면 그 자리에 커밋이 만들어집니다.',
        { 오류이름: 'ongoing-rebase' });
    }

    /* 합치기를 마무리하는 커밋. 부모가 둘이고, 메시지를 안 줘도 된다. */
    if (o && o.종류 === 'merge') {
      if (o.충돌파일.length) {
        return fail(state,
          'error: Committing is not possible because you have unmerged files.\n' +
          o.충돌파일.map(function (p) { return '\tboth modified:   ' + p; }).join('\n') +
          '\nhint: Fix them up in the work tree, and then use "git add" as appropriate.',
          '아직 정하지 않은 파일이 ' + o.충돌파일.length + '개 남아 있습니다. ' +
          '파일에서 남길 것을 고른 뒤 `git add`로 표시해야 커밋할 수 있습니다.',
          { 오류이름: 'unmerged-files' });
      }

      const done = clone(state);
      const w = wt(done);
      const id = nextId(done);
      done.objects[id] = {
        id: id,
        parents: [headId, o.대상커밋],
        message: message || ('Merge ' + o.대상 + ' into ' + branch),
        files: clone(w.index),
        n: done.seq
      };
      done.localBranches[branch] = id;
      w.files = clone(w.index);
      w.진행중 = null;

      return ok(done, '[' + branch + ' ' + id + '] ' + done.objects[id].message, ['work', 'local'],
        '합치기가 끝났습니다. **부모가 둘인 커밋**이 만들어져서 양쪽 기록이 모두 남습니다. ' +
        '내가 고른 결과가 그 커밋의 내용입니다 — 충돌을 해결한다는 것은 결국 ' +
        '"이 파일의 최종본은 이것이다"를 사람이 정하는 일입니다.');
    }

    if (amend && !headId) {
      return fail(state, 'fatal: You have nothing to amend.',
        '고쳐 쓸 직전 커밋이 없습니다. 먼저 커밋을 하나 남겨야 합니다.');
    }
    if (!amend && !message) {
      return fail(state, 'fatal: 커밋 메시지가 필요합니다. `git commit -m "메시지"`',
        '무엇을 남기는 버전인지 메시지로 적어주세요. 나중에 이 줄만 보고 찾게 됩니다.');
    }

    const headFiles = amend
      ? commitFiles(state.objects, (state.objects[headId].parents || [])[0])
      : commitFiles(state.objects, headId);

    if (!amend && sameFiles(headFiles, wt(state).index)) {
      const c = classify(state);
      const pending = c.notStaged.length || c.untracked.length;
      return fail(state,
        'On branch ' + branch + '\n' + (pending
          ? 'nothing added to commit but untracked files present (use "git add" to track)\n'
          : 'nothing to commit, working tree clean\n'),
        pending
          ? '스테이징이 비어 있습니다. **작업 폴더만 고쳐서는 버전이 남지 않습니다.** `git add`로 먼저 골라주세요.'
          : '마지막 버전과 달라진 것이 없어 남길 것이 없습니다.');
    }

    const next = clone(state);
    const parents = amend ? (next.objects[headId].parents || []).slice() : (headId ? [headId] : []);
    const finalMessage = amend
      ? (cmd.flags['--no-edit'] ? next.objects[headId].message : (message || next.objects[headId].message))
      : message;

    const id = nextId(next);
    next.objects[id] = {
      id: id,
      parents: parents,
      message: finalMessage,
      files: clone(wt(next).index),
      n: next.seq
    };
    next.localBranches[branch] = id;

    const count = Object.keys(wt(next).index).length;
    const out = '[' + branch + ' ' + id + '] ' + finalMessage + '\n' +
      ' ' + count + ' file(s) in this version\n';

    if (amend) {
      return ok(next, out, ['local'],
        'amend는 커밋을 고치는 것이 아니라 **새 커밋으로 갈아끼우는 것**입니다. 그래서 id가 `' + headId + '` → `' + id + '`로 바뀌었습니다. ' +
        '이미 push한 커밋이었다면 GitHub의 것과 달라집니다.');
    }
    return ok(next, out, ['local'],
      '스테이징에 있던 것만 버전으로 남았습니다. **작업 폴더도 스테이징도 그대로이고, GitHub에는 아무것도 가지 않았습니다.**');
  }

  function cmdRestore(state, cmd) {
    const guard = needRepo(state);
    if (guard) return guard;

    const staged = !!cmd.flags['--staged'];
    if (!cmd.args.length) {
      return fail(state, 'fatal: you must specify path(s) to restore',
        '어떤 파일을 되돌릴지 적어주세요. 예: `git restore ' + (staged ? '--staged ' : '') + 'memo.txt`');
    }

    const next = clone(state);
    const head = commitFiles(next.objects, headCommitId(next));
    const touched = [];

    for (let i = 0; i < cmd.args.length; i++) {
      const p = cmd.args[i];
      if (staged) {
        if (!Object.prototype.hasOwnProperty.call(wt(next).index, p) &&
            !Object.prototype.hasOwnProperty.call(head, p)) {
          return fail(state, "error: pathspec '" + p + "' did not match any file(s) known to git",
            '스테이징에도 마지막 버전에도 `' + p + '`가 없습니다.');
        }
        if (Object.prototype.hasOwnProperty.call(head, p)) wt(next).index[p] = head[p];
        else delete wt(next).index[p];
        touched.push(p);
      } else {
        if (!Object.prototype.hasOwnProperty.call(wt(next).index, p)) {
          return fail(state, "error: pathspec '" + p + "' did not match any file(s) known to git",
            '`' + p + '`는 아직 Git이 지켜보는 파일이 아닙니다. `git add`로 한 번은 올려야 되돌릴 기준이 생깁니다.');
        }
        wt(next).files[p] = wt(next).index[p];
        touched.push(p);
      }
    }

    if (staged) {
      return ok(next, '', ['staging'],
        '`' + touched.join(', ') + '`를 스테이징에서 내렸습니다. **작업 폴더에서 고친 내용은 그대로 남아 있습니다.** ' +
        '`--staged` 없이 쓰면 그 편집까지 사라지므로 둘은 다른 명령입니다.');
    }
    return ok(next, '', ['work'],
      '`' + touched.join(', ') + '`의 작업 폴더 내용을 스테이징에 올라가 있던 내용으로 덮었습니다. ' +
      '**고치던 내용은 되돌릴 수 없습니다.** 커밋도 스테이징도 바뀌지 않았습니다.');
  }

  function cmdBranch(state, cmd) {
    const guard = needRepo(state);
    if (guard) return guard;

    const del = cmd.flags['-d'] || cmd.flags['-D'];
    if (del) {
      if (!Object.prototype.hasOwnProperty.call(state.localBranches, del)) {
        return fail(state, "error: branch '" + del + "' not found.",
          '`' + del + '`라는 작업본이 없습니다.');
      }
      if (headBranch(state) === del) {
        return fail(state, "error: cannot delete branch '" + del + "' checked out at '/연습폴더'",
          '지금 올라가 있는 작업본은 지울 수 없습니다. 다른 작업본으로 옮긴 뒤 지워주세요.');
      }
      const next = clone(state);
      const tip = next.localBranches[del];
      delete next.localBranches[del];
      return ok(next, 'Deleted branch ' + del + ' (was ' + tip + ').',
        ['local'],
        '작업본 이름표만 지웠습니다. 커밋 자체가 사라진 것은 아니지만, 가리키는 이름표가 없으면 찾기 어려워집니다.');
    }

    const name = cmd.args[0];
    if (!name) {
      let out = '';
      Object.keys(state.localBranches).sort().forEach(function (b) {
        out += (headBranch(state) === b ? '* ' : '  ') + b + '\n';
      });
      if (cmd.flags['-a']) {
        Object.keys(state.remoteTracking).sort().forEach(function (r) {
          out += '  remotes/' + r + '\n';
        });
      }
      return ok(state, out || '  (아직 작업본이 없습니다)\n', [],
        cmd.flags['-a']
          ? '`remotes/`로 시작하는 줄이 원격 추적 이름표입니다. **GitHub에 접속해서 읽어온 것이 아니라, 마지막 fetch 때 적어둔 메모입니다.**'
          : '지금 있는 작업본 목록입니다. `*`가 지금 올라가 있는 것입니다.');
    }

    if (Object.prototype.hasOwnProperty.call(state.localBranches, name)) {
      return fail(state, "fatal: a branch named '" + name + "' already exists",
        '같은 이름의 작업본이 이미 있습니다.');
    }
    const headId = headCommitId(state);
    if (!headId) {
      return fail(state, "fatal: not a valid object name: 'main'",
        '커밋이 하나도 없으면 새 작업본을 만들 수 없습니다. 작업본은 커밋을 가리키는 이름표이기 때문입니다.');
    }

    const next = clone(state);
    next.localBranches[name] = headId;
    return ok(next, '', ['local'],
      '`' + name + '` 이름표가 지금 커밋(' + headId + ')을 가리키게 만들었습니다. **아직 옮겨가지는 않았습니다.** 옮기려면 `git switch ' + name + '`입니다.');
  }

  function cmdSwitch(state, cmd) {
    const guard = needRepo(state) || needNoOngoing(state, '작업본 옮기기');
    if (guard) return guard;

    const create = cmd.flags['-c'] || cmd.flags['-C'];
    const target = create || cmd.args[0];

    if (!target) {
      return fail(state, 'fatal: missing branch name',
        '어느 작업본으로 갈지 적어주세요. 예: `git switch main`');
    }

    if (create) {
      if (Object.prototype.hasOwnProperty.call(state.localBranches, create)) {
        return fail(state, "fatal: a branch named '" + create + "' already exists",
          '같은 이름의 작업본이 이미 있습니다.');
      }
      const headId = headCommitId(state);
      if (!headId) {
        return fail(state, "fatal: 커밋이 없어 새 작업본을 만들 수 없습니다",
          '작업본은 커밋을 가리키는 이름표라, 가리킬 커밋이 하나는 있어야 합니다.');
      }
      const next = clone(state);
      next.localBranches[create] = headId;
      wt(next).HEAD = { type: 'branch', name: create };
      return ok(next, "Switched to a new branch '" + create + "'",
        ['local'],
        '새 이름표를 만들고 그 위로 올라갔습니다. 같은 커밋을 가리키므로 **작업 폴더와 스테이징은 전혀 바뀌지 않았습니다.**');
    }

    if (!Object.prototype.hasOwnProperty.call(state.localBranches, target)) {
      return fail(state, "fatal: invalid reference: " + target,
        '`' + target + '`라는 작업본이 없습니다. `git branch`로 목록을 볼 수 있습니다.');
    }
    if (headBranch(state) === target) {
      return ok(state, "Already on '" + target + "'", [], '이미 그 작업본에 올라가 있습니다.');
    }

    const 쓰는곳 = worktreeUsing(state, target);
    if (쓰는곳) {
      return fail(state,
        "fatal: '" + target + "' is already checked out at '" + 쓰는곳 + "'",
        '`' + target + '`은(는) 이미 `' + 쓰는곳 + '` 폴더에서 열려 있습니다. ' +
        '작업본 하나는 한 폴더에서만 열 수 있습니다 — 그 폴더로 옮겨가서 작업하세요.',
        { 오류이름: 'branch-already-checked-out' });
    }

    /* 커밋하지 않은 변경이 있으면, 옮겨갈 곳에서 그 파일이 다를 때 덮어쓰게 된다.
       실제 git 이 여기서 멈추는 이유이고, 초보자가 가장 자주 만나는 오류다. */
    const c = classify(state);
    const dirty = c.staged.concat(c.notStaged).map(function (f) { return f.path; });
    const targetFiles = commitFiles(state.objects, state.localBranches[target]);
    const headFiles = commitFiles(state.objects, headCommitId(state));
    const wouldLose = dirty.filter(function (p) { return targetFiles[p] !== headFiles[p]; });

    if (wouldLose.length) {
      return fail(state,
        'error: Your local changes to the following files would be overwritten by checkout:\n' +
        wouldLose.map(function (p) { return '\t' + p; }).join('\n') +
        '\nPlease commit your changes or stash them before you switch branches.\naborting',
        '옮겨가려는 작업본에서 같은 파일이 다르게 생겼습니다. 지금 옮기면 고치던 내용이 사라지므로 Git이 멈춘 것입니다. ' +
        '**아무것도 바뀌지 않았습니다.** 커밋할 만큼 정리된 작업이면 `git commit`을, 아직 아니면 `git stash`로 서랍에 치워두고 옮긴 뒤 `git stash pop`으로 꺼내세요.',
        { 오류이름: 'local-changes-overwritten' });
    }

    const next = clone(state);
    wt(next).HEAD = { type: 'branch', name: target };
    Object.keys(targetFiles).forEach(function (p) {
      if (dirty.indexOf(p) !== -1) return;
      wt(next).files[p] = targetFiles[p];
      wt(next).index[p] = targetFiles[p];
    });
    Object.keys(headFiles).forEach(function (p) {
      if (Object.prototype.hasOwnProperty.call(targetFiles, p)) return;
      if (dirty.indexOf(p) !== -1) return;
      delete wt(next).files[p];
      delete wt(next).index[p];
    });

    return ok(next, "Switched to branch '" + target + "'",
      ['work', 'staging', 'local'],
      '작업본을 옮겼습니다. 그 작업본의 마지막 버전에 맞춰 **작업 폴더와 스테이징도 함께 바뀝니다.** GitHub 쪽은 그대로입니다.');
  }

  function cmdRemote(state, cmd) {
    const guard = needRepo(state);
    if (guard) return guard;

    const sub = cmd.args[0];

    if (!sub || cmd.flags['-v'] || cmd.flags['--verbose']) {
      const names = Object.keys(state.remotes);
      if (!names.length) {
        return ok(state, '', [], '아직 연결된 공유 폴더가 없습니다. `git remote add origin <주소>`로 연결합니다.');
      }
      let out = '';
      names.forEach(function (n) {
        out += n + '\t' + state.remotes[n] + ' (fetch)\n' + n + '\t' + state.remotes[n] + ' (push)\n';
      });
      return ok(state, out, [], '`origin`은 주소에 붙인 **별명**입니다. 공유 폴더 자체가 아니라 그 주소를 부르는 이름입니다.');
    }

    if (sub !== 'add') {
      return fail(state, 'usage: git remote add <name> <url>',
        '이 실습실은 `git remote add`와 `git remote -v`만 다룹니다.');
    }

    const name = cmd.args[1], url = cmd.args[2];
    if (!name || !url) {
      return fail(state, 'usage: git remote add <name> <url>',
        '별명과 주소를 함께 적어주세요. 예: `git remote add origin https://github.com/내계정/연습.git`');
    }
    if (Object.prototype.hasOwnProperty.call(state.remotes, name)) {
      return fail(state, 'error: remote ' + name + ' already exists.',
        '`' + name + '`라는 별명이 이미 있습니다. 주소를 바꾸려면 `git remote set-url`을 씁니다(이 실습실에서는 다루지 않습니다).',
        { 오류이름: 'remote-already-exists' });
    }

    const next = clone(state);
    next.remotes[name] = url;
    return ok(next, '', [],
      '주소에 별명을 붙였을 뿐입니다. **5칸 중 어느 것도 바뀌지 않았고, 네트워크도 쓰지 않았습니다.** 저장소 설정만 바뀝니다.');
  }

  /* ====================================================================== */
  /*  서랍 — stash                                                           */
  /* ====================================================================== */

  /* 서랍은 저장소 하나에 하나다(작업 공간마다가 아니다). 실제 git 도 그렇고,
     그래서 다른 작업 공간에서 넣어둔 것을 여기서 꺼낼 수 있다. */

  /** `stash@{2}` · `2` · 생략(=0) 을 번호로 바꾼다 */
  function stashIndex(ref) {
    if (ref === undefined || ref === null || ref === '') return 0;
    const m = /^stash@\{(\d+)\}$/.exec(ref) || /^(\d+)$/.exec(ref);
    return m ? parseInt(m[1], 10) : -1;
  }

  function stashLabel(state, entry) {
    return 'WIP on ' + entry.branch + ': ' + (entry.base || '(커밋 없음)') + ' ' + entry.메시지;
  }

  function stashPush(state, cmd) {
    const busy = needNoOngoing(state, '치워두기');
    if (busy) return busy;

    const c = classify(state);
    const untracked = c.untracked.slice();
    const withUntracked = !!(cmd.flags['-u'] || cmd.flags['--include-untracked']);

    if (!c.staged.length && !c.notStaged.length && !(withUntracked && untracked.length)) {
      return fail(state, 'No local changes to save',
        untracked.length
          ? 'Git이 지켜보는 파일 중에는 바뀐 것이 없습니다. **아직 한 번도 `add`하지 않은 파일은 기본적으로 치워지지 않습니다** — ' +
            '함께 치우려면 `git stash -u`입니다.'
          : '치워둘 변경이 없습니다.');
    }

    const next = clone(state);
    const w = wt(next);
    const headFiles = commitFiles(next.objects, headCommitId(next));

    const entry = {
      메시지: cmd.flags['-m'] || cmd.flags['--message'] || '작업 중이던 내용',
      branch: headBranch(next) || '(작업본 없음)',
      base: headCommitId(next),
      files: clone(w.files),
      index: clone(w.index),
      untracked: withUntracked ? untracked.slice() : [],
      n: next.clock + 1
    };
    next.clock += 1;

    /* 마지막 버전 상태로 되돌린다. untracked 는 -u 를 줬을 때만 함께 치운다 */
    w.files = clone(headFiles);
    w.index = clone(headFiles);
    if (!withUntracked) {
      untracked.forEach(function (p) { w.files[p] = state.worktrees[state.현재작업공간].files[p]; });
    }

    next.stash.unshift(entry);

    return ok(next, 'Saved working directory and index state ' + stashLabel(next, entry),
      ['work', 'staging'],
      '작업 폴더와 스테이징을 **서랍에 통째로 넣고** 마지막 버전 상태로 되돌렸습니다. ' +
      '커밋 기록은 건드리지 않았습니다 — 그래서 커밋하기 애매한 작업을 잠깐 치울 때 씁니다. ' +
      '`git stash pop`으로 다시 꺼냅니다.' +
      (!withUntracked && untracked.length
        ? ' (아직 `add`한 적 없는 파일 ' + untracked.length + '개는 그대로 뒀습니다. 함께 치우려면 `-u`입니다.)'
        : ''));
  }

  function stashRestore(state, cmd, drop) {
    const i = stashIndex(cmd.args[1]);
    if (i < 0 || !state.stash[i]) {
      return fail(state, "fatal: log for 'stash' only has " + state.stash.length + ' entries',
        state.stash.length
          ? '서랍 ' + i + '번이 없습니다. `git stash list`로 번호를 확인해주세요.'
          : '서랍이 비어 있습니다.');
    }

    /* 지금 작업 폴더가 지저분하면 어느 쪽을 남길지 정해야 한다.
       실제 git 은 병합을 시도하지만, 실습실에서는 그 전에 멈추고 이유를 말한다. */
    const c = classify(state);
    if (c.staged.length || c.notStaged.length) {
      return fail(state, 'error: Your local changes would be overwritten by merge.\nPlease commit your changes or stash them before you merge.',
        '지금 작업 폴더에도 고친 것이 남아 있습니다. 꺼낸 것과 섞이면 어느 쪽이 맞는지 알 수 없어 멈췄습니다. ' +
        '**아무것도 바뀌지 않았습니다.** 먼저 커밋하거나 이것도 치워두세요.',
        { 오류이름: 'stash-dirty' });
    }

    const next = clone(state);
    const w = wt(next);
    const entry = next.stash[i];

    w.files = clone(entry.files);
    w.index = clone(entry.index);
    if (drop) next.stash.splice(i, 1);

    const c2 = classify(next);
    return ok(next,
      'On branch ' + (headBranch(next) || '?') + '\n' +
      (c2.staged.length ? 'Changes to be committed:\n' + c2.staged.map(function (f) { return '\t' + pad(f.kind) + f.path; }).join('\n') + '\n' : '') +
      (c2.notStaged.length ? 'Changes not staged for commit:\n' + c2.notStaged.map(function (f) { return '\t' + pad(f.kind) + f.path; }).join('\n') + '\n' : '') +
      (drop ? 'Dropped stash@{' + i + '} (' + entry.메시지 + ')' : ''),
      ['work', 'staging'],
      drop
        ? '서랍에서 꺼내 작업 폴더와 스테이징에 되돌려놓고, **서랍에서는 지웠습니다.** ' +
          '`apply`는 꺼내되 서랍에 그대로 두는 점이 다릅니다.'
        : '서랍에서 꺼내 되돌려놓았습니다. **서랍에는 그대로 남아 있습니다** — 여러 작업본에 같은 것을 적용할 때 씁니다.');
  }

  function cmdStash(state, cmd) {
    const guard = needRepo(state);
    if (guard) return guard;

    const sub = cmd.args[0] || 'push';

    if (sub === 'push' || sub === 'save') return stashPush(state, cmd);
    if (sub === 'pop') return stashRestore(state, cmd, true);
    if (sub === 'apply') return stashRestore(state, cmd, false);

    if (sub === 'list') {
      if (!state.stash.length) {
        return ok(state, '', [], '서랍이 비어 있습니다. `git stash`로 지금 작업을 치워둘 수 있습니다.');
      }
      const out = state.stash.map(function (e, i) {
        return 'stash@{' + i + '}: ' + stashLabel(state, e) + (e.메시지 ? '' : '');
      }).join('\n');
      return ok(state, out, [],
        '**서랍은 쌓입니다.** `stash@{0}`이 가장 최근에 넣은 것입니다. 번호를 주면 그것을 꺼냅니다 — `git stash pop stash@{1}`.');
    }

    if (sub === 'drop') {
      const i = stashIndex(cmd.args[1]);
      if (i < 0 || !state.stash[i]) {
        return fail(state, 'fatal: 서랍 ' + cmd.args[1] + ' 을(를) 찾지 못했습니다',
          '`git stash list`로 번호를 확인해주세요.');
      }
      const next = clone(state);
      const gone = next.stash.splice(i, 1)[0];
      return ok(next, 'Dropped stash@{' + i + '} (' + gone.메시지 + ')', [],
        '서랍에서 **꺼내지 않고 버렸습니다.** 그 안의 변경은 되돌릴 방법이 없습니다. ' +
        '5칸은 하나도 바뀌지 않았습니다 — 버린 것은 서랍 안의 내용입니다.');
    }

    return fail(state, 'usage: git stash [push|list|apply|pop|drop]',
      '이 실습실은 `push`(기본) · `list` · `apply` · `pop` · `drop`을 다룹니다.');
  }

  /* ====================================================================== */
  /*  경계를 넘는 명령 — fetch / push / pull                                  */
  /* ====================================================================== */

  function needOrigin(state) {
    if (Object.prototype.hasOwnProperty.call(state.remotes, 'origin')) return null;
    return fail(state,
      "fatal: 'origin' does not appear to be a git repository\n" +
      'fatal: Could not read from remote repository.',
      '아직 공유 폴더 주소를 연결하지 않았습니다. `git remote add origin <주소>`를 먼저 해주세요.',
      { 오류이름: 'no-remote' });
  }

  function shortUrl(url) {
    return String(url || '').replace(/^https?:\/\//, '').replace(/\.git$/, '');
  }

  function cmdFetch(state) {
    const guard = needRepo(state) || needOrigin(state);
    if (guard) return guard;

    const next = clone(state);
    const lines = [];

    Object.keys(next.github.branches).forEach(function (b) {
      const remoteTip = next.github.branches[b];
      const ref = 'origin/' + b;
      const before = next.remoteTracking[ref] ? next.remoteTracking[ref].tip : null;

      copyObjects(next.github.objects, next.objects, remoteTip);

      if (before !== remoteTip) {
        lines.push(before
          ? '   ' + before + '..' + remoteTip + '  ' + b + '       -> ' + ref
          : ' * [new branch]      ' + b + '       -> ' + ref);
      }
      next.remoteTracking[ref] = {
        tip: remoteTip,
        lastFetchedAt: next.clock + 1,
        lastFetchedLabel: state.now || null
      };
    });
    next.clock += 1;

    if (!lines.length) {
      return ok(next, '', ['origin-tracking'],
        '공유 폴더에 새로 올라온 것이 없습니다. `origin/main` 메모의 **확인 시각만** 새로 찍혔습니다.');
    }

    return ok(next,
      'From ' + shortUrl(next.remotes.origin) + '\n' + lines.join('\n'),
      ['origin-tracking'],
      '`origin/main` 메모가 방금 본 GitHub 상태로 갱신됐습니다. ' +
      '**작업 폴더도, 스테이징도, 내 작업본(main)도 하나도 바뀌지 않았습니다.** ' +
      'fetch는 받아오기만 하고 합치지 않기 때문입니다. 합치려면 `git merge origin/main`이 따로 필요합니다.');
  }

  function cmdPush(state, cmd) {
    const guard = needRepo(state) || needOrigin(state);
    if (guard) return guard;

    const branch = headBranch(state);
    if (!branch) {
      return fail(state, 'fatal: You are not currently on a branch.',
        '지금 작업본 위에 있지 않아 보낼 대상을 정할 수 없습니다.');
    }

    let target = cmd.args[1] || branch;
    if (cmd.args[0] && cmd.args[0] !== 'origin') {
      return fail(state, "fatal: '" + cmd.args[0] + "' does not appear to be a git repository",
        '이 실습실에는 `origin` 하나만 연결되어 있습니다.');
    }
    if (!cmd.args.length && !state.upstream[branch]) {
      return fail(state,
        'fatal: The current branch ' + branch + ' has no upstream branch.\n' +
        'To push the current branch and set the remote as upstream, use\n\n' +
        '    git push --set-upstream origin ' + branch + '\n',
        '이 작업본이 공유 폴더의 어느 것과 짝인지 아직 정해지지 않았습니다. ' +
        '`git push -u origin ' + branch + '`로 한 번만 정해주면 다음부터는 `git push`만으로 됩니다.',
        { 오류이름: 'no-upstream' });
    }

    const localTip = state.localBranches[branch];
    if (!localTip) {
      return fail(state, 'error: src refspec ' + branch + ' does not match any\n' +
        "error: failed to push some refs to '" + state.remotes.origin + "'",
        '`' + branch + '`에 커밋이 하나도 없습니다. 보낼 버전이 없으면 push할 것도 없습니다. ' +
        '먼저 `git add` → `git commit`으로 첫 버전을 남겨주세요.',
        { 오류이름: 'src-refspec-no-match' });
    }

    const remoteTip = state.github.branches[target] || null;

    /* 원격의 끝이 내 기록함에 아예 없거나, 있어도 내 커밋의 조상이 아니면
       내가 모르는 커밋이 저쪽에 있다는 뜻이다. 그대로 밀면 그게 사라진다. */
    const canFastForward = !remoteTip ||
      (!!state.objects[remoteTip] && isAncestor(state.objects, remoteTip, localTip));

    if (!canFastForward) {
      return fail(state,
        'To ' + state.remotes.origin + '\n' +
        ' ! [rejected]        ' + branch + ' -> ' + target + ' (fetch first)\n' +
        "error: failed to push some refs to '" + state.remotes.origin + "'\n" +
        'hint: Updates were rejected because the remote contains work that you do\n' +
        'hint: not have locally. This is usually caused by another repository pushing\n' +
        "hint: to the same ref. If you want to integrate the remote changes, use\n" +
        "hint: 'git pull' before pushing again.",
        'GitHub의 `' + target + '`에 **내 기록함에 없는 커밋**이 있습니다. 지금 밀어넣으면 그게 사라지므로 Git이 거절했습니다. ' +
        '**로컬도 GitHub도 아무것도 바뀌지 않았습니다.** 먼저 `git fetch`로 무엇이 다른지 보고, 합친 뒤에 다시 push하세요.',
        { 오류이름: 'non-fast-forward' });
    }

    if (remoteTip === localTip) {
      const same = clone(state);
      if (cmd.flags['-u'] || cmd.flags['--set-upstream']) same.upstream[branch] = 'origin/' + target;
      return ok(same, 'Everything up-to-date', [],
        'GitHub에 이미 같은 내용이 올라가 있습니다. 보낼 것이 없습니다.');
    }

    const next = clone(state);
    copyObjects(next.objects, next.github.objects, localTip);
    next.github.branches[target] = localTip;
    next.remoteTracking['origin/' + target] = {
      tip: localTip,
      lastFetchedAt: next.clock + 1,
      lastFetchedLabel: state.now || null
    };
    next.clock += 1;
    if (cmd.flags['-u'] || cmd.flags['--set-upstream']) next.upstream[branch] = 'origin/' + target;

    return ok(next,
      'To ' + next.remotes.origin + '\n' +
      '   ' + (remoteTip || '[new branch]') + (remoteTip ? '..' + localTip : '  ' + target) +
      '  ' + branch + ' -> ' + target,
      ['remote', 'origin-tracking'],
      '내 커밋이 네트워크를 건너 GitHub에 올라갔습니다. **작업 폴더와 스테이징은 그대로입니다.** ' +
      '보내고 나면 `origin/main` 메모도 방금 올린 것으로 함께 맞춰집니다 — 지금 GitHub 상태를 확실히 알기 때문입니다.');
  }

  /* ------------------------------- merge ------------------------------- */

  /** 이름 하나를 커밋 id 로 바꾼다. 로컬 작업본 / 원격 추적 이름표 / 커밋 id / HEAD~n */
  function resolveRev(state, ref) {
    if (!ref) return null;

    const tilde = /^(.+?)~(\d+)$/.exec(ref);
    if (tilde) {
      let id = resolveRev(state, tilde[1]);
      let n = parseInt(tilde[2], 10);
      while (n-- > 0 && id) id = (state.objects[id].parents || [])[0] || null;
      return id;
    }
    if (ref === 'HEAD') return headCommitId(state);
    if (Object.prototype.hasOwnProperty.call(state.localBranches, ref)) return state.localBranches[ref];
    if (Object.prototype.hasOwnProperty.call(state.remoteTracking, ref)) return state.remoteTracking[ref].tip;
    if (state.objects[ref]) return ref;
    return null;
  }

  /**
   * 세 스냅샷을 합친다.
   * 같은 파일을 양쪽이 고쳤어도 **서로 다른 줄**이면 자동으로 합쳐진다.
   * 같은 줄 자리를 다르게 고쳤을 때만 충돌이고, 그때는 충돌 마커가 든 파일이 나온다.
   *
   * @returns {{files:Object, conflicts:string[]}}
   */
  function mergeFiles(base, ours, theirs, theirName) {
    const paths = {};
    [base, ours, theirs].forEach(function (m) {
      Object.keys(m).forEach(function (k) { paths[k] = true; });
    });

    const out = {};
    const conflicts = [];
    Object.keys(paths).sort().forEach(function (p) {
      const b = base[p], o = ours[p], t = theirs[p];
      if (o === t) { if (o !== undefined) out[p] = o; return; }
      if (o === b) { if (t !== undefined) out[p] = t; return; }   // 저쪽만 고쳤다
      if (t === b) { if (o !== undefined) out[p] = o; return; }   // 내쪽만 고쳤다

      /* 한쪽이 지우고 한쪽이 고친 경우. 줄로 합칠 수가 없어 사람이 정해야 한다. */
      if (o === undefined || t === undefined) {
        conflicts.push(p);
        out[p] = (o === undefined ? t : o);
        return;
      }

      const merged = mergeLines(lines(b), lines(o), lines(t), theirName);
      out[p] = joinLines(merged.lines);
      if (merged.충돌) conflicts.push(p);
    });
    return { files: out, conflicts: conflicts };
  }

  /** 공통 조상 — 양쪽 조상 집합의 교집합 중 가장 나중 커밋 */
  function mergeBase(store, a, b) {
    const setB = ancestorSet(store, b);
    let best = null;
    Object.keys(ancestorSet(store, a)).forEach(function (id) {
      if (!setB[id]) return;
      if (!best || store[id].n > store[best].n) best = id;
    });
    return best;
  }

  /** merge 의 알맹이. pull 이 두 번째 장면으로 그대로 다시 쓴다. */
  function doMerge(state, refName) {
    const branch = headBranch(state);
    if (!branch) {
      return fail(state, 'fatal: 지금 작업본 위에 있지 않습니다',
        '`git switch main`으로 작업본에 올라간 뒤 합쳐주세요.');
    }

    const theirsTip = resolveRev(state, refName);
    if (!theirsTip) {
      return fail(state, 'merge: ' + refName + ' - not something we can merge',
        '`' + refName + '`라는 이름을 찾지 못했습니다. `git branch -a`로 있는 이름을 확인해보세요.');
    }

    const oursTip = state.localBranches[branch];
    if (oursTip && isAncestor(state.objects, theirsTip, oursTip)) {
      return ok(state, 'Already up to date.', [],
        '합칠 것이 없습니다. `' + refName + '`가 가리키는 커밋은 이미 내 기록에 들어 있습니다.');
    }

    /* 커밋하지 않은 변경이 덮일 상황이면 실제 git 처럼 멈춘다 */
    const c = classify(state);
    const dirty = c.staged.concat(c.notStaged).map(function (f) { return f.path; });
    const oursFiles = commitFiles(state.objects, oursTip);
    const theirsFiles = commitFiles(state.objects, theirsTip);
    const wouldLose = dirty.filter(function (p) { return theirsFiles[p] !== oursFiles[p]; });
    if (wouldLose.length) {
      return fail(state,
        'error: Your local changes to the following files would be overwritten by merge:\n' +
        wouldLose.map(function (p) { return '\t' + p; }).join('\n') +
        '\nPlease commit your changes or stash them before you merge.\naborting',
        '합치면 지금 고치던 내용이 덮입니다. **아무것도 바뀌지 않았습니다.** 먼저 `git commit`하거나 `git stash`로 치워두세요.',
        { 오류이름: 'local-changes-overwritten' });
    }

    /* 빨리 감기 — 내 커밋이 저쪽의 조상이면 이름표만 옮기면 된다 */
    if (!oursTip || isAncestor(state.objects, oursTip, theirsTip)) {
      const ff = clone(state);
      ff.localBranches[branch] = theirsTip;
      wt(ff).files = clone(theirsFiles);
      wt(ff).index = clone(theirsFiles);
      return ok(ff,
        'Updating ' + (oursTip ? oursTip.slice(0, 7) + '..' : '') + theirsTip + '\nFast-forward',
        ['work', 'staging', 'local'],
        '내가 만든 커밋이 하나도 없어서 **새 커밋을 만들지 않고 이름표만 앞으로 옮겼습니다.** ' +
        '이걸 빨리 감기(fast-forward)라고 부릅니다. 작업 폴더도 저쪽 버전으로 맞춰졌습니다.');
    }

    const base = mergeBase(state.objects, oursTip, theirsTip);
    const merged = mergeFiles(commitFiles(state.objects, base), oursFiles, theirsFiles, refName);

    if (merged.conflicts.length) {
      /* 실패가 아니다. **여기서 멈추고 사람에게 넘기는 것**이 merge 의 정상 동작이다.
         그래서 상태를 되돌리지 않고, 마커가 든 파일을 작업 폴더에 실제로 써둔다. */
      const paused = clone(state);
      const w = wt(paused);

      w.진행중 = {
        종류: 'merge',
        대상: refName,
        대상커밋: theirsTip,
        충돌파일: merged.conflicts.slice(),
        /* --abort 로 정확히 이 자리로 돌아오기 위해 시작 직전 모습을 통째로 들고 있는다 */
        되돌릴상태: { files: clone(w.files), index: clone(w.index) }
      };
      w.files = clone(merged.files);
      /* 충돌 안 난 파일은 스테이징까지 올라간다. 충돌 난 파일은 "아직 안 정해짐"으로 남는다 */
      w.index = clone(merged.files);
      merged.conflicts.forEach(function (p) { w.index[p] = oursFiles[p]; });

      return ok(paused,
        'Auto-merging ' + merged.conflicts.join(', ') + '\n' +
        merged.conflicts.map(function (p) {
          return 'CONFLICT (content): Merge conflict in ' + p;
        }).join('\n') +
        '\nAutomatic merge failed; fix conflicts and then commit the result.',
        ['work', 'staging'],
        '양쪽이 **같은 줄 자리**를 다르게 고쳤습니다. Git은 어느 쪽이 맞는지 판단하지 않고 ' +
        '**두 내용을 파일 안에 나란히 적어둔 채 멈춥니다.** 실패한 것이 아니라 사람에게 넘긴 것입니다.\n' +
        '파일에 `<<<<<<< HEAD`(내 것) `=======` `>>>>>>> ' + refName + '`(저쪽 것) 표시가 들어가 있습니다. ' +
        '남길 것을 고른 뒤 `git add`로 "정했다"고 알리고, 전부 정하면 `git commit`으로 마무리합니다. ' +
        '되돌리려면 `git merge --abort`입니다.',
        { 충돌: true, 오류이름: 'merge-conflict', 충돌파일: merged.conflicts.slice() });
    }

    const next = clone(state);
    const id = nextId(next);
    next.objects[id] = {
      id: id,
      parents: [oursTip, theirsTip],
      message: "Merge " + refName + " into " + branch,
      files: merged.files,
      n: next.seq
    };
    next.localBranches[branch] = id;
    wt(next).files = clone(merged.files);
    wt(next).index = clone(merged.files);

    return ok(next,
      'Merge made by the \'ort\' strategy.',
      ['work', 'staging', 'local'],
      '양쪽 기록을 모두 남긴 채 **부모가 둘인 새 커밋**을 만들었습니다. 어느 쪽 커밋도 사라지지 않습니다. ' +
      '작업 폴더도 합쳐진 결과로 맞춰졌습니다. GitHub 쪽은 아직 그대로라 push가 따로 필요합니다.');
  }

  /** 진행 중이던 작업을 시작 직전으로 돌려놓는다. merge --abort · rebase --abort 가 함께 쓴다 */
  function abortOngoing(state, 종류) {
    const o = ongoing(state);
    if (!o || o.종류 !== 종류) {
      return fail(state,
        종류 === 'merge'
          ? 'fatal: There is no merge to abort (MERGE_HEAD missing).'
          : 'fatal: No rebase in progress?',
        '지금 진행 중인 ' + (종류 === 'merge' ? '합치기' : '재작성') + '가 없습니다.');
    }

    const next = clone(state);
    const w = wt(next);
    w.files = clone(o.되돌릴상태.files);
    w.index = clone(o.되돌릴상태.index);
    if (o.되돌릴상태.branchTip !== undefined && headBranch(next)) {
      next.localBranches[headBranch(next)] = o.되돌릴상태.branchTip;
    }
    if (o.되돌릴상태.HEAD) w.HEAD = clone(o.되돌릴상태.HEAD);
    w.진행중 = null;

    return ok(next, '', ['work', 'staging', 'local'],
      '시작하기 직전으로 되돌렸습니다. **작업 폴더·스테이징·작업본이 모두 원래대로입니다.** ' +
      '합치기를 그만두는 것은 안전합니다 — 중간에 만들어진 것이 없기 때문입니다.');
  }

  function cmdMerge(state, cmd) {
    const guard = needRepo(state);
    if (guard) return guard;

    if (cmd.flags['--abort']) return abortOngoing(state, 'merge');

    const busy = needNoOngoing(state, '새 합치기');
    if (busy) return busy;

    if (!cmd.args.length) {
      return fail(state, 'fatal: 무엇을 합칠지 적어주세요',
        '예: `git merge origin/main` — `origin/main` 메모에 받아둔 내용을 지금 작업본에 합칩니다.');
    }
    return doMerge(state, cmd.args[0]);
  }

  function cmdPull(state, cmd) {
    const guard = needRepo(state) || needOrigin(state) || needNoOngoing(state, 'pull');
    if (guard) return guard;

    const branch = headBranch(state);
    const track = (branch && state.upstream[branch]) || 'origin/' + branch;

    /* pull 은 한 명령이지만 하는 일은 둘이다. 화면에서도 두 장면으로 나눠 보여준다 —
       이걸 하나로 묶어 보여주면 "pull = 다운로드"라는 오해가 그대로 남는다. */
    const fetched = cmdFetch(state);
    if (!fetched.ok) return fetched;

    const scene1 = {
      제목: '1단계 · fetch — 받아오기',
      output: fetched.output,
      변경영역: fetched.변경영역,
      유지영역: fetched.유지영역,
      설명: fetched.설명
    };

    if (cmd.flags['--ff-only']) {
      const tip = state.localBranches[branch];
      const theirs = resolveRev(fetched.state, track);
      if (tip && theirs && !isAncestor(fetched.state.objects, tip, theirs) &&
          !isAncestor(fetched.state.objects, theirs, tip)) {
        return fail(fetched.state,
          fetched.output + '\nfatal: Not possible to fast-forward, aborting.',
          '양쪽에 서로 다른 커밋이 생겨서 이름표를 앞으로 밀기만 해서는 합쳐지지 않습니다. ' +
          '`--ff-only`는 **새 합치기 커밋을 만들지 않겠다**는 뜻이라 여기서 멈춥니다. ' +
          '`git merge origin/' + branch + '`로 합칠지 결정해주세요.',
          { 오류이름: 'not-fast-forward', 장면: [scene1] });
      }
    }

    const merged = doMerge(fetched.state, track);
    const scene2 = {
      제목: '2단계 · merge — 합치기',
      output: merged.output,
      변경영역: merged.변경영역,
      유지영역: merged.유지영역,
      설명: merged.설명
    };

    const changed = fetched.변경영역.concat(
      merged.변경영역.filter(function (a) { return fetched.변경영역.indexOf(a) === -1; })
    );

    if (!merged.ok) {
      return fail(merged.state, fetched.output + '\n' + merged.output, merged.설명,
        { 오류이름: merged.오류이름, 장면: [scene1, scene2] });
    }

    return ok(merged.state, fetched.output + '\n' + merged.output, changed,
      '`pull`은 한 명령이지만 하는 일은 둘입니다 — **받아오고(fetch), 합칩니다(merge).** ' +
      '위 두 장면이 그 둘입니다. 합치는 단계가 있다는 것을 모르면 예상 못 한 합치기 커밋과 충돌을 만나게 됩니다.',
      { 장면: [scene1, scene2] });
  }

  /* ====================================================================== */
  /*  기록 다시 쓰기 — rebase                                                */
  /* ====================================================================== */

  /* rebase 는 커밋을 "옮기지" 않는다. 같은 변경을 새 바닥 위에 **다시 적어서 새 커밋을 만든다.**
     그래서 해시가 전부 바뀌고, 이미 push 한 것을 rebase 하면 push 가 거절된다.
     이 실습실이 rebase 를 넣은 이유가 그 장면을 보여주기 위해서다. */

  /** 남은 커밋을 충돌이 날 때까지 계속 새 바닥 위에 다시 적는다 */
  function rebaseApply(state) {
    const next = clone(state);
    const w = wt(next);
    const o = w.진행중;
    const branch = headBranch(next);
    const 옮긴것 = [];

    while (o.남은.length) {
      const id = o.남은[0];
      const c = next.objects[id];
      const parentFiles = commitFiles(next.objects, (c.parents || [])[0]);
      const baseFiles = commitFiles(next.objects, o.대상커밋);

      /* 세 갈래 병합이다. 바닥 = 그 커밋의 원래 부모, 내 쪽 = 새 바닥, 저쪽 = 그 커밋.
         rebase 중에는 "HEAD"가 새 바닥이라 마커의 위아래가 merge 와 반대다. */
      const merged = mergeFiles(parentFiles, baseFiles, c.files, id + ' (' + c.message + ')');

      if (merged.conflicts.length) {
        o.현재 = id;
        o.충돌파일 = merged.conflicts.slice();
        w.files = clone(merged.files);
        w.index = clone(merged.files);
        merged.conflicts.forEach(function (p) { w.index[p] = baseFiles[p]; });
        return { state: next, 충돌: true, 옮긴것: 옮긴것, 멈춘커밋: c };
      }

      const nid = nextId(next);
      next.objects[nid] = {
        id: nid,
        parents: o.대상커밋 ? [o.대상커밋] : [],
        message: c.message,
        files: merged.files,
        n: next.seq
      };
      o.대상커밋 = nid;
      o.남은.shift();
      옮긴것.push({ from: id, to: nid, message: c.message });
    }

    next.localBranches[branch] = o.대상커밋;
    w.files = commitFiles(next.objects, o.대상커밋);
    w.index = clone(w.files);
    w.진행중 = null;
    return { state: next, 충돌: false, 옮긴것: 옮긴것 };
  }

  function rebaseResult(state, r, 앞말) {
    const o = wt(r.state).진행중;
    const 바뀐이름 = r.옮긴것.map(function (m) { return m.from + ' → ' + m.to; }).join(', ');

    if (r.충돌) {
      return ok(r.state,
        (앞말 || '') +
        r.옮긴것.map(function (m) { return 'Applied: ' + m.message; }).join('\n') +
        (r.옮긴것.length ? '\n' : '') +
        'Auto-merging ' + o.충돌파일.join(', ') + '\n' +
        o.충돌파일.map(function (p) { return 'CONFLICT (content): Merge conflict in ' + p; }).join('\n') +
        '\nerror: could not apply ' + r.멈춘커밋.id + '... ' + r.멈춘커밋.message + '\n' +
        'hint: Resolve all conflicts manually, mark them as resolved with\n' +
        'hint: "git add", then run "git rebase --continue".',
        ['work', 'staging'],
        '`' + r.멈춘커밋.message + '` 커밋을 새 바닥 위에 다시 적다가 **같은 줄 자리에서 부딪혔습니다.** ' +
        'rebase는 커밋을 **하나씩** 옮기므로 충돌도 커밋마다 따로 납니다. ' +
        '고른 뒤 `git add`로 표시하고 `git rebase --continue`로 다음 커밋을 이어서 옮깁니다. ' +
        '그만두려면 `git rebase --abort`입니다.',
        { 충돌: true, 오류이름: 'rebase-conflict' });
    }

    return ok(r.state,
      (앞말 || '') + 'Successfully rebased and updated refs/heads/' + headBranch(r.state) + '.',
      ['work', 'staging', 'local'],
      '내 커밋들을 **새 바닥 위에 다시 적었습니다**(' + (바뀐이름 || '옮긴 것 없음') + '). ' +
      '옮긴 것이 아니라 다시 적은 것이라 **커밋 id가 전부 바뀌었습니다.** ' +
      '기록이 한 줄로 깔끔해지는 대신, 이미 GitHub에 올렸던 커밋이라면 저쪽 것과 달라져서 ' +
      '`git push`가 거절됩니다. 그때 `--force`로 미는 것이 위험한 이유는, 그 사이 동료가 받아간 커밋이 ' +
      '**사라지기 때문**입니다.');
  }

  function cmdRebase(state, cmd) {
    const guard = needRepo(state);
    if (guard) return guard;

    if (cmd.flags['--abort']) return abortOngoing(state, 'rebase');

    const o = ongoing(state);

    if (cmd.flags['--continue'] || cmd.flags['--skip']) {
      if (!o || o.종류 !== 'rebase') {
        return fail(state, 'fatal: No rebase in progress?', '진행 중인 rebase가 없습니다.');
      }
      if (cmd.flags['--continue'] && o.충돌파일.length) {
        return fail(state,
          'error: you have unstaged changes.\n' +
          'error: Please resolve all conflicts and mark them as resolved with "git add".',
          '아직 정하지 않은 파일이 ' + o.충돌파일.length + '개 남아 있습니다. ' +
          '고른 뒤 `git add`로 표시해야 이어서 옮길 수 있습니다.',
          { 오류이름: 'unmerged-files' });
      }

      const next = clone(state);
      const w = wt(next);
      const n = w.진행중;

      if (cmd.flags['--skip']) {
        const 버린 = n.남은.shift();
        w.files = commitFiles(next.objects, n.대상커밋);
        w.index = clone(w.files);
        n.충돌파일 = [];
        return rebaseResult(next, rebaseApply(next),
          'Skipped ' + 버린 + '\n');
      }

      /* 사람이 고른 결과를 그 커밋의 새 내용으로 삼는다 */
      const id = n.남은.shift();
      const nid = nextId(next);
      next.objects[nid] = {
        id: nid,
        parents: n.대상커밋 ? [n.대상커밋] : [],
        message: next.objects[id].message,
        files: clone(w.index),
        n: next.seq
      };
      n.대상커밋 = nid;
      n.충돌파일 = [];
      return rebaseResult(next, rebaseApply(next), 'Applied: ' + next.objects[nid].message + '\n');
    }

    const busy = needNoOngoing(state, 'rebase');
    if (busy) return busy;

    const branch = headBranch(state);
    if (!branch) {
      return fail(state, 'fatal: 지금 작업본 위에 있지 않습니다', '`git switch main`으로 옮긴 뒤 다시 시도해주세요.');
    }
    if (!cmd.args.length) {
      return fail(state, 'usage: git rebase <upstream>',
        '어느 바닥 위에 다시 적을지 적어주세요. 예: `git rebase origin/main`');
    }

    const upstream = resolveRev(state, cmd.args[0]);
    if (!upstream) {
      return fail(state, "fatal: invalid upstream '" + cmd.args[0] + "'",
        '`' + cmd.args[0] + '`라는 이름을 찾지 못했습니다.');
    }

    const tip = state.localBranches[branch];
    if (isAncestor(state.objects, upstream, tip)) {
      return ok(state, 'Current branch ' + branch + ' is up to date.', [],
        '이미 그 바닥 위에 있습니다. 다시 적을 것이 없습니다.');
    }

    const c = classify(state);
    if (c.staged.length || c.notStaged.length) {
      return fail(state,
        'error: cannot rebase: You have unstaged changes.\nerror: Please commit or stash them.',
        'rebase는 커밋을 다시 적는 명령이라 깨끗한 상태에서 시작해야 합니다. ' +
        '먼저 `git commit`하거나 `git stash`로 치워두세요.',
        { 오류이름: 'local-changes-overwritten' });
    }

    /* 내 것이지만 저쪽에는 없는 커밋들. 오래된 것부터 하나씩 다시 적는다. */
    const upstreamSet = ancestorSet(state.objects, upstream);
    const mine = Object.keys(ancestorSet(state.objects, tip))
      .filter(function (id) { return !upstreamSet[id]; })
      .map(function (id) { return state.objects[id]; })
      .sort(function (a, b) { return a.n - b.n; });

    if (!mine.length) {
      return ok(state, 'Current branch ' + branch + ' is up to date.', [],
        '다시 적을 내 커밋이 없습니다.');
    }

    const next = clone(state);
    const w = wt(next);
    w.진행중 = {
      종류: 'rebase',
      대상: cmd.args[0],
      대상커밋: upstream,
      남은: mine.map(function (m) { return m.id; }),
      현재: null,
      충돌파일: [],
      되돌릴상태: {
        files: clone(w.files), index: clone(w.index),
        HEAD: clone(w.HEAD), branchTip: tip
      }
    };

    return rebaseResult(next, rebaseApply(next),
      'Rebasing (' + mine.length + ' commit(s)) onto ' + upstream + '\n');
  }

  /* ====================================================================== */
  /*  되돌리기 — reset / revert                                              */
  /* ====================================================================== */

  function cmdReset(state, cmd) {
    const guard = needRepo(state) || needNoOngoing(state, 'reset');
    if (guard) return guard;

    const mode = cmd.flags['--soft'] ? 'soft' : cmd.flags['--hard'] ? 'hard' : 'mixed';
    const branch = headBranch(state);
    if (!branch) {
      return fail(state, 'fatal: 지금 작업본 위에 있지 않습니다', '`git switch main`으로 옮긴 뒤 다시 시도해주세요.');
    }

    const refName = cmd.args[0] || 'HEAD';
    const target = resolveRev(state, refName);
    if (!target) {
      return fail(state, "fatal: ambiguous argument '" + refName + "': unknown revision",
        '`' + refName + '`라는 커밋을 찾지 못했습니다. `git log --oneline`으로 id를 확인해보세요.');
    }

    const targetFiles = commitFiles(state.objects, target);
    const next = clone(state);
    next.localBranches[branch] = target;

    if (mode === 'soft') {
      return ok(next, '', ['local'],
        '이름표만 `' + target + '`으로 옮겼습니다. **스테이징과 작업 폴더는 손대지 않아서**, 되돌린 커밋의 내용이 스테이징에 그대로 남아 있습니다. ' +
        '다시 커밋하면 하나로 합쳐집니다.');
    }
    if (mode === 'mixed') {
      wt(next).index = clone(targetFiles);
      return ok(next, '', ['local', 'staging'],
        '이름표를 옮기고 **스테이징도 그 시점으로 맞췄습니다.** 작업 폴더의 파일 내용은 그대로라 ' +
        '변경 내용은 살아 있고, 다시 `git add`부터 하면 됩니다.');
    }

    wt(next).index = clone(targetFiles);
    wt(next).files = clone(targetFiles);
    return ok(next, 'HEAD is now at ' + target + ' ' + (state.objects[target] ? state.objects[target].message : ''),
      ['work', 'staging', 'local'],
      '**세 칸을 모두 `' + target + '` 시점으로 덮었습니다.** 커밋하지 않았던 편집은 되돌릴 방법이 없습니다. ' +
      '`--hard`가 위험한 명령으로 분류되는 이유입니다.');
  }

  function cmdRevert(state, cmd) {
    const guard = needRepo(state) || needNoOngoing(state, 'revert');
    if (guard) return guard;

    const branch = headBranch(state);
    if (!branch) {
      return fail(state, 'fatal: 지금 작업본 위에 있지 않습니다', '`git switch main`으로 옮긴 뒤 다시 시도해주세요.');
    }
    if (!cmd.args.length) {
      return fail(state, 'usage: git revert <commit>',
        '어느 커밋을 되돌릴지 적어주세요. `git log --oneline`에서 id를 볼 수 있습니다.');
    }

    const target = resolveRev(state, cmd.args[0]);
    if (!target || !state.objects[target]) {
      return fail(state, "fatal: bad revision '" + cmd.args[0] + "'",
        '`' + cmd.args[0] + '`라는 커밋을 찾지 못했습니다.');
    }

    const tip = state.localBranches[branch];
    const c = classify(state);
    if (c.staged.length || c.notStaged.length) {
      return fail(state, 'error: your local changes would be overwritten by revert.\nfatal: revert failed',
        '커밋하지 않은 변경이 남아 있습니다. revert는 새 커밋을 만드는 명령이라 깨끗한 상태에서 시작해야 합니다.',
        { 오류이름: 'local-changes-overwritten' });
    }

    /* 되돌린다는 것은 "그 커밋이 만든 차이의 반대"를 지금 상태에 적용하는 것이다.
       그 커밋 시점으로 돌아가는 것이 아니다 — 그건 reset 이다. */
    const targetFiles = commitFiles(state.objects, target);
    const parentFiles = commitFiles(state.objects, (state.objects[target].parents || [])[0]);
    const current = commitFiles(state.objects, tip);
    const undone = mergeFiles(targetFiles, current, parentFiles);

    if (undone.conflicts.length) {
      return fail(state,
        'error: could not revert ' + target + '\n' +
        undone.conflicts.map(function (p) { return 'CONFLICT (content): Merge conflict in ' + p; }).join('\n'),
        '되돌리려는 커밋이 건드린 파일을 그 뒤에 또 고쳤습니다. 어느 쪽을 남길지 사람이 골라야 하는데, ' +
        '충돌 해결은 아직 이 실습실에서 다루지 않아 상태를 바꾸지 않았습니다.',
        { 오류이름: 'revert-conflict' });
    }

    const next = clone(state);
    const id = nextId(next);
    next.objects[id] = {
      id: id,
      parents: [tip],
      message: 'Revert "' + state.objects[target].message + '"',
      files: undone.files,
      n: next.seq
    };
    next.localBranches[branch] = id;
    wt(next).files = clone(undone.files);
    wt(next).index = clone(undone.files);

    return ok(next, '[' + branch + ' ' + id + '] Revert "' + state.objects[target].message + '"',
      ['work', 'staging', 'local'],
      '**기존 커밋을 지우지 않고, 그 변경을 취소하는 새 커밋을 하나 더 만들었습니다.** ' +
      '기록이 그대로 남아 있어서 이미 공유한 커밋에도 안전하게 쓸 수 있습니다. 이 점이 `reset`과 다릅니다.');
  }

  /* ====================================================================== */
  /*  작업 공간 — worktree                                                   */
  /* ====================================================================== */

  /* worktree 가 가르치는 것은 딱 하나다.
     **기록함(.git)은 하나인데 작업 폴더는 여러 개일 수 있다.**
     그래서 커밋·작업본·서랍은 전부 공유되고, 작업 폴더·스테이징·HEAD 만 각자 갖는다.
     상태 모양이 이미 그렇게 나뉘어 있어서(§ emptyState) 명령은 그 위에 얹기만 하면 된다. */

  /** 어느 작업 공간이 이 작업본을 쓰고 있는가. 같은 것을 두 군데서 열 수 없다. */
  function worktreeUsing(state, branch) {
    const names = Object.keys(state.worktrees);
    for (let i = 0; i < names.length; i++) {
      const w = state.worktrees[names[i]];
      if (w.HEAD.type === 'branch' && w.HEAD.name === branch) return names[i];
    }
    return null;
  }

  function shortPath(path) {
    const parts = String(path).split('/');
    return parts[parts.length - 1] || path;
  }

  function cmdWorktree(state, cmd) {
    const guard = needRepo(state);
    if (guard) return guard;

    const sub = cmd.args[0];

    if (!sub || sub === 'list') {
      const out = Object.keys(state.worktrees).map(function (name) {
        const w = state.worktrees[name];
        const tip = w.HEAD.type === 'branch'
          ? (state.localBranches[w.HEAD.name] || '(커밋 없음)')
          : w.HEAD.id;
        const label = w.HEAD.type === 'branch' ? '[' + w.HEAD.name + ']' : '(detached HEAD)';
        return name + '  ' + tip + ' ' + label +
          (name === state.현재작업공간 ? '   ← 지금 여기' : '');
      }).join('\n');

      return ok(state, out, [],
        Object.keys(state.worktrees).length > 1
          ? '작업 폴더가 여러 개지만 **기록함(.git)은 하나입니다.** 커밋도 작업본도 서랍도 전부 공유합니다. ' +
            '따로인 것은 작업 폴더·스테이징·지금 보고 있는 작업본, 이 셋뿐입니다.'
          : '아직 작업 공간이 하나뿐입니다. `git worktree add ../연습폴더-hotfix <작업본>`으로 하나 더 만들 수 있습니다.');
    }

    if (sub === 'add') {
      const path = cmd.args[1];
      const 새작업본 = cmd.flags['-b'];
      const branch = 새작업본 || cmd.args[2];

      if (!path || !branch) {
        return fail(state, 'usage: git worktree add <path> <branch>',
          '어디에 만들지와 어느 작업본을 열지 함께 적어주세요. 예: `git worktree add ../연습폴더-hotfix hotfix`');
      }
      if (Object.prototype.hasOwnProperty.call(state.worktrees, path)) {
        return fail(state, "fatal: '" + path + "' already exists",
          '그 경로에 이미 작업 공간이 있습니다.');
      }
      if (새작업본 && Object.prototype.hasOwnProperty.call(state.localBranches, 새작업본)) {
        return fail(state, "fatal: a branch named '" + 새작업본 + "' already exists",
          '같은 이름의 작업본이 이미 있습니다. 그것을 열려면 `-b` 없이 이름만 적어주세요.');
      }
      if (!새작업본 && !Object.prototype.hasOwnProperty.call(state.localBranches, branch)) {
        return fail(state, "fatal: invalid reference: " + branch,
          '`' + branch + '`라는 작업본이 없습니다. 새로 만들면서 열려면 `-b ' + branch + '`입니다.');
      }

      /* 여기가 worktree 의 핵심 안전장치다. 같은 작업본을 두 폴더에서 열면
         한쪽에서 커밋할 때 다른 쪽 작업 폴더가 조용히 어긋난다. */
      const 쓰는곳 = worktreeUsing(state, branch);
      if (쓰는곳) {
        return fail(state,
          "fatal: '" + branch + "' is already checked out at '" + 쓰는곳 + "'",
          '`' + branch + '`은(는) 이미 `' + 쓰는곳 + '`에서 열려 있습니다. ' +
          '**작업본 하나는 한 폴더에서만 열 수 있습니다.** 두 군데서 열면 한쪽에서 커밋할 때 ' +
          '다른 쪽 작업 폴더가 조용히 어긋나기 때문입니다.',
          { 오류이름: 'branch-already-checked-out' });
      }

      const next = clone(state);
      const headId = headCommitId(next);
      if (새작업본) {
        if (!headId) {
          return fail(state, 'fatal: 커밋이 없어 새 작업본을 만들 수 없습니다',
            '작업본은 커밋을 가리키는 이름표라, 가리킬 커밋이 하나는 있어야 합니다.');
        }
        next.localBranches[새작업본] = headId;
      }

      const files = commitFiles(next.objects, next.localBranches[branch]);
      next.worktrees[path] = emptyWorktree(path);
      next.worktrees[path].HEAD = { type: 'branch', name: branch };
      next.worktrees[path].files = clone(files);
      next.worktrees[path].index = clone(files);

      return ok(next,
        'Preparing worktree (' + (새작업본 ? 'new branch ' + 새작업본 : 'checking out ' + branch) + ')\n' +
        'HEAD is now at ' + (next.localBranches[branch] || '(커밋 없음)'),
        새작업본 ? ['local'] : [],
        '작업 폴더를 **하나 더** 만들었습니다. 지금 있던 폴더는 그대로입니다 — ' +
        '`stash`처럼 치웠다 꺼내는 것이 아니라 **두 작업을 동시에 열어두는 것**이 다른 점입니다.\n' +
        '기록함(.git)은 하나라서 여기서 만든 커밋을 저쪽에서도 바로 볼 수 있습니다. ' +
        '위의 작업 공간 탭으로 오갈 수 있습니다.');
    }

    if (sub === 'remove') {
      const path = cmd.args[1];
      if (!Object.prototype.hasOwnProperty.call(state.worktrees, path)) {
        return fail(state, "fatal: '" + path + "' is not a working tree",
          '그 경로에 작업 공간이 없습니다. `git worktree list`로 확인해주세요.');
      }
      if (state.worktrees[path].주작업) {
        return fail(state, "fatal: '" + path + "' is a main working tree",
          '주 작업 폴더는 지울 수 없습니다. 나중에 만든 것만 지울 수 있습니다.');
      }

      const 그쪽 = classify({
        worktrees: state.worktrees, 현재작업공간: path,
        objects: state.objects, localBranches: state.localBranches
      });
      if (!cmd.flags['--force'] && !cmd.flags['-f'] && (그쪽.staged.length || 그쪽.notStaged.length)) {
        return fail(state,
          "fatal: '" + path + "' contains modified or untracked files, use --force to delete it",
          '그 폴더에 아직 커밋하지 않은 변경이 있습니다. 지우면 사라지므로 멈췄습니다. ' +
          '정말 버리려면 `--force`입니다.',
          { 오류이름: 'worktree-dirty' });
      }

      const next = clone(state);
      delete next.worktrees[path];
      if (next.현재작업공간 === path) next.현재작업공간 = MAIN_WORKTREE;

      return ok(next, '', [],
        '작업 폴더 하나를 치웠습니다. **커밋과 작업본은 그대로입니다** — ' +
        '기록함은 공유하고 있어서 폴더를 지워도 기록은 사라지지 않습니다.');
    }

    return fail(state, 'usage: git worktree [list|add|remove]',
      '이 실습실은 `list` · `add` · `remove`를 다룹니다.');
  }

  /** 폴더를 옮겨 다니는 것은 git 명령이 아니라 `cd` 다. 화면의 탭이 부른다. */
  function useWorktree(state, name) {
    if (!Object.prototype.hasOwnProperty.call(state.worktrees, name)) return state;
    const next = clone(state);
    next.현재작업공간 = name;
    return next;
  }

  /* ====================================================================== */
  /*  가상 동료 — GitHub 쪽만 움직인다                                        */
  /* ====================================================================== */

  /**
   * 동료가 GitHub 에 push 한 상황을 만든다.
   * state.github 만 건드린다. 로컬 오브젝트도 origin/main 도 손대지 않는다 —
   * 그게 이 실습실이 보여주려는 장면 자체다.
   */
  function collaboratorPush(state, options) {
    options = options || {};
    const branch = options.branch || 'main';
    const path = options.path || '동료메모.txt';
    const content = options.content || '동료가 쓴 내용';
    const message = options.message || '동료의 작업';

    const next = clone(state);
    const parent = next.github.branches[branch] || null;
    const files = commitFiles(next.github.objects, parent);
    files[path] = content;

    const id = nextId(next);
    next.github.objects[id] = {
      id: id, parents: parent ? [parent] : [], message: message, files: files, n: next.seq
    };
    next.github.branches[branch] = id;
    return next;
  }

  /* ====================================================================== */
  /*  실행 진입점                                                            */
  /* ====================================================================== */

  const TABLE = {
    init: cmdInit,
    status: cmdStatus,
    log: cmdLog,
    diff: cmdDiff,
    add: cmdAdd,
    commit: cmdCommit,
    restore: cmdRestore,
    branch: cmdBranch,
    switch: cmdSwitch,
    remote: cmdRemote,
    fetch: cmdFetch,
    push: cmdPush,
    pull: cmdPull,
    merge: cmdMerge,
    reset: cmdReset,
    revert: cmdRevert,
    stash: cmdStash,
    rebase: cmdRebase,
    worktree: cmdWorktree
  };

  /**
   * @param {Object} state 현재 상태 (변경하지 않는다)
   * @param {string} input 사용자가 친 한 줄
   * @returns {{ok, state, output, 변경영역, 유지영역, 설명}}
   */
  function run(state, input) {
    const parsed = parser.parse(input);

    if (!parsed.ok) {
      return fail(state, '', parsed.message, { 파싱실패: parsed.reason });
    }
    const handler = TABLE[parsed.name];
    if (!handler) {
      return fail(state, '',
        '`git ' + parsed.name + '`은 아직 실습실에서 실행할 수 없습니다. 명령어 사전에서 설명은 볼 수 있습니다.',
        { 파싱실패: 'not-implemented' });
    }
    return handler(state, parsed);
  }

  /* ------------------------- 작업 폴더 조작 (화면용) ------------------------- */

  function editFile(state, path, content) {
    const next = clone(state);
    wt(next).files[path] = content;
    return next;
  }

  function removeFile(state, path) {
    const next = clone(state);
    delete wt(next).files[path];
    return next;
  }

  return {
    AREAS: AREAS,
    MAIN_WORKTREE: MAIN_WORKTREE,
    emptyState: emptyState,
    emptyWorktree: emptyWorktree,
    /* 화면과 테스트도 이 통로로만 작업 폴더에 닿는다.
       state.files 를 직접 읽던 코드가 남아 있으면 작업 공간이 둘일 때 조용히 틀린 것을 본다. */
    worktree: wt,
    clone: clone,
    run: run,
    editFile: editFile,
    removeFile: removeFile,
    collaboratorPush: collaboratorPush,
    useWorktree: useWorktree,
    worktreeUsing: worktreeUsing,
    shortPath: shortPath,

    // 시나리오 정의와 화면 렌더가 쓰는 조회 함수
    headBranch: headBranch,
    headCommitId: headCommitId,
    commitFiles: commitFiles,
    history: history,
    ancestorSet: ancestorSet,
    isAncestor: isAncestor,
    aheadBehind: aheadBehind,
    copyObjects: copyObjects,
    classify: classify,
    refsAt: refsAt,
    ongoing: ongoing,
    conflictPaths: conflictPaths,
    hasConflictMarkers: hasConflictMarkers,
    chooseSide: chooseSide,
    nextId: nextId,
    resolveRev: resolveRev,
    mergeBase: mergeBase
  };
});
