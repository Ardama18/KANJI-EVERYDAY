import { getEnvConfig } from "@/lib/env";
import { createServiceRoleClient } from "@/lib/supabase/server";

import { type GenerateIllustrationInput, generateIllustration } from "./gemini-client";
import { generatePrompt } from "./prompt";
import { buildIllustrationStoragePath, uploadIllustration } from "./storage";
import {
	GEMINI_IMAGE_MODEL,
	GEMINI_PROVIDER,
	type GeminiGenerationResult,
	type GeminiModelInfo,
	type GeminiModelInfoFailure,
	type IllustrationSkill,
	type ModelInfoFailureReason,
} from "./types";

type QueryError = {
	message: string;
};

type UpdateResult = {
	error: QueryError | null;
};

type IllustrationsUpdatePayload = {
	status?: string;
	storage_path?: string | null;
	prompt?: string | null;
	model_info?: string | null;
};

type GeneratorSupabaseClient = {
	from: (table: "illustrations") => {
		update: (values: IllustrationsUpdatePayload) => {
			eq: (
				column: "id",
				value: string
			) => {
				eq: (column: "owner_user_id", value: string) => unknown;
			};
		};
	};
};

type EnvConfigForGenerator = {
	geminiApiKey: string | undefined;
};

type NowFunction = () => Date;

export type ProcessIllustrationGenerationInput = {
	illustrationId: string;
	illustrationKey: string;
	backText: string;
	skill: IllustrationSkill;
	ownerUserId: string;
};

export type ProcessIllustrationGenerationDependencies = {
	getEnvConfigFn?: () => EnvConfigForGenerator;
	createServiceRoleClientFn?: () => GeneratorSupabaseClient;
	generatePromptFn?: typeof generatePrompt;
	generateIllustrationFn?: (input: GenerateIllustrationInput) => Promise<GeminiGenerationResult>;
	buildStoragePathFn?: typeof buildIllustrationStoragePath;
	uploadIllustrationFn?: (imageBuffer: Buffer, storagePath: string) => Promise<boolean>;
	now?: NowFunction;
};

const createFailureModelInfo = (params: {
	model: string;
	reason: ModelInfoFailureReason;
	now: NowFunction;
	httpStatus?: number;
	requestId?: string;
}): GeminiModelInfoFailure => ({
	provider: GEMINI_PROVIDER,
	model: params.model,
	outcome: "failed",
	reason: params.reason,
	httpStatus: params.httpStatus,
	requestId: params.requestId,
	timestamp: params.now().toISOString(),
});

const serializeModelInfo = (modelInfo: GeminiModelInfo): string => JSON.stringify(modelInfo);

const asGeneratorSupabaseClient = (client: unknown): GeneratorSupabaseClient =>
	client as GeneratorSupabaseClient;

const updateIllustration = async (params: {
	supabase: GeneratorSupabaseClient;
	input: ProcessIllustrationGenerationInput;
	values: IllustrationsUpdatePayload;
}): Promise<void> => {
	const queryResult = await params.supabase
		.from("illustrations")
		.update(params.values)
		.eq("id", params.input.illustrationId)
		.eq("owner_user_id", params.input.ownerUserId);
	const { error } = queryResult as UpdateResult;

	if (error) {
		throw new Error(`illustrations update failed: ${error.message}`);
	}
};

const updateAsFailed = async (params: {
	supabase: GeneratorSupabaseClient;
	input: ProcessIllustrationGenerationInput;
	prompt: string;
	modelInfo: GeminiModelInfoFailure;
}): Promise<void> =>
	updateIllustration({
		supabase: params.supabase,
		input: params.input,
		values: {
			status: "failed",
			prompt: params.prompt,
			model_info: serializeModelInfo(params.modelInfo),
		},
	});

export const processIllustrationGeneration = async (
	input: ProcessIllustrationGenerationInput,
	dependencies: ProcessIllustrationGenerationDependencies = {}
): Promise<void> => {
	const getEnvConfigFn = dependencies.getEnvConfigFn ?? getEnvConfig;
	const createServiceRoleClientFn =
		dependencies.createServiceRoleClientFn ?? createServiceRoleClient;
	const generatePromptFn = dependencies.generatePromptFn ?? generatePrompt;
	const generateIllustrationFn = dependencies.generateIllustrationFn ?? generateIllustration;
	const buildStoragePathFn = dependencies.buildStoragePathFn ?? buildIllustrationStoragePath;
	const uploadIllustrationFn = dependencies.uploadIllustrationFn ?? uploadIllustration;
	const now = dependencies.now ?? (() => new Date());

	const supabase = asGeneratorSupabaseClient(createServiceRoleClientFn());
	const prompt = generatePromptFn(input.backText, input.skill);
	const apiKey = getEnvConfigFn().geminiApiKey?.trim();

	if (!apiKey) {
		await updateAsFailed({
			supabase,
			input,
			prompt,
			modelInfo: createFailureModelInfo({
				model: GEMINI_IMAGE_MODEL,
				reason: "api_key_missing",
				now,
			}),
		});
		return;
	}

	let generationResult: GeminiGenerationResult;
	try {
		generationResult = await generateIllustrationFn({
			prompt,
			apiKey,
		});
	} catch {
		generationResult = {
			ok: false,
			imageBuffer: null,
			modelInfo: createFailureModelInfo({
				model: GEMINI_IMAGE_MODEL,
				reason: "unknown",
				now,
			}),
		};
	}

	if (!generationResult.ok) {
		await updateAsFailed({
			supabase,
			input,
			prompt,
			modelInfo: generationResult.modelInfo,
		});
		return;
	}

	const storagePath = buildStoragePathFn(input.ownerUserId, input.illustrationId);
	let uploaded = false;
	try {
		uploaded = await uploadIllustrationFn(generationResult.imageBuffer, storagePath);
	} catch {
		uploaded = false;
	}

	if (!uploaded) {
		await updateAsFailed({
			supabase,
			input,
			prompt,
			modelInfo: createFailureModelInfo({
				model: generationResult.modelInfo.model,
				reason: "storage_upload_failed",
				httpStatus: generationResult.modelInfo.httpStatus,
				requestId: generationResult.modelInfo.requestId,
				now,
			}),
		});
		return;
	}

	await updateIllustration({
		supabase,
		input,
		values: {
			status: "ready",
			storage_path: storagePath,
			prompt,
			model_info: serializeModelInfo(generationResult.modelInfo),
		},
	});
};
