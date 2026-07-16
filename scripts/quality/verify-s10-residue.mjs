import { createPostgresAdapter, parseSourceDatabaseUrl } from "./quality-database.mjs";

try {
	const { sourceUrl } = parseSourceDatabaseUrl(process.env.S10_ADMIN_DATABASE_URL);
	const names = await createPostgresAdapter().listDatabaseNames(sourceUrl);
	if (names.length !== 0) throw new Error("residue remains");
	process.stdout.write(`${JSON.stringify({ gate: "database-residue", status: "passed", count: 0 })}\n`);
} catch {
	process.stderr.write(`${JSON.stringify({ gate: "database-residue", status: "failed" })}\n`);
	process.exitCode = 1;
}
