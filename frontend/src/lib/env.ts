type RequiredEnvKey =
	| "NEXT_PUBLIC_SUPABASE_URL"
	| "NEXT_PUBLIC_SUPABASE_ANON_KEY"
	| "SUPABASE_SERVICE_ROLE_KEY";
type OptionalEnvKey = "GEMINI_API_KEY";

export type EnvConfig = {
	supabaseUrl: string;
	supabaseAnonKey: string;
	supabaseServiceRoleKey: string;
	geminiApiKey: string | undefined;
	nodeEnv: string | undefined;
};

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

export function requireEnv(keys: readonly RequiredEnvKey[]): void {
	const missingKeys = keys.filter((key) => {
		const value = process.env[key];
		return value === undefined || value.trim().length === 0;
	});

	if (missingKeys.length > 0) {
		throw new Error(formatMissingEnvError(missingKeys));
	}
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
