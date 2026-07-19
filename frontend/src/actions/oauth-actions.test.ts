import { beforeEach, describe, expect, it, vi } from "vitest";

const createServerClientMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn<(location: string) => never>());
const revalidatePathMock = vi.hoisted(() => vi.fn());
const isMcpEnabledMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ createServerClient: createServerClientMock }));
vi.mock("@/lib/env", () => ({ isMcpEnabled: isMcpEnabledMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import {
	OAUTH_ACTION_INITIAL_STATE,
	decideOAuthConsent,
	revokeOAuthConnection,
} from "./oauth-actions";

const authorizationId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

class RedirectSignal extends Error {}

function authorizationDetails() {
	return {
		data: {
			authorization_id: authorizationId,
			client: { id: clientId, name: "テスト外部AI" },
			user: { id: userId },
			scope: "openid email profile",
		},
		error: null,
	};
}

function setupClient() {
	const getAuthorizationDetails = vi.fn(async () => authorizationDetails());
	const approveAuthorization = vi.fn(async () => ({
		data: { redirect_url: "https://client.example.test/complete" },
		error: null,
	}));
	const denyAuthorization = vi.fn();
	const listGrants = vi.fn(async () => ({
		data: [
			{
				client: { id: clientId, name: "テスト外部AI" },
				scopes: ["openid", "email", "profile"],
				granted_at: "2026-07-19T00:00:00.000Z",
			},
		],
		error: null,
	}));
	const revokeGrant = vi.fn(async () => ({ data: {}, error: null }));
	createServerClientMock.mockReturnValue({
		auth: {
			getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })),
			oauth: {
				getAuthorizationDetails,
				approveAuthorization,
				denyAuthorization,
				listGrants,
				revokeGrant,
			},
		},
	});
	return {
		getAuthorizationDetails,
		approveAuthorization,
		denyAuthorization,
		listGrants,
		revokeGrant,
	};
}

describe("S-14 OAuth actions", () => {
	beforeEach(() => {
		createServerClientMock.mockReset();
		isMcpEnabledMock.mockReset();
		isMcpEnabledMock.mockReturnValue(true);
		revalidatePathMock.mockReset();
		redirectMock.mockReset();
		redirectMock.mockImplementation(() => {
			throw new RedirectSignal();
		});
	});

	it("fails closed before approval when MCP is disabled", async () => {
		const api = setupClient();
		isMcpEnabledMock.mockReturnValue(false);
		const formData = new FormData();
		formData.set("authorization_id", authorizationId);
		formData.set("decision", "approve");
		await expect(decideOAuthConsent(OAUTH_ACTION_INITIAL_STATE, formData)).resolves.toMatchObject({
			status: "error",
		});
		expect(api.getAuthorizationDetails).not.toHaveBeenCalled();
		expect(api.approveAuthorization).not.toHaveBeenCalled();
	});

	it("re-reads official authorization details before allowing consent", async () => {
		const api = setupClient();
		const formData = new FormData();
		formData.set("authorization_id", authorizationId);
		formData.set("decision", "approve");
		await expect(decideOAuthConsent(OAUTH_ACTION_INITIAL_STATE, formData)).rejects.toBeInstanceOf(
			RedirectSignal
		);
		expect(api.getAuthorizationDetails).toHaveBeenCalledWith(authorizationId);
		expect(api.approveAuthorization).toHaveBeenCalledWith(authorizationId, {
			skipBrowserRedirect: true,
		});
		expect(redirectMock).toHaveBeenCalledWith("https://client.example.test/complete");
	});

	it("rechecks the current grant before revocation and refreshes the connections page", async () => {
		const api = setupClient();
		const formData = new FormData();
		formData.set("client_id", clientId);
		await expect(revokeOAuthConnection(OAUTH_ACTION_INITIAL_STATE, formData)).resolves.toEqual({
			status: "idle",
		});
		expect(api.listGrants).toHaveBeenCalledOnce();
		expect(api.revokeGrant).toHaveBeenCalledWith({ clientId });
		expect(revalidatePathMock).toHaveBeenCalledWith("/oauth/connections");
	});
});
