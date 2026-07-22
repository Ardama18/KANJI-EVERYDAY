# S-16A Requirements

## 機能要件

- FR-1: `public.card_mnemonics` テーブルを新設し、承認済みの `slots`（jsonb）と `explanation`（jsonb）を永続化する。
- FR-2: 行は owner（`owner_user_id`）に紐づき、`(owner_user_id, illustration_key)` で一意。
- FR-3: `status` は `'draft' | 'approved'`（DEFAULT `'approved'`）で CHECK 制約を持つ。
- FR-4: `updated_at` は BEFORE UPDATE トリガーで自動更新する。
- FR-5: TypeScript の Database 型に `card_mnemonics` を追加する。
- FR-6: seed に「見」の承認済み1件を追加する（slots/explanation は Epic #40 正本形）。

## 非機能・セキュリティ要件

- NFR-1: RLS を有効化し、select/insert/update を owner（`auth.uid() = owner_user_id`）に限定する。
- NFR-2: runtime grant は既存パターンに従い、`authenticated` ロールへ SELECT/INSERT/UPDATE を付与する。
- NFR-3: 既存テーブル（illustrations 等）には触れない。Browser/Server の Supabase client を混在させない。
- NFR-4: server-only secret をブラウザ用モジュールから参照しない（本 Issue はスキーマ・型・seed のみ）。

## 受入条件（AC）

- AC-1: owner 以外は select/insert/update できない（RLS ポリシーが owner 限定である）。
- AC-2: `(owner_user_id, illustration_key)` の重複 insert が一意制約で失敗する。
- AC-3: `status` が `'draft' | 'approved'` 以外で CHECK 制約に失敗する。
- AC-4: `updated_at` トリガーで更新時刻が更新される（`update_updated_at_column()` 再利用）。
- AC-5: seed 適用後に「見」の1件が存在し、slots/explanation が正本形。
- AC-6: `npm --prefix frontend run check` が通る。

## テスト方針

- `check` に含まれる Vitest では live DB を使わないため、AC-1〜AC-4 は **静的 SQL migration-contract テスト**で検証する
  （S-17 `daily-study-limit-migration-contract.test.ts` の流儀）。
- Database 型に `card_mnemonics` が存在することを型テストで検証する（AC-5/型 = FR-5）。
- seed の正本形は migration-contract テスト内で seed SQL を静的に検証する（AC-5）。
