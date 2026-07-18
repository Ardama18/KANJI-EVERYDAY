import {
	S10_ACTORS,
	createS10DbClient,
	sqlLiteral,
} from "../../S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit";

const databaseUrl = process.env.S10_TEST_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("S10_TEST_DATABASE_URL is required");

const db = createS10DbClient(databaseUrl);
const ownerId = S10_ACTORS.ownerA.userId;
const otherOwnerId = S10_ACTORS.ownerB.userId;
const deckId = "d1200000-0000-4000-8000-000000000001";
const allowedKey = "s12-real-db-allowed";
const retryKey = "s12-real-db-retry";
const reservationPrefix = "s12-real-db-preview";

if (ownerId === null || otherOwnerId === null) throw new Error("S-12 DB actors must have user IDs");

async function cleanup(): Promise<void> {
	await db.execute(`
		DELETE FROM public.ai_quota_reservations
		WHERE owner_user_id=${sqlLiteral(ownerId)} AND reservation_key LIKE '${reservationPrefix}%';
		DELETE FROM public.deck_cards WHERE deck_id=${sqlLiteral(deckId)};
		DELETE FROM public.decks WHERE id=${sqlLiteral(deckId)};
		DELETE FROM public.cards
		WHERE owner_user_id=${sqlLiteral(ownerId)} AND front_text='S12 real DB duplicate';
		DELETE FROM public.illustrations
		WHERE owner_user_id=${sqlLiteral(ownerId)} AND illustration_key LIKE 's12-real-db-%';
	`);
}

try {
	await cleanup();
	await db.execute(
		`INSERT INTO public.illustrations(owner_user_id,illustration_key)
		 VALUES(${sqlLiteral(ownerId)},${sqlLiteral(allowedKey)})`,
		{ actor: S10_ACTORS.ownerA }
	);
	const pending = await db.query<{ status: string }>(
		`SELECT status FROM public.illustrations
		 WHERE owner_user_id=${sqlLiteral(ownerId)} AND illustration_key=${sqlLiteral(allowedKey)}`
	);
	if (pending[0]?.status !== "pending")
		throw new Error("authenticated pending insert did not use its safe default");

	const forgedPath = await db.captureError(
		`INSERT INTO public.illustrations(owner_user_id,illustration_key,storage_path)
		 VALUES(${sqlLiteral(ownerId)},'s12-real-db-forged',${sqlLiteral(`${ownerId}/forged.png`)})`,
		{ actor: S10_ACTORS.ownerA }
	);
	if (forgedPath.sqlState !== "42501")
		throw new Error("authenticated storage_path forgery was not denied");

	const forgedOwner = await db.captureError(
		`INSERT INTO public.illustrations(owner_user_id,illustration_key)
		 VALUES(${sqlLiteral(otherOwnerId)},'s12-real-db-other-owner')`,
		{ actor: S10_ACTORS.ownerA }
	);
	if (forgedOwner.sqlState !== "42501")
		throw new Error("cross-owner illustration insert was not denied");

	const forgedReady = await db.captureError(
		`UPDATE public.illustrations SET status='ready'
		 WHERE owner_user_id=${sqlLiteral(ownerId)} AND illustration_key=${sqlLiteral(allowedKey)}`,
		{ actor: S10_ACTORS.ownerA }
	);
	if (forgedReady.sqlState !== "P1008")
		throw new Error("authenticated ready transition was not denied");

	await db.execute(`
		INSERT INTO public.illustrations(owner_user_id,illustration_key,status)
		VALUES(${sqlLiteral(ownerId)},${sqlLiteral(retryKey)},'failed')
	`);
	await db.execute(
		`UPDATE public.illustrations SET status='pending'
		 WHERE owner_user_id=${sqlLiteral(ownerId)} AND illustration_key=${sqlLiteral(retryKey)}`,
		{ actor: S10_ACTORS.ownerA }
	);

	await db.execute(`
		INSERT INTO public.decks(id,owner_user_id,name)
		VALUES(${sqlLiteral(deckId)},${sqlLiteral(ownerId)},'S12 real DB gate');
		INSERT INTO public.cards(owner_user_id,visibility,skill,pattern,front_text,back_text,card_key)
		VALUES(${sqlLiteral(ownerId)},'private','reading','R1','S12 real DB duplicate','じゅうふく',repeat('0',64));
		INSERT INTO public.ai_quota_reservations(
			owner_user_id,reservation_key,kind,source,generation_request_hash,
			usage_date,units,status,provider_started_at
		) VALUES
		(${sqlLiteral(ownerId)},'${reservationPrefix}-duplicate','card_generation','app_ai',repeat('a',64),current_date,1,'reserved',now()),
		(${sqlLiteral(ownerId)},'${reservationPrefix}-clean','card_generation','app_ai',repeat('b',64),current_date,1,'reserved',now());
	`);
	const cards = await db.query<{ card_key: string }>(`
		SELECT card_key FROM public.cards
		WHERE owner_user_id=${sqlLiteral(ownerId)} AND front_text='S12 real DB duplicate'
	`);
	const duplicateCardKey = cards[0]?.card_key;
	if (duplicateCardKey === undefined) throw new Error("duplicate fixture card key is missing");

	const duplicate = await db.captureError(
		`SELECT public.validate_ai_import_preview(
			${sqlLiteral(ownerId)},${sqlLiteral(deckId)},'${reservationPrefix}-duplicate',repeat('c',64),
			ARRAY[]::uuid[],jsonb_build_array(jsonb_build_object(
				'clientItemId','item-duplicate','cardKey',${sqlLiteral(duplicateCardKey)}
			))
		)`,
		{ actor: S10_ACTORS.service }
	);
	if (duplicate.sqlState !== "P1002")
		throw new Error("existing private card duplicate was not rejected at preview");

	const clean = await db.query<{ valid: boolean }>(
		`SELECT (public.validate_ai_import_preview(
			${sqlLiteral(ownerId)},${sqlLiteral(deckId)},'${reservationPrefix}-clean',repeat('d',64),
			ARRAY[]::uuid[],jsonb_build_array(jsonb_build_object(
				'clientItemId','item-clean','cardKey',repeat('f',64)
			))
		)->>'valid')::boolean AS valid`,
		{ actor: S10_ACTORS.service }
	);
	if (clean[0]?.valid !== true) throw new Error("non-duplicate preview was rejected");

	process.stdout.write(
		`${JSON.stringify({
			gate: "s12-local-real-db",
			status: "passed",
			boundaries: [
				"illustration-column-privileges-and-rls",
				"failed-to-pending-only-status-transition",
				"preview-existing-private-card-duplicate",
			],
		})}\n`
	);
} finally {
	await cleanup();
}
