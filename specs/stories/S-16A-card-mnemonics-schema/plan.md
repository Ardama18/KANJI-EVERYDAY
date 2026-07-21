# S-16A 作業計画書（plan.md）

本ファイルを実装の単一情報源とする。全フェーズを記載順に実装する。`tasks/` や個別 task ファイルは生成・参照・更新しない。
スコープは **スキーマ・型・seed・静的テストのみ**。承認 UI・生成・表示・プロンプトテンプレートには触れない。既存の未関連ファイルを変更しない。

## Phase 1: migration 新規作成

**ファイル（新規）**: `supabase/migrations/20260721000000_s16_card_mnemonics.sql`

> 注: Issue 記載のファイル名は `20260721000000_s16_card_mnemonics.sql`。既存の `20260721000000_s17_daily_study_limit.sql` と
> UTC timestamp prefix が同一だが、suffix が異なるため別ファイルとして共存する（Issue 指定のファイル名を正とする）。

内容（S-02 のスキーマ/RLS 流儀、`20260718000002_fix_runtime_authenticated_grants.sql` の grant 流儀に厳密に倣う）:

```sql
-- S-16A card_mnemonics: 承認済みニーモニック穴埋め(slots)と表示用説明(explanation)
-- AC-1 / AC-2 / AC-3 / AC-4

CREATE TABLE public.card_mnemonics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  illustration_key text NOT NULL,
  slots jsonb NOT NULL,
  explanation jsonb NOT NULL,
  status text NOT NULL DEFAULT 'approved',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT card_mnemonics_owner_illustration_key_unique UNIQUE (owner_user_id, illustration_key),
  CONSTRAINT card_mnemonics_status_check CHECK (status IN ('draft', 'approved'))
);

CREATE TRIGGER set_card_mnemonics_updated_at
BEFORE UPDATE ON public.card_mnemonics
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.card_mnemonics ENABLE ROW LEVEL SECURITY;

CREATE POLICY card_mnemonics_select_owner
ON public.card_mnemonics
FOR SELECT
USING (auth.uid() = owner_user_id);

CREATE POLICY card_mnemonics_insert_owner
ON public.card_mnemonics
FOR INSERT
WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY card_mnemonics_update_owner
ON public.card_mnemonics
FOR UPDATE
USING (auth.uid() = owner_user_id)
WITH CHECK (auth.uid() = owner_user_id);

GRANT SELECT, INSERT, UPDATE ON TABLE public.card_mnemonics TO authenticated;
```

完了条件: SQL がスキーマ・UNIQUE・CHECK・トリガー・RLS 有効化・3 つの owner ポリシー・authenticated grant を含む。
`update_updated_at_column()` は再定義しない（既存関数を再利用）。既存テーブルへの ALTER/UPDATE/DELETE を含めない。

## Phase 2: Database 型追加

**ファイル**: `frontend/src/types/database.ts`

`card_tags` テーブル定義の直前（アルファベット順）に `card_mnemonics` を追加する。既存 `illustrations` と同じ流儀:

```ts
			card_mnemonics: {
				Row: {
					created_at: string;
					explanation: Json;
					id: string;
					illustration_key: string;
					owner_user_id: string;
					slots: Json;
					status: string;
					updated_at: string;
				};
				Insert: {
					created_at?: string;
					explanation: Json;
					id?: string;
					illustration_key: string;
					owner_user_id: string;
					slots: Json;
					status?: string;
					updated_at?: string;
				};
				Update: {
					created_at?: string;
					explanation?: Json;
					id?: string;
					illustration_key?: string;
					owner_user_id?: string;
					slots?: Json;
					status?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
```

完了条件: `card_tags` の直前に挿入され、`tsc --noEmit` が通る。既存の型定義を壊さない。

## Phase 3: seed 追加

**ファイル**: `supabase/seed.sql`

末尾の `COMMIT;` の**直前**に、seed owner 所有の「見」1件を冪等 INSERT する（Epic #40 正本形）:

```sql
INSERT INTO public.card_mnemonics (
	owner_user_id,
	illustration_key,
	slots,
	explanation,
	status
)
VALUES (
	'00000000-0000-4000-8000-000000000001'::uuid,
	'見',
	'{"kanji":"見","isSingleKanji":true,"shapeHint":{"part":"下の「見」","picture":"目"},"meaningHint":"見る・気づく","story":"目で見たものが頭の中で光って記憶に残る"}'::jsonb,
	'{"summary":"目で見たものが、頭の中で光って記憶に残る。","mappings":[{"part":"下の「見」","meaning":"目で見る"},{"part":"上の光","meaning":"頭の中で気づき、記憶する"},{"part":"目から光へ伸びる線","meaning":"見た情報が記憶になる"}]}'::jsonb,
	'approved'
)
ON CONFLICT (owner_user_id, illustration_key) DO UPDATE
SET
	slots = EXCLUDED.slots,
	explanation = EXCLUDED.explanation,
	status = EXCLUDED.status;
```

完了条件: `COMMIT;` の前に挿入。既存 seed の他ステートメントを変更しない。JSON が Epic #40 正本形と一致。

## Phase 4: テスト追加（静的 migration-contract ＋ 型テスト）

**ファイル（新規）**: `frontend/src/lib/card-mnemonics/migration-contract.test.ts`

`check` の Vitest は live DB を使わないため、S-17 `daily-study-limit-migration-contract.test.ts` の流儀に倣い、
migration SQL / seed SQL / Database 型を静的に検証する。

検証内容:
1. migration がテーブル・全列・`UNIQUE (owner_user_id, illustration_key)`・`CHECK (status IN ('draft','approved'))` を定義する（AC-2/AC-3）。
2. RLS を有効化し、select/insert/update の owner ポリシー（`auth.uid() = owner_user_id`）を定義する（AC-1）。
3. `set_card_mnemonics_updated_at` BEFORE UPDATE トリガーが `public.update_updated_at_column()` を実行する（AC-4）。
4. migration が `authenticated` へ SELECT/INSERT/UPDATE grant する。
5. migration が既存テーブルを変更しない（`ALTER TABLE`/`UPDATE`/`DELETE`/`DROP` が他テーブルに向かない）。
6. seed が「見」の card_mnemonics を status 'approved' で正本形の slots/explanation 付きで挿入する（AC-5）。
7. 型テスト: `Database["public"]["Tables"]["card_mnemonics"]["Row"]` が `slots: Json` / `explanation: Json` / `status: string` 等を持つ（型レベル assert、FR-5）。

完了条件: `npm --prefix frontend run check`（lint + typecheck + vitest）が通る（AC-6）。

## 実装対象ファイル一覧

- 新規: `supabase/migrations/20260721000000_s16_card_mnemonics.sql`
- 変更: `frontend/src/types/database.ts`
- 変更: `supabase/seed.sql`
- 新規: `frontend/src/lib/card-mnemonics/migration-contract.test.ts`

## スコープ外（触れない）

- 承認 UI（AiCardForm）、AI 下書き生成、生成トリガー、プロンプトテンプレート、表示（S-16B〜F）。
- 既存テーブル・既存 migration・既存の未関連ファイル。
