/* ==========================================================================
   render.js — 실습실 화면 그리기

   **노드를 만든다. HTML 문자열을 만들지 않는다.** 상태도 바꾸지 않는다.

   값은 전부 js/dom.js 의 h()/svg() 를 거쳐 textContent 와 setAttribute 로만 들어간다.
   그래서 파일 이름이나 커밋 메시지에 무엇이 들어 있든 마크업이 될 수 없다 —
   이스케이프를 부르는 걸 잊는 실수 자체가 불가능해진다.

   인라인 style 은 쓰지 않는다. CSP 에 style-src 'self' 만 있어서
   style="…" 은 조용히 사라진다. 위치와 여백은 전부 클래스로 준다.
   ========================================================================== */

(function (root, factory) {
  root.CRRender = factory(root.CRGit, root.CRLayout, root.CRDom, root.CRAreas, root.CRGraph);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (git, layout, dom, areas, graph) {
  'use strict';

  const h = dom.h;
  const frag = dom.frag;
  const wt = git.worktree;   // 지금 보고 있는 작업 공간

  /**
   * 쉬운 말 설명의 최소 강조를 노드로 만든다.
   *   **굵게**  ·  `코드`
   * 예전에는 이스케이프한 문자열에 태그를 끼워 넣었다. 순서를 한 번만 헷갈리면
   * 그대로 구멍이 되는 방식이었다. 지금은 조각으로 잘라 각각 텍스트 노드로 넣는다.
   */
  function say(text) {
    const s = String(text == null ? '' : text);
    const out = [];
    const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
    let last = 0, m;

    while ((m = re.exec(s)) !== null) {
      if (m.index > last) out.push(s.slice(last, m.index));
      if (m[1] !== undefined) out.push(h('strong', null, m[1]));
      else out.push(h('code', null, m[2]));
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push(s.slice(last));
    return frag(out);
  }

  /** say() 를 담은 문단 하나 */
  function p(cls, text) {
    return h('p', cls ? { class: cls } : null, say(text));
  }

  /* ====================================================================== */
  /*  세 개의 main — 이 실습실의 얼굴                                         */
  /* ====================================================================== */

  function threeMains(state) {
    const branch = git.headBranch(state) || 'main';
    const localTip = state.localBranches[branch] || null;
    const track = state.remoteTracking['origin/' + branch] || null;
    const remoteTip = state.github.branches[branch] || null;

    const cells = [
      { 이름: '내 ' + branch, 어디: '내 컴퓨터', 값: localTip, 설명: '내가 커밋한 것들의 끝' },
      {
        이름: 'origin/' + branch, 어디: '내 컴퓨터 (메모)', 값: track ? track.tip : null,
        설명: track && track.lastFetchedLabel
          ? '마지막 확인: ' + track.lastFetchedLabel
          : (track ? '마지막으로 GitHub을 봤을 때의 기록' : '아직 한 번도 본 적 없음')
      },
      { 이름: 'GitHub의 ' + branch, 어디: 'GitHub 서버', 값: remoteTip, 설명: '지금 서버에 실제로 있는 것' }
    ];

    const values = cells.map(function (c) { return c.값; });
    const allSame = values[0] && values.every(function (v) { return v === values[0]; });

    /* 어긋나는 방식마다 배워야 할 것이 다르다. 한 문장으로 뭉뚱그리면
       "셋이 다르다"만 남고 왜 다른지는 안 남는다. */
    let 안내;
    if (!remoteTip && !track) {
      안내 = '아직 GitHub과 연결하지 않았습니다. 세 이름표가 갈라지는 것은 push한 뒤부터 볼 수 있습니다.';
    } else if (allSame) {
      안내 = '지금은 셋이 같습니다. 동료가 GitHub을 바꾸거나 내가 커밋하면 갈라집니다.';
    } else if (track && remoteTip && track.tip !== remoteTip) {
      안내 = 'GitHub은 이미 바뀌었는데 내 메모는 예전 그대로입니다. ' +
             '**메모는 GitHub에 있는 것이 아니라 내 컴퓨터에 있어서**, 내가 `git fetch`하기 전에는 움직이지 않습니다.';
    } else if (track && track.tip === remoteTip && localTip !== remoteTip) {
      const cmp = git.aheadBehind(state.objects, localTip, track.tip);
      if (cmp.ahead && cmp.behind) {
        안내 = '메모와 GitHub은 같지만, **양쪽에 서로 다른 커밋이 생겼습니다**(내 것 ' + cmp.ahead +
               '개, 저쪽 것 ' + cmp.behind + '개). 이 상태로 `git push`하면 거절됩니다 — 먼저 합쳐야 합니다.';
      } else if (cmp.behind) {
        안내 = '받아오기는 했지만 **합치지는 않았습니다.** `origin/main` 메모는 최신인데 내 `main`은 그대로입니다. ' +
               '`git merge origin/main`을 해야 내 작업본과 작업 폴더가 따라옵니다.';
      } else {
        안내 = '내 `main`이 GitHub보다 ' + cmp.ahead + '개 앞서 있습니다. 아직 올리지 않은 커밋입니다 — `git push`로 보냅니다.';
      }
    } else {
      안내 = '셋이 어긋나 있습니다. 어느 것이 어디에 있는지 위 칸의 "어디"를 보세요.';
    }

    return frag([
      h('h2', { class: 'three-mains__title' }, '세 개의 ' + branch),
      h('ul', { class: 'three-mains__list' }, cells.map(function (c) {
        const same = c.값 && c.값 === values[0];
        return h('li', { class: 'three-mains__item ' + (same ? 'is-same' : 'is-diff') }, [
          h('span', { class: 'three-mains__name' }, c.이름),
          h('span', { class: 'three-mains__where' }, c.어디),
          h('span', { class: 'three-mains__id' }, c.값 || '없음'),
          h('span', { class: 'three-mains__note' }, c.설명)
        ]);
      })),
      p('three-mains__hint', 안내)
    ]);
  }

  /* ====================================================================== */
  /*  작업 폴더 · 스테이징 · 서랍                                             */
  /* ====================================================================== */

  const FILE_STATE = {
    'untracked': { 표시: '새 파일', 기호: '+' },
    'modified':  { 표시: '고쳐짐', 기호: '~' },
    'staged':    { 표시: '스테이징과 같음', 기호: '=' },
    'clean':     { 표시: '마지막 버전과 같음', 기호: '=' }
  };

  function fileState(state, path) {
    const head = git.commitFiles(state.objects, git.headCommitId(state));
    const own = Object.prototype.hasOwnProperty;
    const inIndex = own.call(wt(state).index, path);
    if (!inIndex && !own.call(head, path)) return 'untracked';
    if (inIndex && wt(state).index[path] !== wt(state).files[path]) return 'modified';
    if (inIndex && head[path] !== wt(state).index[path]) return 'staged';
    return 'clean';
  }

  function panelTitle(no, name, sub) {
    return h('h3', { class: 'panel__title' }, [
      no + ' ' + name + ' ',
      h('span', { class: 'panel__sub' }, sub)
    ]);
  }

  function workPanel(state) {
    const paths = Object.keys(wt(state).files).sort();

    return frag([
      panelTitle('1.', '작업 폴더', 'working directory'),
      paths.length
        ? h('ul', { class: 'filelist' }, paths.map(function (path) {
            const s = fileState(state, path);
            const meta = FILE_STATE[s];
            return h('li', { class: 'filerow is-' + s }, [
              h('span', { class: 'filerow__mark', 'aria-hidden': 'true' }, meta.기호),
              h('span', { class: 'filerow__name' }, path),
              h('span', { class: 'filerow__state' }, meta.표시),
              h('button', { type: 'button', class: 'filerow__edit', 'data-edit': path }, '고치기')
            ]);
          }))
        : h('p', { class: 'panel__empty' }, '폴더가 비어 있습니다.'),
      h('button', { type: 'button', class: 'panel__action', id: 'newFileBtn' }, '새 파일 만들기')
    ]);
  }

  function stagePanel(state) {
    const head = git.commitFiles(state.objects, git.headCommitId(state));
    const own = Object.prototype.hasOwnProperty;
    const paths = Object.keys(wt(state).index).sort();

    return frag([
      panelTitle('2.', '스테이징', 'staging · index'),
      paths.length
        ? h('ul', { class: 'filelist' }, paths.map(function (path) {
            const isNew = !own.call(head, path);
            const changed = isNew || head[path] !== wt(state).index[path];
            return h('li', { class: 'filerow is-' + (changed ? 'staged' : 'clean') }, [
              h('span', { class: 'filerow__mark', 'aria-hidden': 'true' }, changed ? '▲' : '='),
              h('span', { class: 'filerow__name' }, path),
              h('span', { class: 'filerow__state' },
                changed ? (isNew ? '새 파일' : '고쳐진 내용') : '마지막 버전과 같음')
            ]);
          }))
        : h('p', { class: 'panel__empty' }, [
            '아직 고른 것이 없습니다.', h('br'), '여기 있는 것만 다음 커밋에 남습니다.'
          ])
    ]);
  }

  /* 작업 공간이 둘 이상일 때만 나온다.
     탭을 누르는 것은 git 명령이 아니라 `cd` 다 — 그래서 터미널이 아니라 여기에 둔다. */
  function worktreeTabs(state) {
    const names = Object.keys(state.worktrees);
    if (names.length < 2) return null;

    return frag([
      h('p', { class: 'wtabs__label' }, [
        '작업 폴더 ' + names.length + '개 — ',
        h('strong', null, '기록함(.git)은 하나입니다.'),
        ' 커밋·작업본·서랍은 공유하고, 작업 폴더·스테이징·지금 보는 작업본만 각자 갖습니다.'
      ]),
      h('div', { class: 'wtabs__row', role: 'group', 'aria-label': '작업 폴더 고르기' },
        names.map(function (name) {
          const w = state.worktrees[name];
          const 현재 = name === state.현재작업공간;
          return h('button', {
            type: 'button',
            class: 'wtab' + (현재 ? ' is-active' : ''),
            'data-worktree': name,
            'aria-current': 현재 ? 'true' : null
          }, [
            h('span', { class: 'wtab__path' }, git.shortPath(name)),
            h('span', { class: 'wtab__branch' },
              w.HEAD.type === 'branch' ? w.HEAD.name : 'detached')
          ]);
        }))
    ]);
  }

  /* 서랍은 5칸 어디에도 속하지 않는다. 커밋도 아니고 작업 폴더도 아닌
     "잠깐 빼둔 자리"라는 것이 요점이라, 칸 밖에 따로 그린다. */
  function stashPanel(state) {
    if (!state.stash.length) return null;

    return frag([
      h('h3', { class: 'panel__title' }, [
        '서랍 ', h('span', { class: 'panel__sub' }, 'stash — 5칸 밖')
      ]),
      h('ul', { class: 'filelist' }, state.stash.map(function (e, i) {
        return h('li', { class: 'filerow' }, [
          h('span', { class: 'filerow__mark', 'aria-hidden': 'true' }, '◪'),
          h('span', { class: 'filerow__name' }, 'stash@{' + i + '}'),
          h('span', { class: 'filerow__state' }, e.메시지)
        ]);
      })),
      p('panel__legend',
        '잠깐 빼둔 자리입니다. 커밋도 작업 폴더도 아니라 `git log`에 나오지 않습니다. `git stash pop`으로 꺼냅니다.')
    ]);
  }

  /* ====================================================================== */
  /*  충돌 해결                                                              */
  /* ====================================================================== */

  const SIDES = [
    { key: 'ours', 라벨: '내 것만 남기기' },
    { key: 'theirs', 라벨: '저쪽 것만 남기기' },
    { key: 'both', 라벨: '둘 다 남기기' }
  ];

  /** 마커가 든 파일. 어느 줄이 누구 것인지 색 말고도 왼쪽 표시로 알 수 있게 한다. */
  function conflictBody(content) {
    let mode = 'normal';
    return String(content == null ? '' : content).split('\n').map(function (l) {
      let cls = 'is-base', mark = ' ';
      if (l === '<<<<<<< HEAD') { mode = 'ours'; cls = 'is-marker'; mark = '▼'; }
      else if (l === '=======' && mode === 'ours') { mode = 'theirs'; cls = 'is-marker'; mark = '─'; }
      else if (l.indexOf('>>>>>>> ') === 0 && mode === 'theirs') { mode = 'normal'; cls = 'is-marker'; mark = '▲'; }
      else if (mode === 'ours') { cls = 'is-ours'; mark = '내'; }
      else if (mode === 'theirs') { cls = 'is-theirs'; mark = '저'; }

      return h('span', { class: 'cline ' + cls }, [
        h('span', { class: 'cline__mark', 'aria-hidden': 'true' }, mark),
        l, '\n'
      ]);
    });
  }

  function conflictPanel(state) {
    const o = git.ongoing(state);
    if (!o) return null;

    const 남은 = o.충돌파일 || [];
    const 무엇 = o.종류 === 'merge' ? '합치기' : '재작성';

    if (!남은.length) {
      return h('div', { class: 'conflict conflict--done' }, [
        h('h2', { class: 'conflict__title' }, '정할 것은 다 정했습니다'),
        p(null, o.종류 === 'merge'
          ? '`git commit`으로 ' + 무엇 + '를 마무리하세요. 메시지는 없어도 됩니다.'
          : '`git rebase --continue`로 다음 커밋을 이어서 옮기세요.')
      ]);
    }

    return h('div', { class: 'conflict' }, [
      h('h2', { class: 'conflict__title' }, 무엇 + '가 멈췄습니다 — ' + 남은.length + '개를 정해야 합니다'),
      p('conflict__lead',
        '실패한 것이 아닙니다. 양쪽이 **같은 줄 자리**를 다르게 고쳐서 Git이 판단하지 않고 넘긴 것입니다. ' +
        '두 내용이 파일 안에 나란히 적혀 있습니다.'),

      남은.map(function (path) {
        return h('div', { class: 'conflict__file' }, [
          h('p', { class: 'conflict__name' }, h('code', null, path)),
          h('div', { class: 'conflict__actions' }, SIDES.map(function (s) {
            return h('button', {
              type: 'button', class: 'pill',
              'data-resolve': s.key, 'data-path': path
            }, s.라벨);
          })),
          h('pre', { class: 'conflict__body' },
            h('code', null, conflictBody(wt(state).files[path])))
        ]);
      }),

      p('conflict__next',
        '고른 다음에는 `git add <파일>`로 **"내가 정했다"고 알려야** 합니다. ' +
        'Git은 마커가 남았는지 확인해주지 않습니다. 되돌리려면 `git ' + o.종류 + ' --abort`입니다.')
    ]);
  }

  /* ====================================================================== */
  /*  그래프 두 벌 — 저장소가 다르므로 그림도 따로                              */
  /* ====================================================================== */

  function localGraph(state) {
    const stage = layout.localStage(state);

    return frag([
      panelTitle('3~4.', '내 기록함', '.git — 커밋과 이름표'),
      stage
        ? frag([
            h('div', { class: 'graph-scroll' }, graph.buildStageSvg(stage)),
            h('p', { class: 'panel__legend' },
              '점선 이름표 = 마지막 fetch 때 적어둔 메모입니다. GitHub을 실시간으로 보는 것이 아닙니다.')
          ])
        : h('p', { class: 'panel__empty' }, '아직 커밋이 없습니다.')
    ]);
  }

  function githubPanel(state) {
    const stage = layout.githubStage(state);
    const connected = Object.prototype.hasOwnProperty.call(state.remotes, 'origin');

    return frag([
      panelTitle('5.', 'GitHub의 저장소', 'remote'),
      connected
        ? h('p', { class: 'panel__meta' }, state.remotes.origin)
        : h('p', { class: 'panel__empty' }, '아직 연결되지 않았습니다.'),
      stage
        ? h('div', { class: 'graph-scroll' }, graph.buildStageSvg(stage))
        : (connected ? h('p', { class: 'panel__empty' }, '서버에 아직 아무것도 없습니다.') : null),
      h('p', { class: 'panel__legend' }, [
        '여기 있는 커밋은 ', h('strong', null, '내 컴퓨터에 없을 수 있습니다.'), ' ',
        h('code', null, 'git fetch'), '를 해야 내 기록함으로 넘어옵니다.'
      ])
    ]);
  }

  /* ====================================================================== */
  /*  터미널 한 줄                                                           */
  /* ====================================================================== */

  function areaChips(changed, kept) {
    return h('div', { class: 'tline__areas' }, areas.renderAreaChips(changed, kept));
  }

  function outputBlock(text) {
    if (!text) return null;
    return h('pre', { class: 'tline__out' }, h('code', null, text));
  }

  function sceneBlock(scene) {
    return h('div', { class: 'tscene' }, [
      h('p', { class: 'tscene__title' }, scene.제목),
      outputBlock(scene.output),
      p('tline__say', scene.설명),
      areaChips(scene.변경영역, scene.유지영역)
    ]);
  }

  /**
   * @param {string} input 사용자가 친 줄
   * @param {Object} r     엔진 결과
   */
  function terminalLine(input, r) {
    const scenes = Array.isArray(r.장면) ? r.장면 : null;
    /* 충돌은 실패가 아니라 사람에게 넘어온 것이다. 빨강으로 칠하면 뭔가 잘못했다고 읽힌다. */
    const kind = r.충돌 ? ' is-conflict' : (r.ok ? '' : ' is-error');

    return h('div', { class: 'tline' + kind }, [
      h('p', { class: 'tline__cmd' }, [
        h('span', { class: 'tline__prompt', 'aria-hidden': 'true' }, '$'),
        ' ' + input
      ]),
      scenes
        ? scenes.map(sceneBlock)
        : [outputBlock(r.output), p('tline__say', r.설명), areaChips(r.변경영역, r.유지영역)]
    ]);
  }

  /** 사용자 조작(파일 고치기 등)도 터미널에 남긴다 — 상태가 왜 바뀌었는지 사라지면 안 된다 */
  function noteLine(text) {
    return h('div', { class: 'tline tline--note' }, p('tline__say', text));
  }

  /* ====================================================================== */
  /*  시나리오 안내                                                          */
  /* ====================================================================== */

  function brief(scenario, solved) {
    const hints = scenario.힌트.map(function (step) {
      /* 명령이 아닌 단계(파일 편집·폴더 이동)는 넣기 버튼을 주지 않는다.
         버튼을 주면 "이것도 쳐야 하는 명령"으로 읽힌다. */
      if (typeof step !== 'string') {
        return h('li', { class: 'brief__manual' }, say(step.안내));
      }
      return h('li', null, h('div', { class: 'code' }, [
        h('code', null, step),
        h('button', { type: 'button', class: 'copy-btn', 'data-fill': step }, '넣기')
      ]));
    });

    return frag([
      h('div', { class: 'brief__head' }, [
        h('h2', { class: 'brief__title' }, scenario.제목),
        h('p', { class: 'brief__sub' }, scenario.부제)
      ]),
      p('brief__situation', scenario.상황),
      h('p', { class: 'brief__goal' }, [
        h('span', { class: 'brief__label' }, '목표'), ' ', say(scenario.목표)
      ]),
      solved ? h('p', { class: 'brief__done', role: 'status' }, '목표를 달성했습니다.') : null,
      h('details', { class: 'brief__hints' }, [
        h('summary', null, '막히면 순서 보기'),
        h('p', { class: 'brief__hintnote' },
          '순서대로 쳐보세요. 일부러 거절되는 단계도 있습니다 — 그 거절이 배울 것입니다.'),
        h('ol', { class: 'brief__hintlist' }, hints)
      ])
    ]);
  }

  return {
    say: say,
    threeMains: threeMains,
    workPanel: workPanel,
    stagePanel: stagePanel,
    stashPanel: stashPanel,
    conflictPanel: conflictPanel,
    worktreeTabs: worktreeTabs,
    localGraph: localGraph,
    githubPanel: githubPanel,
    terminalLine: terminalLine,
    noteLine: noteLine,
    brief: brief
  };
});
