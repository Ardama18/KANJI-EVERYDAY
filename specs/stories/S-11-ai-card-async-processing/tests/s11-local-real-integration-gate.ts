import { createS11DbClient } from "./helpers/s11-db-testkit";

const databaseUrl = process.env.S11_LOCAL_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("S11_LOCAL_DATABASE_URL is required");
const db = createS11DbClient(databaseUrl);
const ownerId = "18400000-0000-4000-8000-00000000000a";
const uploadId = "18400000-0000-4000-8000-000000000010";
const sourcePath = `${ownerId}/${uploadId}/source`;

await db.execute(`
	SET LOCAL request.jwt.claim.role='service_role';
	INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
	VALUES('${ownerId}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s11-local-race@example.local','not-for-login',now(),'{}','{}',now(),now());
	INSERT INTO public.ai_uploads(id,owner_user_id,upload_key,purpose,storage_path,mime_type,byte_size,status,raw_storage_path,raw_storage_bucket,delete_due_at)
	VALUES('${uploadId}','${ownerId}','source-race','card_illustration','${ownerId}/${uploadId}/raw','image/png',64,'prepared','${ownerId}/${uploadId}/raw','ai-card-sources',clock_timestamp()+interval '1 hour');
	SELECT public.mark_ai_source_write_intent('${ownerId}','${uploadId}','${sourcePath}');
`);

const [winner, staleCleanup] = await Promise.all([
	createS11DbClient(databaseUrl).settle(`
		BEGIN; SET request.jwt.claim.role='service_role';
		SET lock_timeout='2s'; SET statement_timeout='5s';
		SELECT public.mark_ai_source_ready('${ownerId}','${uploadId}','image/png',64,8,8,repeat('a',64));
		SELECT pg_sleep(0.25);
		COMMIT;
	`),
	createS11DbClient(databaseUrl).settle(`
		BEGIN; SET request.jwt.claim.role='service_role';
		SET lock_timeout='2s'; SET statement_timeout='5s';
		SELECT pg_sleep(0.1);
		SELECT public.mark_ai_upload_cleanup('${ownerId}','${uploadId}','${sourcePath}');
		COMMIT;
	`),
]);
if (winner !== null || staleCleanup?.sqlState !== "P1008") {
	throw new Error(
		`source completion race was not serialized to one winner (${JSON.stringify(winner)}/${JSON.stringify(staleCleanup)})`
	);
}
const rows = await db.query<{ status: string }>(
	`SELECT status FROM public.ai_uploads WHERE id='${uploadId}'`
);
if (rows[0]?.status !== "ready") throw new Error("stale cleanup downgraded the ready winner");
await db.execute(`DELETE FROM auth.users WHERE id='${ownerId}'`);
process.stdout.write(
	`${JSON.stringify({ gate: "s11-local-real-integration", status: "passed", boundaries: ["two-session-source-complete-winner-not-downgraded"] })}\n`
);
