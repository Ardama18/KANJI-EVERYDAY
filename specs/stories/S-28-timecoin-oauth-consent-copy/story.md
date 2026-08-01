---
id: S-28
feature: timecoin-oauth-consent-copy
type: story
version: 1.0.0
created: 2026-08-01
updated: 2026-08-01
github_issue: 90
---

# S-28: TimeCoin OAuth 同意画面のREST用途表示

## 背景

TimeCoin 連携は Remote MCP / 外部AI連携ではなく、`GET /api/timecoin/daily-study-status` REST API で本人の本日学習完了状態だけを参照する方式である。

しかし、TimeCoin 用 OAuth client から接続した場合も、既存の MCP 向け OAuth consent 画面が表示され、`デッキ名の参照`、`非公開カードの作成・編集・削除` と説明される。これは実際の TimeCoin REST API の共有範囲と一致しない。

## ユーザーストーリー

KANJI-EVERYDAY 利用者として、TimeCoin 連携の同意画面で共有される情報を正確に理解したい。なぜなら、TimeCoin には学習完了判定に必要な最小情報だけが共有され、カード作成・編集・削除権限を与えるわけではないことを確認してから許可したいから。

## スコープ

### 対象

- TimeCoin OAuth client の consent 表示を REST API 用文言へ切り替える。
- TimeCoin OAuth client の connection / revoke 表示を REST API 用文言へ切り替える。
- ChatGPT / Claude / Remote MCP client の既存表示を維持する。
- 表示出し分けをテストで固定する。

### 対象外

- `GET /api/timecoin/daily-study-status` の API contract 変更。
- Supabase OAuth client 登録、client secret、TimeCoin 側環境変数の変更。
- Supabase Auth / token / session / RLS の変更。
- DB schema、migration、Storage policy の変更。
- production deploy、issue close。

## 受入条件

1. OAuth consent 画面で TimeCoin client を識別し、TimeCoin 用文言を表示する。
2. TimeCoin の場合、`デッキ名の参照`、`非公開カードの作成・編集・削除` を表示しない。
3. TimeCoin の場合、共有範囲が `daily-study-status` REST API の4項目に限定されることが分かる。
4. ChatGPT / Claude / MCP client の既存 consent 表示は壊さない。
5. 連携一覧・解除画面でも TimeCoin と不一致な `外部AI` / `カード操作` 文言を避ける。
6. UI/source contract test で TimeCoin 文言と MCP 文言の出し分けを検証する。

## 関連情報

- GitHub issue: https://github.com/Ardama18/KANJI-EVERYDAY/issues/90
- Related REST story: `specs/stories/S-27-timecoin-rest-daily-study-status/`
- Related ADR: `specs/adr/ADR-011-supabase-oauth-remote-mcp-security-boundary.md`
