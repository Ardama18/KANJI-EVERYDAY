---
id: S-22
issue_story_label: S-20
feature: timecoin-daily-study-status
type: story
version: 1.0.0
created: 2026-07-26
updated: 2026-07-26
github_issue: 71
related_consumer_issue: https://github.com/Ardama18/timecoin-cloud/issues/147
---

# S-22: TimeCoin向け本日学習ステータスMCP tool

## 背景

GitHub issue #71 のタイトルは `[S-20]` だが、現在の repository には `S-20-ai-cards-mnemonic-edit` と `S-21-mcp-auto-mnemonic` が既に存在する。そのため、story artifact は重複を避けて `S-22-timecoin-daily-study-status` として作成し、issue 表記上の label を `issue_story_label: S-20` として保持する。

KANJI-EVERYDAY 利用者が本日の学習を完了した事実を、本人が OAuth で許可した TimeCoin へ安全に共有できるようにする。現在は S-19 でデッキ単位の日次完了判定、S-14 で OAuth 保護された Remote MCP 基盤があるが、アプリ全体の「本日分完了」を外部 client が取得する契約がない。

## ユーザーストーリー

KANJI-EVERYDAY 利用者として、本人が OAuth で許可した TimeCoin にだけ、本日の学習が完了済みかを共有したい。なぜなら、TimeCoin 側で学習完了を自動判定できれば、KANJI-EVERYDAY と TimeCoin の両方で完了操作を繰り返す必要がなくなるから。

## スコープ

### 対象

- OAuth actor 本人の全 eligible deck を S-19 の既存デッキ単位判定で集約する。
- Remote MCP tool `get_daily_study_status` を追加する。
- tool input は `{}` の strict object だけを受理する。
- 成功時に `contractVersion/date/state/completed` の4 fieldだけを返す。
- 本人所有 deck のうちカードを1枚以上持つ全 deckを eligible とする。
- server-side JST 当日を使い、tool input由来の owner/date/deck override を許可しない。
- 既存 MCP auth、grant、JWT、RLS、tool wrapper、OAuth metadata、既存 tool contract を維持する。

### 対象外

- TimeCoin 側の task、point、OAuth token 保存。
- webhook push。
- TimeCoin client ID への固定。
- 特定 deck だけを外部共有する設定。
- deck/card/study count、deck name、card content、review timestamp などの詳細公開。
- DB schema、migration、RLS policy、Storage policy、OAuth metadata の変更。
- production deploy、ship、land-and-deploy、issue close。

## 受入条件

1. カードを1枚以上持つ全 deck が `done` または `limit-reached` の場合、JST 当日の `COMPLETED/true` を返す。
2. eligible deck に `todo` が1件でもある場合、`IN_PROGRESS/false` を返す。
3. eligible deck が0件の場合、`NO_ELIGIBLE_DECKS/false` を返す。
4. tool input は空 object だけを受理し、owner/date/deck override を拒否する。
5. query owner は検証済み OAuth actor だけから取得し、別 owner の deck/review を返さない。
6. success data は4 fieldだけで、deck/card/study countを含まない。
7. DB failure は既存 safe error wrapper の `INTERNAL_ERROR` へ縮退し、raw errorを返さない。
8. 既存 MCP tools の input/output、OAuth metadata、grant/JWT/RLS 境界を変更しない。

## 関連情報

- Provider issue: https://github.com/Ardama18/KANJI-EVERYDAY/issues/71
- Consumer issue: https://github.com/Ardama18/timecoin-cloud/issues/147
- Related stories: S-14, S-16, S-19, S-21
- Accepted ADR: `specs/adr/ADR-011-supabase-oauth-remote-mcp-security-boundary.md`
