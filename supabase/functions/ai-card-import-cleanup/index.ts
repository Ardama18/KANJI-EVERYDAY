import { runCleanup } from "../_shared/ai-card-import/cleanup.ts";
import { handleCleanupRequest } from "../_shared/ai-card-import/cleanup-entrypoint.ts";
import { createSafeLogger } from "../_shared/ai-card-import/logger.ts";
import { createStorageClient } from "../_shared/ai-card-import/storage.ts";
import { createSupabaseDatabase } from "../_shared/ai-card-import/supabase.ts";

Deno.serve(async (request) => {
	const logger = createSafeLogger((line) => console.info(line));
	return await handleCleanupRequest(request, {
		workerSecret: () => Deno.env.get("AI_CARD_WORKER_SECRET"),
		log: logger,
		execute: async () => {
			const supabaseUrl = requiredEnvironment("SUPABASE_URL");
			const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
			return await runCleanup({
			database: createSupabaseDatabase({ supabaseUrl, serviceRoleKey }),
			storage: createStorageClient({ supabaseUrl, serviceRoleKey }),
			now: () => new Date(),
			log: logger,
		});
		},
	});
});

function requiredEnvironment(name: string): string {
	const value = Deno.env.get(name)?.trim();
	if (value === undefined || value.length === 0) throw new Error("INTERNAL_ERROR");
	return value;
}
