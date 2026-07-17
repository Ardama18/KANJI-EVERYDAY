import type { SafeLogEvent } from "./logger.ts";
import type { IllustrationStorage } from "./storage.ts";
import type { CleanupDatabase } from "./supabase.ts";

export async function runCleanup(input: {
	readonly database: CleanupDatabase;
	readonly storage: IllustrationStorage;
	readonly now: () => Date;
	readonly log: (event: SafeLogEvent) => void;
	readonly limit?: number;
}): Promise<{ readonly claimed: number; readonly deleted: number; readonly retry: number }> {
	const started = input.now().getTime();
	const claims = await input.database.claimCleanup(input.limit ?? 20);
	let deleted = 0;
	let retry = 0;
	for (const claim of claims) {
		try {
			if ((await input.database.verifyCleanup(claim)) === "skip") {
				await input.database.completeCleanup(claim, "retry");
				retry += 1;
				continue;
			}
			const result = await input.storage.deleteObject(claim.bucket, claim.path);
			if (result.kind === "success" || result.kind === "not_found") {
				await input.database.completeCleanup(claim, "deleted");
				deleted += 1;
			} else {
				await input.database.completeCleanup(claim, "retry");
				retry += 1;
			}
		} catch {
			try {
				await input.database.completeCleanup(claim, "retry");
			} catch {
				// A stale claim must not mutate or complete a newer cleanup lease.
			}
			retry += 1;
		}
	}
	input.log({ event: "cleanup", durationMs: Math.max(0, input.now().getTime() - started) });
	return { claimed: claims.length, deleted, retry };
}
