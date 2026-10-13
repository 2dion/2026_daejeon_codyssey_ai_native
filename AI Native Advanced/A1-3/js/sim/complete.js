/* ==========================================================================
   complete.js — 입력창 아래 자동 완성

   버튼을 늘어놓는 대신 입력창에 붙인다. 이유가 셋이다.
     1) 명령을 치는 곳과 고르는 곳이 같아야 눈이 안 움직인다
     2) 지금 저장소에 있는 **실제 파일·작업본 이름**을 채워 넣을 수 있다
     3) 목록이 길어져도 화면을 잡아먹지 않는다

   ── 접근성 ─────────────────────────────────────────────────────────────
   WAI-ARIA combobox 패턴을 따른다. 입력창이 combobox, 아래 목록이 listbox다.
   초점은 **입력창에서 나가지 않는다.** 지금 고른 항목은 aria-activedescendant 로만 알린다.
   목록을 열자마자 첫 항목을 고르지 않는다 — 그러면 직접 친 명령을 Enter 로 실행하려던
   사람이 엉뚱한 제안을 실행하게 된다. 고르려면 ↓ 를 눌러야 한다.

   출력은 전부 escapeHtml 을 거친다. 지금은 아래 목록이 전부 코드에 박힌 값이지만,
   파일 이름은 사용자가 만든 값이 섞인다.
   ========================================================================== */

(function (root, factory) {
  root.CRComplete = factory(root.CRDom);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (dom) {
  'use strict';

  const h = dom.h;
  const replace = dom.replace;

  /* 실습실이 실행할 수 있는 명령 전부. parser.js 의 허용 목록과 짝을 이룬다.
       확장: 'files'    → 지금 작업 폴더에 있는 파일 이름으로 펼친다
       확장: 'branches' → 지금 있는 작업본 이름으로 펼친다
     펼칠 것이 없으면 <자리표시자> 형태 그대로 남는다. */
  const CATALOG = [
    { cmd: 'git status', 설명: '지금 어느 칸에 무엇이 있는지 봅니다', 칸: '아무것도 바꾸지 않음' },
    { cmd: 'git init', 설명: '이 폴더에 기록함(.git)을 만듭니다', 칸: '내 작업본' },

    { cmd: 'git add .', 설명: '고친 것을 전부 스테이징에 올립니다', 칸: '스테이징' },
    { cmd: 'git add <파일>', 설명: '고른 파일만 스테이징에 올립니다', 칸: '스테이징', 확장: 'files' },

    { cmd: 'git commit -m "<메시지>"', 설명: '스테이징에 있는 것만 버전으로 남깁니다', 칸: '내 작업본' },
    { cmd: 'git commit --amend --no-edit', 설명: '직전 커밋에 합칩니다 (커밋 id가 바뀝니다)', 칸: '내 작업본' },
    { cmd: 'git commit --amend -m "<메시지>"', 설명: '직전 커밋의 메시지를 고쳐 씁니다', 칸: '내 작업본' },

    { cmd: 'git diff', 설명: '작업 폴더 ↔ 스테이징을 비교합니다', 칸: '아무것도 바꾸지 않음' },
    { cmd: 'git diff --staged', 설명: '스테이징 ↔ 마지막 버전을 비교합니다', 칸: '아무것도 바꾸지 않음' },
    { cmd: 'git log --oneline', 설명: '내 기록함의 커밋을 봅니다', 칸: '아무것도 바꾸지 않음' },
    { cmd: 'git log --oneline --all', 설명: '원격 추적 이름표까지 함께 봅니다', 칸: '아무것도 바꾸지 않음' },

    { cmd: 'git restore <파일>', 설명: '작업 폴더의 편집을 버립니다 (되돌릴 수 없음)', 칸: '작업 폴더', 확장: 'files', 위험: true },
    { cmd: 'git restore --staged <파일>', 설명: 'add만 취소합니다. 고친 내용은 남습니다', 칸: '스테이징', 확장: 'files' },

    { cmd: 'git branch', 설명: '작업본 목록을 봅니다', 칸: '아무것도 바꾸지 않음' },
    { cmd: 'git branch -a', 설명: '원격 추적 이름표까지 함께 봅니다', 칸: '아무것도 바꾸지 않음' },
    { cmd: 'git branch <이름>', 설명: '이름표만 만듭니다 (옮겨가지는 않습니다)', 칸: '내 작업본' },
    { cmd: 'git switch <작업본>', 설명: '그 작업본으로 옮겨갑니다', 칸: '작업 폴더 · 스테이징 · 내 작업본', 확장: 'branches' },
    { cmd: 'git switch -c <새이름>', 설명: '새 작업본을 만들면서 옮겨갑니다', 칸: '내 작업본' },
    { cmd: 'git merge origin/main', 설명: 'origin/main 메모에 받아둔 것을 지금 작업본에 합칩니다', 칸: '작업 폴더 · 스테이징 · 내 작업본' },
    { cmd: 'git merge --abort', 설명: '충돌이 난 합치기를 시작 직전으로 되돌립니다', 칸: '작업 폴더 · 스테이징 · 내 작업본' },

    { cmd: 'git stash', 설명: '하던 일을 서랍에 치우고 마지막 버전 상태로 되돌립니다', 칸: '작업 폴더 · 스테이징' },
    { cmd: 'git stash -u', 설명: '한 번도 add한 적 없는 파일까지 함께 치웁니다', 칸: '작업 폴더 · 스테이징' },
    { cmd: 'git stash list', 설명: '서랍에 무엇이 들어 있는지 봅니다', 칸: '아무것도 바꾸지 않음' },
    { cmd: 'git stash pop', 설명: '꺼내면서 서랍에서 지웁니다', 칸: '작업 폴더 · 스테이징' },
    { cmd: 'git stash apply', 설명: '꺼내되 서랍에 그대로 둡니다', 칸: '작업 폴더 · 스테이징' },
    { cmd: 'git stash drop', 설명: '꺼내지 않고 버립니다 (되돌릴 수 없음)', 칸: '아무것도 바꾸지 않음', 위험: true },

    { cmd: 'git rebase origin/main', 설명: '내 커밋들을 새 바닥 위에 다시 적습니다 (id가 바뀝니다)', 칸: '작업 폴더 · 스테이징 · 내 작업본', 위험: true },
    { cmd: 'git rebase --continue', 설명: '충돌을 정한 뒤 다음 커밋을 이어서 옮깁니다', 칸: '작업 폴더 · 스테이징 · 내 작업본' },
    { cmd: 'git rebase --skip', 설명: '지금 커밋을 건너뜁니다 (그 변경은 사라집니다)', 칸: '작업 폴더 · 스테이징 · 내 작업본', 위험: true },
    { cmd: 'git rebase --abort', 설명: '시작 직전으로 되돌립니다', 칸: '작업 폴더 · 스테이징 · 내 작업본' },

    { cmd: 'git worktree list', 설명: '작업 폴더 목록을 봅니다 (기록함은 하나입니다)', 칸: '아무것도 바꾸지 않음' },
    { cmd: 'git worktree add ../연습폴더-hotfix -b hotfix', 설명: '작업 폴더를 하나 더 만들면서 새 작업본을 엽니다', 칸: '내 작업본' },
    { cmd: 'git worktree add ../연습폴더-hotfix <작업본>', 설명: '있는 작업본을 다른 폴더에서 엽니다', 칸: '아무것도 바꾸지 않음', 확장: 'branches' },
    { cmd: 'git worktree remove ../연습폴더-hotfix', 설명: '작업 폴더를 치웁니다 (커밋과 작업본은 남습니다)', 칸: '아무것도 바꾸지 않음' },

    { cmd: 'git remote add origin <주소>', 설명: '주소에 별명을 붙입니다 (5칸 어디도 안 바뀝니다)', 칸: '아무것도 바꾸지 않음' },
    { cmd: 'git remote -v', 설명: '연결된 주소를 봅니다', 칸: '아무것도 바꾸지 않음' },
    { cmd: 'git fetch', 설명: '받아오기만 합니다. origin/main 메모만 갱신됩니다', 칸: 'origin/main 메모' },
    { cmd: 'git pull', 설명: 'fetch + merge — 받아오고 합칩니다', 칸: 'origin/main 메모 · 작업 폴더 · 내 작업본' },
    { cmd: 'git pull --ff-only', 설명: '합치기 커밋을 만들어야 하면 멈춥니다', 칸: 'origin/main 메모 · 내 작업본' },
    { cmd: 'git push', 설명: '내 커밋을 GitHub으로 보냅니다', 칸: '공유 폴더 · origin/main 메모' },
    { cmd: 'git push -u origin main', 설명: '보내면서 짝이 될 원격 이름표도 정합니다', 칸: '공유 폴더 · origin/main 메모' },

    { cmd: 'git reset --soft HEAD~1', 설명: '커밋만 취소. 스테이징은 그대로 둡니다', 칸: '내 작업본' },
    { cmd: 'git reset --mixed HEAD~1', 설명: '커밋과 스테이징을 되돌립니다. 파일 내용은 남습니다', 칸: '내 작업본 · 스테이징' },
    { cmd: 'git reset --hard HEAD~1', 설명: '세 칸을 모두 덮습니다. 커밋 안 한 편집은 사라집니다', 칸: '작업 폴더 · 스테이징 · 내 작업본', 위험: true },
    { cmd: 'git revert HEAD', 설명: '지우지 않고, 취소하는 커밋을 하나 더 만듭니다', 칸: '작업 폴더 · 스테이징 · 내 작업본' }
  ];

  const PLACEHOLDER = /<[^<>]+>/;

  /**
   * @param {HTMLInputElement} input
   * @param {HTMLElement} list      role="listbox" 요소
   * @param {Function} context      () => { files: string[], branches: string[] }
   */
  function attach(input, list, context) {
    let items = [];
    let active = -1;
    let open = false;

    /* --------------------------------------------------------- 목록 만들기 */

    function expand() {
      const ctx = (typeof context === 'function' ? context() : null) || {};
      const out = [];

      CATALOG.forEach(function (entry) {
        const names = entry.확장 === 'files' ? (ctx.files || [])
                    : entry.확장 === 'branches' ? (ctx.branches || [])
                    : null;

        /* 지금 저장소에 있는 실제 이름으로 펼친다.
           <파일> 자리에 진짜 파일명이 들어가 있으면 그대로 Enter 만 치면 된다. */
        if (names && names.length) {
          names.forEach(function (name) {
            out.push({
              cmd: entry.cmd.replace(PLACEHOLDER, name),
              설명: entry.설명, 칸: entry.칸, 위험: entry.위험
            });
          });
          return;
        }
        out.push(entry);
      });
      return out;
    }

    /** 앞에서부터 맞으면 위로, 어디든 들어 있으면 아래로 */
    function match(all, query) {
      const q = query.trim().toLowerCase();
      if (!q) return all;

      const head = [], rest = [];
      all.forEach(function (e) {
        const c = e.cmd.toLowerCase();
        if (c.indexOf(q) === 0) head.push(e);
        else if (c.indexOf(q) !== -1) rest.push(e);
        else if (q.split(/\s+/).every(function (w) { return c.indexOf(w) !== -1; })) rest.push(e);
      });
      return head.concat(rest);
    }

    /* ----------------------------------------------------------- 그리기 */

    /** 맞은 부분만 굵게. 원본을 잘라 텍스트 노드로 넣으므로 위치가 밀릴 일이 없다. */
    function highlight(cmd, query) {
      const q = query.trim();
      const at = q ? cmd.toLowerCase().indexOf(q.toLowerCase()) : -1;
      if (at === -1) return cmd;
      return [
        cmd.slice(0, at),
        h('mark', null, cmd.slice(at, at + q.length)),
        cmd.slice(at + q.length)
      ];
    }

    function paint(query) {
      replace(list, items.map(function (e, i) {
        return h('li', {
          class: 'suggest__item' + (e.위험 ? ' is-danger' : '') + (i === active ? ' is-active' : ''),
          id: 'cmdOpt-' + i, role: 'option',
          'aria-selected': String(i === active), 'data-i': i
        }, [
          h('span', { class: 'suggest__cmd' }, highlight(e.cmd, query)),
          h('span', { class: 'suggest__desc' }, e.설명),
          h('span', { class: 'suggest__area' }, [
            e.위험 ? [h('span', { class: 'suggest__warn' }, '위험'), ' '] : null,
            e.칸
          ])
        ]);
      }));
      input.setAttribute('aria-activedescendant', active >= 0 ? 'cmdOpt-' + active : '');
    }

    function show() {
      items = match(expand(), input.value);
      /* 열자마자 아무것도 고르지 않는다. 직접 친 명령이 Enter 로 그대로 실행되어야 한다. */
      active = -1;
      if (!items.length) { hide(); return; }
      paint(input.value);
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      open = true;
    }

    function hide() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      open = false;
      active = -1;
    }

    function move(step) {
      if (!open) { show(); if (!open) return; }
      active = (active + step + items.length + 1) % (items.length + 1);
      if (active === items.length) active = -1;   // 한 바퀴 돌면 "내가 친 것"으로 돌아온다
      paint(input.value);
      const el = list.querySelector('.is-active');
      if (el) el.scrollIntoView({ block: 'nearest' });
    }

    /** 자리표시자가 있으면 그 부분을 선택해 둔다 — 바로 타이핑하면 덮어써진다 */
    function fill(cmd) {
      input.value = cmd;
      const m = PLACEHOLDER.exec(cmd);
      if (m) input.setSelectionRange(m.index, m.index + m[0].length);
      else input.setSelectionRange(cmd.length, cmd.length);
      hide();
      input.focus();
    }

    /* ----------------------------------------------------------- 이벤트 */

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', list.id);
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('autocomplete', 'off');

    input.addEventListener('input', show);
    input.addEventListener('focus', show);

    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); return; }
      if (e.key === 'Escape') { if (open) { e.preventDefault(); hide(); } return; }
      if ((e.key === 'Enter' || e.key === 'Tab') && open && active >= 0) {
        e.preventDefault();          // 제안을 고르는 중이면 아직 실행하지 않는다
        fill(items[active].cmd);
      }
    });

    /* mousedown 에서 막지 않으면 클릭이 닿기 전에 blur 로 목록이 닫힌다 */
    list.addEventListener('mousedown', function (e) { e.preventDefault(); });
    list.addEventListener('click', function (e) {
      const li = e.target.closest('[data-i]');
      if (li) fill(items[+li.getAttribute('data-i')].cmd);
    });

    input.addEventListener('blur', function () { setTimeout(hide, 0); });

    return { fill: fill, hide: hide };
  }

  return { attach: attach, CATALOG: CATALOG };
});
