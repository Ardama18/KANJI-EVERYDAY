import { parseSourceDatabaseUrl, runCaptured } from "./quality-database.mjs";

try {
	const { sourceUrl } = parseSourceDatabaseUrl(process.env.S10_ADMIN_DATABASE_URL);
	const output = await runCaptured("psql", [
		sourceUrl,
		"-v", "ON_ERROR_STOP=1", "-X", "-A", "-t", "-q", "-c",
		`SELECT
			(SELECT count(*) FROM public.ai_import_batches WHERE owner_user_id='10000000-0000-4000-8000-00000000000a'),
			(SELECT count(*) FROM public.ai_quota_reservations WHERE owner_user_id='10000000-0000-4000-8000-00000000000a'),
			(SELECT count(*) FROM public.ai_usage_daily WHERE owner_user_id='10000000-0000-4000-8000-00000000000a'),
			(SELECT count(*) FROM public.decks WHERE owner_user_id='10000000-0000-4000-8000-00000000000a')`,
	], "source continuity check");
	if (output.trim() !== "0|0|0|0") throw new Error("source continuity failed");
	process.stdout.write(`${JSON.stringify({ gate: "source-continuity", status: "passed", counts: [0, 0, 0, 0] })}\n`);
} catch {
	process.stderr.write(`${JSON.stringify({ gate: "source-continuity", status: "failed" })}\n`);
	process.exitCode = 1;
}
