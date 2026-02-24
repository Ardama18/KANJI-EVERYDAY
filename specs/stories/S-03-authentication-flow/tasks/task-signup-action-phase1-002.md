# タスク: signup系Server Actionとエラーハンドリングを実装する

メタ情報:
- ストーリー: S-03-authentication-flow
- フェーズ: 1
- 依存: `specs/stories/S-03-authentication-flow/tasks/task-middleware-boundary-phase0-001.md`
- 提供成果物:
  - `frontend/src/actions/auth-types.ts`
  - `frontend/src/actions/auth-actions.ts`（signUp系実装）
  - `frontend/src/lib/auth/display-name.ts`
  - `frontend/src/lib/auth/display-name.test.ts`
  - `frontend/src/actions/auth-actions.test.ts`（signup系ケース実装）
  - `specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx`（IT-AC01〜IT-AC08, IT-AC20のsignup経路実装）
- 関連AC: AC#1, AC#2, AC#3, AC#4, AC#5, AC#6, AC#7, AC#8, AC#20
- サイズ: 大きめ（11-15ファイル）

## 実装内容
`signUp` Server Action の入力検証、エラー文言マッピング、成功時 redirect、`users_profile` 初期作成を実装する。`auth-types` で state契約を固定し、`display_name` 正規化を共通化する。Phase 1前半として signup関連ACを統合テストまで完了させる。

## 対象ファイル
- [x] `frontend/src/actions/auth-types.ts`
- [x] `frontend/src/actions/auth-actions.ts`
- [x] `frontend/src/lib/auth/display-name.ts`
- [x] `frontend/src/lib/auth/display-name.test.ts`
- [x] `frontend/src/actions/auth-actions.test.ts`
- [x] `specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx`

## テスト観点
- Unit:
  - `UT-AC01-SIGNUP-VALIDATION`
  - `UT-AC02-CONFIG-MISMATCH-HANDLING`
  - `UT-AC03-SIGNUP-SESSION-REDIRECT`
  - `UT-AC04-PROFILE-CREATE-VALUES`
  - `UT-AC05-PROFILE-FAIL-NO-REDIRECT`
  - `UT-AC06-DUPLICATE-EMAIL-MESSAGE`
  - `UT-AC07-WEAK-PASSWORD-MESSAGE`
  - `UT-AC08-SIGNUP-SERVER-ERROR-MESSAGE`
  - `UT-AC20-SERVER-ACTIONS-FORM-BINDING`（signUp経路）
- Integration:
  - `IT-AC01`〜`IT-AC08`
  - `IT-AC20`（signUpフォーム経路）

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [x] `display-name.test.ts` に正規化/フォールバックの失敗テストを追加する。
- [x] `auth-actions.test.ts` に signup 正常系・異常系（重複メール/弱いPW/サーバーエラー/構成不一致）を失敗テストで追加する。
- [x] `authentication-flow.int.test.tsx` の `IT-AC01`〜`IT-AC08` を `it.todo` から失敗テストへ切り替える。
- [x] `IT-AC20` のうち signUpフォーム経路の失敗観測を追加する。

```bash
npm run test --prefix frontend -- src/lib/auth/display-name.test.ts src/actions/auth-actions.test.ts
npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx -t "IT-AC01|IT-AC02|IT-AC03|IT-AC04|IT-AC05|IT-AC06|IT-AC07|IT-AC08|IT-AC20"
```

### 2. Green Phase
- [x] `auth-types.ts` で form state / error code / message 契約を定義する。
- [x] `display-name.ts` で trim・空文字フォールバック・長さ境界を実装する。
- [x] `auth-actions.ts` の `signUp` に入力検証、Supabase呼び出し、session確認、profile作成、redirect/エラー制御を実装する。
- [x] AC#6〜AC#8 の文言を Design Doc準拠で返す。
- [x] `IT-AC01`〜`IT-AC08` が pass するまで Action とテストを調整する。

```bash
npm run test --prefix frontend -- src/lib/auth/display-name.test.ts src/actions/auth-actions.test.ts
npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx -t "IT-AC01|IT-AC02|IT-AC03|IT-AC04|IT-AC05|IT-AC06|IT-AC07|IT-AC08|IT-AC20"
```

### 3. Refactor Phase
- [x] signup エラーコード変換を関数化し、メッセージ定数を1箇所に集約する。
- [x] `auth-types` と `auth-actions` 間の型境界を厳密化し、`as` 多用を排除する。
- [x] signup対象統合テストを再実行し回帰なしを確認する。

```bash
npm run test --prefix frontend -- src/lib/auth/display-name.test.ts src/actions/auth-actions.test.ts
npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx -t "IT-AC01|IT-AC02|IT-AC03|IT-AC04|IT-AC05|IT-AC06|IT-AC07|IT-AC08|IT-AC20"
```

## 完了条件
- [x] `auth-types.ts` に signup系 state契約が定義されている。
- [x] `signUp` が AC#1〜AC#8 を満たす（検証/成功遷移/profile作成/エラー文言）。
- [x] `IT-AC01`〜`IT-AC08` と `IT-AC20`（signUp経路）が pass している。
- [x] AC#2 の設定前提不一致を検知する分岐が実装・テストされている。
- [x] 動作確認レベル L2（対象Unit + Integration）が満たされている。

## 動作確認
- [x] `npm run test --prefix frontend -- src/lib/auth/display-name.test.ts src/actions/auth-actions.test.ts`
- [x] `npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx -t "IT-AC01|IT-AC02|IT-AC03|IT-AC04|IT-AC05|IT-AC06|IT-AC07|IT-AC08|IT-AC20"`
- [x] `git diff --name-only`
