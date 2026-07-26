# 設計書: TimeCoin向け本日学習ステータスMCP tool

## 1. 現行調査

| 対象 | 確認結果 |
|---|---|
| `frontend/src/lib/deck/study-status.ts` | `resolveDeckStudyStatus` が `no-cards / todo / limit-reached / done` を pure function で返す。I/O や暗黙の現在時刻を持たない。 |
| `frontend/src/actions/deck-actions.ts` | owned decks、deck_cards、review_states を最大3 queryで集計し、`countByCategory`、`summarizeDeckStudyState`、`findNextDueDate`、JST reviewed count を組み合わせている。 |
| `frontend/src/lib/srs/classify.ts` | `countByCategory`、`summarizeDeckStudyState`、`findNextDueDate` は CardWithState[] と today だけで動く pure read-only 集計。 |
| `frontend/src/lib/date.ts` | `getTodayJST`、`getJstDateForInstant` があり、S-19 の JST 境界と同じ utility を使える。 |
| `frontend/src/lib/mcp/route-handler.ts` | `McpActorContext` を認証後に作成し、JWT scoped Supabase client と tool services を request ごとに作る。 |
| `frontend/src/lib/mcp/tools.ts` | static allowlist、Zod strict schema、descriptor annotations、OAuth security mirror、safe wrapper を持つ。 |
| `frontend/src/lib/mcp/services.ts` | verified actor と JWT scoped client から service を作る。tool input から owner/source/service-role client を受け取らない。 |
| `frontend/src/lib/mcp/real-db.int.test.ts` | S-14 isolated DB gate があり、環境変数 `S14_TEST_DATABASE_URL` がある場合だけ real DB owner/RLS を検証する。 |

## 2. Scope / Non-goal

本設計は Remote MCP read-only tool を1件追加する。既存 deck UI、SRS schedule、review state mutation、DB schema、RLS、OAuth metadata、grant/JWT validation は変更しない。

新しい contract は TimeCoin consumer issue #147 の provider prerequisite であり、`contractVersion: 1` を固定する。success data は4 fieldだけにし、将来の detail 公開は別 story とする。

## 3. 実装アプローチ

Horizontal layering を採用する。

1. `frontend/src/lib/deck/daily-study-status.ts` で pure aggregation と actor-scoped query service を固定する。
2. `frontend/src/lib/mcp/tools.ts` で strict schema / descriptor / dispatch を追加する。
3. `frontend/src/lib/mcp/services.ts` で verified actor と JWT scoped client から service を接続する。
4. Unit / MCP contract / service / real DB gate を追加する。

UI は変えないため UI review や browser verification は不要。

## 4. Domain contract

### Types

```ts
export type DailyStudyStatusState =
  | "NO_ELIGIBLE_DECKS"
  | "IN_PROGRESS"
  | "COMPLETED";

export type DailyStudyStatusData = Readonly<{
  contractVersion: 1;
  date: string;
  state: DailyStudyStatusState;
  completed: boolean;
}>;
```

### Pure aggregation

`aggregateDailyStudyStatuses(date, deckStatuses)` は DB client や actor を受け取らない pure function とする。入力は deck ごとの `DeckStudyStatusKind` で足りる。

```text
eligible = deckStatuses excluding "no-cards"
eligible.length === 0                  -> NO_ELIGIBLE_DECKS / false
eligible includes "todo"               -> IN_PROGRESS / false
all eligible are "done" | "limit-reached" -> COMPLETED / true
```

`limit-reached` は「本日分の上限まで学習済み」として TimeCoin 共有では完了扱いにする。`no-cards` は空 deck であり、eligible から除外する。

## 5. Query service

### Public function

`frontend/src/lib/deck/daily-study-status.ts` に次を追加する。

```ts
export async function getDailyStudyStatusForActor(
  client: JwtScopedSupabaseClient,
  actor: Pick<McpActorContext, "userId">,
  options?: { now?: Date }
): Promise<DailyStudyStatusData>
```

`options.now` は unit test 用の注入点であり、MCP tool input からは渡さない。production path は `getTodayJST()` を server-side で評価する。

### Query boundary

1. `today = getTodayJST(options?.now)` を確定する。
2. `decks` を1 queryで取得する。
   - select: `id, daily_study_limit`
   - filter: `.eq("owner_user_id", actor.userId)`
   - RLS: JWT scoped client の `auth.uid()` も actor と一致する。
   - deck name は不要なので取得しない。
3. owned decks が0件なら、以降 query なしで `NO_ELIGIBLE_DECKS/false` を返す。
4. `deck_cards` を最大1 queryで取得する。
   - select: `deck_id, card_id`
   - filter: `.in("deck_id", deckIds)`
5. deck_cards が0件なら、以降 query なしで `NO_ELIGIBLE_DECKS/false` を返す。
6. unique `card_id` に対する本人 `review_states` を最大1 queryで取得する。
   - select: `user_id, card_id, level, due_date, last_rating, retry_today_count, last_reviewed_at`
   - filter: `.eq("user_id", actor.userId).in("card_id", uniqueCardIds)`
7. deck ごとに `CardWithState[]` を作り、既存 pure functions へ渡す。

### Deck status derivation

各 deck の input は次で作る。

```text
counts = countByCategory(cards, today)
summary = summarizeDeckStudyState(cards, today)
studiedToday = unique cards whose reviewState.lastReviewedAt JST date === today
nextDueDate = findNextDueDate(cards, today)

resolveDeckStudyStatus({
  totalCards: summary.totalCards,
  todayCount: counts.new + counts.learn + counts.due,
  studiedToday,
  dailyStudyLimit: deck.daily_study_limit,
  nextDueDate,
  today,
})
```

`studiedToday` は S-19 と同じ `getJstDateForInstant(lastReviewedAt) === today` のユニークカード数とする。既存 helper は `deck-actions.ts` private なので、実装時は new module 内に同じ pure helper を置き、unit test で JST 境界を固定する。UI action の refactor は本 story の必須範囲外とし、blast radius を抑える。

## 6. MCP tool contract

### Schema / descriptor

`frontend/src/lib/mcp/tools.ts`:

- `mcpToolInputSchemas.get_daily_study_status = z.object({}).strict()`
- `McpToolServices` に `getDailyStudyStatus: () => Promise<unknown>` を追加。
- `MCP_TOOL_NAMES` に `get_daily_study_status` を追加する。既存9件の順序と contract を維持し、new read tool は `list_decks` の後に置く。
- descriptor:
  - description: `本日の学習完了ステータスを取得`
  - annotations: `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true }`
  - securitySchemes / `_meta.securitySchemes`: 既存 `oauthSecurity`
- `executeKnownTool` で service を呼ぶ。

### Success result

既存 wrapper により response は次になる。

```json
{
  "ok": true,
  "data": {
    "contractVersion": 1,
    "date": "2026-07-26",
    "state": "COMPLETED",
    "completed": true
  }
}
```

`data` に deck/card/study count、name、ID、review timestamp、raw DB detail を追加しない。

### Error result

Zod validation failure は既存通り `VALIDATION_ERROR` tool result とする。service 内の DB error や unexpected exception は throw して `invokeMcpTool` の catch に任せ、`INTERNAL_ERROR` へ縮退させる。raw Supabase error message は戻り値に含めない。

## 7. Service binding

`frontend/src/lib/mcp/services.ts`:

- `createMcpToolServices` の dependencies は既存の `actor` と `client` をそのまま使う。
- `getDailyStudyStatus: async () => await getDailyStudyStatusForActor(client, actor)`
- tool input から owner/date/deck selector を受け取らない。
- service role client、env secret、TimeCoin client ID は不要。

## 8. Security / privacy

- Authentication failure は既存 route-handler の HTTP 401 で tool dispatch 前に止まる。
- Authorization は verified actor、active grant、JWT scoped Supabase client、RLS、explicit `owner_user_id = actor.userId` filter を併用する。
- `review_states` は actor user ID で絞る。他 user の学習履歴を同じ card ID から混入しない。
- deck/card detail を output へ出さないため、TimeCoin には completion fact だけが渡る。
- No service role、No tenant bypass、No client-supplied owner/date。

## 9. Impact map

| 影響 | ファイル | 内容 |
|---|---|---|
| 直接 | `frontend/src/lib/deck/daily-study-status.ts` | 新規 daily status data type、pure aggregator、actor-scoped query service |
| テスト | `frontend/src/lib/deck/daily-study-status.test.ts` | 0 deck、empty deck、all done、all limit、一部 todo、mixed、JST date |
| 直接 | `frontend/src/lib/mcp/tools.ts` | schema、allowlist、descriptor、dispatch、service interface |
| 直接 | `frontend/src/lib/mcp/services.ts` | verified actor binding |
| テスト | `frontend/src/lib/mcp/tools.test.ts` | 10 tool allowlist、strict input、annotations、wrapper、safe error |
| テスト | `frontend/src/lib/mcp/services.test.ts` | actor owner、query count、short circuit、DB failure/privacy |
| テスト | `frontend/src/lib/mcp/route-contract.test.ts` | existing route compatibility and service mock shape |
| テスト | `frontend/src/lib/mcp/real-db.int.test.ts` | owner A/B separation and OAuth actor call when isolated DB is available |
| 非影響 | `supabase/**` | schema/RLS/migration 変更なし |
| 非影響 | OAuth metadata/env | scope、issuer、resource、grant/JWT validation 変更なし |
| 非影響 | deck UI | `/decks`、deck detail、study flow 表示変更なし |

## 10. Test strategy

| Level | 対象 | ケース |
|---|---|---|
| L1 Unit | daily aggregation | 0 deck、empty deck、all done、all limit、一部 todo、mixed no-cards+done、JST date |
| L1 MCP unit | tools | allowlist、strict input override拒否、descriptor annotations、success wrapper 4 field、throw -> `INTERNAL_ERROR` |
| L2 Service | services/daily query | actor owner filter、最大3 query、owned deck 0 short circuit、deck_cards 0 short circuit、DB failure raw detail非返却 |
| L2 Route contract | route-handler/server | existing tools/list/call compatibility、service mock shape更新、unknown tool/auth境界不変 |
| L2 Real DB | isolated S-14 DB | owner A/B deck/review分離、OAuth actor call、別owner card/review混入なし |
| L3 Cross-app | TimeCoin | TimeCoin issue #147 側で provider deployment 後に `IN_PROGRESS` / `COMPLETED` 取得 |

実装完了時の通常 gate は `npm --prefix frontend run check`。Route/bundling へ影響するため `npm --prefix frontend run build` も実行する。

## 11. Rollout / rollback

- Rollout: provider 側の本 tool を先に deploy する。TimeCoin consumer は `contractVersion: 1` を前提に接続する。
- Rollback: 問題があれば `get_daily_study_status` を `MCP_TOOL_NAMES` / descriptor / dispatch allowlist から外す forward-fix で停止する。既存 tool と OAuth metadata は変更しないため、既存 MCP client の rollback は不要。

## 12. Unresolved risks

- Cross-app E2E は TimeCoin provider deployment と consumer issue #147 に依存する。
- Current repository では issue label `[S-20]` と story artifact ID が一致しない。実装時の PR body では `S-22 artifact / issue S-20 label` を明示する。
