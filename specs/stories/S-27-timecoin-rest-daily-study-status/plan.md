---
story_id: S-27
title: timecoin-rest-daily-study-status
type: plan
version: 1.0.0
created: 2026-07-30
based_on: specs/stories/S-27-timecoin-rest-daily-study-status/design.md
---

# 実行計画: TimeCoin連携用REST daily study status API

## Phase 1: TimeCoin REST env contract

- 対象要件: REQ-02, REQ-03, NFR-SEC-04
- 対象ファイル:
  - `frontend/src/lib/env.ts`
  - `frontend/src/lib/env.test.ts`
- 実装内容:
  - `TimeCoinApiEnvConfig`、`getTimeCoinApiEnvConfig()`、`isTimeCoinApiEnabled()` を追加する。
  - `TIMECOIN_API_ENABLED` は exact `true` のみ有効にする。
  - `TIMECOIN_API_ALLOWED_ORIGIN` は `https:` origin のみ許可する。
  - `TIMECOIN_API_OAUTH_ISSUER` は `https://.../auth/v1` 形式のみ許可する。
- 完了条件:
  - missing/blank/invalid env は route 側で fail closed できる error になる。
  - env parser は token、client secret、raw value を log しない。
- 検証:
  - `npm --prefix frontend test -- src/lib/env.test.ts`

## Phase 2: REST OAuth actor authentication

- 対象要件: REQ-06, REQ-07, REQ-08, NFR-SEC-01, NFR-SEC-02
- 対象ファイル:
  - `frontend/src/lib/timecoin/auth.ts`
  - `frontend/src/lib/timecoin/auth.test.ts`
- 実装内容:
  - Authorization header から Bearer token を1つだけ parse する。
  - Supabase anon client の `auth.getClaims(token)` と `auth.getUser(token)` を dependency injection 経由で呼ぶ。
  - issuer、alg/kid、role、UUID subject、exp/nbf、getUser一致を検証する。
  - 認証失敗は単一の auth error に畳み、raw token/claim/error を返さない。
- 完了条件:
  - missing/blank/multiple/malformed Bearer は 401 用 error。
  - issuer mismatch、expired、nbf future、role mismatch、subject mismatch は 401 用 error。
  - valid token は `{ userId, issuer }` だけを返す。
- 検証:
  - `npm --prefix frontend test -- src/lib/timecoin/auth.test.ts`

## Phase 3: REST daily status route handler

- 対象要件: REQ-01, REQ-04, REQ-05, REQ-09, REQ-10, REQ-11, REQ-12, REQ-13, REQ-14, SHOULD-04, SHOULD-05
- 対象ファイル:
  - `frontend/src/lib/timecoin/daily-study-status-route.ts`
  - `frontend/src/lib/timecoin/daily-study-status-route.test.ts`
  - `frontend/app/api/timecoin/daily-study-status/route.ts`
- 実装内容:
  - disabled/env invalid 時に 404 empty response を返し、auth/client/status service を呼ばない。
  - allowed TimeCoin origin の `OPTIONS` preflight に 204 と CORS headers を返す。
  - GET 以外は 405、query string ありは 400、JSON 非許容 Accept は 406 にする。
  - Bearer token を検証し、同じ token で `createJwtScopedClient(token)` を作る。
  - `getDailyStudyStatusForActor(client, { userId })` を呼ぶ。
  - success body は `contractVersion/date/state/completed` の allowlist projection にする。
  - service failure は safe `internal_error` 500 にする。
- 完了条件:
  - `userId`、`ownerId`、`date`、`deckId`、`cardId` query は全て 400 で拒否される。
  - success response に4 field以外が混入しない。
  - deck/card detail、raw DB error、token、secret が response/log/test snapshot に出ない。
  - CORS header は configured TimeCoin origin にだけ返る。
- 検証:
  - `npm --prefix frontend test -- src/lib/timecoin/daily-study-status-route.test.ts`

## Phase 4: Existing daily status contract preservation

- 対象要件: REQ-10, REQ-11, NFR-DATE-01, NFR-COMPAT-01
- 対象ファイル:
  - `frontend/src/lib/deck/daily-study-status.ts`
  - `frontend/src/lib/deck/daily-study-status.test.ts`
- 実装内容:
  - 既存 service を REST route から呼べることを確認する。
  - 既存 test に不足があれば、4 field key order、JST date、actor owner filter、safe throw の回帰 test を追加する。
  - daily status service 自体は必要な gap がない限り変更しない。
- 完了条件:
  - `NO_ELIGIBLE_DECKS`、`IN_PROGRESS`、`COMPLETED` の判定が既存 test で維持される。
  - actor owner 以外の review state が混入しない。
- 検証:
  - `npm --prefix frontend test -- src/lib/deck/daily-study-status.test.ts`

## Phase 5: Quality gate and build verification

- 対象要件: 全AC
- 対象ファイル:
  - 変更全体
- 実装内容:
  - focused tests の後に全体 gate を実行する。
  - Next.js App Router route / env / server-only 境界を build で確認する。
  - `git diff` で MCP endpoint、Supabase migration、secret 値の混入がないことを確認する。
- 完了条件:
  - `npm --prefix frontend run check` 成功。
  - `npm --prefix frontend run build` 成功。
  - `git diff --check` 成功。
  - `supabase/**` と `frontend/src/lib/mcp/**` に意図しない変更がない。
- 検証:
  - `npm --prefix frontend run check`
  - `npm --prefix frontend run build`
  - `git diff --check`

## Phase 6: Provider smoke / release handoff

- 対象要件: rollout、未決事項
- 対象ファイル:
  - PR body / verification note
- 実装内容:
  - provider deployment 後、`TIMECOIN_API_ENABLED=true` の環境で `OPTIONS` preflight、未認証 401、有効 token の 200 を確認する。
  - TimeCoin 側へ `KANJI_EVERYDAY_API_URL` と contractVersion 1 の確認結果だけを渡す。
  - token、client secret、deck/card detail、raw response header の機密値は記録しない。
- 完了条件:
  - repo test と external smoke の検証範囲を混同せず報告する。
  - callback URL 確定、Supabase OAuth client 登録、timecoin-cloud server-side env 設定を unresolved item として残す。
- 検証:
  - 手動 provider smoke。credential がない場合は未実施理由を明記する。

## AC / 検証対応

| AC | 主な検証 |
|---|---|
| GET route 実装 | Phase 3 route test、Phase 5 build |
| disabled fail closed | Phase 1 env test、Phase 3 route test |
| 未認証 401 | Phase 2 auth test、Phase 3 route test |
| valid token で本人 status | Phase 2 auth test、Phase 3 route dependency assertion、Phase 4 daily status test |
| response 4 field only | Phase 3 route test、Phase 4 existing unit |
| selector 不受理 | Phase 3 query rejection tests |
| detail 非公開 | Phase 3 response projection tests |
| CORS preflight | Phase 3 route test、Phase 6 smoke |
| raw error/token/secret 非公開 | Phase 2/3 failure tests、Phase 5 diff review |

## 実装時の注意

- `tasks/` や個別 task file は作成しない。
- MCP endpoint/tool/auth/metadata を変更しない。
- service role client を使わない。
- `TIMECOIN_API_ALLOWED_ORIGIN` は CORS 用であり、認証境界ではない。
- success response に count や detail を追加しない。
- docs、test fixture、log に token、client secret、raw DB error を残さない。
