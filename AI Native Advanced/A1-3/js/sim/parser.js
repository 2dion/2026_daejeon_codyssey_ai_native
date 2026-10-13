/* ==========================================================================
   parser.js — 실습실 명령 파서

   허용 목록 방식이다. 여기 없는 명령은 실행하지 않는다.
   모르는 명령을 조용히 무시하면 사용자는 자기가 오타를 냈는지, 이 실습실이
   모르는 것인지 구분할 수 없다. 그래서 이유를 붙여 돌려준다.

   셸에 넘기는 것이 아니라 아래 엔진이 직접 해석하므로 주입 위험은 없다.
   다만 파싱 결과가 화면에 그대로 나가므로, 렌더링 쪽에서 전부 이스케이프한다.
   ========================================================================== */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CRParse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* 지원하는 하위 명령과, 각 명령이 아는 옵션.
     값은 옵션이 값을 하나 더 먹는지 여부다. */
  const SUPPORTED = {
    init:    {},
    status:  { '-s': false, '--short': false },
    add:     { '-A': false, '--all': false },
    commit:  { '-m': true, '--message': true, '--amend': false, '--no-edit': false, '-a': false },
    log:     { '--oneline': false, '--graph': false, '--all': false, '--decorate': false, '-n': true },
    diff:    { '--staged': false, '--cached': false },
    restore: { '--staged': false, '--source': true },
    branch:  { '-d': true, '-D': true, '-a': false, '-v': false, '--list': false },
    switch:  { '-c': true, '-C': true },
    remote:  { '-v': false, '--verbose': false },
    fetch:   { '--all': false },
    push:    { '-u': false, '--set-upstream': false, '--force': false, '-f': false },
    pull:    { '--ff-only': false, '--no-rebase': false, '--rebase': false },
    merge:   { '--abort': false, '--no-ff': false, '--ff-only': false },
    reset:   { '--soft': false, '--mixed': false, '--hard': false },
    revert:  { '--no-edit': false, '--abort': false },
    stash:   { '-u': false, '--include-untracked': false, '-m': true, '--message': true },
    rebase:  { '--continue': false, '--abort': false, '--skip': false, '--onto': true },
    worktree: { '--force': false, '-f': false, '-b': true }
  };

  /* 이 실습실이 다루지 않기로 한 명령. 오타로 오해하지 않게 따로 안내한다. */
  const OUT_OF_SCOPE = {
    'cherry-pick': 'cherry-pick은 아직 실습실에서 다루지 않습니다.',
    reflog:     'reflog는 아직 실습실에서 다루지 않습니다. 명령어 사전에서 설명을 볼 수 있습니다.',
    clone:      'clone은 이미 만들어진 저장소를 통째로 받아오는 명령이라, 시작 상태를 고르는 실습실과 맞지 않습니다.',
    checkout:   'checkout 대신 switch(작업본 이동)와 restore(파일 되돌리기)를 씁니다. 하는 일이 갈라져 있어 덜 헷갈립니다.',
    config:     'config는 저장소 설정을 바꾸는 명령이라 5칸 어디도 바꾸지 않습니다. 실습실에서는 다루지 않습니다.'
  };

  /**
   * 따옴표를 인식하는 토크나이저.
   * @returns {string[]|null} 따옴표가 닫히지 않았으면 null
   */
  function tokenize(input) {
    const out = [];
    let cur = '', quote = null, started = false;

    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (quote) {
        if (ch === quote) quote = null;
        else cur += ch;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
      if (/\s/.test(ch)) {
        if (started || cur) { out.push(cur); cur = ''; started = false; }
        continue;
      }
      cur += ch;
    }
    if (quote) return null;
    if (started || cur) out.push(cur);
    return out;
  }

  /**
   * @param {string} input 사용자가 친 한 줄
   * @returns {{ok:true, name:string, flags:Object, args:string[], raw:string}
   *          |{ok:false, reason:string, message:string, raw:string}}
   */
  function parse(input) {
    const raw = String(input == null ? '' : input).trim();
    const fail = function (reason, message) { return { ok: false, reason: reason, message: message, raw: raw }; };

    if (!raw) return fail('empty', '명령을 입력해주세요.');

    const tokens = tokenize(raw);
    if (!tokens) return fail('quote', '따옴표가 닫히지 않았습니다. 커밋 메시지에 따옴표를 쓸 때 짝을 맞춰주세요.');
    if (!tokens.length) return fail('empty', '명령을 입력해주세요.');

    if (tokens[0] !== 'git') {
      return fail('not-git',
        '이 실습실은 git 명령만 실행합니다. ' +
        '`' + tokens[0] + '`처럼 다른 프로그램은 여기서 돌아가지 않습니다.');
    }

    const name = tokens[1];
    if (!name) return fail('empty', '어떤 git 명령을 실행할지 함께 적어주세요. 예: `git status`');

    if (Object.prototype.hasOwnProperty.call(OUT_OF_SCOPE, name)) {
      return fail('out-of-scope', OUT_OF_SCOPE[name]);
    }
    if (!Object.prototype.hasOwnProperty.call(SUPPORTED, name)) {
      return fail('unknown', '`git ' + name + '`은 이 실습실이 아직 모르는 명령입니다. ' +
        '입력창을 비우고 누르면 쓸 수 있는 명령이 아래에 나옵니다.');
    }

    const spec = SUPPORTED[name];
    const flags = {};
    const args = [];

    for (let i = 2; i < tokens.length; i++) {
      const t = tokens[i];

      /* `-m메시지`, `--message=메시지` 처럼 붙여 쓴 형태도 받아준다 */
      let key = t, inlineValue = null;
      const eq = t.indexOf('=');
      if (t.slice(0, 2) === '--' && eq > 2) { key = t.slice(0, eq); inlineValue = t.slice(eq + 1); }

      if (key[0] !== '-') { args.push(t); continue; }

      if (!Object.prototype.hasOwnProperty.call(spec, key)) {
        return fail('unknown-option',
          '`git ' + name + '`에 붙은 `' + key + '`는 이 실습실이 아직 모르는 옵션입니다. ' +
          '실제 git에는 있을 수 있지만 여기서는 다루지 않습니다.');
      }

      if (spec[key]) {
        const value = inlineValue !== null ? inlineValue : tokens[++i];
        if (value === undefined) {
          return fail('missing-value', '`' + key + '` 뒤에 값이 필요합니다.');
        }
        flags[key] = value;
      } else {
        if (inlineValue !== null) return fail('unknown-option', '`' + key + '`는 값을 받지 않는 옵션입니다.');
        flags[key] = true;
      }
    }

    return { ok: true, name: name, flags: flags, args: args, raw: raw };
  }

  return { parse: parse, tokenize: tokenize, SUPPORTED: SUPPORTED, OUT_OF_SCOPE: OUT_OF_SCOPE };
});
