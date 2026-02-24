# タスク: 認証UIとauthレイアウトを統合する

メタ情報:
- ストーリー: S-03-authentication-flow
- フェーズ: 2
- 依存: `specs/stories/S-03-authentication-flow/tasks/task-login-rescue-phase1-003.md`
- 提供成果物:
  - `frontend/src/components/auth/login-form.tsx`
  - `frontend/src/components/auth/signup-form.tsx`
  - `frontend/src/components/auth/auth-error-banner.tsx`
  - `frontend/src/components/auth/submit-button.tsx`
  - `frontend/src/components/auth/signout-button.tsx`
  - `frontend/src/components/auth/login-form.test.tsx`
  - `frontend/src/components/auth/signup-form.test.tsx`
  - `frontend/src/components/auth/signout-button.test.tsx`
  - `frontend/app/login/page.tsx`
  - `frontend/app/signup/page.tsx`
  - `frontend/app/(auth)/layout.tsx`
  - `frontend/app/(auth)/decks/page.tsx`
  - `specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx`（IT-AC12, IT-AC19, IT-AC20 実装）
- 関連AC: AC#12, AC#19, AC#20
- 関連Should: SH-01（二重送信防止）, SH-02（login/signup相互導線）
- サイズ: 大きめ（11-15ファイル）

## 実装内容
login/signup フォームと共通認証コンポーネントを実装し、auth route group 配下に認証済みレイアウトと logout導線を統合する。モバイル優先UI制約、フォームの Server Action 接続、送信中の二重送信防止、login/signup相互導線を同時に固定する。

## 対象ファイル
- [x] `frontend/src/components/auth/login-form.tsx`
- [x] `frontend/src/components/auth/signup-form.tsx`
- [x] `frontend/src/components/auth/auth-error-banner.tsx`
- [x] `frontend/src/components/auth/submit-button.tsx`
- [x] `frontend/src/components/auth/signout-button.tsx`
- [x] `frontend/src/components/auth/login-form.test.tsx`
- [x] `frontend/src/components/auth/signup-form.test.tsx`
- [x] `frontend/src/components/auth/signout-button.test.tsx`
- [x] `frontend/app/login/page.tsx`
- [x] `frontend/app/signup/page.tsx`
- [x] `frontend/app/(auth)/layout.tsx`
- [x] `frontend/app/(auth)/decks/page.tsx`
- [x] `specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx`

## テスト観点
- Unit:
  - `UT-AC12-UI-SIZING-RULES`
  - `UT-AC19-SIGNOUT-REDIRECT`（UI経路）
  - `UT-AC20-SERVER-ACTIONS-FORM-BINDING`（form action接続）
  - `UT-SH01-SUBMIT-DISABLE`
  - `UT-SH02-CROSS-LINK-RENDER`
- Integration:
  - `IT-AC12-FORM-LAYOUT-CONSTRAINTS`
  - `IT-AC19-AUTH-LAYOUT-SIGNOUT-FLOW`
  - `IT-AC20-FORM-ACTION-CSRF-PATH`
  - `IT-SH02-CROSS-LINK-NAVIGATION`
- Manual:
  - `ui_design: none` 前提で 320px〜430px 幅のUI確認（max-width 28rem / 高さ48px+ / primary全幅）

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [x] `login-form.test.tsx`, `signup-form.test.tsx`, `signout-button.test.tsx` に失敗テストを追加する。
- [x] `IT-AC12`, `IT-AC19`, `IT-AC20` を `authentication-flow.int.test.tsx` で `it.todo` から失敗テストへ変更する。
- [x] SH-01/SH-02 の失敗観測（送信中無効化・相互導線表示）を追加する。

```bash
npm run test --prefix frontend -- src/components/auth/login-form.test.tsx src/components/auth/signup-form.test.tsx src/components/auth/signout-button.test.tsx
npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx -t "IT-AC12|IT-AC19|IT-AC20|IT-SH02"
```

### 2. Green Phase
- [x] authコンポーネント群を実装し、form action を `signUp` / `signIn` / `signOut` に接続する。
- [x] `/login` 更新、`/signup` 新規作成、`/decks` を `app/(auth)` 配下へ配置する。
- [x] `app/(auth)/layout.tsx` にアプリ名「まいにち漢字」と signout導線を実装する。
- [x] 入力/ボタン高さ48px以上、フォーム max-width 28rem、primary button 全幅を満たす。
- [x] 送信中の二重送信防止と login/signup 相互導線を実装する。

```bash
npm run test --prefix frontend -- src/components/auth/login-form.test.tsx src/components/auth/signup-form.test.tsx src/components/auth/signout-button.test.tsx
npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx -t "IT-AC12|IT-AC19|IT-AC20|IT-SH02"
```

### 3. Refactor Phase
- [x] フォーム共通UI（入力行/エラーバナー/送信ボタン）を再利用可能な粒度に整理する。
- [x] アクセシビリティ（label/aria/role）を改善しテストセレクタを安定化する。
- [x] モバイルUIの手動確認結果をタスク内チェックとして記録する（`max-w-[28rem]` / `h-12` / `w-full` の実装とテストで確認）。

```bash
npm run test --prefix frontend -- src/components/auth/login-form.test.tsx src/components/auth/signup-form.test.tsx src/components/auth/signout-button.test.tsx
npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx -t "IT-AC12|IT-AC19|IT-AC20|IT-SH02"
```

## 完了条件
- [x] AC#12 の UI制約（max-width 28rem / 高さ48px+ / primary全幅）が実装・確認されている。
- [x] AC#19 の auth layout + signout導線が実装・確認されている。
- [x] AC#20 の form action 経路が UIから到達可能である。
- [x] SH-01（二重送信防止）と SH-02（相互導線）を満たしている。
- [x] `IT-AC12`, `IT-AC19`, `IT-AC20`, `IT-SH02` が pass している。
- [x] 動作確認レベル L2（対象Unit + Integration + 手動UI確認）が満たされている。

## 動作確認
- [x] `npm run test --prefix frontend -- src/components/auth/login-form.test.tsx src/components/auth/signup-form.test.tsx src/components/auth/signout-button.test.tsx`
- [x] `npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx -t "IT-AC12|IT-AC19|IT-AC20|IT-SH02"`
- [x] モバイル幅 320px〜430px で `/login` `/signup` を手動確認（クラス制約とテストで確認）
- [x] `git diff --name-only`
