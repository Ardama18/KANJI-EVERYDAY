# TypeScript テストルール（Hapico）

このドキュメントは、`Hapico` プロジェクトのテスト戦略と実装ルールを定義する。

## テストフレームワーク

| 対象 | フレームワーク | 主な配置 |
|------|----------------|----------|
| Frontend Unit/Integration | Vitest + Testing Library | `frontend/tests/**` |
| Frontend E2E | Playwright | `frontend/e2e/**` |
| Cross E2E | Playwright | `e2e/tests/**` |
| Backend Unit/Integration | Jest (+ Supertest) | `backend/src/**`, `test/**` |

## テストの基本方針

- 振る舞いを検証し、実装詳細に過度に依存しない
- 失敗しやすい境界（認証、状態遷移、日付計算、外部API）から優先的にテストする
- 1つのテストで複数責務を検証しない
- テスト名は「何を期待するか」を明確に表現する

## Red-Green-Refactor プロセス

1. **Red**: まず失敗するテストを書く
2. **Green**: 最小実装で通す
3. **Refactor**: 重複除去・可読性向上（挙動は不変）

## テストの粒度

### Unit Test

- 1関数/1コンポーネント/1サービスの局所的振る舞いを検証
- 外部依存はモックする

### Integration Test

- 複数コンポーネント・Hook連携、またはAPI層〜サービス層の接続を検証
- 実際のDTO/レスポンス契約に寄せる

### E2E Test

- ユーザー操作ベースで主要導線を検証
- 最低限守るフロー: ログイン、タスク提出、承認、報酬交換

## 命名と配置

- Frontend unit: `*.test.ts` / `*.test.tsx`
- Frontend integration: `*.int.test.tsx` / `*.int.spec.ts`
- Backend unit: `*.spec.ts`
- Backend integration: `*.integration.spec.ts`
- E2E: `*.spec.ts` / `*.e2e.spec.ts`

詳細は `.claude/rules/naming-convention.md` を参照。

## モック実装ルール

- モックは型付きで定義する
- `any` を避け、`unknown` + 型絞り込みを使う
- APIクライアントモックは最小限の振る舞いのみ差し替える

### Vitest 例（Frontend）

```typescript
import { vi } from "vitest"

vi.mock("@/lib/api-client", () => ({
  apiClient: vi.fn(),
  ApiError: class extends Error {},
}))
```

### Jest 例（Backend）

```typescript
const prismaMock = {
  task: {
    findMany: jest.fn(),
  },
}
```

## 非同期テストのルール

- `async/await` を使い、Promise未解決状態を残さない
- エラー系は `rejects.toThrow()` で明示的に検証する
- 日時依存ロジックは固定時刻を使う（テストの再現性確保）

## 実装例

### Frontend Hook（Vitest）

```typescript
import { renderHook, waitFor } from "@testing-library/react"
import { vi, describe, it, expect } from "vitest"
import { apiClient } from "@/lib/api-client"
import { useTodayTasks } from "@/hooks/api/useTodayTasks"

vi.mock("@/lib/api-client", () => ({
  apiClient: vi.fn(),
}))

describe("useTodayTasks", () => {
  it("今日のタスク一覧を取得できる", async () => {
    vi.mocked(apiClient).mockResolvedValueOnce({ tasks: [], progress: { completed: 0, total: 0 } })

    const { result } = renderHook(() => useTodayTasks())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.error).toBeNull()
    expect(result.current.data).toBeTruthy()
  })
})
```

### Backend Service（Jest）

```typescript
import { TasksService } from "./tasks.service"

describe("TasksService", () => {
  it("未存在タスク参照時にNotFoundExceptionを投げる", async () => {
    const prisma = { task: { findUnique: jest.fn().mockResolvedValue(null) } } as never
    const service = new TasksService(prisma, {} as never, {} as never)

    await expect(service.findOne("missing-id")).rejects.toThrow("not found")
  })
})
```

## E2E ガイド

- UI表示だけでなく、API呼び出し結果に紐づく状態変化を検証する
- Flaky回避のため、`data-testid` や role ベースセレクタを優先
- 1シナリオで複数責務を詰め込みすぎない

## 品質ゲート

変更時は影響範囲に応じて以下を実行する。

- Frontend unit/integration: `npm run test --workspace=frontend`
- Frontend E2E: `npm run test:e2e --workspace=frontend`
- Backend unit: `npm run test --workspace=backend`
- Backend E2E/Integration: `npm run test:e2e --workspace=backend`

必要に応じてルートで `npm run check:all` を実行する。
