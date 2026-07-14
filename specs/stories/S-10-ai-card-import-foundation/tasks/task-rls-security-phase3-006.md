# タスク: RLS・wrapper権限・DEFINER security境界を実装する

メタ情報:
- ストーリー: S-10-ai-card-import-foundation / Issue #10
- フェーズ: 3
- 依存: `tasks/task-import-schema-phase2-005.md`（Phase 2 quality approved）
- 提供成果物: table RLS/direct-write matrix、function/schema ACL、IT-RLS 7件、IT-SECURITY 2件
- 関連AC: AC-03, AC-09、IT-RLS-01〜07、IT-SECURITY-01〜02
- サイズ: 大きめ（security vertical slice）

## 実装内容

owner A/B/anon/authenticated/service roleごとのRLSとdirect-write matrixを実装する。wrapper/internal/trigger functionの固定owner、`search_path=pg_catalog,pg_temp`、完全修飾、EXECUTE revoke/grant、public schema CREATE ACLをcatalogで検証可能にする。未実装RPC名には公開EXECUTEを先行付与しない。

## 対象ファイル

- [x] `supabase/migrations/20260714000000_s10_ai_card_import_foundation.sql`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.int.test.ts`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit.ts`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [x] `IT-RLS-01〜07`と`IT-SECURITY-01〜02`をactor/catalog実テストへ置換する。
- [x] private/public card、batch/item/upload/tag/card_tags/usage、wrapper/internal/trigger/schema CREATEをoperation別に検証する。

```bash
S10_TEST_DATABASE_URL="$S10_TEST_DATABASE_URL" npm --prefix frontend run test:s10:integration -- -t "IT-RLS|IT-SECURITY-0[12]"
```

### 2. Green Phase

- [x] private cardsはowner SELECTと既存許可DML、public cardsは既存SELECT互換のみとし通常利用者writeを拒否する。
- [x] batch/item/item_tagsはowner SELECTのみ、uploads/usage/reservations/card_tagsはDesign matrixどおりに制限する。
- [x] relation direct write grant/policyを撤回し、tagsだけowner CRUDを許可する。
- [x] 全function作成直後にPUBLIC等のEXECUTEをrevokeし、用途別wrapperだけauthenticated/service_roleへgrantする規約を置く。
- [x] DEFINER functionはnon-login migration owner、固定search_path、`public`完全修飾とする。
- [x] schema CREATEをPUBLIC/anon/authenticatedからrevokeしmigration ownerだけに残す。

### 3. Refactor Phase

- [x] owner policy式を`(SELECT auth.uid()) = owner_user_id`へ統一し、存在秘匿が必要な越境をnot-found相当にする。
- [x] actor matrixをtable-drivenにし、非owner/anon成功件数0を集約assertする。

## 完了条件

- [x] 対象9件が実DBでPASSする。
- [x] public SELECT互換を維持し、通常利用者のpublic write成功0件である。
- [x] PUBLIC/anon/authenticated/service_roleからinternal/trigger function直接EXECUTE成功0件である。
- [x] owner/source偽装で保存済み境界を越えられない。
- [x] catalog上のowner/search_path/grant/schema ACLがDesignと一致する。
- [x] 動作確認レベルL2を満たす。

## 注意事項

- roleだけを業務認可とせず、後続service wrapperも保存済みowner/source/stateを再照合する。
- UI/MCP transport/OAuthを実装しない。
