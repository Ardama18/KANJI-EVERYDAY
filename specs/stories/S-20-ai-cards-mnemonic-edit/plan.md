# S-20 plan: /ai/cards のニーモニック表示・編集と不要 UI の削除

本ファイルを実装作業の単一情報源とする。設計の根拠は `design.md`、受入条件は `requirements.md`、
書き込み境界の決定は `specs/adr/ADR-013-post-commit-mnemonic-edit-write-boundary.md`。
`tasks/` や個別 task ファイルは生成・参照・更新しない。

規模: 大規模（migration ＋ 12 ファイル前後、RLS 境界に触れる）。
見積: migration 2h ＋ サーバ層 2h ＋ MCP 境界 1h ＋ UI 3h ＋ UI 削除とテスト棚卸し 2h ＋ テスト 3h = 約 13h。

## 前提の再確認（着手時に必ず行う）

- ブランチ `issue/64-ai-cards-mnemonic-edit` で作業する。
- `supabase/migrations/` の最大 prefix が `20260725000000` であることを確認し、
  新 migration は `20260726000000` にする。並行スプリントで先を越されていたら `20260726000001` 以降へ繰り上げる
  （同一 prefix は `supabase db push` に黙って読み飛ばされる）。
- `frontend/package.json` にテスト用 DOM 依存（jsdom / @testing-library）が無いことを再確認する。
  依存追加は行わない（`requirements.md` R-2）。

## Phase 1: migration（AC-9 の土台、他層の返却契約）

### 1-1. `supabase/migrations/20260726000000_s20_ai_card_mnemonic_edit.sql` を新規作成

- 先頭に目的コメント（issue #64 / S-20、`list_ai_managed_cards` の射影追加のみで書き込み口の新設は無いこと）を書く。
- `BEGIN;` … `COMMIT;` で囲む。
- `20260719000001_s13_ai_card_management_undo.sql:77-170` の `list_ai_managed_cards` 定義を写し、
  `design.md` §2.2 の (a)(b)(c) の 3 点だけを足す。
  - 引数名・型・既定値・戻り型・`LANGUAGE plpgsql` / `SECURITY DEFINER` /
    `SET search_path = pg_catalog, pg_temp` を 1 文字も変えない。
  - `DROP FUNCTION` は書かない。
  - 既存の illustration 用 LATERAL（`ORDER BY candidate.id`）と `hasMore` 算出は変更しない。
- 末尾に owner / ACL を再発行する。
  ```sql
  ALTER FUNCTION public.list_ai_managed_cards(integer,timestamptz,uuid,uuid,uuid,text,timestamptz,timestamptz)
    OWNER TO s10_migration_owner;
  REVOKE ALL ON FUNCTION public.list_ai_managed_cards(integer,timestamptz,uuid,uuid,uuid,text,timestamptz,timestamptz)
    FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.list_ai_managed_cards(integer,timestamptz,uuid,uuid,uuid,text,timestamptz,timestamptz)
    TO authenticated;
  ```

完了条件: SQL を静的に読み、旧定義との差分が (a)(b)(c) ＋ 末尾 3 文だけであること。
`grep` で `DROP FUNCTION` が無いこと。書き込み用 RPC を作っていないこと。

### 1-2. `frontend/src/lib/ai-card-management/s20-migration-contract.test.ts` を新規作成

`frontend/src/lib/card-mnemonics/migration-contract.test.ts` の書式（`readFileSync` ＋ `normalizeSql`）に倣う。

- 同一シグネチャで `CREATE OR REPLACE` していること、`DROP FUNCTION` を含まないこと。
- `selected` が `c.illustration_key` を射影し、`card_mnemonics` と `cards sibling` の LATERAL が 2 つあること、
  `m.owner_user_id = actor_id` と `sibling.owner_user_id = actor_id` の owner 述語があること。
- 返却 JSON に `'illustrationKey'` / `'mnemonic'` / `'mnemonicSharedCardCount'` の 3 キーがあること。
- `OWNER TO s10_migration_owner` と `GRANT EXECUTE ... TO authenticated` を含むこと（AC-9）。

完了条件: 3 件が緑。

## Phase 2: サニタイザの共有抽出（挙動変更ゼロ）

### 2-1. `frontend/src/lib/ai-card-generation/mnemonic-sanitize.ts` を新規作成

`frontend/src/lib/ai-import/service.ts:267-388` から `MNEMONIC_TEXT_LIMITS`、`sanitizeMnemonicSlots`、
`sanitizeMnemonicExplanation`、`normalizeCapped` を移設し、前 3 つを export する。
`isRecord` は新モジュール内に持つ（`ai-import/service.ts` 側のものは他用途で使われているため残す）。
`isUnicodeScalarText` / `normalizeDisplayText` は `@/lib/ai-import/normalize` から import する。

### 2-2. `frontend/src/lib/ai-import/service.ts` を差し替え

移設した 4 つの定義を削除し、新モジュールから import する。`sanitizeMnemonics` は同ファイルに残す。

完了条件: `npm --prefix frontend run typecheck` が通り、既存の ai-import 系テストが**無変更で緑**。
挙動を変える修正はこのフェーズで行わない。

## Phase 3: サーバ層

### 3-1. `frontend/src/lib/ai-card-management/types.ts`

- `ManagedCardMnemonic` を追加（`slots` / `explanation` / `status: "draft" | "approved"`）。
- `ManagedAiCard` の末尾へ `illustrationKey: string | null`、`mnemonic: ManagedCardMnemonic | null`、
  `mnemonicSharedCardCount: number` を追加（既存 13 フィールドの順序は変えない）。
- `AiCardManagementOptions.illustrations` を削除（AC-16）。

### 3-2. `frontend/src/lib/ai-card-management/validation.ts`

`parseManagedAiCards` に 3 フィールドの解釈を追加する。**無ければ既定値・有れば厳格検証**
（`design.md` §3.2）。`mnemonic` の形不一致は `throw new Error("Invalid mnemonic contract")`。
長さ検証はここでは行わない。

### 3-3. `frontend/src/lib/ai-card-management/app-ai-repository.ts`

`AiCardMnemonicRepository` interface と `createAppAiCardMnemonicRepository(client, ownerUserId)` を追加
（`design.md` §3.4）。共有 `AiCardManagementRepository` は変更しない。既存メソッドは触らない。

### 3-4. `frontend/src/lib/ai-card-management/service.ts`

`updateAiCardMnemonic(repository, input)` と `parseMnemonicUpdateInput` を追加する。
処理順は 1) parse ＋ サニタイズ → 2) 所有権検証（不一致は `NOT_FOUND` で即 return、upsert 未呼出）→ 3) upsert。
`setAiCardIllustration` と共有 interface の `setIllustration` は残す（AC-15）。

### 3-5. `frontend/src/actions/ai-card-management-actions.ts`

- `updateAiCardMnemonicAction` を追加（認証境界 → repository 生成 → service → `revalidatePath("/ai/cards")`）。
- `setAiCardIllustrationAction` と `setAiCardIllustration` import を削除（AC-12）。
- `getAiCardManagementOptionsAction` の illustration 取得クエリと戻り値の `illustrations` を削除（AC-16）。
- 一覧の署名 URL 経路（`loadReadyIllustrationPaths` / `attachIllustrationUrls`）は変更しない（AC-13）。

完了条件: typecheck が通る。この時点で UI は未修正なのでコンパイルエラーが残る（Phase 5 で解消）。
Phase 3 と Phase 5 は同一コミットに含める。

## Phase 4: MCP 境界（AC-8）

### 4-1. `frontend/src/lib/mcp/services.ts`

`toMcpAiCard` を追加し、`listAiCards` を許可リスト射影で返す（`design.md` §3.7）。
キー列挙順は `ManagedAiCard` の現行宣言順と一致させる。`illustration` は `{id,status,url}` のまま渡す。
`tools.ts` とツール契約は変更しない。

### 4-2. `frontend/src/lib/mcp/services.test.ts`

`listAiCards` の deep-equal スナップショット 2 件（AC-8）。

- mnemonic 有り・`illustrationKey` 有り・`mnemonicSharedCardCount` が 2 の service 結果を与えても、
  応答が 13 キー（`id`〜`illustration`）だけで `toEqual` 一致すること。
- `Object.keys` の順序が現行と一致し、`illustrationKey` / `mnemonic` / `mnemonicSharedCardCount` を
  含まないこと（`expect(Object.keys(item)).toEqual([...])`）。

## Phase 5: UI

### 5-1. `frontend/src/components/ai-card-import/MnemonicApprovalList.tsx`

- `MNEMONIC_LIMITS` を export する。
- `isMnemonicEntryValid` の引数型を `Pick<MnemonicApprovalEntry, "slots" | "explanation">` に広げる。
- コンポーネント本体は作り替えない（Out of Scope）。

### 5-2. `frontend/src/components/ai-card-management/AiCardManagementClient.tsx`

削除。

- `setAiCardIllustrationAction` / `undoAiImportBatchAction` の import。
- イラスト選択フォーム（現行 `:493-534`）。
- 「登録バッチを取り消す」ボタン（現行 `:553-570`）。残る削除ボタン 1 つに合わせて囲みの grid を整える。
- options 失敗時の文言から「イラスト」を落とす。

追加。

- `managedCardSyncKey` に mnemonic 指紋と `mnemonicSharedCardCount` を足す。
- `mnemonicMutationInput` を export する（テスト用の純関数）。
- `MnemonicEditor` をローカルコンポーネントとして追加し、タグ保存フォームの後・削除ボタン群の前に置く。
  仕様は `design.md` §4.2。要点は次の 5 つ。
  1. `card.mnemonic === null || card.illustrationKey === null` → `覚え方（ニーモニック）: 未設定` のみ描画。
  2. 7 項目 ＋ mappings 全件を承認 UI と同じラベルで描画。
  3. 保存ボタンは `disabled || !isMnemonicEntryValid({ slots, explanation })` で不活性。
  4. `mnemonicSharedCardCount >= 2` のとき共有枚数を表示（ブロックしない）。
  5. 保存は `applyMutation(() => updateAiCardMnemonicAction(...), "覚え方を保存しました。学習状態は維持されます。")`。
     独自の pending / notice を作らない。`disabled` には `mutationsDisabled` を渡す。

完了条件: typecheck と lint が通る。`/ai/cards` の既存操作（本文・デッキ・タグ・削除・フィルタ・追加読込）に変更が無い。

## Phase 6: テストと棚卸し

### 6-1. 新規テスト

| ファイル | 内容 | 件数 |
|---|---|---|
| `frontend/src/components/ai-card-import/MnemonicApprovalList.test.tsx` | `isMnemonicEntryValid` の上限 5 種（kanji 17 / text 101 / summary 121 / mappings 1 / mappings 5） | 5 |
| `frontend/src/components/ai-card-management/AiCardManagementClient.test.tsx` | 7 項目 ＋ mappings 全件の描画 / 未設定時の非表示 / 共有枚数 2 以上で表示・1 で非表示 | 5 |
| 同上 | `notice` と `処理中です…` の要素が 1 つだけ / `initialError` 指定で保存ボタン `disabled` / `mnemonicMutationInput` の payload | 3 |
| 同上 | イラスト `select` と「イラストを保存」が無い / 「登録バッチを取り消す」が無い / サムネイルは残る | 3 |
| `frontend/src/lib/ai-card-management/service.test.ts` | サニタイズ拒否で repository 未呼出（上限 2 種）/ 所有権不一致で `NOT_FOUND` かつ upsert 未呼出 / 正常時に `status='approved'` の upsert 引数 | 4 |
| `frontend/src/actions/ai-card-management-actions.test.ts` | options に `illustrations` が無い / `setAiCardIllustrationAction` が export されていない | 2 |
| `frontend/src/lib/ai-card-management/remote-mcp-repository.test.ts` | `setIllustration` と `undoImport` が UI 削除後も RPC を呼べる | 2 |
| `frontend/src/lib/mcp/services.test.ts` | Phase 4-2 | 2 |
| `frontend/src/lib/ai-card-management/s20-migration-contract.test.ts` | Phase 1-2 | 3 |
| `frontend/src/lib/ai-card-management/real-db.int.test.ts` | 所有権不一致の保存拒否と RLS / upsert 後の再読込で `status='approved'` と `explanation` 更新（AC-3, AC-4）/ `mnemonicSharedCardCount` がページ跨ぎで正しい | 3 |

統合テストは既存 `packedQuery` ヘルパ（packed JWT claims で `authenticated` として実行）を使う。
`S10_TEST_DATABASE_URL` 未設定の失敗は既知の env 起因（`requirements.md` 前提 #19）。

### 6-2. 既存テストの棚卸し

- `AiCardManagementClient.test.tsx`
  - `expect(html).toContain("イラストを保存")`（現行 `:140`）と
    `expect(html).toContain("登録バッチを取り消す")`（現行 `:141`, `:197`）を不在 assert へ反転する。
  - `initialOptions.data` から `illustrations: []` を全件除去する（型から消えるため）。
  - 既存の `managedCardSyncKey` テストに mnemonic 差分での key 変化を 1 件足す。
- `ai-card-management-actions.test.ts`
  - options テストのモックから illustration 取得分を外す。
  - 一覧の署名 URL 用 `from("illustrations")` モックは残す（AC-13）。
  - `buildListRpcData` は新フィールド無しのまま維持し、`parseManagedAiCards` の既定値経路
    （migration 未適用の skew 耐性）も同時に検証する。
- `management.test.ts` / `service.test.ts` の既存 fixture は新フィールド未指定でも通ることを確認する。
- Remote MCP 側のテストは削除しない。
- S-16D の承認フローテスト（`specs/stories/S-16D-approval-ui/tests/`）は無変更で緑であることを確認（AC-11）。

## Phase 7: 品質ゲート

1. `npm --prefix frontend run check`（lint / typecheck / vitest）。
   `S10_TEST_DATABASE_URL` 未設定なら int 3 件の env 起因失敗のみ許容し、それ以外は 0 件にする。
2. `npm --prefix frontend run build`（Server Action の追加と削除、`revalidatePath` を含むため実行する）。
3. UI 変更があるため実ブラウザで `/ai/cards` を desktop / mobile 幅で確認する
   （`npm --prefix frontend run dev`、既定 `http://localhost:3000`）。確認項目は次の 5 つ。
   - mnemonic 有りカードで 7 項目 ＋ mappings が出て、編集・保存後に値が保持される。
   - mnemonic 無しカードで「未設定」だけが出る。
   - イラスト選択 `select` と「イラストを保存」と「登録バッチを取り消す」が無い。
   - サムネイルが従来どおり表示される。
   - 保存中に `処理中です…` が出て操作が無効化され、成功 notice が出る。
4. `git diff` / `git status` で変更範囲を確認して commit する。

## 対象ファイル一覧

新規。

- `supabase/migrations/20260726000000_s20_ai_card_mnemonic_edit.sql`
- `frontend/src/lib/ai-card-generation/mnemonic-sanitize.ts`
- `frontend/src/lib/ai-card-management/s20-migration-contract.test.ts`
- `frontend/src/components/ai-card-import/MnemonicApprovalList.test.tsx`
- （設計フェーズで作成済み）`specs/adr/ADR-013-post-commit-mnemonic-edit-write-boundary.md`、
  `specs/stories/S-20-ai-cards-mnemonic-edit/{meta.json,story.md,requirements.md,design.md,plan.md}`

変更。

- `frontend/src/lib/ai-import/service.ts`（サニタイザの import 差し替え）
- `frontend/src/lib/ai-card-management/types.ts`
- `frontend/src/lib/ai-card-management/validation.ts`
- `frontend/src/lib/ai-card-management/app-ai-repository.ts`
- `frontend/src/lib/ai-card-management/service.ts`
- `frontend/src/actions/ai-card-management-actions.ts`
- `frontend/src/lib/mcp/services.ts`
- `frontend/src/components/ai-card-import/MnemonicApprovalList.tsx`
- `frontend/src/components/ai-card-management/AiCardManagementClient.tsx`
- テスト: `AiCardManagementClient.test.tsx`、`ai-card-management-actions.test.ts`、
  `frontend/src/lib/ai-card-management/service.test.ts`、`remote-mcp-repository.test.ts`、
  `frontend/src/lib/mcp/services.test.ts`、`frontend/src/lib/ai-card-management/real-db.int.test.ts`

触らない（AC-15 の維持対象）。

- `frontend/src/lib/ai-card-management/remote-mcp-repository.ts`（実装本体）
- `frontend/src/lib/mcp/tools.ts`
- `frontend/src/components/ai-card-management/AiCardIllustrationThumbnail.tsx`
- `frontend/src/lib/ai-card-management/illustration-urls.ts`
- `frontend/src/actions/session-actions.ts`、`frontend/src/components/study/MnemonicExplanation.tsx`
- 既存 migration すべて

## 完了条件

- AC-1〜AC-17 を満たす（AC-10 は `requirements.md` R-2 の代替検証で満たす）。
- 計画外の変更が無い、または理由を記録している。
- Phase 7 の 1〜3 が完了している。
- `card_mnemonics` への新しい特権書き込み口を作っていない。
- Remote MCP の応答形と ツール契約が変わっていない。
