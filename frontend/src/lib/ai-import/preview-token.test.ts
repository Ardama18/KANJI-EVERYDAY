import { describe, expect, it } from "vitest";

import { deriveRemoteGenerationRequestHash } from "./canonical-request";
import {
	PREVIEW_TOKEN_TTL_SECONDS,
	PreviewTokenError,
	signPreviewToken,
	signRemotePreviewToken,
	verifyPreviewToken,
	verifyRemotePreviewToken,
} from "./preview-token";

const ownerId = "123e4567-e89b-42d3-a456-426614174000";
const otherOwnerId = "223e4567-e89b-42d3-a456-426614174000";
const clientId = "323e4567-e89b-42d3-a456-426614174000";
const otherClientId = "423e4567-e89b-42d3-a456-426614174000";
const importRequestHash = "a".repeat(64);
const reservationKey = "reservation-1";
const secret = "test-only-preview-secret";
const now = 2_000_000_000;

describe("preview token versions", () => {
	it("keeps UI token v1 issuance and verification unchanged", async () => {
		const expected = { userId: ownerId, reservationKey, importRequestHash };
		const token = await signPreviewToken(expected, secret, now);
		await expect(verifyPreviewToken(token, expected, secret, now)).resolves.toEqual({
			v: 1,
			...expected,
			expiresAt: now + PREVIEW_TOKEN_TTL_SECONDS,
		});
		await expect(
			verifyRemotePreviewToken(token, { ...expected, clientId }, secret, now)
		).rejects.toThrow(PreviewTokenError);
	});

	it("binds remote token v2 to domain, owner, request hash, reservation, and expiry", async () => {
		const expected = { userId: ownerId, clientId, reservationKey, importRequestHash };
		const token = await signRemotePreviewToken(expected, secret, now);
		await expect(verifyRemotePreviewToken(token, expected, secret, now)).resolves.toMatchObject({
			v: 2,
			domain: "kanji-everyday:remote-mcp:preview:v2",
			...expected,
			expiresAt: now + PREVIEW_TOKEN_TTL_SECONDS,
		});
		await expect(verifyPreviewToken(token, expected, secret, now)).rejects.toThrow(
			PreviewTokenError
		);
	});

	it("allows OAuth clients to rotate between remote preview and commit", async () => {
		const expected = { userId: ownerId, clientId, reservationKey, importRequestHash };
		const token = await signRemotePreviewToken(expected, secret, now);
		await expect(
			verifyRemotePreviewToken(token, { ...expected, clientId: otherClientId }, secret, now)
		).resolves.toMatchObject({
			v: 2,
			userId: ownerId,
			clientId,
			reservationKey,
			importRequestHash,
		});
	});

	it.each([
		["cross owner", { userId: otherOwnerId }],
		["request substitution", { importRequestHash: "b".repeat(64) }],
		["reservation substitution", { reservationKey: "reservation-2" }],
	] as const)("rejects %s replay", async (_name, overrides) => {
		const expected = { userId: ownerId, clientId, reservationKey, importRequestHash };
		const token = await signRemotePreviewToken(expected, secret, now);
		await expect(
			verifyRemotePreviewToken(token, { ...expected, ...overrides }, secret, now)
		).rejects.toThrow(PreviewTokenError);
	});

	it("rejects expiration and tampering", async () => {
		const expected = { userId: ownerId, clientId, reservationKey, importRequestHash };
		const token = await signRemotePreviewToken(expected, secret, now);
		await expect(
			verifyRemotePreviewToken(token, expected, secret, now + PREVIEW_TOKEN_TTL_SECONDS + 1)
		).rejects.toThrow(PreviewTokenError);
		const replacement = token.endsWith("a") ? "b" : "a";
		await expect(
			verifyRemotePreviewToken(`${token.slice(0, -1)}${replacement}`, expected, secret, now)
		).rejects.toThrow(PreviewTokenError);
	});

	it("derives the generation hash deterministically from server-owned hash and normalized client", async () => {
		const first = await deriveRemoteGenerationRequestHash(
			importRequestHash,
			clientId.toUpperCase()
		);
		const replay = await deriveRemoteGenerationRequestHash(importRequestHash, clientId);
		const otherClient = await deriveRemoteGenerationRequestHash(importRequestHash, otherClientId);
		expect(first).toMatch(/^[0-9a-f]{64}$/u);
		expect(replay).toBe(first);
		expect(otherClient).not.toBe(first);
		await expect(deriveRemoteGenerationRequestHash("not-a-hash", clientId)).rejects.toThrow();
	});
});
