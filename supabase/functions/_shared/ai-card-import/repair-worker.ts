import { buildMnemonicPrompt, parseMnemonicSlots } from "../mnemonic-prompt.ts";
import type { ImageCodec } from "./image-codec.ts";
import { normalizeIllustration } from "./image-codec.ts";
import type { ProviderAdapters, ProviderEnvironment } from "./provider.ts";
import { ILLUSTRATION_PROVIDER_TIMEOUT_MS, selectProvider } from "./provider.ts";
import type { IllustrationStorage } from "./storage.ts";
import { sha256Hex } from "./storage.ts";
import type { WorkerOutcome } from "./worker.ts";

export interface RepairDatabase {
	claim(token: string): Promise<unknown>;
	generated(input: {
		repairId: string;
		token: string;
		digest: string;
		width: number;
		height: number;
		promptHash: string;
	}): Promise<void>;
	finalize(repairId: string, token: string): Promise<unknown>;
	fail(repairId: string, token: string, code: string): Promise<void>;
}
const record = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Separate from import finalization: this path never creates cards or alters original batch results. */
export async function processOneRepair(deps: {
	database: RepairDatabase;
	storage: IllustrationStorage;
	codec: ImageCodec;
	providerEnvironment: ProviderEnvironment;
	providers: ProviderAdapters;
	randomUuid: () => string;
}): Promise<WorkerOutcome> {
	const token = deps.randomUuid();
	const row = await deps.database.claim(token);
	if (record(row) && row.outcome === "empty") return "idle";
	if (
		!record(row) ||
		row.outcome !== "claimed" ||
		typeof row.repairId !== "string" ||
		row.token !== token ||
		typeof row.path !== "string"
	)
		throw new Error("RPC_CONTRACT_ERROR");
	const repairId = row.repairId;
	const slots = parseMnemonicSlots(row.slots);
	if (slots === undefined) {
		await deps.database.fail(repairId, token, "MNEMONIC_VALIDATION_FAILED");
		return "failed";
	}
	const prompt = buildMnemonicPrompt(slots);
	try {
		// A durable digest means generation already succeeded; active-session postponement must not regenerate.
		if (typeof row.digest !== "string") {
			const selected = selectProvider(deps.providerEnvironment, deps.providers);
			const image = await selected.provider.generate({
				prompt,
				signal: AbortSignal.timeout(ILLUSTRATION_PROVIDER_TIMEOUT_MS),
			});
			if (image.kind !== "success") {
				await deps.database.fail(repairId, token, image.code);
				return "failed";
			}
			const normalized = await normalizeIllustration(image, deps.codec);
			const digest = await sha256Hex(normalized.bytes);
			const write = await deps.storage.writeIllustration(row.path, normalized.bytes);
			if (write.kind !== "success") {
				// An ambiguous upload may have succeeded. Verify existing bytes; never overwrite a different object.
				const existing = await deps.storage.readIllustration(row.path);
				if (existing === undefined || (await sha256Hex(existing)) !== digest) {
					await deps.database.fail(repairId, token, "OBJECT_CONFLICT");
					return "failed";
				}
			}
			await deps.database.generated({
				repairId,
				token,
				digest,
				width: normalized.width,
				height: normalized.height,
				promptHash: await sha256Hex(new TextEncoder().encode(prompt)),
			});
		} else {
			const existing = await deps.storage.readIllustration(row.path);
			if (existing === undefined || (await sha256Hex(existing)) !== row.digest) {
				await deps.database.fail(repairId, token, "OBJECT_CONFLICT");
				return "failed";
			}
		}
	} catch {
		// Keep ambiguous generated/upload state fenced. A lost lease may not mark an object orphan.
		return "recoverable";
	}
	try {
		const result = await deps.database.finalize(repairId, token);
		if (!record(result)) return "recoverable";
		return result.status === "succeeded"
			? "succeeded"
			: result.status === "conflict"
				? "failed"
				: "blocked";
	} catch {
		return "recoverable";
	}
}

export function createRepairDatabase(input: {
	supabaseUrl: string;
	serviceRoleKey: string;
	fetchImplementation?: typeof fetch;
}): RepairDatabase {
	async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
		const response = await (input.fetchImplementation ?? fetch)(
			`${input.supabaseUrl.replace(/\/$/u, "")}/rest/v1/rpc/${name}`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${input.serviceRoleKey}`,
					apikey: input.serviceRoleKey,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(args),
			}
		);
		if (!response.ok) throw new Error("RPC_CONTRACT_ERROR");
		return response.status === 204 ? undefined : await response.json();
	}
	return {
		claim: (token) => rpc("claim_ai_illustration_repair", { p_claim_token: token }),
		async generated(args) {
			await rpc("mark_ai_repair_generated", {
				p_repair_id: args.repairId,
				p_token: args.token,
				p_digest: args.digest,
				p_width: args.width,
				p_height: args.height,
				p_prompt_hash: args.promptHash,
			});
		},
		finalize: (repairId, token) =>
			rpc("finalize_ai_illustration_repair", { p_repair_id: repairId, p_token: token }),
		async fail(repairId, token, code) {
			await rpc("fail_ai_illustration_repair", {
				p_repair_id: repairId,
				p_token: token,
				p_error_code: code,
			});
		},
	};
}
