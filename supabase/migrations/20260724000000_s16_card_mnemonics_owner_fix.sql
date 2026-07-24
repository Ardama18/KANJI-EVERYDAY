-- S-16 fix (issue #55): card_mnemonics の owner を s10_migration_owner に移す。
--
-- 根本原因: commit RPC commit_generated_import_async は SECURITY DEFINER で
-- owner=s10_migration_owner として INSERT INTO public.card_mnemonics する。
-- ところが S-16A (20260721000001_s16_card_mnemonics.sql) で作成した
-- card_mnemonics は owner が s10_migration_owner でなく、grant も authenticated
-- のみ・RLS も owner=auth.uid() 前提のため、DEFINER 実行では権限不足で
-- Postgres 42501 (insufficient_privilege) → 403 UNAUTHORIZED になっていた。
--
-- 他の s11 テーブル (ai_import_concept_jobs, ai_illustration_objects など) は
-- 20260715000000_s11_ai_card_async_processing.sql で
-- ALTER TABLE ... OWNER TO s10_migration_owner 済み。card_mnemonics だけ
-- 欠落していたので owner 変更のみを追加する。
--
-- 既存の GRANT (authenticated) / RLS policy / trigger / 制約は変更しない。
-- table owner は RLS をバイパスし全権限を持つため、DEFINER 実行の INSERT が通る。

ALTER TABLE public.card_mnemonics OWNER TO s10_migration_owner;
