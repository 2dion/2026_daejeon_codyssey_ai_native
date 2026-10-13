/* ==========================================================================
   scenario-map.js — AI 결과의 `그래프템플릿` → 실습실 시나리오

   이 표만 따로 떼어 둔 이유는 index.html 때문이다.
   문제 해결 화면은 "이 상황을 실습실에서 해보기" 링크를 붙일지 말지만 알면 되는데,
   그걸 위해 상태 엔진과 시나리오 전체를 첫 화면에 딸려 보내면
   실습실을 별도 페이지로 뺀 의미가 없어진다. 여기는 표 하나뿐이다.

   ── 왜 AI 응답에 새 필드를 만들지 않았나 ─────────────────────────────────
   `그래프템플릿`은 이미 상황을 식별하고, 이미 서버(api/rescue.py)와 화면 양쪽에서
   허용 목록으로 검증된다. 재현용 필드를 새로 만들면 AI 가 채우는 값이 하나 늘고
   검증할 표면도 하나 는다. 이미 믿을 수 있게 만들어 둔 값을 다시 쓴다.

   대응하는 시나리오가 없으면 여기 없는 것이 맞다 — 재현 버튼을 붙이지 않는다.
   억지로 아무 상태나 만들어 보여주지 않는 것이 이 서비스의 기존 원칙이다.
   ========================================================================== */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CRScenarioMap = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TEMPLATE_TO_SCENARIO = {
    'amend-add-file': 'amend-add-file',
    'amend-message': 'amend-message',
    'restore-staged': 'restore-staged',
    'restore-worktree': 'restore-worktree',
    'revert-pushed': 'revert-pushed',
    'reset-soft': 'reset-soft',
    'non-fast-forward': 'non-fast-forward',
    'fetch-updates-origin': 'fetch-updates-origin',
    'wrong-branch': 'wrong-branch'
    /* merge-conflict · stash-switch 는 대응하는 그래프 템플릿이 없다.
       템플릿을 억지로 만들어 붙이지 않는다 — 실습실 목록에서는 고를 수 있다. */
  };

  /** @returns {string|null} 재현할 시나리오 id, 없으면 null */
  function scenarioFor(templateId) {
    /* hasOwnProperty 로 본다. 'constructor' 같은 값이 오면
       프로토타입 체인에서 엉뚱한 것이 잡힌다 (README §8 의 riskBadge 와 같은 함정). */
    return Object.prototype.hasOwnProperty.call(TEMPLATE_TO_SCENARIO, templateId)
      ? TEMPLATE_TO_SCENARIO[templateId]
      : null;
  }

  return { TEMPLATE_TO_SCENARIO: TEMPLATE_TO_SCENARIO, scenarioFor: scenarioFor };
});
