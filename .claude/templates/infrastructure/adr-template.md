---
id: ADR-[NNN]
title: [infrastructure-decision]
status: Proposed
date: [YYYY-MM-DD]
feature: infrastructure
related_stories:
  - S-[NN]-[story-title]
---

# ADR-[NNN]: [インフラ判断]

## コンテキスト

[Vercel、Supabase、Gemini、環境変数、監視、migration 運用のどの判断が必要か]

## 現行前提

- Web hosting: Vercel
- Auth / Database / Storage: Supabase
- Server execution: Next.js Server Components / Server Actions
- AI: Gemini REST API
- AWS CDK は現行構成に含まれない

## 決定ドライバー

- セキュリティとユーザーデータ分離
- deploy / migration の順序と復旧性
- preview / production の環境分離
- 可観測性、コスト、運用負荷

## 検討案

| 案 | 概要 | 利点 | 欠点 | コスト・運用 |
|---|---|---|---|---|
| A | [案] | [利点] | [欠点] | [影響] |
| B | [案] | [利点] | [欠点] | [影響] |

## 決定

[採用案と理由]

## セキュリティ・データ境界

- environment / secret: [公開・server-only の区別]
- Auth / RLS / Storage: [影響]
- 個人情報・ログ: [方針]
- service role: [限定用途と所有権確認]

## Rollout / Rollback

- migration と deploy の順序: [説明]
- preview 検証: [説明]
- rollback または forward-fix: [説明]

## 検証・監視

- static / local integration / preview / production canary: [項目]
- alert / log / cost observation: [項目]

## 影響

- ポジティブ: [影響]
- トレードオフ: [影響]
- 後続作業: [Story / Issue]
