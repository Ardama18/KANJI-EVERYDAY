# 命名規則（KANJI-EVERYDAY）

命名規則の正本は `.claude/steering/naming-convention.md` とする。

- TypeScript: 型・Component は `PascalCase`、関数・変数は `camelCase`、定数は `UPPER_SNAKE_CASE`
- DB: table・column は `snake_case`
- Action / lib: `kebab-case.ts`
- Test: 対象の近くに `*.test.ts(x)`。Story テストは `*.int.test.ts(x)` / `*.e2e.test.ts(x)`
- Migration: `{UTC timestamp}_{short_description}.sql`
- Story: `S-{NN}-{kebab-case-title}`、Epic: `E-{NN}-{kebab-case-title}`
- ADR: `ADR-{NNN}-{kebab-case-title}.md`

既存ディレクトリの流儀を優先し、同一ディレクトリ内へ新しい混在を作らない。新しい命名規則を追加・変更するときは steering 側だけを更新し、本ファイルには要約のみを残す。
