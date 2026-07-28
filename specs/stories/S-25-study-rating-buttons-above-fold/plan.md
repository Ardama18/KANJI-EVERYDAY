# S-25 Implementation Plan

## Phase 1: Story Artifact

- 対象要件: 全体 traceability
- 対象ファイル:
  - `specs/stories/S-25-study-rating-buttons-above-fold/meta.json`
  - `specs/stories/S-25-study-rating-buttons-above-fold/story.md`
  - `specs/stories/S-25-study-rating-buttons-above-fold/requirements.md`
  - `specs/stories/S-25-study-rating-buttons-above-fold/design.md`
  - `specs/stories/S-25-study-rating-buttons-above-fold/plan.md`
- 実装内容:
  - Issue #80 用に次の story ID `S-25` を作成する。
  - AC、non-goal、検証方針を最小限で記録する。
- 完了条件:
  - `tasks/` や個別 task file を作成しない。

## Phase 2: Study Back Layout

- 対象要件: REQ-01, REQ-02, REQ-03, SHOULD-01, SHOULD-02
- 対象ファイル:
  - `frontend/src/components/study/CardBack.tsx`
  - `frontend/src/components/study/CardBack.test.tsx`
- 実装内容:
  - `CardBack` root を `.app-page` padding と整合する viewport height にする。
  - 裏面本文領域だけを `overflow-y-auto` にし、評価ボタン領域を `sticky bottom-0` の action area にする。
  - Markup test で layout contract を固定する。
- 完了条件:
  - イラストやニーモニック説明がある fixture でも評価ラベルが表示される。
  - DOM 順序は既存どおり本文の後に評価ボタンを置く。

## Phase 3: Rating Button Accessibility

- 対象要件: REQ-04, REQ-05, REQ-06, REQ-07
- 対象ファイル:
  - `frontend/src/components/study/RatingButtons.tsx`
  - `frontend/src/components/study/RatingButtons.test.tsx`
- 実装内容:
  - 既存の rating order と labels を維持する。
  - 各 button に 48px 以上の minimum touch target と明示的な focus-visible style を付ける。
  - Test で `type="button"` と class contract を確認する。
- 完了条件:
  - `onRate` の呼び出し順と rating 値が変わらない。

## Phase 4: Verification

- 対象要件: 全 AC
- 検証:
  - `npm --prefix frontend run test -- src/components/study/CardBack.test.tsx src/components/study/RatingButtons.test.tsx`
  - `npm --prefix frontend run lint`
  - `npm --prefix frontend run typecheck`
  - `npm --prefix frontend run build`
- UI確認:
  - Playwright は導入されていないため、可能なら local browser で `320x667` 相当と desktop 幅を確認する。
  - 実ブラウザ確認できない場合は、未実施理由と期待手順を記録する。
