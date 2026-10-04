# Plan / verification: S-30

- [x] Issue #97、対象コード、ADR-012/013、DB/RLS/lock/reference-count契約を確認。
- [x] lossless outcome、safe code、required conceptのblocked状態、語単位retryを接続。
- [x] 複数字語のslotsを画像promptへ反映しfrontend/Edge一致を確認。
- [x] 専用repair job、新object、snapshot／lease、shared-card atomic swap、active-session延期を実装。
- [x] 非破壊migration、Database型、RLS/grants、provenance、blocked undoを追加。
- [x] unit/contract/隔離DBの回帰検証、lint/typecheck/buildを実行。
- [x] primary agentでcode review。failure projection、claim前revision確認、retry上限、quota失敗cleanup、ownerのlease-column権限を修正。
- [ ] Hosted Supabase/PostgREST、実pgmq/worker配信、実provider、複数接続lock競合、OAuth経由MCP操作のstaging確認。
- [ ] 実ブラウザで未完了理由・狭い画面・再取得表示の確認（SSR rendering regressionのみ実施）。
- [ ] remote migration・deploy（今回の実装範囲外）。

実装・reviewはprimary agentで実施。`ar-core:quality-fixer`はこのセッションのavailable skillにはなく、専用approval結果は取得していない。完了・deploy済みとは扱わずdraft reviewへ進める。

## 再現コマンド

```bash
npm --prefix frontend ci
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run test
NEXT_PUBLIC_SUPABASE_URL=https://fixture.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture SUPABASE_SERVICE_ROLE_KEY=fixture npm --prefix frontend run build
npm install --prefix /tmp/s30-db --no-save @electric-sql/pglite@0.5.8
node specs/stories/S-30-mnemonic-completion-and-repair/tests/database-gate.mjs fresh
node specs/stories/S-30-mnemonic-completion-and-repair/tests/database-gate.mjs upgrade
```

PGliteの別保存先は `S30_PGLITE_ROOT`。prod/frontend dependencyは追加していない。gateはPG内でJWT role、owner、pgcrypto、SECURITY DEFINERを実行し、Auth/Storage/pgmqはfixture。cron/net schedule migrationのみ除外する。fresh/upgradeを既存DBに接続しない。upgradeは旧schemaで汎用画像付き成功カードを作り、その完全不変を検証する。

Edge型検査はDeno 2.5.0を一時利用。依存registryへDenoが接続できなかったため、既存frontend node_modulesへの一時リンクと `--node-modules-dir=manual` でチェックする（リンクは後で削除）。既存magick-codecのArrayBufferLike型不一致も検出したため、compile入力を所有するArrayBufferに変更し、既存resource contract testを更新した。

## 検証結果（2026-10-04）

- lint / TypeScript / Next production build: passed。buildの環境値はdummy fixtureのみ。
- Vitest full suite: 1,322 passed / 9 failed / 30 skipped、114 passed files / 5 failed files / 2 skipped files。実DB用5ファイルはpsql不在・S10_TEST_DATABASE_URL不足で失敗。新規skipや除外設定で隠していない。
- 新規outcome/recovery/repair-worker、prompt parity、MCP tool/route、未完了表示の回帰test: passed。
- Deno 2.5.0 check: worker / cleanup / resource-gateの3entrypoint passed。
- fresh 17 / upgrade 19 PG gate: migration適用、missing/proof gate、固定コード、commit replay、owner/anon ACL、retry lease、shared refs、exact card/deck/tag/review snapshot、active-study延期、途中編集競合、blocked undo、retry exhaustionを検証。

旧imageのcleanupは既存参照カウント経路を使う。新画像参照へ一括移動した後、0参照の旧objectだけdelete_pendingになる。暫定復旧に使った31概念・60枚へ操作しない。
