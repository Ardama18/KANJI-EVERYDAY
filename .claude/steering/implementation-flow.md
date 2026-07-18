# KANJI-EVERYDAY Implementation Flow

このファイルは、`$ar-core:implement` と `$ar-core:story-to-design` が KANJI-EVERYDAY で従う、リポジトリ固有の実装フローを定義する。

共通の品質サイクル、サブエージェントの呼び出し規律、安全則、`--until` / `--auto` の意味は `${CLAUDE_PLUGIN_ROOT}/shared/orchestration-default.md` を正とする。本ファイルは、入力解決、規模別フロー、停止ポイント、テスト方針、成果物、CHECKPOINT を定義する。両者が競合する場合は、フローと記録先は本ファイル、品質・安全規律は共通既定を優先する。

## 1. プロジェクト前提

- プロダクト名: まいにち漢字（KANJI-EVERYDAY）
- アプリケーション: `frontend/` 配下の Next.js 14 App Router アプリ
- UI: React 18、Tailwind CSS 3
- データ・認証: Supabase Auth / PostgreSQL / Row Level Security
- テスト: Vitest
- 静的検査: TypeScript、Biome
- 仕様の正本: `specs/` と Git

ルートに npm workspace はなく、NestJS バックエンドも存在しない。`backend`、`shared/types`、Prisma、Jest、Playwright、npm workspace を前提にしてはならない。技術バージョンと利用可能なコマンドは、実行時点の `frontend/package.json` を優先する。

## 2. 初期読込

作業開始時は、対象に応じて次を読む。

1. `AGENTS.md`
2. 対象ストーリーの `meta.json`、`story.md`、`requirements.md`、`design.md`、`plan.md`
3. 親エピックの `specs/epics/{EPIC_ID}-{title}/epic.md`
4. `frontend/package.json`
5. 対象コードと既存テスト
6. UI 変更時は `.claude/steering/design-system.md`
7. DB・認証変更時は `supabase/migrations/` と関連する Supabase 実装

既存 steering とコードが食い違う場合は、`frontend/package.json`、現在のコード、`specs/` の順で実態を確認し、矛盾を報告する。別プロジェクトの構成を推測で適用しない。

## 3. 入力解決

### ストーリーディレクトリ

`specs/stories/S-XX-title/` が指定された場合は、同ディレクトリの成果物と `meta.json` を読み、既存成果物から再開位置を決める。

### GitHub issue URL

GitHub issue URL が指定された場合は、`AGENTS.md` に従い GitHub Connector/MCP を優先して issue 本文とコメントを取得する。GitHub CLI が必要な場合は `GH_PAGER=cat gh ...` を使用する。

issue から新しいストーリーを作る場合は、既存の最大番号の次を `S-XX` とし、`specs/stories/S-XX-kebab-case-title/` に `meta.json` と `story.md` を作成する。issue 番号をストーリーIDとして流用しない。

### 機能説明

ストーリーや issue の指定がない場合は、ユーザーの機能説明を requirement-analyzer に渡す。既存ストーリーとの重複を確認し、新規作成または既存更新を判断する。

### 再開判定

成果物の存在と内容を優先して現在フェーズを決める。

| 状態 | 再開位置 |
|---|---|
| `story.md` のみ | requirement-analyzer |
| `requirements.md` あり、設計なし | technical-designer |
| `design.md` あり、計画なし | work-planner |
| `plan.md` あり、実装未完了 | task-executor |
| 実装済み、レビュー未完了 | code-reviewer |
| テストまたは品質検査が失敗 | `$ar-core:quality-fixer` |

`meta.json.status` は補助情報として使い、成果物やコードの実態と矛盾する場合は実態を優先して矛盾を報告する。

## 4. 成果物と単一情報源

ストーリー成果物は次に限定する。

```text
specs/stories/S-XX-title/
├── meta.json
├── story.md
├── requirements.md
├── design.md
└── plan.md
```

`plan.md` を実装作業の単一情報源とする。

- work-planner は実装順序、対象ファイル、完了条件、テストを `plan.md` に記載する。
- オーケストレーターは `plan.md` 全体を task-executor に渡す。
- task-executor は1回の呼び出しで、全フェーズ・全タスクを記載順に実装する。
- `tasks/`、`task-*.md`、`_overview.md` への事前分解を行わない。
- 既存の `tasks/` は旧フローの成果物として扱い、ユーザーが明示しない限り参照、生成、更新しない。
- 進捗管理は `plan.md` とオーケストレーターの進捗管理機能で行い、別の永続タスクファイルを作らない。

task-executor には次の形式で渡す。

```text
作業計画書: specs/stories/S-XX-title/plan.md の全フェーズ・全タスクを、計画書記載の順序で実装し完遂してください。tasks/ や個別 task ファイルは生成・参照・更新しないでください。
```

## 5. 標準フロー

フェーズ順序は次のとおり。

```text
requirement-analyzer
  -> technical-designer
  -> work-planner
  -> task-executor
  -> code-reviewer
  -> $ar-core:quality-fixer
  -> commit
```

UI 変更では quality-fixer の前に `$ar-frontend:ui-review` を実施し、指摘があれば `$ar-frontend:ui-fix` と再レビューを行う。

既存ロジックを変更・拡張する場合は、technical-designer の前に read-only の既存コード調査を行い、再利用候補、呼び出し関係、既存テスト、Supabase 依存を設計へ渡す。

### `--until`

- `--until design`: technical-designer 完了後に成果物と未解決事項を報告して停止する。
- `--until plan`: work-planner 完了後に `plan.md` の概要と次の実行方法を報告して停止する。task-executor は呼び出さない。

### `--auto`

`--auto` はルーチンの承認待ちを省略する。品質サイクル、CHECKPOINT、続行不能時の停止は省略しない。要件不明、設計前提の不一致、`escalation_needed`、同一指摘が3回未解消の場合は停止してユーザーへ報告する。

## 6. 規模別フロー

| 規模 | 目安 | 必須成果物 | 実装方法 |
|---|---|---|---|
| 小規模 | 1〜2ファイルの局所変更 | 簡易 `plan.md` または既存計画の更新 | オーケストレーターが直接実装可能 |
| 中規模 | 3〜5ファイル、UIとSupabaseの連携 | `design.md`、`plan.md` | task-executor に `plan.md` 全体を渡す |
| 大規模 | 6ファイル以上、migration、RLS、認証、外部API | `requirements.md`、`design.md`、`plan.md`、必要時 ADR | task-executor に `plan.md` 全体を渡す |

変更ファイル数だけでなく、認証、RLS、データ消失、外部API、利用料金への影響を優先して規模を引き上げる。

## 7. 必須停止ポイント

`--auto` がない場合、次は実装前に方針と影響範囲を示し、承認を待つ。

- Supabase schema、migration、RLS policy、Storage policy の変更
- Supabase Auth、cookie、session、token、middleware の変更
- 既存データの更新・削除、`supabase db reset` などデータを失う操作
- 外部依存の追加・更新
- Gemini など外部APIの契約、送信データ、料金に影響する変更
- 環境変数、secret、デプロイ設定の変更
- 公開API、Server Action、共有データ契約の破壊的変更
- production deploy、force push、公開環境への migration 適用

`--auto` でも、対象環境が不明な migration、データ削除、secret の不足、認証・RLS要件の曖昧さは続行不能として停止する。

## 8. テスト方針

テストは実装フェーズと同時に追加し、変更範囲に応じて次を実行する。コマンドはリポジトリルートからの例。

```bash
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run test
npm --prefix frontend run build
```

通常の全体ゲートは次を使う。

```bash
npm --prefix frontend run check
```

`check` は lint、typecheck、Vitest を実行する。ビルド時にしか検出できない問題があるため、ルーティング、Server Component、環境変数、production build に影響する変更では `build` も実行する。

### 変更別の最低基準

- 純粋関数・SRS・日付処理: 対応する Vitest unit test
- Server Action・Supabase client: 成功、失敗、認可、外部境界をモックしたテスト
- React component・page: 表示、操作、loading、error、empty state のテスト
- middleware・認証: 公開ルート、保護ルート、redirect、cookie 更新のテスト
- migration・RLS: SQL の静的確認に加え、利用可能なら隔離されたローカル Supabase で適用と権限境界を検証
- UI: unit/component test に加え、実ブラウザで desktop と mobile を確認

Playwright と `test:e2e` script は現在導入されていないため、存在を確認せずに実行または計画へ記載しない。E2E が受入条件に必須なら、導入を別の設計判断としてユーザーへ提示する。

ローカルUI確認は `frontend/` で開発サーバーを起動する。既定URLは Next.js の `http://localhost:3000`。別ポートを使った場合は、実際のURLを検証結果に記録する。

## 9. 品質サイクル

task-executor 完了後は、共通既定に従い次を必ず行う。

1. code-reviewer が `plan.md`、受入条件、実装、テストの一致を確認する。
2. 指摘があれば、指摘内容と同じ `plan.md` を task-executor に渡して修正する。
3. 指摘がなくなるまで再レビューする。同一観点が3回未解消なら停止してエスカレーションする。
4. `$ar-core:quality-fixer` を実行し、品質ゲートが approved であることを確認する。
5. UI変更ではUIレビューの指摘が解消済みであることを確認する。
6. `git diff` と `git status` で変更範囲を確認して commit する。
7. 完了内容、実行したテスト、未実行項目、残課題を報告する。

task-executor の構造化レスポンスには、少なくとも `status`、`changeSummary`、`filesModified`、`testsAdded`、`checksRun` を含める。`taskFilePath` や tasks ファイルの更新結果は要求しない。

## 10. CHECKPOINT

CHECKPOINT は `specs/stories/S-XX-title/meta.json` と Git に記録する。

| CHECKPOINT | タイミング | 記録 |
|---|---|---|
| 1. 設計完了 | technical-designer 完了後、work-planner 実行前 | `requirements.md` と `design.md` を確認し、`meta.json.status` を `design_review` にする |
| 2. 実装完了 | code-reviewer と quality-fixer 完了後 | `meta.json.status` を `implementation_review` にし、ブランチとPRがある場合は `github_branch` / `github_pr_url` を記録する |

PR merge 後にストーリーを完了扱いにする場合は、既存ストーリーの語彙に合わせて `completed` を使用する。既存 `meta.json` の未関連フィールドやステータスを推測で変更しない。

## 11. 完了条件

次をすべて満たしたときだけ実装完了とする。

- `plan.md` の全フェーズと受入条件を満たしている。
- 計画外変更がない、または理由が記録されている。
- 変更に対応するテストが追加・更新され、成功している。
- 必要な lint、typecheck、test、build が成功している。
- Supabase Auth / RLS / migration の境界が該当時に検証されている。
- UI変更が該当時に実ブラウザで確認されている。
- code-reviewer の指摘が解消済みである。
- `$ar-core:quality-fixer` が approved を返している。
- `tasks/` や個別 task ファイルを新規生成・更新していない。

