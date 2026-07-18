import type { ClientImportRequestInput } from "@/lib/ai-import/schema";

import type { ImportStatusResponse } from "@/lib/ai-import/async-contract";
import type { PreviewEnvelope } from "./contracts";
import type { AiCardGenerationErrorCode } from "./errors";

export type AiCardUiState =
	| { readonly kind: "editing" }
	| { readonly kind: "generating"; readonly startedAt: number }
	| { readonly kind: "previewDirty"; readonly request: ClientImportRequestInput }
	| {
			readonly kind: "previewValid";
			readonly preview: PreviewEnvelope;
			readonly confirmed: boolean;
	  }
	| { readonly kind: "committing"; readonly preview: PreviewEnvelope }
	| { readonly kind: "tracking"; readonly deckId: string; readonly batchId: string }
	| { readonly kind: "terminal"; readonly result: ImportStatusResponse }
	| { readonly kind: "error"; readonly code: AiCardGenerationErrorCode };

export type AiCardUiEvent =
	| {
			readonly type: "edit" | "exclude" | "reorder" | "tag" | "image";
			readonly request: ClientImportRequestInput;
	  }
	| { readonly type: "confirm"; readonly confirmed: boolean };

export function createPreviewValidState(preview: PreviewEnvelope): AiCardUiState {
	return { kind: "previewValid", preview, confirmed: false };
}

export function aiCardUiReducer(state: AiCardUiState, event: AiCardUiEvent): AiCardUiState {
	if (event.type === "confirm") {
		return state.kind === "previewValid" ? { ...state, confirmed: event.confirmed } : state;
	}
	return { kind: "previewDirty", request: event.request };
}
