---
id: ADR-[NNN]
title: [kebab-case-title]
status: Proposed
date: [YYYY-MM-DD]
feature: [対象機能]
related_stories:
  - S-[NN]-[story-title]
---

# ADR-[NNN]: [意思決定の題名]

## コンテキスト

[解決する問題、現在の制約、決定が必要な理由]

## 決定ドライバー

- [プロダクト要件]
- [セキュリティ・データ境界]
- [運用・コスト・保守性]

## 検討案

### 案A: [名称]

- 概要: [説明]
- 利点: [説明]
- 欠点: [説明]

### 案B: [名称]

- 概要: [説明]
- 利点: [説明]
- 欠点: [説明]

## 決定

[採用案と理由。Next.js / Supabase / Vercel / Gemini の責務境界を該当時に明記]

## 影響

### 利点

- [得られる効果]

### 受け入れるトレードオフ

- [欠点と緩和策]

### セキュリティとデータ

- 認証・所有権・RLS: [影響]
- server-only secret: [影響]
- migration / Storage / 個人情報: [影響]

## 実装・移行方針

- [段階的な適用方法]
- [既存データへの影響]
- [rollback または forward-fix]

## 検証

- [決定を証明するテスト]
- [観測可能な成功条件]

## 関連情報

- Story: `specs/stories/S-[NN]-[story-title]/`
- Design: `specs/stories/S-[NN]-[story-title]/design.md`
- 関連 ADR: [あれば]
