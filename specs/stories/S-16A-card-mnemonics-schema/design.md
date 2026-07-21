# S-16A Design Doc

## 決定: 独立テーブル `public.card_mnemonics`

`illustrations` には説明列がなく、承認は `illustrations` 行が存在する前に起きる（カード作成時）。
既存テーブル拡張ではなくスキーマを分離した独立テーブルを新設する（Epic #40 の確定方針）。

`illustration_key` は既存 `illustrations.illustration_key` / `cards.illustration_key` と同じ論理キー
（text。単字なら漢字、熟語なら語彙）。承認は行作成前に起きるため FK 制約は張らず text で保持する
（既存 `illustrations.illustration_key` も FK なしの text で同様）。

## スキーマ

| 列 | 型 | 制約 |
|---|---|---|
| id | uuid | PRIMARY KEY DEFAULT gen_random_uuid() |
| owner_user_id | uuid | NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE |
| illustration_key | text | NOT NULL |
| slots | jsonb | NOT NULL |
| explanation | jsonb | NOT NULL |
| status | text | NOT NULL DEFAULT 'approved', CHECK IN ('draft','approved') |
| created_at | timestamptz | NOT NULL DEFAULT now() |
| updated_at | timestamptz | NOT NULL DEFAULT now() |

- UNIQUE (owner_user_id, illustration_key)
- CONSTRAINT card_mnemonics_status_check CHECK (status IN ('draft','approved'))

## RLS（既存 illustrations owner ポリシーに倣う）

- ENABLE ROW LEVEL SECURITY
- `card_mnemonics_select_owner`  FOR SELECT USING (auth.uid() = owner_user_id)
- `card_mnemonics_insert_owner`  FOR INSERT WITH CHECK (auth.uid() = owner_user_id)
- `card_mnemonics_update_owner`  FOR UPDATE USING (auth.uid() = owner_user_id) WITH CHECK (auth.uid() = owner_user_id)

## Grants（既存 runtime grant migration に倣う）

- `GRANT SELECT, INSERT, UPDATE ON TABLE public.card_mnemonics TO authenticated;`
  （`20260718000002_fix_runtime_authenticated_grants.sql` と同じ流儀。RLS が行認可の境界。）

## トリガー

- `set_card_mnemonics_updated_at` BEFORE UPDATE FOR EACH ROW EXECUTE FUNCTION `public.update_updated_at_column()`
  （S-02 で定義済みの共通関数を再利用。関数は再定義しない。）

## Database 型（frontend/src/types/database.ts）

- `Tables` はアルファベット順。`card_mnemonics` は `card_tags` の直前に挿入する。
- `Row` / `Insert` / `Update` / `Relationships: []` を既存 `illustrations` と同じ流儀で定義。
- `slots` / `explanation` は `Json` 型。

## Seed（supabase/seed.sql）

- seed owner（`00000000-0000-4000-8000-000000000001`）所有の「見」1件を、`COMMIT;` の前に冪等 INSERT する。
- slots / explanation は Epic #40 正本形。status は `'approved'`。
- `ON CONFLICT (owner_user_id, illustration_key) DO UPDATE` で再実行に耐える。

## Rollback

- `DROP TABLE public.card_mnemonics;`（既存テーブルには触れない）。

## 不変条件

- Browser/Server Supabase client を混在させない（本 Issue は SQL/型/seed のみで client には触れない）。
- server-only secret をブラウザ用モジュールへ露出しない。
- 既存の未関連ファイルを変更しない。
