import { z } from "zod";

import { type McpToolResult, createMcpError, createMcpSuccess } from "./error-result";
import { MCP_SCOPES } from "./metadata";

const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const uniqueUuidArray = (maximum: number) =>
	z
		.array(uuid)
		.max(maximum)
		.refine((values) => new Set(values).size === values.length, "ID は重複できません。");
const inputRequest = z
	.object({
		deck: z.object({ id: uuid }).strict(),
		items: z
			.array(
				z
					.object({
						clientItemId: z.string().min(1).max(64),
						conceptId: z.string().min(1).max(64),
						pattern: z.enum(["R1", "W1"]),
						front: z.string().min(1).max(200),
						back: z.string().min(1).max(200),
						tags: z.array(z.string().min(1).max(30)).max(10),
						image: z
							.union([
								z.object({ mode: z.literal("none") }).strict(),
								z.object({ mode: z.literal("ai") }).strict(),
								z.object({ mode: z.literal("upload"), uploadId: uuid }).strict(),
							])
							.refine((image) => image.mode !== "ai", "画像生成は MCP では利用できません。"),
					})
					.strict()
			)
			.min(1)
			.max(50),
	})
	.strict();

const statusInput = z
	.object({ batchId: uuid.optional(), idempotencyKey: z.string().min(1).max(128).optional() })
	.strict()
	.refine(
		(value) => (value.batchId === undefined) !== (value.idempotencyKey === undefined),
		"batchId または idempotencyKey のどちらか一つが必要です。"
	);

const cardPatch = z
	.object({
		content: z
			.object({
				frontText: z.string().min(1).max(200),
				backText: z.string().min(1).max(200),
				skill: z.enum(["reading", "writing"]),
				pattern: z.enum(["R1", "W1"]),
			})
			.strict()
			.optional(),
		deckIds: uniqueUuidArray(100).optional(),
		tagIds: uniqueUuidArray(10).optional(),
		tagNames: z.array(z.string().min(1).max(30)).max(10).optional(),
		illustrationId: uuid.nullable().optional(),
	})
	.strict()
	.refine((value) => Object.keys(value).length > 0, "patch は空にできません。")
	.refine(
		(value) => !(value.tagIds !== undefined && value.tagNames !== undefined),
		"tagIds と tagNames は同時に指定できません。"
	);

export const mcpToolInputSchemas = Object.freeze({
	list_decks: z.object({}).strict(),
	create_deck: z.object({ name: z.string() }).strict(),
	preview_card_import: z.object({ request: inputRequest }).strict(),
	commit_card_import: z
		.object({
			request: inputRequest,
			previewToken: z.string().min(1).max(4096),
			cardReservationKey: z.string().min(1).max(128),
			importRequestHash: z.string().regex(/^[0-9a-f]{64}$/u),
			idempotencyKey: z.string().min(1).max(128),
			confirmedWarnings: z.literal(true),
		})
		.strict(),
	get_import_status: statusInput,
	list_ai_cards: z
		.object({
			limit: z.number().int().min(1).max(100).optional(),
			cursor: z.string().min(1).max(1024).optional(),
			deckId: uuid.optional(),
			tagId: uuid.optional(),
			source: z.enum(["app_ai", "remote_mcp"]).optional(),
			createdFrom: z
				.string()
				.regex(/^\d{4}-\d{2}-\d{2}$/u)
				.optional(),
			createdTo: z
				.string()
				.regex(/^\d{4}-\d{2}-\d{2}$/u)
				.optional(),
		})
		.strict(),
	update_ai_card: z
		.object({ cardId: uuid, expectedUpdatedAt: timestamp, patch: cardPatch })
		.strict(),
	delete_ai_cards: z
		.object({
			cards: z
				.array(z.object({ cardId: uuid, expectedUpdatedAt: timestamp }).strict())
				.min(1)
				.max(100),
		})
		.strict()
		.refine(
			(value) => new Set(value.cards.map((card) => card.cardId)).size === value.cards.length,
			"cardId は重複できません。"
		),
	undo_import_batch: z.object({ batchId: uuid }).strict(),
});

export type McpToolName = keyof typeof mcpToolInputSchemas;

export interface McpToolServices {
	readonly listDecks: () => Promise<unknown>;
	readonly createDeck: (
		input: z.infer<(typeof mcpToolInputSchemas)["create_deck"]>
	) => Promise<unknown>;
	readonly previewCardImport: (
		input: z.infer<(typeof mcpToolInputSchemas)["preview_card_import"]>
	) => Promise<unknown>;
	readonly commitCardImport: (
		input: z.infer<(typeof mcpToolInputSchemas)["commit_card_import"]>
	) => Promise<unknown>;
	readonly getImportStatus: (
		input: z.infer<(typeof mcpToolInputSchemas)["get_import_status"]>
	) => Promise<unknown>;
	readonly listAiCards: (
		input: z.infer<(typeof mcpToolInputSchemas)["list_ai_cards"]>
	) => Promise<unknown>;
	readonly updateAiCard: (
		input: z.infer<(typeof mcpToolInputSchemas)["update_ai_card"]>
	) => Promise<unknown>;
	readonly deleteAiCards: (
		input: z.infer<(typeof mcpToolInputSchemas)["delete_ai_cards"]>
	) => Promise<unknown>;
	readonly undoImportBatch: (
		input: z.infer<(typeof mcpToolInputSchemas)["undo_import_batch"]>
	) => Promise<unknown>;
}

const oauthSecurity = Object.freeze([{ type: "oauth2", scopes: [...MCP_SCOPES] }]);

export const MCP_TOOL_NAMES = Object.freeze([
	"list_decks",
	"create_deck",
	"preview_card_import",
	"commit_card_import",
	"get_import_status",
	"list_ai_cards",
	"update_ai_card",
	"delete_ai_cards",
	"undo_import_batch",
] as const satisfies readonly McpToolName[]);

export const mcpToolDescriptors = Object.freeze({
	list_decks: descriptor("本人所有デッキの一覧", true, false, false),
	create_deck: descriptor("本人所有デッキを作成", false, false, false),
	preview_card_import: descriptor("R1/W1 private card import の事前確認", true, false, false),
	commit_card_import: descriptor("確認済み preview を非同期登録", false, false, false),
	get_import_status: descriptor("非同期 import 状態を取得", true, false, false),
	list_ai_cards: descriptor("AI private card の一覧", true, false, false),
	update_ai_card: descriptor("AI private card を編集", false, false, false),
	delete_ai_cards: descriptor("AI private card を削除", false, true, true),
	undo_import_batch: descriptor("import batch を取り消す", false, true, true),
} satisfies Record<McpToolName, McpToolDescriptor>);

export interface McpToolDescriptor {
	readonly description: string;
	readonly annotations: Readonly<{
		readOnlyHint: boolean;
		destructiveHint: boolean;
		idempotentHint: boolean;
	}>;
	readonly securitySchemes: typeof oauthSecurity;
	readonly _meta: Readonly<{ securitySchemes: typeof oauthSecurity }>;
}

export async function invokeMcpTool(
	name: string,
	input: unknown,
	services: McpToolServices
): Promise<McpToolResult> {
	if (!isMcpToolName(name))
		return createMcpError({ code: "VALIDATION_ERROR", message: "未対応の操作です。" });
	const parsed = mcpToolInputSchemas[name].safeParse(input);
	if (!parsed.success)
		return createMcpError({ code: "VALIDATION_ERROR", message: "入力内容を確認してください。" });
	try {
		const data = await executeKnownTool(name, parsed.data, services);
		if (isFailure(data)) return createMcpError(data.error);
		if (isSuccess(data)) return createMcpSuccess(data.data);
		return createMcpSuccess(data);
	} catch {
		return createMcpError({ code: "INTERNAL_ERROR" });
	}
}

function descriptor(
	description: string,
	readOnlyHint: boolean,
	destructiveHint: boolean,
	idempotentHint: boolean
): McpToolDescriptor {
	return Object.freeze({
		description,
		annotations: Object.freeze({ readOnlyHint, destructiveHint, idempotentHint }),
		securitySchemes: oauthSecurity,
		_meta: Object.freeze({ securitySchemes: oauthSecurity }),
	});
}

async function executeKnownTool(
	name: McpToolName,
	input: unknown,
	services: McpToolServices
): Promise<unknown> {
	switch (name) {
		case "list_decks":
			return await services.listDecks();
		case "create_deck":
			return await services.createDeck(
				input as z.infer<(typeof mcpToolInputSchemas)["create_deck"]>
			);
		case "preview_card_import":
			return await services.previewCardImport(
				input as z.infer<(typeof mcpToolInputSchemas)["preview_card_import"]>
			);
		case "commit_card_import":
			return await services.commitCardImport(
				input as z.infer<(typeof mcpToolInputSchemas)["commit_card_import"]>
			);
		case "get_import_status":
			return await services.getImportStatus(
				input as z.infer<(typeof mcpToolInputSchemas)["get_import_status"]>
			);
		case "list_ai_cards":
			return await services.listAiCards(
				input as z.infer<(typeof mcpToolInputSchemas)["list_ai_cards"]>
			);
		case "update_ai_card":
			return await services.updateAiCard(
				input as z.infer<(typeof mcpToolInputSchemas)["update_ai_card"]>
			);
		case "delete_ai_cards":
			return await services.deleteAiCards(
				input as z.infer<(typeof mcpToolInputSchemas)["delete_ai_cards"]>
			);
		case "undo_import_batch":
			return await services.undoImportBatch(
				input as z.infer<(typeof mcpToolInputSchemas)["undo_import_batch"]>
			);
	}
}

function isMcpToolName(value: string): value is McpToolName {
	return (MCP_TOOL_NAMES as readonly string[]).includes(value);
}

function isFailure(value: unknown): value is Readonly<{ ok: false; error: unknown }> {
	return typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === false;
}

function isSuccess(value: unknown): value is Readonly<{ ok: true; data: unknown }> {
	return typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === true;
}
