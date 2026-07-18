# 共有モジュールと型の配置

本プロジェクトに workspace の `shared/types` package はない。共有は `frontend/` 内に閉じ、実行境界に応じて配置する。

## 配置ルール

| 種類 | 配置 |
|---|---|
| Supabase schema に由来する型 | `frontend/src/types/database.ts` |
| Server Action の入出力 | 対応する `frontend/src/actions/*` または小さな sibling type file |
| SRS の domain type | `frontend/src/lib/srs/types.ts` |
| イラスト生成の domain type | `frontend/src/lib/illustration/types.ts` |
| component 専用 props | component file 内 |
| 複数 UI で使う純粋 utility | `frontend/src/lib/**` |

## 原則

- 型の所有者に最も近い場所へ置く。
- DB 型、domain 型、UI 表示型を一つの巨大な型へ混ぜない。
- client から server-only module を import させる目的で型を同居させない。必要なら `import type` と type-only file で境界を切る。
- Supabase schema 変更時は `database.ts` を同期し、手書き型が schema drift を隠していないか確認する。
- 同じ概念を複数箇所で再定義する前に既存型を検索する。ただし偶然形が同じだけの概念は無理に統合しない。
- package 化は複数アプリで共有する現実の要件が生じてから判断する。
