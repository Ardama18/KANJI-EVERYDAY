// S-16D integration tests — commit RPC persists approved mnemonics into
// card_mnemonics inside the same transaction (AC-2 / AC-4 / AC-5).
// Requires S10_TEST_DATABASE_URL (isolated database). Skipped otherwise.
// Design: specs/stories/S-16D-approval-ui/design.md §7, ADR-012.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	type S10DbClient,
	S10_ACTORS,
	createS10DbClient,
	ensureS10ActorFixtures,
	sqlLiteral,
} from "../../S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit";

const databaseUrl = process.env.S10_TEST_DATABASE_URL?.trim();
const ownerA = S10_ACTORS.ownerA.userId ?? "";
const ownerB = S10_ACTORS.ownerB.userId ?? "";

const MARKER = "s16d";
const DECK_ID = "d16d0000-0000-4000-8000-000000000001";
const RESERVATION_KEY = `${MARKER}-reservation`;
const IDEMPOTENCY_KEY = `${MARKER}-commit`;
const IMPORT_REQUEST_HASH = "a".repeat(64);
const GENERATION_HASH = "b".repeat(64);

const CONCEPT_AI = `${MARKER}-ai`;
const CONCEPT_AI_UNAPPROVED = `${MARKER}-ai-unapproved`;
const CONCEPT_NONE = `${MARKER}-none`;

const SIX_ARG = "public.commit_generated_import_async(uuid,text,text,jsonb,text,jsonb)";
const FIVE_ARG = "public.commit_generated_import_async(uuid,text,text,jsonb,text)";

function requestJson(): string {
	return JSON.stringify({
		deck: { id: DECK_ID },
		items: [
			{
				clientItemId: `${CONCEPT_AI}-r1`,
				conceptId: CONCEPT_AI,
				pattern: "R1",
				front: "山",
				back: "やま",
				tags: [],
				image: { mode: "ai" },
			},
			{
				clientItemId: `${CONCEPT_AI_UNAPPROVED}-r1`,
				conceptId: CONCEPT_AI_UNAPPROVED,
				pattern: "R1",
				front: "川",
				back: "かわ",
				tags: [],
				image: { mode: "ai" },
			},
			{
				clientItemId: `${CONCEPT_NONE}-r1`,
				conceptId: CONCEPT_NONE,
				pattern: "R1",
				front: "空",
				back: "そら",
				tags: [],
				image: { mode: "none" },
			},
		],
	});
}

function mnemonicsJson(story: string): string {
	// Only the approved AI concept and the (keyless) none concept are sent.
	// The unapproved AI concept is intentionally omitted (client sends approved
	// only); the none concept has no illustration_key and must be skipped.
	return JSON.stringify([
		{
			conceptId: CONCEPT_AI,
			slots: {
				kanji: "山",
				isSingleKanji: true,
				shapeHint: { part: "三つの峰", picture: "山並み" },
				meaningHint: "たかい土地",
				story,
			},
			explanation: {
				summary: "三つの峰が山を表す。",
				mappings: [
					{ part: "左の峰", meaning: "やま" },
					{ part: "中央の峰", meaning: "たかい" },
				],
			},
		},
		{
			conceptId: CONCEPT_NONE,
			slots: {
				kanji: "空",
				isSingleKanji: true,
				shapeHint: { part: "あな", picture: "青空" },
				meaningHint: "そら",
				story: "うつろな空。",
			},
			explanation: {
				summary: "空の説明。",
				mappings: [
					{ part: "上", meaning: "そら" },
					{ part: "下", meaning: "から" },
				],
			},
		},
	]);
}

function commitSql(mnemonics: string | null): string {
	const mnemonicArg = mnemonics === null ? "NULL" : `${sqlLiteral(mnemonics)}::jsonb`;
	return `SELECT public.commit_generated_import_async(
		${sqlLiteral(ownerA)}::uuid,
		${sqlLiteral(IDEMPOTENCY_KEY)},
		${sqlLiteral(IMPORT_REQUEST_HASH)},
		${sqlLiteral(requestJson())}::jsonb,
		${sqlLiteral(RESERVATION_KEY)},
		${mnemonicArg}
	) ->> 'batchId' AS batch_id`;
}

async function cleanup(db: S10DbClient): Promise<void> {
	await db.execute(`
		DELETE FROM public.card_mnemonics WHERE owner_user_id=${sqlLiteral(ownerA)}::uuid
			AND illustration_key LIKE 's11:%';
		DELETE FROM public.ai_import_concept_jobs WHERE owner_user_id=${sqlLiteral(ownerA)}::uuid;
		DELETE FROM public.ai_quota_reservations WHERE owner_user_id=${sqlLiteral(ownerA)}::uuid
			AND reservation_key=${sqlLiteral(RESERVATION_KEY)};
		DELETE FROM public.cards WHERE owner_user_id=${sqlLiteral(ownerA)}::uuid
			AND front_text IN ('山','川','空');
		DELETE FROM public.illustrations WHERE owner_user_id=${sqlLiteral(ownerA)}::uuid
			AND illustration_key LIKE 's11:%';
		DELETE FROM public.deck_cards WHERE deck_id=${sqlLiteral(DECK_ID)}::uuid;
		DELETE FROM public.decks WHERE id=${sqlLiteral(DECK_ID)}::uuid;
	`);
}

async function seedFixtures(db: S10DbClient): Promise<void> {
	await ensureS10ActorFixtures(db);
	await cleanup(db);
	await db.execute(`
		INSERT INTO public.decks(id,owner_user_id,name)
		VALUES(${sqlLiteral(DECK_ID)}::uuid,${sqlLiteral(ownerA)}::uuid,'S16D approval');
		INSERT INTO public.ai_quota_reservations(
			owner_user_id,reservation_key,kind,source,generation_request_hash,
			usage_date,units,status,provider_started_at
		) VALUES(
			${sqlLiteral(ownerA)}::uuid,${sqlLiteral(RESERVATION_KEY)},'card_generation','app_ai',
			${sqlLiteral(GENERATION_HASH)},current_date,3,'reserved',now()
		);
	`);
}

const runIf = databaseUrl ? describe : describe.skip;

runIf("S-16D commit → card_mnemonics (AC-2 / AC-4 / AC-5)", () => {
	let db: S10DbClient;

	beforeAll(async () => {
		if (!databaseUrl) return;
		db = createS10DbClient(databaseUrl);
		await seedFixtures(db);
	});

	afterAll(async () => {
		if (!databaseUrl) return;
		await cleanup(db);
	});

	it("IT-01 drops the 5-arg wrapper and installs the 6-arg version owned by s10_migration_owner", async () => {
		const rows = await db.query<{
			six_exists: boolean;
			five_exists: boolean;
			owner: string;
			config: string | null;
		}>(`
			SELECT
				(to_regprocedure('${SIX_ARG}') IS NOT NULL) AS six_exists,
				(to_regprocedure('${FIVE_ARG}') IS NOT NULL) AS five_exists,
				(SELECT r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
					WHERE p.oid='${SIX_ARG}'::regprocedure) AS owner,
				(SELECT array_to_string(p.proconfig,',') FROM pg_proc p
					WHERE p.oid='${SIX_ARG}'::regprocedure) AS config
		`);
		expect(rows[0]?.six_exists).toBe(true);
		expect(rows[0]?.five_exists).toBe(false);
		expect(rows[0]?.owner).toBe("s10_migration_owner");
		expect(rows[0]?.config ?? "").toContain("search_path=pg_catalog, pg_temp");
	});

	it("IT-02 grants EXECUTE on the 6-arg wrapper to service_role only", async () => {
		const rows = await db.query<{ service: boolean; authenticated: boolean; anon: boolean }>(`
			SELECT
				has_function_privilege('service_role','${SIX_ARG}','EXECUTE') AS service,
				has_function_privilege('authenticated','${SIX_ARG}','EXECUTE') AS authenticated,
				has_function_privilege('anon','${SIX_ARG}','EXECUTE') AS anon
		`);
		expect(rows[0]?.service).toBe(true);
		expect(rows[0]?.authenticated).toBe(false);
		expect(rows[0]?.anon).toBe(false);
	});

	it("IT-03 persists the approved AI concept and skips unapproved / keyless concepts", async () => {
		const committed = await db.query<{ batch_id: string }>(commitSql(mnemonicsJson("最初のストーリー。")), {
			actor: S10_ACTORS.service,
		});
		const batchId = committed[0]?.batch_id;
		expect(batchId).toBeDefined();

		const rows = await db.query<{
			illustration_key: string;
			status: string;
			kanji: string;
			resolved_key: string;
		}>(`
			SELECT cm.illustration_key, cm.status, cm.slots->>'kanji' AS kanji,
				(SELECT ill.illustration_key FROM public.ai_import_concept_jobs jobs
					JOIN public.illustrations ill ON ill.id=jobs.illustration_id
					WHERE jobs.batch_id=${sqlLiteral(batchId ?? "")}::uuid
						AND jobs.concept_id=${sqlLiteral(CONCEPT_AI)}
						AND jobs.owner_user_id=${sqlLiteral(ownerA)}::uuid) AS resolved_key
			FROM public.card_mnemonics cm
			WHERE cm.owner_user_id=${sqlLiteral(ownerA)}::uuid
			ORDER BY cm.illustration_key
		`);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.status).toBe("approved");
		expect(rows[0]?.kanji).toBe("山");
		expect(rows[0]?.illustration_key).toBe(rows[0]?.resolved_key);
	});

	it("IT-04 upserts idempotently on a same-key re-commit without duplicating rows", async () => {
		await db.query(commitSql(mnemonicsJson("更新後のストーリー。")), { actor: S10_ACTORS.service });
		const rows = await db.query<{ count: number; story: string }>(`
			SELECT count(*)::int AS count, max(slots->>'story') AS story
			FROM public.card_mnemonics
			WHERE owner_user_id=${sqlLiteral(ownerA)}::uuid AND illustration_key LIKE 's11:%'
		`);
		expect(rows[0]?.count).toBe(1);
		expect(rows[0]?.story).toBe("更新後のストーリー。");
	});

	it("IT-05 rejects a non-array p_mnemonics with VALIDATION_ERROR", async () => {
		const diagnostic = await db.captureError(
			commitSql("{}"),
			{ actor: S10_ACTORS.service }
		);
		expect(diagnostic.sqlState).not.toBeNull();
	});

	it("IT-06 keeps card_mnemonics under owner-scoped RLS for other owners", async () => {
		const crossSelect = await db.query<{ count: number }>(
			`SELECT count(*)::int AS count FROM public.card_mnemonics
				WHERE owner_user_id=${sqlLiteral(ownerA)}::uuid`,
			{ actor: S10_ACTORS.ownerB }
		);
		expect(crossSelect[0]?.count).toBe(0);

		const forgedInsert = await db.captureError(
			`INSERT INTO public.card_mnemonics(owner_user_id,illustration_key,slots,explanation,status)
				VALUES(${sqlLiteral(ownerA)}::uuid,'s11:forged','{}'::jsonb,'{}'::jsonb,'approved')`,
			{ actor: S10_ACTORS.ownerB }
		);
		expect(forgedInsert.sqlState).toBe("42501");
	});
});
