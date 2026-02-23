# 命名規則（Hapico）

このドキュメントは、`Hapico` リポジトリの実装に合わせた命名規則を定義する。
実コード（`backend/`、`frontend/`、`shared/`、`e2e/`）を基準に更新。

---

## 1. 共通ルール（TypeScript）

| 対象 | 規則 | 例 |
|------|------|-----|
| クラス・型・interface・enum | `PascalCase` | `AuthController`, `LoginDto` |
| 変数・関数・メソッド | `camelCase` | `validateParent`, `requireParent` |
| 定数（不変値） | `UPPER_SNAKE_CASE` | `SALT_ROUNDS` |
| ファイル名（原則） | `kebab-case` + 役割接尾辞 | `auth.service.ts` |

### 例外（ファイル名）

- Reactコンポーネントファイルは `PascalCase.tsx`
- React Contextファイルは `PascalCaseContext.tsx`
- App Router 規約ファイルは固定名（`page.tsx`, `layout.tsx` など）
- バレルファイルは `index.ts`

---

## 2. Backend（NestJS: `backend/src`）

### 2.1 ディレクトリ

- 機能単位: `backend/src/modules/{domain}/`
- `{domain}` は `kebab-case` を基本とする

### 2.2 ファイル命名

| 対象 | 規則 | 例 |
|------|------|-----|
| Module | `{domain}.module.ts` | `auth.module.ts` |
| Controller | `{domain}.controller.ts` | `auth.controller.ts` |
| Service | `{domain}.service.ts` | `auth.service.ts` |
| DTO（入力） | `{action}-{target}.dto.ts` | `login.dto.ts` |
| DTO（出力） | `{target}-response.dto.ts` | `auth-response.dto.ts` |
| DTO（クエリ） | `{target}-query.dto.ts` | `report-query.dto.ts` |
| Exception | `{reason}.exception.ts` | `insufficient-balance.exception.ts` |
| Guard | `{role}.guard.ts` | `parent-auth.guard.ts` |
| Utility | `{name}.util.ts` | `password.util.ts` |
| Type定義 | `{name}.types.ts` | `auth.types.ts` |
| 定数 | `{name}.const.ts` | `limits.const.ts` |

### 2.3 テスト命名（Backend）

- 単体: `*.spec.ts`（例: `auth.service.spec.ts`）
- 統合: `*.integration.spec.ts`（例: `child-auth.integration.spec.ts`）
- 置き場所: `__tests__/` 配下 or 対象ファイル同階層

### 2.4 Prisma関連

| 対象 | 規則 | 例 |
|------|------|-----|
| スキーマ | 固定名 | `schema.prisma` |
| マイグレーション | `{timestamp}_{description}` | `20260207000000_init` |
| シード | 固定名 | `seed.ts` |

---

## 3. Frontend（Next.js: `frontend/`）

### 3.1 App Router（`frontend/app`）

| 対象 | 規則 | 例 |
|------|------|-----|
| ページ | `page.tsx` | `parent/dashboard/page.tsx` |
| レイアウト | `layout.tsx` | `child/layout.tsx` |
| ルートハンドラ | `route.ts` or `route.tsx` | `icon-192/route.tsx` |
| メタデータ | Next.js固定名 | `manifest.ts`, `icon.tsx`, `apple-icon.tsx` |
| 動的セグメント | `[param]` | `child/items/[itemId]/page.tsx` |
| ルート専用コンポーネント | `PascalCase.tsx` | `DashboardClient.tsx` |

### 3.2 `frontend/src` の命名

| 対象 | 規則 | 例 |
|------|------|-----|
| コンポーネントディレクトリ | `kebab-case` | `navigation`, `auth` |
| コンポーネントファイル | `PascalCase.tsx` | `ParentAuthGuard.tsx` |
| Hooks | `use{Feature}.ts(x)` | `useParentAuth.ts` |
| API Hooks | `hooks/api/use{Feature}.ts(x)` | `useParentAuth.ts` |
| Context | `{Name}Context.tsx` | `ParentAuthContext.tsx` |
| ライブラリ | `kebab-case.ts` | `api-client.ts`, `date-utils.ts` |
| 型ファイル | `kebab-case.ts` | `parent-auth.ts` |
| バレル | `index.ts` | `components/auth/index.ts` |

---

## 4. 共有パッケージ（`shared/types`）

| 対象 | 規則 | 例 |
|------|------|-----|
| 型ファイル | `kebab-case.ts` | `common.ts` |
| エントリ | 固定名 | `index.ts` |

---

## 5. テスト命名（Frontend / E2E）

| 区分 | 規則 | 例 |
|------|------|-----|
| Frontend Unit | `*.test.ts` / `*.test.tsx` | `ParentAuthGuard.test.tsx` |
| Frontend Integration | `*.int.test.tsx` / `*.int.spec.ts` | `parent-auth.int.test.tsx` |
| Playwright E2E | `*.spec.ts` / `*.e2e.spec.ts` | `parent-login.spec.ts` |

---

## 6. 補足ルール

- 新規追加時は「既存フォルダの命名流儀」を優先し、同一ディレクトリ内で混在させない
- 略語は既存表現に合わせる（例: `AI`, `DTO`, `API`）
- 役割接尾辞（`.service.ts`, `.controller.ts`, `.dto.ts` など）は省略しない
