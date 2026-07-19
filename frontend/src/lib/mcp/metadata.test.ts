import { afterEach, describe, expect, it } from "vitest";

import { getMcpEnvConfig } from "../env";
import {
	MCP_SCOPES,
	getCanonicalMcpResource,
	getMcpBearerChallenge,
	getMcpProtectedResourceMetadata,
} from "./metadata";

const keys = ["MCP_ENABLED", "MCP_PUBLIC_ORIGIN", "MCP_OAUTH_ISSUER", "MCP_ALLOWED_ORIGIN"];

afterEach(() => {
	for (const key of keys) Reflect.deleteProperty(process.env, key);
});

function setValidEnv(): void {
	process.env.MCP_PUBLIC_ORIGIN = "https://cards.example.test";
	process.env.MCP_OAUTH_ISSUER = "https://project.supabase.co/auth/v1";
	process.env.MCP_ALLOWED_ORIGIN = "https://chat.example.test";
}

describe("MCP canonical metadata", () => {
	it("uses one canonical config for resource, issuer, challenge, and exact standard scopes", () => {
		setValidEnv();
		const env = getMcpEnvConfig();
		const metadata = getMcpProtectedResourceMetadata(env);

		expect(MCP_SCOPES).toEqual(["openid", "email", "profile"]);
		expect(getCanonicalMcpResource(env)).toBe("https://cards.example.test/api/mcp");
		expect(metadata).toEqual({
			resource: "https://cards.example.test/api/mcp",
			authorization_servers: ["https://project.supabase.co/auth/v1"],
			bearer_methods_supported: ["header"],
			scopes_supported: ["openid", "email", "profile"],
		});
		expect(getMcpBearerChallenge(env)).toBe(
			'Bearer resource_metadata="https://cards.example.test/.well-known/oauth-protected-resource/api/mcp", scope="openid email profile"'
		);
	});
});
