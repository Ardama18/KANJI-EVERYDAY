import { isUnicodeScalarText, normalizeDisplayText } from "@/lib/ai-import/normalize";
import type { OpenAiCardGenerationConfig } from "@/lib/env";

import type { MnemonicDraft, MnemonicDraftEntry } from "./contracts";
import { AiCardGenerationError } from "./errors";
import type { MnemonicErrorCode, MnemonicOutcome } from "./mnemonic-outcomes";
import { sanitizeMnemonicExplanation, sanitizeMnemonicSlots } from "./mnemonic-sanitize";
import { moderate } from "./moderation";
import {
	DEVELOPER_POLICY,
	JAPANESE_FIELD_GUIDANCE,
	parseMnemonic,
	parseOpenAiOutputJson,
	readBoundedJson,
} from "./openai-adapter";

/**
 * Single-mnemonic generation for cards that arrive without a mnemonic (S-21 D3).
 *
 * This is deliberately NOT a refactor of `buildResponsesPayload`: that payload
 * generates a whole concept array (kanjiSide / counterpartSide included) from an
 * instruction, while this one takes one already-decided kanji and returns only the
 * mnemonic subtree.  The canonical values that both must agree on — the developer
 * policy, the per-field Japanese guidance, the length caps, mappings 2-4 and the
 * parse rules — are imported from `openai-adapter.ts` rather than restated here.
 *
 * MCP uses lossless per-concept outcomes (Issue #97). Legacy draft-only helpers
 * remain for callers outside that contract. Provider bodies are never exposed.
 */

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_PROVIDER_BODY_BYTES = 1_048_576;

/** Canonical `card_mnemonics.slots.kanji` cap; longer kanji sides are out of scope. */
const MAX_KANJI_CODE_POINTS = 16;

/** Han (CJK ideographs plus the Japanese iteration marks), mirroring `ai-import/schema.ts`. */
const HAN_PATTERN = /\p{Script=Han}/u;

/** Fixed provider concurrency for one MCP commit (S-21 D7). */
export const MNEMONIC_GENERATION_CONCURRENCY = 4;

/** Minimal item shape needed to decide the mnemonic target. */
export interface MnemonicSourceItem {
	readonly conceptId: string;
	readonly pattern: "R1" | "W1";
	readonly front: string;
	readonly back: string;
}

/** Server-derived target. The model never decides these values (S-21 D2 / R-2). */
export interface MnemonicKanjiTarget {
	readonly conceptId: string;
	readonly kanji: string;
	readonly isSingleKanji: boolean;
	readonly meaning: string;
}

export interface MnemonicGenerationInput {
	readonly kanji: string;
	readonly isSingleKanji: boolean;
	readonly meaning: string;
}

export interface MnemonicGenerationLimits {
	/** 0 disables generation entirely (kill switch). */
	readonly maxConcepts: number;
	readonly budgetMs: number;
}

export interface MnemonicResponsesPayload {
	readonly model: string;
	readonly store: false;
	readonly background: false;
	readonly max_output_tokens: 32768;
	readonly input: readonly [
		{
			readonly role: "developer";
			readonly content: readonly [{ readonly type: "input_text"; readonly text: string }];
		},
		{
			readonly role: "user";
			readonly content: readonly [{ readonly type: "input_text"; readonly text: string }];
		},
	];
	readonly text: {
		readonly format: {
			readonly type: "json_schema";
			readonly name: "kanji_card_mnemonic";
			readonly strict: true;
			readonly schema: Readonly<Record<string, unknown>>;
		};
	};
}

/**
 * Maps one import item to its mnemonic target, or `null` when the card is out of
 * scope: `R1` keeps the kanji on `front` and `W1` on `back` (`output-mapper.ts`).
 * Cards without a Han character, or with a kanji side longer than the canonical
 * slots cap, get no mnemonic.
 */
export function deriveKanjiTargetFromItem(item: MnemonicSourceItem): MnemonicKanjiTarget | null {
	if (!isUnicodeScalarText(item.front) || !isUnicodeScalarText(item.back)) return null;
	const kanji = normalizeDisplayText(item.pattern === "R1" ? item.front : item.back);
	const meaning = normalizeDisplayText(item.pattern === "R1" ? item.back : item.front);
	const codePoints = Array.from(kanji);
	if (!HAN_PATTERN.test(kanji) || codePoints.length > MAX_KANJI_CODE_POINTS) return null;
	if (meaning.length === 0) return null;
	return {
		conceptId: item.conceptId,
		kanji,
		isSingleKanji: codePoints.length === 1,
		meaning,
	};
}

/**
 * One target per concept, in first-appearance order.  `R1` wins when a concept has
 * both patterns, matching the representative order `claim_ai_import_concept` uses,
 * so the derived kanji is the same whichever side the worker later reads.
 */
export function deriveKanjiTarget(
	items: readonly MnemonicSourceItem[]
): readonly MnemonicKanjiTarget[] {
	const representatives = new Map<string, MnemonicSourceItem>();
	for (const item of items) {
		const current = representatives.get(item.conceptId);
		if (current === undefined || (current.pattern !== "R1" && item.pattern === "R1")) {
			representatives.set(item.conceptId, item);
		}
	}
	const targets: MnemonicKanjiTarget[] = [];
	for (const item of representatives.values()) {
		const target = deriveKanjiTargetFromItem(item);
		if (target !== null) targets.push(target);
	}
	return targets;
}

export function buildMnemonicResponsesPayload(
	config: OpenAiCardGenerationConfig,
	input: MnemonicGenerationInput
): MnemonicResponsesPayload {
	return {
		model: config.model,
		store: false,
		background: false,
		max_output_tokens: 32768,
		input: [
			{ role: "developer", content: [{ type: "input_text", text: DEVELOPER_POLICY }] },
			{
				role: "user",
				content: [
					{
						type: "input_text",
						text: JSON.stringify({
							kanji: input.kanji,
							isSingleKanji: input.isSingleKanji,
							meaning: input.meaning,
						}),
					},
				],
			},
		],
		text: {
			format: {
				type: "json_schema",
				name: "kanji_card_mnemonic",
				strict: true,
				schema: {
					type: "object",
					additionalProperties: false,
					required: ["slots", "explanation"],
					properties: {
						// kanji / isSingleKanji are intentionally absent: they are inputs, and
						// the parse re-injects the derived values (S-21 D2).
						slots: {
							type: "object",
							additionalProperties: false,
							required: ["shapeHint", "meaningHint", "story"],
							properties: {
								shapeHint: {
									type: "object",
									additionalProperties: false,
									required: ["part", "picture"],
									properties: {
										part: japaneseText(100),
										picture: japaneseText(100),
									},
								},
								meaningHint: japaneseText(100),
								story: japaneseText(100),
							},
						},
						explanation: {
							type: "object",
							additionalProperties: false,
							required: ["summary", "mappings"],
							properties: {
								summary: japaneseText(120),
								mappings: {
									type: "array",
									minItems: 2,
									maxItems: 4,
									items: {
										type: "object",
										additionalProperties: false,
										required: ["part", "meaning"],
										properties: {
											part: japaneseText(100),
											meaning: japaneseText(100),
										},
									},
								},
							},
						},
					},
				},
			},
		},
	};
}

type DraftResult =
	| { readonly ok: true; readonly draft: MnemonicDraft }
	| { readonly ok: false; readonly code: MnemonicErrorCode };

/** No provider body or raw exception crosses this boundary. */
export async function generateMnemonicResult(args: {
	readonly config: OpenAiCardGenerationConfig;
	readonly input: MnemonicGenerationInput;
	readonly fetcher?: typeof fetch;
	readonly signal?: AbortSignal;
}): Promise<DraftResult> {
	const signal = args.signal ?? AbortSignal.timeout(args.config.generationTimeoutMs);
	let response: Response;
	try {
		response = await (args.fetcher ?? fetch)(OPENAI_RESPONSES_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${args.config.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(buildMnemonicResponsesPayload(args.config, args.input)),
			signal,
		});
	} catch {
		return { ok: false, code: signal.aborted ? "MNEMONIC_TIMEOUT" : "MNEMONIC_NETWORK" };
	}
	if (!response.ok) {
		await discardBody(response);
		return {
			ok: false,
			code:
				response.status === 408 || response.status === 429 || response.status >= 500
					? "MNEMONIC_HTTP_TRANSIENT"
					: "MNEMONIC_HTTP_PERMANENT",
		};
	}
	let draft: MnemonicDraft;
	try {
		draft = parseMnemonic(
			parseOpenAiOutputJson(await readBoundedJson(response, MAX_PROVIDER_BODY_BYTES)),
			{
				kanji: args.input.kanji,
				isSingleKanji: args.input.isSingleKanji,
			}
		);
	} catch (error) {
		return {
			ok: false,
			code: signal.aborted
				? "MNEMONIC_TIMEOUT"
				: error instanceof AiCardGenerationError && error.code === "OPENAI_REFUSAL"
					? "MNEMONIC_REFUSED"
					: "MNEMONIC_RESPONSE_INVALID",
		};
	}
	const slots = sanitizeMnemonicSlots(draft.slots);
	const explanation = sanitizeMnemonicExplanation(draft.explanation);
	if (slots === undefined || explanation === undefined)
		return { ok: false, code: "MNEMONIC_VALIDATION_FAILED" };
	return { ok: true, draft: { slots, explanation } };
}

/** Legacy draft-only caller. MCP uses the lossless outcome API below. */
export async function generateMnemonicDraft(args: {
	readonly config: OpenAiCardGenerationConfig;
	readonly input: MnemonicGenerationInput;
	readonly fetcher?: typeof fetch;
}): Promise<MnemonicDraft | null> {
	const result = await generateMnemonicResult(args);
	return result.ok ? result.draft : null;
}

export async function moderateMnemonicResult(
	config: OpenAiCardGenerationConfig,
	draft: MnemonicDraft,
	fetcher?: typeof fetch,
	signal?: AbortSignal
): Promise<{ readonly ok: true } | { readonly ok: false; readonly code: MnemonicErrorCode }> {
	try {
		await moderate({
			config,
			input: { kind: "text", text: serializeMnemonicForModeration(draft) },
			flaggedCode: "OPENAI_OUTPUT_MODERATION",
			fetcher,
			signal,
		});
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			code:
				error instanceof AiCardGenerationError && error.code === "OPENAI_OUTPUT_MODERATION"
					? "MNEMONIC_MODERATION_BLOCKED"
					: "MNEMONIC_MODERATION_UNAVAILABLE",
		};
	}
}

export async function moderateMnemonicDraft(
	config: OpenAiCardGenerationConfig,
	draft: MnemonicDraft,
	fetcher?: typeof fetch
): Promise<boolean> {
	return (await moderateMnemonicResult(config, draft, fetcher)).ok;
}

/** One result per concept, including targets never started due to limits. */
export async function generateMnemonicOutcomes(args: {
	readonly config?: OpenAiCardGenerationConfig;
	readonly items: readonly MnemonicSourceItem[];
	readonly limits: MnemonicGenerationLimits;
	readonly fetcher?: typeof fetch;
	readonly now?: () => number;
}): Promise<readonly MnemonicOutcome[]> {
	const now = args.now ?? Date.now;
	const deadline = now() + args.limits.budgetMs;
	const representatives = new Map<string, MnemonicSourceItem>();
	for (const item of args.items) {
		if (!representatives.has(item.conceptId) || item.pattern === "R1")
			representatives.set(item.conceptId, item);
	}
	const eligible: MnemonicKanjiTarget[] = [];
	const results = new Map<string, MnemonicOutcome>();
	for (const item of representatives.values()) {
		const target = deriveKanjiTargetFromItem(item);
		if (target === null) {
			const kanji = normalizeDisplayText(item.pattern === "R1" ? item.front : item.back);
			results.set(
				item.conceptId,
				HAN_PATTERN.test(kanji)
					? { conceptId: item.conceptId, status: "blocked", code: "MNEMONIC_TARGET_UNSUPPORTED" }
					: { conceptId: item.conceptId, status: "not_required" }
			);
		} else {
			eligible.push(target);
			results.set(item.conceptId, {
				conceptId: item.conceptId,
				status: "blocked",
				code:
					args.limits.maxConcepts <= 0
						? "MNEMONIC_DISABLED"
						: args.config === undefined
							? "MNEMONIC_CONFIG_MISSING"
							: eligible.length > args.limits.maxConcepts
								? "MNEMONIC_LIMIT_EXCEEDED"
								: "MNEMONIC_BUDGET_EXCEEDED",
			});
		}
	}
	const config = args.config;
	if (config === undefined || args.limits.maxConcepts <= 0) return [...results.values()];
	const targets = eligible.slice(0, args.limits.maxConcepts);
	let cursor = 0;
	const worker = async () => {
		for (;;) {
			const target = targets[cursor++];
			if (target === undefined) return;
			const remaining = deadline - now();
			if (remaining <= 0) return;
			const signal = AbortSignal.timeout(
				Math.max(1, Math.min(config.generationTimeoutMs, remaining))
			);
			const draft = await generateMnemonicResult({
				config,
				input: target,
				fetcher: args.fetcher,
				signal,
			});
			if (!draft.ok) {
				results.set(target.conceptId, {
					conceptId: target.conceptId,
					status: "blocked",
					code: now() >= deadline ? "MNEMONIC_BUDGET_EXCEEDED" : draft.code,
				});
				continue;
			}
			const moderationRemaining = deadline - now();
			if (moderationRemaining <= 0) continue;
			const moderation = await moderateMnemonicResult(
				config,
				draft.draft,
				args.fetcher,
				AbortSignal.timeout(Math.max(1, Math.min(config.moderationTimeoutMs, moderationRemaining)))
			);
			results.set(
				target.conceptId,
				moderation.ok
					? { conceptId: target.conceptId, status: "approved", mnemonic: draft.draft }
					: {
							conceptId: target.conceptId,
							status: "blocked",
							code: now() >= deadline ? "MNEMONIC_BUDGET_EXCEEDED" : moderation.code,
						}
			);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(MNEMONIC_GENERATION_CONCURRENCY, targets.length) }, worker)
	);
	return [...results.values()];
}

/** Compatibility projection for draft-only callers; import completion must use lossless outcomes. */
export async function generateApprovedMnemonics(args: {
	readonly config: OpenAiCardGenerationConfig;
	readonly items: readonly MnemonicSourceItem[];
	readonly limits: MnemonicGenerationLimits;
	readonly fetcher?: typeof fetch;
	readonly now?: () => number;
}): Promise<readonly MnemonicDraftEntry[]> {
	const outcomes = await generateMnemonicOutcomes(args);
	return outcomes.flatMap((outcome) =>
		outcome.status === "approved" ? [{ conceptId: outcome.conceptId, ...outcome.mnemonic }] : []
	);
}

/** Same serialization as the app-path output moderation (`generation-service.ts`). */
function serializeMnemonicForModeration(draft: MnemonicDraft): string {
	const { slots, explanation } = draft;
	const mappings = explanation.mappings
		.map((mapping) => `${mapping.part} -> ${mapping.meaning}`)
		.join("\n");
	return `[MNEMONIC 1]\n${slots.kanji}\n${slots.shapeHint.part}\n${slots.shapeHint.picture}\n${slots.meaningHint}\n${slots.story}\n${explanation.summary}\n${mappings}`;
}

function japaneseText(maxLength: number): Readonly<Record<string, unknown>> {
	return {
		type: "string",
		minLength: 1,
		maxLength,
		description: JAPANESE_FIELD_GUIDANCE,
	};
}

async function discardBody(response: Response): Promise<void> {
	try {
		await response.body?.cancel();
	} catch {
		/* the status classification is authoritative */
	}
}
