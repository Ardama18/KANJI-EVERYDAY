"use client";

import type {
	IllustrationDisplayStatus,
	MnemonicExplanation as MnemonicExplanationData,
} from "@/actions/session-actions";

type MnemonicExplanationProps = {
	illustrationStatus: IllustrationDisplayStatus;
	explanation: MnemonicExplanationData | null;
};

const TEST_IDS = {
	region: "mnemonic-explanation",
	summary: "mnemonic-explanation-summary",
	mapping: "mnemonic-explanation-mapping",
} as const;

export const shouldRenderMnemonicExplanation = (
	illustrationStatus: IllustrationDisplayStatus,
	explanation: MnemonicExplanationData | null
): explanation is MnemonicExplanationData => illustrationStatus === "ready" && explanation != null;

export function MnemonicExplanation({ illustrationStatus, explanation }: MnemonicExplanationProps) {
	if (!shouldRenderMnemonicExplanation(illustrationStatus, explanation)) {
		return null;
	}

	return (
		<div
			data-testid={TEST_IDS.region}
			className="mt-4 w-full max-w-xs rounded-xl bg-amber-50 px-4 py-3 text-left"
		>
			<p data-testid={TEST_IDS.summary} className="text-sm font-bold text-slate-900">
				{explanation.summary}
			</p>
			{explanation.mappings.length > 0 && (
				<ul className="mt-2 space-y-1">
					{explanation.mappings.map((mapping) => (
						<li
							key={`${mapping.part}:${mapping.meaning}`}
							data-testid={TEST_IDS.mapping}
							className="text-sm text-slate-700"
						>
							{mapping.part}：{mapping.meaning}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
