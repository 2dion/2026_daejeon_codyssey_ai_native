/* ==========================================================================
   engine.test.js — 상태 엔진 회귀 테스트

     node --test tests/

   의존성이 없다. package.json 도 필요 없다 (node 내장 test runner + CommonJS).
   이 폴더는 .vercelignore 에 있어 배포에는 올라가지 않는다.

   README §2(5칸 모델)와 §13(실습실)에 적어둔 약속을 그대로 옮긴 것이 많다.
   문서에 쓴 말이 코드에서 깨지면 여기서 먼저 걸린다.
   ========================================================================== */

const test = require('node:test');
const assert = require('node:assert');

const git = require('../js/sim/engine.js');
const parser = require('../js/sim/parser.js');
const wt = git.worktree;

/* ------------------------------ 도우미 ------------------------------ */

/** 명령을 차례로 실행한다. 중간에 실패하면 어디서 실패했는지 붙여서 알려준다. */
function seq(state, lines) {
  let s = state;
  const results = [];
  lines.forEach(function (line) {
    const r = git.run(s, line);
    results.push(r);
    if (!r.ok) {
      throw new Error('예상치 못한 실패: ' + line + '\n' + r.output + '\n' + r.설명);
    }
    s = r.state;
  });
  return { state: s, results: results };
}

/** 초기화 + 파일 하나가 있는 상태 */
function withRepo() {
  let s = git.emptyState();
  s = git.editFile(s, 'memo.txt', '메모 1');
  return git.run(s, 'git init').state;
}

/** 첫 커밋을 GitHub 에 올려둔 상태 — 원격 관련 테스트의 공통 출발점 */
function withRemote() {
  return seq(withRepo(), [
    'git add .',
    'git commit -m "첫 버전"',
    'git remote add origin https://github.com/나/연습.git',
    'git push -u origin main'
  ]).state;
}

/** 작업 폴더를 고치고 커밋까지 한 번에 */
function commitEdit(state, path, content, message) {
  return seq(git.editFile(state, path, content), ['git add .', 'git commit -m "' + message + '"']).state;
}

/* ====================================================================== */
/*  불변식 — 개별 명령보다 먼저 깨지면 안 되는 것                              */
/* ====================================================================== */

test('변경영역과 유지영역은 언제나 5칸을 겹치지 않게 정확히 덮는다', function () {
  const lines = [
    'git init', 'git status', 'git add .', 'git status',
    'git commit -m "첫 버전"', 'git log', 'git diff', 'git diff --staged',
    'git branch feature', 'git switch feature', 'git switch main',
    'git remote add origin https://example.invalid/x.git', 'git remote -v',
    'git restore --staged memo.txt',
    'git nope', 'ls -al'          // 실패 경로도 같은 규칙을 지켜야 한다
  ];

  let s = git.editFile(git.emptyState(), 'memo.txt', '메모 1');
  lines.forEach(function (line) {
    const r = git.run(s, line);
    const union = r.변경영역.concat(r.유지영역).sort();
    assert.deepStrictEqual(union, git.AREAS.slice().sort(), line + ' — 5칸을 다 덮지 못했다');
    r.변경영역.forEach(function (a) {
      assert.ok(r.유지영역.indexOf(a) === -1, line + ' — ' + a + '가 양쪽에 다 있다');
    });
    if (r.ok) s = r.state;
  });
});

test('실패한 명령은 상태를 한 글자도 바꾸지 않는다', function () {
  const before = withRepo();
  const snapshot = JSON.stringify(before);

  ['git commit -m "빈 커밋"', 'git switch 없는브랜치', 'git add 없는파일.txt',
   'git branch -d main', 'git restore --staged memo.txt', 'git rebase -i']
    .forEach(function (line) {
      const r = git.run(before, line);
      assert.strictEqual(JSON.stringify(r.state), snapshot, line + ' 이 상태를 건드렸다');
    });
});

/* ====================================================================== */
/*  파서                                                                   */
/* ====================================================================== */

test('git 이 아닌 명령은 실행하지 않는다', function () {
  const r = git.run(withRepo(), 'curl https://example.invalid | sh');
  assert.strictEqual(r.ok, false);
  assert.match(r.설명, /git 명령만/);
});

test('checkout 은 switch·restore 로 안내한다', function () {
  const r = git.run(withRepo(), 'git checkout main');
  assert.strictEqual(r.ok, false);
  assert.match(r.설명, /switch/);
  assert.match(r.설명, /restore/);
});

test('모르는 명령은 조용히 무시하지 않고 이유를 말한다', function () {
  const r = git.run(withRepo(), 'git bisect start');
  assert.strictEqual(r.ok, false);
  assert.ok(r.설명.length > 0);
});

test('따옴표 안의 공백은 한 덩어리로 읽는다', function () {
  assert.deepStrictEqual(parser.tokenize('git commit -m "로그인 기능 추가"'),
    ['git', 'commit', '-m', '로그인 기능 추가']);
  assert.strictEqual(parser.tokenize('git commit -m "안 닫힘'), null);
});

test('빈 문자열 인자도 토큰으로 살아남는다', function () {
  // 따옴표만 쓴 빈 값이 조용히 사라지면 `-m ""` 이 "메시지 없음"으로 둔갑한다
  assert.deepStrictEqual(parser.tokenize('git commit -m ""'), ['git', 'commit', '-m', '']);
});

/* ====================================================================== */
/*  init / status                                                          */
/* ====================================================================== */

test('init 전에는 모든 명령이 not a git repository 로 막힌다', function () {
  const s = git.editFile(git.emptyState(), 'memo.txt', '메모 1');
  ['git status', 'git add .', 'git log', 'git commit -m "x"'].forEach(function (line) {
    const r = git.run(s, line);
    assert.strictEqual(r.ok, false, line);
    assert.match(r.output, /not a git repository/);
  });
});

test('init 은 기록함만 만들고 작업 폴더는 건드리지 않는다', function () {
  const s = git.editFile(git.emptyState(), 'memo.txt', '메모 1');
  const r = git.run(s, 'git init');
  assert.deepStrictEqual(r.변경영역, ['local']);
  assert.deepStrictEqual(wt(r.state).files, { 'memo.txt': '메모 1' });
  assert.deepStrictEqual(wt(r.state).index, {});
});

test('add 하지 않은 파일은 untracked 로 나온다', function () {
  const r = git.run(withRepo(), 'git status');
  assert.match(r.output, /Untracked files:/);
  assert.match(r.output, /memo\.txt/);
});

/* ====================================================================== */
/*  add / commit — 세 칸이 서로 다른 버전을 가질 수 있는가                     */
/* ====================================================================== */

test('add 후 작업 폴더를 또 고치면 두 칸이 서로 다른 버전을 갖는다', function () {
  let s = seq(withRepo(), ['git add memo.txt']).state;
  s = git.editFile(s, 'memo.txt', '메모 2');

  assert.strictEqual(wt(s).index['memo.txt'], '메모 1', '스테이징은 add 하던 시점의 내용이어야 한다');
  assert.strictEqual(wt(s).files['memo.txt'], '메모 2', '작업 폴더는 최신 편집이어야 한다');

  const st = git.run(s, 'git status');
  assert.match(st.output, /Changes to be committed:/);
  assert.match(st.output, /Changes not staged for commit:/);
});

test('commit 은 스테이징에 있던 것만 남긴다', function () {
  let s = seq(withRepo(), ['git add memo.txt']).state;
  s = git.editFile(s, 'memo.txt', '메모 2');           // add 뒤의 편집은 들어가면 안 된다
  const r = git.run(s, 'git commit -m "첫 버전"');

  assert.ok(r.ok);
  assert.deepStrictEqual(r.변경영역, ['local']);
  const tip = r.state.localBranches.main;
  assert.strictEqual(r.state.objects[tip].files['memo.txt'], '메모 1');
  assert.strictEqual(wt(r.state).files['memo.txt'], '메모 2', 'commit 이 작업 폴더를 건드렸다');
});

test('add 하지 않고 commit 하면 거절하고 이유를 말한다', function () {
  const r = git.run(withRepo(), 'git commit -m "첫 버전"');
  assert.strictEqual(r.ok, false);
  assert.match(r.설명, /git add/);
});

test('메시지 없는 commit 은 거절한다', function () {
  const s = seq(withRepo(), ['git add .']).state;
  const r = git.run(s, 'git commit');
  assert.strictEqual(r.ok, false);
  assert.match(r.설명, /메시지/);
});

test('커밋 id 는 결정론적이다 — 같은 순서면 같은 id 가 나온다', function () {
  function build() {
    return seq(withRepo(), ['git add .', 'git commit -m "첫 버전"']).state.localBranches.main;
  }
  assert.strictEqual(build(), build());
  assert.match(build(), /^[0-9a-f]{7}$/);
});

/* ====================================================================== */
/*  restore — 이 서비스가 가장 많이 설명하는 구분                             */
/* ====================================================================== */

test('restore --staged 는 스테이징만 내리고 작업 폴더 편집은 살려둔다', function () {
  let s = seq(withRepo(), ['git add .', 'git commit -m "첫 버전"']).state;
  s = git.editFile(s, 'memo.txt', '메모 2');
  s = seq(s, ['git add memo.txt']).state;

  const r = git.run(s, 'git restore --staged memo.txt');
  assert.ok(r.ok);
  assert.deepStrictEqual(r.변경영역, ['staging']);
  assert.strictEqual(wt(r.state).index['memo.txt'], '메모 1', '스테이징은 마지막 버전으로 돌아가야 한다');
  assert.strictEqual(wt(r.state).files['memo.txt'], '메모 2', '작업 폴더 편집이 사라졌다');
});

test('restore 는 작업 폴더만 되돌리고 스테이징·커밋은 그대로 둔다', function () {
  let s = seq(withRepo(), ['git add .', 'git commit -m "첫 버전"']).state;
  const tipBefore = s.localBranches.main;
  s = git.editFile(s, 'memo.txt', '메모 2');

  const r = git.run(s, 'git restore memo.txt');
  assert.ok(r.ok);
  assert.deepStrictEqual(r.변경영역, ['work']);
  assert.strictEqual(wt(r.state).files['memo.txt'], '메모 1');
  assert.strictEqual(r.state.localBranches.main, tipBefore);
});

test('Git 이 한 번도 본 적 없는 파일은 restore 할 수 없다', function () {
  let s = withRepo();
  s = git.editFile(s, '새파일.txt', 'x');
  const r = git.run(s, 'git restore 새파일.txt');
  assert.strictEqual(r.ok, false);
  assert.match(r.설명, /git add/);
});

/* ====================================================================== */
/*  branch / switch                                                        */
/* ====================================================================== */

test('branch 는 이름표만 만들고 옮겨가지는 않는다', function () {
  const s = seq(withRepo(), ['git add .', 'git commit -m "첫 버전"', 'git branch feature']).state;
  assert.strictEqual(s.localBranches.feature, s.localBranches.main);
  assert.strictEqual(git.headBranch(s), 'main');
});

test('switch -c 는 만들면서 옮겨가고, 작업 폴더는 그대로다', function () {
  const s0 = seq(withRepo(), ['git add .', 'git commit -m "첫 버전"']).state;
  const r = git.run(s0, 'git switch -c feature');
  assert.strictEqual(git.headBranch(r.state), 'feature');
  assert.deepStrictEqual(wt(r.state).files, wt(s0).files);
  assert.deepStrictEqual(wt(r.state).index, wt(s0).index);
});

test('지금 올라가 있는 작업본은 지울 수 없다', function () {
  const s = seq(withRepo(), ['git add .', 'git commit -m "첫 버전"']).state;
  const r = git.run(s, 'git branch -d main');
  assert.strictEqual(r.ok, false);
  assert.match(r.output, /cannot delete branch/);
});

test('커밋하지 않은 변경을 덮어쓰게 되는 switch 는 거절하고 아무것도 바꾸지 않는다', function () {
  // main 과 feature 가 같은 파일을 서로 다르게 갖게 만든다
  let s = seq(withRepo(), ['git add .', 'git commit -m "첫 버전"', 'git switch -c feature']).state;
  s = git.editFile(s, 'memo.txt', 'feature 쪽 내용');
  s = seq(s, ['git add .', 'git commit -m "feature 버전"', 'git switch main']).state;

  // main 에서 같은 파일을 고쳐 두고 feature 로 가려 한다
  s = git.editFile(s, 'memo.txt', '아직 저장 안 한 편집');
  const snapshot = JSON.stringify(s);

  const r = git.run(s, 'git switch feature');
  assert.strictEqual(r.ok, false);
  assert.match(r.output, /would be overwritten/);
  assert.strictEqual(r.오류이름, 'local-changes-overwritten');
  assert.strictEqual(JSON.stringify(r.state), snapshot, '거절했는데 상태가 바뀌었다');
});

test('깨끗한 상태의 switch 는 작업 폴더를 그 작업본의 마지막 버전으로 맞춘다', function () {
  let s = seq(withRepo(), ['git add .', 'git commit -m "첫 버전"', 'git switch -c feature']).state;
  s = git.editFile(s, 'memo.txt', 'feature 쪽 내용');
  s = seq(s, ['git add .', 'git commit -m "feature 버전"']).state;

  const r = git.run(s, 'git switch main');
  assert.ok(r.ok);
  assert.strictEqual(wt(r.state).files['memo.txt'], '메모 1');
  assert.deepStrictEqual(r.변경영역.sort(), ['local', 'staging', 'work']);
});

/* ====================================================================== */
/*  remote — 5칸 어느 것도 바꾸지 않는다는 것이 요점                          */
/* ====================================================================== */

test('remote add 는 별명만 붙일 뿐 5칸을 하나도 바꾸지 않는다', function () {
  const r = git.run(withRepo(), 'git remote add origin https://example.invalid/x.git');
  assert.ok(r.ok);
  assert.deepStrictEqual(r.변경영역, []);
  assert.strictEqual(r.state.remotes.origin, 'https://example.invalid/x.git');
});

test('같은 별명을 다시 붙이면 remote origin already exists', function () {
  const s = git.run(withRepo(), 'git remote add origin https://example.invalid/x.git').state;
  const r = git.run(s, 'git remote add origin https://example.invalid/y.git');
  assert.strictEqual(r.ok, false);
  assert.match(r.output, /already exists/);
  assert.strictEqual(r.오류이름, 'remote-already-exists');
});

/* ====================================================================== */
/*  log / diff                                                             */
/* ====================================================================== */

test('log 는 최신 커밋부터 보여주고 이름표를 붙인다', function () {
  let s = seq(withRepo(), ['git add .', 'git commit -m "첫 버전"']).state;
  s = git.editFile(s, 'memo.txt', '메모 2');
  s = seq(s, ['git add .', 'git commit -m "두 번째 버전"']).state;

  const r = git.run(s, 'git log --oneline');
  const lines = r.output.trim().split('\n');
  assert.strictEqual(lines.length, 2);
  assert.match(lines[0], /두 번째 버전/);
  assert.match(lines[0], /HEAD -> main/);
  assert.match(lines[1], /첫 버전/);
});

/* ====================================================================== */
/*  경계 — 이 실습실이 존재하는 이유                                          */
/* ====================================================================== */

test('동료가 GitHub 에 push 해도 내 origin/main 은 움직이지 않는다', function () {
  const before = withRemote();
  const tracked = before.remoteTracking['origin/main'].tip;

  const after = git.collaboratorPush(before, { message: '동료의 작업' });

  assert.notStrictEqual(after.github.branches.main, before.github.branches.main, 'GitHub 은 움직여야 한다');
  assert.strictEqual(after.remoteTracking['origin/main'].tip, tracked, 'origin/main 이 따라 움직였다');
  assert.deepStrictEqual(after.localBranches, before.localBranches);
  assert.deepStrictEqual(after.files, before.files);
});

test('fetch 하기 전에는 log 에 동료 커밋이 보이지 않는다', function () {
  const s = git.collaboratorPush(withRemote(), { message: '동료의 작업' });

  const before = git.run(s, 'git log --oneline --all');
  assert.doesNotMatch(before.output, /동료의 작업/);
  assert.match(before.설명, /fetch/);

  const after = git.run(git.run(s, 'git fetch').state, 'git log --oneline --all');
  assert.match(after.output, /동료의 작업/);
});

test('fetch 는 origin/main 만 갱신하고 작업 폴더와 로컬 main 은 그대로 둔다', function () {
  const s = git.collaboratorPush(withRemote(), { message: '동료의 작업' });
  const r = git.run(s, 'git fetch');

  assert.ok(r.ok);
  assert.deepStrictEqual(r.변경영역, ['origin-tracking']);
  assert.deepStrictEqual(r.유지영역.sort(), ['local', 'remote', 'staging', 'work']);

  assert.strictEqual(r.state.remoteTracking['origin/main'].tip, s.github.branches.main);
  assert.deepStrictEqual(r.state.localBranches, s.localBranches, '로컬 main 이 움직였다');
  assert.deepStrictEqual(wt(r.state).files, wt(s).files, '작업 폴더가 바뀌었다');
  assert.ok(r.state.remoteTracking['origin/main'].lastFetchedAt > s.remoteTracking['origin/main'].lastFetchedAt);
});

test('원격이 앞선 상태의 push 는 거절되고 로컬도 GitHub 도 바뀌지 않는다', function () {
  let s = git.collaboratorPush(withRemote(), { message: '동료의 작업' });
  s = commitEdit(s, 'memo.txt', '메모 2', '내 작업');
  const snapshot = JSON.stringify(s);

  const r = git.run(s, 'git push');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.오류이름, 'non-fast-forward');
  assert.match(r.output, /\[rejected\]/);
  assert.deepStrictEqual(r.변경영역, []);
  assert.strictEqual(JSON.stringify(r.state), snapshot, '거절했는데 상태가 바뀌었다');
});

test('fetch 만으로는 push 가 열리지 않는다 — 받아오는 것과 합치는 것은 다르다', function () {
  let s = git.collaboratorPush(withRemote(), { message: '동료의 작업' });
  s = commitEdit(s, 'memo.txt', '메모 2', '내 작업');
  s = seq(s, ['git fetch']).state;

  const r = git.run(s, 'git push');
  assert.strictEqual(r.ok, false, 'fetch 했다고 push 가 통과하면 안 된다');
  assert.strictEqual(r.오류이름, 'non-fast-forward');
});

test('fetch → merge → push 순서로는 통과한다', function () {
  let s = git.collaboratorPush(withRemote(), { message: '동료의 작업' });
  s = commitEdit(s, 'memo.txt', '메모 2', '내 작업');

  const done = seq(s, ['git fetch', 'git merge origin/main', 'git push']);
  const tip = done.state.localBranches.main;

  assert.strictEqual(done.state.github.branches.main, tip);
  assert.strictEqual(done.state.remoteTracking['origin/main'].tip, tip);
  assert.strictEqual(done.state.objects[tip].parents.length, 2, '합치기 커밋의 부모는 둘이어야 한다');
  assert.deepStrictEqual(done.results[2].변경영역.sort(), ['origin-tracking', 'remote']);
});

test('status 가 ahead / behind / diverged 를 구분해 말한다', function () {
  let s = withRemote();
  assert.match(git.run(s, 'git status').output, /up to date with 'origin\/main'/);

  s = commitEdit(s, 'memo.txt', '메모 2', '내 작업');
  assert.match(git.run(s, 'git status').output, /ahead of 'origin\/main' by 1/);

  s = seq(git.collaboratorPush(s, { message: '동료의 작업' }), ['git fetch']).state;
  assert.match(git.run(s, 'git status').output, /have diverged/);
});

test('커밋이 없는 작업본을 push 하면 src refspec 오류가 난다', function () {
  const s = seq(withRepo(), ['git remote add origin https://github.com/나/연습.git']).state;
  const r = git.run(s, 'git push -u origin main');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.오류이름, 'src-refspec-no-match');
  assert.match(r.output, /src refspec main does not match any/);
});

test('upstream 을 정하지 않은 채 git push 만 치면 안내한다', function () {
  let s = seq(withRepo(), [
    'git add .', 'git commit -m "첫 버전"',
    'git remote add origin https://github.com/나/연습.git'
  ]).state;
  const r = git.run(s, 'git push');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.오류이름, 'no-upstream');
  assert.match(r.output, /--set-upstream/);
});

test('remote 를 연결하지 않고 fetch 하면 그 사실부터 알려준다', function () {
  const r = git.run(seq(withRepo(), ['git add .', 'git commit -m "첫 버전"']).state, 'git fetch');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.오류이름, 'no-remote');
});

/* ------------------------------- pull ------------------------------- */

test('pull 은 fetch 와 merge 두 장면으로 나뉘어 돌아온다', function () {
  let s = git.collaboratorPush(withRemote(), { message: '동료의 작업' });
  s = commitEdit(s, 'memo.txt', '메모 2', '내 작업');

  const r = git.run(s, 'git pull');
  assert.ok(r.ok);
  assert.strictEqual(r.장면.length, 2);
  assert.match(r.장면[0].제목, /fetch/);
  assert.match(r.장면[1].제목, /merge/);
  assert.deepStrictEqual(r.장면[0].변경영역, ['origin-tracking']);
  assert.deepStrictEqual(r.장면[1].변경영역.sort(), ['local', 'staging', 'work']);
});

test('갈라진 상태에서 pull --ff-only 는 멈추고 사용자에게 결정을 넘긴다', function () {
  let s = git.collaboratorPush(withRemote(), { message: '동료의 작업' });
  s = commitEdit(s, 'memo.txt', '메모 2', '내 작업');

  const r = git.run(s, 'git pull --ff-only');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.오류이름, 'not-fast-forward');
  assert.match(r.output, /Not possible to fast-forward/);
});

test('내가 만든 커밋이 없으면 pull 은 빨리 감기로 끝난다', function () {
  const s = git.collaboratorPush(withRemote(), { message: '동료의 작업' });
  const r = git.run(s, 'git pull');

  assert.ok(r.ok);
  assert.match(r.장면[1].output, /Fast-forward/);
  assert.strictEqual(r.state.localBranches.main, s.github.branches.main);
  assert.ok(Object.prototype.hasOwnProperty.call(wt(r.state).files, '동료메모.txt'), '작업 폴더에 동료 파일이 와야 한다');
});

/* ====================================================================== */
/*  충돌 해결                                                              */
/* ====================================================================== */

/** 같은 줄을 양쪽이 다르게 고쳐 충돌이 난 상태 */
function conflicted() {
  let s = git.collaboratorPush(withRemote(), {
    path: 'memo.txt', content: '저쪽이 고친 줄', message: '동료의 작업'
  });
  s = commitEdit(s, 'memo.txt', '내가 고친 줄', '내 작업');
  return seq(s, ['git fetch']).state;
}

test('충돌은 실패가 아니라 사람에게 넘기는 것이다 — 마커가 파일에 실제로 써진다', function () {
  const r = git.run(conflicted(), 'git merge origin/main');

  assert.ok(r.ok, '충돌을 실패로 처리하면 안 된다');
  assert.strictEqual(r.충돌, true);
  assert.match(r.output, /CONFLICT \(content\): Merge conflict in memo\.txt/);

  const content = wt(r.state).files['memo.txt'];
  assert.match(content, /^<<<<<<< HEAD$/m);
  assert.match(content, /^=======$/m);
  assert.match(content, /^>>>>>>> origin\/main$/m);
  assert.match(content, /내가 고친 줄/);
  assert.match(content, /저쪽이 고친 줄/);

  assert.deepStrictEqual(git.conflictPaths(r.state), ['memo.txt']);
});

test('충돌 중에는 status 가 Unmerged paths 를 따로 보여준다', function () {
  const s = git.run(conflicted(), 'git merge origin/main').state;
  const out = git.run(s, 'git status').output;

  assert.match(out, /You have unmerged paths/);
  assert.match(out, /Unmerged paths:/);
  assert.match(out, /both modified:\s+memo\.txt/);
  // 아직 커밋할 준비가 됐다고 말하면 안 된다
  assert.doesNotMatch(out, /nothing to commit/);
});

test('충돌이 남아 있으면 커밋을 거절한다', function () {
  const s = git.run(conflicted(), 'git merge origin/main').state;
  const r = git.run(s, 'git commit -m "억지로"');

  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.오류이름, 'unmerged-files');
  assert.match(r.output, /Committing is not possible because you have unmerged files/);
});

test('충돌 중에는 상태를 흔드는 다른 명령을 막는다', function () {
  const s = git.run(conflicted(), 'git merge origin/main').state;
  ['git switch main', 'git pull', 'git reset --hard HEAD', 'git stash'].forEach(function (line) {
    const r = git.run(s, line);
    assert.strictEqual(r.ok, false, line + ' 이 통과했다');
    assert.strictEqual(r.오류이름, 'ongoing-merge', line);
  });
});

test('고르고 → add 로 표시하고 → commit 으로 마무리한다', function () {
  let s = git.run(conflicted(), 'git merge origin/main').state;

  // 사람이 편집기로 하는 일. 화면의 해결 버튼이 이걸 부른다.
  s = git.editFile(s, 'memo.txt', git.chooseSide(wt(s).files['memo.txt'], 'ours'));
  assert.strictEqual(wt(s).files['memo.txt'], '내가 고친 줄');
  assert.ok(!git.hasConflictMarkers(wt(s).files['memo.txt']));

  const added = git.run(s, 'git add memo.txt');
  assert.ok(added.ok);
  assert.deepStrictEqual(git.conflictPaths(added.state), []);
  assert.match(added.설명, /정했다/);

  const done = git.run(added.state, 'git commit');   // 메시지를 안 줘도 된다
  assert.ok(done.ok);
  const tip = done.state.localBranches.main;
  assert.strictEqual(done.state.objects[tip].parents.length, 2, '부모가 둘이어야 한다');
  assert.strictEqual(done.state.objects[tip].files['memo.txt'], '내가 고친 줄');
  assert.strictEqual(git.ongoing(done.state), null, '합치기가 안 끝났다');
});

test('양쪽 다 남기기도 고를 수 있다', function () {
  let s = git.run(conflicted(), 'git merge origin/main').state;
  s = git.editFile(s, 'memo.txt', git.chooseSide(wt(s).files['memo.txt'], 'both'));
  assert.strictEqual(wt(s).files['memo.txt'], '내가 고친 줄\n저쪽이 고친 줄');
});

test('마커를 그대로 둔 채 add 하면 경고한다 — Git 은 확인해주지 않는다', function () {
  const s = git.run(conflicted(), 'git merge origin/main').state;
  const r = git.run(s, 'git add memo.txt');   // 고치지 않고 그냥 add

  assert.ok(r.ok);
  assert.strictEqual(r.충돌, true);
  assert.match(r.설명, /<<<<<<</);
});

test('merge --abort 는 시작 직전으로 정확히 돌려놓는다', function () {
  const before = conflicted();
  const snapshot = JSON.stringify(before);

  let s = git.run(before, 'git merge origin/main').state;
  s = git.editFile(s, 'memo.txt', '엉뚱하게 고쳐놓음');

  const r = git.run(s, 'git merge --abort');
  assert.ok(r.ok);
  assert.strictEqual(git.ongoing(r.state), null);
  assert.strictEqual(JSON.stringify(r.state), snapshot, 'abort 했는데 원래 자리가 아니다');
});

test('합치기가 없는데 abort 하면 그렇다고 말한다', function () {
  const r = git.run(withRemote(), 'git merge --abort');
  assert.strictEqual(r.ok, false);
  assert.match(r.output, /no merge to abort/);
});

/* ====================================================================== */
/*  서랍 — stash                                                           */
/* ====================================================================== */

test('stash 는 작업 폴더와 스테이징만 치우고 커밋 기록은 건드리지 않는다', function () {
  let s = seq(withRepo(), ['git add .', 'git commit -m "첫 버전"']).state;
  const tip = s.localBranches.main;
  s = git.editFile(s, 'memo.txt', '메모 1\n고치던 중');

  const r = git.run(s, 'git stash');
  assert.ok(r.ok);
  assert.deepStrictEqual(r.변경영역.sort(), ['staging', 'work']);
  assert.strictEqual(wt(r.state).files['memo.txt'], '메모 1', '작업 폴더가 안 되돌아갔다');
  assert.strictEqual(r.state.localBranches.main, tip, '커밋 기록이 바뀌었다');
  assert.strictEqual(r.state.stash.length, 1);
});

test('add 한 적 없는 파일은 -u 를 줘야 함께 치워진다', function () {
  let s = seq(withRepo(), ['git add .', 'git commit -m "첫 버전"']).state;
  s = git.editFile(s, 'memo.txt', '메모 1\n고치던 중');
  s = git.editFile(s, '새메모.txt', '아직 add 안 함');

  const 기본 = git.run(s, 'git stash');
  assert.ok(Object.prototype.hasOwnProperty.call(wt(기본.state).files, '새메모.txt'),
    '-u 없이도 untracked 가 치워졌다');
  assert.match(기본.설명, /-u/);

  const 전부 = git.run(s, 'git stash -u');
  assert.ok(!Object.prototype.hasOwnProperty.call(wt(전부.state).files, '새메모.txt'),
    '-u 인데 untracked 가 남았다');
});

test('pop 은 꺼내면서 서랍에서 지우고, apply 는 남겨둔다', function () {
  let s = seq(withRepo(), ['git add .', 'git commit -m "첫 버전"']).state;
  s = git.editFile(s, 'memo.txt', '메모 1\n고치던 중');
  s = seq(s, ['git stash']).state;

  const applied = git.run(s, 'git stash apply');
  assert.strictEqual(wt(applied.state).files['memo.txt'], '메모 1\n고치던 중');
  assert.strictEqual(applied.state.stash.length, 1, 'apply 가 서랍을 비웠다');

  const popped = git.run(s, 'git stash pop');
  assert.strictEqual(wt(popped.state).files['memo.txt'], '메모 1\n고치던 중');
  assert.strictEqual(popped.state.stash.length, 0, 'pop 이 서랍을 안 비웠다');
});

test('치워두면 거절되던 switch 가 통과한다 — 안내가 실제로 통하는 길이어야 한다', function () {
  let s = seq(withRepo(), ['git add .', 'git commit -m "첫 버전"', 'git switch -c feature']).state;
  s = git.editFile(s, 'memo.txt', 'feature 쪽 내용');
  s = seq(s, ['git add .', 'git commit -m "feature 버전"', 'git switch main']).state;
  s = git.editFile(s, 'memo.txt', '아직 저장 안 한 편집');

  const 거절 = git.run(s, 'git switch feature');
  assert.strictEqual(거절.ok, false);
  assert.match(거절.설명, /stash/, '치워두라고 안내하지 않는다');

  const done = seq(s, ['git stash', 'git switch feature']);
  assert.strictEqual(git.headBranch(done.state), 'feature');
});

test('작업 폴더가 지저분하면 pop 하지 않고 멈춘다', function () {
  let s = seq(withRepo(), ['git add .', 'git commit -m "첫 버전"']).state;
  s = git.editFile(s, 'memo.txt', '메모 1\n치워둘 것');
  s = seq(s, ['git stash']).state;
  s = git.editFile(s, 'memo.txt', '메모 1\n새로 고친 것');
  const snapshot = JSON.stringify(s);

  const r = git.run(s, 'git stash pop');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.오류이름, 'stash-dirty');
  assert.strictEqual(JSON.stringify(r.state), snapshot);
});

test('빈 서랍에 넣을 것이 없으면 그렇다고 말한다', function () {
  const s = seq(withRepo(), ['git add .', 'git commit -m "첫 버전"']).state;
  const r = git.run(s, 'git stash');
  assert.strictEqual(r.ok, false);
  assert.match(r.output, /No local changes to save/);
});

/* ====================================================================== */
/*  작업 공간 — worktree                                                   */
/* ====================================================================== */

test('worktree add 는 작업 폴더만 하나 더 만들고 기록함은 공유한다', function () {
  let s = seq(withRepo(), ['git add .', 'git commit -m "첫 버전"', 'git branch hotfix']).state;

  const r = git.run(s, 'git worktree add ../연습폴더-hotfix hotfix');
  assert.ok(r.ok);
  assert.strictEqual(Object.keys(r.state.worktrees).length, 2);

  // 지금 폴더는 그대로다 — stash 처럼 치웠다 꺼내는 것이 아니다
  assert.strictEqual(r.state.현재작업공간, git.MAIN_WORKTREE);
  assert.deepStrictEqual(wt(r.state).files, wt(s).files);

  // 기록함은 공유한다
  assert.strictEqual(r.state.objects, r.state.objects);
  assert.deepStrictEqual(Object.keys(r.state.localBranches).sort(), ['hotfix', 'main']);
});

test('같은 작업본을 두 폴더에서 열 수 없다', function () {
  let s = seq(withRepo(), ['git add .', 'git commit -m "첫 버전"']).state;

  const r = git.run(s, 'git worktree add ../연습폴더-둘째 main');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.오류이름, 'branch-already-checked-out');
  assert.match(r.output, /already checked out at/);
});

test('다른 폴더가 쓰고 있는 작업본으로는 switch 도 못 한다', function () {
  let s = seq(withRepo(), [
    'git add .', 'git commit -m "첫 버전"', 'git branch hotfix',
    'git worktree add ../연습폴더-hotfix hotfix'
  ]).state;

  const r = git.run(s, 'git switch hotfix');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.오류이름, 'branch-already-checked-out');
});

test('한쪽에서 만든 커밋을 다른 쪽에서 바로 볼 수 있다 — 기록함이 하나이기 때문', function () {
  let s = seq(withRepo(), [
    'git add .', 'git commit -m "첫 버전"',
    'git worktree add ../연습폴더-hotfix -b hotfix'
  ]).state;

  // 저쪽 폴더로 옮겨가서 커밋
  s = git.useWorktree(s, '../연습폴더-hotfix');
  s = git.editFile(s, 'hotfix.txt', '급한 수정');
  s = seq(s, ['git add .', 'git commit -m "급한 수정"']).state;
  const hotfixTip = s.localBranches.hotfix;

  // 원래 폴더로 돌아와도 그 커밋이 기록함에 있다
  s = git.useWorktree(s, git.MAIN_WORKTREE);
  assert.ok(s.objects[hotfixTip], '다른 폴더에서 만든 커밋이 안 보인다');
  assert.match(git.run(s, 'git log --oneline --all').output, /급한 수정/);

  // 다만 작업 폴더는 각자다
  assert.ok(!Object.prototype.hasOwnProperty.call(wt(s).files, 'hotfix.txt'),
    '작업 폴더까지 공유되고 있다');
});

test('서랍은 작업 공간이 여러 개여도 하나다', function () {
  let s = seq(withRepo(), [
    'git add .', 'git commit -m "첫 버전"',
    'git worktree add ../연습폴더-hotfix -b hotfix'
  ]).state;

  s = git.editFile(s, 'memo.txt', '메모 1\n여기서 치운다');
  s = seq(s, ['git stash']).state;

  s = git.useWorktree(s, '../연습폴더-hotfix');
  assert.strictEqual(s.stash.length, 1, '저쪽 폴더에서 서랍이 안 보인다');
  assert.match(git.run(s, 'git stash list').output, /stash@\{0\}/);
});

test('주 작업 폴더는 지울 수 없고, 커밋 안 한 변경이 있으면 멈춘다', function () {
  let s = seq(withRepo(), [
    'git add .', 'git commit -m "첫 버전"',
    'git worktree add ../연습폴더-hotfix -b hotfix'
  ]).state;

  const 주작업 = git.run(s, 'git worktree remove ' + git.MAIN_WORKTREE);
  assert.strictEqual(주작업.ok, false);
  assert.match(주작업.output, /main working tree/);

  // 저쪽 폴더를 더럽혀 둔다
  let dirty = git.useWorktree(s, '../연습폴더-hotfix');
  dirty = git.editFile(dirty, 'memo.txt', '고치던 중');
  dirty = git.useWorktree(dirty, git.MAIN_WORKTREE);

  const 거절 = git.run(dirty, 'git worktree remove ../연습폴더-hotfix');
  assert.strictEqual(거절.ok, false);
  assert.strictEqual(거절.오류이름, 'worktree-dirty');

  const 강제 = git.run(dirty, 'git worktree remove ../연습폴더-hotfix --force');
  assert.ok(강제.ok);
  assert.strictEqual(Object.keys(강제.state.worktrees).length, 1);
  assert.ok(강제.state.localBranches.hotfix, '폴더를 지웠다고 작업본까지 사라지면 안 된다');
});

/* ====================================================================== */
/*  기록 다시 쓰기 — rebase                                                */
/* ====================================================================== */

test('rebase 는 커밋을 옮기지 않고 새로 적는다 — id 가 전부 바뀐다', function () {
  let s = git.collaboratorPush(withRemote(), { path: '동료.txt', content: 'x', message: '동료의 작업' });
  s = git.editFile(s, '내파일.txt', '내 파일');
  s = seq(s, ['git add .', 'git commit -m "내 작업"', 'git fetch']).state;
  const before = s.localBranches.main;

  const r = git.run(s, 'git rebase origin/main');
  assert.ok(r.ok);
  assert.notStrictEqual(r.state.localBranches.main, before, 'id 가 그대로다');
  assert.ok(r.state.objects[before], '원래 커밋은 기록함에 남아 있다');

  // 한 줄로 펴졌다 — 합치기 커밋이 없다
  const log = git.run(r.state, 'git log --oneline').output.trim().split('\n');
  assert.strictEqual(log.length, 3);
  assert.strictEqual(r.state.objects[r.state.localBranches.main].parents.length, 1);
});

test('이미 올린 커밋을 rebase 하면 push 가 거절된다 — force 가 위험한 이유', function () {
  // main 은 GitHub 에 올라가 있고, 그 위에서 feature 를 만들어 올려둔다
  let s = seq(withRemote(), ['git switch -c feature']).state;
  s = git.editFile(s, 'feature.js', '기능 코드');
  s = seq(s, ['git add .', 'git commit -m "기능 추가"', 'git push -u origin feature']).state;
  const pushed = s.localBranches.feature;

  // 그사이 main 이 앞으로 나갔다
  s = git.collaboratorPush(s, { branch: 'main', path: '동료.txt', content: 'x', message: '동료의 작업' });
  s = seq(s, ['git fetch']).state;

  const r = git.run(s, 'git rebase origin/main');
  assert.ok(r.ok);
  assert.notStrictEqual(r.state.localBranches.feature, pushed);
  assert.match(r.설명, /force/);

  const push = git.run(r.state, 'git push');
  assert.strictEqual(push.ok, false, '다시 적은 커밋인데 push 가 통과했다');
  assert.strictEqual(push.오류이름, 'non-fast-forward');
});

test('rebase 도 충돌하면 커밋 하나씩 멈춘다', function () {
  let s = git.collaboratorPush(withRemote(), {
    path: 'memo.txt', content: '저쪽이 고친 줄', message: '동료의 작업'
  });
  s = commitEdit(s, 'memo.txt', '내가 고친 줄', '내 작업');
  s = seq(s, ['git fetch']).state;

  const r = git.run(s, 'git rebase origin/main');
  assert.ok(r.ok);
  assert.strictEqual(r.충돌, true);
  assert.strictEqual(r.오류이름, 'rebase-conflict');
  assert.match(r.output, /could not apply/);
  assert.deepStrictEqual(git.conflictPaths(r.state), ['memo.txt']);
  assert.strictEqual(git.ongoing(r.state).종류, 'rebase');

  // 고르고 → add → --continue
  let s2 = git.editFile(r.state, 'memo.txt', git.chooseSide(wt(r.state).files['memo.txt'], 'theirs'));
  s2 = git.run(s2, 'git add memo.txt').state;

  const done = git.run(s2, 'git rebase --continue');
  assert.ok(done.ok);
  assert.strictEqual(git.ongoing(done.state), null);
  assert.match(done.output, /Successfully rebased/);
  assert.strictEqual(wt(done.state).files['memo.txt'], '내가 고친 줄');
});

test('rebase 중에는 commit 대신 --continue 를 쓰라고 안내한다', function () {
  let s = git.collaboratorPush(withRemote(), { path: 'memo.txt', content: '저쪽', message: '동료의 작업' });
  s = commitEdit(s, 'memo.txt', '내쪽', '내 작업');
  s = seq(s, ['git fetch']).state;
  s = git.run(s, 'git rebase origin/main').state;

  const r = git.run(s, 'git commit -m "억지로"');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.오류이름, 'ongoing-rebase');
  assert.match(r.설명, /--continue/);
});

test('rebase --abort 는 시작 직전으로 정확히 돌려놓는다', function () {
  let s = git.collaboratorPush(withRemote(), { path: 'memo.txt', content: '저쪽', message: '동료의 작업' });
  s = commitEdit(s, 'memo.txt', '내쪽', '내 작업');
  s = seq(s, ['git fetch']).state;
  const snapshot = JSON.stringify(s);

  const r = git.run(git.run(s, 'git rebase origin/main').state, 'git rebase --abort');
  assert.ok(r.ok);
  assert.strictEqual(JSON.stringify(r.state), snapshot);
});

test('커밋하지 않은 변경이 있으면 rebase 를 시작하지 않는다', function () {
  let s = git.collaboratorPush(withRemote(), { path: '동료.txt', content: 'x', message: '동료의 작업' });
  s = seq(s, ['git fetch']).state;
  s = git.editFile(s, 'memo.txt', '고치던 중');

  const r = git.run(s, 'git rebase origin/main');
  assert.strictEqual(r.ok, false);
  assert.match(r.설명, /stash/);
});

/* ====================================================================== */
/*  되돌리기                                                               */
/* ====================================================================== */

test('reset 세 모드는 각각 다른 칸까지 되돌린다', function () {
  let base = seq(withRepo(), ['git add .', 'git commit -m "첫 버전"']).state;
  base = commitEdit(base, 'memo.txt', '메모 2', '두 번째 버전');
  const first = base.objects[base.localBranches.main].parents[0];

  const soft = git.run(base, 'git reset --soft HEAD~1');
  assert.deepStrictEqual(soft.변경영역, ['local']);
  assert.strictEqual(soft.state.localBranches.main, first);
  assert.strictEqual(wt(soft.state).index['memo.txt'], '메모 2', 'soft 는 스테이징을 건드리지 않는다');

  const mixed = git.run(base, 'git reset HEAD~1');
  assert.deepStrictEqual(mixed.변경영역.sort(), ['local', 'staging']);
  assert.strictEqual(wt(mixed.state).index['memo.txt'], '메모 1');
  assert.strictEqual(wt(mixed.state).files['memo.txt'], '메모 2', 'mixed 는 작업 폴더를 건드리지 않는다');

  const hard = git.run(base, 'git reset --hard HEAD~1');
  assert.deepStrictEqual(hard.변경영역.sort(), ['local', 'staging', 'work']);
  assert.strictEqual(wt(hard.state).files['memo.txt'], '메모 1', 'hard 는 작업 폴더까지 덮는다');
});

test('revert 는 커밋을 지우지 않고 취소하는 커밋을 하나 더 만든다', function () {
  let s = seq(withRepo(), ['git add .', 'git commit -m "첫 버전"']).state;
  s = commitEdit(s, 'memo.txt', '메모 2', '되돌릴 버전');
  const bad = s.localBranches.main;

  const r = git.run(s, 'git revert ' + bad);
  assert.ok(r.ok);
  assert.ok(r.state.objects[bad], '되돌린 커밋이 기록에서 사라졌다');
  assert.strictEqual(r.state.objects[r.state.localBranches.main].parents[0], bad);
  assert.strictEqual(wt(r.state).files['memo.txt'], '메모 1');
  assert.match(git.run(r.state, 'git log --oneline').output, /Revert/);
});

test('amend 는 커밋을 갈아끼우므로 id 가 바뀐다', function () {
  let s = seq(withRepo(), ['git add .', 'git commit -m "첫 버전"']).state;
  const before = s.localBranches.main;

  s = git.editFile(s, '빠뜨린파일.txt', 'x');
  s = seq(s, ['git add .', 'git commit --amend --no-edit']).state;

  assert.notStrictEqual(s.localBranches.main, before);
  assert.strictEqual(git.history(s.objects, s.localBranches.main).length, 1, '커밋이 하나 더 생겼다');
  assert.strictEqual(s.objects[s.localBranches.main].message, '첫 버전', '--no-edit 인데 메시지가 바뀌었다');
});

/* ====================================================================== */
/*  줄 단위 비교                                                            */
/* ====================================================================== */

test('여러 줄 파일의 diff 는 줄마다 부호가 붙는다', function () {
  let s = git.editFile(git.emptyState(), 'memo.txt', '1번째 줄\n2번째 줄\n3번째 줄');
  s = seq(s, ['git init', 'git add .', 'git commit -m "첫 버전"']).state;
  s = git.editFile(s, 'memo.txt', '1번째 줄\n2번째 줄 고침\n3번째 줄\n4번째 줄');

  const body = git.run(s, 'git diff').output.split('\n').filter(function (l) {
    return l && !/^(diff|---|\+\+\+)/.test(l);
  });

  // 안 바뀐 줄은 공백, 지운 줄은 -, 더한 줄은 + — 부호 없는 줄이 있으면 안 된다
  body.forEach(function (l) {
    assert.match(l[0], /[ +-]/, '부호가 없는 줄: ' + JSON.stringify(l));
  });
  assert.deepStrictEqual(body, [
    ' 1번째 줄', '-2번째 줄', '+2번째 줄 고침', ' 3번째 줄', '+4번째 줄'
  ]);
});

test('한 파일이라도 서로 다른 줄을 고쳤으면 자동으로 합쳐진다', function () {
  // 파일 통째로 비교하면 이것도 충돌이 된다. 줄 단위로 봐야 실제 git 처럼 동작한다.
  let s = git.editFile(git.emptyState(), 'memo.txt', '1번째 줄\n2번째 줄\n3번째 줄');
  s = seq(s, ['git init', 'git add .', 'git commit -m "첫 버전"',
              'git remote add origin https://github.com/나/연습.git',
              'git push -u origin main']).state;

  s = git.collaboratorPush(s, {
    path: 'memo.txt', content: '1번째 줄\n2번째 줄\n3번째 줄 저쪽이 고침', message: '동료의 작업'
  });
  s = git.editFile(s, 'memo.txt', '1번째 줄 내가 고침\n2번째 줄\n3번째 줄');
  s = seq(s, ['git add .', 'git commit -m "내 작업"', 'git fetch']).state;

  const r = git.run(s, 'git merge origin/main');
  assert.ok(r.ok, '서로 다른 줄인데 충돌이 났다');
  assert.strictEqual(wt(r.state).files['memo.txt'],
    '1번째 줄 내가 고침\n2번째 줄\n3번째 줄 저쪽이 고침');
});

test('diff 는 옵션 유무에 따라 다른 두 칸을 비교한다', function () {
  let s = seq(withRepo(), ['git add .', 'git commit -m "첫 버전"']).state;
  s = git.editFile(s, 'memo.txt', '메모 2');
  s = seq(s, ['git add .']).state;
  s = git.editFile(s, 'memo.txt', '메모 3');

  const staged = git.run(s, 'git diff --staged');
  assert.match(staged.output, /-메모 1/);
  assert.match(staged.output, /\+메모 2/);

  const unstaged = git.run(s, 'git diff');
  assert.match(unstaged.output, /-메모 2/);
  assert.match(unstaged.output, /\+메모 3/);
});
