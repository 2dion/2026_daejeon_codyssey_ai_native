/* ==========================================================================
   rescue.js — AI 요청/응답 처리, 결과 렌더링, 실패 처리 (기획서 3.8 / 7.2 / 7.4절)
   ========================================================================== */

(function () {
  'use strict';

  const toast = window.CRUtil.toast;
  const h = window.CRDom.h;
  const replace = window.CRDom.replace;

  const form = document.getElementById('rescueForm');
  const situationEl = document.getElementById('situation');
  const countEl = document.getElementById('situationCount');
  const errorEl = document.getElementById('formError');
  const submitBtn = document.getElementById('submitBtn');
  const resetBtn = document.getElementById('resetBtn');
  const region = document.getElementById('resultRegion');

  const MAX_SITUATION = 1000;
  const MIN_SITUATION = 5;
  const TIMEOUT_MS = 20000;
  const SLOW_MS = 5000;
  const COOLDOWN_MS = 10000;

  const WHERE_LABEL = {
    'local': '내 컴퓨터 안의 문제',
    '저장소관계': '로컬과 원격의 관계 문제',
    '네트워크인증': '연결 · 인증 문제',
    'github정책': 'GitHub 정책 · 보안 문제',
    '판단불가': '원인 위치를 특정하기 어려움'
  };

  /* 서버가 최종 검증하지만, 프론트도 한 번 더 확인한다 */
  const ALLOWED_TEMPLATES = window.GRAPH_TEMPLATE_IDS || ['none'];

  /* 실습실에 같은 상황을 만들어둔 것이 있으면 재현 링크를 붙인다.
     대응표(js/sim/scenario-map.js)가 없으면 링크 없이 지금까지처럼 동작한다. */
  const scenarioFor = (window.CRScenarioMap && window.CRScenarioMap.scenarioFor)
    || function () { return null; };

  /* 확실한 토큰 형태 — 발견 시 전송을 막는다 */
  const HARD_SECRET_PATTERNS = [
    { re: /github_pat_[A-Za-z0-9_]{20,}/, name: 'GitHub 토큰(fine-grained)' },
    { re: /gh[pousr]_[A-Za-z0-9]{16,}/, name: 'GitHub 액세스 토큰(classic)' },
    { re: /\bsk-[A-Za-z0-9_\-]{16,}/, name: 'API 시크릿 키' },
    { re: /AIza[0-9A-Za-z_\-]{20,}/, name: 'Google API 키' },
    // Google 의 새 키 형식. AIza 로 시작하지 않아 위 패턴에 걸리지 않는다.
    { re: /\bAQ\.[A-Za-z0-9_\-]{20,}/, name: 'Google API 키(신형)' },
    { re: /glpat-[0-9A-Za-z_\-]{16,}/, name: 'GitLab 토큰' },
    { re: /xox[baprs]-[0-9A-Za-z\-]{10,}/, name: 'Slack 토큰' },
    { re: /https?:\/\/[^\s:@]+:[^\s@]+@/, name: '비밀번호가 포함된 저장소 주소' }
  ];
  /* 40자 이상 16진 문자열 — 커밋 해시일 수도 있으므로 경고 후 사용자가 넘길 수 있게 한다 */
  const SOFT_SECRET_PATTERN = /\b[0-9a-f]{40,}\b/;

  /* ====================================================================== */
  /*  결과 렌더링                                                            */
  /* ====================================================================== */

  function evidenceBlock(evidence) {
    evidence = evidence || {};
    const groups = [
      { key: '확인됨', cls: 'confirmed', icon: '✓', title: '확인됨', hint: '입력하신 내용에서 확인된 사실입니다.' },
      { key: '추정', cls: 'guess', icon: '?', title: '추정', hint: '입력에 없어 미루어 짐작한 부분입니다. 다를 수 있습니다.' },
      { key: '추가확인', cls: 'todo', icon: '→', title: '추가로 확인하면 좋은 것', hint: '' }
    ];

    const own = Object.prototype.hasOwnProperty;
    const blocks = groups.map(function (g) {
      const items = own.call(evidence, g.key) && Array.isArray(evidence[g.key])
        ? evidence[g.key].filter(Boolean) : [];
      if (!items.length) return null;

      return h('div', { class: 'evidence__group evidence--' + g.cls }, [
        h('h4', null, [h('span', { 'aria-hidden': 'true' }, g.icon), ' ' + g.title]),
        h('ul', null, items.map(function (t) { return h('li', null, t); })),
        g.hint ? h('p', { class: 'evidence__cta' }, g.hint) : null
      ]);
    }).filter(Boolean);

    if (!blocks.length) return null;
    return h('section', null, [
      h('p', { class: 'block__title' }, '무엇이 확인됐고 무엇이 추정인가'),
      h('div', { class: 'evidence' }, blocks),
      h('p', { class: 'evidence__cta' },
        '이 서비스는 실제 저장소를 읽지 못합니다. 그래서 확인된 사실과 추정을 나눠 보여줍니다.')
    ]);
  }

  /* 붙여넣어도 되는 명령인지 화면에서도 한 번 더 본다 (api/rescue.py 와 같은 규칙).
     서버가 이미 막고 있는데 또 보는 이유는 두 가지다.
       1) 이 화면은 sessionStorage 에 저장해둔 답도 그대로 다시 그린다.
          저장소는 서버를 거치지 않으므로 서버 검증도 거치지 않는다.
       2) 이 서비스가 사용자에게 시키는 유일한 행동이 "복사해서 실행"이다.
          그 자리는 한 겹으로 두지 않는다. */
  const CMD_PLACEHOLDER_RE = /<[^<>\s;|&$`\\]{1,40}>/g;
  const CMD_SHELL_META_RE = /[;|&$`\\\n\r<>]/;
  const CMD_EXEC_OPT_RE = /--upload-pack|--receive-pack|--exec|sshcommand|core\.pager|core\.editor|gpg\.program|alias\.|filter\.|difftool|mergetool/i;
  const CMD_GLOBAL_CONFIG_RE = /^git\s+(-c|--config-env)\b/i;

  function isSafeCommand(cmd) {
    if (!/^git( |$)/.test(cmd)) return false;
    if (CMD_SHELL_META_RE.test(cmd.replace(CMD_PLACEHOLDER_RE, ''))) return false;
    if (CMD_GLOBAL_CONFIG_RE.test(cmd)) return false;
    return !CMD_EXEC_OPT_RE.test(cmd);
  }

  function stepsBlock(commands, locked) {
    const items = commands.map(function (step) {
      const cmd = String(step.cmd || '');

      // 걸린 명령은 복사 버튼을 주지 않는다. 감추기만 하면 무엇이 왜
      // 빠졌는지 알 수 없으므로, 막았다는 사실은 그대로 보여준다.
      if (!isSafeCommand(cmd)) {
        return h('li', { class: 'step' },
          h('div', { class: 'callout callout--danger callout--inline' },
            h('p', null, [
              h('strong', null, '이 단계는 표시하지 않았습니다.'),
              ' git 명령이 아니거나 다른 명령을 함께 실행시킬 수 있는 형태입니다. ' +
              '입력하신 내용에 다른 지시문이 섞여 있지 않은지 확인해주세요.'
            ])));
      }

      // 페이지 어디서나 같은 .code 규칙을 쓴다 (복사 버튼 위치·여백 통일)
      return h('li', { class: 'step' }, [
        h('div', { class: 'code' }, [
          h('code', null, cmd),
          h('button', {
            type: 'button', class: 'copy-btn', 'data-copy': cmd, disabled: !!locked
          }, '복사')
        ]),
        h('p', { class: 'step__desc' }, step.설명 || ''),
        h('div', { class: 'step__areas' },
          window.CRAreas.renderAreaChips(step.변경영역, step.유지영역))
      ]);
    });

    return h('section', null, [
      h('p', { class: 'block__title' }, '이 순서대로 실행하세요'),
      h('ol', { class: 'steps' + (locked ? ' is-locked' : ''), id: 'stepsList' }, items)
    ]);
  }

  function areaSummaryBlock(commands) {
    const changed = [], kept = [];
    commands.forEach(function (step) {
      (step.변경영역 || []).forEach(function (a) { if (changed.indexOf(a) === -1) changed.push(a); });
    });
    commands.forEach(function (step) {
      (step.유지영역 || []).forEach(function (a) {
        if (changed.indexOf(a) === -1 && kept.indexOf(a) === -1) kept.push(a);
      });
    });
    return h('section', null, [
      h('p', { class: 'block__title' }, '전체를 실행하면 어디가 바뀌나'),
      window.CRAreas.renderMiniAreas(changed, kept)
    ]);
  }

  /**
   * "이 상황을 실습실에서 직접 해보기".
   * 설명을 읽는 것과 직접 쳐서 상태가 움직이는 것을 보는 것은 다르다.
   * 다만 **검증된 시나리오가 있을 때만** 붙인다. 없는데 억지로 비슷한 상태를
   * 만들어 열면 사용자는 그것을 자기 저장소로 오해한다.
   */
  function labBlock(templateId) {
    const scenarioId = scenarioFor(templateId);
    if (!scenarioId) return null;

    return h('section', { class: 'lab-cta' }, [
      h('p', { class: 'block__title' }, '이 상황을 직접 해보기'),
      h('p', { class: 'lab-cta__desc' }, [
        '같은 상태로 맞춰둔 실습실이 있습니다. 위 명령을 한 줄씩 쳐보면 ',
        h('strong', null, '어느 칸이 바뀌고 어느 칸이 그대로인지'),
        ' 눈으로 볼 수 있습니다. 실제 저장소는 바뀌지 않습니다.'
      ]),
      h('a', {
        class: 'btn btn--primary lab-cta__go',
        href: 'lab.html?scenario=' + encodeURIComponent(scenarioId)
      }, '실습실에서 재현하기')
    ]);
  }

  function warningsBlock(list) {
    if (!Array.isArray(list) || !list.length) return null;
    return h('section', null, [
      h('p', { class: 'block__title' }, '주의사항'),
      h('ul', { class: 'warnings' },
        list.map(function (w) { return h('li', null, w); }))
    ]);
  }

  /* 위험 명령 6단계 손실 점검 게이트 (기획서 7.4절) */
  function gateBlock() {
    const steps = [
      { text: '현재 상태를 확인했습니다', code: 'git status' },
      { text: '무엇을 잃게 되는지 확인했습니다', code: 'git diff\ngit diff --staged' },
      { text: '커밋하지 않은 변경을 먼저 대피시켰습니다', code: 'git stash push -u -m "backup"' },
      { text: '커밋 기록 보호가 필요해 백업 브랜치를 만들었습니다', code: 'git branch backup-$(date +%Y%m%d-%H%M%S)' },
      { text: '아래 “사라지는 것 / 남는 것”을 읽었습니다', code: null },
      { text: '이해했습니다. 명령어 복사를 열어주세요', code: null }
    ];

    const items = steps.map(function (s, i) {
      return h('li', { class: 'gate__step' }, [
        h('label', null, [
          h('input', { type: 'checkbox', class: 'gate__check', 'data-step': i }),
          ' ' + s.text
        ]),
        s.code ? h('div', { class: 'code' }, [
          h('pre', null, h('code', null, s.code)),
          h('button', { type: 'button', class: 'copy-btn', 'data-copy': s.code }, '복사')
        ]) : null,
        i === 4 ? lossList() : null
      ]);
    });

    return h('section', { class: 'gate', id: 'riskGate' }, [
      h('p', { class: 'gate__title' }, [
        h('span', { 'aria-hidden': 'true' }, '⚠'),
        ' 위험 명령입니다. 6단계 손실 점검 후에 복사가 열립니다'
      ]),
      h('p', { class: 'gate__lead' }, [
        '백업 브랜치는 ', h('strong', null, '이미 커밋된 기록만'),
        ' 보호합니다. 커밋하지 않은 변경은 지켜주지 못하므로, 순서대로 확인해주세요.'
      ]),
      h('ol', { class: 'gate__steps' }, items),
      h('div', { class: 'gate__foot' }, [
        h('span', { class: 'gate__progress', id: 'gateProgress' }, '0 / 6 확인'),
        h('button', { type: 'button', class: 'gate__bypass', id: 'gateBypass' },
          '확인했습니다, 그냥 진행')
      ]),
      h('p', { class: 'gate__lead' },
        '명령어 텍스트는 잠금과 무관하게 드래그로 선택할 수 있습니다. 판단을 막는 것이 목적은 아닙니다.')
    ]);
  }

  function lossList() {
    return h('div', { class: 'gate__loss' }, [
      h('h5', null, '이 명령을 실행하면 다음이 사라집니다'),
      h('ul', { class: 'gate__loss--gone' }, [
        h('li', null, '작업 폴더에서 수정했지만 커밋하지 않은 내용'),
        h('li', null, '스테이징에만 올린 내용')
      ]),
      h('h5', null, '다음은 남습니다'),
      h('ul', { class: 'gate__loss--stay' }, [
        h('li', null, ['커밋된 기록 (', h('code', null, 'git reflog'), '로 찾을 수 있음)']),
        h('li', null, 'Git이 추적하지 않는(untracked) 파일')
      ]),
      h('p', null, [
        h('code', null, 'git reflog'), '는 ',
        h('strong', null, '이동하거나 삭제된 커밋'), '을 찾는 데 유용합니다. 다만 ',
        h('strong', null, '한 번도 커밋하지 않은 파일 변경까지 복구해주지는 않습니다.'),
        ' 그래서 위험한 명령 전에 먼저 커밋하거나 stash해두는 것이 중요합니다.'
      ])
    ]);
  }

  /**
   * 정적 카드와 AI 응답을 같은 코드로 렌더링한다.
   * @param {Object} data 3.5절 구조
   * @param {Object} opts { source: '검수된 정적 카드' | 'AI 생성' }
   */
  function renderResult(data, opts) {
    opts = opts || {};

    if (data.관련없음) {
      showMessage('Git 관련 상황만 도와드릴 수 있어요.',
        '터미널에서 겪은 Git 문제나 GitHub 관련 상황을 적어주시면 도와드릴 수 있습니다.');
      return;
    }

    const commands = Array.isArray(data.명령어) ? data.명령어 : [];
    const isDanger = data.위험도 === '위험';
    const templateId = ALLOWED_TEMPLATES.indexOf(data.그래프템플릿) !== -1 ? data.그래프템플릿 : 'none';
    const graph = window.CRGraph.renderGraphTemplate(templateId);

    const own = Object.prototype.hasOwnProperty;
    const where = own.call(WHERE_LABEL, data.오류위치) ? WHERE_LABEL[data.오류위치] : null;

    const article = h('article', { class: 'result' }, [
      h('div', { class: 'result__head' }, [
        h('div', { class: 'result__badges' }, [
          opts.source ? h('span', { class: 'result__source' }, opts.source) : null,
          window.CRUtil.riskBadge(data.위험도 || '주의', { prefix: true }),
          where ? h('span', { class: 'result__where' }, where) : null
        ]),
        h('p', { class: 'result__summary' }, data.상황요약 || '')
      ]),
      h('div', { class: 'result__body' }, [
        evidenceBlock(data.근거구분),
        isDanger ? gateBlock() : null,
        h('div', { class: 'result__cols' }, [
          h('div', null, stepsBlock(commands, isDanger)),
          h('div', null, [
            areaSummaryBlock(commands),
            graph
              ? h('section', { class: 'result__graph' }, [
                  h('p', { class: 'block__title' }, '커밋 그래프로 보기'),
                  graph
                ])
              : h('p', { class: 'mini-areas__legend' },
                  '이 상황에 딱 맞는 검증된 그래프가 없어 그래프는 생략했습니다. 억지로 그리지 않습니다.'),
            labBlock(templateId)
          ])
        ]),
        warningsBlock(data.주의사항)
      ])
    ]);

    replace(region, article);
    if (isDanger) wireGate();
    region.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* 게이트 상호작용 */
  function wireGate() {
    const gate = document.getElementById('riskGate');
    const stepsList = document.getElementById('stepsList');
    const progress = document.getElementById('gateProgress');
    if (!gate || !stepsList) return;

    const checks = Array.prototype.slice.call(gate.querySelectorAll('.gate__check'));

    function unlock() {
      stepsList.classList.remove('is-locked');
      stepsList.querySelectorAll('.copy-btn').forEach(function (b) { b.disabled = false; });
      toast('명령어 복사가 열렸습니다');
    }

    checks.forEach(function (box) {
      box.addEventListener('change', function () {
        box.closest('.gate__step').classList.toggle('is-done', box.checked);
        const done = checks.filter(function (c) { return c.checked; }).length;
        progress.textContent = done + ' / ' + checks.length + ' 확인';
        if (done === checks.length) unlock();
      });
    });

    const bypass = document.getElementById('gateBypass');
    if (bypass) {
      bypass.addEventListener('click', function () {
        checks.forEach(function (c) { c.checked = true; c.closest('.gate__step').classList.add('is-done'); });
        progress.textContent = checks.length + ' / ' + checks.length + ' 확인';
        unlock();
      });
    }
  }

  /* ====================================================================== */
  /*  상태 표시 (로딩 / 오류 / 안내)                                          */
  /* ====================================================================== */

  function showLoading() {
    replace(region, h('div', { class: 'loading' }, [
      h('span', { class: 'spinner', 'aria-hidden': 'true' }),
      h('span', { id: 'loadingText' }, '상황을 살펴보고 있어요…')
    ]));
    return setTimeout(function () {
      const t = document.getElementById('loadingText');
      if (t) t.textContent = '명령어를 정리하고 있어요. 잠시만요.';
    }, SLOW_MS);
  }

  function showMessage(title, body, retry) {
    /* 버튼은 만들면서 바로 핸들러를 단다. id 로 다시 찾지 않으니
       화면에 붙기 전에 배선이 끝나고, 중간에 못 찾을 일도 없다. */
    const btn = retry
      ? h('button', { type: 'button', class: 'btn btn--ghost', id: 'retryBtn' }, '다시 시도')
      : null;
    if (btn) btn.addEventListener('click', function () { submitForm(true); });

    replace(region, h('div', { class: 'result-msg' + (retry ? ' result-msg--error' : '') }, [
      h('p', { class: 'result-msg__title' }, title),
      body ? h('p', null, body) : null,
      btn
    ]));

    // 새로 만들어진 버튼에 현재 쿨다운 상태를 즉시 반영한다
    if (retry) paintCooldown();
  }

  function showFormError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
    situationEl.focus();
  }
  function clearFormError() {
    errorEl.hidden = true;
    errorEl.textContent = '';
  }

  /* ====================================================================== */
  /*  입력 검증                                                              */
  /* ====================================================================== */

  let softSecretAcknowledged = false;

  function collectPayload() {
    const fd = new FormData(form);
    return {
      situation: (fd.get('situation') || '').toString().trim(),
      executedCommand: (fd.get('executedCommand') || '').toString().trim(),
      errorMessage: (fd.get('errorMessage') || '').toString().trim(),
      statusOutput: (fd.get('statusOutput') || '').toString().trim(),
      alreadyPushed: (fd.get('alreadyPushed') || 'unknown').toString(),
      level: (fd.get('level') || 'beginner').toString()
    };
  }

  function validate(payload) {
    if (payload.situation.length < MIN_SITUATION) {
      return '어떤 상황인지 조금만 더 자세히 적어주세요.';
    }
    if (payload.situation.length > MAX_SITUATION) {
      return '1,000자 이내로 줄여주세요. (현재 ' + payload.situation.length + '자)';
    }

    const joined = [payload.situation, payload.executedCommand, payload.errorMessage, payload.statusOutput].join('\n');

    for (let i = 0; i < HARD_SECRET_PATTERNS.length; i++) {
      if (HARD_SECRET_PATTERNS[i].re.test(joined)) {
        return HARD_SECRET_PATTERNS[i].name + '으로 보이는 값이 있습니다. 지우고 보내주세요. ' +
               '이미 어딘가에 올라간 값이라면 먼저 폐기·재발급하세요.';
      }
    }
    if (!softSecretAcknowledged && SOFT_SECRET_PATTERN.test(joined)) {
      softSecretAcknowledged = true;
      return '40자 이상의 16진 문자열이 있습니다. 커밋 해시라면 그대로 두고 한 번 더 눌러주세요. ' +
             '토큰이라면 지우고 보내주세요.';
    }
    return null;
  }

  /* ====================================================================== */
  /*  요청                                                                   */
  /* ====================================================================== */

  function requestOnce(payload, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, timeoutMs);

    return fetch('/api/rescue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    }).then(function (res) {
      return res.text().then(function (text) {
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* 형식 오류 */ }
        return { status: res.status, ok: res.ok, json: json };
      });
    }).finally(function () {
      clearTimeout(timer);
    });
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /* 실패 시 1초 → 2초 → 4초 간격 재시도 (최대 3회, 기획서 7.2절)
     재시도 자체에 상한을 둔다. 상한이 없으면 매 시도가 TIMEOUT_MS 를 꽉 채울 때
     사용자는 "20초 안에 응답 아니면 안내"라는 약속(기획서 3.8절)보다 훨씬 오래 기다리게 된다. */
  const RETRY_DELAYS = [1000, 2000, 4000];

  function requestWithRetry(payload, attempt, deadline) {
    attempt = attempt || 0;
    deadline = deadline || (Date.now() + TIMEOUT_MS);

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      const expired = new Error('deadline exceeded');
      expired.name = 'AbortError';
      return Promise.reject(expired);
    }

    function canRetry() {
      return attempt < RETRY_DELAYS.length &&
             Date.now() + RETRY_DELAYS[attempt] < deadline;
    }
    function retry() {
      return sleep(RETRY_DELAYS[attempt]).then(function () {
        return requestWithRetry(payload, attempt + 1, deadline);
      });
    }

    return requestOnce(payload, remaining).then(function (res) {
      if (res.ok && res.json) return res;

      // 429는 자동 재시도하지 않는다. 한도 문제이므로 사용자에게 알린다.
      if (res.status === 429) return res;
      // 403도 마찬가지다. 방화벽(요청 제한)이 CDN 단에서 끊은 것이라
      // 다시 보내봐야 똑같이 막히고, 오히려 한 번 막힐 때마다 4번씩
      // 두드리는 꼴이 되어 차단 창만 더 길어진다.
      if (res.status === 403) return res;
      // 400은 서버가 판단한 입력 오류. 재시도해도 같다.
      if (res.status === 400) return res;

      return canRetry() ? retry() : res;
    }).catch(function (err) {
      if (err && err.name === 'AbortError') throw err;
      if (canRetry()) return retry();
      throw err;
    });
  }

  let lastPayload = null;
  let isSending = false;

  /* ---------------------------- 쿨다운 ----------------------------
     전송 버튼과 결과 화면의 "다시 시도" 버튼이 같은 쿨다운을 공유한다.
     예전에는 전송 버튼에만 걸려 있어서, 결과 화면의 재시도 버튼으로
     10초 잠금을 그대로 우회할 수 있었다 (기획서 7.2절 위반). */
  const SUBMIT_LABEL = '수습 방법 알려주세요';
  let cooldownUntil = 0;
  let cooldownTicker = null;

  function startCooldown(ms) {
    cooldownUntil = Math.max(cooldownUntil, Date.now() + ms);
    paintCooldown();
  }
  function cooldownLeft() {
    return Math.max(0, cooldownUntil - Date.now());
  }
  function paintCooldown() {
    const left = cooldownLeft();
    const secs = Math.ceil(left / 1000);
    const retryBtn = document.getElementById('retryBtn');

    if (left > 0) {
      if (!isSending) {
        submitBtn.disabled = true;
        submitBtn.textContent = secs + '초 후 다시 시도할 수 있어요';
      }
      if (retryBtn) {
        retryBtn.disabled = true;
        retryBtn.textContent = secs + '초 후 다시 시도';
      }
      if (!cooldownTicker) cooldownTicker = setInterval(paintCooldown, 250);
    } else {
      clearInterval(cooldownTicker);
      cooldownTicker = null;
      if (!isSending) {
        submitBtn.disabled = false;
        submitBtn.textContent = SUBMIT_LABEL;
      }
      if (retryBtn) {
        retryBtn.disabled = false;
        retryBtn.textContent = '다시 시도';
      }
    }
  }

  function lockSubmit() {
    isSending = true;
    submitBtn.disabled = true;
    submitBtn.textContent = '수습 방법을 찾는 중…';
  }
  function unlockSubmit() {
    isSending = false;
    // 연타로 무료 할당량을 소모하지 않도록 잠근다 (기획서 7.2절)
    startCooldown(COOLDOWN_MS);
  }

  function cacheKey(payload) { return 'cr:' + JSON.stringify(payload); }

  function submitForm(isRetry) {
    if (isSending) return;
    // 재시도 버튼도 같은 쿨다운을 지킨다
    if (cooldownLeft() > 0) { paintCooldown(); return; }

    const payload = isRetry && lastPayload ? lastPayload : collectPayload();
    if (!isRetry) {
      const error = validate(payload);
      if (error) { showFormError(error); return; }
      clearFormError();
    }
    lastPayload = payload;

    // 같은 입력은 다시 호출하지 않는다
    try {
      const cached = sessionStorage.getItem(cacheKey(payload));
      if (cached) {
        renderResult(JSON.parse(cached), { source: 'AI 생성 (같은 질문이라 저장된 답을 보여드립니다)' });
        return;
      }
    } catch (e) { /* sessionStorage 사용 불가 환경은 그냥 넘어간다 */ }

    lockSubmit();
    const slowTimer = showLoading();

    requestWithRetry(payload)
      .then(function (res) {
        clearTimeout(slowTimer);

        if (res.status === 429) {
          // 서버가 알려준 retryAfter 만큼 실제로 잠근다. 안내 문구와 버튼 상태를 일치시킨다.
          const wait = (res.json && Number(res.json.retryAfter)) || 30;
          startCooldown(wait * 1000);
          showMessage('지금 이용자가 많습니다.', wait + '초 후 다시 시도해주세요.', true);
          return;
        }
        if (res.status === 403) {
          // 방화벽이 CDN 단에서 끊은 것이라 본문에 retryAfter 가 없다.
          // 제한 창은 고정 구간(현재 600초)이라 언제 풀릴지는 창의 어디에서
          // 걸렸느냐에 달렸다. 방금 걸렸으면 거의 10분을 기다려야 한다.
          // 그래서 특정 시각을 약속하지 않는다. 60초는 다시 눌러보기까지의
          // 최소 간격일 뿐이고, 아직 창 안이면 또 잠긴다.
          startCooldown(60000);
          showMessage('요청이 너무 잦아 잠시 막혔습니다.',
            '잠시 후 다시 시도해주세요. 짧은 사이에 여러 번 보내면 최대 10분까지 막힐 수 있습니다.', true);
          return;
        }
        if (res.status === 400) {
          showMessage('입력을 다시 확인해주세요.',
            (res.json && res.json.message) || '상황 설명이 너무 짧거나 깁니다.');
          return;
        }
        if (!res.ok) {
          showMessage('일시적인 문제가 발생했습니다.', '잠시 후 다시 시도해주세요.', true);
          return;
        }
        if (!res.json) {
          showMessage('결과를 불러오지 못했습니다.', '응답 형식이 올바르지 않습니다. 다시 시도해주세요.', true);
          return;
        }

        try { sessionStorage.setItem(cacheKey(payload), JSON.stringify(res.json)); } catch (e) { /* noop */ }
        renderResult(res.json, { source: 'AI 생성' });
      })
      .catch(function (err) {
        clearTimeout(slowTimer);
        if (err && err.name === 'AbortError') {
          showMessage('응답이 너무 오래 걸립니다.', '다시 시도해주세요.', true);
        } else {
          showMessage('일시적인 문제가 발생했습니다.', '네트워크 상태를 확인한 뒤 다시 시도해주세요.', true);
        }
      })
      .finally(unlockSubmit);
  }

  /* ====================================================================== */
  /*  이벤트                                                                 */
  /* ====================================================================== */

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitForm(false);
    });

    situationEl.addEventListener('input', function () {
      const len = situationEl.value.trim().length;
      countEl.textContent = len.toLocaleString() + ' / 1,000';
      countEl.classList.toggle('is-over', len > MAX_SITUATION);
      if (!errorEl.hidden) clearFormError();
      softSecretAcknowledged = false;
    });

    resetBtn.addEventListener('click', function () {
      form.reset();
      countEl.textContent = '0 / 1,000';
      countEl.classList.remove('is-over');
      clearFormError();
      replace(region, null);
      document.querySelectorAll('.preset').forEach(function (b) { b.classList.remove('is-active'); });
      situationEl.focus();
    });
  }

  window.CRRescue = { renderResult: renderResult };
})();
