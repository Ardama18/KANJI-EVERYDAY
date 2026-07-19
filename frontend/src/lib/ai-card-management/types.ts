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
	readonly illustrations: readonly { id: string; status: string }[];
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
