// S-10 契約E2Eテストスケルトン - Design Doc: ai-card-import-foundation v1.1.1 (Approved)
// 生成日: 2026-07-14
// テスト種別: End-to-End Contract Test（DB primitive / migration chain）
// 実装タイミング: S-10のshared domain・migration・RPC完成後
//
// 分類根拠:
// Issue #10はUI、Route Handler、Remote MCP transport、Queue、worker、provider、Storage処理を対象外とする。
// そのためブラウザE2Eは作らず、信頼済みadapter相当の入力からDB最終状態までを通す契約E2Eとする。
// Queue/providerはstubさえ起動せず、commit/finalize/fail primitiveを直接境界として検証する。

import { describe, expect, it } from "vitest";

import {
	captureS10SeedGeneralSnapshot,
	captureS10SeedKeySnapshot,
	createS10DbClient,
} from "./helpers/s10-db-testkit";
import {
	readS10JobSnapshot,
	runS10AcSmoke,
	runS10MigrationFailureChecks,
	selectS10DatabaseJobs,
} from "./helpers/s10-db-jobs";

const database = createS10DbClient();

describe("S-10 AIカード登録基盤 契約E2E", () => {
	// AC原文 (AC-01/06): 異なるownerの同内容private cardをcommit/finalizeでき、owner関連と二段階境界が一致する。
	// 検証: Stage 1 -> preview署名/検証 -> quota予約 -> commit -> finalize -> DB readback。
	// 期待結果/合格基準: ownerごとにcard 1件、batch/item/tag関連は整合、各段階の副作用は設計どおり。
	// @category: e2e
	// @dependency: full S-10 shared contract + DB primitives
	// @complexity: high
	it.todo("E2E-CONTRACT-01: owner A/Bが同じR1/W1案をpreview・commit・finalizeし各private cardとowner関連を取得できる");

	// @category: e2e
	// @dependency: public seed, private partial unique, finalize_import_item
	// @complexity: high
	it.todo("E2E-CONTRACT-02: 公開Seed同値private案をcommit/finalizeして公開Seed不変のままowner cardを作成できる");

	// AC原文 (AC-04/05): token・reservation・commitの冪等境界が改ざん、再送、並行に耐える。
	// 検証: app_ai reservationとpreview payloadを束縛し、同key並行commit後にfinalizeを再送する。
	// 期待結果/合格基準: batch/cardは各1件、usageは1回分、全応答IDが一致。
	// @category: e2e
	// @dependency: HMAC, reserve_provider_usage, commit_import, finalize_import_item
	// @complexity: high
	it.todo("E2E-CONTRACT-03: app_aiの予約・preview・並行commit・finalize再送を通してbatch/card/usageを各1回分に保つ");

	// @category: e2e
	// @dependency: remote_mcp trusted context, exempt reservation
	// @complexity: high
	it.todo("E2E-CONTRACT-04: remote_mcp生成済みcardをexempt予約からcommit/finalizeしcard生成quotaを消費しない");

	// @category: e2e
	// @dependency: register_ai_upload, upload-mode import, finalize_import_item
	// @complexity: high
	it.todo("E2E-CONTRACT-05: owner upload登録からupload画像itemのcommit/finalizeまで通し画像quota 0・upload consumed 1回を確認する");

	// AC原文 (AC-02): commit後・finalize前のowner重複はitemを重複errorへ確定しcard関連を増やさない。
	// 検証: commit後に競合cardを挿入してからfinalizeし、安定errorとbatch集計をreadbackする。
	// 期待結果/合格基準: item failed/DUPLICATE_EXISTING、追加card/deck_card/card_tags各0。
	// @category: e2e
	// @dependency: duplicate race fixture, partial unique index
	// @complexity: high
	it.todo("E2E-CONTRACT-06: commit-finalize間duplicate競合を安全なitem failureへ収束させ部分永続化を残さない");

	// AC原文 (AC-05): JST境界と並行予約で上限超過要求だけを拒否し、成功合計が上限を超えない。
	// 検証: test clockを日付境界へ固定し、複数connectionからcard/image予約を実行する。
	// 期待結果/合格基準: 日付別200/50以下、再送二重消費0、超過だけQUOTA_EXCEEDED。
	// @category: e2e
	// @dependency: test-only clock wrapper, parallel database clients
	// @complexity: high
	it.todo("E2E-CONTRACT-07: JST日付境界と上限付近の並行予約をworkflow単位で通しcard 200/image 50を越えない");

	// AC原文 (AC-07/08): active session中の編集/削除/undoを拒否し、本文変更だけreview stateをresetする。
	// 検証: finalize済みcardを学習sessionへ入れ、管理RPC/直接DML/undoを試し、session完了後に再実行する。
	// 期待結果/合格基準: active時変更0、完了後content editはreview reset、relation editはreview keep。
	// @category: e2e
	// @dependency: finalize, study session, management RPC and triggers
	// @complexity: high
	it.todo("E2E-CONTRACT-08: finalize済みcardの学習中guardからsession完了後の編集・review reset/keepまで一連で確認する");

	// @category: e2e
	// @dependency: delete tombstone, undo_import
	// @complexity: high
	it.todo("E2E-CONTRACT-09: batch内個別削除tombstoneを含むundoと再undoを通し由来履歴・skip数・auto deck結果を維持する");

	// AC原文 (AC-10): freshとupgradeの両経路でAC-01〜09のDB契約を満たす。
	// 検証: 独立DB jobで空DBからmigration chain+seed+smoke contractを実行する。
	// 期待結果/合格基準: chain成功、公開Seed一般snapshot一致、主要RPC smoke成功。
	// @category: e2e
	// @dependency: isolated fresh database job
	// @complexity: high
	it.runIf(process.env.S10_DATABASE_JOB === "fresh")("E2E-MIGRATION-01: fresh DBへ全migrationと更新seedを適用しAC-01〜09の契約smokeを完走する", async () => {
		const selections = selectS10DatabaseJobs();
		expect(new Set(selections.map(({ databaseUrl }) => databaseUrl)).size).toBe(3);
		expect(new Set(selections.map(({ databaseName }) => databaseName)).size).toBe(3);
		expect(await runS10AcSmoke(database)).toEqual({ passedAc: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
	});

	// @category: e2e
	// @dependency: frozen pre-S10 seed, isolated upgrade database job
	// @complexity: high
	it.runIf(process.env.S10_DATABASE_JOB === "upgrade")("E2E-MIGRATION-02: pre-S10 seed済みDBをupgradeしkey backfill・部分unique・seed再実行・契約smokeを完走する", async () => {
		expect(await captureS10SeedGeneralSnapshot(database)).toEqual(
			await readS10JobSnapshot(database, "upgrade_baseline_general")
		);
		expect(await captureS10SeedKeySnapshot(database)).toEqual(
			await readS10JobSnapshot(database, "upgrade_after_migration_keys")
		);
		expect(await runS10AcSmoke(database)).toEqual({ passedAc: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
	});

	// AC原文 (AC-10b): migration途中へ失敗を注入すると追加schema、制約、backfill dataが適用前へ戻る。
	// 検証: DDL/backfill区間ごとのfailpointでmigrationを中断しbaseline snapshotと比較する。
	// 期待結果/合格基準: schema/constraint/key/data差分0、既存アプリread契約維持。
	// @category: edge-case
	// @dependency: migration failure-injection harness
	// @complexity: high
	it.runIf(process.env.S10_DATABASE_JOB === "failure")("E2E-MIGRATION-03: 各migration failpointでtransaction rollback後のDB全snapshotを適用前と一致させる", async () => {
		const results = await runS10MigrationFailureChecks(database);
		expect(results).toHaveLength(5);
		expect(results.every(({ rolledBack }) => rolledBack)).toBe(true);
	});

	// @category: e2e
	// @dependency: parallel lock-intersection harness, full S-10 primitives
	// @complexity: high
	it.todo("E2E-CONTRACT-10: commit/finalize/undo/session/direct DML/relation RPCを並行交差しdeadlock 0と最終不変条件を確認する");
});
