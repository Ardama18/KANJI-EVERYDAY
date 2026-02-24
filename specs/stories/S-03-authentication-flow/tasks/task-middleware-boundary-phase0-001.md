# タスク: middleware境界とストーリーテスト実行基盤を固定する

メタ情報:
- ストーリー: S-03-authentication-flow
- フェーズ: 0
- 依存: なし
- 提供成果物:
  - `frontend/src/lib/supabase/middleware.ts`
  - `frontend/middleware.ts`
  - `frontend/src/middleware.test.ts`
  - `frontend/vitest.config.ts`
  - `specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx`（IT-AC15〜IT-AC18 実装）
- 関連AC: AC#15, AC#16, AC#17, AC#18
- サイズ: 標準（4-10ファイル）

## 実装内容
ADR-003準拠の認証境界を middleware で固定する。`/decks` 保護、guest-onlyリダイレクト、公開ルート通過、matcher除外を実装し、Phase 0対象の統合テストを同コミットで合格させる。併せて S-03 ストーリーテストを frontend の test 実行経路で実行可能にする。

## 対象ファイル
- [x] `frontend/src/lib/supabase/middleware.ts`
- [x] `frontend/middleware.ts`
- [x] `frontend/src/middleware.test.ts`
- [x] `frontend/vitest.config.ts`
- [x] `specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx`

## テスト観点
- Unit:
  - `UT-AC15-MW-UNAUTH-PROTECTED`: 未認証 `/decks*` -> `/login`
  - `UT-AC16-MW-AUTH-GUESTONLY`: 認証済み `/login|/signup` -> `/decks`
  - `UT-AC17-MW-PUBLIC-PASS`: 公開ルート `/` を通過
  - `UT-AC18-MW-MATCHER-EXCLUDE`: `/_next/static`, `/_next/image`, `/favicon.ico` を除外
- Integration:
  - `IT-AC15`, `IT-AC16`, `IT-AC17`, `IT-AC18` を `authentication-flow.int.test.tsx` に実装して合格

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [x] `frontend/src/middleware.test.ts` に判定マトリクスの失敗テストを追加する。
- [x] `authentication-flow.int.test.tsx` の `IT-AC15`〜`IT-AC18` を `it.todo` から失敗テストへ変更する。
- [x] 現状実装で失敗することを確認する。

```bash
npm run test --prefix frontend -- src/middleware.test.ts
npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx -t "IT-AC15|IT-AC16|IT-AC17|IT-AC18"
```

### 2. Green Phase
- [x] `frontend/src/lib/supabase/middleware.ts` に Cookie 同期責務のみを持つ Supabase client を実装する。
- [x] `frontend/middleware.ts` に route分類・redirect条件・matcher除外を実装する。
- [x] `frontend/vitest.config.ts` を更新し、S-03ストーリーテストを実行対象に含める。
- [x] `IT-AC15`〜`IT-AC18` が pass するまで middleware 判定を調整する。

```bash
npm run test --prefix frontend -- src/middleware.test.ts
npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx -t "IT-AC15|IT-AC16|IT-AC17|IT-AC18"
```

### 3. Refactor Phase
- [x] route判定ロジック（protected/guestOnly/public/excluded）を可読性の高い定数へ整理する。
- [x] matcher除外の漏れがないようテーブル駆動テスト化する。
- [x] Phase 0対象テストを再実行し回帰がないことを確認する。

```bash
npm run test --prefix frontend -- src/middleware.test.ts
npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx -t "IT-AC15|IT-AC16|IT-AC17|IT-AC18"
```

## 完了条件
- [x] `frontend/middleware.ts` が AC#15〜AC#18 の判定を満たす。
- [x] `frontend/vitest.config.ts` で S-03 ストーリーテストを実行可能になっている。
- [x] `IT-AC15`〜`IT-AC18` が pass している。
- [x] 変更差分が Phase 0 の論理単位で1コミット可能である。
- [x] 動作確認レベル L2（対象Unit + Integration）が満たされている。

## 動作確認
- [x] `npm run test --prefix frontend -- src/middleware.test.ts`
- [x] `npm run test --prefix frontend -- ../specs/stories/S-03-authentication-flow/tests/authentication-flow.int.test.tsx -t "IT-AC15|IT-AC16|IT-AC17|IT-AC18"`
- [x] `git diff --name-only`
