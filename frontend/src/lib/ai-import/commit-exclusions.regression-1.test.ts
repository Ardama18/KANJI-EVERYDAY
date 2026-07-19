import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("ISSUE-003 regression: committing after generated-card exclusions", () => {
	it("uses the S-12 atomic commit RPC and preserves the originally charged units", async () => {
		const [repository, migration] = await Promise.all([
			readFile(new URL("./app-ai-repository.ts", import.meta.url), "utf8"),
			readFile(
				new URL(
					"../../../../supabase/migrations/20260718000006_commit_generated_import_after_exclusions.sql",
					import.meta.url
				),
				"utf8"
			),
		]);

		expect(repository).toContain('client.rpc("commit_generated_import_async"');
		expect(migration).toContain("charged_units < final_card_count");
		expect(migration).toContain("SET units=final_card_count");
		expect(migration).toContain("SET units=charged_units");
		expect(migration).toContain("pg_advisory_xact_lock");
		expect(migration).toContain("IF FOUND THEN");
		expect(migration).toContain("TO service_role");
		expect(migration).toContain("FROM PUBLIC,anon,authenticated");
	});
});
