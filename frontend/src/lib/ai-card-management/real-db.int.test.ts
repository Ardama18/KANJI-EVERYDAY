import { createHash, randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import {
	S10_ACTORS,
	S10_DB_TEST_TIMEOUT_MS,
	captureS10Snapshot,
	createS10DbClient,
	ensureS10ActorFixtures,
	runS10Psql,
	sqlLiteral,
} from "../../../../specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit";

const database = createS10DbClient();

type ConceptState = "queued" | "processing" | "succeeded" | "failed";

interface BatchFixture {
	readonly batchId: string;
	readonly cardIds: readonly string[];
	readonly deckId: string;
	readonly marker: string;
}

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

const packedClaimsSql = (ownerUserId: string): string => `
	SET LOCAL ROLE authenticated;
	SET LOCAL request.jwt.claim.role = '';
	SET LOCAL request.jwt.claim.sub = '';
	SET LOCAL request.jwt.claims = ${sqlLiteral(
		JSON.stringify({
			role: "authenticated",
			sub: ownerUserId,
		})
	)};
`;

async function packedQuery<T extends Record<string, unknown>>(
	ownerUserId: string,
	query: string
): Promise<T[]> {
	const sql = `
		BEGIN;
		${packedClaimsSql(ownerUserId)}
		WITH result_row AS (${query.trim().replace(/;\s*$/u, "")})
		SELECT COALESCE(json_agg(row_to_json(result_row)), '[]'::json)::text FROM result_row;
		COMMIT;
	`;
	const output = await runS10Psql(database.databaseUrl, sql);
	return JSON.parse(output.trim()) as T[];
}

async function packedError(ownerUserId: string, statement: string) {
	return await database.captureError(`
		BEGIN;
		${packedClaimsSql(ownerUserId)}
		${statement};
		COMMIT;
	`);
}

async function createBatchFixture(states: readonly ConceptState[]): Promise<BatchFixture> {
	const marker = `s13-${randomUUID()}`;
	const batchId = randomUUID();
	const deckId = randomUUID();
	const cardIds: (string | null)[] = states.map((state) =>
		state === "succeeded" ? randomUUID() : null
	);
	const terminal = states.every((state) => state === "succeeded" || state === "failed");
	const finalizedCount = states.filter((state) => state === "succeeded").length;
	const failedCount = states.filter((state) => state === "failed").length;

	await database.execute(`
		INSERT INTO public.decks(id,owner_user_id,name)
		VALUES('${deckId}'::uuid,'${S10_ACTORS.ownerA.userId}'::uuid,${sqlLiteral(marker)});

		${cardIds
			.map((cardId, index) =>
				cardId === null
					? ""
					: `INSERT INTO public.cards(
						id,owner_user_id,visibility,skill,pattern,front_text,back_text,card_key
					) VALUES(
						'${cardId}'::uuid,'${S10_ACTORS.ownerA.userId}'::uuid,'private',
						'reading','R1',${sqlLiteral(`漢字 ${marker} ${index}`)},
						${sqlLiteral(`かんじ ${marker} ${index}`)},'${hash(`${marker}-${index}`)}'
					);`
			)
			.join("\n")}

		INSERT INTO public.ai_import_batches(
			id,owner_user_id,source,target_deck_id,status,idempotency_key,
			import_request_hash,requested_card_count,requested_image_count,
			finalized_count,failed_count,completed_at
		) VALUES(
			'${batchId}'::uuid,'${S10_ACTORS.ownerA.userId}'::uuid,'app_ai','${deckId}'::uuid,
			${sqlLiteral(terminal ? "completed" : "processing")},${sqlLiteral(marker)},
			'${hash(marker)}',${states.length},0,${finalizedCount},${failedCount},
			${terminal ? "statement_timestamp()" : "NULL"}
		);

		${states
			.map((state, index) => {
				const itemId = randomUUID();
				const jobId = randomUUID();
				const conceptId = `c-${randomUUID()}`;
				const queueMessageId = Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16);
				const itemState =
					state === "succeeded"
						? "finalized"
						: state === "failed"
							? "failed"
							: state === "processing"
								? "processing"
								: "committed";
				const resultCardId = cardIds[index];
				return `
					INSERT INTO public.ai_import_items(
						id,owner_user_id,batch_id,client_item_id,concept_id,ordinal,
						pattern,skill,front_text,back_text,card_key,image_mode,status,
						result_card_id,error_code,terminal_attempt_key,finalized_at,failed_at
					) VALUES(
						'${itemId}'::uuid,'${S10_ACTORS.ownerA.userId}'::uuid,'${batchId}'::uuid,
						'i-${index}-${marker.slice(-8)}',${sqlLiteral(conceptId)},${index},'R1','reading',
						${sqlLiteral(`漢字 ${marker} ${index}`)},${sqlLiteral(`かんじ ${marker} ${index}`)},
						'${hash(`${marker}-item-${index}`)}','none',${sqlLiteral(itemState)},
						${resultCardId === null ? "NULL" : `'${resultCardId}'::uuid`},
						${state === "failed" ? "'PROVIDER_PERMANENT_ERROR'" : "NULL"},
						${state === "failed" ? sqlLiteral(`s11:${jobId}:terminal`) : "NULL"},
						${state === "succeeded" ? "statement_timestamp()" : "NULL"},
						${state === "failed" ? "statement_timestamp()" : "NULL"}
					);
					INSERT INTO public.ai_import_concept_jobs(
						id,owner_user_id,batch_id,concept_id,state,queue_message_id,
						claim_token,claim_expires_at,terminal_message_id,
						terminal_claim_token_hash,error_code,completed_at
					) VALUES(
						'${jobId}'::uuid,'${S10_ACTORS.ownerA.userId}'::uuid,'${batchId}'::uuid,
						${sqlLiteral(conceptId)},${sqlLiteral(state)},${queueMessageId},
						${state === "processing" ? `'${randomUUID()}'::uuid` : "NULL"},
						${state === "processing" ? "statement_timestamp()+interval '5 minutes'" : "NULL"},
						${state === "failed" ? queueMessageId : "NULL"},
						${state === "failed" ? `'${"f".repeat(64)}'` : "NULL"},
						${state === "failed" ? "'PROVIDER_PERMANENT_ERROR'" : "NULL"},
						${state === "succeeded" || state === "failed" ? "statement_timestamp()" : "NULL"}
					);`;
			})
			.join("\n")}
	`);

	return { batchId, cardIds: cardIds.filter((id): id is string => id !== null), deckId, marker };
}

async function cleanupFixture(fixture: BatchFixture): Promise<void> {
	await database.execute(`
		DELETE FROM public.ai_import_batches WHERE id='${fixture.batchId}'::uuid;
		DELETE FROM public.cards WHERE id=ANY(ARRAY[${fixture.cardIds
			.map((id) => `'${id}'::uuid`)
			.join(",")}]::uuid[]);
		DELETE FROM public.decks WHERE id='${fixture.deckId}'::uuid;
	`);
}

describe("S-13 real database management and undo", () => {
	beforeAll(async () => {
		await ensureS10ActorFixtures(database);
	});

	it(
		"lists only the owner card with packed request.jwt.claims and RLS",
		async () => {
			const fixture = await createBatchFixture(["succeeded"]);
			try {
				const [ownerPage] = await packedQuery<{ result: { items: { id: string }[] } }>(
					S10_ACTORS.ownerA.userId,
					"SELECT public.list_ai_managed_cards(20,NULL,NULL,NULL,NULL,NULL,NULL,NULL) AS result"
				);
				expect(ownerPage?.result.items.map((item) => item.id)).toContain(fixture.cardIds[0]);

				const [otherPage] = await packedQuery<{ result: { items: { id: string }[] } }>(
					S10_ACTORS.ownerB.userId,
					"SELECT public.list_ai_managed_cards(20,NULL,NULL,NULL,NULL,NULL,NULL,NULL) AS result"
				);
				expect(otherPage?.result.items.map((item) => item.id)).not.toContain(fixture.cardIds[0]);

				const [otherRls] = await packedQuery<{ count: number }>(
					S10_ACTORS.ownerB.userId,
					`SELECT count(*)::int AS count FROM public.ai_import_items WHERE batch_id='${fixture.batchId}'::uuid`
				);
				expect(otherRls?.count).toBe(0);
			} finally {
				await cleanupFixture(fixture);
			}
		},
		S10_DB_TEST_TIMEOUT_MS
	);

	it(
		"rejects an explicit null list limit",
		async () => {
			const error = await packedError(
				S10_ACTORS.ownerA.userId,
				"SELECT public.list_ai_managed_cards(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)"
			);
			expect(error.sqlState).toBe("P1000");
		},
		S10_DB_TEST_TIMEOUT_MS
	);

	it.each(["queued", "processing"] as const)(
		"rejects a partial batch with a %s concept and changes no durable state",
		async (activeState) => {
			const fixture = await createBatchFixture(["succeeded", activeState]);
			try {
				const snapshotQueries = [
					{
						name: "batch",
						sql: `SELECT status,undo_result FROM public.ai_import_batches WHERE id='${fixture.batchId}'::uuid`,
					},
					{
						name: "items",
						sql: `SELECT id::text,status,result_card_id::text,undone_at FROM public.ai_import_items WHERE batch_id='${fixture.batchId}'::uuid ORDER BY id`,
					},
					{
						name: "jobs",
						sql: `SELECT id::text,state,claim_token::text,queue_message_id FROM public.ai_import_concept_jobs WHERE batch_id='${fixture.batchId}'::uuid ORDER BY id`,
					},
					{
						name: "cards",
						sql: `SELECT id::text FROM public.cards WHERE id=ANY(ARRAY[${fixture.cardIds.map((id) => `'${id}'::uuid`).join(",")}]::uuid[]) ORDER BY id`,
					},
				] as const;
				const before = await captureS10Snapshot(database, snapshotQueries);
				const error = await packedError(
					S10_ACTORS.ownerA.userId,
					`SELECT public.undo_import('${fixture.batchId}'::uuid)`
				);
				expect(error.sqlState).toBe("P1008");
				expect(await captureS10Snapshot(database, snapshotQueries)).toEqual(before);
			} finally {
				await cleanupFixture(fixture);
			}
		},
		S10_DB_TEST_TIMEOUT_MS
	);

	it(
		"undoes a terminal partial succeeded/failed batch and terminalizes both jobs",
		async () => {
			const fixture = await createBatchFixture(["succeeded", "failed"]);
			try {
				const [row] = await packedQuery<{ result: { status: string; deletedCardCount: number } }>(
					S10_ACTORS.ownerA.userId,
					`SELECT public.undo_import('${fixture.batchId}'::uuid) AS result`
				);
				expect(row?.result).toMatchObject({ status: "undone", deletedCardCount: 1 });
				expect(
					await database.query<{ state: string }>(
						`SELECT state FROM public.ai_import_concept_jobs WHERE batch_id='${fixture.batchId}'::uuid ORDER BY id`
					)
				).toEqual([{ state: "undone" }, { state: "undone" }]);
				expect(
					await database.query<{ status: string }>(
						`SELECT status FROM public.ai_import_items WHERE batch_id='${fixture.batchId}'::uuid ORDER BY id`
					)
				).toEqual([{ status: "undone" }, { status: "undone" }]);
				expect(
					await database.query<{ count: number }>(
						`SELECT count(*)::int AS count FROM public.cards WHERE id='${fixture.cardIds[0]}'::uuid`
					)
				).toEqual([{ count: 0 }]);
			} finally {
				await cleanupFixture(fixture);
			}
		},
		S10_DB_TEST_TIMEOUT_MS
	);
});

interface ListedMnemonic {
	readonly slots: Readonly<Record<string, unknown>>;
	readonly explanation: Readonly<{ summary: string; mappings: readonly unknown[] }>;
	readonly status: string;
}

interface ListedMnemonicCard {
	readonly id: string;
	readonly illustrationKey: string | null;
	readonly mnemonic: ListedMnemonic | null;
	readonly mnemonicSharedCardCount: number;
}

type OwnerActor = typeof S10_ACTORS.ownerA | typeof S10_ACTORS.ownerB;

const MNEMONIC_SLOTS_JSON = JSON.stringify({
	kanji: "見",
	isSingleKanji: true,
	shapeHint: { part: "下の「見」", picture: "目" },
	meaningHint: "見る・気づく",
	story: "目で見たものが頭の中で光って記憶に残る",
});

const explanationJson = (summary: string): string =>
	JSON.stringify({
		summary,
		mappings: [
			{ part: "下の「見」", meaning: "目で見る" },
			{ part: "上の光", meaning: "頭の中で気づく" },
		],
	});

/**
 * The statement the Server Action issues: no RPC, plain RLS-scoped DML, with the
 * owner taken from the session and never from the payload (ADR-013 decision 1).
 */
const upsertMnemonicSql = (illustrationKey: string, summary: string): string => `
	INSERT INTO public.card_mnemonics(owner_user_id,illustration_key,slots,explanation,status)
	VALUES(
		auth.uid(),${sqlLiteral(illustrationKey)},
		${sqlLiteral(MNEMONIC_SLOTS_JSON)}::jsonb,${sqlLiteral(explanationJson(summary))}::jsonb,
		'approved'
	)
	ON CONFLICT (owner_user_id,illustration_key) DO UPDATE
	SET slots=EXCLUDED.slots,explanation=EXCLUDED.explanation,status=EXCLUDED.status
	RETURNING id::text AS id
`;

const listPage = async (
	actor: OwnerActor,
	limit: number
): Promise<{ items: ListedMnemonicCard[]; hasMore: boolean }> => {
	const [row] = await database.query<{
		result: { items: ListedMnemonicCard[]; hasMore: boolean };
	}>(`SELECT public.list_ai_managed_cards(${limit},NULL,NULL,NULL,NULL,NULL,NULL,NULL) AS result`, {
		actor,
	});
	if (row === undefined) throw new Error("expected the list RPC to return a row");
	return row.result;
};

describe("S-19 real database mnemonic projection and edit boundary", () => {
	beforeAll(async () => {
		await ensureS10ActorFixtures(database);
	});

	const withSharedKeyFixture = async (
		cardCount: number,
		body: (fixture: BatchFixture, illustrationKey: string) => Promise<void>
	): Promise<void> => {
		const fixture = await createBatchFixture(
			Array.from({ length: cardCount }, () => "succeeded" as const)
		);
		const illustrationKey = `s19:${fixture.marker}`;
		try {
			// No ai_illustration_objects row exists for this key, so the reference
			// counting trigger on cards.illustration_key is a no-op here.
			await database.execute(`
				UPDATE public.cards SET illustration_key=${sqlLiteral(illustrationKey)}
				WHERE id=ANY(ARRAY[${fixture.cardIds.map((id) => `'${id}'::uuid`).join(",")}]::uuid[]);
			`);
			await body(fixture, illustrationKey);
		} finally {
			await database.execute(`
				DELETE FROM public.card_mnemonics WHERE illustration_key=${sqlLiteral(illustrationKey)};
			`);
			await cleanupFixture(fixture);
		}
	};

	it(
		"AC-9: keeps the RPC owned by s10_migration_owner with EXECUTE only for authenticated",
		async () => {
			const [row] = await database.query<{
				owner: string;
				authenticated: boolean;
				anon: boolean;
				serviceRole: boolean;
				definer: boolean;
				searchPath: string | null;
			}>(`
				SELECT pg_get_userbyid(p.proowner) AS owner,
					has_function_privilege('authenticated', p.oid, 'EXECUTE') AS "authenticated",
					has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
					has_function_privilege('service_role', p.oid, 'EXECUTE') AS "serviceRole",
					p.prosecdef AS definer,
					array_to_string(p.proconfig, ',') AS "searchPath"
				FROM pg_proc p
				JOIN pg_namespace n ON n.oid = p.pronamespace
				WHERE n.nspname = 'public' AND p.proname = 'list_ai_managed_cards'
			`);

			expect(row).toMatchObject({
				owner: "s10_migration_owner",
				authenticated: true,
				anon: false,
				serviceRole: false,
				definer: true,
			});
			expect(row?.searchPath).toBe("search_path=pg_catalog, pg_temp");
		},
		S10_DB_TEST_TIMEOUT_MS
	);

	it(
		"AC-3: persists an owner upsert as approved and reads it back through the list RPC",
		async () => {
			await withSharedKeyFixture(1, async (_fixture, illustrationKey) => {
				await database.query(upsertMnemonicSql(illustrationKey, "初回のまとめ。"), {
					actor: S10_ACTORS.ownerA,
				});

				const first = await listPage(S10_ACTORS.ownerA, 20);
				const card = first.items.find((item) => item.illustrationKey === illustrationKey);
				expect(card?.mnemonic?.status).toBe("approved");
				expect(card?.mnemonic?.explanation.summary).toBe("初回のまとめ。");
				expect(card?.mnemonic?.slots).toMatchObject({ kanji: "見", isSingleKanji: true });

				// AC-4 reads this same row: last-write-wins updates it in place.
				await database.query(upsertMnemonicSql(illustrationKey, "編集後のまとめ。"), {
					actor: S10_ACTORS.ownerA,
				});

				const second = await listPage(S10_ACTORS.ownerA, 20);
				const reread = second.items.find((item) => item.illustrationKey === illustrationKey);
				expect(reread?.mnemonic?.explanation.summary).toBe("編集後のまとめ。");
				expect(reread?.mnemonic?.status).toBe("approved");
				expect(
					await database.query<{ count: number }>(
						`SELECT count(*)::int AS count FROM public.card_mnemonics
						 WHERE illustration_key=${sqlLiteral(illustrationKey)}`
					)
				).toEqual([{ count: 1 }]);
			});
		},
		S10_DB_TEST_TIMEOUT_MS
	);

	it(
		"AC-6: rejects a foreign or mismatched card/key pair in the pre-check and again in RLS",
		async () => {
			await withSharedKeyFixture(1, async (fixture, illustrationKey) => {
				await database.query(upsertMnemonicSql(illustrationKey, "所有者のまとめ。"), {
					actor: S10_ACTORS.ownerA,
				});
				const ownershipCheck = async (actor: OwnerActor, key: string) =>
					await database.query<{ id: string }>(
						`SELECT id::text AS id FROM public.cards
						 WHERE id='${fixture.cardIds[0]}'::uuid AND owner_user_id=auth.uid()
						   AND illustration_key=${sqlLiteral(key)}`,
						{ actor }
					);

				// The card is the caller's, but the key does not belong to it.
				expect(await ownershipCheck(S10_ACTORS.ownerA, `${illustrationKey}-other`)).toEqual([]);
				// The key matches, but the card is not the caller's.
				expect(await ownershipCheck(S10_ACTORS.ownerB, illustrationKey)).toEqual([]);
				expect(await ownershipCheck(S10_ACTORS.ownerA, illustrationKey)).toHaveLength(1);

				// RLS is the second layer: another owner can neither forge a row for the
				// owner nor update the existing one.
				const forged = await database.captureError(
					`INSERT INTO public.card_mnemonics(owner_user_id,illustration_key,slots,explanation,status)
					 VALUES('${S10_ACTORS.ownerA.userId}'::uuid,${sqlLiteral(illustrationKey)},
						${sqlLiteral(MNEMONIC_SLOTS_JSON)}::jsonb,
						${sqlLiteral(explanationJson("乗っ取り"))}::jsonb,'approved')`,
					{ actor: S10_ACTORS.ownerB }
				);
				expect(forged.sqlState).toBe("42501");

				expect(
					await database.query<{ id: string }>(
						`UPDATE public.card_mnemonics
						 SET explanation=${sqlLiteral(explanationJson("乗っ取り"))}::jsonb
						 WHERE illustration_key=${sqlLiteral(illustrationKey)} RETURNING id::text AS id`,
						{ actor: S10_ACTORS.ownerB }
					)
				).toEqual([]);

				const untouched = await listPage(S10_ACTORS.ownerA, 20);
				expect(
					untouched.items.find((item) => item.illustrationKey === illustrationKey)?.mnemonic
						?.explanation.summary
				).toBe("所有者のまとめ。");
			});
		},
		S10_DB_TEST_TIMEOUT_MS
	);

	it(
		"AC-7: counts every card sharing the key, including cards outside the page",
		async () => {
			await withSharedKeyFixture(3, async (_fixture, illustrationKey) => {
				const page = await listPage(S10_ACTORS.ownerA, 1);

				expect(page.items).toHaveLength(1);
				expect(page.hasMore).toBe(true);
				expect(page.items[0]?.illustrationKey).toBe(illustrationKey);
				// The page holds one row, yet all three siblings are counted.
				expect(page.items[0]?.mnemonicSharedCardCount).toBe(3);
				// Without a mnemonic row the projection still yields null, not an error.
				expect(page.items[0]?.mnemonic).toBeNull();
			});
		},
		S10_DB_TEST_TIMEOUT_MS
	);

	it(
		"AC-7: reports a zero shared count for a card without an illustration key",
		async () => {
			const fixture = await createBatchFixture(["succeeded"]);
			try {
				const page = await listPage(S10_ACTORS.ownerA, 20);
				const card = page.items.find((item) => item.id === fixture.cardIds[0]);
				expect(card?.illustrationKey).toBeNull();
				expect(card?.mnemonicSharedCardCount).toBe(0);
				expect(card?.mnemonic).toBeNull();
			} finally {
				await cleanupFixture(fixture);
			}
		},
		S10_DB_TEST_TIMEOUT_MS
	);
});
