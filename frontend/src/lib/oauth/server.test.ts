import { describe, expect, it, vi } from "vitest";

import { type OAuthServerApi, getOAuthConnections, getVerifiedAuthorization } from "./server";

const authorizationId = "ursye6rqmgnu6ogghegvezpvu2utzhv3";
const clientId = "chatgpt-client_2222222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

function oauth(overrides: Partial<OAuthServerApi> = {}): OAuthServerApi {
	return {
		getAuthorizationDetails: vi.fn(async () => ({
			data: {
				authorization_id: authorizationId,
				client: { id: clientId, name: "テスト外部AI" },
				user: { id: userId },
				scope: "openid email profile",
			},
			error: null,
		})),
		approveAuthorization: vi.fn(),
		denyAuthorization: vi.fn(),
		listGrants: vi.fn(async () => ({
			data: [
				{
					client: { id: clientId, name: "テスト外部AI" },
					scopes: ["openid", "email", "profile"],
					granted_at: "2026-07-19T00:00:00.000Z",
				},
			],
			error: null,
		})),
		revokeGrant: vi.fn(),
		...overrides,
	};
}

describe("S-14 official Supabase OAuth server boundary", () => {
	it("accepts only current-user authorization details with the exact standard scopes", async () => {
		await expect(getVerifiedAuthorization(oauth(), userId, authorizationId)).resolves.toEqual({
			authorizationId,
			clientName: "テスト外部AI",
		});
		await expect(
			getVerifiedAuthorization(
				oauth({
					getAuthorizationDetails: vi.fn(async () => ({
						data: {
							authorization_id: authorizationId,
							client: { id: clientId, name: "テスト外部AI" },
							user: { id: userId },
							scope: "openid email profile phone",
						},
						error: null,
					})),
				}),
				userId,
				authorizationId
			)
		).resolves.toBeNull();
	});

	it("returns only current-user grants with the exact standard scopes", async () => {
		const connections = await getOAuthConnections(
			oauth({
				listGrants: vi.fn(async () => ({
					data: [
						{
							client: { id: clientId, name: "有効な外部AI" },
							scopes: ["openid", "email", "profile"],
							granted_at: "2026-07-19T00:00:00.000Z",
						},
						{
							client: { id: "44444444-4444-4444-8444-444444444444", name: "除外対象" },
							scopes: ["openid", "email"],
							granted_at: "2026-07-19T00:00:00.000Z",
						},
					],
					error: null,
				})),
			})
		);
		expect(connections).toEqual([
			{ clientId, clientName: "有効な外部AI", grantedAt: "2026-07-19T00:00:00.000Z" },
		]);
	});
});
