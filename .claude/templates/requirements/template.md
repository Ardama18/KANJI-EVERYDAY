---
id: S-[NN]
feature: [機能名]
type: requirements
version: 1.0.0
created: [YYYY-MM-DD]
epic: E-[NN]
---

# 要件定義書: [機能名]

## 概要

- 目的: [解決する問題と価値]
- 対象ユーザー: [学習者など]
- 対象範囲: [含むもの]
- 対象外: [含まないもの]

## ユーザーストーリー

As a [ユーザー]
I want to [行いたいこと]
So that [得られる価値]

## 前提・依存関係

- [Accepted ADR、親 Epic、先行 Story]
- [Supabase / Gemini / Vercel などの外部境界]

## 機能要件

| ID | 要件 | 優先度 | 検証方法 |
|---|---|---|---|
| FR-01 | [観測可能な振る舞い] | Must | [test / UI確認] |
| FR-02 | [観測可能な振る舞い] | Must | [test / UI確認] |

## 受入条件

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | [前提] | [操作] | [観測可能な結果] |
| AC-02 | [前提] | [操作] | [観測可能な結果] |

各 AC は design と plan のテストへ一対一または明示的な多対一で対応付ける。

## エラー・境界条件

- 未認証 / 別 owner: [期待結果]
- 空 / 上限 / 二重操作 / 再実行: [期待結果]
- 外部 API / DB / Storage 失敗: [期待結果]
- JST 日付境界: [該当時の期待結果]

## 非機能要件

- セキュリティ: [認証、所有権、RLS、secret、個人情報]
- アクセシビリティ: [keyboard、accessible name、touch target]
- パフォーマンス: [測定可能な基準]
- 信頼性: [再試行、冪等性、復旧]
- レスポンシブ: [mobile / desktop]

## データ・互換性

- schema / migration / seed への影響: [有無]
- 既存データ・既存セッションとの互換性: [方針]
- ロールバックまたは forward-fix: [方針]

## 未解決事項

- [意思決定が必要な項目。なければ「なし」]
