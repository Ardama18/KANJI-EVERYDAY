import type {
	MnemonicExplanationDraft,
	MnemonicSlotsDraft,
} from "@/lib/ai-card-generation/contracts";

export type AiCardSource = "app_ai" | "remote_mcp";
export type AiCardSkill = "reading" | "writing";
export type AiCardPattern = "R1" | "W1";

export interface AiCardRelationOption {
	readonly id: string;
	readonly name: string;
}

export interface AiCardIllustration {
	readonly id: string;
	readonly status: string;
	/**
	 * Server-signed, expiring URL. Non-null only when the illustration is ready,
	 * owned by the caller, and signing succeeded in the Server Action layer.
	 * The RPC / service layer (shared with Remote MCP) always leaves this null.
	 */
	readonly url: string | null;
}

/**
 * The approved mnemonic behind one `illustration_key`, as read by
 * `list_ai_managed_cards`.  It is keyed by illustration, not by card, so several
 * cards can carry the same row (see `mnemonicSharedCardCount`).
 */
export interface ManagedCardMnemonic {
	readonly slots: MnemonicSlotsDraft;
	readonly explanation: MnemonicExplanationDraft;
	readonly status: "draft" | "approved";
}

export interface ManagedAiCard {
	readonly id: string;
	readonly frontText: string;
	readonly backText: string;
	readonly skill: AiCardSkill;
	readonly pattern: AiCardPattern;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly source: AiCardSource;
	readonly batchId: string;
	readonly itemId: string;
	readonly decks: readonly AiCardRelationOption[];
	readonly tags: readonly AiCardRelationOption[];
	readonly illustration: AiCardIllustration | null;
	readonly illustrationKey: string | null;
	readonly mnemonic: ManagedCardMnemonic | null;
	/** Cards of the caller sharing this `illustration_key`, page-independent; 0 when the key is null. */
	readonly mnemonicSharedCardCount: number;
}

export interface AiCardListFilters {
	readonly limit?: number;
	readonly cursor?: string;
	readonly deckId?: string;
	readonly tagId?: string;
	readonly source?: AiCardSource;
	readonly createdFrom?: string;
	readonly createdTo?: string;
}

export interface AiCardListPage {
	readonly items: readonly ManagedAiCard[];
	readonly nextCursor: string | null;
}

export interface AiCardManagementOptions {
	readonly decks: readonly AiCardRelationOption[];
	readonly tags: readonly AiCardRelationOption[];
}

export type AiCardManagementErrorCode =
	| "DISABLED"
	| "UNAUTHORIZED"
	| "VALIDATION_ERROR"
	| "NOT_FOUND"
	| "ACTIVE_SESSION"
	| "CARD_MODIFIED"
	| "CONFLICT"
	| "INTERNAL_ERROR";

export interface AiCardManagementError {
	readonly code: AiCardManagementErrorCode;
	readonly status: 400 | 401 | 404 | 409 | 500;
	readonly message: string;
	readonly detail?: Readonly<{ sessionId: string; deckId: string }>;
}

export type AiCardActionResult<T> =
	| { readonly ok: true; readonly data: T }
	| { readonly ok: false; readonly error: AiCardManagementError };
