# 要件定義書: TimeCoin向け本日学習ステータスMCP tool

## 1. 正本と前提

- 正本は GitHub issue #71 の本文とコメントである。
- issue 本文の `[S-20]` 表記は外部 issue label として扱う。repository 内には既に別機能の `S-20` / `S-21` が存在するため、本 artifact は `S-22` とする。
- S-19 の `resolveDeckStudyStatus` は `no-cards / todo / limit-reached / done` を pure function で判定する。
- S-14 の Remote MCP 境界は、JWT、audience、active grant、owner RLS を request ごとに検証する。
- 現行 `frontend/src/lib/mcp/tools.ts` は `create_deck` を含む9 tool allowlistを持つ。今回の変更は10件目として `get_daily_study_status` を追加するだけで、既存 tool の contract を壊さない。
- 既存 `decks` table に archive / active field はない。本人所有 deck のうち、カードを1枚以上持つ全 deck を対象にする。

## 2. Must

- REQ-01: MCP tool `get_daily_study_status` を静的 allowlist、descriptor、runtime schema、dispatch、service binding へ追加する。
- REQ-02: tool input は `z.object({}).strict()` で検証し、`userId`、`ownerId`、`date`、`deckId` など追加 field を service 呼び出し前に拒否する。
- REQ-03: query owner は `McpActorContext.userId` だけから導出し、tool input、URL、body、query string 由来の owner/date/deck selector を使わない。
- REQ-04: 今日の日付は server-side の `getTodayJST()` で決める。
- REQ-05: 本人所有 deck を1 queryで取得する。deck query は `owner_user_id = actor.userId` を含め、JWT scoped Supabase client + RLS の境界を維持する。
- REQ-06: 対象 deck の `deck_cards` を最大1 queryで取得し、N+1 query を発生させない。
- REQ-07: unique card 集合に対する actor 本人の `review_states` を最大1 queryで取得し、別 owner / 別 user の review state を集計しない。
- REQ-08: 各 deck は既存 SRS summary と `resolveDeckStudyStatus` で `no-cards / todo / limit-reached / done` に判定する。
- REQ-09: `no-cards` は eligible 対象外とする。
- REQ-10: eligible deck が0件なら `state: "NO_ELIGIBLE_DECKS"`、`completed: false` を返す。
- REQ-11: eligible deck が1件以上かつ1件でも `todo` なら `state: "IN_PROGRESS"`、`completed: false` を返す。
- REQ-12: eligible deck が1件以上かつ全て `done | limit-reached` なら `state: "COMPLETED"`、`completed: true` を返す。
- REQ-13: success data は `contractVersion: 1`、`date`、`state`、`completed` の4 fieldだけにする。
- REQ-14: `date` は server-side JST 当日の `YYYY-MM-DD` 文字列とする。
- REQ-15: tool descriptor は read-only、non-destructive、idempotent とし、既存の exact `openid email profile` OAuth security scheme と `_meta.securitySchemes` mirror を使用する。
- REQ-16: DB failure / unexpected exception は raw error を返さず、既存 `invokeMcpTool` safe wrapper により `INTERNAL_ERROR` へ縮退する。

## 3. Should

- SHOULD-01: query orchestration と pure aggregation は `frontend/src/lib/deck/daily-study-status.ts` に置き、MCP adapter から transport 非依存に呼び出せるようにする。
- SHOULD-02: owned deck 0件、または deck_cards 0件の場合は不要な後続 query を short-circuit してよい。ただし query 上限は常に最大3回とする。
- SHOULD-03: query count と owner boundary は unit/service test で mock chain を通して検証する。
- SHOULD-04: TimeCoin consumer が `contractVersion: 1` を前提にするため、additive であっても output field の追加は本 story の scope で行わない。

## 4. Won't

- WON'T-01: service role client を使わない。
- WON'T-02: DB schema、RLS policy、migration、Database 型を変更しない。
- WON'T-03: OAuth metadata、scope、grant/JWT validation の意味を変更しない。
- WON'T-04: deck ID/name/count、card ID/content/count、学習枚数、残り枚数、review timestamp を MCP response へ返さない。
- WON'T-05: TimeCoin 側の実装、ポイント付与、task 完了、token 保存を行わない。

## 5. 非機能・セキュリティ要件

- NFR-SEC-01: token、raw DB error、SQL、stack、card content、deck name、review timestamp を response、test snapshot、log に出さない。
- NFR-SEC-02: actor owner filter と RLS を併用し、RLS のみを owner 境界にしない。
- NFR-SEC-03: unknown tool や malformed JSON-RPC の protocol handling を変更しない。
- NFR-COMPAT-01: 既存9 toolの schema、descriptor、dispatch、success/error wrapper は破壊的に変更しない。
- NFR-PERF-01: DB round trip は最大3 queryとし、deck 数に比例する N+1 を作らない。
- NFR-DATE-01: JST date boundary は `frontend/src/lib/date.ts` の既存 utility を使い、実行日依存のテストでは clock を固定する。

## 6. AC / 要件対応

| AC | 要件 |
|---|---|
| AC-1 全 eligible 完了なら `COMPLETED/true` | REQ-08, REQ-12, REQ-14 |
| AC-2 `todo` が1件でもあれば `IN_PROGRESS/false` | REQ-08, REQ-11 |
| AC-3 eligible 0件なら `NO_ELIGIBLE_DECKS/false` | REQ-09, REQ-10 |
| AC-4 空 object だけ受理 | REQ-02 |
| AC-5 OAuth actor ownerのみ | REQ-03, REQ-05, REQ-07, NFR-SEC-02 |
| AC-6 success data 4 fieldのみ | REQ-13, WON'T-04 |
| AC-7 raw DB error を返さない | REQ-16, NFR-SEC-01 |
| AC-8 既存MCP境界を変更しない | REQ-15, NFR-COMPAT-01 |

## 7. 未解決事項

- Cross-app E2E は TimeCoin 側 issue #147 と deployment ordering に依存する。本 provider story の実装 gate では contractVersion 1 の provider smoke までを主対象とし、TimeCoin からの実接続は後続 release / cross-app gate に分離する。
