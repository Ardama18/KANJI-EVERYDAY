# タスク: login/signoutとprofile救済ロジックを実装する

メタ情報:
- ストーリー: S-03-authentication-flow
- フェーズ: 1
- 依存: `specs/stories/S-03-authentication-flow/tasks/task-signup-action-phase1-002.md`
- 提供成果物:
  - `frontend/src/lib/auth/ensure-user-profile.ts`
  - `frontend/src/lib/auth/ensure-user-profile.test.ts`
  - `frontend/src/actions/auth-actions.ts`（signIn/signOut + rescue統合）
  - `frontend/src/actions/auth-actions.test.ts`（login/signout系ケース実装）
  - `specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx`（IT-AC09〜IT-AC11, IT-AC13, IT-AC14, IT-AC20実装）
- 関連AC: AC#9, AC#10, AC#11, AC#13, AC#14, AC#20
- サイズ: 標準（4-10ファイル）

## 実装内容
`signIn`/`signOut` Server Action と `users_profile` 救済作成を実装する。login成功時に profile 欠損を検知して救済作成後に `/decks` へ遷移し、競合時は成功扱いで冪等性を維持する。login系エラー文言と signOut 遷移を unit/integration で固定する。

## 対象ファイル
- [x] `frontend/src/lib/auth/ensure-user-profile.ts`
- [x] `frontend/src/lib/auth/ensure-user-profile.test.ts`
- [x] `frontend/src/actions/auth-actions.ts`
- [x] `frontend/src/actions/auth-actions.test.ts`
- [x] `specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx`

## テスト観点
- Unit:
  - `UT-AC09-LOGIN-SUCCESS-REDIRECT`
  - `UT-AC10-INVALID-CREDENTIALS-MESSAGE`
  - `UT-AC11-LOGIN-SERVER-ERROR-MESSAGE`
  - `UT-AC13-PROFILE-RESCUE-ON-LOGIN`
  - `UT-AC14-RESCUE-IDEMPOTENCY`
  - `UT-AC19-SIGNOUT-REDIRECT`（action単体）
  - `UT-AC20-SERVER-ACTIONS-FORM-BINDING`（signIn/signOut経路）
- Integration:
  - `IT-AC09`, `IT-AC10`, `IT-AC11`, `IT-AC13`, `IT-AC14`, `IT-AC20`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [x] `ensure-user-profile.test.ts` に「欠損時作成」「既存時スキップ」「競合時成功扱い」の失敗テストを追加する。
- [x] `auth-actions.test.ts` に login成功/認証失敗/サーバーエラー/signOut遷移の失敗テストを追加する。
- [x] `authentication-flow.int.test.tsx` の `IT-AC09`〜`IT-AC11`, `IT-AC13`, `IT-AC14` を `it.todo` から失敗テストへ変更する。
- [x] `IT-AC20` の signIn/signOut 経路の失敗観測を追加する。

```bash
npm run test --prefix frontend -- src/lib/auth/ensure-user-profile.test.ts src/actions/auth-actions.test.ts
npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx -t "IT-AC09|IT-AC10|IT-AC11|IT-AC13|IT-AC14|IT-AC20"
```

### 2. Green Phase
- [x] `ensure-user-profile.ts` で `user_id` 単位の冪等救済作成（`ON CONFLICT DO NOTHING` 相当）を実装する。
- [x] `auth-actions.ts` の `signIn` に login成功遷移、失敗文言変換、救済フロー呼び出しを実装する。
- [x] `auth-actions.ts` の `signOut` にセッション破棄と `/login` 遷移を実装する。
- [x] login系統合テストが pass するまで Action/Helper を調整する。

```bash
npm run test --prefix frontend -- src/lib/auth/ensure-user-profile.test.ts src/actions/auth-actions.test.ts
npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx -t "IT-AC09|IT-AC10|IT-AC11|IT-AC13|IT-AC14|IT-AC20"
```

### 3. Refactor Phase
- [x] signup/login 共通のエラーマッピング処理を整理し重複を削減する。
- [x] 救済ロジックの副作用境界（DBアクセス/戻り値）を明確化しテスト可読性を改善する。
- [x] login関連統合テストを再実行し回帰なしを確認する。

```bash
npm run test --prefix frontend -- src/lib/auth/ensure-user-profile.test.ts src/actions/auth-actions.test.ts
npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx -t "IT-AC09|IT-AC10|IT-AC11|IT-AC13|IT-AC14|IT-AC20"
```

## 完了条件
- [x] `ensure-user-profile.ts` が AC#13/AC#14 の救済要件（欠損時作成・冪等）を満たす。
- [x] `signIn` が AC#9〜AC#11 を満たす（成功遷移/失敗文言/サーバーエラー）。
- [x] `signOut` が Server Action として実装され、`/login` 遷移を返す。
- [x] `IT-AC09`, `IT-AC10`, `IT-AC11`, `IT-AC13`, `IT-AC14`, `IT-AC20` が pass している。
- [x] 動作確認レベル L2（対象Unit + Integration）が満たされている。

## 動作確認
- [x] `npm run test --prefix frontend -- src/lib/auth/ensure-user-profile.test.ts src/actions/auth-actions.test.ts`
- [x] `npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx -t "IT-AC09|IT-AC10|IT-AC11|IT-AC13|IT-AC14|IT-AC20"`
- [x] `git diff --name-only`
