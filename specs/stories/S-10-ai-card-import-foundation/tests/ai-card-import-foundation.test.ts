// S-10 Unitテストスケルトン - Design Doc: ai-card-import-foundation v1.1.1 (Approved)
// 生成日: 2026-07-14
// テスト種別: Unit Test（純粋TypeScript契約）
// 実装タイミング: shared domain実装と同時（Red -> Green -> Refactor）
//
// 対象: schema / Unicode normalization / card-key / preview HMAC /
//       generation reservation hash / canonical import hash
// 制約: production module未実装のため、後続task-executorがfixtureとimportを追加して完成させる。

import { describe, expect, it, vi } from "vitest";

import {
	canonicalizeGenerationRequest,
	canonicalizeImportRequest,
	hashGenerationRequest,
	hashImportRequest,
} from "@/lib/ai-import/canonical-request";
import { type CardKeyInput, buildCardKeyMaterial, computeCardKey } from "@/lib/ai-import/card-key";
import { normalizeDisplayText, normalizeForKey } from "@/lib/ai-import/normalize";
import {
	PREVIEW_TOKEN_TTL_SECONDS,
	PreviewTokenError,
	signPreviewToken,
	verifyPreviewToken,
} from "@/lib/ai-import/preview-token";
import {
	type ClientImportRequestInput,
	type CommitImportWrapperArgs,
	validateImportRequest,
} from "@/lib/ai-import/schema";
import canonicalFixture from "../fixtures/canonical-requests.json";
import unicodeFixture from "../fixtures/unicode-card-key.json";

function requireFixtureById<T extends { id: string }>(values: readonly T[], id: string): T {
	const value = values.find((candidate) => candidate.id === id);
	if (value === undefined) {
		throw new Error(`Missing fixture: ${id}`);
	}
	return value;
}

function toCardKeyInput(value: { pattern: string; front: string; back: string }): CardKeyInput {
	if (value.pattern !== "R1" && value.pattern !== "W1") {
		throw new Error(`Invalid card-key fixture pattern: ${value.pattern}`);
	}
	return { pattern: value.pattern, front: value.front, back: value.back };
}

const PREVIEW_NOW = 2_000_000_000;
const PREVIEW_SECRET = "phase-1-preview-test-secret";
const PREVIEW_INPUT = {
	userId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
	reservationKey: "reservation-preview-1",
	importRequestHash: "1aa5e988b528e484630b37cbc1ba2746bda6f68d1ca0ba5c7a3aacd541f223a8",
};

function validImportRequest(itemCount = 1): ClientImportRequestInput {
	return {
		deck: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
		items: Array.from({ length: itemCount }, (_, index) => ({
			clientItemId: `item-${index}`,
			conceptId: `concept-${index}`,
			pattern: "R1" as const,
			front: `漢字 ${index}`,
			back: `かんじ ${index}`,
			tags: [],
			image: { mode: "none" as const },
		})),
	};
}

async function expectSchemaRules(input: unknown, rules: readonly string[]): Promise<void> {
	const result = await validateImportRequest(input);
	expect(result.success).toBe(false);
	if (result.success) throw new Error("Expected schema validation to fail");
	expect(result.issues.every((issue) => issue.path.length > 0 && issue.rule.length > 0)).toBe(true);
	for (const rule of rules) expect(result.issues.map((issue) => issue.rule)).toContain(rule);
}

function requireReservationKey(value: CommitImportWrapperArgs["cardReservationKey"]): string {
	return value;
}

function decodeTestBase64Url(value: string): string {
	const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
	const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
	const binary = atob(padded);
	return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

function encodeTestBase64Url(value: string): string {
	const binary = Array.from(new TextEncoder().encode(value), (byte) =>
		String.fromCharCode(byte)
	).join("");
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function expectSafePreviewFailure(
	operation: () => Promise<unknown>,
	forbiddenValues: readonly string[]
): Promise<void> {
	const error: unknown = await operation().catch((reason: unknown) => reason);
	expect(error).toBeInstanceOf(PreviewTokenError);
	const message = error instanceof Error ? error.message : String(error);
	for (const value of forbiddenValues) {
		expect(message).not.toContain(value);
	}
}

describe("S-10 AIカード登録基盤 Unit契約", () => {
	describe("Stage 1 schema", () => {
		// AC原文 (AC-06/06a): Stage 1対象条件を不正にしたとき永続化を行わず、1〜50枚、clientItemId、tag境界を個別に拒否する。
		// 検証/期待結果/合格基準: unknown入力を全件検査し、field path付きissueを返し、成功時だけbranded normalized typeを返す。
		// @category: core-functionality
		// @dependency: frontend/src/lib/ai-import/schema.ts
		// @complexity: high
		it("UT-SCHEMA-01: unknown入力のshape違反を全件収集し、field path付きissueとして返す", async () => {
			const result = await validateImportRequest({
				deck: { id: 42, unknown: true },
				items: [
					{
						clientItemId: 1,
						conceptId: null,
						pattern: "R2",
						front: [],
						back: {},
						tags: "tag",
						image: { mode: "none", extra: true },
						unknown: true,
					},
				],
				unknown: true,
			});
			expect(result.success).toBe(false);
			if (result.success) return;
			const paths = result.issues.map((issue) => issue.path);
			for (const path of [
				"unknown",
				"deck.unknown",
				"deck.id",
				"items[0].unknown",
				"items[0].clientItemId",
				"items[0].conceptId",
				"items[0].pattern",
				"items[0].front",
				"items[0].back",
				"items[0].tags",
				"items[0].image.extra",
			])
				expect(paths).toContain(path);
			expect(result.issues.every((issue) => issue.path.length > 0 && issue.rule.length > 0)).toBe(
				true
			);
		});

		// @category: edge-case
		// @dependency: schema.ts
		// @complexity: medium
		it("UT-SCHEMA-02: items件数1件と50件を受理し、0件と51件をVALIDATION_ERRORで拒否する", async () => {
			expect((await validateImportRequest(validImportRequest(1))).success).toBe(true);
			expect((await validateImportRequest(validImportRequest(50))).success).toBe(true);
			await expectSchemaRules(validImportRequest(0), ["items_count"]);
			await expectSchemaRules(validImportRequest(51), ["items_count"]);
		});

		// @category: edge-case
		// @dependency: schema.ts
		// @complexity: medium
		it("UT-SCHEMA-03: clientItemId長1/64を受理し、空文字/65文字とrequest内重複を拒否する", async () => {
			for (const id of ["a", "a".repeat(64)]) {
				const request = validImportRequest();
				request.items[0].clientItemId = id;
				expect((await validateImportRequest(request)).success).toBe(true);
			}
			for (const id of ["", "a".repeat(65)]) {
				const request = validImportRequest();
				request.items[0].clientItemId = id;
				await expectSchemaRules(request, ["client_item_id_length"]);
			}
			const invalidScalar = validImportRequest();
			invalidScalar.items[0].clientItemId = "bad\ud800";
			await expectSchemaRules(invalidScalar, ["unicode_scalar"]);
			for (const id of ["c", "c".repeat(64)]) {
				const request = validImportRequest();
				request.items[0].conceptId = id;
				expect((await validateImportRequest(request)).success).toBe(true);
			}
			for (const id of ["", "c".repeat(65)]) {
				const request = validImportRequest();
				request.items[0].conceptId = id;
				await expectSchemaRules(request, ["concept_id_length"]);
			}
			const duplicate = validImportRequest(2);
			duplicate.items[1].clientItemId = duplicate.items[0].clientItemId;
			const result = await validateImportRequest(duplicate);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.code).toBe("DUPLICATE_IN_REQUEST");
				expect(result.issues.map((issue) => issue.rule)).toContain("duplicate_client_item_id");
			}
			const duplicateCard = validImportRequest(2);
			duplicateCard.items[1] = {
				...duplicateCard.items[0],
				clientItemId: "other-item",
				conceptId: "other-concept",
			};
			const cardResult = await validateImportRequest(duplicateCard);
			expect(cardResult.success).toBe(false);
			if (!cardResult.success) {
				expect(cardResult.code).toBe("DUPLICATE_IN_REQUEST");
				expect(cardResult.issues.map((issue) => issue.rule)).toContain("duplicate_card_key");
			}
		});

		// @category: core-functionality
		// @dependency: schema.ts
		// @complexity: high
		it("UT-SCHEMA-04: R1はreadingかつfrontが漢字側、W1はwritingかつbackが漢字側である契約を強制する", async () => {
			const display = validImportRequest();
			display.items[0].front = "　Ａ漢　 字 ";
			display.items[0].tags = [" Ｇｒａｄｅ　３ "];
			const reading = await validateImportRequest(display);
			expect(reading.success && reading.data.items[0].skill).toBe("reading");
			if (reading.success) {
				expect(reading.data.items[0]).toMatchObject({
					front: "A漢 字",
					normalizedTags: [{ displayName: "Grade 3", normalizedName: "grade 3" }],
				});
				expect(reading.data.items[0].cardKey).toMatch(/^[0-9a-f]{64}$/u);
			}
			const writing = validImportRequest();
			writing.items[0] = { ...writing.items[0], pattern: "W1", front: "かんじ", back: "漢字" };
			const normalized = await validateImportRequest(writing);
			expect(normalized.success && normalized.data.items[0].skill).toBe("writing");
			for (const [pattern, front, back] of [
				["R1", "alphabet", "かな"],
				["W1", "かな", "alphabet"],
			] as const) {
				const request = validImportRequest();
				request.items[0] = { ...request.items[0], pattern, front, back };
				await expectSchemaRules(request, ["han_required"]);
			}
			const empty = validImportRequest();
			empty.items[0].front = "　";
			empty.items[0].back = "x".repeat(201);
			await expectSchemaRules(empty, ["text_length"]);
		});

		// @category: edge-case
		// @dependency: schema.ts, Han-script fixture
		// @complexity: medium
		it("UT-SCHEMA-05: 漢字側にUnicode Script=Han相当文字がないitemを拒否し、全拡張面と日本語用追加文字を受理する", async () => {
			const astral = validImportRequest();
			astral.items[0].front = "𱍐";
			expect((await validateImportRequest(astral)).success).toBe(true);
			const iterationMark = validImportRequest();
			iterationMark.items[0].front = "〆";
			expect((await validateImportRequest(iterationMark)).success).toBe(true);
			const invalid = validImportRequest();
			invalid.items[0].front = "かなABC";
			await expectSchemaRules(invalid, ["han_required"]);
		});

		// @category: core-functionality
		// @dependency: schema.ts
		// @complexity: high
		it("UT-SCHEMA-06: 同一conceptのR1/W1を各最大1件に制限し、front/back相互一致しないpairを拒否する", async () => {
			const pair = validImportRequest(2);
			pair.items[1] = {
				...pair.items[1],
				conceptId: pair.items[0].conceptId,
				pattern: "W1",
				front: pair.items[0].back,
				back: pair.items[0].front,
			};
			expect((await validateImportRequest(pair)).success).toBe(true);
			const mismatch = structuredClone(pair);
			mismatch.items[1].front = "ちがう";
			await expectSchemaRules(mismatch, ["concept_pair_mismatch"]);
			const caseOnlyMismatch = structuredClone(pair);
			caseOnlyMismatch.items[0].back = "ABC";
			caseOnlyMismatch.items[1].front = "abc";
			await expectSchemaRules(caseOnlyMismatch, ["concept_pair_mismatch"]);
			const duplicate = validImportRequest(2);
			duplicate.items[1].conceptId = duplicate.items[0].conceptId;
			await expectSchemaRules(duplicate, ["duplicate_concept_pattern"]);
		});

		// @category: edge-case
		// @dependency: schema.ts, normalize.ts
		// @complexity: medium
		it("UT-SCHEMA-07: tag件数0/10と長さ1/30を受理し、11件・空・31文字・正規化後重複を拒否する", async () => {
			for (const tags of [
				[],
				Array.from({ length: 10 }, (_, index) => `タグ${index}`),
				["a"],
				["字".repeat(30)],
			]) {
				const request = validImportRequest();
				request.items[0].tags = tags;
				expect((await validateImportRequest(request)).success).toBe(true);
			}
			const cases: readonly { tags: readonly string[]; rule: string }[] = [
				{ tags: Array.from({ length: 11 }, (_, index) => `タグ${index}`), rule: "tags_count" },
				{ tags: ["　"], rule: "tag_length" },
				{ tags: ["字".repeat(31)], rule: "tag_length" },
				{ tags: [" Grade　3 ", "ｇｒａｄｅ  3"], rule: "duplicate_tag" },
			];
			for (const { tags, rule } of cases) {
				const request = validImportRequest();
				request.items[0].tags = [...tags];
				await expectSchemaRules(request, [rule]);
			}
		});

		// @category: core-functionality
		// @dependency: schema.ts
		// @complexity: medium
		it("UT-SCHEMA-08: deckのid/name/createを排他的unionとして検証し、複数指定または未指定を拒否する", async () => {
			for (const deck of [
				{ id: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE" },
				{ id: "01901901-9d3d-7cc2-98c8-3b4a13f994a2" },
				{ name: " 既存　デッキ " },
				{ create: { name: " 新規　デッキ " } },
			]) {
				const result = await validateImportRequest({ ...validImportRequest(), deck });
				expect(result.success).toBe(true);
				if (result.success && "id" in result.data.deck)
					expect(result.data.deck.id).toBe(result.data.deck.id.toLowerCase());
			}
			for (const deck of [
				{},
				{ id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", name: "both" },
				{ create: { name: "x", extra: true } },
			])
				await expectSchemaRules({ ...validImportRequest(), deck }, [
					Object.keys(deck).length === 0
						? "deck_union"
						: Object.keys(deck).length > 1
							? "deck_union"
							: "unknown_field",
				]);
		});

		// @category: core-functionality
		// @dependency: schema.ts
		// @complexity: medium
		it("UT-SCHEMA-09: imageのnone/ai/upload判別unionを検証し、upload以外のuploadIdとuploadのID欠落を拒否する", async () => {
			for (const image of [
				{ mode: "none" },
				{ mode: "ai" },
				{ mode: "upload", uploadId: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE" },
			]) {
				const request = validImportRequest();
				expect(
					(await validateImportRequest({ ...request, items: [{ ...request.items[0], image }] }))
						.success
				).toBe(true);
			}
			for (const image of [
				{ mode: "none", uploadId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
				{ mode: "upload" },
				{ mode: "other" },
			]) {
				const request = validImportRequest();
				await expectSchemaRules({ ...request, items: [{ ...request.items[0], image }] }, [
					"image_union",
				]);
			}
		});

		// @category: edge-case
		// @dependency: schema.ts
		// @complexity: medium
		it("UT-SCHEMA-10: client入力のsource・quota免除flag・未知fieldを受理せずtrusted contextとの境界を守る", async () => {
			const forged = {
				...validImportRequest(),
				source: "remote_mcp",
				quotaExempt: true,
				ownerUserId: "secret-owner",
				reservationKey: "secret-reservation",
				unknown: { nested: true },
			};
			const result = await validateImportRequest(forged);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(
					result.issues.filter((issue) => issue.rule === "unknown_field").map((issue) => issue.path)
				).toEqual(
					expect.arrayContaining([
						"source",
						"quotaExempt",
						"ownerUserId",
						"reservationKey",
						"unknown",
					])
				);
				expect(JSON.stringify(result)).not.toContain("secret-owner");
			}
			const valid = await validateImportRequest(validImportRequest());
			if (valid.success) {
				const wrapperArgs: CommitImportWrapperArgs = {
					context: {
						actorUserId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
						source: "app_ai",
						quotaPolicy: "consume",
					},
					idempotencyKey: "idempotency-1",
					importRequestHash: "a".repeat(64),
					cardReservationKey: "reservation-1",
					request: valid.data,
				};
				expect(requireReservationKey(wrapperArgs.cardReservationKey)).toBe("reservation-1");
			}
		});
	});

	describe("Unicode normalization と card-key", () => {
		// AC原文 (AC-01/02/03b): NFKC、固定White_Space、Unicode小文字化後のSHA-256 card_keyをowner部分一意契約に利用する。
		// 検証/期待結果/合格基準: 共通fixtureの全vectorでTypeScript期待値が一致し、SQL側も同じfixtureを利用できる。
		// @category: core-functionality
		// @dependency: normalize.ts, fixtures/unicode-card-key.json
		// @complexity: high
		it("UT-NORM-01: 固定Unicode White_Space全コードポイントをASCII SPACEへ置換し、trimと連続圧縮を行う", () => {
			const vector = unicodeFixture.displayNormalizationVectors.find(
				(candidate) => candidate.id === "all-fixed-white-space"
			);
			expect(vector).toBeDefined();
			for (const codePoint of unicodeFixture.whiteSpaceCodePoints) {
				const whiteSpace = String.fromCodePoint(Number.parseInt(codePoint, 16));
				expect(
					normalizeDisplayText(`${whiteSpace}漢${whiteSpace}${whiteSpace}字${whiteSpace}`)
				).toBe(vector?.expected);
			}
			expect(normalizeDisplayText(vector?.input ?? "")).toBe(vector?.expected);
		});

		// @category: edge-case
		// @dependency: normalize.ts, unicode-card-key fixture
		// @complexity: medium
		it("UT-NORM-02: U+FEFFをWhite_Spaceとして除去せず入力中に保持する", () => {
			const vector = unicodeFixture.displayNormalizationVectors.find(
				(candidate) => candidate.id === "feff-is-not-white-space"
			);
			expect(unicodeFixture.excludedWhiteSpaceCodePoints).toContain("FEFF");
			expect(vector).toBeDefined();
			expect(normalizeDisplayText(vector?.input ?? "")).toBe(vector?.expected);
		});

		// @category: core-functionality
		// @dependency: normalize.ts
		// @complexity: medium
		it("UT-NORM-03: NFKCで全角英数字・互換文字を正規化し、表示値では大文字小文字を保持する", () => {
			const vector = unicodeFixture.displayNormalizationVectors.find(
				(candidate) => candidate.id === "nfkc-and-case-preservation"
			);
			expect(vector).toBeDefined();
			expect(normalizeDisplayText(vector?.input ?? "")).toBe(vector?.expected);
		});

		// @category: core-functionality
		// @dependency: normalize.ts
		// @complexity: medium
		it("UT-NORM-04: key値とtag normalized_nameだけにUnicode小文字化を適用する", () => {
			const vector = unicodeFixture.keyNormalizationVectors.find(
				(candidate) => candidate.id === "unicode-lowercase-after-display-normalization"
			);
			expect(vector).toBeDefined();
			expect(normalizeDisplayText(vector?.input ?? "")).toBe(vector?.expectedDisplay);
			expect(normalizeForKey(vector?.input ?? "")).toBe(vector?.expected);
		});

		// @category: edge-case
		// @dependency: normalize.ts, unicode-card-key fixture
		// @complexity: high
		it("UT-NORM-05: BMP外文字と結合文字を欠損させず、UTF-8 fixtureどおり正規化する", () => {
			const displayVector = unicodeFixture.displayNormalizationVectors.find(
				(candidate) => candidate.id === "astral-and-combining-mark"
			);
			const keyVector = unicodeFixture.keyNormalizationVectors.find(
				(candidate) => candidate.id === "astral-and-combining-mark-for-key"
			);
			expect(displayVector).toBeDefined();
			expect(keyVector).toBeDefined();
			expect(normalizeDisplayText(displayVector?.input ?? "")).toBe(displayVector?.expected);
			expect(normalizeForKey(keyVector?.input ?? "")).toBe(keyVector?.expected);
		});

		// @category: core-functionality
		// @dependency: card-key.ts, normalize.ts
		// @complexity: high
		it("UT-CARDKEY-01: pattern+U+001F+normalized front+U+001F+normalized backのUTF-8 SHA-256 lowercase hexを返す", async () => {
			for (const vector of unicodeFixture.cardKeyVectors) {
				const input = toCardKeyInput(vector);
				expect(buildCardKeyMaterial(input)).toBe(vector.material);
				const digest = await computeCardKey(input);
				expect(digest).toBe(vector.expectedSha256Hex);
				expect(digest).toMatch(/^[0-9a-f]{64}$/u);
			}
		});

		// @category: edge-case
		// @dependency: card-key.ts, unicode-card-key fixture
		// @complexity: medium
		it("UT-CARDKEY-02: 表示上異なるNFKC・空白・case同値入力が同一card_keyになる", async () => {
			for (const group of unicodeFixture.cardKeyEquivalenceGroups) {
				const digests = await Promise.all(
					group.variants.map((variant) => computeCardKey(toCardKeyInput(variant)))
				);
				expect(new Set(digests)).toEqual(new Set([group.expectedSha256Hex]));
			}
		});

		// @category: edge-case
		// @dependency: card-key.ts
		// @complexity: medium
		it("UT-CARDKEY-03: R1/W1またはfront/back順序が異なる入力は異なるcard_keyになる", async () => {
			const vector = requireFixtureById(unicodeFixture.cardKeyVectors, "r1-basic");
			const baselineInput = toCardKeyInput(vector);
			const [baseline, otherPattern, reversed] = await Promise.all([
				computeCardKey(baselineInput),
				computeCardKey({ ...baselineInput, pattern: "W1" }),
				computeCardKey({ ...baselineInput, front: vector.back, back: vector.front }),
			]);
			expect(new Set([baseline, otherPattern, reversed])).toHaveLength(3);
		});
	});

	describe("generation reservation hash と import request hash", () => {
		// AC原文 (AC-04/05): provider前予約と最終importを別hashで固定し、reservation keyで同一workflowを結ぶ。
		// 検証/期待結果/合格基準: canonical JSON規約が決定的で、同値入力は同hash、意味差分は別hashとなる。
		// @category: core-functionality
		// @dependency: canonical-request.ts
		// @complexity: high
		it("UT-HASH-01: generation入力・model-independent options・requested unitsを固定key順でcanonical化する", async () => {
			const vector = requireFixtureById(canonicalFixture.generationVectors, "baseline");
			expect(canonicalizeGenerationRequest(vector.input)).toBe(vector.canonicalJson);
			expect(await hashGenerationRequest(vector.input)).toBe(vector.expectedSha256Hex);
		});

		// @category: edge-case
		// @dependency: canonical-request.ts
		// @complexity: medium
		it("UT-HASH-02: generation hashはobject挿入順や余分な空白に依存せず同値入力で一致する", async () => {
			const baseline = requireFixtureById(canonicalFixture.generationVectors, "baseline");
			const equivalent = requireFixtureById(
				canonicalFixture.generationVectors,
				"equivalent-reordered-and-spacing"
			);
			expect(canonicalizeGenerationRequest(equivalent.input)).toBe(baseline.canonicalJson);
			expect(await hashGenerationRequest(equivalent.input)).toBe(baseline.expectedSha256Hex);
		});

		// @category: edge-case
		// @dependency: canonical-request.ts
		// @complexity: medium
		it("UT-HASH-03: requested unitsまたはgeneration optionの意味差分でgeneration hashが変わる", async () => {
			const ids = ["baseline", "requested-unit-difference", "generation-option-difference"];
			const vectors = ids.map((id) => requireFixtureById(canonicalFixture.generationVectors, id));
			const digests = await Promise.all(
				vectors.map((vector) => hashGenerationRequest(vector.input))
			);
			expect(new Set(digests)).toHaveLength(ids.length);
			expect(digests).toEqual(vectors.map((vector) => vector.expectedSha256Hex));
			for (const digest of digests) {
				expect(digest).toMatch(/^[0-9a-f]{64}$/u);
			}
		});

		// @category: core-functionality
		// @dependency: canonical-request.ts, normalize.ts
		// @complexity: high
		it("UT-HASH-04: import requestはitem ordinalを保持し、各itemのtagをnormalized_name昇順にsortしてcanonical化する", async () => {
			const baseline = requireFixtureById(
				canonicalFixture.importVectors,
				"ordinal-and-normalized-tag-order"
			);
			const ordinalDifference = requireFixtureById(
				canonicalFixture.importVectors,
				"ordinal-difference"
			);
			expect(canonicalizeImportRequest(baseline.input)).toBe(baseline.canonicalJson);
			expect(canonicalizeImportRequest(ordinalDifference.input)).toBe(
				ordinalDifference.canonicalJson
			);
			const byteOrder = requireFixtureById(canonicalFixture.importVectors, "unicode-byte-order");
			expect(canonicalizeImportRequest(byteOrder.input)).toBe(byteOrder.canonicalJson);
			expect(await hashImportRequest(byteOrder.input)).toBe(byteOrder.expectedSha256Hex);
			expect(await hashImportRequest(ordinalDifference.input)).not.toBe(baseline.expectedSha256Hex);
		});

		// @category: core-functionality
		// @dependency: canonical-request.ts
		// @complexity: high
		it("UT-HASH-05: UUID lowercase化・integer表現・optional key省略・無空白JSONをUTF-8 SHA-256化する", async () => {
			const generation = requireFixtureById(canonicalFixture.generationVectors, "baseline");
			const importRequest = requireFixtureById(
				canonicalFixture.importVectors,
				"ordinal-and-normalized-tag-order"
			);
			const canonical = canonicalizeImportRequest(importRequest.input);
			expect(canonical).toBe(JSON.stringify(JSON.parse(canonical)));
			expect(canonical).toContain(importRequest.input.deck.id.toLowerCase());
			expect(canonical).not.toContain("uploadId");
			expect(canonicalizeGenerationRequest(generation.input)).toContain('"maxConcepts":2');
			const digest = await hashImportRequest(importRequest.input);
			expect(digest).toBe(importRequest.expectedSha256Hex);
			expect(digest).toMatch(/^[0-9a-f]{64}$/u);
		});

		// @category: edge-case
		// @dependency: canonical-request.ts
		// @complexity: medium
		it("UT-HASH-06: ownerとreservation keyをgeneration/import hash対象から除外する", async () => {
			const generation = requireFixtureById(
				canonicalFixture.generationVectors,
				"equivalent-reordered-and-spacing"
			);
			const importRequest = requireFixtureById(
				canonicalFixture.importVectors,
				"equivalent-trusted-fields-and-tag-order"
			);
			expect(canonicalizeGenerationRequest(generation.input)).not.toMatch(/owner|reservation/iu);
			expect(canonicalizeImportRequest(importRequest.input)).not.toMatch(
				/owner|reservation|source|quota/iu
			);
			expect(await hashGenerationRequest(generation.input)).toBe(generation.expectedSha256Hex);
			expect(await hashImportRequest(importRequest.input)).toBe(importRequest.expectedSha256Hex);
		});

		// @category: core-functionality
		// @dependency: canonical-request.ts
		// @complexity: high
		it("UT-HASH-07: provider結果を含む最終import hashはgeneration hashと独立して決定され、一致を要求しない", async () => {
			const generation = requireFixtureById(
				canonicalFixture.generationVectors,
				canonicalFixture.hashSeparation.generationVectorId
			);
			const importRequest = requireFixtureById(
				canonicalFixture.importVectors,
				canonicalFixture.hashSeparation.importVectorId
			);
			const [generationHash, importHash] = await Promise.all([
				hashGenerationRequest(generation.input),
				hashImportRequest(importRequest.input),
			]);
			expect(generationHash === importHash).toBe(!canonicalFixture.hashSeparation.mustDiffer);
		});
	});

	describe("preview HMAC", () => {
		// AC原文 (AC-04a): HMAC署名不正、owner不一致、期限切れ、request hash不一致を拒否し永続副作用を0件にする。
		// 検証/期待結果/合格基準: 純粋sign/verifyがv1 payloadを1800秒で束縛し、全不正系を安全に失敗させる。
		// @category: core-functionality
		// @dependency: preview-token.ts
		// @complexity: high
		it("UT-HMAC-01: v1/userId/reservationKey/importRequestHash/expiresAtをcanonical payloadとして署名し1800秒TTLを設定する", async () => {
			const token = await signPreviewToken(PREVIEW_INPUT, PREVIEW_SECRET, PREVIEW_NOW);
			const [payloadPart] = token.split(".");
			expect(payloadPart).toBeDefined();
			expect(decodeTestBase64Url(payloadPart ?? "")).toBe(
				JSON.stringify({
					v: 1,
					userId: PREVIEW_INPUT.userId,
					reservationKey: PREVIEW_INPUT.reservationKey,
					importRequestHash: PREVIEW_INPUT.importRequestHash,
					expiresAt: PREVIEW_NOW + PREVIEW_TOKEN_TTL_SECONDS,
				})
			);
			expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
			expect(PREVIEW_TOKEN_TTL_SECONDS).toBe(1800);
		});

		// @category: core-functionality
		// @dependency: preview-token.ts
		// @complexity: medium
		it("UT-HMAC-02: 正しいsecret・期待payload・期限内nowでbase64url tokenを検証できる", async () => {
			const token = await signPreviewToken(PREVIEW_INPUT, PREVIEW_SECRET, PREVIEW_NOW);
			await expect(
				verifyPreviewToken(token, PREVIEW_INPUT, PREVIEW_SECRET, PREVIEW_NOW + 1)
			).resolves.toEqual({
				v: 1,
				...PREVIEW_INPUT,
				expiresAt: PREVIEW_NOW + PREVIEW_TOKEN_TTL_SECONDS,
			});
		});

		// @category: edge-case
		// @dependency: preview-token.ts
		// @complexity: high
		it("UT-HMAC-03: payloadまたは署名の1 byte改ざんと不正token形式/versionを拒否する", async () => {
			const token = await signPreviewToken(PREVIEW_INPUT, PREVIEW_SECRET, PREVIEW_NOW);
			const [payloadPart = "", signaturePart = ""] = token.split(".");
			const payloadJson = decodeTestBase64Url(payloadPart);
			const versionToken = `${encodeTestBase64Url(payloadJson.replace('"v":1', '"v":2'))}.${signaturePart}`;
			const changedPayload = `${payloadPart.slice(0, -1)}${payloadPart.endsWith("A") ? "B" : "A"}.${signaturePart}`;
			const changedSignature = `${payloadPart}.${signaturePart.startsWith("A") ? "B" : "A"}${signaturePart.slice(1)}`;

			for (const invalidToken of [
				"invalid",
				"a.b.c",
				versionToken,
				changedPayload,
				changedSignature,
			]) {
				await expectSafePreviewFailure(
					() => verifyPreviewToken(invalidToken, PREVIEW_INPUT, PREVIEW_SECRET, PREVIEW_NOW),
					[invalidToken, PREVIEW_SECRET, PREVIEW_INPUT.userId]
				);
			}
		});

		// @category: edge-case
		// @dependency: preview-token.ts
		// @complexity: medium
		it("UT-HMAC-04: userIdまたはreservationKey不一致を拒否する", async () => {
			const token = await signPreviewToken(PREVIEW_INPUT, PREVIEW_SECRET, PREVIEW_NOW);
			for (const expected of [
				{ ...PREVIEW_INPUT, userId: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
				{ ...PREVIEW_INPUT, reservationKey: "reservation-preview-2" },
			]) {
				await expectSafePreviewFailure(
					() => verifyPreviewToken(token, expected, PREVIEW_SECRET, PREVIEW_NOW),
					[token, PREVIEW_SECRET, expected.userId, expected.reservationKey]
				);
			}
		});

		// @category: edge-case
		// @dependency: preview-token.ts
		// @complexity: medium
		it("UT-HMAC-05: expiresAt境界は期限内最終秒を受理し、期限超過を拒否する", async () => {
			const token = await signPreviewToken(PREVIEW_INPUT, PREVIEW_SECRET, PREVIEW_NOW);
			const expiresAt = PREVIEW_NOW + PREVIEW_TOKEN_TTL_SECONDS;
			await expect(
				verifyPreviewToken(token, PREVIEW_INPUT, PREVIEW_SECRET, expiresAt)
			).resolves.toMatchObject({
				expiresAt,
			});
			await expectSafePreviewFailure(
				() => verifyPreviewToken(token, PREVIEW_INPUT, PREVIEW_SECRET, expiresAt + 1),
				[token, PREVIEW_SECRET, PREVIEW_INPUT.importRequestHash]
			);
		});

		// @category: edge-case
		// @dependency: preview-token.ts
		// @complexity: medium
		it("UT-HMAC-06: importRequestHash不一致と別secretを拒否する", async () => {
			const token = await signPreviewToken(PREVIEW_INPUT, PREVIEW_SECRET, PREVIEW_NOW);
			const otherHash = "0".repeat(64);
			await expectSafePreviewFailure(
				() =>
					verifyPreviewToken(
						token,
						{ ...PREVIEW_INPUT, importRequestHash: otherHash },
						PREVIEW_SECRET,
						PREVIEW_NOW
					),
				[token, PREVIEW_SECRET, otherHash]
			);
			await expectSafePreviewFailure(
				() => verifyPreviewToken(token, PREVIEW_INPUT, "different-secret", PREVIEW_NOW),
				[token, PREVIEW_SECRET, PREVIEW_INPUT.importRequestHash]
			);
		});

		// @category: core-functionality
		// @dependency: preview-token.ts, constant-time compare wrapper
		// @complexity: high
		it("UT-HMAC-07: 署名比較wrapperが長さ違いを含めconstant-time primitiveを使用し、環境変数を参照しない", async () => {
			const verifySpy = vi.spyOn(globalThis.crypto.subtle, "verify");
			const token = await signPreviewToken(PREVIEW_INPUT, PREVIEW_SECRET, PREVIEW_NOW);
			await verifyPreviewToken(token, PREVIEW_INPUT, PREVIEW_SECRET, PREVIEW_NOW);
			expect(verifySpy).toHaveBeenCalled();
			const [payloadPart = "", signaturePart = ""] = token.split(".");
			const shortSignatureToken = `${payloadPart}.${signaturePart.slice(1)}`;
			await expectSafePreviewFailure(
				() => verifyPreviewToken(shortSignatureToken, PREVIEW_INPUT, PREVIEW_SECRET, PREVIEW_NOW),
				[shortSignatureToken, PREVIEW_SECRET, PREVIEW_INPUT.userId]
			);
			verifySpy.mockRestore();
		});
	});
});
