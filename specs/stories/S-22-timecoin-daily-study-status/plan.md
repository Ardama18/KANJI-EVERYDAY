# 実行計画: TimeCoin向け本日学習ステータスMCP tool

## Phase 1: Daily status domain/service

- 対象要件: REQ-03〜14, REQ-16, NFR-SEC-01〜02, NFR-PERF-01, NFR-DATE-01
- 対象ファイル:
  - `frontend/src/lib/deck/daily-study-status.ts`
  - `frontend/src/lib/deck/daily-study-status.test.ts`
- 実装内容:
  - `DailyStudyStatusState`、`DailyStudyStatusData`、`aggregateDailyStudyStatuses` を追加する。
  - `getDailyStudyStatusForActor(client, actor, options?)` を追加する。
  - server-side JST date を `getTodayJST(options?.now)` で確定する。
  - owned decks を `owner_user_id = actor.userId` で取得する。
  - `deck_cards` と actor 本人の `review_states` を最大1 queryずつ取得し、N+1 を作らない。
  - `countByCategory`、`summarizeDeckStudyState`、`findNextDueDate`、`resolveDeckStudyStatus` を使って deck status を作る。
  - success data は4 fieldだけを返す。
- 完了条件:
  - eligible 0、all done、all limit、todo混在、no-cards混在の集約結果が要件通り。
  - JST reviewed count は `getJstDateForInstant(lastReviewedAt) === today` のユニーク card 数。
  - owned deck 0件、deck_cards 0件は後続 query を short-circuit できる。
  - DB failure は raw detail を戻り値に含めない。
- 検証:
  - `npm --prefix frontend test -- src/lib/deck/daily-study-status.test.ts`

## Phase 2: MCP schema / descriptor / dispatch

- 対象要件: REQ-01〜02, REQ-13, REQ-15, NFR-COMPAT-01
- 対象ファイル:
  - `frontend/src/lib/mcp/tools.ts`
  - `frontend/src/lib/mcp/tools.test.ts`
  - `frontend/src/lib/mcp/server.test.ts`
- 実装内容:
  - `mcpToolInputSchemas.get_daily_study_status = z.object({}).strict()` を追加する。
  - `McpToolServices` に `getDailyStudyStatus: () => Promise<unknown>` を追加する。
  - `MCP_TOOL_NAMES` へ `get_daily_study_status` を追加する。既存9 toolは削除・改名しない。
  - descriptor は read-only true、destructive false、idempotent true とし、既存 `oauthSecurity` を使う。
  - `executeKnownTool` で `services.getDailyStudyStatus()` を呼ぶ。
  - service mocks を10 tool対応へ更新する。
- 完了条件:
  - tools/list は既存9件 + `get_daily_study_status` の10件を返す。
  - owner/date/deck override を含む input は service 呼び出し前に `VALIDATION_ERROR`。
  - success wrapper の `structuredContent` は `{ ok: true, data: { contractVersion, date, state, completed } }`。
  - service throw は `INTERNAL_ERROR` tool result になり、raw error を返さない。
- 検証:
  - `npm --prefix frontend test -- src/lib/mcp/tools.test.ts src/lib/mcp/server.test.ts`

## Phase 3: MCP service binding

- 対象要件: REQ-03, REQ-05〜07, REQ-16, NFR-SEC-01〜02
- 対象ファイル:
  - `frontend/src/lib/mcp/services.ts`
  - `frontend/src/lib/mcp/services.test.ts`
- 実装内容:
  - `createMcpToolServices` に `getDailyStudyStatus` を追加し、`getDailyStudyStatusForActor(client, actor)` を呼ぶ。
  - service dependency や tool input から owner/date/deck selector を受け取らない。
  - services test に actor owner固定、query count、short circuit、DB failure privacy を追加する。
- 完了条件:
  - `actor.userId` だけが deck/review query owner として使われる。
  - `client.from("decks")`、`client.from("deck_cards")`、`client.from("review_states")` の最大3 table accessで完了する。
  - raw DB message、SQL、token、deck/card detail が failure result に含まれない。
- 検証:
  - `npm --prefix frontend test -- src/lib/mcp/services.test.ts`

## Phase 4: Route contract and real DB gates

- 対象要件: AC-5, AC-8, NFR-COMPAT-01
- 対象ファイル:
  - `frontend/src/lib/mcp/route-contract.test.ts`
  - `frontend/src/lib/mcp/real-db.int.test.ts`
- 実装内容:
  - route-contract の service mock shape を10 toolへ更新し、既存 auth/protocol boundary tests を維持する。
  - real DB integration に owner A/B 分離の `get_daily_study_status` ケースを追加する。
  - isolated DB URL がない場合は既存 pattern 通り skip し、未実施範囲を報告する。
- 完了条件:
  - authenticated owner A call は owner A の deck/review だけで state を返す。
  - owner B deck/review が同一 card ID または deck ID input override から混入しない。
  - existing route auth/challenge/unknown-tool behavior は変更されない。
- 検証:
  - `npm --prefix frontend test -- src/lib/mcp/route-contract.test.ts`
  - 環境がある場合: `S14_TEST_DATABASE_URL=<isolated> npm --prefix frontend test -- src/lib/mcp/real-db.int.test.ts`

## Phase 5: Full quality gate

- 対象要件: 全AC
- 対象ファイル:
  - 変更全体
- 実装内容:
  - focused tests の後に全体 gate を実行する。
  - build で Next route/server boundary を確認する。
  - diff scope に DB migration、OAuth metadata、既存 tool contract の破壊的変更がないことを確認する。
- 完了条件:
  - `npm --prefix frontend run check` 成功。
  - `npm --prefix frontend run build` 成功。
  - `git diff --check` 成功。
  - `git status --short supabase frontend/src/lib/mcp/metadata.ts frontend/src/lib/mcp/auth.ts frontend/src/lib/mcp/route-handler.ts` を確認し、意図しない auth/metadata/schema/migration 変更がない。
- 検証:
  - `npm --prefix frontend run check`
  - `npm --prefix frontend run build`
  - `git diff --check`

## Phase 6: Provider smoke / cross-app handoff

- 対象要件: rollout, TimeCoin consumer dependency
- 対象ファイル:
  - PR body / verification note
- 実装内容:
  - provider deployment 後、OAuth actor call で `NO_ELIGIBLE_DECKS`、`IN_PROGRESS`、`COMPLETED` のうち少なくとも2状態を sanitized evidence として記録する。
  - TimeCoin issue #147 には provider deployment URL、contractVersion 1、未公開の token/card/deck detail を含まない確認結果だけを渡す。
- 完了条件:
  - Provider issue #71 の PR verification に repo tests と provider smoke の境界が明記される。
  - TimeCoin 側 E2E は consumer issue の gate として残す。
- 検証:
  - 手動 / external client smoke。token、raw response headers、deck/card content は記録しない。

## AC / 検証対応

| AC | 主な検証 |
|---|---|
| AC-1 全 eligible 完了 | Phase 1 unit、Phase 4 real DB |
| AC-2 todo 混在 | Phase 1 unit、Phase 4 real DB |
| AC-3 eligible 0 | Phase 1 unit/service short circuit |
| AC-4 strict input | Phase 2 tools test |
| AC-5 actor owner | Phase 1 service query assertions、Phase 4 real DB |
| AC-6 success data 4 field | Phase 1 unit、Phase 2 wrapper test |
| AC-7 safe internal error | Phase 2/3 failure tests |
| AC-8 existing MCP境界不変 | Phase 2 tools/server、Phase 4 route-contract、Phase 5 check/build |

## 実装時の注意

- `tasks/` や個別 task file は作成しない。
- `supabase/**`、OAuth metadata、MCP auth/JWT/grant validation は変更しない。
- `create_deck` を含む既存9 toolを削除・改名・並び替えで破壊しない。
- success data に count や detail を追加しない。TimeCoin が必要に見えても contractVersion 1 では禁止する。
- service role client を使わない。
- raw Supabase error、SQL、token、card content、deck name を MCP result/log/test snapshot に出さない。
