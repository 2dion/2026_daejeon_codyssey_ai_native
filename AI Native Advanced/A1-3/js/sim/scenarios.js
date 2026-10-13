/* ==========================================================================
   scenarios.js — 실습실 시작 상태

   상태를 손으로 적지 않는다. 전부 엔진에 실제 명령을 실행시켜 만든다.
   그래야 "실제로는 나올 수 없는 상태"를 실습실이 보여주는 일이 없다.
   손으로 적은 상태 하나가 틀리면 사용자는 그걸 자기 저장소로 오해한다.

   시나리오 id 는 js/graph-templates.js 의 템플릿 id 와 일부러 같게 맞췄다.
   AI 결과 카드의 "이 상황을 재현하기"가 그 대응표를 탄다.
   ========================================================================== */

(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const git = isNode ? require('./engine.js') : root.CRGit;
  const map = isNode ? require('./scenario-map.js') : root.CRScenarioMap;

  const api = factory(git, map);
  if (isNode) module.exports = api;
  else root.CRScenarios = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (git, map) {
  'use strict';

  const wt = git.worktree;
  const ORIGIN = 'https://github.com/나/연습.git';

  /** 명령을 차례로 실행한다. 시나리오를 만드는 중에 실패하면 그건 버그다. */
  function run(state, lines) {
    let s = state;
    lines.forEach(function (line) {
      const r = git.run(s, line);
      if (!r.ok) throw new Error('시나리오 조립 실패: ' + line + '\n' + r.output);
      s = r.state;
    });
    return s;
  }

  /** 파일 하나짜리 저장소에서 첫 커밋까지 */
  function base() {
    let s = git.editFile(git.emptyState(), 'memo.txt', '메모 1번째 줄');
    return run(s, ['git init', 'git add .', 'git commit -m "첫 버전"']);
  }

  /** 첫 커밋을 GitHub 에 올려둔 상태 */
  function published() {
    return run(base(), [
      'git remote add origin ' + ORIGIN,
      'git push -u origin main'
    ]);
  }

  const LIST = [

    /* ------------------------------------------------------------------ */
    {
      id: 'first-commit',
      제목: '빈 폴더에서 첫 버전 남기기',
      부제: 'init · add · commit 이 각각 어느 칸을 바꾸는지',
      상황: '작업 폴더에 `memo.txt`를 하나 만들어 뒀습니다. 아직 Git 기록함은 없습니다.',
      목표: '`memo.txt`의 첫 버전을 기록함에 남기기',
      힌트: ['git status', 'git init', 'git status', 'git add .', 'git status', 'git commit -m "첫 버전"'],
      검증: function (st) {
        return st.initialized && git.history(st.objects, st.localBranches.main).length === 1;
      },
      build: function () {
        return git.editFile(git.emptyState(), 'memo.txt', '메모 1번째 줄');
      }
    },

    /* ------------------------------------------------------------------ */
    {
      id: 'fetch-updates-origin',
      제목: '동료가 GitHub을 바꿨습니다',
      부제: '내 main · origin/main · GitHub의 main — 세 개가 어떻게 어긋나는지',
      상황: '첫 버전을 GitHub에 올려둔 뒤, **동료가 GitHub에 커밋을 하나 push했습니다.** ' +
            '내 컴퓨터는 아직 그 사실을 모릅니다.',
      목표: '`git fetch` 전후로 세 개의 main이 어떻게 달라지는지 확인하기',
      힌트: ['git log --oneline --all', 'git status', 'git fetch', 'git log --oneline --all', 'git status'],
      검증: function (st) {
        return st.remoteTracking['origin/main'].tip === st.github.branches.main &&
               st.localBranches.main !== st.github.branches.main &&
               wt(st).files['memo.txt'] === '메모 1번째 줄' &&
               !Object.prototype.hasOwnProperty.call(wt(st).files, '동료메모.txt');
      },
      build: function () {
        return git.collaboratorPush(published(), {
          path: '동료메모.txt', content: '동료가 쓴 내용', message: '동료의 작업'
        });
      }
    },

    /* ------------------------------------------------------------------ */
    {
      id: 'non-fast-forward',
      제목: 'push가 거절됐습니다',
      부제: '원격에 내가 모르는 커밋이 있을 때',
      상황: '동료가 GitHub에 커밋을 올린 사이, 나도 내 컴퓨터에서 커밋을 하나 남겼습니다. ' +
            '이 상태로 push하면 거절됩니다.',
      목표: '동료의 커밋을 잃지 않고 내 커밋을 GitHub에 올리기',
      힌트: ['git push', 'git fetch', 'git log --oneline --all', 'git merge origin/main', 'git push'],
      검증: function (st) {
        return st.github.branches.main === st.localBranches.main &&
               st.objects[st.localBranches.main].parents.length === 2;
      },
      build: function () {
        let s = git.collaboratorPush(published(), {
          path: '동료메모.txt', content: '동료가 쓴 내용', message: '동료의 작업'
        });
        s = git.editFile(s, 'memo.txt', '메모 1번째 줄\n메모 2번째 줄');
        return run(s, ['git add .', 'git commit -m "내 작업"']);
      }
    },

    /* ------------------------------------------------------------------ */
    {
      id: 'merge-conflict',
      제목: '충돌이 났습니다',
      부제: '같은 줄을 양쪽이 다르게 고쳤을 때',
      상황: '동료와 내가 `memo.txt`의 **같은 줄**을 다르게 고쳤습니다. ' +
            '합치면 Git이 어느 쪽이 맞는지 판단하지 않고 멈춥니다.',
      목표: '남길 내용을 직접 고르고 합치기를 마무리하기',
      /* 충돌을 푸는 단계는 명령이 아니다 — 편집기로 파일을 고치는 일이다.
         그걸 명령처럼 적으면 "git 명령만 치면 된다"는 잘못된 그림이 남는다. */
      힌트: ['git fetch', 'git merge origin/main', 'git status',
             { 안내: '파일에서 남길 것을 고릅니다 — 위 충돌 상자의 버튼을 누르거나 직접 지웁니다',
               해결: { path: 'memo.txt', side: 'ours' } },
             'git add memo.txt', 'git status', 'git commit'],
      검증: function (st) {
        const tip = st.localBranches.main;
        return git.ongoing(st) === null &&
               st.objects[tip].parents.length === 2 &&
               !git.hasConflictMarkers(git.worktree(st).files['memo.txt']);
      },
      build: function () {
        let s = git.collaboratorPush(published(), {
          path: 'memo.txt', content: '첫 줄은 동료가 이렇게 고쳤습니다', message: '동료의 작업'
        });
        s = git.editFile(s, 'memo.txt', '첫 줄은 내가 이렇게 고쳤습니다');
        return run(s, ['git add .', 'git commit -m "내 작업"']);
      }
    },

    /* ------------------------------------------------------------------ */
    {
      id: 'worktree-parallel',
      제목: '급한 수정이 들어왔는데 하던 작업을 그대로 두고 싶습니다',
      부제: 'stash가 "치웠다 꺼내기"라면 worktree는 "동시에 열어두기"입니다',
      상황: '`memo.txt`를 한창 고치던 중에 급한 수정 요청이 왔습니다. ' +
            '`stash`로 치우면 하던 화면이 사라집니다. 작업 폴더를 **하나 더** 열어봅니다.',
      목표: '작업 폴더를 하나 더 만들고, 원래 폴더의 고치던 내용이 그대로인지 확인하기',
      힌트: ['git status', 'git worktree add ../연습폴더-hotfix -b hotfix', 'git worktree list',
             { 안내: '위 탭에서 `연습폴더-hotfix`로 옮겨갑니다 — 터미널에서는 `cd`이지 git 명령이 아닙니다',
               이동: '../연습폴더-hotfix' },
             'git status', 'git log --oneline',
             { 안내: '탭에서 원래 폴더로 돌아옵니다', 이동: '연습폴더' },
             'git status'],
      검증: function (st) {
        return Object.keys(st.worktrees).length === 2 &&
               !!st.localBranches.hotfix &&
               /한창 고치던 중/.test(wt(st).files['memo.txt']);
      },
      build: function () {
        return git.editFile(published(), 'memo.txt', '메모 1번째 줄\n한창 고치던 중');
      }
    },

    /* ------------------------------------------------------------------ */
    {
      id: 'rebase-rewrites',
      제목: 'rebase — 기록을 한 줄로 만들면 무엇을 내주는가',
      부제: '커밋을 옮기는 것이 아니라 다시 적는 것입니다',
      상황: '`feature` 작업본을 만들어 GitHub에 올려뒀는데, 그사이 `main`이 앞으로 나갔습니다. ' +
            '`merge` 대신 `rebase`로 내 커밋을 `main` 위에 다시 적어봅니다.',
      목표: '기록이 한 줄이 되는 것과, 그 대가로 push가 거절되는 것을 함께 확인하기',
      힌트: ['git log --oneline --all', 'git rebase origin/main', 'git log --oneline --all',
             'git push', 'git status'],
      검증: function (st) {
        const tip = st.localBranches.feature;
        return git.ongoing(st) === null &&
               st.objects[tip].parents.length === 1 &&           // 합치기 커밋이 없다
               tip !== st.github.branches.feature;               // 올렸던 것과 달라졌다
      },
      build: function () {
        let s = run(published(), ['git switch -c feature']);
        s = git.editFile(s, 'feature.js', '새 기능 코드');
        s = run(s, ['git add .', 'git commit -m "기능 추가"', 'git push -u origin feature']);
        s = git.collaboratorPush(s, {
          branch: 'main', path: '동료메모.txt', content: '동료가 쓴 내용', message: '동료의 작업'
        });
        return run(s, ['git fetch']);
      }
    },

    /* ------------------------------------------------------------------ */
    {
      id: 'stash-switch',
      제목: '작업본을 옮겨야 하는데 하던 일이 있습니다',
      부제: '커밋하기는 애매할 때 잠깐 치워두기',
      상황: '`memo.txt`를 고치던 중인데 급하게 `hotfix` 작업본으로 옮겨야 합니다. ' +
            '지금 상태로는 옮기려 하면 거절됩니다.',
      목표: '고치던 내용을 잃지 않고 작업본을 옮겼다가 돌아오기',
      힌트: ['git switch hotfix', 'git stash', 'git switch hotfix', 'git status',
             'git switch main', 'git stash pop', 'git status'],
      검증: function (st) {
        return git.headBranch(st) === 'main' &&
               /한창 고치던 중/.test(wt(st).files['memo.txt']) &&
               st.stash.length === 0;
      },
      build: function () {
        let s = published();
        s = run(s, ['git switch -c hotfix']);
        s = git.editFile(s, 'memo.txt', '핫픽스 쪽 내용');
        s = run(s, ['git add .', 'git commit -m "핫픽스"', 'git switch main']);
        return git.editFile(s, 'memo.txt', '메모 1번째 줄\n한창 고치던 중');
      }
    },

    /* ------------------------------------------------------------------ */
    {
      id: 'amend-add-file',
      제목: '커밋했는데 파일을 빼먹었습니다',
      부제: '커밋을 하나 더 만들지 않고 직전 커밋에 합치기',
      상황: '`첫 버전`을 남겼는데, 같이 들어갔어야 할 `설정.txt`가 빠져 있었습니다. 아직 push하지 않았습니다.',
      목표: '새 커밋을 만들지 않고 직전 커밋에 `설정.txt` 합치기',
      힌트: ['git status', 'git add 설정.txt', 'git commit --amend --no-edit', 'git log --oneline'],
      검증: function (st) {
        const tip = st.localBranches.main;
        return git.history(st.objects, tip).length === 1 &&
               Object.prototype.hasOwnProperty.call(st.objects[tip].files, '설정.txt');
      },
      build: function () {
        return git.editFile(base(), '설정.txt', '설정 내용');
      }
    },

    /* ------------------------------------------------------------------ */
    {
      id: 'amend-message',
      제목: '커밋 메시지를 잘못 썼습니다',
      부제: '직전 커밋의 메시지만 고쳐 쓰기',
      상황: '`기능추가함ㅁ`이라는 메시지로 커밋해버렸습니다. 아직 push하지 않았습니다.',
      목표: '직전 커밋의 메시지를 알아볼 수 있게 고치기',
      힌트: ['git log --oneline', 'git commit --amend -m "로그인 기능 추가"', 'git log --oneline'],
      검증: function (st) {
        const tip = st.localBranches.main;
        return git.history(st.objects, tip).length === 2 &&
               st.objects[tip].message === '로그인 기능 추가';
      },
      build: function () {
        let s = git.editFile(base(), 'login.js', '로그인 코드');
        return run(s, ['git add .', 'git commit -m "기능추가함ㅁ"']);
      }
    },

    /* ------------------------------------------------------------------ */
    {
      id: 'restore-staged',
      제목: 'add를 취소하고 싶습니다',
      부제: '스테이징에서만 내리고 고친 내용은 지키기',
      상황: '`memo.txt`를 고쳐서 `git add`까지 했는데, 이번 버전에는 넣지 않기로 했습니다. ' +
            '**고친 내용 자체는 지우고 싶지 않습니다.**',
      목표: '스테이징에서만 내리고 작업 폴더의 편집은 그대로 두기',
      힌트: ['git status', 'git diff --staged', 'git restore --staged memo.txt', 'git status'],
      검증: function (st) {
        return wt(st).index['memo.txt'] === '메모 1번째 줄' &&
               /실수로 add한 줄/.test(wt(st).files['memo.txt']);
      },
      build: function () {
        let s = git.editFile(base(), 'memo.txt', '메모 1번째 줄\n실수로 add한 줄');
        return run(s, ['git add memo.txt']);
      }
    },

    /* ------------------------------------------------------------------ */
    {
      id: 'restore-worktree',
      제목: '파일 수정을 없던 일로 하고 싶습니다',
      부제: '되돌리면 다시 못 찾는 명령',
      상황: '`memo.txt`를 이것저것 고쳤는데 처음부터 다시 하고 싶습니다. 아직 `add`는 하지 않았습니다.',
      목표: '작업 폴더의 파일을 마지막 버전 상태로 되돌리기',
      힌트: ['git status', 'git diff', 'git restore memo.txt', 'git status'],
      검증: function (st) {
        return wt(st).files['memo.txt'] === '메모 1번째 줄';
      },
      build: function () {
        return git.editFile(base(), 'memo.txt', '엉망으로 고친 내용');
      }
    },

    /* ------------------------------------------------------------------ */
    {
      id: 'reset-soft',
      제목: '방금 한 커밋만 취소하고 싶습니다',
      부제: '커밋은 되돌리되 작업 내용은 남기기',
      상황: '커밋을 두 번 했는데, 마지막 커밋은 나누는 게 나았을 것 같습니다. 아직 push하지 않았습니다.',
      목표: '마지막 커밋만 취소하고 그 내용은 스테이징에 남겨두기',
      힌트: ['git log --oneline', 'git reset --soft HEAD~1', 'git status', 'git log --oneline'],
      검증: function (st) {
        return git.history(st.objects, st.localBranches.main).length === 1 &&
               /메모 2번째 줄/.test(wt(st).index['memo.txt']);
      },
      build: function () {
        let s = git.editFile(base(), 'memo.txt', '메모 1번째 줄\n메모 2번째 줄');
        s = run(s, ['git add .', 'git commit -m "두 번째 버전"']);
        return s;
      }
    },

    /* ------------------------------------------------------------------ */
    {
      id: 'revert-pushed',
      제목: '이미 올린 커밋을 되돌려야 합니다',
      부제: '기록을 지우지 않고 취소하기',
      상황: '문제가 있는 커밋을 **이미 GitHub에 push했습니다.** 동료도 그 커밋을 받아갔을 수 있습니다.',
      목표: '동료의 기록과 어긋나지 않게 그 커밋의 변경만 취소하기',
      힌트: ['git log --oneline', 'git revert HEAD', 'git log --oneline', 'git push'],
      검증: function (st) {
        const tip = st.localBranches.main;
        return /^Revert/.test(st.objects[tip].message) &&
               st.github.branches.main === tip &&
               wt(st).files['memo.txt'] === '메모 1번째 줄';
      },
      build: function () {
        let s = git.editFile(published(), 'memo.txt', '메모 1번째 줄\n문제가 되는 줄');
        return run(s, ['git add .', 'git commit -m "문제가 된 변경"', 'git push']);
      }
    },

    /* ------------------------------------------------------------------ */
    {
      id: 'wrong-branch',
      제목: 'main에서 작업해버렸습니다',
      부제: '커밋을 옮기는 것이 아니라 이름표를 다시 붙이기',
      상황: 'feature 작업본에서 했어야 할 커밋을 `main`에 남겼습니다. 아직 push하지 않았습니다.',
      목표: '그 커밋을 `feature`로 옮기고 `main`은 원래 자리로 되돌리기',
      힌트: ['git log --oneline --all', 'git branch feature', 'git reset --hard origin/main',
             'git switch feature', 'git log --oneline --all'],
      검증: function (st) {
        return wt(st).HEAD.name === 'feature' &&
               st.localBranches.main === st.remoteTracking['origin/main'].tip &&
               st.localBranches.feature !== st.localBranches.main;
      },
      build: function () {
        let s = git.editFile(published(), 'feature.js', '새 기능 코드');
        return run(s, ['git add .', 'git commit -m "feature에 있어야 할 커밋"']);
      }
    }
  ];

  const BY_ID = {};
  LIST.forEach(function (s) { BY_ID[s.id] = s; });

  const DEFAULT_ID = 'first-commit';

  /** URL 파라미터는 믿지 않는다. 목록에 없으면 기본 시나리오로 연다. */
  function resolve(id) {
    return Object.prototype.hasOwnProperty.call(BY_ID, id) ? BY_ID[id] : BY_ID[DEFAULT_ID];
  }

  return {
    LIST: LIST,
    DEFAULT_ID: DEFAULT_ID,
    resolve: resolve,
    /* 대응표는 scenario-map.js 한 곳에만 둔다. 여기서는 그대로 내보내기만 한다 —
       두 벌로 두면 한쪽만 고쳐도 아무도 모른다. */
    scenarioFor: map.scenarioFor,
    TEMPLATE_TO_SCENARIO: map.TEMPLATE_TO_SCENARIO
  };
});
