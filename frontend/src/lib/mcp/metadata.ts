import { type McpEnvConfig, getMcpEnvConfig } from "../env";

export const MCP_SCOPES = ["openid", "email", "profile"] as const;

export interface McpMetadataConfig {
	readonly publicOrigin: string;
	readonly oauthIssuer: string;
}

export function getMcpMetadataConfig(env: McpEnvConfig = getMcpEnvConfig()): McpMetadataConfig {
	return {
		publicOrigin: env.publicOrigin,
		oauthIssuer: env.oauthIssuer,
	};
}

export function getCanonicalMcpResource(config: McpMetadataConfig): string {
	return `${config.publicOrigin}/api/mcp`;
}

export function getMcpResourceMetadataUrl(config: McpMetadataConfig): string {
	return `${config.publicOrigin}/.well-known/oauth-protected-resource/api/mcp`;
}

export function getMcpBearerChallenge(config: McpMetadataConfig): string {
	return `Bearer resource_metadata="${getMcpResourceMetadataUrl(config)}", scope="${MCP_SCOPES.join(" ")}"`;
}

export function getMcpProtectedResourceMetadata(config: McpMetadataConfig) {
	return Object.freeze({
		resource: getCanonicalMcpResource(config),
		authorization_servers: Object.freeze([config.oauthIssuer]),
		bearer_methods_supported: Object.freeze(["header"]),
		scopes_supported: MCP_SCOPES,
	});
}
