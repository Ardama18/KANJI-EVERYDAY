export const MAX_DECK_NAME_LENGTH = 80;

const DECK_NAME_CONTROL_PATTERN = /[\p{Cc}\p{Cf}]/u;

export type DeckNameValidationResult =
	| Readonly<{ ok: true; name: string }>
	| Readonly<{ ok: false; message: string }>;

export type DeckActionState = Readonly<{
	status: "idle" | "success" | "error";
	message: string;
	deck?: Readonly<{ id: string; name: string }>;
}>;

export type DeckStudyLimitActionState = Readonly<{
	status: "idle" | "success" | "error";
	message: string;
}>;

export const DECK_ACTION_INITIAL_STATE: DeckActionState = Object.freeze({
	status: "idle",
	message: "",
});

export const DECK_STUDY_LIMIT_ACTION_INITIAL_STATE: DeckStudyLimitActionState = Object.freeze({
	status: "idle",
	message: "",
});

export function normalizeDeckNameInput(value: unknown): DeckNameValidationResult {
	if (typeof value !== "string") {
		return { ok: false, message: "デッキ名を入力してください。" };
	}

	const name = value.trim();
	if (name.length === 0) {
		return { ok: false, message: "デッキ名を入力してください。" };
	}

	if (Array.from(name).length > MAX_DECK_NAME_LENGTH) {
		return { ok: false, message: `デッキ名は${MAX_DECK_NAME_LENGTH}文字以内で入力してください。` };
	}

	if (DECK_NAME_CONTROL_PATTERN.test(name)) {
		return { ok: false, message: "デッキ名に使用できない文字が含まれています。" };
	}

	return { ok: true, name };
}
