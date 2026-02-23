# Shared モジュール

## 目的

Frontend/Backend間で再利用する型定義を一元管理し、API契約の重複を防ぐ。

## 構成

```
shared/types/
├── src/
│   ├── index.ts
│   ├── enforcement.ts
│   └── learning-timer.ts
├── dist/
├── package.json
└── tsconfig.json
```

- ファイル名は `kebab-case.ts`
- ワークスペースパッケージとしてビルド成果物（`dist/`）を配布

## 利用方針

- 共有すべき契約型のみを配置する
- UI専用型は `frontend/src/types` に置く
- Backend内部専用型は `backend/src/**/types` に置く

## 現在の主用途

- SRM連携の `EnforcementStatus` / `EnforcementProvider`
- 学習タイマー関連のリクエスト/レスポンス型

## インポート例

```typescript
import type { EnforcementProvider } from "@debt-collect-robo/shared-types"
```

## 更新ルール

- API契約を変更したら、共有型と利用側（frontend/backend）を同一PRで更新する
- 命名規則は `.claude/rules/naming-convention.md` に従う
