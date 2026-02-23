# フロントエンドAPI呼び出しパターン（Hapico）

フロントエンドからバックエンドAPIを呼び出す際の標準ルール。

## 基本方針

- **原則**: `src/lib/api-client.ts` の `apiClient<T>()` を使用
- **パス**: 相対パス（`/api/*`, `/auth/*`）を使用
- **認証**: `credentials: include` でCookieを送信
- **転送**: `middleware.ts` が backend へプロキシ

## 推奨パターン

| 操作種別 | 推奨手段 | 例 |
|---------|----------|----|
| Query（取得） | `apiClient<T>()` + `hooks/api` | `useTodayTasks`, `usePointHistory` |
| Mutation（作成/更新/削除） | `apiClient<T>()` + mutation hook | `useCreateTask`, `useTaskApproval` |
| ファイルアップロード | `fetch` + `FormData` | `/api/tasks/:id/upload-evidence` |
| 非JSONレスポンス | `fetch` で直接処理 | 画像・バイナリ応答 |

## 実装配置ルール

- APIクライアント: `frontend/src/lib/api-client.ts`
- API呼び出しhook: `frontend/src/hooks/api/`
- 画面ロジック: `frontend/app/**/page.tsx` または `frontend/src/components/**`

## 実装例

### 1. 通常のJSON API呼び出し

```typescript
import { apiClient } from "@/lib/api-client"

const response = await apiClient<TodayTasksResponseDto>("/api/tasks/today")
```

### 2. mutation処理

```typescript
await apiClient("/api/tasks", {
  method: "POST",
  body: payload,
})
```

### 3. ファイルアップロード

```typescript
const formData = new FormData()
formData.append("file", file)

await fetch(`/api/tasks/${taskId}/upload-evidence`, {
  method: "POST",
  body: formData,
  credentials: "include",
})
```

## エラーハンドリング

- `apiClient` は非2xx時に `ApiError` をthrow
- UI側では以下を分離して扱う
  - ユーザー向けメッセージ表示
  - 開発向けログ出力

## テスト方針

- Hook/Componentテストでは `apiClient` をモック
- E2Eでは実APIに対して主要フローを検証

### Vitestモック例

```typescript
import { vi } from "vitest"

vi.mock("@/lib/api-client", () => ({
  apiClient: vi.fn(),
  ApiError: class extends Error {},
}))
```
