import { createSafeLogger } from "../_shared/ai-card-import/logger.ts";
import { createMagickCodec } from "../_shared/ai-card-import/magick-codec.ts";
import { createGeminiProvider } from "../_shared/ai-card-import/providers/gemini.ts";
import { createOpenAiProvider } from "../_shared/ai-card-import/providers/openai.ts";
import { createStorageClient } from "../_shared/ai-card-import/storage.ts";
import { handleWorkerRequest } from "../_shared/ai-card-import/worker-entrypoint.ts";
import { createSupabaseDatabase } from "../_shared/ai-card-import/supabase.ts";
import { processOneConcept } from "../_shared/ai-card-import/worker.ts";

Deno.serve(async (request) => {
	const logger = createSafeLogger((line) => console.info(line));
	return await handleWorkerRequest(request, {
		log: logger,
		workerSecret: () => Deno.env.get("AI_CARD_WORKER_SECRET"),
		execute: async () => {
			const supabaseUrl = requiredEnvironment("SUPABASE_URL");
			const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
			const database = createSupabaseDatabase({ supabaseUrl, serviceRoleKey });
			const storage = createStorageClient({ supabaseUrl, serviceRoleKey });
			const providerEndpoint = optionalEnvironment("ILLUSTRATION_PROVIDER_ENDPOINT");
			const providerEndpointBinding = optionalEnvironment(
				"ILLUSTRATION_PROVIDER_ENDPOINT_BINDING"
			);
			const outcome = await processOneConcept({
				database,
				storage,
				codec: await createMagickCodec(),
				providerEnvironment: {
					ILLUSTRATION_PROVIDER: Deno.env.get("ILLUSTRATION_PROVIDER"),
					ILLUSTRATION_PROVIDER_ENDPOINT: providerEndpoint,
					ILLUSTRATION_PROVIDER_ENDPOINT_BINDING: providerEndpointBinding,
					OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY"),
					OPENAI_IMAGE_MODEL: Deno.env.get("OPENAI_IMAGE_MODEL"),
					GEMINI_API_KEY: Deno.env.get("GEMINI_API_KEY"),
					GEMINI_IMAGE_MODEL: Deno.env.get("GEMINI_IMAGE_MODEL"),
				},
				providers: {
					openai: createOpenAiProvider({
						apiKey: Deno.env.get("OPENAI_API_KEY") ?? "",
						model: Deno.env.get("OPENAI_IMAGE_MODEL") ?? "",
						endpoint: providerEndpoint,
						endpointBinding: providerEndpointBinding,
					}),
					gemini: createGeminiProvider({
						apiKey: Deno.env.get("GEMINI_API_KEY") ?? "",
						model: Deno.env.get("GEMINI_IMAGE_MODEL") ?? "",
						endpoint: providerEndpoint,
						endpointBinding: providerEndpointBinding,
					}),
				},
				now: () => new Date(),
				randomUuid: () => crypto.randomUUID(),
				log: logger,
			});
			return outcome;
		},
	});
});

function requiredEnvironment(name: string): string {
	const value = Deno.env.get(name)?.trim();
	if (value === undefined || value.length === 0) throw new Error("PROVIDER_CONFIG_ERROR");
	return value;
}

function optionalEnvironment(name: string): string | undefined {
	const value = Deno.env.get(name)?.trim();
	return value === undefined || value.length === 0 ? undefined : value;
}
