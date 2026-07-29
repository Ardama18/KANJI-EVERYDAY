---
id: S-27
feature: timecoin-rest-daily-study-status
type: story
version: 1.0.0
created: 2026-07-30
updated: 2026-07-30
github_issue: 88
---

# S-27: TimeCoin連携用のREST API IF

## 背景

TimeCoin との連携方針を MCP endpoint ではなく REST API に整理する。S-22 では TimeCoin 向け daily study status を MCP tool として設計・実装しているが、issue #88 では TimeCoin が通常の HTTPS REST API と OAuth access token で本人の本日学習完了状態を参照できる provider contract を追加する。

## ユーザーストーリー

KANJI-EVERYDAY 利用者として、本人が OAuth で許可した TimeCoin にだけ本日の学習完了状態を共有したい。なぜなら、TimeCoin 側で `completed === true` を自動判定できれば、KANJI-EVERYDAY の学習完了を TimeCoin へ手で二重入力しなくて済むから。

## スコープ

### 対象

- `GET /api/timecoin/daily-study-status` を追加する。
- `Authorization: Bearer <KANJI OAuth access token>` から actor を決定する。
- actor 本人の server-side JST 当日の学習完了状態を返す。
- 既存 `frontend/src/lib/deck/daily-study-status.ts` の集計ロジックを再利用する。
- JWT scoped Supabase client と RLS 境界を維持し、service role を使わない。
- `TIMECOIN_API_ENABLED=false` または REST API 設定不正時は fail closed する。
- TimeCoin origin の CORS preflight を許可する。

### 対象外

- MCP endpoint / MCP tool の追加改修。
- TimeCoin 側の OAuth callback URL 確定、client id / secret 設定、達成判定実装。
- Supabase OAuth client の本番登録作業。
- DB schema、migration、RLS policy、Storage policy の変更。
- deck/card ID、deck name、card content、学習枚数、review timestamp の公開。
- production deploy、ship、land-and-deploy、issue close。

## API Contract

```http
GET /api/timecoin/daily-study-status
Authorization: Bearer <KANJI OAuth access token>
Accept: application/json
```

Query parameter は受け付けない。`userId`、`ownerId`、`date`、`deckId`、`cardId` などの selector は request から受け取らない。

```json
{
  "contractVersion": 1,
  "date": "YYYY-MM-DD",
  "state": "NO_ELIGIBLE_DECKS",
  "completed": false
}
```

TimeCoin 側の達成判定は `contractVersion === 1 && completed === true` とする。

## 受入条件

1. `GET /api/timecoin/daily-study-status` が実装されている。
2. `TIMECOIN_API_ENABLED=false` では fail closed する。
3. 未認証 request は HTTP 401 を返す。
4. 有効な KANJI OAuth access token で本人の本日学習ステータスを返す。
5. response は `contractVersion/date/state/completed` の4 fieldだけである。
6. `userId`、`ownerId`、`date`、`deckId` 等を request から受け取らない。
7. deck/card ID、deck name、card content、学習枚数、review timestamp を返さない。
8. TimeCoin origin の CORS preflight が通る。
9. raw error、token、secret を response、log、docs に出さない。

## 関連情報

- Provider issue: https://github.com/Ardama18/KANJI-EVERYDAY/issues/88
- Prior MCP-oriented story: `specs/stories/S-22-timecoin-daily-study-status/`
- Related ADR: `specs/adr/ADR-011-supabase-oauth-remote-mcp-security-boundary.md`
