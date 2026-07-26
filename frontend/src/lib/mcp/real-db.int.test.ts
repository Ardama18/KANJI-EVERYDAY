import { createHash, randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { normalizedRequestToJson } from "@/lib/ai-import/async-contract";
import {
	deriveRemoteGenerationRequestHash,
	hashImportRequest,
} from "@/lib/ai-import/canonical-request";
import { signRemotePreviewToken } from "@/lib/ai-import/preview-token";
import { type NormalizedImportRequest, validateImportRequest } from "@/lib/ai-import/schema";
import {
	S10_ACTORS,
	S10_DB_TEST_TIMEOUT_MS,
	createS10DbClient,
	ensureS10ActorFixtures,
	runS10Psql,
	sqlLiteral,
} from "../../../../specs/stories/S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit";

const isolatedDatabaseUrl = process.env.S14_TEST_DATABASE_URL?.trim();
const previewSecret = "s14-real-db-preview-secret";

function isVerifiedIsolatedUrl(value: string | undefined): value is string {
	if (!value) return false;
	try {
		const parsed = new URL(value);
		const database = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
		return (
			(parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") &&
			/^s14_gate_[a-z0-9_]+$/u.test(database) &&
			!parsed.hostname.endsWith("supabase.co")
		);
	} catch {
		return false;
	}
}

const verifiedIsolatedDatabaseUrl = isVerifiedIsolatedUrl(isolatedDatabaseUrl)
	? isolatedDatabaseUrl
	: undefined;
const database =
	verifiedIsolatedDatabaseUrl === undefined
		? undefined
		: createS10DbClient(verifiedIsolatedDatabaseUrl);

interface Fixture {
	readonly marker: string;
	readonly ownerDeckId: string;
	readonly otherDeckId: string;
	readonly clientId: string;
	readonly sessionId: string;
	readonly request: NormalizedImportRequest;
	readonly requestJson: unknown;
	readonly importRequestHash: string;
	readonly generationRequestHash: string;
	readonly reservationKey: string;
	readonly idempotencyKey: string;
	readonly previewToken: string;
}

/** S-21: one server-generated approved mnemonic, exactly as the RPC receives it. */
const mnemonicPayload = (conceptId: string, story: string) => [
	{
		conceptId,
		slots: {
			kanji: "山",
			isSingleKanji: true,
			shapeHint: { part: "三つの峰", picture: "山なみ" },
			meaningHint: "たかい土地",
			story,
		},
		explanation: {
			summary: "峰が三つならんで山になる。",
			mappings: [
				{ part: "左の峰", meaning: "ひくい山" },
				{ part: "右の峰", meaning: "たかい山" },
			],
		},
	},
];

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

describe.skipIf(verifiedIsolatedDatabaseUrl === undefined)(
	"S-14 isolated remote MCP database gate",
	() => {
		beforeAll(async () => {
			if (database === undefined) throw new Error("S14_TEST_DATABASE_URL is required");
			await ensureS10ActorFixtures(database);
		}, S10_DB_TEST_TIMEOUT_MS);

		it(
			"uses a disposable S-14 database and grants only the expected public wrappers",
			async () => {
				const result = await superQuery<{
					database: string;
					wrappers: number;
					authenticatedCommit: boolean;
					anonCommit: boolean;
					serviceCommit: boolean;
					authenticatedInternal: boolean;
					authenticatedPrivateState: boolean;
				}>(`SELECT json_build_object(
					'database', current_database(),
					'wrappers', count(*) FILTER (WHERE proname IN (
						's14_remote_validate_import_preview', 's14_remote_commit_import',
						's14_remote_get_import_status', 's14_remote_update_imported_card',
						's14_remote_update_ai_card'
					)),
					'authenticatedCommit', has_function_privilege(
						'authenticated',
						'public.s14_remote_commit_import(text,text,text,text,text,text,jsonb,text,jsonb)',
						'EXECUTE'
					),
					'anonCommit', has_function_privilege(
						'anon',
						'public.s14_remote_commit_import(text,text,text,text,text,text,jsonb,text,jsonb)',
						'EXECUTE'
					),
					'serviceCommit', has_function_privilege(
						'service_role',
						'public.s14_remote_commit_import(text,text,text,text,text,text,jsonb,text,jsonb)',
						'EXECUTE'
					),
					'authenticatedInternal', has_function_privilege(
						'authenticated',
						'public.ai_s14_enqueue_import_internal(uuid,text,text,text,jsonb,text)',
						'EXECUTE'
					),
					'authenticatedPrivateState', has_table_privilege(
						'authenticated',
						's14_private.oauth_consent_states',
						'SELECT'
					)
				) AS result
				FROM pg_proc JOIN pg_namespace ON pg_namespace.oid=pg_proc.pronamespace
				WHERE nspname='public'`);
				expect(result.database).toMatch(/^s14_gate_[a-z0-9_]+$/u);
				expect(result.wrappers).toBe(5);
				expect(result.authenticatedCommit).toBe(true);
				expect(result.anonCommit).toBe(false);
				expect(result.serviceCommit).toBe(false);
				expect(result.authenticatedInternal).toBe(false);
				expect(result.authenticatedPrivateState).toBe(false);
			},
			S10_DB_TEST_TIMEOUT_MS
		);

		it(
			"allows owner preview and keeps reservation, batch, queue, and card state write-free",
			async () => {
				const fixture = await createFixture();
				await remoteExecute(fixture, previewSql(fixture), { dbPreviewSecret: false });
				const state = await markerState(fixture);
				expect(state).toMatchObject({
					reservations: 0,
					batches: 0,
					items: 0,
					jobs: 0,
					cards: 0,
				});
			},
			S10_DB_TEST_TIMEOUT_MS
		);

		it(
			"rejects other-owner decks without leaking them through preview",
			async () => {
				const fixture = await createFixture();
				const error = await remoteError(fixture, previewSql(fixture, fixture.otherDeckId), {
					dbPreviewSecret: false,
				});
				expect(error.sqlState).toBe("P1003");
			},
			S10_DB_TEST_TIMEOUT_MS
		);

		it(
			"creates an owner deck through authenticated RLS and returns it through owner list only",
			async () => {
				const fixture = await createFixture();
				const deckName = `${fixture.marker} created`;
				const created = await remoteQuery<{ id: string; name: string }>(
					fixture,
					`INSERT INTO public.decks(owner_user_id,name)
						VALUES ('${S10_ACTORS.ownerA.userId}'::uuid,${sqlLiteral(deckName)})
						RETURNING json_build_object('id', id, 'name', name) AS result`
				);
				const ownerList = await remoteQuery<{ decks: Array<{ id: string; name: string }> }>(
					fixture,
					`SELECT json_build_object(
							'decks',
							COALESCE(json_agg(json_build_object('id', id, 'name', name) ORDER BY name, id), '[]'::json)
						) AS result
						FROM public.decks`
				);
				const otherOwner = await remoteQuery<{ count: number }>(
					fixture,
					`SELECT json_build_object('count', count(*)::int) AS result
						FROM public.decks WHERE id='${created.id}'::uuid`,
					{ ownerUserId: S10_ACTORS.ownerB.userId }
				);

				expect(created.name).toBe(deckName);
				expect(ownerList.decks).toContainEqual(created);
				expect(otherOwner.count).toBe(0);
			},
			S10_DB_TEST_TIMEOUT_MS
		);

		it(
			"keeps daily study status source rows scoped to the OAuth actor owner",
			async () => {
				const fixture = await createFixture();
				const dailyFixture = await insertDailyStudyStatusFixture(fixture);
				const ownerA = await remoteQuery<DailyStudyStatusSourceRows>(
					fixture,
					dailyStudyStatusSourceSql(fixture)
				);
				const ownerB = await remoteQuery<DailyStudyStatusSourceRows>(
					fixture,
					dailyStudyStatusSourceSql(fixture),
					{ ownerUserId: S10_ACTORS.ownerB.userId }
				);

				expect(ownerA).toEqual({
					deckIds: [fixture.ownerDeckId],
					cardIds: [dailyFixture.ownerCardId],
					reviewUsers: [S10_ACTORS.ownerA.userId],
				});
				expect(ownerB).toEqual({
					deckIds: [fixture.otherDeckId],
					cardIds: [dailyFixture.otherCardId],
					reviewUsers: [S10_ACTORS.ownerB.userId],
				});
			},
			S10_DB_TEST_TIMEOUT_MS
		);

		it(
			"rejects mismatched client and session claims before preview work",
			async () => {
				const fixture = await createFixture();
				const wrongClient = await remoteError(fixture, previewSql(fixture), {
					clientId: randomUUID(),
					dbPreviewSecret: false,
				});
				const wrongSession = await remoteError(fixture, previewSql(fixture), {
					sessionId: randomUUID(),
					dbPreviewSecret: false,
				});
				expect(wrongClient.sqlState).toBe("42501");
				expect(wrongSession.sqlState).toBe("42501");
				expect(await markerState(fixture)).toMatchObject({ reservations: 0, batches: 0 });
			},
			S10_DB_TEST_TIMEOUT_MS
		);

		it(
			"rejects malformed packed claims and service-role direct execution",
			async () => {
				const fixture = await createFixture();
				const malformedClaims = await captureSqlError(`
					SET LOCAL ROLE authenticated;
					SET LOCAL request.jwt.claims = ${sqlLiteral("{")};
					${previewSql(fixture)};
				`);
				const serviceRole = await captureSqlError(`
					SET LOCAL ROLE service_role;
					${commitSql(fixture)};
				`);
				expect(malformedClaims.sqlState).toBe("42501");
				expect(serviceRole.sqlState).toBe("42501");
			},
			S10_DB_TEST_TIMEOUT_MS
		);

		it(
			"rejects commit without the database-side preview HMAC secret",
			async () => {
				const fixture = await createFixture();
				const error = await remoteError(fixture, commitSql(fixture), { dbPreviewSecret: false });
				expect(error.sqlState).toBe("42501");
				expect(await markerState(fixture)).toMatchObject({ reservations: 0, batches: 0 });
			},
			S10_DB_TEST_TIMEOUT_MS
		);

		it(
			"commits a valid remote preview atomically with remote_mcp source and zero quota units",
			async () => {
				const fixture = await createFixture();
				const commit = await remoteQuery<{
					batchId: string;
					status: string;
					statusUrl: string;
				}>(fixture, commitSql(fixture));
				expect(commit.status).toBe("queued");
				expect(commit.statusUrl).toBe(`/api/ai/imports/status?batchId=${commit.batchId}`);
				const state = await markerState(fixture);
				expect(state).toMatchObject({ reservations: 1, batches: 1, items: 1, jobs: 1 });
				expect(state.reservationUnits).toBe(0);
				expect(state.batchSource).toBe("remote_mcp");
			},
			S10_DB_TEST_TIMEOUT_MS
		);

		it(
			"allows commit when ChatGPT rotates the OAuth client after preview",
			async () => {
				const fixture = await createFixture();
				const rotatedClientId = randomUUID();
				const commit = await remoteQuery<{
					batchId: string;
					status: string;
					statusUrl: string;
				}>(
					fixture,
					commitSql(fixture, {
						clientId: rotatedClientId,
						generationRequestHash: await deriveRemoteGenerationRequestHash(
							fixture.importRequestHash,
							rotatedClientId
						),
					}),
					{ clientId: rotatedClientId }
				);
				expect(commit.status).toBe("queued");
				expect(commit.statusUrl).toBe(`/api/ai/imports/status?batchId=${commit.batchId}`);
				const state = await markerState(fixture);
				expect(state).toMatchObject({ reservations: 1, batches: 1, items: 1, jobs: 1 });
				expect(state.reservationUnits).toBe(0);
				expect(state.batchSource).toBe("remote_mcp");
			},
			S10_DB_TEST_TIMEOUT_MS
		);

		it(
			"replays the same owner/key/hash to the same batch without duplicating durable rows",
			async () => {
				const fixture = await createFixture();
				const first = await remoteQuery<{ batchId: string }>(fixture, commitSql(fixture));
				const replay = await remoteQuery<{ batchId: string }>(fixture, commitSql(fixture));
				expect(replay.batchId).toBe(first.batchId);
				expect(await markerState(fixture)).toMatchObject({ reservations: 1, batches: 1, items: 1 });
			},
			S10_DB_TEST_TIMEOUT_MS
		);

		it(
			"rejects same idempotency key with a different request hash without partial writes",
			async () => {
				const fixture = await createFixture();
				await remoteQuery(fixture, commitSql(fixture));
				const before = await markerState(fixture);
				const changedHash = "f".repeat(64);
				const changedPreviewToken = await signRemotePreviewToken(
					{
						userId: S10_ACTORS.ownerA.userId,
						clientId: fixture.clientId,
						reservationKey: fixture.reservationKey,
						importRequestHash: changedHash,
					},
					previewSecret,
					Math.floor(Date.now() / 1000)
				);
				const error = await remoteError(
					fixture,
					commitSql(fixture, {
						importRequestHash: changedHash,
						generationRequestHash: await deriveRemoteGenerationRequestHash(
							changedHash,
							fixture.clientId
						),
						previewToken: changedPreviewToken,
					})
				);
				expect(error.sqlState).toBe("P1008");
				expect(await markerState(fixture)).toEqual(before);
			},
			S10_DB_TEST_TIMEOUT_MS
		);

		it(
			"returns owner status by batch id and idempotency key while hiding it from another owner",
			async () => {
				const fixture = await createFixture();
				const commit = await remoteQuery<{ batchId: string }>(fixture, commitSql(fixture));
				const byBatch = await remoteQuery<{ batchId: string; status: string }>(
					fixture,
					statusSql(fixture, { batchId: commit.batchId })
				);
				const byKey = await remoteQuery<{ batchId: string; status: string }>(
					fixture,
					statusSql(fixture, { idempotencyKey: fixture.idempotencyKey })
				);
				const otherOwner = await remoteError(
					fixture,
					statusSql(fixture, { batchId: commit.batchId }),
					{
						ownerUserId: S10_ACTORS.ownerB.userId,
					}
				);
				expect(byBatch).toMatchObject({ batchId: commit.batchId, status: "queued" });
				expect(byKey).toMatchObject({ batchId: commit.batchId, status: "queued" });
				expect(otherOwner.sqlState).toBe("P1003");
			},
			S10_DB_TEST_TIMEOUT_MS
		);

		it(
			"updates a managed remote card atomically only for the owner/client/session actor",
			async () => {
				const fixture = await createFixture();
				const cardId = randomUUID();
				await insertManagedCardFixture(fixture, cardId);
				const before = await superQuery<{ updatedAt: string }>(
					`SELECT json_build_object('updatedAt', updated_at) AS result
					FROM public.cards WHERE id='${cardId}'::uuid`
				);
				const updated = await remoteQuery<{ cardId: string; updatedAt: string }>(
					fixture,
					`SELECT public.s14_remote_update_ai_card(
						${sqlLiteral(fixture.clientId)},
						${sqlLiteral(fixture.sessionId)},
						'${cardId}'::uuid,
						${sqlLiteral(before.updatedAt)}::timestamptz,
						${sqlLiteral(
							JSON.stringify({
								content: {
									frontText: `${fixture.marker} 新`,
									backText: "しん",
									skill: "reading",
									pattern: "R1",
								},
							})
						)}::jsonb
					) AS result`
				);
				const otherOwner = await remoteError(
					fixture,
					`SELECT public.s14_remote_update_ai_card(
						${sqlLiteral(fixture.clientId)},
						${sqlLiteral(fixture.sessionId)},
						'${cardId}'::uuid,
						${sqlLiteral(updated.updatedAt)}::timestamptz,
						${sqlLiteral(
							JSON.stringify({
								content: {
									frontText: `${fixture.marker} 他`,
									backText: "た",
									skill: "reading",
									pattern: "R1",
								},
							})
						)}::jsonb
					)`,
					{ ownerUserId: S10_ACTORS.ownerB.userId }
				);
				const card = await superQuery<{ front: string; back: string }>(
					`SELECT json_build_object('front', front_text, 'back', back_text) AS result
					FROM public.cards WHERE id='${cardId}'::uuid`
				);
				expect(updated.cardId).toBe(cardId);
				expect(otherOwner.sqlState).toBe("P1003");
				expect(card).toEqual({ front: `${fixture.marker} 新`, back: "しん" });
			},
			S10_DB_TEST_TIMEOUT_MS
		);

		// S-21 4-1 / AC-1: p_mnemonics is persisted as an approved, owner-scoped row whose
		// illustration_key matches the one ai_s14_enqueue_import_internal materialised.
		it(
			"stores an approved owner-scoped card_mnemonics row for an image.mode=ai concept",
			async () => {
				const fixture = await createFixture("ai");
				const conceptId = fixture.request.items[0]?.conceptId ?? "";
				const commit = await remoteQuery<{ batchId: string }>(
					fixture,
					commitSql(fixture, { mnemonics: mnemonicPayload(conceptId, "峰が三つならぶ") })
				);

				const stored = await mnemonicRows(fixture);
				expect(stored.count).toBe(1);
				expect(stored.rows[0]).toEqual({
					ownerUserId: S10_ACTORS.ownerA.userId,
					illustrationKey: `s11:${commit.batchId}:${hash(conceptId)}`,
					status: "approved",
					story: "峰が三つならぶ",
				});
			},
			S10_DB_TEST_TIMEOUT_MS
		);

		// S-21 4-2 / AC-5: RLS keeps the row invisible to another owner.
		it(
			"hides the stored mnemonic from another owner",
			async () => {
				const fixture = await createFixture("ai");
				const conceptId = fixture.request.items[0]?.conceptId ?? "";
				await remoteQuery(
					fixture,
					commitSql(fixture, { mnemonics: mnemonicPayload(conceptId, "峰が三つならぶ") })
				);

				const otherOwner = await mnemonicRows(fixture, {
					ownerUserId: S10_ACTORS.ownerB.userId,
				});
				expect(otherOwner).toEqual({ count: 0, rows: [] });
			},
			S10_DB_TEST_TIMEOUT_MS
		);

		// S-21 4-3 / D1: re-committing the same idempotency key is idempotent for the
		// mnemonic too - the row is updated in place and stays approved.
		it(
			"keeps the mnemonic upsert idempotent across a replayed commit",
			async () => {
				const fixture = await createFixture("ai");
				const conceptId = fixture.request.items[0]?.conceptId ?? "";
				const first = await remoteQuery<{ batchId: string }>(
					fixture,
					commitSql(fixture, { mnemonics: mnemonicPayload(conceptId, "はじめのはなし") })
				);
				const replay = await remoteQuery<{ batchId: string }>(
					fixture,
					commitSql(fixture, { mnemonics: mnemonicPayload(conceptId, "あとのはなし") })
				);

				const stored = await mnemonicRows(fixture);
				expect(replay.batchId).toBe(first.batchId);
				expect(stored.count).toBe(1);
				expect(stored.rows[0]).toMatchObject({ status: "approved", story: "あとのはなし" });
				expect(await markerState(fixture)).toMatchObject({ batches: 1, items: 1, jobs: 1 });
			},
			S10_DB_TEST_TIMEOUT_MS
		);

		// S-21 4-4 / AC-4: the pre-S-21 call shape still works and writes no mnemonic.
		it(
			"commits without any mnemonic when p_mnemonics is omitted or resolves to no illustration",
			async () => {
				const aiFixture = await createFixture("ai");
				const noneFixture = await createFixture("none");
				const noneConceptId = noneFixture.request.items[0]?.conceptId ?? "";

				const omitted = await remoteQuery<{ status: string }>(aiFixture, commitSql(aiFixture));
				// image.mode='none' has no illustration row, so the RPC skips the entry.
				const skipped = await remoteQuery<{ status: string }>(
					noneFixture,
					commitSql(noneFixture, {
						mnemonics: mnemonicPayload(noneConceptId, "峰が三つならぶ"),
					})
				);

				expect(omitted.status).toBe("queued");
				expect(skipped.status).toBe("queued");
				expect(await mnemonicRows(aiFixture)).toEqual({ count: 0, rows: [] });
				expect(await mnemonicRows(noneFixture)).toEqual({ count: 0, rows: [] });
			},
			S10_DB_TEST_TIMEOUT_MS
		);
	}
);

async function createFixture(imageMode: "none" | "ai" = "none"): Promise<Fixture> {
	if (database === undefined) throw new Error("S14_TEST_DATABASE_URL is required");
	const marker = `s14-${randomUUID()}`;
	const ownerDeckId = randomUUID();
	const otherDeckId = randomUUID();
	const clientId = randomUUID();
	const sessionId = randomUUID();
	const reservationKey = `${marker}-reservation`;
	const idempotencyKey = `${marker}-idem`;
	await database.execute(`
		INSERT INTO public.decks(id,owner_user_id,name)
		VALUES
			('${ownerDeckId}'::uuid,'${S10_ACTORS.ownerA.userId}'::uuid,${sqlLiteral(`${marker} owner`)}),
			('${otherDeckId}'::uuid,'${S10_ACTORS.ownerB.userId}'::uuid,${sqlLiteral(`${marker} other`)});
	`);
	const requestResult = await validateImportRequest({
		deck: { id: ownerDeckId },
		items: [
			{
				clientItemId: `${marker}-item`,
				conceptId: `${marker}-concept`,
				pattern: "R1",
				front: `${marker} 漢`,
				back: "かん",
				tags: ["s14tag"],
				image: { mode: imageMode },
			},
		],
	});
	if (!requestResult.success) throw new Error(`fixture request failed: ${requestResult.code}`);
	const request = requestResult.data;
	const importRequestHash = await hashImportRequest(request);
	const generationRequestHash = await deriveRemoteGenerationRequestHash(
		importRequestHash,
		clientId
	);
	const previewToken = await signRemotePreviewToken(
		{
			userId: S10_ACTORS.ownerA.userId,
			clientId,
			reservationKey,
			importRequestHash,
		},
		previewSecret,
		Math.floor(Date.now() / 1000)
	);
	return {
		marker,
		ownerDeckId,
		otherDeckId,
		clientId,
		sessionId,
		request,
		requestJson: normalizedRequestToJson(request),
		importRequestHash,
		generationRequestHash,
		reservationKey,
		idempotencyKey,
		previewToken,
	};
}

interface DailyStudyStatusFixture {
	readonly ownerCardId: string;
	readonly otherCardId: string;
}

interface DailyStudyStatusSourceRows {
	readonly deckIds: readonly string[];
	readonly cardIds: readonly string[];
	readonly reviewUsers: readonly string[];
}

async function insertDailyStudyStatusFixture(fixture: Fixture): Promise<DailyStudyStatusFixture> {
	if (database === undefined) throw new Error("S14_TEST_DATABASE_URL is required");
	const ownerCardId = randomUUID();
	const otherCardId = randomUUID();
	await database.execute(`
		INSERT INTO public.cards(
			id,owner_user_id,visibility,skill,pattern,front_text,back_text,card_key
		) VALUES
			(
				'${ownerCardId}'::uuid,'${S10_ACTORS.ownerA.userId}'::uuid,'private',
				'reading','R1',${sqlLiteral(`${fixture.marker} owner daily`)},'おーなー',
				'${hash(`${fixture.marker}-owner-daily`)}'
			),
			(
				'${otherCardId}'::uuid,'${S10_ACTORS.ownerB.userId}'::uuid,'private',
				'reading','R1',${sqlLiteral(`${fixture.marker} other daily`)},'ほか',
				'${hash(`${fixture.marker}-other-daily`)}'
			);
		INSERT INTO public.deck_cards(deck_id,card_id)
		VALUES
			('${fixture.ownerDeckId}'::uuid,'${ownerCardId}'::uuid),
			('${fixture.otherDeckId}'::uuid,'${otherCardId}'::uuid);
		INSERT INTO public.review_states(
			user_id,card_id,level,due_date,last_rating,retry_today_count,last_reviewed_at
		) VALUES
			(
				'${S10_ACTORS.ownerA.userId}'::uuid,'${ownerCardId}'::uuid,2,'2026-07-27',
				'good',0,'2026-07-25T15:00:00.000Z'::timestamptz
			),
			(
				'${S10_ACTORS.ownerB.userId}'::uuid,'${otherCardId}'::uuid,0,'2026-07-26',
				NULL,0,NULL
			);
	`);
	return { ownerCardId, otherCardId };
}

function dailyStudyStatusSourceSql(fixture: Fixture): string {
	return `WITH actor_decks AS (
			SELECT id
			FROM public.decks
			WHERE owner_user_id = auth.uid()
				AND id IN ('${fixture.ownerDeckId}'::uuid, '${fixture.otherDeckId}'::uuid)
		),
		actor_deck_cards AS (
			SELECT deck_id, card_id
			FROM public.deck_cards
			WHERE deck_id IN (SELECT id FROM actor_decks)
		),
		actor_review_states AS (
			SELECT user_id, card_id
			FROM public.review_states
			WHERE user_id = auth.uid()
				AND card_id IN (SELECT card_id FROM actor_deck_cards)
		)
		SELECT json_build_object(
			'deckIds', COALESCE((SELECT json_agg(id ORDER BY id) FROM actor_decks), '[]'::json),
			'cardIds', COALESCE((SELECT json_agg(card_id ORDER BY card_id) FROM actor_deck_cards), '[]'::json),
			'reviewUsers', COALESCE((SELECT json_agg(user_id ORDER BY user_id) FROM actor_review_states), '[]'::json)
		) AS result`;
}

function previewSql(fixture: Fixture, deckId = fixture.ownerDeckId): string {
	return `SELECT public.s14_remote_validate_import_preview(
		${sqlLiteral(fixture.clientId)},
		${sqlLiteral(fixture.sessionId)},
		'${deckId}'::uuid,
		${sqlLiteral(fixture.reservationKey)},
		'${fixture.importRequestHash}',
		ARRAY[]::uuid[],
		${sqlLiteral(
			JSON.stringify(
				fixture.request.items.map((item) => ({
					clientItemId: item.clientItemId,
					cardKey: item.cardKey,
				}))
			)
		)}::jsonb
	) AS result`;
}

function commitSql(
	fixture: Fixture,
	overrides: Partial<{
		clientId: string;
		importRequestHash: string;
		generationRequestHash: string;
		previewToken: string;
		/** S-21: omitted keeps the pre-S-21 eight-argument call (p_mnemonics defaults to NULL). */
		mnemonics: readonly unknown[];
	}> = {}
): string {
	const clientId = overrides.clientId ?? fixture.clientId;
	const importRequestHash = overrides.importRequestHash ?? fixture.importRequestHash;
	const generationRequestHash = overrides.generationRequestHash ?? fixture.generationRequestHash;
	const previewToken = overrides.previewToken ?? fixture.previewToken;
	const mnemonics =
		overrides.mnemonics === undefined
			? ""
			: `,\n\t\t${sqlLiteral(JSON.stringify(overrides.mnemonics))}::jsonb`;
	return `SELECT public.s14_remote_commit_import(
		${sqlLiteral(clientId)},
		${sqlLiteral(fixture.sessionId)},
		${sqlLiteral(fixture.idempotencyKey)},
		'${importRequestHash}',
		'${generationRequestHash}',
		${sqlLiteral(previewToken)},
		${sqlLiteral(JSON.stringify(fixture.requestJson))}::jsonb,
		${sqlLiteral(fixture.reservationKey)}${mnemonics}
	) AS result`;
}

/** S-21: the owner-visible card_mnemonics rows this fixture's concept can own. */
async function mnemonicRows(
	fixture: Fixture,
	options: RemoteOptions = {}
): Promise<{
	readonly count: number;
	readonly rows: readonly {
		readonly ownerUserId: string;
		readonly illustrationKey: string;
		readonly status: string;
		readonly story: string;
	}[];
}> {
	return await remoteQuery(
		fixture,
		`SELECT json_build_object(
			'count', count(*)::int,
			'rows', COALESCE(json_agg(json_build_object(
				'ownerUserId', mnemonics.owner_user_id,
				'illustrationKey', mnemonics.illustration_key,
				'status', mnemonics.status,
				'story', mnemonics.slots ->> 'story'
			) ORDER BY mnemonics.illustration_key), '[]'::json)
		) AS result
		FROM public.card_mnemonics AS mnemonics
		WHERE mnemonics.illustration_key LIKE 's11:%:' || ${sqlLiteral(
			hash(fixture.request.items[0]?.conceptId ?? "")
		)}`,
		options
	);
}

function statusSql(
	fixture: Fixture,
	input: Readonly<{ batchId?: string; idempotencyKey?: string }>
): string {
	return `SELECT public.s14_remote_get_import_status(
		${sqlLiteral(fixture.clientId)},
		${sqlLiteral(fixture.sessionId)},
		${input.batchId === undefined ? "NULL" : `'${input.batchId}'::uuid`},
		${input.idempotencyKey === undefined ? "NULL" : sqlLiteral(input.idempotencyKey)}
	) AS result`;
}

async function markerState(fixture: Fixture) {
	return await superQuery<{
		reservations: number;
		reservationUnits: number | null;
		batches: number;
		batchSource: string | null;
		items: number;
		jobs: number;
		cards: number;
	}>(`SELECT json_build_object(
		'reservations', (SELECT count(*)::int FROM public.ai_quota_reservations WHERE reservation_key=${sqlLiteral(fixture.reservationKey)}),
		'reservationUnits', (SELECT coalesce(sum(units),0)::int FROM public.ai_quota_reservations WHERE reservation_key=${sqlLiteral(fixture.reservationKey)}),
		'batches', (SELECT count(*)::int FROM public.ai_import_batches WHERE idempotency_key=${sqlLiteral(fixture.idempotencyKey)}),
		'batchSource', (SELECT source FROM public.ai_import_batches WHERE idempotency_key=${sqlLiteral(fixture.idempotencyKey)} LIMIT 1),
		'items', (SELECT count(*)::int FROM public.ai_import_items WHERE client_item_id=${sqlLiteral(fixture.request.items[0]?.clientItemId ?? "")}),
		'jobs', (SELECT count(*)::int FROM public.ai_import_concept_jobs WHERE concept_id=${sqlLiteral(fixture.request.items[0]?.conceptId ?? "")}),
		'cards', (SELECT count(*)::int FROM public.cards WHERE front_text LIKE ${sqlLiteral(`${fixture.marker}%`)})
	) AS result`);
}

async function insertManagedCardFixture(fixture: Fixture, cardId: string): Promise<void> {
	if (database === undefined) throw new Error("S14_TEST_DATABASE_URL is required");
	const batchId = randomUUID();
	const itemId = randomUUID();
	await database.execute(`
		INSERT INTO public.cards(
			id,owner_user_id,visibility,skill,pattern,front_text,back_text,card_key
		) VALUES(
			'${cardId}'::uuid,'${S10_ACTORS.ownerA.userId}'::uuid,'private',
			'reading','R1',${sqlLiteral(`${fixture.marker} 旧`)},'きゅう','${hash(`${fixture.marker}-old`)}'
		);
		INSERT INTO public.ai_import_batches(
			id,owner_user_id,source,target_deck_id,status,idempotency_key,
			import_request_hash,requested_card_count,requested_image_count,finalized_count,failed_count,completed_at
		) VALUES(
			'${batchId}'::uuid,'${S10_ACTORS.ownerA.userId}'::uuid,'remote_mcp','${fixture.ownerDeckId}'::uuid,
			'completed',${sqlLiteral(`${fixture.marker}-managed`)},'${hash(`${fixture.marker}-managed`)}',
			1,0,1,0,statement_timestamp()
		);
		INSERT INTO public.ai_import_items(
			id,owner_user_id,batch_id,client_item_id,concept_id,ordinal,pattern,skill,
			front_text,back_text,card_key,image_mode,status,result_card_id,finalized_at
		) VALUES(
			'${itemId}'::uuid,'${S10_ACTORS.ownerA.userId}'::uuid,'${batchId}'::uuid,
			${sqlLiteral(`${fixture.marker}-managed-item`)},${sqlLiteral(`${fixture.marker}-managed-concept`)},
			0,'R1','reading',${sqlLiteral(`${fixture.marker} 旧`)},'きゅう',
			'${hash(`${fixture.marker}-managed-card`)}','none','finalized','${cardId}'::uuid,statement_timestamp()
		);
		INSERT INTO public.deck_cards(deck_id,card_id)
		VALUES('${fixture.ownerDeckId}'::uuid,'${cardId}'::uuid);
	`);
}

async function remoteQuery<T>(
	fixture: Fixture,
	query: string,
	options: RemoteOptions = {}
): Promise<T> {
	const rows = await runJsonQuery<T>(`${remoteSettings(fixture, options)}
		WITH result_row AS (${query.trim().replace(/;\s*$/u, "")})
		SELECT COALESCE(json_agg((result_row.result)::json), '[]'::json)::text FROM result_row;`);
	if (rows.length !== 1) throw new Error("remote query returned an unexpected row count");
	return rows[0] as T;
}

async function remoteExecute(
	fixture: Fixture,
	statement: string,
	options: RemoteOptions = {}
): Promise<void> {
	if (verifiedIsolatedDatabaseUrl === undefined)
		throw new Error("S14_TEST_DATABASE_URL is required");
	await runS10Psql(
		verifiedIsolatedDatabaseUrl,
		`BEGIN; ${remoteSettings(fixture, options)} ${statement}; COMMIT;`
	);
}

async function superQuery<T>(query: string): Promise<T> {
	const rows = await runJsonQuery<T>(`
		WITH result_row AS (${query.trim().replace(/;\s*$/u, "")})
		SELECT COALESCE(json_agg((result_row.result)::json), '[]'::json)::text FROM result_row;`);
	if (rows.length !== 1) throw new Error("super query returned an unexpected row count");
	return rows[0] as T;
}

async function runJsonQuery<T>(sql: string): Promise<T[]> {
	if (verifiedIsolatedDatabaseUrl === undefined)
		throw new Error("S14_TEST_DATABASE_URL is required");
	const output = await runS10Psql(verifiedIsolatedDatabaseUrl, `BEGIN; ${sql}; COMMIT;`);
	return JSON.parse(output.trim()) as T[];
}

async function remoteError(fixture: Fixture, statement: string, options: RemoteOptions = {}) {
	return await captureSqlError(`${remoteSettings(fixture, options)} ${statement};`);
}

async function captureSqlError(statement: string) {
	if (database === undefined) throw new Error("S14_TEST_DATABASE_URL is required");
	return await database.captureError(statement);
}

interface RemoteOptions {
	readonly ownerUserId?: string;
	readonly clientId?: string;
	readonly sessionId?: string;
	readonly dbPreviewSecret?: boolean;
}

function remoteSettings(fixture: Fixture, options: RemoteOptions): string {
	const ownerUserId = options.ownerUserId ?? S10_ACTORS.ownerA.userId;
	const clientId = options.clientId ?? fixture.clientId;
	const sessionId = options.sessionId ?? fixture.sessionId;
	return `
		SET LOCAL ROLE authenticated;
		SET LOCAL request.jwt.claim.role = '';
		SET LOCAL request.jwt.claim.sub = '';
		SET LOCAL request.jwt.claims = ${sqlLiteral(
			JSON.stringify({
				role: "authenticated",
				sub: ownerUserId,
				client_id: clientId,
				session_id: sessionId,
			})
		)};
		${
			options.dbPreviewSecret === false
				? ""
				: `SET LOCAL app.ai_preview_hmac_secret = ${sqlLiteral(previewSecret)};`
		}
	`;
}
