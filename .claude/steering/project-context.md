# プロジェクトコンテキスト（まいにち漢字）

このドキュメントは、`KANJI-EVERYDAY` の実装・レビューで常に参照するプロダクト背景と技術前提を定義する。仕様の詳細は `specs/`、実際に利用できるコマンドとバージョンは `frontend/package.json` を正本とする。

## 1. プロダクト概要

- **プロダクト名**: まいにち漢字（KANJI-EVERYDAY）
- **目的**: 小学生が毎日短時間で漢字の読み書きを復習できる、Anki 風の学習体験を提供する
- **主要体験**: デッキ選択 → 今日の出題確認 → 問題 → 答え表示 → 3段階評価 → 次のカード
- **主要ユーザー**: MVP ではメール/パスワードで認証した学習者。保護者モードは現行スコープ外

## 2. 現行ドメイン

- 認証: Supabase Auth、サインアップ、ログイン、ログアウト、保護ルート
- 学習データ: `decks`、`cards`、`deck_cards`、`review_states`
- セッション: `study_sessions` を正本とする中断・再開可能な学習状態
- SRS: `good` / `hard` / `again` の固定間隔テーブル、JST 基準の日付計算
- イラスト: S-08 で生成・保存の契約と部品を実装済み。ただし production の非同期起動は現在 no-op で、画面表示連携を行う S-09 は `not_started`。完成済み機能として扱わない
- ユーザー境界: `users_profile` と owner scoped な RLS / Storage policy

## 3. 技術スタック

| 領域 | 現行構成 |
|---|---|
| Web | Next.js 14 App Router、React 18、TypeScript |
| UI | Tailwind CSS 3 |
| Backend | Next.js Server Components / Server Actions |
| BaaS | Supabase Auth / PostgreSQL / Storage |
| AI | Gemini REST API（SDK 依存を追加せず `fetch` を使用） |
| 品質 | Biome、TypeScript、Vitest |
| Hosting | Vercel を想定 |

ルートに npm workspace、独立した `backend/`、NestJS、Prisma、Jest、Playwright、AWS CDK は現時点で存在しない。導入済みと仮定しない。

## 4. リポジトリ構成

```text
frontend/
├── app/                 # App Router のページとレイアウト
└── src/
    ├── actions/         # Server Actions と境界の型
    ├── components/      # auth / deck / study の UI
    ├── lib/             # Supabase、SRS、日付、イラスト生成
    └── types/           # Database 型
supabase/
├── migrations/         # DB、RLS、Storage policy の履歴
└── seed.sql             # 再実行可能な seed
specs/
├── adr/                 # Accepted な設計判断
├── epics/               # エピックの背景と共有方針
└── stories/             # story / requirements / design / plan / meta（既存の legacy tasks / tests を含む場合あり）
```

## 5. アーキテクチャ上の不変条件

1. Server 用と Browser 用の Supabase client を混在させない。
2. Server Action ごとに認証と対象リソースの所有権を検証する。RLS だけに依存しない。
3. service role key と Gemini API key をブラウザへ露出しない。
4. `study_sessions` を学習進行の正本とし、クライアント状態だけで永続状態を決めない。
5. イラストはカード表面に出さず、答え表示後にだけ出す。生成失敗で学習を止めない。
6. SRS 純粋関数には I/O や暗黙の現在時刻を持ち込まず、JST 境界を明示する。
7. DB 変更は SQL migration、RLS / Storage policy、型、seed、テストを一体で扱う。

## 6. 仕様の優先順位

矛盾がある場合は、原則として次の順に判断する。

1. 最新の Accepted ADR
2. 対象ストーリーの `requirements.md` と `story.md`
3. 対象ストーリーの `design.md` と `plan.md`
4. エピック
5. steering 文書
6. 実装済みコード（仕様との不一致は勝手に正当化しない）

ADR 同士の番号重複や記述差異を見つけた場合は、ファイル名だけで推測せず `feature`、`status`、関連ストーリーを照合する。

## 7. 開発と品質

主要コマンドは `frontend/` で実行する。

```bash
npm run lint
npm run typecheck
npm run test
npm run check
npm run build
```

- 変更した境界に対応するテストを先に実行し、完了前に `npm run check` を通す。
- Server Component や Supabase 実環境を必要とする検証は、Vitest の範囲と実ブラウザ / ローカル Supabase の範囲を区別して報告する。
- 存在しない script や未導入ツールを計画・完了条件に書かない。

## 8. 関連文書

- アーキテクチャ: `architecture/overview.md`
- DB / RLS: `database-conventions.md`
- API 境界: `architecture/frontend-api-patterns.md`
- テスト: `testing-guide.md`
- セキュリティ: `security-standards.md`
- 実装フロー: `implementation-flow.md`
