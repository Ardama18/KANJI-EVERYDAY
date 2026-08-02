import { readFileSync } from "node:fs";
import { type ReactNode, isValidElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

type RenderedNode = RenderedElement | string;

type RenderedElement = {
	type: string;
	props: Record<string, unknown>;
	children: RenderedNode[];
};

const cleanChildren = (children: ReactNode): ReactNode[] =>
	Array.isArray(children) ? children : children === undefined ? [] : [children];

const renderElementTree = (node: ReactNode): RenderedNode | null => {
	if (node === null || node === undefined || typeof node === "boolean") {
		return null;
	}
	if (typeof node === "string" || typeof node === "number") {
		return String(node);
	}
	if (Array.isArray(node)) {
		return {
			type: "#fragment",
			props: {},
			children: node
				.map(renderElementTree)
				.filter((child): child is RenderedNode => child !== null),
		};
	}
	if (!isValidElement<Record<string, unknown>>(node)) {
		return null;
	}
	if (typeof node.type === "function") {
		const Component = node.type as (props: Record<string, unknown>) => ReactNode;
		return renderElementTree(Component(node.props));
	}
	if (typeof node.type !== "string") {
		return {
			type: "#fragment",
			props: {},
			children: cleanChildren(node.props.children as ReactNode)
				.map(renderElementTree)
				.filter((child): child is RenderedNode => child !== null),
		};
	}
	return {
		type: node.type,
		props: node.props,
		children: cleanChildren(node.props.children as ReactNode)
			.map(renderElementTree)
			.filter((child): child is RenderedNode => child !== null),
	};
};

const findAll = (
	node: RenderedNode | null,
	predicate: (node: RenderedElement) => boolean
): RenderedElement[] => {
	if (node === null || typeof node === "string") {
		return [];
	}
	const own = predicate(node) ? [node] : [];
	return [...own, ...node.children.flatMap((child) => findAll(child, predicate))];
};

const findOne = (
	node: RenderedNode | null,
	predicate: (node: RenderedElement) => boolean
): RenderedElement => {
	const matches = findAll(node, predicate);
	if (matches.length !== 1) {
		throw new Error(`Expected one matching element, received ${matches.length}`);
	}
	return matches[0];
};

const textContent = (node: RenderedNode | null): string => {
	if (node === null) {
		return "";
	}
	if (typeof node === "string") {
		return node;
	}
	return node.children.map(textContent).join("");
};

type HarnessOptions = {
	formState?: { status: "idle" | "success" | "error"; message: string };
	pending?: boolean;
};

const createHarness = async (options: HarnessOptions = {}) => {
	const deleteAction = vi.fn();
	let pending = options.pending ?? false;
	const formState = options.formState ?? { status: "idle" as const, message: "" };
	const stateValues: unknown[] = [];
	let stateIndex = 0;

	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useEffect: (effect: () => void) => {
				effect();
			},
			useId: () => "delete-dialog",
			useRef: () => ({ current: null }),
			useState: <T,>(initialValue: T) => {
				const index = stateIndex;
				stateIndex += 1;
				if (stateValues.length <= index) {
					stateValues[index] = initialValue;
				}
				const setState = (nextValue: T | ((previous: T) => T)) => {
					stateValues[index] =
						typeof nextValue === "function"
							? (nextValue as (previous: T) => T)(stateValues[index] as T)
							: nextValue;
				};
				return [stateValues[index] as T, setState] as const;
			},
		};
	});
	vi.doMock("react-dom", () => ({
		useFormState: () => [formState, deleteAction],
		useFormStatus: () => ({ pending }),
	}));
	vi.doMock("@/actions/deck-actions", () => ({
		deleteDeck: vi.fn(),
	}));
	vi.doMock("@/actions/deck-action-types", () => ({
		DECK_DELETE_ACTION_INITIAL_STATE: { status: "idle", message: "" },
	}));
	vi.stubGlobal("window", {
		setTimeout: (callback: () => void) => {
			callback();
			return 0;
		},
	});

	const { DeleteDeckForm } = await import("./DeleteDeckForm");

	return {
		deleteAction,
		render: () => {
			stateIndex = 0;
			return renderElementTree(<DeleteDeckForm deckId="deck-1" deckName="小学3年生" />);
		},
		setPending: (nextPending: boolean) => {
			pending = nextPending;
		},
	};
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
	vi.restoreAllMocks();
});

describe("frontend/src/components/deck/DeleteDeckForm.tsx", () => {
	it("UT-S29-DELETE-DECK-FORM-CONTRACT: Server Action binding and dialog confirmation guard are present", () => {
		const source = readFileSync(new URL("./DeleteDeckForm.tsx", import.meta.url), "utf8");

		expect(source).toContain("useFormState(deleteDeck");
		expect(source).toContain("DECK_DELETE_ACTION_INITIAL_STATE");
		expect(source).toContain("useFormStatus");
		expect(source).toContain("setIsSubmitting(true)");
		expect(source).toContain("if (isSubmitting)");
		expect(source).toContain("action={formAction}");
		expect(source).toContain('name="deckId"');
		expect(source).toContain("value={deckId}");
		expect(source).not.toContain("window.confirm");
		expect(source).toContain("<dialog");
		expect(source).toContain("open");
		expect(source).toContain('aria-modal="true"');
		expect(source).toContain("aria-labelledby={titleId}");
		expect(source).toContain("aria-describedby={descriptionId}");
		expect(source).toContain('name="confirmationName"');
		expect(source).toContain("confirmationName.trim() === deckName");
		expect(source).toContain("event.preventDefault()");
	});

	it("UT-S29-DELETE-DECK-FORM-STATES: pending disabled, alert, accessible name, and 320px structure are fixed", () => {
		const source = readFileSync(new URL("./DeleteDeckForm.tsx", import.meta.url), "utf8");

		expect(source).toContain("disabled={submitDisabled}");
		expect(source).toContain("aria-disabled={submitDisabled}");
		expect(source).toContain("disabled={isSubmitting}");
		expect(source).toContain("aria-disabled={isSubmitting}");
		expect(source).toContain("disabled={isDeleteInFlight}");
		expect(source).toContain("aria-disabled={isDeleteInFlight}");
		expect(source).toContain("削除中...");
		expect(source).toContain("aria-label={`「${deckName}」を削除`}");
		expect(source).toContain("確認のためデッキ名を入力");
		expect(source).toContain("この操作は元に戻せません");
		expect(source).toContain("カード、復習状態、学習履歴の行は保持されます");
		expect(source).toContain('role="alert"');
		expect(source).toContain("flex-col-reverse");
		expect(source).toContain("h-12");
	});

	it("centers the confirmation dialog in the viewport", async () => {
		const harness = await createHarness();
		(
			findOne(harness.render(), (node) => node.props["aria-label"] === "「小学3年生」を削除").props
				.onClick as () => void
		)();

		const dialog = findOne(harness.render(), (node) => node.type === "dialog");
		const dialogClasses = String(dialog.props.className).split(/\s+/);

		expect(dialogClasses).toContain("m-auto");
		expect(dialogClasses).not.toContain("m-0");
	});

	it("opens the dialog, blocks mismatch submit, allows exact-match submit, and cancels without action", async () => {
		const harness = await createHarness();
		let tree = harness.render();

		expect(findAll(tree, (node) => node.type === "dialog")).toHaveLength(0);
		(
			findOne(tree, (node) => node.props["aria-label"] === "「小学3年生」を削除").props
				.onClick as () => void
		)();
		tree = harness.render();

		expect(findOne(tree, (node) => node.type === "dialog").props.open).toBe(true);
		expect(textContent(tree)).toContain("この操作は元に戻せません");
		const input = findOne(
			tree,
			(node) => node.type === "input" && node.props.name === "confirmationName"
		);
		const submitButton = () =>
			findOne(tree, (node) => node.type === "button" && node.props.type === "submit");
		const form = () => findOne(tree, (node) => node.type === "form");

		expect(submitButton().props.disabled).toBe(true);
		(input.props.onChange as (event: { target: { value: string } }) => void)({
			target: { value: "小学4年生" },
		});
		tree = harness.render();
		expect(submitButton().props.disabled).toBe(true);
		const mismatchSubmit = { preventDefault: vi.fn() };
		(form().props.onSubmit as (event: { preventDefault: () => void }) => void)(mismatchSubmit);
		expect(mismatchSubmit.preventDefault).toHaveBeenCalledOnce();

		harness.deleteAction.mockClear();
		(
			findOne(tree, (node) => node.type === "button" && textContent(node) === "キャンセル").props
				.onClick as () => void
		)();
		tree = harness.render();
		expect(findAll(tree, (node) => node.type === "dialog")).toHaveLength(0);
		expect(harness.deleteAction).not.toHaveBeenCalled();

		(
			findOne(tree, (node) => node.props["aria-label"] === "「小学3年生」を削除").props
				.onClick as () => void
		)();
		tree = harness.render();

		(
			findOne(tree, (node) => node.type === "input" && node.props.name === "confirmationName").props
				.onChange as (event: { target: { value: string } }) => void
		)({
			target: { value: " 小学3年生 " },
		});
		tree = harness.render();
		expect(submitButton().props.disabled).toBe(false);
		const matchedSubmit = { preventDefault: vi.fn() };
		(form().props.onSubmit as (event: { preventDefault: () => void }) => void)(matchedSubmit);
		expect(matchedSubmit.preventDefault).not.toHaveBeenCalled();
		(form().props.action as (formData: FormData) => void)(new FormData());
		expect(harness.deleteAction).toHaveBeenCalledOnce();
	});

	it("disables dialog controls while pending and renders safe errors as an alert", async () => {
		const pendingHarness = await createHarness();
		(
			findOne(pendingHarness.render(), (node) => node.props["aria-label"] === "「小学3年生」を削除")
				.props.onClick as () => void
		)();
		pendingHarness.setPending(true);
		const pendingTree = pendingHarness.render();

		const buttons = findAll(pendingTree, (node) => node.type === "button");
		expect(buttons.find((button) => textContent(button) === "キャンセル")?.props.disabled).toBe(
			true
		);
		const pendingSubmit = buttons.find((button) => button.props.type === "submit");
		expect(pendingSubmit?.props.disabled).toBe(true);
		expect(pendingSubmit?.props["aria-disabled"]).toBe(true);
		expect(textContent(pendingTree)).toContain("削除中...");
		expect(textContent(pendingTree)).toContain("小学3年生");

		const errorHarness = await createHarness({
			formState: { status: "error", message: "デッキを削除できませんでした。" },
		});
		(
			findOne(errorHarness.render(), (node) => node.props["aria-label"] === "「小学3年生」を削除")
				.props.onClick as () => void
		)();
		const errorTree = errorHarness.render();
		const alert = findOne(errorTree, (node) => node.props.role === "alert");
		expect(textContent(alert)).toBe("デッキを削除できませんでした。");
	});

	it("keeps the dialog open and trigger disabled after a valid submit starts", async () => {
		const harness = await createHarness();
		let tree = harness.render();
		(
			findOne(tree, (node) => node.props["aria-label"] === "「小学3年生」を削除").props
				.onClick as () => void
		)();
		tree = harness.render();
		(
			findOne(tree, (node) => node.type === "input" && node.props.name === "confirmationName").props
				.onChange as (event: { target: { value: string } }) => void
		)({
			target: { value: "小学3年生" },
		});
		tree = harness.render();
		const form = findOne(tree, (node) => node.type === "form");

		(form.props.onSubmit as (event: { preventDefault: () => void }) => void)({
			preventDefault: vi.fn(),
		});
		tree = harness.render();

		expect(
			findOne(tree, (node) => node.props["aria-label"] === "「小学3年生」を削除").props.disabled
		).toBe(true);
		expect(
			findOne(tree, (node) => node.type === "button" && textContent(node) === "キャンセル").props
				.disabled
		).toBe(true);
		(
			findOne(tree, (node) => node.type === "button" && textContent(node) === "キャンセル").props
				.onClick as () => void
		)();
		tree = harness.render();
		expect(findAll(tree, (node) => node.type === "dialog")).toHaveLength(1);
		const overlay = findOne(
			tree,
			(node) => node.type === "div" && String(node.props.className).includes("fixed inset-0")
		);
		(overlay.props.onMouseDown as (event: { target: unknown; currentTarget: unknown }) => void)({
			target: overlay,
			currentTarget: overlay,
		});
		tree = harness.render();
		expect(findAll(tree, (node) => node.type === "dialog")).toHaveLength(1);
		(
			findOne(tree, (node) => node.type === "dialog").props.onKeyDown as (event: {
				key: string;
				preventDefault: () => void;
			}) => void
		)({ key: "Escape", preventDefault: vi.fn() });
		tree = harness.render();
		expect(findAll(tree, (node) => node.type === "dialog")).toHaveLength(1);
		expect(textContent(tree)).toContain("削除中...");
	});
});
