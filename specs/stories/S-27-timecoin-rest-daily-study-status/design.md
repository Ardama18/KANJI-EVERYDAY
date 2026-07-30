---
story_id: S-27
title: timecoin-rest-daily-study-status
type: design
version: 1.0.0
created: 2026-07-30
based_on: specs/stories/S-27-timecoin-rest-daily-study-status/requirements.md
---

# 設計書: TimeCoin連携用REST daily study status API

## 1. 合意事項

- REST API を追加し、MCP endpoint の追加改修には逸れない。
- actor は Bearer OAuth access token から決める。
- request から owner/date/deck/card selector を受け取らない。
- 既存 daily status 集計を再利用し、service role は使わない。
- 成功 response は contractVersion 1 の4 fieldだけに固定する。
- TimeCoin OAuth client 登録、callback URL、client id / secret 設定は運用上の未決事項として残す。

## 2. 現行調査

| 対象 | 確認結果 |
|---|---|
| `frontend/src/lib/deck/daily-study-status.ts` | `DailyStudyStatusData`、`aggregateDailyStudyStatuses`、`getDailyStudyStatusForActor(client, actor, options?)` が存在する。owned decks、deck_cards、review_states を actor user ID で集計し、4 fieldだけを返す。 |
| `frontend/src/lib/deck/daily-study-status.test.ts` | eligible 0、todo、completed、JST date、actor owner filter、4 field、sanitized DB error の unit test がある。 |
| `frontend/src/lib/supabase/server.ts` | `createJwtScopedClient(accessToken)` が anon key + accessToken callback で RLS 境界の Supabase client を作る。service role factory とは分離されている。 |
| `frontend/src/lib/mcp/auth.ts` | Bearer parsing、Supabase `auth.getClaims` / `auth.getUser`、issuer/claim validation、unauthorized response の既存例がある。MCP audience/resource 前提は REST API にはそのまま流用しない。 |
| `frontend/src/lib/mcp/route-handler.ts` | fail closed、CORS、content negotiation、safe response、dependency injection の route handler pattern がある。MCP protocol 固有処理は REST API へ持ち込まない。 |
| `frontend/src/lib/env.ts` / `frontend/src/lib/env.test.ts` | exact true flag、https origin、issuer URL parsing の既存 pattern がある。TimeCoin REST env もここに追加する。 |
| `frontend/app/api/*/route.ts` | App Router route handler は `frontend/app/api/.../route.ts` に配置される。 |

## 3. 実装アプローチ

Hybrid を採用する。まず REST 専用 env/auth/route handler 境界を小さく固定し、その後に `GET /api/timecoin/daily-study-status` の垂直 slice を通す。

MCP handler を共用・改造すると protocol error、MCP audience、tool dispatch の前提が混入するため、REST 専用 `frontend/src/lib/timecoin/daily-study-status-route.ts` と `frontend/src/lib/timecoin/auth.ts` を追加する。共用するのは Bearer token の考え方、Supabase Auth 検証 pattern、`createJwtScopedClient`、`getDailyStudyStatusForActor` に限定する。

## 4. API contract

### Request

```http
GET /api/timecoin/daily-study-status
Authorization: Bearer <KANJI OAuth access token>
Accept: application/json
```

- Query string は空でなければならない。
- Request body は使わない。
- Cookie は認証に使わない。
- `Origin` は CORS 用にだけ使い、actor 判定には使わない。

### Success response

```json
{
  "contractVersion": 1,
  "date": "YYYY-MM-DD",
  "state": "NO_ELIGIBLE_DECKS",
  "completed": false
}
```

`Response.json(statusData, { headers })` へ渡す object は `getDailyStudyStatusForActor` の戻り値を allowlist projection したものにする。将来 `DailyStudyStatusData` に field が増えても、この REST contract には自動で漏らさない。

### Error response

| 状態 | HTTP | Body | 備考 |
|---|---:|---|---|
| disabled / env invalid | 404 | empty | fail closed。DB/auth/service は呼ばない。 |
| disallowed origin | 403 | `{ "error": "forbidden" }` | raw detail なし。 |
| query parameterあり | 400 | `{ "error": "bad_request" }` | selector を認証前に拒否。 |
| missing/invalid token | 401 | `{ "error": "unauthorized" }` | `WWW-Authenticate: Bearer scope="openid email profile"`。 |
| unacceptable Accept | 406 | `{ "error": "not_acceptable" }` | JSON 非対応のみ。 |
| method mismatch | 405 | empty | `Allow: GET, OPTIONS`。 |
| daily status failure | 500 | `{ "error": "internal_error" }` | raw DB error、token、secret は返さない。 |

すべて `Cache-Control: no-store` を付ける。Allowed origin がある場合は success/error に `Access-Control-Allow-Origin` を付ける。

## 5. Env contract

`frontend/src/lib/env.ts` に追加する。

```ts
export interface TimeCoinApiEnvConfig {
  readonly enabled: boolean;
  readonly allowedOrigin: string;
  readonly oauthIssuer: string;
}

export function getTimeCoinApiEnvConfig(): TimeCoinApiEnvConfig
export function isTimeCoinApiEnabled(): boolean
```

- `TIMECOIN_API_ENABLED` は trim 後 exact `true` だけ有効。
- `TIMECOIN_API_ALLOWED_ORIGIN` は `https:` origin で、path/search/hash/userinfo を拒否する。
- `TIMECOIN_API_OAUTH_ISSUER` は `https:` URL で、pathname `/auth/v1`、search/hash/userinfo なしを要求する。
- env 値そのものの secret はないが、docs/test/log に token や client secret は記録しない。

## 6. Auth boundary

`frontend/src/lib/timecoin/auth.ts` を追加する。

```ts
export type TimeCoinActorContext = Readonly<{
  userId: string;
  issuer: string;
}>;

export interface TimeCoinAuthDependencies {
  readonly issuer: string;
  readonly nowSeconds: number;
  readonly verifyJwt: (token: string) => Promise<{ header: unknown; claims: unknown }>;
  readonly getCurrentUserId: (token: string) => Promise<string | null>;
}
```

Default dependencies は `getPublicEnvConfig()` の Supabase URL / anon key で `createClient(...).auth.getClaims(token)` と `auth.getUser(token)` を呼ぶ。検証内容は次に限定する。

- Bearer token は Authorization header 1つだけから取得する。
- JWT header algorithm は RS256 / ES256 allowlist とし、`kid` を要求する。
- `claims.iss === TIMECOIN_API_OAUTH_ISSUER`。
- `claims.role === "authenticated"`。
- `claims.sub` は UUID。
- `claims.exp` は現在時刻より未来。`nbf` があれば現在時刻以前。
- `auth.getUser(token)` の user id が `claims.sub` と一致する。
- audience は Supabase Data API/RLS 互換の `authenticated` を許容する。MCP resource audience は REST API 要件に含めない。

`client_id` の allowlist はこの story では導入しない。TimeCoin client の登録と secret は Supabase OAuth Server / timecoin-cloud 側の運用境界であり、KANJI REST API は有効な KANJI OAuth access token の actor だけを信頼する。

## 7. Route handler

`frontend/src/lib/timecoin/daily-study-status-route.ts` に依存注入可能な handler を置く。

```ts
export interface TimeCoinDailyStatusRouteDependencies {
  readonly isEnabled: () => boolean;
  readonly getEnv: typeof getTimeCoinApiEnvConfig;
  readonly authenticate: (authorization: readonly string[]) => Promise<TimeCoinActorContext>;
  readonly parseToken: (authorization: readonly string[]) => string;
  readonly createClient: (accessToken: string) => JwtScopedSupabaseClient;
  readonly getStatus: (
    client: JwtScopedSupabaseClient,
    actor: Pick<TimeCoinActorContext, "userId">
  ) => Promise<DailyStudyStatusData>;
}
```

Flow:

```text
isEnabled/env parse
  -> origin/CORS boundary
  -> OPTIONS returns 204
  -> method must be GET
  -> query string must be empty
  -> Accept must allow JSON
  -> parse + authenticate Bearer
  -> createJwtScopedClient(token)
  -> getDailyStudyStatusForActor(client, actor)
  -> project 4 fields
  -> Response.json(..., no-store)
```

`frontend/app/api/timecoin/daily-study-status/route.ts` は `runtime = "nodejs"`、`GET`、`OPTIONS` を export し、handler へ委譲する。POST/PUT/DELETE は 405 とするため、必要なら同じ handler を各 method export から呼ぶか Next の default 405 に依存せず明示する。

## 8. 統合境界

```yaml
境界名: TimeCoin REST HTTP
  入力: GET request headers, no query
  出力: DailyStudyStatusData 4 fields
  エラー時: safe JSON error or empty fail-closed response

境界名: OAuth token verification
  入力: Authorization Bearer token
  出力: TimeCoinActorContext.userId
  エラー時: HTTP 401, no raw token/detail

境界名: Supabase data access
  入力: verified access token, actor.userId
  出力: DailyStudyStatusData
  エラー時: handler catches and returns internal_error
```

## 9. 変更影響マップ

| 影響 | ファイル | 内容 |
|---|---|---|
| 直接 | `frontend/app/api/timecoin/daily-study-status/route.ts` | REST endpoint の GET/OPTIONS/method exports |
| 直接 | `frontend/src/lib/timecoin/auth.ts` | REST 用 OAuth Bearer token 検証 |
| 直接 | `frontend/src/lib/timecoin/daily-study-status-route.ts` | env/CORS/query/auth/client/status/response orchestration |
| 直接 | `frontend/src/lib/env.ts` | TimeCoin REST env parser |
| テスト | `frontend/src/lib/timecoin/auth.test.ts` | token parsing、claim validation、getUser一致、401条件 |
| テスト | `frontend/src/lib/timecoin/daily-study-status-route.test.ts` | fail closed、CORS、query拒否、401、4 field projection、500 safe error |
| テスト | `frontend/src/lib/env.test.ts` | TimeCoin env parse |
| 再利用 | `frontend/src/lib/deck/daily-study-status.ts` | 既存集計をそのまま利用。必要な gap が見つかった場合のみ test 追加。 |
| 非影響 | `frontend/src/lib/mcp/**` | MCP endpoint/tool/auth/metadata は変更しない。 |
| 非影響 | `supabase/**` | migration/RLS/schema 変更なし。 |

## 10. Test strategy

| Level | 対象 | ケース |
|---|---|---|
| L1 | env | enabled exact true、disabled、origin/issuer missing・invalid・valid |
| L1 | auth | missing Bearer、bad JWT shape、bad issuer、expired、nbf future、bad role、sub/getUser mismatch、valid actor |
| L2 | route handler | disabled/env invalid fail closed、TimeCoin preflight 204、wrong origin 403、query 400、missing auth 401、valid token calls JWT client + status service、success body 4 field only、service throw 500 safe |
| L1 existing | daily status | 既存 `daily-study-status.test.ts` で state/date/owner/4 field を維持 |
| L2/L3 external | provider smoke | deployment 後に TimeCoin 相当 client で 401 と valid token success を sanitized evidence として確認 |

実装完了時は focused Vitest に加え、route/env 変更のため `npm --prefix frontend run check` と `npm --prefix frontend run build` を実行する。

## 11. Rollout / rollback

- Rollout: KANJI Vercel に `TIMECOIN_API_ENABLED=true`、`TIMECOIN_API_ALLOWED_ORIGIN`、`TIMECOIN_API_OAUTH_ISSUER` を設定し、provider deployment 後に smoke test する。
- Rollback: `TIMECOIN_API_ENABLED=false` で REST API を fail closed する。DB 変更がないため data rollback は不要。
- TimeCoin OAuth callback URL、Supabase OAuth client 登録、TimeCoin server-side client id / secret 設定は release handoff の未決事項として残す。

## 12. Unresolved risks

- Supabase OAuth Server が発行する TimeCoin client token の exact `aud` / claim shape は Hosted 接続で最終確認が必要。repo unit test では dependency mock による contract 検証までとする。
- CORS は browser preflight を制御するだけで、server-to-server call の認可ではない。認可は Bearer token 検証と RLS で担保する。
- Cross-app E2E は timecoin-cloud 側 callback URL / client secret 設定後の別 gate に残る。
