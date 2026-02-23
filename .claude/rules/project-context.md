# プロジェクトコンテキスト（まいにち漢字）

このドキュメントは、`まいにち漢字` の実装時に常に意識するべき背景・制約・技術前提を定義する。

## 1. プロダクト概要

- **プロジェクト名**: まいにち漢字
- **目的**: 小学生向け漢字学習Webアプリ（Anki風の間隔反復学習）
- **提供形態**: Webアプリ（スマホ優先、タブレット対応）
- **主要ユーザー**:
  - 学習者（子ども）：デッキ選択→学習を回す
  - 管理者（保護者/先生）：デッキ構成、上限設定

## 2. ドメインと主要機能

- 認証: Supabase Auth（将来の複数端末/保護者管理対応）
- 学習: Anki風フロー（問題→Show Answer→3段階評価）
- SRS: 間隔反復（固定テーブル方式）
- イラスト: Gemini生成、答え合わせ時のみ表示

## 3. 技術スタック（現行）

- **ホスティング**: Vercel
- **フレームワーク**: Next.js (App Router), React, Tailwind CSS
- **バックエンド**: Supabase（Auth / Postgres / Storage）
- **サーバーロジック**: Next.js Server Actions（SRS更新・キュー管理）
- **レンダリング**: SSR（Server Components）+ Client Components（インタラクティブ部分）
- **テスト**: Vitest
- **共通**: TypeScript, Biome

## 4. リポジトリ構成

- `app/`: App Router のページ/レイアウト
- `src/`: 再利用コンポーネント、hooks、contexts、lib、types
- `src/actions/`: Server Actions
- `specs/`: ADR・エピック・ストーリー・実装計画

命名規則は `.claude/rules/naming-convention.md` を参照。

## 5. アーキテクチャ前提

- Next.js App Router を採用し、SSR（Server Components）をデフォルトとする
- サーバーロジック（SRS更新・キュー管理）は Server Actions で実装する
- データ取得は Server Components 内で直接 Supabase Client を呼び出す
- インタラクティブな操作（カードめくり・評価）は Client Components で実装する
- DBアクセスは Supabase Client 経由で行い、スキーマ変更は SQL マイグレーションを伴う
- RLS（Row Level Security）でユーザーごとのデータ分離を徹底する
- 型定義は `src/types/` で管理し、重複型定義を避ける

## 6. 開発フロー

1. 要件整理
2. ADR（必要時）
3. Design Doc
4. 作業計画
5. 実装
6. テスト
7. レビュー

## 7. 環境・実行前提

- **標準開発ポート**:
  - Next.js: `http://localhost:3000`
- **主要環境変数**:
  - `NEXT_PUBLIC_SUPABASE_URL`（クライアント使用可）
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`（クライアント使用可）
  - `SUPABASE_SERVICE_ROLE_KEY`（サーバー専用・公開禁止）
- **タイムゾーン**: JST（Asia/Tokyo）基準で due_date を計算・表示

## 8. 品質前提

- 変更範囲に応じて型チェック・lint・テストを実行する
- Supabase RLS ポリシーの整合性を常に確認する
- スマホ操作のテンポを最優先（レート後すぐ次カード）

## 9. 関連ドキュメント

- 共通原則: `.claude/rules/core-principles.md`
- 命名規則: `.claude/rules/naming-convention.md`
