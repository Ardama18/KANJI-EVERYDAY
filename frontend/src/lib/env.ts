type RequiredEnvKey =
	| "NEXT_PUBLIC_SUPABASE_URL"
	| "NEXT_PUBLIC_SUPABASE_ANON_KEY"
	| "SUPABASE_SERVICE_ROLE_KEY";
type OptionalEnvKey = "GEMINI_API_KEY";
type RouteSecretEnvKey = "AI_PREVIEW_HMAC_SECRET" | "OPENAI_API_KEY";

export type OpenAiImageDetail = "low" | "high" | "auto";

export interface OpenAiCardGenerationConfig {
	readonly apiKey: string;
	readonly model: string;
	readonly moderationModel: "omni-moderation-latest";
	readonly imageDetail: OpenAiImageDetail;
	readonly generationTimeoutMs: number;
	readonly moderationTimeoutMs: number;
}

export type EnvConfig = {
	supabaseUrl: string;
	supabaseAnonKey: string;
	supabaseServiceRoleKey: string;
	geminiApiKey: string | undefined;
	nodeEnv: string | undefined;
};

export interface PublicEnvConfig {
	readonly supabaseUrl: string;
	readonly supabaseAnonKey: string;
}

export interface McpEnvConfig {
	readonly enabled: boolean;
	readonly publicOrigin: string;
	readonly oauthIssuer: string;
	readonly allowedOrigins: readonly string[];
}

export interface McpAutoMnemonicConfig {
	readonly maxConcepts: number;
	readonly budgetMs: number;
}

const REQUIRED_ENV_KEYS: RequiredEnvKey[] = [
	"NEXT_PUBLIC_SUPABASE_URL",
	"NEXT_PUBLIC_SUPABASE_ANON_KEY",
	"SUPABASE_SERVICE_ROLE_KEY",
];

const formatMissingEnvError = (missingKeys: readonly RequiredEnvKey[]) =>
	`Missing required environment variables: ${missingKeys.join(", ")}`;

const getOptionalEnv = (key: OptionalEnvKey): string | undefined => {
	const value = process.env[key];

	if (value === undefined) {
		return undefined;
	}

	const trimmedValue = value.trim();

	return trimmedValue.length > 0 ? trimmedValue : undefined;
};

const getRouteSecret = (key: RouteSecretEnvKey): string | undefined => {
	const value = process.env[key]?.trim();
	return value === undefined || value.length === 0 ? undefined : value;
};

export function getAiPreviewHmacSecret(): string | undefined {
	return getRouteSecret("AI_PREVIEW_HMAC_SECRET");
}

export function getMcpEnvConfig(): McpEnvConfig {
	return {
		enabled: isMcpEnabled(),
		publicOrigin: parseMcpOrigin("MCP_PUBLIC_ORIGIN", process.env.MCP_PUBLIC_ORIGIN),
		oauthIssuer: parseMcpIssuer(process.env.MCP_OAUTH_ISSUER),
		allowedOrigins: parseMcpOrigins("MCP_ALLOWED_ORIGIN", process.env.MCP_ALLOWED_ORIGIN),
	};
}

export function isMcpEnabled(): boolean {
	return process.env.MCP_ENABLED?.trim() === "true";
}

export function isAiCardImportEnabled(): boolean {
	return process.env.AI_CARD_IMPORT_ENABLED?.trim() === "true";
}

/**
 * Latency and cost guard for the mnemonics generated during one Remote MCP commit
 * (S-21 D7). `maxConcepts = 0` disables generation entirely (kill switch), and an
 * out-of-range value returns `undefined` so the caller fails closed and commits
 * cards without mnemonics rather than running unbounded provider calls.
 */
export function getMcpAutoMnemonicConfig(): McpAutoMnemonicConfig | undefined {
	const maxConcepts = parseIntegerEnv(process.env.MCP_AUTO_MNEMONIC_MAX_CONCEPTS, 20, 0, 50);
	const budgetMs = parseIntegerEnv(process.env.MCP_AUTO_MNEMONIC_BUDGET_MS, 45_000, 5_000, 120_000);
	if (maxConcepts === undefined || budgetMs === undefined) return undefined;
	return { maxConcepts, budgetMs };
}

export function isAiCardManagementEnabled(): boolean {
	return process.env.AI_CARD_MANAGEMENT_ENABLED === "true";
}

export function getOpenAiCardGenerationConfig(): OpenAiCardGenerationConfig | undefined {
	const apiKey = getRouteSecret("OPENAI_API_KEY");
	const model = process.env.OPENAI_CARD_GENERATION_MODEL?.trim() || "gpt-5.6-luna";
	const moderationModel = process.env.OPENAI_MODERATION_MODEL?.trim() || "omni-moderation-latest";
	const imageDetail = process.env.OPENAI_CARD_IMAGE_DETAIL?.trim() || "high";
	const generationTimeoutMs = parseIntegerEnv(
		process.env.OPENAI_CARD_GENERATION_TIMEOUT_MS,
		60_000,
		5_000,
		120_000
	);
	const moderationTimeoutMs = parseIntegerEnv(
		process.env.OPENAI_MODERATION_TIMEOUT_MS,
		10_000,
		1_000,
		30_000
	);
	if (
		apiKey === undefined ||
		!/^[A-Za-z0-9._:-]{1,128}$/u.test(model) ||
		moderationModel !== "omni-moderation-latest" ||
		!isOpenAiImageDetail(imageDetail) ||
		generationTimeoutMs === undefined ||
		moderationTimeoutMs === undefined
	) {
		return undefined;
	}
	return {
		apiKey,
		model,
		moderationModel,
		imageDetail,
		generationTimeoutMs,
		moderationTimeoutMs,
	};
}

export function requireEnv(keys: readonly RequiredEnvKey[]): void {
	const missingKeys = keys.filter((key) => {
		const value = process.env[key];
		return value === undefined || value.trim().length === 0;
	});

	if (missingKeys.length > 0) {
		throw new Error(formatMissingEnvError(missingKeys));
	}
}

export function getPublicEnvConfig(): PublicEnvConfig {
	// Next.js replaces NEXT_PUBLIC_* only when the property name is statically visible.
	// Do not route these browser values through process.env[key].
	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
	const missingKeys: RequiredEnvKey[] = [];
	if (supabaseUrl === undefined || supabaseUrl.trim().length === 0)
		missingKeys.push("NEXT_PUBLIC_SUPABASE_URL");
	if (supabaseAnonKey === undefined || supabaseAnonKey.trim().length === 0)
		missingKeys.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
	if (missingKeys.length > 0) throw new Error(formatMissingEnvError(missingKeys));
	return {
		supabaseUrl: supabaseUrl ?? "",
		supabaseAnonKey: supabaseAnonKey ?? "",
	};
}

function parseIntegerEnv(
	value: string | undefined,
	fallback: number,
	minimum: number,
	maximum: number
): number | undefined {
	if (value === undefined || value.trim().length === 0) return fallback;
	if (!/^\d+$/u.test(value.trim())) return undefined;
	const parsed = Number(value.trim());
	return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
		? parsed
		: undefined;
}

function isOpenAiImageDetail(value: string): value is OpenAiImageDetail {
	return value === "low" || value === "high" || value === "auto";
}

function parseMcpOrigin(key: string, value: string | undefined): string {
	const parsed = parseMcpUrl(key, value);
	if (parsed.pathname !== "/" || parsed.search.length > 0 || parsed.hash.length > 0) {
		throw new Error(`Invalid ${key}`);
	}
	return parsed.origin;
}

function parseMcpOrigins(key: string, value: string | undefined): readonly string[] {
	const trimmed = value?.trim();
	if (trimmed === undefined || trimmed.length === 0) throw new Error(`Missing ${key}`);
	const origins = trimmed.split(",").map((origin) => parseMcpOrigin(key, origin));
	if (origins.length === 0 || new Set(origins).size !== origins.length) {
		throw new Error(`Invalid ${key}`);
	}
	return Object.freeze(origins);
}

function parseMcpIssuer(value: string | undefined): string {
	const parsed = parseMcpUrl("MCP_OAUTH_ISSUER", value);
	if (parsed.pathname !== "/auth/v1" || parsed.search.length > 0 || parsed.hash.length > 0) {
		throw new Error("Invalid MCP_OAUTH_ISSUER");
	}
	return parsed.href;
}

function parseMcpUrl(key: string, value: string | undefined): URL {
	const trimmed = value?.trim();
	if (trimmed === undefined || trimmed.length === 0) throw new Error(`Missing ${key}`);
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error(`Invalid ${key}`);
	}
	if (parsed.protocol !== "https:" || parsed.username.length > 0 || parsed.password.length > 0) {
		throw new Error(`Invalid ${key}`);
	}
	return parsed;
}

export function getEnvConfig(): EnvConfig {
	requireEnv(REQUIRED_ENV_KEYS);

	return {
		supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
		supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
		supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
		geminiApiKey: getOptionalEnv("GEMINI_API_KEY"),
		nodeEnv: process.env.NODE_ENV,
	};
}
