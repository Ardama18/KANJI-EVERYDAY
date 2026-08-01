---
story_id: S-28
title: timecoin-oauth-consent-copy
type: requirements
version: 1.0.0
created: 2026-08-01
based_on: specs/stories/S-28-timecoin-oauth-consent-copy/story.md
---

# 要件定義書: TimeCoin OAuth 同意画面のREST用途表示

## 1. 正本と前提

- 正本は GitHub issue #90 である。
- TimeCoin REST API の正本は S-27 であり、成功 response は `contractVersion`、`date`、`state`、`completed` の4 fieldだけである。
- TimeCoin 用 OAuth client は KANJI 側 Supabase OAuth Server に登録済みで、client id は `4eaeedb5-f275-43d4-8a97-e00624849443` である。
- 今回は表示整合性の修正であり、OAuth の許可・拒否・token 発行境界は変更しない。

## 2. Must

- REQ-01: システムは OAuth authorization details から client id を取得し、consent UI の表示判定に利用できること。
- REQ-02: システムは TimeCoin client id `4eaeedb5-f275-43d4-8a97-e00624849443` の場合、consent heading を `TimeCoin との連携を確認` にすること。
- REQ-03: システムは TimeCoin consent で `本日の学習完了状態の確認` を権限説明として表示すること。
- REQ-04: システムは TimeCoin consent で共有情報が `contractVersion`、`date`、`state`、`completed` に限定されることを表示すること。
- REQ-05: システムは TimeCoin consent で deck name、card content、study count を共有しないことを表示すること。
- REQ-06: システムは TimeCoin consent で `デッキ名の参照`、`非公開カードの作成・編集・削除` を表示しないこと。
- REQ-07: システムは TimeCoin 以外の OAuth client では既存 MCP 向け consent 文言を維持すること。
- REQ-08: システムは connection / revoke UI で TimeCoin client に対して `外部AI` や `カード操作` 前提の説明を出さないこと。
- REQ-09: システムは TimeCoin 表示判定を client name だけに依存しないこと。

## 3. Should

- SHOULD-01: OAuth client 表示分類は Server Component / Client Component の双方から使える純粋関数に分離する。
- SHOULD-02: 新しい表示文言は component 直下へ散らさず、表示分類オブジェクトとして集約する。
- SHOULD-03: UI/source contract test で TimeCoin と MCP の両方の表示が固定されること。

## 4. Won't

- WON'T-01: Supabase OAuth client 登録値、secret、TimeCoin 側 env を変更しない。
- WON'T-02: `GET /api/timecoin/daily-study-status` の request / response contract を変更しない。
- WON'T-03: Supabase Auth、session、token claim、grant liveness、RLS を変更しない。
- WON'T-04: DB schema、migration、Storage policy、Database 型を変更しない。

## 5. 非機能・セキュリティ要件

- NFR-SEC-01: client secret、access token、refresh token、authorization code、PKCE verifier を source、test snapshot、log、issue、PR に記録しない。
- NFR-SEC-02: TimeCoin 判定は公開可能な client id に限定し、secret や env を browser bundle に追加しない。
- NFR-UX-01: 320px 幅、長い日本語、200% zoom でも横 scroll を発生させにくい既存 layout を維持する。

## 6. AC / 要件対応

| AC | 対応要件 |
|---|---|
| AC-1 TimeCoin client 識別 | REQ-01, REQ-09 |
| AC-2 TimeCoin でMCP権限非表示 | REQ-02, REQ-03, REQ-06 |
| AC-3 REST 4 field 共有範囲表示 | REQ-04, REQ-05 |
| AC-4 MCP 表示維持 | REQ-07 |
| AC-5 connection / revoke 表示 | REQ-08 |
| AC-6 test | SHOULD-03 |
