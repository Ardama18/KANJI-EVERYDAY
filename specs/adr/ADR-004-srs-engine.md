---
id: ADR-004
feature: srs-engine
type: adr
version: 1.2.0
created: 2026-02-24
status: Accepted
based_on: specs/stories/S-05-srs-engine/requirements.md
related_epic: specs/epics/E-02-core-study-flow/epic.md
---

# ADR-004: S-05 の SRS エンジン契約を決定論優先で固定

## ステータス

Accepted

## コンテキスト

`S-05 srs-engine` は、`S-06`（一覧/概要）と `S-07`（学習セッション）が依存する中核ロジックであり、実装前に「入力が同じなら必ず同じ出力になる」契約を固定する必要がある。

特に、以下の論点は実装者ごとの差異が出やすく、先に設計決定として確定しないと受入条件の再解釈が起きる。

1. `classifyCard` の戻り値を `CardCategory` のみにするか、今日対象外を `null` で明示するか
2. `calculateRating` の時刻依存を関数内部で持つか、引数注入にするか
3. `retryTodayCount` を UTC 日付で扱うか、JST 日付単位でリセットするか
4. `buildSessionQueue` のカテゴリ内順序を保持するか、再ソートするか
5. `newLimit` 異常値をエラー扱いにするか、正規化するか
6. `dequeueCard` が空キューを受けたときに例外化するか、no-op にするか
7. TypeScript 開発ルール（引数 0-2 個）と `calculateRating` / `buildSessionQueue` の位置引数契約をどう整合させるか

## 決定事項

1. `classifyCard` は `CardCategory | null` を返し、`dueDate > today` は必ず `null` とする。
2. `calculateRating` のシグネチャは `calculateRating(state, rating, today, now)` に固定し、`lastReviewedAt` は `now` をそのまま採用する。
3. `retryTodayCount` は JST 日付単位で評価し、`state.lastReviewedAt` の JST 日付が `today` と異なる場合は `0` から再計算する。
4. `buildSessionQueue` は `due/learn/new` の各カテゴリ内部で入力順を保持する。
5. `newLimit` は `floor` 後に `>= 0` へ clamp し、`NaN` を含む無効値は `0` として扱う。
6. `dequeueCard` は指定 source が空配列の場合、内容を変更せず no-op で返す。ただし返却値は必ず新しい `SessionQueue` オブジェクトとする（immutable 契約）。
7. `calculateRating(state, rating, today, now)` の4引数契約と `buildSessionQueue(cards, today, newLimit)` の3引数契約は、TypeScript 開発ルールの「引数は0-2個まで」に対する本ストーリー限定の例外として扱い、仕様互換・呼び出し可読性・純粋関数保証を理由に ADR-004 で管理する。

## 根拠

### 検討した選択肢

#### 選択肢1（採用）: 決定論優先の厳密契約
- 概要
  - 入力注入、`null` 分類、JST 日次判定、順序維持、異常値正規化、no-op を明示契約化する。
- 利点
  - AC と 1:1 で対応しやすく、単体テストを仕様化できる。
  - UI/DB 層から独立した純粋関数性を維持できる。
  - セッション進行の再現性が高く、デバッグ容易性が高い。
- 欠点
  - 例外を返さない設計が多くなり、入力不正の検知責務を呼び出し側に求める。

#### 選択肢2: 実装簡略優先（暗黙時刻・例外ベース）
- 概要
  - `calculateRating` 内部で現在時刻を生成し、`newLimit` 異常値や空キューを例外化する。
- 利点
  - 実装コード量は最小化できる。
  - 一部異常系を即時に表面化できる。
- 欠点
  - 実行タイミング依存でテストが不安定になりやすい。
  - AC（`now` 注入、no-op、正規化）と整合しない。
  - 例外分岐が学習セッション全体の制御を複雑化する。

#### 選択肢3: 最適化優先（再ソート・動的優先度）
- 概要
  - カテゴリ内で独自再ソートを行い、`newLimit` は最適化ロジックに吸収する。
- 利点
  - 将来的な最適化アルゴリズムへ拡張しやすい。
- 欠点
  - 「入力順維持」という現要件と衝突する。
  - MVP では挙動説明コストが高く、検証観点が増える。
  - `S-06/S-07` との契約が不安定化する。

### 比較マトリクス

| 評価軸 | 選択肢1 決定論優先（採用） | 選択肢2 実装簡略優先 | 選択肢3 最適化優先 |
|---|---|---|---|
| S-05 要件適合性 | 高 | 低 | 中 |
| 再現性（同入力=同出力） | 高 | 低 | 中 |
| テスト容易性 | 高 | 低 | 低 |
| 学習体験の一貫性 | 高 | 中 | 低 |
| 実装初期コスト | 中 | 低 | 高 |

### 決定理由

- `requirements.md` の Must 要件（`now` 注入、JST 日次リセット、順序維持、`newLimit` 正規化、空キュー no-op、no-op 時の新規 `SessionQueue` 返却）を矛盾なく満たせるのは選択肢1のみ。
- `S-06/S-07` は SRS ロジックを契約として利用するため、実装簡略よりも観測可能性と再現性を優先する必要がある。
- 日付境界は S-04 の JST ユーティリティ方針と揃えることで、エピック全体の時間解釈の一貫性を保てる。
- `calculateRating` の4引数と `buildSessionQueue` の3引数は、既存仕様互換・呼び出し可読性・責務の明確化（注入値の境界固定）を同時に満たすための意図的契約であり、本ストーリーでは ADR による例外管理を採用する。

## 影響

### ポジティブな影響

- `S-05` 単体テストが仕様検証として機能し、回帰検知の粒度が上がる。
- `classifyCard` の `null` 契約により、今日対象外カードの混入を明示的に防げる。
- キュー挙動が安定し、学習順序の説明可能性が高まる。

### ネガティブな影響

- `newLimit` を例外にせず正規化するため、呼び出し側で入力品質を監視する設計が別途必要になる。
- `CardCategory | null` の採用で、利用側に `null` 分岐処理が必須になる。

### 中立的な影響

- 本 ADR はロジック契約のみを対象とし、DB 永続化・Server Actions・UI 仕様は対象外のまま維持される。

## テスト戦略

1. 契約テスト（最優先）
   - `calculateRating(state, rating, today, now)` の `now` 透過性、level clamp、`again` 上限判定、4引数契約維持を固定値入力で検証する。
   - `buildSessionQueue(cards, today, newLimit)` の3引数契約を前提に `newLimit` 正規化とキュー初期化が成立することを検証する。
2. 境界値テスト
   - `retryTodayCount` の JST 日付切替、`newLimit` の負数/小数/NaN、空キュー no-op（内容不変かつ返却参照が新規 `SessionQueue`）を検証する。
3. 順序保証テスト
   - `buildSessionQueue` がカテゴリ内で入力順を保持し、優先順 `due -> learn -> new -> retry` を崩さないことを検証する。
4. 分類整合テスト
   - `classifyCard` の `null` 分類と `countByCategory` の除外挙動を対で検証する。
5. 純粋関数性テスト
   - 同一入力を複数回与えたときの同一出力性と、入力オブジェクト非破壊性（immutability）を検証する。

## 実装への指針

- S-04 の `frontend/src/lib/date.ts` を唯一の日付演算基盤として利用する。
- SRS ロジックは `frontend/src/lib/srs/*` に集約し、I/O（DB/ネットワーク/時刻取得）を持ち込まない。
- 例外駆動ではなく、仕様で定義した正規化・no-op を優先してセッション継続性を守る。

## 受入条件（EARS）

- 遍在型: システムは `classifyCard` で `dueDate > today` のカードを `null` として分類すること。
- 契機型: `calculateRating(state, rating, today, now)` が実行されたとき、システムは位置引数4つ契約を維持したうえで `lastReviewedAt` に `now` を設定し、内部時刻生成を行わないこと。
- 遍在型: システムは `calculateRating` の4引数契約を TypeScript ルール例外として扱い、仕様互換・可読性・純粋関数保証のため本 ADR で管理すること。
- 遍在型: システムは `buildSessionQueue(cards, today, newLimit)` の3引数契約を TypeScript ルール例外として扱い、仕様互換・可読性・責務境界固定のため本 ADR で管理すること。
- 複合型: `state.lastReviewedAt` の JST 日付が `today` と異なる状態で `again` が評価されたとき、システムは `retryTodayCount` を `0` から再計算して加算すること。
- 遍在型: システムは `buildSessionQueue` でカテゴリ内部の入力順を保持すること。
- 選択型: もし `newLimit` が負数・小数・無効値ならば、システムは `floor -> clamp(>=0)` とし無効値を `0` として扱うこと。
- 不測型: もし `dequeueCard` が空キューを受け取った場合、システムは例外を投げず no-op で返し、返却値として新しい `SessionQueue` オブジェクトを返すこと。

## 参考資料

- `specs/stories/S-05-srs-engine/requirements.md`
- `specs/stories/S-05-srs-engine/story.md`
- `specs/stories/S-04-seed-data-and-utilities/design.md`
- `specs/epics/E-02-core-study-flow/epic.md`

## 関連情報

- `specs/adr/ADR-001-project-foundation-supabase-clients.md`
- `specs/adr/ADR-002-database-schema-rls-access-boundary.md`
- `specs/adr/ADR-003-authentication-flow.md`
