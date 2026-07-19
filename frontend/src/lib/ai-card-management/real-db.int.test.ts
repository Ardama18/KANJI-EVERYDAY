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
