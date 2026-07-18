# プロジェクトコンテキスト（KANJI-EVERYDAY）

詳細な正本は `.claude/steering/project-context.md` と `.claude/steering/architecture/overview.md`。

## 概要

- プロダクト: 小学生向け漢字学習 Web アプリ「まいにち漢字」
- Web: Next.js 14 App Router、React 18、TypeScript、Tailwind CSS 3
- Server: Next.js Server Components / Server Actions
- Data/Auth: Supabase Auth / PostgreSQL / Storage / RLS
- AI: Gemini REST API
- Test: Vitest
- Hosting: Vercel を想定

## リポジトリ境界

- アプリケーションは `frontend/` 配下にある。
- DB と権限制御は `supabase/migrations/`、seed は `supabase/seed.sql` にある。
- 仕様は `specs/adr/`、`specs/epics/`、`specs/stories/` にある。
- 独立した `backend/`、Prisma、NestJS、Jest、Playwright、AWS CDK、npm workspaces は現時点で存在しない。

## 重要な不変条件

- Browser 用と Server 用の Supabase client を混在させない。
- 認証、所有権、RLS の三層でユーザーデータを分離する。
- `SUPABASE_SERVICE_ROLE_KEY` と `GEMINI_API_KEY` をブラウザへ露出しない。
- `study_sessions` を学習進行の正本とする。
- 答えとイラストは Show Answer 前に表示しない。
- SRS と学習日は JST 境界を明示して扱う。

現行機能の実装状況を含む詳細は `.claude/steering/project-context.md` を参照する。
