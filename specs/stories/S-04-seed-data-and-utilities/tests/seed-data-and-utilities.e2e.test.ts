// S-04 E2Eテスト - Design Doc: seed-data-and-utilities
// 生成日: 2026-02-24
// テスト種別: End-to-End Test
// 実装タイミング: 全実装完了後
//
// ACトレーサビリティ（Design AC）:
// - Scenario 1: AC-01, AC-02, AC-03, AC-04, AC-05
// - Scenario 2: AC-06
// - Scenario 3: AC-07, AC-08, AC-09, AC-10
// - Scenario 4: AC-11
// - Scenario 5: AC-12

import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import * as dateUtils from "../../../../frontend/src/lib/date"
import { queryRows, runSql, sqlLiteral } from "../../S-02-database-schema-rls/tests/helpers/s02-db-testkit"

interface CountRow {
	count: number
}

interface SeedPatternCountRow {
	pattern: string
	count: number
}

interface SeedPairCountRow {
	pair_count: number
}

interface SeedCardContractViolationRow {
	violation_count: number
}

interface SeedCardKeyRow {
	card_key: string
}

interface SeedProfileRow {
	user_id: string
	display_name: string
	timezone: string
	parent_mode_enabled: boolean
}

interface SeedDeckRow {
	id: string
	owner_user_id: string
	name: string
	new_limit_per_day: number
}

interface SeedTableCounts {
	cards: number
	decks: number
	deck_cards: number
	users_profile: number
}

const INVALID_DATE_ERROR_MESSAGE = "Invalid JST date format: expected YYYY-MM-DD"
const SEED_OWNER_USER_ID = "00000000-0000-4000-8000-000000000001"
const SEED_DECK_ID = "00000000-0000-4000-8000-0000000000d4"
const SEED_SQL_PATH = fileURLToPath(new URL("../../../../supabase/seed.sql", import.meta.url))

function loadSeedSql(): string {
	return readFileSync(SEED_SQL_PATH, "utf8")
}

function collectSeedTableCounts(seedDeckId: string, seedOwnerUserId: string): SeedTableCounts {
	const cards = queryRows<CountRow>(`
    SELECT COUNT(DISTINCT cards.id)::int AS count
    FROM public.cards
    INNER JOIN public.deck_cards
      ON deck_cards.card_id = cards.id
     AND deck_cards.deck_id = ${sqlLiteral(seedDeckId)}::uuid
  `)[0]?.count
	const decks = queryRows<CountRow>(`
    SELECT COUNT(*)::int AS count
    FROM public.decks
    WHERE id = ${sqlLiteral(seedDeckId)}::uuid
  `)[0]?.count
	const deckCards = queryRows<CountRow>(`
    SELECT COUNT(*)::int AS count
    FROM public.deck_cards
    WHERE deck_id = ${sqlLiteral(seedDeckId)}::uuid
  `)[0]?.count
	const usersProfile = queryRows<CountRow>(`
    SELECT COUNT(*)::int AS count
    FROM public.users_profile
    WHERE user_id = ${sqlLiteral(seedOwnerUserId)}::uuid
  `)[0]?.count

	return {
		cards: cards ?? 0,
		decks: decks ?? 0,
		deck_cards: deckCards ?? 0,
		users_profile: usersProfile ?? 0,
	}
}

function collectSeedCardKeys(seedDeckId: string): string[] {
	return queryRows<SeedCardKeyRow>(`
    SELECT cards.card_key
    FROM public.cards
    INNER JOIN public.deck_cards
      ON deck_cards.card_id = cards.id
     AND deck_cards.deck_id = ${sqlLiteral(seedDeckId)}::uuid
    ORDER BY cards.card_key
  `).map(({ card_key }) => card_key)
}

function assertSeedContracts(seedDeckId: string, seedOwnerUserId: string): void {
	const tableCounts = collectSeedTableCounts(seedDeckId, seedOwnerUserId)
	expect(tableCounts).toEqual({
		cards: 100,
		decks: 1,
		deck_cards: 100,
		users_profile: 1,
	})

  const patternCounts = queryRows<SeedPatternCountRow>(`
    SELECT pattern, COUNT(*)::int AS count
    FROM public.cards
    INNER JOIN public.deck_cards
      ON deck_cards.card_id = cards.id
     AND deck_cards.deck_id = ${sqlLiteral(seedDeckId)}::uuid
    WHERE pattern IN ('R1', 'W1')
    GROUP BY pattern
    ORDER BY pattern
  `)
	expect(patternCounts).toEqual([
		{ pattern: "R1", count: 50 },
		{ pattern: "W1", count: 50 },
	])

	const pairCount = queryRows<SeedPairCountRow>(`
    WITH normalized AS (
      SELECT
        CASE WHEN pattern = 'R1' THEN front_text ELSE back_text END AS vocab,
        CASE WHEN pattern = 'R1' THEN back_text ELSE front_text END AS reading,
        pattern
      FROM public.cards
      INNER JOIN public.deck_cards
        ON deck_cards.card_id = cards.id
       AND deck_cards.deck_id = ${sqlLiteral(seedDeckId)}::uuid
      WHERE pattern IN ('R1', 'W1')
    ),
    paired AS (
      SELECT vocab, reading
      FROM normalized
      GROUP BY vocab, reading
      HAVING COUNT(*) = 2
        AND bool_or(pattern = 'R1')
        AND bool_or(pattern = 'W1')
    )
    SELECT COUNT(*)::int AS pair_count
    FROM paired
  `)[0]
	expect(pairCount?.pair_count).toBe(50)

	const contractViolationCount = queryRows<SeedCardContractViolationRow>(`
    SELECT COUNT(*)::int AS violation_count
    FROM public.cards
    INNER JOIN public.deck_cards
      ON deck_cards.card_id = cards.id
     AND deck_cards.deck_id = ${sqlLiteral(seedDeckId)}::uuid
    WHERE visibility <> 'public'
      OR owner_user_id IS NOT NULL
      OR card_key !~ '^[0-9a-f]{64}$'
      OR card_key <> public.ai_compute_card_key(pattern, front_text, back_text)
      OR card_key <> public.ai_compute_card_key(
        pattern,
        U&'\\3000' || front_text || U&'\\3000',
        E'\\t' || back_text || E'\\n'
      )
  `)[0]
	expect(contractViolationCount?.violation_count).toBe(0)

	const uniqueKeyCount = queryRows<CountRow>(`
    SELECT COUNT(DISTINCT card_key)::int AS count
    FROM public.cards
    INNER JOIN public.deck_cards
      ON deck_cards.card_id = cards.id
     AND deck_cards.deck_id = ${sqlLiteral(seedDeckId)}::uuid
  `)[0]
	expect(uniqueKeyCount?.count).toBe(100)

	const profileRows = queryRows<SeedProfileRow>(`
    SELECT
      user_id::text AS user_id,
      display_name,
      timezone,
      parent_mode_enabled
    FROM public.users_profile
    WHERE user_id = ${sqlLiteral(seedOwnerUserId)}::uuid
  `)
	expect(profileRows).toEqual([
		{
			user_id: seedOwnerUserId,
			display_name: "Seed Owner",
			timezone: "Asia/Tokyo",
			parent_mode_enabled: false,
		},
	])

	const deckRows = queryRows<SeedDeckRow>(`
    SELECT
      id::text AS id,
      owner_user_id::text AS owner_user_id,
      name,
      new_limit_per_day
    FROM public.decks
    WHERE id = ${sqlLiteral(seedDeckId)}::uuid
  `)
	expect(deckRows).toEqual([
		{
			id: seedDeckId,
			owner_user_id: seedOwnerUserId,
			name: "小学3年生の漢字",
			new_limit_per_day: 10,
		},
	])

	const unlinkedSeedCardCount = queryRows<CountRow>(`
    WITH seed_cards AS (
      SELECT id
      FROM public.cards
      WHERE pattern IN ('R1', 'W1')
        AND visibility = 'public'
        AND owner_user_id IS NULL
    )
    SELECT COUNT(*)::int AS count
    FROM seed_cards
    LEFT JOIN public.deck_cards
      ON deck_cards.card_id = seed_cards.id
     AND deck_cards.deck_id = ${sqlLiteral(seedDeckId)}::uuid
    WHERE deck_cards.card_id IS NULL
  `)[0]
	expect(unlinkedSeedCardCount?.count).toBe(0)
}

function buildFailingSeedSql(seedSql: string, rollbackProbeCardKey: string): string {
	const probeInsert = `
INSERT INTO public.cards (
	owner_user_id,
	visibility,
	skill,
	pattern,
	front_text,
	back_text,
	illustration_key,
	card_key
)
VALUES (
	NULL,
	'public',
	'reading',
	'R1',
	'ROLLBACK_PROBE_FRONT',
	'ROLLBACK_PROBE_BACK',
	'ROLLBACK_PROBE',
	${sqlLiteral(rollbackProbeCardKey)}
);
`.trim()

	const probeInjectedSql = seedSql.replace(
		"INSERT INTO auth.users (",
		`${probeInsert}\n\nINSERT INTO auth.users (`
	)
	if (probeInjectedSql === seedSql) {
		throw new Error("Failed to inject rollback probe insert into seed.sql")
	}

	const failureInjectedSql = probeInjectedSql.replace(
		"ON CONFLICT (deck_id, card_id) DO NOTHING;",
		"ON CONFLICT (deck_id, card_id) DO NOTHING;\n\nSELECT 1 / 0;"
	)
	if (failureInjectedSql === probeInjectedSql) {
		throw new Error("Failed to inject forced failure into seed.sql")
	}

	return failureInjectedSql
}

describe("seed-data-and-utilities E2Eテスト", () => {
	const { addDaysJST, getTodayJST, getTomorrowJST, isBeforeOrEqualJST } = dateUtils

	// 実行順序: Scenario 1 - 日付ユーティリティ正常系の全体導線

	// AC原文トレース: AC-01, AC-02, AC-03, AC-04, AC-05
	// AC解釈: date utility の公開契約と UTC/JST・月跨ぎ・年跨ぎ・比較判定を実運用導線で一括確認する。
	// 検証: アプリケーション利用と同じ import 経路で関数を呼び、境界値出力を通しで検証する。
	// 期待結果: 4 関数の契約が維持され、各境界入力で期待値を返す。
	// 合格基準: 境界ケース（UTC/JST、月末、年末、比較）がすべて成功する。
	// @category: e2e
	// @dependency: full-system
	// @complexity: medium
	it("E2E-01: date.ts の 4 関数が公開契約を維持し、主要境界入力で正しい日付計算を返す", () => {
		expect(Object.keys(dateUtils)).toEqual(
			expect.arrayContaining(["getTodayJST", "getTomorrowJST", "addDaysJST", "isBeforeOrEqualJST"])
		)
		expect(getTodayJST(new Date("2026-02-23T15:00:00Z"))).toBe("2026-02-24")
		expect(getTomorrowJST("2026-02-28")).toBe("2026-03-01")
		expect(addDaysJST("2026-12-31", 1)).toBe("2027-01-01")
		expect(isBeforeOrEqualJST("2026-02-24", "2026-02-23")).toBe(false)
	})

	// 実行順序: Scenario 2 - 不正入力 fail-fast の全体導線

	// AC原文トレース: AC-06
	// AC解釈: 不正日付入力は UI/API 経由でも暗黙補正せず、例外で即停止する必要がある。
	// 検証: 不正フォーマットをエンドツーエンド経路で投入し、エラー伝播と処理停止を確認する。
	// 期待結果: 明示的例外が返り、不正計算は継続しない。
	// 合格基準: 不正入力ケースすべてで fail-fast が成立する。
	// @category: e2e
	// @dependency: full-system
	// @complexity: high
	it("E2E-02: addDaysJST/getTomorrowJST は不正日付入力で明示的例外を返し処理を継続しない", () => {
		expect(() => addDaysJST("2026/02/24", 1)).toThrowError(INVALID_DATE_ERROR_MESSAGE)
		expect(() => addDaysJST("2026-02-30", 1)).toThrowError(INVALID_DATE_ERROR_MESSAGE)
		expect(() => getTomorrowJST("not-a-date")).toThrowError(INVALID_DATE_ERROR_MESSAGE)
	})

	// 実行順序: Scenario 3 - seed 初回実行の完全疎通

	// AC原文トレース: AC-07, AC-08, AC-09, AC-10
	// AC解釈: `supabase db reset` 直後に owner/profile/cards/deck/deck_cards の契約が一連で成立する必要がある。
	// 検証: seed 実行後に cards/decks/deck_cards/users_profile/auth.users を横断照合する。
	// 期待結果: 50字 x 2 枚 = cards 100、seed deck 1、deck_cards 100、カード契約と固定 UUID upsert が成立する。
	// 合格基準: 件数・属性・関連の不整合が 0 件。
	// @category: e2e
	// @dependency: full-system
	// @complexity: high
	it("E2E-03: seed 初回実行で owner/profile/cards/deck/deck_cards が契約通りに構築される", () => {
		runSql(loadSeedSql())
		assertSeedContracts(SEED_DECK_ID, SEED_OWNER_USER_ID)
	})

	// 実行順序: Scenario 4 - seed 冪等再実行

	// AC原文トレース: AC-11
	// AC解釈: seed 再実行時に ON CONFLICT 戦略が効き、3 テーブル件数と S-10 card_key が不変である必要がある。
	// 検証: seed 2 回実行前後で cards/decks/deck_cards の件数と全 Seed card_key を確認する。
	// 期待結果: 件数差分がすべて 0 で、100件の card_key が同一。
	// 合格基準: 件数・card_key の冪等性違反 0 件。
	// @category: e2e
	// @dependency: full-system
	// @complexity: high
	it("E2E-04: seed を再実行しても cards/decks/deck_cards の件数が増えない", () => {
		const before = collectSeedTableCounts(SEED_DECK_ID, SEED_OWNER_USER_ID)
		const beforeCardKeys = collectSeedCardKeys(SEED_DECK_ID)

		runSql(loadSeedSql())

		const after = collectSeedTableCounts(SEED_DECK_ID, SEED_OWNER_USER_ID)
		expect(after).toEqual(before)
		expect(collectSeedCardKeys(SEED_DECK_ID)).toEqual(beforeCardKeys)
		expect(beforeCardKeys).toHaveLength(100)
	})

	// 実行順序: Scenario 5 - seed 失敗時ロールバック

	// AC原文トレース: AC-12
	// AC解釈: migration 不足または途中失敗時は明示的エラーを返し、トランザクション全体をロールバックする必要がある。
	// 検証: 失敗条件を注入して seed を実行し、エラー内容と rollback 後件数を確認する。
	// 期待結果: 不足テーブル/制約エラーを返し、cards/decks/deck_cards/users_profile に部分反映を残さない。
	// 合格基準: 失敗後件数が実行前と一致する。
	// @category: e2e
	// @dependency: full-system
	// @complexity: high
	it("E2E-05: seed 失敗時に単一トランザクションがロールバックされ部分成功状態を残さない", () => {
		const before = collectSeedTableCounts(SEED_DECK_ID, SEED_OWNER_USER_ID)
		const rollbackProbeCardKey = `rollback-probe-${randomUUID()}`
		const failingSeedSql = buildFailingSeedSql(loadSeedSql(), rollbackProbeCardKey)

		expect(() => runSql(failingSeedSql)).toThrowError(/division by zero/u)

		const after = collectSeedTableCounts(SEED_DECK_ID, SEED_OWNER_USER_ID)
		expect(after).toEqual(before)

		const rollbackProbeCards = queryRows<CountRow>(`
      SELECT COUNT(*)::int AS count
      FROM public.cards
      WHERE card_key = ${sqlLiteral(rollbackProbeCardKey)}
    `)[0]
		expect(rollbackProbeCards?.count).toBe(0)
	})
})
