# S-03 Traceability Report

- Story: `S-03-authentication-flow`
- Last Updated: 2026-02-23
- Requirements: `specs/stories/S-03-authentication-flow/requirements.md`
- ADR: `specs/adr/ADR-003-authentication-flow.md`
- Design: `specs/stories/S-03-authentication-flow/design.md`
- Task: `specs/stories/S-03-authentication-flow/tasks/task-final-quality-e2e-phase3-005.md`

## AC/Should Traceability Matrix

| ID | Requirement / Rule | Implementation Evidence | Integration Evidence | E2E Evidence | Status |
|---|---|---|---|---|---|
| AC#1 | `/signup` 入力検証（display_name/email/password） | `frontend/src/actions/auth-actions.ts` | `authentication-flow.int.test.tsx` - `IT-AC01` | `authentication-flow.e2e.test.tsx` - `E2E-AC01` | Passed |
| AC#2 | `Enable email confirmations=OFF` を成立前提として扱う | `frontend/src/actions/auth-actions.ts`（session null -> config mismatch） / `design.md` AC#2 運用担保 | `authentication-flow.int.test.tsx` - `IT-AC02` | `authentication-flow.e2e.test.tsx` - `E2E-AC02` | Passed |
| AC#3 | signup 成功時の即時セッション確立と `/decks` 遷移 | `frontend/src/actions/auth-actions.ts` | `authentication-flow.int.test.tsx` - `IT-AC03` | `authentication-flow.e2e.test.tsx` - `E2E-AC03` | Passed |
| AC#4 | signup 成功時 `users_profile(display_name, timezone=Asia/Tokyo)` 作成 | `frontend/src/actions/auth-actions.ts` | `authentication-flow.int.test.tsx` - `IT-AC04` | `authentication-flow.e2e.test.tsx` - `E2E-AC04` | Passed |
| AC#5 | profile 作成失敗時の遷移停止 + 失敗表示 | `frontend/src/actions/auth-actions.ts` | `authentication-flow.int.test.tsx` - `IT-AC05` | `authentication-flow.e2e.test.tsx` - `E2E-AC05` | Passed |
| AC#6 | 重複メール文言表示 | `frontend/src/actions/auth-types.ts` / `frontend/src/actions/auth-actions.ts` | `authentication-flow.int.test.tsx` - `IT-AC06` | `authentication-flow.e2e.test.tsx` - `E2E-AC06` | Passed |
| AC#7 | パスワード要件不足文言表示 | `frontend/src/actions/auth-types.ts` / `frontend/src/actions/auth-actions.ts` | `authentication-flow.int.test.tsx` - `IT-AC07` | `authentication-flow.e2e.test.tsx` - `E2E-AC07` | Passed |
| AC#8 | signup サーバーエラー文言表示 | `frontend/src/actions/auth-types.ts` / `frontend/src/actions/auth-actions.ts` | `authentication-flow.int.test.tsx` - `IT-AC08` | `authentication-flow.e2e.test.tsx` - `E2E-AC08` | Passed |
| AC#9 | login 成功時 `/decks` 遷移 | `frontend/src/actions/auth-actions.ts` | `authentication-flow.int.test.tsx` - `IT-AC09` | `authentication-flow.e2e.test.tsx` - `E2E-AC09` | Passed |
| AC#10 | login 認証失敗文言表示 | `frontend/src/actions/auth-types.ts` / `frontend/src/actions/auth-actions.ts` | `authentication-flow.int.test.tsx` - `IT-AC10` | `authentication-flow.e2e.test.tsx` - `E2E-AC10` | Passed |
| AC#11 | login サーバーエラー文言表示 | `frontend/src/actions/auth-types.ts` / `frontend/src/actions/auth-actions.ts` | `authentication-flow.int.test.tsx` - `IT-AC11` | `authentication-flow.e2e.test.tsx` - `E2E-AC11` | Passed |
| AC#12 | モバイル優先UI制約（max-width 28rem / 48px+ / 全幅） | `frontend/app/login/page.tsx` / `frontend/app/signup/page.tsx` / `frontend/src/components/auth/{login-form,signup-form,submit-button}.tsx` | `authentication-flow.int.test.tsx` - `IT-AC12` | `authentication-flow.e2e.test.tsx` - `E2E-AC12` | Passed |
| AC#13 | login 時 profile 欠損救済後に `/decks` 遷移 | `frontend/src/lib/auth/ensure-user-profile.ts` / `frontend/src/actions/auth-actions.ts` | `authentication-flow.int.test.tsx` - `IT-AC13` | `authentication-flow.e2e.test.tsx` - `E2E-AC13` | Passed |
| AC#14 | profile 救済作成の冪等性 | `frontend/src/lib/auth/ensure-user-profile.ts` | `authentication-flow.int.test.tsx` - `IT-AC14` | `authentication-flow.e2e.test.tsx` - `E2E-AC14` | Passed |
| AC#15 | 未認証 `/decks` 系 -> `/login` | `frontend/middleware.ts` | `authentication-flow.int.test.tsx` - `IT-AC15` | `authentication-flow.e2e.test.tsx` - `E2E-AC15` | Passed |
| AC#16 | 認証済み `/login` `/signup` -> `/decks` | `frontend/middleware.ts` | `authentication-flow.int.test.tsx` - `IT-AC16` | `authentication-flow.e2e.test.tsx` - `E2E-AC16` | Passed |
| AC#17 | 公開ルート `/` は常時表示可能 | `frontend/middleware.ts` | `authentication-flow.int.test.tsx` - `IT-AC17` | `authentication-flow.e2e.test.tsx` - `E2E-AC17` | Passed |
| AC#18 | matcher 除外パスで認証リダイレクトなし | `frontend/middleware.ts` | `authentication-flow.int.test.tsx` - `IT-AC18` | `authentication-flow.e2e.test.tsx` - `E2E-AC18` | Passed |
| AC#19 | auth layout のアプリ名 + signout 導線 + `/login` 遷移 | `frontend/app/(auth)/layout.tsx` / `frontend/src/components/auth/signout-button.tsx` / `frontend/src/actions/auth-actions.ts` | `authentication-flow.int.test.tsx` - `IT-AC19` | `authentication-flow.e2e.test.tsx` - `E2E-AC19` | Passed |
| AC#20 | `signUp`/`signIn`/`signOut` の Server Actions + form 経路 | `frontend/src/actions/auth-actions.ts` / `frontend/src/components/auth/{login-form,signup-form,signout-button}.tsx` | `authentication-flow.int.test.tsx` - `IT-AC20` | `authentication-flow.e2e.test.tsx` - `E2E-AC20` | Passed |
| SH-01 | 送信中の二重送信防止（無効化/ローディング） | `frontend/src/components/auth/submit-button.tsx` | `frontend/src/components/auth/login-form.test.tsx` - `UT-SH01-SUBMIT-DISABLE` | `authentication-flow.e2e.test.tsx` - `E2E-SH01-LOADING-BEHAVIOR` | Passed |
| SH-02 | login/signup 相互導線 | `frontend/src/components/auth/{login-form,signup-form}.tsx` | `authentication-flow.int.test.tsx` - `IT-SH02` | `authentication-flow.e2e.test.tsx` - `E2E-SH02-LOGIN-SIGNUP-CROSS-NAVIGATION` | Passed |

## AC#2 Operational Evidence (`Enable email confirmations=OFF`)

- 設計運用: `specs/stories/S-03-authentication-flow/design.md` の「AC#2 運用担保」セクションで、pre-deploy確認責任者・証跡・承認手順を定義。
- 実装ガード: `frontend/src/actions/auth-actions.ts` で `signup` の `session` が `null` の場合に `configMismatch` を返し、`/decks` 遷移を禁止。
- テスト証跡: `IT-AC02` と `E2E-AC02` が上記ガード挙動を回帰固定。

## Final Run Log

| Command | Purpose | Result |
|---|---|---|
| `npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.e2e.test.tsx` | E2E AC#1〜#20 + SH検証（Red確認） | Failed（Red phase: 20/20 failing, `todo`から失敗テスト化を確認） |
| `npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.e2e.test.tsx` | E2E AC#1〜#20 + SH検証（Green/Refactor確認） | Passed（24 tests） |
| `npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx` | Integration 全件回帰（IT-AC01〜20 + IT-SH02） | Passed（26 tests） |
| `npm run check --prefix frontend` | frontend 品質ゲート（lint/typecheck/test） | Passed（17 files / 112 tests） |
| `bash .claude/skills/quality-fixer/scripts/quality-check.sh` | `/quality-fixer` 実行 | Not Available（script missing: `No such file or directory`） |
| `npm run check --prefix frontend` | `/quality-fixer` 代替品質ゲート（同等） | Passed（approved equivalent: lint/typecheck/test all pass） |

## Plan Rule Evidence

- Rule: 「統合テストは各Phase内で実行」
  - Evidence: `task-auth-ui-layout-phase2-004.md` までに Phase 0〜2 の統合テストを段階実行済み。
  - Final Regressions: 本タスクで `authentication-flow.int.test.tsx` 全件を再実行し全PASSを確認。
- Rule: 「E2Eは最終Phaseでのみ実行」
  - Evidence: `task-final-quality-e2e-phase3-005.md` で `authentication-flow.e2e.test.tsx` を初めて実装・実行し、最終Phaseの受入証跡として固定。
