export type AiCardImportFocusTarget = "draft" | "status";

interface FocusDocument {
	getElementById(id: string): { focus(): void } | null;
}

export function focusAiCardImportTarget(
	target: AiCardImportFocusTarget,
	documentObject: FocusDocument = document
): void {
	const id = target === "draft" ? "draft-heading" : "import-status-heading";
	documentObject.getElementById(id)?.focus();
}
