# Supabase / Vercel インフラストラクチャ検証

このプロジェクトに AWS CDK test は適用しない。ここでは migration、RLS、Storage、environment、production build の検証を定義する。

## 検証レベル

| レベル | 対象 | 例 |
|---|---|---|
| Static | source と contract | SQL review、env 名、typecheck |
| Local integration | 隔離 DB / local Supabase | migration apply、RLS actor test、seed 再実行 |
| Preview | Vercel preview + non-production Supabase | auth redirect、Server Action、Storage、Gemini smoke |
| Production canary | deploy 後の最小経路 | login、deck、study、error log |

## Migration

- 空 DB へ全 migration を順番に適用できる。
- 既存 schema へ新規 migration を一度だけ適用できる。
- table、constraint、index、trigger、function、RLS、grant が設計どおりである。
- seed や Action が使う各 `ON CONFLICT` target に対応する unique / exclusion constraint を catalog から確認する。
- destructive change は fixture data で影響を検証し、rollback / forward-fix を準備する。
- migration filename と適用順に依存するため timestamp の衝突を避ける。

## RLS actor matrix

各 user data について最低限次を検証する。

| actor | 期待 |
|---|---|
| owner | 許可された CRUD が成功 |
| other authenticated user | owner data を read / write できない |
| anonymous | public 契約以外は拒否 |
| service role | 管理用途だけ。application owner check の代用にしない |

public card、deck membership、join table、study session は親 row を含む query で境界を検証する。

## Storage

- bucket `illustrations` は public ではない。
- owner は自分の `{user_id}/...` だけ upload / read できる。
- cross-user path traversal / forged object name は拒否される。
- ready row と object path の対応、missing object、expired signed URL を扱う。
- delete / retry で孤児 row または object が増えないか確認する。

## Environment / Build

- `.env.local.example` は名前だけを示し、実値を含まない。
- server-only env が client chunk に入っていない。
- required env 欠損時は安全に fail-fast する。ただし optional な Gemini key 欠損は仕様どおり生成 failure に劣化する。
- `npm run build` が対象環境の env contract で成功する。

## 実行時の注意

- `supabase db reset`、remote migration apply、production deploy は破壊的 / 外部変更として扱う。
- project ref、DB URL、target environment が不明なまま実行しない。
- real Gemini smoke は費用と外部送信を伴うため、mock test と明確に区別する。
- 検証結果には使用環境、command、migration version、未検証項目を残す。
- `no unique or exclusion constraint matching the ON CONFLICT specification` が出た場合は seed を書き換えて回避せず、対象 DB の migration drift と constraint 定義を先に確認する。
