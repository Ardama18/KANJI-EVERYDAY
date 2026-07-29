import { afterEach, describe, expect, it, vi } from "vitest";

import type { McpActorContext } from "./auth";
import {
	type McpRouteDependencies,
	createDefaultMnemonicGenerator,
	handleMcpRoute,
} from "./route-handler";
import type { McpImportRequest } from "./services";
import type { McpToolServices } from "./tools";

const token = "header.payload.signature";
const actor: McpActorContext = {
	userId: "11111111-1111-4111-8111-111111111111",
	clientId: "22222222-2222-4222-8222-222222222222",
	sessionId: "session-1",
	issuer: "https://project.supabase.co/auth/v1",
	audience: "https://cards.example.test/api/mcp",
	scopes: ["openid", "email", "profile"],
};

function request(
	method = "POST",
	body: unknown = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
	headers: Record<string, string> = {}
): Request {
	return new Request("https://cards.example.test/api/mcp", {
		method,
		headers: {
			host: "cards.example.test",
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...(method === "POST" ? { authorization: `Bearer ${token}` } : {}),
			...headers,
		},
		...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
	});
}

function services(): McpToolServices {
	return {
		listDecks: vi.fn(),
		getDailyStudyStatus: vi.fn(),
		createDeck: vi.fn(),
		previewCardImport: vi.fn(),
		commitCardImport: vi.fn(),
		getImportStatus: vi.fn(),
		listAiCards: vi.fn(),
		updateAiCard: vi.fn(),
		deleteAiCards: vi.fn(),
		undoImportBatch: vi.fn(),
	};
}

function createDependencies(overrides: Partial<McpRouteDependencies> = {}) {
	const instance = services();
	const client = {};
	const base: McpRouteDependencies = {
		isEnabled: () => true,
		getEnv: () => ({
			enabled: true,
			publicOrigin: "https://cards.example.test",
			oauthIssuer: "https://project.supabase.co/auth/v1",
			allowedOrigins: ["https://chat.example.test"],
		}),
		authenticate: vi.fn(async () => actor),
		createClient: vi.fn(() => client as never),
		createServices: vi.fn(() => instance),
		handleTransport: vi.fn(async () => Response.json({ forwarded: true })),
	};
	return { dependencies: { ...base, ...overrides }, instance };
}

describe("S-14 MCP route boundary", () => {
	it("returns a fixed 404 while disabled without creating auth, clients, or repositories", async () => {
		const { dependencies } = createDependencies({ isEnabled: () => false });
		const response = await handleMcpRoute(request(), dependencies);
		expect(response.status).toBe(404);
		expect(dependencies.authenticate).not.toHaveBeenCalled();
		expect(dependencies.createServices).not.toHaveBeenCalled();
	});

	it("rejects a wrong Host or browser Origin before authentication", async () => {
		const { dependencies } = createDependencies();
		const wrongHost = await handleMcpRoute(
			request("POST", undefined, { host: "attacker.example.test" }),
			dependencies
		);
		const wrongOrigin = await handleMcpRoute(
			request("POST", undefined, { origin: "https://attacker.example.test" }),
			dependencies
		);
		expect(wrongHost.status).toBe(403);
		expect(wrongOrigin.status).toBe(403);
		expect(dependencies.authenticate).not.toHaveBeenCalled();
	});

	it("accepts any configured browser Origin and echoes it for CORS preflight", async () => {
		const { dependencies } = createDependencies({
			getEnv: () => ({
				enabled: true,
				publicOrigin: "https://cards.example.test",
				oauthIssuer: "https://project.supabase.co/auth/v1",
				allowedOrigins: [
					"https://chatgpt.com",
					"https://timecoin-cloud.vercel.app",
					"https://claude.ai",
				],
			}),
		});
		const post = await handleMcpRoute(
			request("POST", undefined, { origin: "https://timecoin-cloud.vercel.app" }),
			dependencies
		);
		const options = await handleMcpRoute(
			request("OPTIONS", undefined, { origin: "https://claude.ai" }),
			dependencies
		);
		expect(post.status).toBe(200);
		expect(options.status).toBe(204);
		expect(options.headers.get("Access-Control-Allow-Origin")).toBe("https://claude.ai");
	});

	it("rejects bad content negotiation and payloads before authentication", async () => {
		const { dependencies } = createDependencies();
		const media = await handleMcpRoute(
			request("POST", undefined, { "content-type": "application/x-www-form-urlencoded" }),
			dependencies
		);
		const accept = await handleMcpRoute(
			request("POST", undefined, { accept: "text/html" }),
			dependencies
		);
		const malformed = await handleMcpRoute(request("POST", "{"), dependencies);
		expect([media.status, accept.status, malformed.status]).toEqual([415, 406, 400]);
		expect(dependencies.authenticate).not.toHaveBeenCalled();
	});

	it("accepts ChatGPT-compatible JSON media types before authentication", async () => {
		const { dependencies } = createDependencies({
			authenticate: vi.fn(async () => {
				throw new Error("unauthenticated");
			}),
		});
		for (const contentType of [
			undefined,
			"",
			"application/json",
			"application/json; charset=UTF-8",
			"application/json; profile=mcp; charset=UTF-8",
			"application/json-rpc",
			"application/mcp+json",
			"application/vnd.modelcontextprotocol.request+json; charset=UTF-8",
			"text/plain",
			"text/plain;charset=UTF-8",
		]) {
			const headers =
				contentType === undefined ? { "content-type": "" } : { "content-type": contentType };
			const response = await handleMcpRoute(request("POST", undefined, headers), dependencies);
			expect(response.status, String(contentType)).toBe(401);
		}
	});

	it("returns the single 401 challenge before transport for missing or invalid Bearer auth", async () => {
		const { dependencies } = createDependencies();
		const response = await handleMcpRoute(
			request("POST", undefined, { authorization: "Bearer " }),
			dependencies
		);
		expect(response.status).toBe(401);
		expect(response.headers.get("WWW-Authenticate")).toBe(
			'Bearer resource_metadata="https://cards.example.test/.well-known/oauth-protected-resource/api/mcp", scope="openid email profile"'
		);
		expect(dependencies.authenticate).not.toHaveBeenCalled();
		expect(dependencies.handleTransport).not.toHaveBeenCalled();
	});

	it("authenticates before returning protocol errors for unknown tools", async () => {
		const { dependencies } = createDependencies();
		const response = await handleMcpRoute(
			request("POST", {
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "arbitrary_rpc", arguments: {} },
			}),
			dependencies
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: { code: -32602 } });
		expect(dependencies.authenticate).toHaveBeenCalledOnce();
		expect(dependencies.createServices).not.toHaveBeenCalled();
	});

	it("returns an auth challenge before unknown-tool details for unauthenticated requests", async () => {
		const { dependencies } = createDependencies();
		const response = await handleMcpRoute(
			request(
				"POST",
				{
					jsonrpc: "2.0",
					id: 1,
					method: "tools/call",
					params: { name: "arbitrary_rpc", arguments: {} },
				},
				{ authorization: "" }
			),
			dependencies
		);
		expect(response.status).toBe(401);
		expect(dependencies.createServices).not.toHaveBeenCalled();
	});

	it("authenticates once, creates a JWT-scoped client, then delegates only a valid POST", async () => {
		const { dependencies } = createDependencies();
		const response = await handleMcpRoute(request(), dependencies);
		expect(response.status).toBe(200);
		expect(dependencies.authenticate).toHaveBeenCalledWith([`Bearer ${token}`]);
		expect(dependencies.createClient).toHaveBeenCalledWith(token);
		expect(dependencies.createServices).toHaveBeenCalledOnce();
		expect(dependencies.handleTransport).toHaveBeenCalledOnce();
	});

	it("keeps transport failures separate from Bearer authentication failures", async () => {
		const { dependencies } = createDependencies({
			handleTransport: vi.fn(async () => {
				throw new Error("transport failed");
			}),
		});
		const response = await handleMcpRoute(request(), dependencies);
		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({ error: { code: -32603 } });
		expect(dependencies.authenticate).toHaveBeenCalledOnce();
	});

	it("uses OPTIONS without auth and rejects GET/DELETE in stateless mode", async () => {
		const { dependencies } = createDependencies();
		const options = await handleMcpRoute(request("OPTIONS"), dependencies);
		const get = await handleMcpRoute(request("GET"), dependencies);
		const remove = await handleMcpRoute(request("DELETE"), dependencies);
		expect(options.status).toBe(204);
		expect(options.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
		expect([get.status, remove.status]).toEqual([405, 405]);
		expect(dependencies.authenticate).not.toHaveBeenCalled();
	});
});

const aiImportRequest: McpImportRequest = {
	deck: { id: "11111111-1111-4111-8111-111111111111" },
	items: [
		{
			clientItemId: "item-1",
			conceptId: "concept-001",
			pattern: "R1",
			front: "山",
			back: "やま",
			tags: [],
			image: { mode: "ai" },
		},
	],
};

describe("S-21 default mnemonic generator", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	/** Any provider call in these cases would be a bug, so fetch must stay untouched. */
	function forbidNetwork(): void {
		vi.stubGlobal(
			"fetch",
			vi.fn(() => {
				throw new Error("the default generator must not reach the network here");
			})
		);
	}

	it.each([
		[
			"the import flag is off",
			{ AI_CARD_IMPORT_ENABLED: "false", OPENAI_API_KEY: "secret" },
			aiImportRequest,
		],
		[
			"the provider is not configured",
			{ AI_CARD_IMPORT_ENABLED: "true", OPENAI_API_KEY: "" },
			aiImportRequest,
		],
		[
			"the concept cap is zero",
			{
				AI_CARD_IMPORT_ENABLED: "true",
				OPENAI_API_KEY: "secret",
				MCP_AUTO_MNEMONIC_MAX_CONCEPTS: "0",
			},
			aiImportRequest,
		],
		[
			"a limit is out of range",
			{
				AI_CARD_IMPORT_ENABLED: "true",
				OPENAI_API_KEY: "secret",
				MCP_AUTO_MNEMONIC_BUDGET_MS: "1",
			},
			aiImportRequest,
		],
		[
			"no concept requests an AI illustration",
			{ AI_CARD_IMPORT_ENABLED: "true", OPENAI_API_KEY: "secret" },
			{
				...aiImportRequest,
				items: aiImportRequest.items.map((item) => ({ ...item, image: { mode: "none" as const } })),
			},
		],
	] as const)(
		"returns undefined without calling the provider when %s",
		async (_case, env, body) => {
			for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
			forbidNetwork();

			await expect(createDefaultMnemonicGenerator()(body)).resolves.toBeUndefined();
		}
	);
});
