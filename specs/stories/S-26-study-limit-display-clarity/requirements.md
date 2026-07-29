# 要件定義: 学習設定表示の実出題枚数化

## Functional Requirements

- FR-01: デッキ詳細は今日開始される予定総枚数を `plannedDue + plannedLearn + plannedNew` として表示する。
- FR-02: 予定枚数計算は `dailyStudyLimit - studiedToday` を残枠とし、Due、Learn、New の順に割り当てる。
- FR-03: New の予定枚数は `min(rawNewCount, newLimitPerDay, Due/Learn 後の残枠)` とする。
- FR-04: 詳細の学習設定表示は `一日最大N枚 / 新規は最大M枚` のように総上限と新規上限を区別できる文言にする。
- FR-05: 新規カードが上限で抑えられている場合は `新規カードは1日M枚までです` を表示する。
- FR-06: デッキ一覧の新規/復習バッジも、開始予定キューの内訳と一致する値を表示する。
- FR-07: 学習開始キュー生成、SRS 分類、DB schema、Server Action の副作用契約は変更しない。

## Non-Functional Requirements

- NFR-01: 表示計算は `next/headers`、Supabase、現在時刻へ依存しない純粋関数にする。
- NFR-02: 320px 幅相当でも表示が横スクロールや重なりを起こしにくい flex / wrap 構成にする。
- NFR-03: 既存の日本語ラベル、disabled 理由、Show Answer 前の情報非表示契約を変更しない。

## Acceptance Mapping

| AC | Requirement | Verification |
| --- | --- | --- |
| AC-1 | FR-01, FR-02, FR-03 | `study-status.test.ts`, detail page component test |
| AC-2 | FR-04 | detail page component test |
| AC-3 | FR-03, FR-05 | detail page component test |
| AC-4 | FR-02, FR-03 | detail page component test |
| AC-5 | FR-07 | `queue.ts` / `session-actions.ts` unchanged; existing queue tests |
| AC-6 | NFR-02 | responsive class review; component markup test |
