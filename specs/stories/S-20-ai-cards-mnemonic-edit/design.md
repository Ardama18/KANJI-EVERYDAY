# S-20 design: /ai/cards のニーモニック表示・編集と不要 UI の削除

前提と受入条件は `requirements.md`、書き込み境界の決定は `specs/adr/ADR-013-post-commit-mnemonic-edit-write-boundary.md` を正本とする。
本ファイルは実装の形（SQL・型・関数シグネチャ・UI 構成・テスト）を確定する。

## 1. 全体像

```
list_ai_managed_cards (CREATE OR REPLACE)
  └ illustrationKey / mnemonic / mnemonicSharedCardCount を返却 JSON へ追加
        │
        ├── UI 経路:  getAiCardListAction → listAiCards → parseManagedAiCards → attachIllustrationUrls
        │              → AiCardManagementClient（表示・編集フォーム）
        │
        └── MCP 経路: listAiCards → toMcpAiCard（許可リスト射影で 3 フィールドを落とす）

updateAiCardMnemonicAction（新規・UI 専用）
  → updateAiCardMnemonic(service)
      1. 入力 parse ＋ サーバ側サニタイズ（NFKC・length-cap・mappings 2–4）
      2. 所有権検証: cards(id, owner_user_id, illustration_key) の一致を 1 クエリ
      3. card_mnemonics へ upsert（onConflict: owner_user_id,illustration_key、status='approved'）
  → RLS が最終防衛線
```

読み取りは 1 経路（既存 RPC の射影追加）、書き込みは新経路（RLS 直書き）で、
書き込みは Remote MCP から構造的に到達できない（別 interface・別 factory）。

## 2. DB: `supabase/migrations/20260726000000_s20_ai_card_mnemonic_edit.sql`

prefix `20260726000000` は既存最大 `20260725000000` より後で、重複しない。

### 2.1 差し替え方法

`DROP` せず `CREATE OR REPLACE FUNCTION` で置き換える。制約は次のとおり。

- 引数名・引数型・既定値・戻り型を 1 文字も変えない。`CREATE OR REPLACE` は入力引数名の変更と戻り型の変更を拒否する。
- `LANGUAGE plpgsql` / `SECURITY DEFINER` / `SET search_path = pg_catalog, pg_temp` を維持する。
- owner と ACL は replace で保持されるが、決定的にするため `ALTER FUNCTION ... OWNER TO s10_migration_owner` と
  `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` ＋ `GRANT EXECUTE ... TO authenticated` を
  同一 migration 末尾で再発行する（S-14 が `commit_import_async` で採った先例と同じ形）。
  これにより、万一関数が存在しない環境で `CREATE OR REPLACE` が新規作成になった場合でも
  PUBLIC への EXECUTE が残らない。
- 全体を `BEGIN; ... COMMIT;` で囲む（S-13 と同じ規律）。

### 2.2 本文の変更点（3 箇所のみ）

S-13 の定義（`20260719000001_s13_ai_card_management_undo.sql:77-170`）を丸ごと写し、次の 3 点だけを足す。

**(a) `selected` CTE に `c.illustration_key` を射影する**

```sql
SELECT c.id, c.front_text, c.back_text, c.skill, c.pattern,
  c.created_at, c.updated_at, b.source, b.id AS batch_id,
  i.id AS item_id, c.illustration_key,
  ill.id AS illustration_id, ill.status AS illustration_status
```

既存の illustration 用 `LEFT JOIN LATERAL`（`ORDER BY candidate.id LIMIT 1`）は一切触らない。
並び順不一致の是正は Out of Scope。

**(b) `enriched` CTE に LATERAL を 2 つ足す**

```sql
), enriched AS (
  SELECT s.*, mn.mnemonic, sc.shared_count,
    COALESCE((SELECT jsonb_agg(...) ...), '[]'::jsonb) AS decks,
    COALESCE((SELECT jsonb_agg(...) ...), '[]'::jsonb) AS tags
  FROM selected s
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      'slots', m.slots, 'explanation', m.explanation, 'status', m.status
    ) AS mnemonic
    FROM public.card_mnemonics m
    WHERE m.owner_user_id = actor_id
      AND m.illustration_key = s.illustration_key
    LIMIT 1
  ) mn ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS shared_count
    FROM public.cards sibling
    WHERE sibling.owner_user_id = actor_id
      AND s.illustration_key IS NOT NULL
      AND sibling.illustration_key = s.illustration_key
  ) sc ON true
  ORDER BY s.created_at DESC, s.id DESC
  LIMIT p_limit
)
```

- `mn` は 0 行または 1 行。`(owner_user_id, illustration_key)` UNIQUE により 1 行以下が保証されるが、
  防御的に `LIMIT 1` を付ける。0 行なら `mn.mnemonic` は SQL NULL になり、
  `jsonb_build_object('mnemonic', NULL)` は `{"mnemonic": null}` を生む。
- `sc` は GROUP BY 無しの集約なので常に 1 行返る。`s.illustration_key IS NULL` のときは条件が偽で 0 件カウント、
  すなわち `shared_count = 0`。NULL にはならないが最終出力では `COALESCE(...,0)` を掛ける。
- `card_mnemonics` の読み取りは SECURITY DEFINER（owner=`s10_migration_owner`、table owner も同一）なので
  RLS をバイパスする。したがって `m.owner_user_id = actor_id` の明示述語が唯一の owner 境界であり、必須。
- LATERAL は `selected`（最大 `p_limit + 1` 行）ではなく `enriched`（最大 `p_limit` 行）側に付くため、
  評価対象は 1 ページ分に収まる。共有枚数カウントは `idx_cards_illustration_key` を使える。

**(c) 返却 JSON に 3 キーを追加する**

```sql
'itemId', e.item_id, 'decks', e.decks, 'tags', e.tags,
'illustration', CASE WHEN e.illustration_id IS NULL THEN NULL ELSE
  jsonb_build_object('id', e.illustration_id, 'status', e.illustration_status) END,
'illustrationKey', e.illustration_key,
'mnemonic', e.mnemonic,
'mnemonicSharedCardCount', COALESCE(e.shared_count, 0)
```

`hasMore` の算出（`SELECT count(*) > p_limit FROM selected`）は変更しない。

### 2.3 書き込み側の DB 変更

無し。新 RPC も新 GRANT も作らない（ADR-013 決定事項 1）。

## 3. サーバ層

### 3.1 `frontend/src/lib/ai-card-management/types.ts`

```ts
export interface ManagedCardMnemonic {
	readonly slots: MnemonicSlotsDraft;
	readonly explanation: MnemonicExplanationDraft;
	readonly status: "draft" | "approved";
}

export interface ManagedAiCard {
	// ...既存 13 フィールドは順序も含めて不変...
	readonly illustration: AiCardIllustration | null;
	readonly illustrationKey: string | null;
	readonly mnemonic: ManagedCardMnemonic | null;
	readonly mnemonicSharedCardCount: number;
}

export interface AiCardManagementOptions {
	readonly decks: readonly AiCardRelationOption[];
	readonly tags: readonly AiCardRelationOption[];
	// illustrations を削除（AC-16）
}
```

`MnemonicSlotsDraft` / `MnemonicExplanationDraft` は `@/lib/ai-card-generation/contracts` から型輸入する
（値の輸入ではないので Client/Server 境界に影響しない）。

### 3.2 `frontend/src/lib/ai-card-management/validation.ts`

`parseManagedAiCards` に 3 フィールドの解釈を追加する。方針は**無ければ既定値・有れば厳格検証**
（migration 未適用の配備で一覧全体が落ちるのを防ぐ。ADR-013 実装への指針）。

```ts
// illustrationKey: undefined → null、string → そのまま、それ以外 → throw
// mnemonicSharedCardCount: number（整数かつ 0 以上）→ そのまま、undefined → 0、それ以外 → throw
// mnemonic: undefined/null → null、object → slots/explanation/status を厳格検証して throw or 値
```

`mnemonic` の厳格検証は既存 `illustration` の検査と同じ手触りで書く。

- `slots`: `kanji` string / `isSingleKanji` boolean / `shapeHint.part` string / `shapeHint.picture` string /
  `meaningHint` string / `story` string
- `explanation`: `summary` string / `mappings` は `{part: string, meaning: string}` の配列
- `status`: `"draft"` か `"approved"`
- 不一致は `throw new Error("Invalid mnemonic contract")`

ここでは長さ検証をしない。DB から来た値の形だけを見る（表示は既存値をそのまま出す責務）。

### 3.3 サニタイザの共有: `frontend/src/lib/ai-card-generation/mnemonic-sanitize.ts`（新規）

`frontend/src/lib/ai-import/service.ts:267-388` の次を新モジュールへ**そのまま移設**し、export する。

- `MNEMONIC_TEXT_LIMITS`
- `sanitizeMnemonicSlots(value: unknown): MnemonicSlotsDraft | undefined`
- `sanitizeMnemonicExplanation(value: unknown): MnemonicExplanationDraft | undefined`
- 私有ヘルパ `normalizeCapped` と `isRecord`（`isRecord` はこのモジュール内に持つ。
  `ai-import/service.ts` 側の `isRecord` は他用途でも使われているため残す）

`ai-import/service.ts` は新モジュールから import し、`sanitizeMnemonics`（`conceptId` 検証付き）はそのまま同ファイルに残す。
挙動変更ゼロの移設なので既存テストは無変更で緑のままである必要がある。

**この抽出が必要な理由**: issue は「`MnemonicApprovalList.tsx` の `MNEMONIC_LIMITS` をエクスポートして共有」と書いているが、
同ファイルは `"use client"` である（前提 #16）。`"use client"` モジュールの関数を Server Action から呼ぶと
実行時に client reference エラーになるため、**サーバ側検証には使えない**。
ADR-012 決定事項 5 と ADR-013 決定事項 4 はサーバ側での再サニタイズを要求しているので、
サーバ用の共有先を別に用意する。`MnemonicApprovalList.tsx` からの `MNEMONIC_LIMITS` export は
クライアント側フォームのために別途行う（§4.1）。

### 3.4 `frontend/src/lib/ai-card-management/app-ai-repository.ts`

共有 interface `AiCardManagementRepository` には**追加しない**（ADR-013 決定事項 5）。
別 interface と別 factory を同ファイルに置く。

```ts
export interface AiCardMnemonicRepository {
	/** 呼び出し元所有かつ illustration_key が一致するカードを 1 件返す（無ければ null）。 */
	findOwnedCardByIllustrationKey(
		input: Readonly<{ cardId: string; illustrationKey: string }>
	): Promise<AiCardManagementRepositoryResult<{ id: string } | null>>;
	upsertMnemonic(
		input: Readonly<{
			illustrationKey: string;
			slots: MnemonicSlotsDraft;
			explanation: MnemonicExplanationDraft;
		}>
	): Promise<AiCardManagementRepositoryResult<Json>>;
}

export function createAppAiCardMnemonicRepository(
	client: ServerSupabaseClient,
	ownerUserId: string
): AiCardMnemonicRepository
```

- `ownerUserId` は factory 引数として束縛する（既存 repository が「コマンドは owner を運ばない」方針なのと同じ）。
  呼び出し元（Server Action）はセッション由来の値しか渡さない。
- `findOwnedCardByIllustrationKey`:
  `client.from("cards").select("id").eq("id", cardId).eq("owner_user_id", ownerUserId).eq("illustration_key", illustrationKey).maybeSingle()`
- `upsertMnemonic`:
  `client.from("card_mnemonics").upsert({ owner_user_id: ownerUserId, illustration_key, slots, explanation, status: "approved" }, { onConflict: "owner_user_id,illustration_key" })`
  `slots` / `explanation` は `Json` としてキャストして渡す（`database.ts` の Insert 型は `Json`）。
  `updated_at` はトリガ（`set_card_mnemonics_updated_at`）が更新するので明示しない。

`remote-mcp-repository.ts` は無変更。共有 interface が変わらないので実装義務も生じない。

### 3.5 `frontend/src/lib/ai-card-management/service.ts`

```ts
export async function updateAiCardMnemonic(
	repository: AiCardMnemonicRepository,
	input: unknown
): Promise<AiCardActionResult<Json>>
```

処理順（AC-5 と AC-6 の両立に関わるので固定する）。

1. `parseMnemonicUpdateInput(input)`
   - `cardId`: `requireCardId`（既存 UUID 検査を再利用）
   - `illustrationKey`: string、trim 後 1〜512 文字。範囲外は `AiCardValidationError`
   - `slots` = `sanitizeMnemonicSlots(value.slots)`、`explanation` = `sanitizeMnemonicExplanation(value.explanation)`。
     どちらか `undefined` なら `AiCardValidationError`（→ `VALIDATION_ERROR` / 400）
2. `findOwnedCardByIllustrationKey` を 1 回呼ぶ。`error !== null` → `errorResult`。
   `data === null` → `{ ok: false, error: { code: "NOT_FOUND", status: 404, message: "対象が見つかりません。" } }`
   を返し、**upsert は呼ばない**。
3. `upsertMnemonic` を呼び、結果をそのまま返す。

入力不正と所有権不一致が同時に成立する場合は 1 が先に効き `VALIDATION_ERROR` になる。
AC-6 のテストは正しい形の payload で `cardId` / `illustrationKey` だけを差し替えて検証する。

`NOT_FOUND` は既存 `AiCardManagementErrorCode` に存在するため型追加は不要。
メッセージは既存 `mapAiCardManagementError` の 404 系文言（`errors.ts`）と合わせる。

### 3.6 `frontend/src/actions/ai-card-management-actions.ts`

- **追加**: `updateAiCardMnemonicAction(input: unknown): Promise<AiCardActionResult<Json>>`
  `mutationResult` は repository factory に `userId` を渡せないため、同じ骨格の小さな別関数を書く。
  ```
  createAuthenticatedBoundary<Json>() → createAppAiCardMnemonicRepository(supabase, userId)
    → updateAiCardMnemonic(repository, input) → ok なら revalidatePath("/ai/cards")
  ```
  フラグ評価・認証・`revalidatePath` の順序と対象は既存 mutation と同一にする。
- **削除**: `setAiCardIllustrationAction`、および `setAiCardIllustration` の import（AC-12）。
- **削除**: `getAiCardManagementOptionsAction` 内の `illustrations` 取得クエリ（`:130-139`）と
  戻り値の `illustrations`（AC-16）。デッキ・タグの取得と失敗時の `mapAiCardManagementError` は不変。

`loadReadyIllustrationPaths` と `attachIllustrationUrls` は無変更（AC-13。前提 #21 により新フィールドは通過する）。

### 3.7 `frontend/src/lib/mcp/services.ts`

`listAiCards` の戻り値を**許可リスト射影**で作り直す（AC-8）。

```ts
const toMcpAiCard = (card: ManagedAiCard) => ({
	id: card.id,
	frontText: card.frontText,
	backText: card.backText,
	skill: card.skill,
	pattern: card.pattern,
	createdAt: card.createdAt,
	updatedAt: card.updatedAt,
	source: card.source,
	batchId: card.batchId,
	itemId: card.itemId,
	decks: card.decks,
	tags: card.tags,
	illustration: card.illustration,
});

listAiCards: async (input) => {
	const result = await listAiCards(cards, input);
	return result.ok
		? { ok: true as const, data: { items: result.data.items.map(toMcpAiCard), nextCursor: result.data.nextCursor } }
		: result;
};
```

- キーの列挙順は現行 `ManagedAiCard` の宣言順と同一なので、`JSON.stringify` のキー順序も現行と一致する。
- `illustration` は `{ id, status, url: null }` のまま渡す（現行応答に `url: null` が含まれているため、
  ここを変えると AC-8 に反する）。
- 除去リスト（`delete` や rest 分割）ではなく許可リストにするのは、将来 `ManagedAiCard` に項目が増えたときに
  MCP へ自動流出しないため。

### 3.8 変更しないもの（AC-15）

`set_card_illustration` / `undo_import` RPC、`service.ts` の `setIllustration` / `undoAiImportBatch`、
`app-ai-repository.ts` の該当実装、`remote-mcp-repository.ts` 全体、`undoAiImportBatchAction`、
`frontend/src/lib/mcp/tools.ts`（ツール契約）はいずれも触らない。

## 4. UI

### 4.1 `frontend/src/components/ai-card-import/MnemonicApprovalList.tsx`

- `const MNEMONIC_LIMITS` → `export const MNEMONIC_LIMITS`
- `isMnemonicEntryValid` の引数型を `MnemonicApprovalEntry` から
  `Pick<MnemonicApprovalEntry, "slots" | "explanation">` へ広げる（`approved` を要求しなくなるだけの
  後方互換な緩和。既存呼び出しはそのまま通る）。
- コンポーネント本体は作り替えない（Out of Scope）。

### 4.2 `frontend/src/components/ai-card-management/AiCardManagementClient.tsx`

**削除**

- `setAiCardIllustrationAction` / `undoAiImportBatchAction` の import（`:8`, `:10`）
- イラスト選択フォーム（`:493-534`）
- 「登録バッチを取り消す」ボタン（`:553-570`）。残る「このカードを削除」は
  2 カラム grid から 1 要素になるので、囲みの `sm:grid-cols-2` を単一ボタン向けに整える。
- options 取得失敗時の文言（`:261`）から「イラスト」を落とし
  「デッキ・タグの選択肢を取得できませんでした。」にする（`illustrations` を返さなくなるため）。

**追加**

- `managedCardSyncKey` に mnemonic の指紋を足す。
  ```ts
  mnemonic: card.mnemonic === null ? null : JSON.stringify(card.mnemonic),
  mnemonicSharedCardCount: card.mnemonicSharedCardCount,
  ```
  理由: mnemonic 保存は `cards.updated_at` を動かさないため（前提 #20）、指紋を足さないと保存後に
  行が再マウントされず、サーバが NFKC 正規化した値がフォームへ反映されない。
  既存の再マウント規律（`updatedAt` / 本文 / デッキ / タグ / illustrationId の変化で remount）と同じ扱いにする。
- `<MnemonicEditor>` を同ファイル内のローカルコンポーネントとして追加し、
  `編集と取り消し` details 内のタグ保存フォームの後、削除ボタン群の前に置く。

**`MnemonicEditor` の仕様**

```tsx
function MnemonicEditor({
	card, disabled, onSave,
}: {
	readonly card: ManagedAiCard;
	readonly disabled: boolean;
	readonly onSave: (input: { slots: MnemonicSlotsDraft; explanation: MnemonicExplanationDraft }) => void;
})
```

- `card.mnemonic === null || card.illustrationKey === null` のとき
  `覚え方（ニーモニック）: 未設定` を描画して `return`（AC-2）。フォームは出さない。
- それ以外は `useState` で `{ slots, explanation }` を `card.mnemonic` から初期化する。
  mappings の追加・削除で件数が変わるため controlled state が必要。
  行の remount は `managedCardSyncKey` が担保するので、props 変化に追随する `useEffect` は書かない。
- 入力項目は承認 UI と同じ 7 つ ＋ mappings 全件（AC-1）。
  ラベル文言も承認 UI と同一にする（漢字 / 単一の漢字として扱う（オフで熟語）/ 形のヒント（部品）/
  形のヒント（イメージ）/ 意味のヒント / 覚え方のストーリー / 説明のまとめ / 部品と意味の対応（2〜4件））。
  input の `name` 属性は不要（controlled state から payload を組むため）。
- mappings の「対応を追加」「対応を削除」は `MNEMONIC_LIMITS.mappingsMin` / `mappingsMax` で活性を決める。
- 保存ボタン `覚え方を保存` の `disabled` は `disabled || !isMnemonicEntryValid({ slots, explanation })`（AC-5 の client 側）。
  不正時は承認 UI と同じ補助文（`すべての項目を入力し、対応を2〜4件にすると承認できます。` に相当する文言）を出す。
- `card.mnemonicSharedCardCount >= 2` のとき
  `このイラストの覚え方は {n} 枚のカードで共有されています。` を表示する（AC-7）。1 以下では出さない。
  ブロックする確認は出さない。
- `disabled` には `mutationsDisabled` を渡す（`relationsDisabled` ではない。
  ニーモニック編集は options に依存しないため、選択肢取得が失敗していても編集できる）。

**保存の配線（AC-10）**

```tsx
onSave={(entry) =>
	applyMutation(
		() => updateAiCardMnemonicAction({
			cardId: card.id,
			illustrationKey: card.illustrationKey,
			slots: entry.slots,
			explanation: entry.explanation,
		}),
		"覚え方を保存しました。学習状態は維持されます。"
	)
}
```

`applyMutation` 以外の pending / notice を一切作らない。これにより
`処理中です…`・成功/失敗 `notice`・保存後の一覧再取得・`requiresFreshData` による安全停止が
既存の「本文を保存」「タグを保存」と同一挙動になる。

payload 組み立ては純関数として切り出し、テスト可能にする。

```ts
export const mnemonicMutationInput = (
	card: Pick<ManagedAiCard, "id" | "illustrationKey">,
	entry: { slots: MnemonicSlotsDraft; explanation: MnemonicExplanationDraft }
) => ({ cardId: card.id, illustrationKey: card.illustrationKey, slots: entry.slots, explanation: entry.explanation });
```

## 5. テスト

`requirements.md` R-2 の制約（DOM テスト環境なし）を前提に配置する。

| 層 | ファイル | 内容 | 件数 | AC |
|---|---|---|---|---|
| Unit | `frontend/src/components/ai-card-import/MnemonicApprovalList.test.tsx`（新規） | `isMnemonicEntryValid` の上限 5 種（kanji 17 / text 101 / summary 121 / mappings 1 / mappings 5） | 5 | AC-5 |
| Unit | `frontend/src/components/ai-card-management/AiCardManagementClient.test.tsx` | 7 項目 ＋ mappings 全件の描画、未設定時の非表示、共有枚数の表示/非表示 | 5 | AC-1,2,7 |
| Unit | 同上 | `notice` / `処理中です…` 要素が 1 つだけ、`initialError` 指定で保存ボタン `disabled`、`mnemonicMutationInput` の payload | 3 | AC-10 |
| Unit | 同上 | イラスト `select`・「イラストを保存」・「登録バッチを取り消す」が描画されない、サムネイルは残る | 3 | AC-12,13,14 |
| Unit | `frontend/src/lib/mcp/services.test.ts` | `listAiCards` 応答の deep-equal スナップショット（新フィールドを含む service 結果を与えても現行形のまま） | 2 | AC-8 |
| Unit | `frontend/src/lib/ai-card-management/service.test.ts` | サーバ側サニタイズ拒否時に repository 未呼出、所有権不一致で `NOT_FOUND` かつ upsert 未呼出 | 4 | AC-5,6 |
| Unit | `frontend/src/actions/ai-card-management-actions.test.ts` | options の戻り値に `illustrations` が無い、`setAiCardIllustrationAction` が存在しない | 2 | AC-12,16 |
| Unit | `frontend/src/lib/ai-card-management/remote-mcp-repository.test.ts` | `setIllustration` / `undoImport` が UI 削除後も呼べる | 2 | AC-15 |
| Contract | `frontend/src/lib/ai-card-management/s20-migration-contract.test.ts`（新規） | 新 migration の定義（同一シグネチャ・`DROP FUNCTION` 不在・LATERAL 2 つ・3 キー射影）と owner / REVOKE / GRANT | 3 | AC-9 |
| Integration | `frontend/src/lib/ai-card-management/real-db.int.test.ts` | 所有権不一致の保存拒否と RLS、upsert 後の再読込で `status='approved'`、`mnemonicSharedCardCount` がページ跨ぎで正しい | 3 | AC-3,6,7 |

補足。

- 既存テストの棚卸し: `AiCardManagementClient.test.tsx:141,197` の
  `expect(html).toContain("登録バッチを取り消す")` と `"イラストを保存"` の assert は
  **不在 assert へ反転**する。`initialOptions.data` の `illustrations: []` は型から消えるため全て除去する。
  `ai-card-management-actions.test.ts` の options テストとモックから illustration 取得分を外す
  （一覧の署名 URL 用 `from("illustrations")` モックは AC-13 のため残す）。
  Remote MCP 側のテストは残す。
- AC-4 は統合テストで `card_mnemonics.explanation` の更新を確認する。表示側は無変更のため、
  `session-actions.ts` / `MnemonicExplanation.tsx` に新規テストを追加しない。
- AC-11 は既存の S-16D テスト（`specs/stories/S-16D-approval-ui/tests/`）が緑であることで確認する。
- 統合テストは `S10_TEST_DATABASE_URL` が必要。未設定時の失敗は既知の env 起因（前提 #19）。

## 6. issue 記載からの逸脱と理由

| # | issue の記載 | 本設計 | 理由 |
|---|---|---|---|
| 1 | `MnemonicApprovalList.tsx` の `MNEMONIC_LIMITS` を共有して検証を再利用 | client 側は同ファイルから、**サーバ側は `ai-import/service.ts` のサニタイザを共有モジュールへ抽出**して再利用 | 同ファイルは `"use client"` でサーバから関数を呼べない。ADR-012 決定事項 5 はサーバ再検証を要求する（§3.3） |
| 2 | `app-ai-repository.ts` に `upsertMnemonic` を追加 | 同ファイルに**別 interface `AiCardMnemonicRepository` と別 factory** で追加 | 共有 `AiCardManagementRepository` へ足すと Remote MCP にも実装義務が生じ、書き込み非露出が型で表現できない（ADR-013 決定事項 5） |
| 3 | `services.ts` から `illustrationKey` と `mnemonic` を除去 | **許可リスト射影**で 3 フィールドを落とす | 除去リストは将来の項目追加で自動流出する。`mnemonicSharedCardCount` も落とす必要がある（AC-8） |
| 4 | 記載なし | `managedCardSyncKey` に mnemonic 指紋を追加 | mnemonic 保存は `cards.updated_at` を動かさないため、無いと保存後に行が再マウントされない（前提 #20） |
| 5 | 記載なし | 新 migration で owner / REVOKE / GRANT を再発行 | `CREATE OR REPLACE` が新規作成に落ちた場合に PUBLIC EXECUTE が残るのを防ぎ、AC-9 を決定的にする |
| 6 | AC-10 を「保存中/成功/失敗の表示」で 3 件テスト | 3 件を「単一 notice 要素・disabled 遷移・payload 純関数」へ再定義 | DOM テスト環境が無く、依存追加は停止・確認対象（requirements R-2） |

## 7. 実装順序の依存

1. migration（他の層が返却契約に依存する）
2. `mnemonic-sanitize.ts` 抽出 → `ai-import/service.ts` の import 差し替え（既存テストが緑であることを確認）
3. `types.ts` → `validation.ts` → `app-ai-repository.ts` → `service.ts` → `ai-card-management-actions.ts`
4. `mcp/services.ts`（3 の型追加後でなければ射影が書けない）
5. UI（`MnemonicApprovalList.tsx` → `AiCardManagementClient.tsx`）
6. テスト追加と既存テスト棚卸し

`types.ts` の `illustrations` 削除と `AiCardManagementClient.tsx` のフォーム削除は同一コミット内で行う
（片方だけでは typecheck が通らない）。
