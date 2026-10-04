import {
	type MnemonicSourceItem,
	generateMnemonicOutcomes,
} from "@/lib/ai-card-generation/mnemonic-generation";
import {
	type MnemonicOutcome,
	isMnemonicErrorCode,
} from "@/lib/ai-card-generation/mnemonic-outcomes";
import {
	sanitizeMnemonicExplanation,
	sanitizeMnemonicSlots,
} from "@/lib/ai-card-generation/mnemonic-sanitize";
import { mapAiImportError } from "@/lib/ai-import/errors";
import type { OpenAiCardGenerationConfig } from "@/lib/env";
import type { JwtScopedSupabaseClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import type { McpActorContext } from "./auth";

function failure(error: unknown) {
	const mapped = mapAiImportError(error, "mnemonic-recovery");
	return {
		ok: false as const,
		error: { code: mapped.code === "INTERNAL_ERROR" ? "SERVICE_UNAVAILABLE" : mapped.code },
	};
}
function projectResult(value: unknown, repair = false) {
	if (
		!isRecord(value) ||
		typeof value.status !== "string" ||
		![
			"queued",
			"processing",
			"generated",
			"succeeded",
			"failed",
			"conflict",
			"blocked_mnemonic",
		].includes(value.status) ||
		(repair && typeof value.repairId !== "string")
	)
		return unavailable();
	const code = value.errorCode;
	const errorCode =
		isMnemonicErrorCode(code) ||
		[
			"REPAIR_CONFLICT",
			"ACTIVE_SESSION",
			"QUOTA_EXCEEDED",
			"REPAIR_RETRY_EXHAUSTED",
			"PROVIDER_CONFIG_ERROR",
			"PROVIDER_PERMANENT_ERROR",
			"PROVIDER_TRANSIENT_ERROR",
			"OBJECT_CONFLICT",
			"IMAGE_FORMAT_INVALID",
			"IMAGE_DECODE_FAILED",
			"IMAGE_DIMENSIONS_INVALID",
			"IMAGE_TOO_LARGE",
		].includes(String(code))
			? String(code)
			: undefined;
	return {
		ok: true as const,
		data: {
			...(repair ? { repairId: value.repairId } : {}),
			status: value.status,
			...(errorCode ? { errorCode } : {}),
		},
	};
}
const unavailable = () => ({ ok: false as const, error: { code: "SERVICE_UNAVAILABLE" } });
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
function parseItems(value: unknown): MnemonicSourceItem[] | undefined {
	if (!Array.isArray(value) || value.length < 1 || value.length > 2) return undefined;
	const items: MnemonicSourceItem[] = [];
	for (const item of value) {
		if (
			!isRecord(item) ||
			typeof item.conceptId !== "string" ||
			(item.pattern !== "R1" && item.pattern !== "W1") ||
			typeof item.front !== "string" ||
			typeof item.back !== "string"
		)
			return undefined;
		items.push({
			conceptId: item.conceptId,
			pattern: item.pattern,
			front: item.front,
			back: item.back,
		});
	}
	return items;
}

/** Narrow recovery boundary: actors and generation text come only from authenticated DB lookups. */
export function createMnemonicRecoveryServices(
	client: JwtScopedSupabaseClient,
	actor: McpActorContext,
	getConfig: () => OpenAiCardGenerationConfig | undefined,
	isEnabled: () => boolean = () => true
) {
	const actorArgs = { p_client_id: actor.clientId, p_session_id: actor.sessionId };
	return {
		async retryMnemonic(input: { batchId: string; conceptId: string }) {
			if (!isEnabled()) return unavailable();
			const prepared = await client.rpc("s14_remote_prepare_mnemonic_retry", {
				...actorArgs,
				p_batch_id: input.batchId,
				p_concept_id: input.conceptId,
			});
			if (prepared.error !== null) return failure(prepared.error);
			if (!isRecord(prepared.data)) return unavailable();
			const items = parseItems(prepared.data.items);
			if (
				items === undefined ||
				typeof prepared.data.jobId !== "string" ||
				typeof prepared.data.token !== "string"
			)
				return unavailable();
			const outcomes = await generateMnemonicOutcomes({
				config: getConfig(),
				items,
				limits: { maxConcepts: 1, budgetMs: 45_000 },
			});
			const outcome = outcomes[0];
			if (outcome === undefined) return unavailable();
			const completed = await client.rpc("s14_remote_complete_mnemonic_retry", {
				...actorArgs,
				p_job_id: prepared.data.jobId,
				p_token: prepared.data.token,
				p_outcome: JSON.parse(JSON.stringify(outcome)) as Json,
			});
			return completed.error === null ? projectResult(completed.data) : failure(completed.error);
		},
		async repairCardIllustration(input: {
			cardId: string;
			expectedUpdatedAt: string;
			idempotencyKey: string;
		}) {
			if (!isEnabled()) return unavailable();
			const prepared = await client.rpc("s14_remote_prepare_illustration_repair", {
				...actorArgs,
				p_card_id: input.cardId,
				p_expected_updated_at: input.expectedUpdatedAt,
				p_idempotency_key: input.idempotencyKey,
			});
			if (prepared.error !== null) return failure(prepared.error);
			if (!isRecord(prepared.data)) return unavailable();
			const row = prepared.data;
			if (row.status !== "needs_mnemonic") return projectResult(row, true);
			const items = parseItems(row.items);
			if (items === undefined || typeof row.repairId !== "string" || typeof row.token !== "string")
				return unavailable();
			let outcome: MnemonicOutcome | undefined;
			const existing = isRecord(row.mnemonic) ? row.mnemonic : undefined;
			const slots = sanitizeMnemonicSlots(existing?.slots);
			const explanation = sanitizeMnemonicExplanation(existing?.explanation);
			if (slots !== undefined && explanation !== undefined) {
				outcome = {
					conceptId: items[0]?.conceptId ?? "",
					status: "approved" as const,
					mnemonic: { slots, explanation },
				};
			} else {
				outcome = (
					await generateMnemonicOutcomes({
						config: getConfig(),
						items,
						limits: { maxConcepts: 1, budgetMs: 45_000 },
					})
				)[0];
			}
			if (outcome === undefined) return unavailable();
			const completed = await client.rpc("s14_remote_complete_illustration_repair", {
				...actorArgs,
				p_repair_id: row.repairId,
				p_token: row.token,
				p_outcome: JSON.parse(JSON.stringify(outcome)) as Json,
			});
			return completed.error === null
				? projectResult(completed.data, true)
				: failure(completed.error);
		},
	};
}
