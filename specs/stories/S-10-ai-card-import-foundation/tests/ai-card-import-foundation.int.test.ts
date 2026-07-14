// S-10 DB統合テストスケルトン - Design Doc: ai-card-import-foundation v1.1.1 (Approved)
// 生成日: 2026-07-14
// テスト種別: Integration Test（実PostgreSQL/Supabase契約）
// 実装タイミング: migration / RPC / trigger実装と同時
//
// TODO(test-executor): S-02のDB testkitをS-10用に拡張し、各todoを独立transaction、
// actor fixture、固定DB clock、parallel connection、failpoint fixtureで実装する。

import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import unicodeFixture from "../fixtures/unicode-card-key.json";
import {
	createS10DbClient,
	ensureS10ActorFixtures,
	S10_ACTORS,
	sqlLiteral,
} from "./helpers/s10-db-testkit";

const database = createS10DbClient();

beforeAll(async () => {
	await ensureS10ActorFixtures(database);
});

describe("S-10 AIカード登録基盤 DB統合契約", () => {
	describe("RLS・grant・owner境界 (AC-09)", () => {
		// AC原文: 2ユーザー・未認証actorで全SELECT/INSERT/UPDATE/DELETEを検証し、非所有privateデータへの操作をすべて拒否する。
		// 期待結果/合格基準: ownerに許可した契約だけが成功し、非owner/anonの成功件数は0。service wrapperも保存済みownerを再検証する。
		// @category: integration
		// @dependency: S-10 migration RLS policies, actor fixture
		// @complexity: high
		it.todo("IT-RLS-01: owner A/B/anon/serviceのactor matrixでprivate cardsのSELECT/INSERT/UPDATE/DELETE許否が契約どおりになる");

		// @category: integration
		// @dependency: ai_import_batches/items RLS
		// @complexity: high
		it.todo("IT-RLS-02: batch/itemはowner SELECTだけを許可し、authenticatedの直接INSERT/UPDATE/DELETEを全拒否する");

		// @category: integration
		// @dependency: uploads/tags/card_tags/usage RLS
		// @complexity: high
		it.todo("IT-RLS-03: uploads/tags/card_tags/usageはowner可視性とtable別write契約を守り、非owner/anonを拒否する");

		// @category: integration
		// @dependency: RPC grants
		// @complexity: high
		it.todo("IT-RLS-04: authenticatedからcommit/reserve/upload/finalize/mark-failed wrapperを直接実行できない");

		// @category: integration
		// @dependency: internal function revoke/grant
		// @complexity: high
		it.todo("IT-RLS-05: PUBLIC/anon/authenticated/service_roleからinternal primitiveとtrigger functionを直接実行できない");

		// @category: edge-case
		// @dependency: trusted wrappers, saved batch/item ownership
		// @complexity: high
		it.todo("IT-RLS-06: service wrapperへowner/sourceを偽装しても保存済みbatch/item/request境界を越えずnot-found相当になる");

		// @category: integration
		// @dependency: public cards RLS/immutability trigger
		// @complexity: medium
		it.todo("IT-RLS-07: 公開Seedは既存SELECT互換を保ち、通常利用者のINSERT/UPDATE/DELETEを拒否する");
	});

	describe("部分一意・owner relation (AC-01/02/09)", () => {
		// AC原文: 異なるownerと公開Seed同値privateを許可し、同一owner重複、card_tags/deck_cards cross-ownerを拒否する。
		// 期待結果/合格基準: 許可例100%、禁止例成功0件。失敗時に関連行を残さない。
		// @category: integration
		// @dependency: cards partial unique indexes
		// @complexity: high
		it("IT-UNIQUE-01: 同一card_keyのprivate cardを異なるowner A/Bが各1件保持できる", async () => {
			for (const vector of unicodeFixture.displayNormalizationVectors) {
				const rows = await database.query<{ normalized: string }>(`
					SELECT public.ai_normalize_display_text(${sqlLiteral(vector.input)}) AS normalized
				`);
				expect(rows).toEqual([{ normalized: vector.expected }]);
			}

			for (const vector of unicodeFixture.keyNormalizationVectors) {
				const rows = await database.query<{ normalized: string }>(`
					SELECT public.ai_normalize_key_text(${sqlLiteral(vector.input)}) AS normalized
				`);
				expect(rows).toEqual([{ normalized: vector.expected }]);
			}

			for (const vector of unicodeFixture.cardKeyVectors) {
				const rows = await database.query<{ card_key: string }>(`
					SELECT public.ai_compute_card_key(
						${sqlLiteral(vector.pattern)},
						${sqlLiteral(vector.front)},
						${sqlLiteral(vector.back)}
					) AS card_key
				`);
				expect(rows).toEqual([{ card_key: vector.expectedSha256Hex }]);
			}

			const marker = `s10-unique-owner-${randomUUID()}`;
			try {
				await database.execute(`
					INSERT INTO public.cards (
						owner_user_id, visibility, skill, pattern, front_text, back_text, card_key
					)
					VALUES
						('${S10_ACTORS.ownerA.userId}'::uuid, 'private', 'reading', 'R1', ${sqlLiteral(marker)}, 'same back', 'caller-a'),
						('${S10_ACTORS.ownerB.userId}'::uuid, 'private', 'reading', 'R1', ${sqlLiteral(marker)}, 'same back', 'caller-b')
				`);
				const rows = await database.query<{ owner_count: number; key_count: number }>(`
					SELECT count(DISTINCT owner_user_id)::int AS owner_count,
						count(DISTINCT card_key)::int AS key_count
					FROM public.cards
					WHERE front_text = ${sqlLiteral(marker)}
				`);
				expect(rows).toEqual([{ owner_count: 2, key_count: 1 }]);
			} finally {
				await database.execute(`DELETE FROM public.cards WHERE front_text = ${sqlLiteral(marker)}`);
			}
		});

		// @category: integration
		// @dependency: cards partial unique indexes
		// @complexity: medium
		it("IT-UNIQUE-02: 公開Seedと同一card_keyのprivate cardを作成できる", async () => {
			const publicCards = await database.query<{
				pattern: string;
				front_text: string;
				back_text: string;
				card_key: string;
			}>(`
				SELECT pattern, front_text, back_text, card_key
				FROM public.cards
				WHERE visibility = 'public'
				ORDER BY id
				LIMIT 1
			`);
			expect(publicCards).toHaveLength(1);
			const source = publicCards[0];
			if (source === undefined) {
				throw new Error("S-10 integration database requires the repository Seed");
			}

			try {
				await database.execute(`
					INSERT INTO public.cards (
						owner_user_id, visibility, skill, pattern, front_text, back_text, card_key
					)
					VALUES (
						'${S10_ACTORS.ownerA.userId}'::uuid,
						'private',
						'reading',
						${sqlLiteral(source.pattern)},
						${sqlLiteral(source.front_text)},
						${sqlLiteral(source.back_text)},
						'caller-value-is-ignored'
					)
				`);
				const rows = await database.query<{ card_key: string }>(`
					SELECT card_key
					FROM public.cards
					WHERE visibility = 'private'
						AND owner_user_id = '${S10_ACTORS.ownerA.userId}'::uuid
						AND pattern = ${sqlLiteral(source.pattern)}
						AND front_text = ${sqlLiteral(source.front_text)}
						AND back_text = ${sqlLiteral(source.back_text)}
				`);
				expect(rows).toEqual([{ card_key: source.card_key }]);
			} finally {
				await database.execute(`
					DELETE FROM public.cards
					WHERE visibility = 'private'
						AND owner_user_id = '${S10_ACTORS.ownerA.userId}'::uuid
						AND pattern = ${sqlLiteral(source.pattern)}
						AND front_text = ${sqlLiteral(source.front_text)}
						AND back_text = ${sqlLiteral(source.back_text)}
				`);
			}
		});

		// @category: edge-case
		// @dependency: private owner partial unique index, error mapper
		// @complexity: high
		it("IT-UNIQUE-03: 同一ownerのprivate重複をnamed 23505からDUPLICATE_EXISTINGへ分類する", async () => {
			const marker = `s10-unique-duplicate-${randomUUID()}`;
			try {
				await database.execute(`
					INSERT INTO public.cards (
						owner_user_id, visibility, skill, pattern, front_text, back_text, card_key
					)
					VALUES (
						'${S10_ACTORS.ownerA.userId}'::uuid,
						'private',
						'reading',
						'R1',
						${sqlLiteral(marker)},
						'duplicate back',
						'caller-value-first'
					)
				`);
				const diagnostic = await database.captureError(`
					INSERT INTO public.cards (
						owner_user_id, visibility, skill, pattern, front_text, back_text, card_key
					)
					VALUES (
						'${S10_ACTORS.ownerA.userId}'::uuid,
						'private',
						'reading',
						'R1',
						${sqlLiteral(marker)},
						'duplicate back',
						'caller-value-second'
					)
				`);
				expect(diagnostic).toEqual({
					sqlState: "23505",
					constraint: "cards_private_owner_card_key_uidx",
				});
			} finally {
				await database.execute(`DELETE FROM public.cards WHERE front_text = ${sqlLiteral(marker)}`);
			}
		});

		// @category: integration
		// @dependency: card_tags composite foreign keys and trigger
		// @complexity: high
		it.todo("IT-OWNER-01: card/tag/relation ownerが一致するcard_tagsだけを許可しINSERT/UPDATE偽装を拒否する");

		// @category: integration
		// @dependency: deck_cards owner trigger
		// @complexity: high
		it.todo("IT-OWNER-02: owner deckへpublic cardまたは同一owner private cardだけを関連付けられる");

		// @category: edge-case
		// @dependency: deck_cards owner trigger
		// @complexity: high
		it.todo("IT-OWNER-03: deck_cards INSERT/UPDATEのcross-owner private card差替えをservice roleでも拒否する");

		// @category: integration
		// @dependency: relation grants, set_card_* RPC
		// @complexity: high
		it.todo("IT-OWNER-04: authenticatedのrelation直接writeを拒否しSELECT互換とowner管理RPCだけを許可する");
	});

	describe("commit・冪等性・Stage 1原子性 (AC-02/04/06)", () => {
		// AC原文: 同key同hash並行commitはbatch 1件、別hashはCONFLICT、Stage 1不正は全table増分0、正常commit時card関連0。
		// 期待結果/合格基準: batch/items/tags/reservation linkだけを1 transactionで確定し、usage二重加算なし。
		// @category: integration
		// @dependency: commit_import wrapper/internal, Stage 1 DB validation
		// @complexity: high
		it.todo("IT-COMMIT-01: 正常commitがbatch/items/tags/item_tagsとreservation linkを原子的に作りcard/deck_cards/card_tagsを0件に保つ");

		// @category: edge-case
		// @dependency: commit transaction, snapshot helper
		// @complexity: high
		it.todo("IT-COMMIT-02: Stage 1各validation違反と途中例外でdeck/card/batch/item/tag/card_tags/usage/reservation差分が0になる");

		// @category: edge-case
		// @dependency: idempotency advisory lock, parallel DB clients
		// @complexity: high
		it.todo("IT-COMMIT-03: 同owner/key/import hashの並行commitがbatch 1件と同一batch IDを返しitem/tag/usageを増やさない");

		// @category: edge-case
		// @dependency: commit idempotency contract
		// @complexity: high
		it.todo("IT-COMMIT-04: 同owner/keyでimport hash・source・reservationのいずれかが異なる再送をCONFLICTにして既存batchを不変にする");

		// @category: integration
		// @dependency: generation/import hash DB validation
		// @complexity: high
		it.todo("IT-COMMIT-05: generation hashとimport hashの非一致を許容しreservation keyで結び、初回だけimport hashを関連付ける");

		// @category: edge-case
		// @dependency: DB canonical import hash function
		// @complexity: high
		it.todo("IT-COMMIT-06: 引数import hashとDB再計算hashの不一致、reservation key改ざんを拒否し副作用を0件にする");

		// @category: edge-case
		// @dependency: duplicate set validation
		// @complexity: high
		it.todo("IT-COMMIT-07: request内card-key重複をDUPLICATE_IN_REQUEST、既存owner重複をDUPLICATE_EXISTINGに分類し全変更をrollbackする");

		// @category: integration
		// @dependency: deck/upload locking
		// @complexity: high
		it.todo("IT-COMMIT-08: deck ID/name/createのowner・一意解決とupload ready状態をlock後再検証し適切な安定codeを返す");

		// @category: integration
		// @dependency: tag normalization trigger
		// @complexity: medium
		it.todo("IT-COMMIT-09: tag display nameからDBがnormalized_nameを強制導出し、偽装値を無視してowner内uniqueを守る");
	});

	describe("JST quota reservation (AC-05)", () => {
		// AC原文: JST日付境界と並行予約で200 card/50 imageを超える要求だけ拒否し、免除と同key再送を二重消費させない。
		// 期待結果/合格基準: DB clock基準、成功units合計<=limit、provider_started予約は返却しない。
		// @category: edge-case
		// @dependency: test-only DB clock wrapper, reserve_provider_usage
		// @complexity: high
		it.todo("IT-QUOTA-01: JST 23:59:59と00:00:00で別usage_dateに予約しclient日付を参照しない");

		// @category: edge-case
		// @dependency: ai_usage_daily row lock
		// @complexity: high
		it.todo("IT-QUOTA-02: card generation 199+1を成功、199+2をQUOTA_EXCEEDEDにして成功合計200以下を守る");

		// @category: edge-case
		// @dependency: ai_usage_daily row lock
		// @complexity: high
		it.todo("IT-QUOTA-03: illustration concept 49+1を成功、49+2をQUOTA_EXCEEDEDにして成功合計50以下を守る");

		// @category: edge-case
		// @dependency: parallel clients, advisory and row locks
		// @complexity: high
		it.todo("IT-QUOTA-04: 上限付近の異なるreservation並行実行で上限内要求だけ成功しoversubscriptionを0件にする");

		// @category: integration
		// @dependency: reservation idempotency ledger
		// @complexity: high
		it.todo("IT-QUOTA-05: 同owner/key/kind/hash/units再送は同じreservationを返しusageを加算せず、差分再送はCONFLICTになる");

		// @category: integration
		// @dependency: trusted source/image mode
		// @complexity: high
		it.todo("IT-QUOTA-06: remote_mcp cardとupload imageをtrusted DB contextからunits 0 exemptとして記録する");

		// @category: edge-case
		// @dependency: provider_started_at transaction contract
		// @complexity: medium
		it.todo("IT-QUOTA-07: provider開始前の入力拒否は消費せず、開始済みreservationは後続成功/失敗でも返却しない");

		// @category: integration
		// @dependency: reservation locking implementation
		// @complexity: high
		it.todo("IT-QUOTA-08: advisory→既存non-lock read→batch/item→usage→reservation順で同key並行を直列化する");
	});

	describe("upload・finalize・failure primitive (AC-01/02/06)", () => {
		// AC原文: finalizeはcard/deck/card_tags/item結果を原子的に確定し、同一item再実行で副作用を増やさない。
		// 期待結果/合格基準: upload/failure/finalizeの各状態遷移が冪等で、途中失敗時に部分行が残らない。
		// @category: integration
		// @dependency: register_ai_upload
		// @complexity: high
		it.todo("IT-UPLOAD-01: 同owner/upload key/同metadata再送は同じready rowを返し、metadata差分はCONFLICTになる");

		// @category: edge-case
		// @dependency: register_ai_upload validation
		// @complexity: high
		it.todo("IT-UPLOAD-02: owner path prefix・Storage owner/存在・MIME allow list・1..10MiB境界を検証する");

		// @category: edge-case
		// @dependency: upload state machine
		// @complexity: medium
		it.todo("IT-UPLOAD-03: consumed/deleted upload keyの再利用とcross-owner参照を拒否する");

		// @category: integration
		// @dependency: finalize_import_item
		// @complexity: high
		it.todo("IT-FINALIZE-01: committed itemからprivate card/deck_card/card_tags/resultを1 transactionで作成しownerを一致させる");

		// @category: integration
		// @dependency: finalize_import_item, upload relation
		// @complexity: high
		it.todo("IT-FINALIZE-02: image modeに応じ同owner ready illustrationを検証しuploadを同transactionで一度だけconsumedにする");

		// @category: edge-case
		// @dependency: finalize idempotency, parallel clients
		// @complexity: high
		it.todo("IT-FINALIZE-03: 同一itemの再実行と並行finalizeが同じcard IDを返し全副作用を1回分に保つ");

		// @category: edge-case
		// @dependency: private partial unique, finalize duplicate mapper
		// @complexity: high
		it.todo("IT-FINALIZE-04: commit後finalize前にowner重複が作られた場合itemだけをDUPLICATE_EXISTING failedへ確定する");

		// @category: edge-case
		// @dependency: finalize failpoints
		// @complexity: high
		it.todo("IT-FINALIZE-05: card/relation/upload/item各区間のfailpointで全変更をrollbackしcardだけを残さない");

		// @category: integration
		// @dependency: mark_import_item_failed
		// @complexity: high
		it.todo("IT-FAIL-01: committed/processing itemをsafe allow-list errorでfailedにしbatch counts/statusを同transactionで再集計する");

		// @category: edge-case
		// @dependency: mark_import_item_failed idempotency
		// @complexity: high
		it.todo("IT-FAIL-02: 同attempt/error再送は同じ結果、別attemptまたはterminal itemはCONFLICTとなりprovider本文/stackを保存しない");
	});

	describe("active guard・review reset・undo (AC-07/08)", () => {
		// AC原文: current/4 queuesのactive card変更・削除・undoを拒否し、本文4列変更だけreview stateをresetする。
		// 期待結果/合格基準: RPC/直接DMLとも同じ結果で、guard/更新失敗は副作用0、undoはbatch原子・冪等。
		// @category: integration
		// @dependency: active-session triggers
		// @complexity: high
		it.todo("IT-GUARD-01: current_card_idとqueue_due/learn/new/retryの各位置でRPC更新・削除・undoをACTIVE_SESSION拒否する");

		// @category: edge-case
		// @dependency: queue UUID parser
		// @complexity: medium
		it.todo("IT-GUARD-02: queue中のobject/number/null/非canonical UUID文字列を無視し有効UUID文字列だけをguard対象にする");

		// @category: integration
		// @dependency: direct cards UPDATE/DELETE triggers
		// @complexity: high
		it.todo("IT-GUARD-03: 許可されたcards直接UPDATE/DELETEでもRPCと同じACTIVE_SESSION detailと副作用0を保証する");

		// @category: edge-case
		// @dependency: session/card symmetric lock protocol
		// @complexity: high
		it.todo("IT-GUARD-04: card更新と同時session INSERT/UPDATEの競合でもactive guardを取りこぼさない");

		// @category: core-functionality
		// @dependency: review reset trigger
		// @complexity: high
		it.todo("IT-REVIEW-01: front/back/skill/pattern各列の実値変更で対象cardの全review_statesを削除する");

		// @category: integration
		// @dependency: relation management RPC
		// @complexity: high
		it.todo("IT-REVIEW-02: illustration/tag/deckだけの変更はreview_statesを完全一致で維持する");

		// @category: edge-case
		// @dependency: cards update transaction
		// @complexity: high
		it.todo("IT-REVIEW-03: content UPDATE自体が後段constraint/triggerで失敗した場合review_statesもrollbackする");

		// @category: integration
		// @dependency: undo_import
		// @complexity: high
		it.todo("IT-UNDO-01: 非owner undoをnot-found相当、編集済みitemをCARD_MODIFIEDとしてbatch全体を副作用0で拒否する");

		// @category: integration
		// @dependency: delete tombstone trigger, FK SET NULL
		// @complexity: high
		it.todo("IT-UNDO-02: 個別削除をdeleted tombstoneへ記録しresult FK SET NULL後も由来を保持してundoではskipする");

		// @category: edge-case
		// @dependency: undo_result idempotency
		// @complexity: high
		it.todo("IT-UNDO-03: 既にundoneのbatchへ再実行すると保存済みundo_resultを返し副作用を増やさない");

		// @category: integration
		// @dependency: auto deck cleanup
		// @complexity: high
		it.todo("IT-UNDO-04: auto-created deckはundo後空なら削除、他cardが残れば維持しtarget/auto FKをNULL化して履歴を守る");
	});

	describe("lock交差・trigger security・migration (AC-03/09/10)", () => {
		// AC原文: 単一lock matrix、DEFINER安全性、fresh/upgrade二経路、migration途中失敗の全rollbackを保証する。
		// 期待結果/合格基準: deadlock 0、権限迂回0、Seed一般snapshot差分0、失敗注入差分0。
		// @category: integration
		// @dependency: parallel lock-intersection harness
		// @complexity: high
		it.todo("IT-LOCK-01: commit/finalize/undo/session/direct card/relation管理RPC/illustration/cascade交差を反復してdeadlock 0を確認する");

		// @category: integration
		// @dependency: SECURITY DEFINER catalog assertions
		// @complexity: high
		it.todo("IT-SECURITY-01: 全DEFINER関数が固定owner・search_path pg_catalog,pg_temp・public完全修飾・EXECUTE revokeを満たす");

		// @category: integration
		// @dependency: schema ACL assertions
		// @complexity: medium
		it.todo("IT-SECURITY-02: public schema CREATEがPUBLIC/anon/authenticatedからrevokeされmigration ownerだけに許可される");

		// @category: edge-case
		// @dependency: trigger rollback failpoints
		// @complexity: high
		it.todo("IT-SECURITY-03: trigger例外時にreview reset/tombstone/edit markerだけが残らずstatement全体がrollbackする");

		// @category: integration
		// @dependency: fresh database fixture
		// @complexity: high
		it.todo("IT-MIGRATION-01: 空DBへ全migration chainと更新済みseedを適用しAC-01〜09のDB契約fixtureを実行できる");

		// @category: integration
		// @dependency: frozen pre-S10 seed upgrade fixture
		// @complexity: high
		it.todo("IT-MIGRATION-02: pre-S10 seed済みDBへforward migrationを適用し一般Seed snapshotを不変に保つ");

		// @category: integration
		// @dependency: Unicode fixture, key backfill
		// @complexity: high
		it.todo("IT-MIGRATION-03: 旧card_keyを別記録し、全既存cardのbackfill後keyを個別SHA-256期待値と一致させる");

		// @category: integration
		// @dependency: updated seed.sql
		// @complexity: high
		it.todo("IT-MIGRATION-04: seed再実行で公開card/deck/relation件数とmigration後card_keyを増減・変更しない");

		// @category: edge-case
		// @dependency: migration failpoint harness
		// @complexity: high
		it.todo("IT-MIGRATION-05: normalization/backfill/index/table/RLS各区間の失敗注入でschema/constraint/keyを適用前snapshotへ戻す");
	});
});
