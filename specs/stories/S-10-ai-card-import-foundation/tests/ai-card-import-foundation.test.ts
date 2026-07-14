// S-10 Unitテストスケルトン - Design Doc: ai-card-import-foundation v1.1.1 (Approved)
// 生成日: 2026-07-14
// テスト種別: Unit Test（純粋TypeScript契約）
// 実装タイミング: shared domain実装と同時（Red -> Green -> Refactor）
//
// 対象: schema / Unicode normalization / card-key / preview HMAC /
//       generation reservation hash / canonical import hash
// 制約: production module未実装のため、後続task-executorがfixtureとimportを追加して完成させる。

import { describe, expect, it } from "vitest";

import {
	buildCardKeyMaterial,
	computeCardKey,
	type CardKeyInput,
} from "@/lib/ai-import/card-key";
import {
	canonicalizeGenerationRequest,
	canonicalizeImportRequest,
	hashGenerationRequest,
	hashImportRequest,
} from "@/lib/ai-import/canonical-request";
import { normalizeDisplayText, normalizeForKey } from "@/lib/ai-import/normalize";
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

describe("S-10 AIカード登録基盤 Unit契約", () => {
	describe("Stage 1 schema", () => {
		// AC原文 (AC-06/06a): Stage 1対象条件を不正にしたとき永続化を行わず、1〜50枚、clientItemId、tag境界を個別に拒否する。
		// 検証/期待結果/合格基準: unknown入力を全件検査し、field path付きissueを返し、成功時だけbranded normalized typeを返す。
		// @category: core-functionality
		// @dependency: frontend/src/lib/ai-import/schema.ts
		// @complexity: high
		it.todo("UT-SCHEMA-01: unknown入力のshape違反を全件収集し、field path付きissueとして返す");

		// @category: edge-case
		// @dependency: schema.ts
		// @complexity: medium
		it.todo("UT-SCHEMA-02: items件数1件と50件を受理し、0件と51件をVALIDATION_ERRORで拒否する");

		// @category: edge-case
		// @dependency: schema.ts
		// @complexity: medium
		it.todo("UT-SCHEMA-03: clientItemId長1/64を受理し、空文字/65文字とrequest内重複を拒否する");

		// @category: core-functionality
		// @dependency: schema.ts
		// @complexity: high
		it.todo("UT-SCHEMA-04: R1はreadingかつfrontが漢字側、W1はwritingかつbackが漢字側である契約を強制する");

		// @category: edge-case
		// @dependency: schema.ts, Han-script fixture
		// @complexity: medium
		it.todo("UT-SCHEMA-05: 漢字側にUnicode Script=Han文字がないitemを拒否し、astral planeのHan文字を受理する");

		// @category: core-functionality
		// @dependency: schema.ts
		// @complexity: high
		it.todo("UT-SCHEMA-06: 同一conceptのR1/W1を各最大1件に制限し、front/back相互一致しないpairを拒否する");

		// @category: edge-case
		// @dependency: schema.ts, normalize.ts
		// @complexity: medium
		it.todo("UT-SCHEMA-07: tag件数0/10と長さ1/30を受理し、11件・空・31文字・正規化後重複を拒否する");

		// @category: core-functionality
		// @dependency: schema.ts
		// @complexity: medium
		it.todo("UT-SCHEMA-08: deckのid/name/createを排他的unionとして検証し、複数指定または未指定を拒否する");

		// @category: core-functionality
		// @dependency: schema.ts
		// @complexity: medium
		it.todo("UT-SCHEMA-09: imageのnone/ai/upload判別unionを検証し、upload以外のuploadIdとuploadのID欠落を拒否する");

		// @category: edge-case
		// @dependency: schema.ts
		// @complexity: medium
		it.todo("UT-SCHEMA-10: client入力のsource・quota免除flag・未知fieldを受理せずtrusted contextとの境界を守る");
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
				expect(normalizeDisplayText(`${whiteSpace}漢${whiteSpace}${whiteSpace}字${whiteSpace}`)).toBe(
					vector?.expected
				);
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
			const digests = await Promise.all(vectors.map((vector) => hashGenerationRequest(vector.input)));
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
			const baseline = requireFixtureById(canonicalFixture.importVectors, "ordinal-and-normalized-tag-order");
			const ordinalDifference = requireFixtureById(canonicalFixture.importVectors, "ordinal-difference");
			expect(canonicalizeImportRequest(baseline.input)).toBe(baseline.canonicalJson);
			expect(canonicalizeImportRequest(ordinalDifference.input)).toBe(ordinalDifference.canonicalJson);
			expect(await hashImportRequest(ordinalDifference.input)).not.toBe(baseline.expectedSha256Hex);
		});

		// @category: core-functionality
		// @dependency: canonical-request.ts
		// @complexity: high
		it("UT-HASH-05: UUID lowercase化・integer表現・optional key省略・無空白JSONをUTF-8 SHA-256化する", async () => {
			const generation = requireFixtureById(canonicalFixture.generationVectors, "baseline");
			const importRequest = requireFixtureById(canonicalFixture.importVectors, "ordinal-and-normalized-tag-order");
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
		it.todo("UT-HMAC-01: v1/userId/reservationKey/importRequestHash/expiresAtをcanonical payloadとして署名し1800秒TTLを設定する");

		// @category: core-functionality
		// @dependency: preview-token.ts
		// @complexity: medium
		it.todo("UT-HMAC-02: 正しいsecret・期待payload・期限内nowでbase64url tokenを検証できる");

		// @category: edge-case
		// @dependency: preview-token.ts
		// @complexity: high
		it.todo("UT-HMAC-03: payloadまたは署名の1 byte改ざんと不正token形式/versionを拒否する");

		// @category: edge-case
		// @dependency: preview-token.ts
		// @complexity: medium
		it.todo("UT-HMAC-04: userIdまたはreservationKey不一致を拒否する");

		// @category: edge-case
		// @dependency: preview-token.ts
		// @complexity: medium
		it.todo("UT-HMAC-05: expiresAt境界は期限内最終秒を受理し、期限超過を拒否する");

		// @category: edge-case
		// @dependency: preview-token.ts
		// @complexity: medium
		it.todo("UT-HMAC-06: importRequestHash不一致と別secretを拒否する");

		// @category: core-functionality
		// @dependency: preview-token.ts, constant-time compare wrapper
		// @complexity: high
		it.todo("UT-HMAC-07: 署名比較wrapperが長さ違いを含めconstant-time primitiveを使用し、環境変数を参照しない");
	});
});
