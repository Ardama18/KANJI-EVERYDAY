# 命名規則（まいにち漢字）

既存コードの局所的な一貫性を最優先し、新規追加時は次を標準とする。

## TypeScript

| 対象 | 規則 | 例 |
|---|---|---|
| component / type / interface | `PascalCase` | `StudyClient`, `ReviewState` |
| function / variable | `camelCase` | `startStudySession`, `dueDate` |
| 定数 | `UPPER_SNAKE_CASE` | `GOOD_INTERVALS`, `RETRY_TODAY_LIMIT` |
| union literal | 小文字の意味語 | `'good'`, `'hard'`, `'again'` |
| DB table / column | `snake_case` | `review_states`, `owner_user_id` |

- `any` は原則使わない。外部入力は `unknown` から絞り込む。
- boolean は `is` / `has` / `can` / `should` で意味を明確にする。
- ID は対象を含める（`deckId`、`sessionId`、`illustrationId`）。曖昧な `id` を広い scope で使わない。
- 日付文字列と timestamp を区別する（例: `dueDate` と `lastReviewedAt`）。

## ファイルとディレクトリ

- App Router 固定名: `page.tsx`, `layout.tsx`, `route.ts`, `middleware.ts`
- component: 既存ディレクトリの流儀を優先する。現在は `DeckCard.tsx` など PascalCase と auth の kebab-case が併存するため、同一ディレクトリ内で混在を増やさない
- actions / lib: `kebab-case.ts`（`session-actions.ts`, `gemini-client.ts`）
- test: 対象の近くに `*.test.ts` / `*.test.tsx`
- story integration / E2E: `*.int.test.ts(x)` / `*.e2e.test.ts(x)`
- migration: `{UTC timestamp}_{short_description}.sql`
- story: `S-{NN}-{kebab-case-title}`、epic: `E-{NN}-{kebab-case-title}`

## Server Actions

- 読み取りは `get...`、作成は `create...` / `start...`、状態変更は動詞で始める（`revealCard`, `rateCard`）。
- Action の型が複数箇所で必要なら `{domain}-types.ts` を sibling に置く。
- DB 名を UI に漏らす必要がない場合は、境界で camelCase の domain 型へ変換する。

## Supabase / Storage

- table と column は migration の命名に合わせる。
- policy 名は対象・操作・主体が分かる名前にする。
- Storage object path は Accepted ADR に従い `{user_id}/{illustration_id}.png` とする。
- 環境変数は `UPPER_SNAKE_CASE`。公開可能な値だけ `NEXT_PUBLIC_` を付ける。

## 仕様文書

- ADR filename は `{ID}-{kebab-case-title}.md`。番号だけを一意キーとみなさず feature も確認する。
- story 配下の標準名は `story.md`, `requirements.md`, `design.md`, `plan.md`, `meta.json`。
- 現行フローでは `tasks/` や個別 task ファイルを新規作成しない。実装作業は Story の `plan.md` に記録する。
