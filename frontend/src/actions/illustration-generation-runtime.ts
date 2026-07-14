export type ProcessIllustrationGenerationArgs = {
	illustrationId: string;
	illustrationKey: string;
	backText: string;
	skill: string;
	ownerUserId: string;
};

type ProcessIllustrationGenerationImplementation = (
	args: ProcessIllustrationGenerationArgs
) => Promise<void>;

const defaultProcessIllustrationGenerationImplementation: ProcessIllustrationGenerationImplementation =
	async () => {
		return;
	};

let processIllustrationGenerationImplementation =
	defaultProcessIllustrationGenerationImplementation;

export async function runProcessIllustrationGeneration(
	args: ProcessIllustrationGenerationArgs
): Promise<void> {
	await processIllustrationGenerationImplementation(args);
}

export function __setProcessIllustrationGenerationImplementationForTest(
	implementation: ProcessIllustrationGenerationImplementation
): void {
	processIllustrationGenerationImplementation = implementation;
}

export function __resetProcessIllustrationGenerationImplementationForTest(): void {
	processIllustrationGenerationImplementation = defaultProcessIllustrationGenerationImplementation;
}
