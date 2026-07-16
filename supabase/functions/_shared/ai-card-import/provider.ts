import type { IllustrationProvider, ProviderName, ProviderResult } from "./contracts.ts";

export const ILLUSTRATION_PROVIDER_TIMEOUT_MS = 110_000;

export interface ProviderEnvironment {
	readonly ILLUSTRATION_PROVIDER?: string;
	readonly ILLUSTRATION_PROVIDER_ENDPOINT?: string;
	readonly ILLUSTRATION_PROVIDER_ENDPOINT_BINDING?: string;
	readonly OPENAI_API_KEY?: string;
	readonly OPENAI_IMAGE_MODEL?: string;
	readonly GEMINI_API_KEY?: string;
	readonly GEMINI_IMAGE_MODEL?: string;
}

export type ProviderEndpointBinding =
	| Readonly<Record<string, never>>
	| { readonly endpoint: string; readonly binding: string };

export function resolveProviderEndpointBinding(
	environment: Pick<
		ProviderEnvironment,
		"ILLUSTRATION_PROVIDER_ENDPOINT" | "ILLUSTRATION_PROVIDER_ENDPOINT_BINDING"
	>
): ProviderEndpointBinding {
	const endpoint = environment.ILLUSTRATION_PROVIDER_ENDPOINT?.trim();
	const binding = environment.ILLUSTRATION_PROVIDER_ENDPOINT_BINDING?.trim();
	if ((endpoint === undefined || endpoint.length === 0) && (binding === undefined || binding.length === 0)) {
		return {};
	}
	if (
		endpoint === undefined ||
		endpoint.length === 0 ||
		binding === undefined ||
		binding.length === 0 ||
		binding.length > 128 ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(binding)
	) {
		throw new Error("PROVIDER_CONFIG_ERROR");
	}
	let parsed: URL;
	try {
		parsed = new URL(endpoint);
	} catch {
		throw new Error("PROVIDER_CONFIG_ERROR");
	}
	if (
		parsed.protocol !== "https:" ||
		parsed.username.length > 0 ||
		parsed.password.length > 0 ||
		parsed.hash.length > 0 ||
		parsed.hostname.length === 0
	) {
		throw new Error("PROVIDER_CONFIG_ERROR");
	}
	return { endpoint: parsed.toString(), binding };
}

export interface ProviderAdapters {
	readonly openai: IllustrationProvider;
	readonly gemini: IllustrationProvider;
}

export function resolveProviderName(value: string | undefined): ProviderName {
	const normalized = value?.trim();
	if (normalized === undefined || normalized.length === 0) return "openai";
	if (normalized === "openai" || normalized === "gemini") return normalized;
	throw new Error("PROVIDER_CONFIG_ERROR");
}

export function selectProvider(
	environment: ProviderEnvironment,
	adapters: ProviderAdapters
): { readonly name: ProviderName; readonly provider: IllustrationProvider } {
	resolveProviderEndpointBinding(environment);
	const name = resolveProviderName(environment.ILLUSTRATION_PROVIDER);
	const key = name === "openai" ? environment.OPENAI_API_KEY : environment.GEMINI_API_KEY;
	const model = name === "openai" ? environment.OPENAI_IMAGE_MODEL : environment.GEMINI_IMAGE_MODEL;
	if (
		key?.trim().length === 0 ||
		model?.trim().length === 0 ||
		key === undefined ||
		model === undefined
	) {
		throw new Error("PROVIDER_CONFIG_ERROR");
	}
	return { name, provider: adapters[name] };
}

export async function generateWithSelectedProvider(input: {
	readonly environment: ProviderEnvironment;
	readonly adapters: ProviderAdapters;
	readonly prompt: string;
	readonly signal: AbortSignal;
}): Promise<ProviderResult> {
	const selected = selectProvider(input.environment, input.adapters);
	return await selected.provider.generate({ prompt: input.prompt, signal: input.signal });
}
