---
story_id: S-27
title: timecoin-rest-daily-study-status
type: requirements
version: 1.0.0
created: 2026-07-30
based_on: specs/stories/S-27-timecoin-rest-daily-study-status/story.md
---

# 要件定義書: TimeCoin連携用REST daily study status API

## 1. 正本と前提

- 正本は GitHub issue #88 の要件本文である。GitHub Connector で取得できた issue comment は開始宣言のみで追加要件はない。`gh issue view` は HTTP 401 のため本文取得不可だった。
- TimeCoin 連携は MCP ではなく REST API として実装する。
- 既存 `frontend/src/lib/deck/daily-study-status.ts` は `contractVersion/date/state/completed` の4 fieldを返す actor-scoped 集計を持つ。
- actor は OAuth access token から決定し、request query/body 由来の selector は使わない。
- 日付は KANJI-EVERYDAY server-side JST 当日で決定する。

## 2. Must

- REQ-01: システムは `GET /api/timecoin/daily-study-status` を提供すること。
- REQ-02: システムは `TIMECOIN_API_ENABLED` が exact `true` ではない間、API を fail closed すること。
- REQ-03: システムは `TIMECOIN_API_ALLOWED_ORIGIN` と `TIMECOIN_API_OAUTH_ISSUER` を server-side env として検証し、不正または未設定なら fail closed すること。
- REQ-04: TimeCoin origin から CORS preflight が送られたとき、システムは `OPTIONS /api/timecoin/daily-study-status` に CORS 許可ヘッダ付き 204 を返すこと。
- REQ-05: request に query parameter が1つでも含まれる場合、システムは認証前に request を拒否すること。
- REQ-06: request が Bearer token を持たない、または Bearer token として構文不正な場合、システムは HTTP 401 を返すこと。
- REQ-07: Bearer token が KANJI Supabase OAuth issuer、期限、authenticated role、user subject の検証に失敗した場合、システムは HTTP 401 を返すこと。
- REQ-08: システムは検証済み token の actor user ID だけを owner として使い、`userId`、`ownerId`、`date`、`deckId`、`cardId` などを request から受け取らないこと。
- REQ-09: システムは検証済み token と anon key で JWT scoped Supabase client を作り、service role client を使わないこと。
- REQ-10: システムは `getDailyStudyStatusForActor(client, actor)` を呼び、JST 当日の本人学習状態を取得すること。
- REQ-11: 成功 response body は `contractVersion`、`date`、`state`、`completed` の4 fieldだけにすること。
- REQ-12: `state` は `NO_ELIGIBLE_DECKS | IN_PROGRESS | COMPLETED` のいずれかにすること。
- REQ-13: システムは deck/card ID、deck name、card content、学習枚数、review timestamp を response に含めないこと。
- REQ-14: システムは raw Supabase error、stack、token、secret を response に含めず、log にも出さないこと。

## 3. Should

- SHOULD-01: REST route handler は MCP route handler を変更せず、REST 専用の薄い adapter として実装する。
- SHOULD-02: TimeCoin REST env parsing は既存 `frontend/src/lib/env.ts` の parse pattern に合わせる。
- SHOULD-03: OAuth token 検証と route handler は依存注入可能にし、Vitest で auth / CORS / fail closed / response shape を検証できるようにする。
- SHOULD-04: `Accept` が `application/json` または `*/*` を許容しない場合は 406 を返す。
- SHOULD-05: 成功 response と auth failure response は `Cache-Control: no-store` を持つ。

## 4. Won't

- WON'T-01: MCP endpoint、MCP tool descriptor、MCP auth、MCP metadata を変更しない。
- WON'T-02: TimeCoin client ID allowlist や client secret を KANJI REST API route に持たせない。OAuth client 登録と secret は TimeCoin server-side env の運用事項とする。
- WON'T-03: DB schema、migration、RLS policy、Storage policy、Database 型を変更しない。
- WON'T-04: browser公開 env (`NEXT_PUBLIC_*`) に TimeCoin secret や OAuth client secret を置かない。
- WON'T-05: TimeCoin 側の達成判定、callback URL 決定、client id / secret 設定を実装しない。

## 5. 非機能・セキュリティ要件

- NFR-SEC-01: actor/RLS 境界は検証済み OAuth token + JWT scoped Supabase client + explicit actor owner filter の組み合わせで維持する。
- NFR-SEC-02: query/body/cookie の token、owner、date、deck selector は認証・集計に使わない。
- NFR-SEC-03: CORS allowed origin は browser access control であり、認証・認可の代替にしない。
- NFR-SEC-04: fail closed 時は DB query、OAuth verification、daily status service を呼ばない。
- NFR-DATE-01: 日付は `frontend/src/lib/date.ts` 経由の JST 当日とし、テストでは時刻を固定する。
- NFR-COMPAT-01: contractVersion 1 の成功 response field は additive 変更も行わない。

## 6. AC / 要件対応

| AC | 対応要件 |
|---|---|
| AC-1 GET route 実装 | REQ-01 |
| AC-2 disabled fail closed | REQ-02, REQ-03, NFR-SEC-04 |
| AC-3 未認証 401 | REQ-06, REQ-07 |
| AC-4 valid token で本人 status | REQ-08, REQ-09, REQ-10, NFR-SEC-01 |
| AC-5 response 4 field only | REQ-11, NFR-COMPAT-01 |
| AC-6 selector 不受理 | REQ-05, REQ-08, NFR-SEC-02 |
| AC-7 detail 非公開 | REQ-13 |
| AC-8 CORS preflight | REQ-04, NFR-SEC-03 |
| AC-9 raw error/token/secret 非公開 | REQ-14 |

## 7. 未決事項

- timecoin-cloud の OAuth callback URL は未確定。
- callback URL 確定後、KANJI 側 Supabase OAuth client 登録が必要。
- 発行された client id / secret は timecoin-cloud の server-side env に設定する。KANJI repo には secret 値を記録しない。
