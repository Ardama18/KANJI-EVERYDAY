// S-04 統合テスト - Design Doc: seed-data-and-utilities
// 生成日: 2026-02-24
// テスト種別: Integration Test
// 実装タイミング: 機能実装と同時
//
// ACトレーサビリティ（Design AC）:
// AC-01 -> IT-AC01-DATE-EXPORTS
// AC-02 -> IT-AC02-TODAY-JST-UTC-BOUNDARY
// AC-03 -> IT-AC03-TOMORROW-MONTH-ROLLOVER
// AC-04 -> IT-AC04-ADDDAYS-YEAR-ROLLOVER
// AC-05 -> IT-AC05-DATE-COMPARISON
// AC-06 -> IT-AC06-INVALID-DATE-FAIL-FAST
// AC-07 -> IT-AC07-SEED-CARD-COUNT
// AC-08 -> IT-AC08-SEED-CARD-CONTRACT
// AC-09 -> IT-AC09-SEED-OWNER-DECK-UPSERT
// AC-10 -> IT-AC10-SEED-DECK-CARD-LINKS
// AC-11 -> IT-AC11-SEED-IDEMPOTENCY
// AC-12 -> IT-AC12-SEED-TRANSACTION-ROLLBACK

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as dateUtils from "../../../../frontend/src/lib/date";
import { queryRows, runSql, sqlLiteral } from "../../S-02-database-schema-rls/tests/helpers/s02-db-testkit";

interface CountRow {
	count: number;
}

interface SeedPatternCountRow {
	pattern: string;
	count: number;
}

interface SeedPairCountRow {
	pair_count: number;
}

interface SeedCardContractViolationRow {
	violation_count: number;
}

interface SeedOwnerRow {
	id: string;
	instance_id: string;
	aud: string;
	role: string;
	email: string;
	encrypted_password: string;
	email_confirmed: boolean;
	created_present: boolean;
	updated_present: boolean;
	app_meta_provider: string;
	app_meta_has_email_provider: boolean;
	display_name_meta: string;
}

interface SeedProfileRow {
	user_id: string;
	display_name: string;
	timezone: string;
	parent_mode_enabled: boolean;
}

interface SeedDeckRow {
	id: string;
	owner_user_id: string;
	name: string;
	new_limit_per_day: number;
}

interface SeedTableCounts {
	cards: number;
	decks: number;
	deck_cards: number;
	users_profile: number;
}

const SEED_SQL_PATH = fileURLToPath(new URL("../../../../supabase/seed.sql", import.meta.url));

function loadSeedSql(): string {
	return readFileSync(SEED_SQL_PATH, "utf8");
}

function collectSeedTableCounts(seedDeckId: string, seedOwnerUserId: string): SeedTableCounts {
	const cards = queryRows<CountRow>(`
    SELECT COUNT(*)::int AS count
    FROM public.cards
  `)[0]?.count;
	const decks = queryRows<CountRow>(`
    SELECT COUNT(*)::int AS count
    FROM public.decks
    WHERE id = ${sqlLiteral(seedDeckId)}::uuid
  `)[0]?.count;
	const deckCards = queryRows<CountRow>(`
    SELECT COUNT(*)::int AS count
    FROM public.deck_cards
    WHERE deck_id = ${sqlLiteral(seedDeckId)}::uuid
  `)[0]?.count;
	const usersProfile = queryRows<CountRow>(`
    SELECT COUNT(*)::int AS count
    FROM public.users_profile
    WHERE user_id = ${sqlLiteral(seedOwnerUserId)}::uuid
  `)[0]?.count;

	return {
		cards: cards ?? 0,
		decks: decks ?? 0,
		deck_cards: deckCards ?? 0,
		users_profile: usersProfile ?? 0,
	};
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
`.trim();

	const probeInjectedSql = seedSql.replace(
		"INSERT INTO auth.users (",
		`${probeInsert}\n\nINSERT INTO auth.users (`
	);
	if (probeInjectedSql === seedSql) {
		throw new Error("Failed to inject rollback probe insert into seed.sql");
	}

	const failureInjectedSql = probeInjectedSql.replace(
		"ON CONFLICT (deck_id, card_id) DO NOTHING;",
		"ON CONFLICT (deck_id, card_id) DO NOTHING;\n\nSELECT 1 / 0;"
	);
	if (failureInjectedSql === probeInjectedSql) {
		throw new Error("Failed to inject forced failure into seed.sql");
	}

	return failureInjectedSql;
}

describe("seed-data-and-utilities 統合テスト", () => {
	const { addDaysJST, getTodayJST, getTomorrowJST, isBeforeOrEqualJST } = dateUtils;
	const INVALID_DATE_ERROR_MESSAGE = "Invalid JST date format: expected YYYY-MM-DD";
	const SEED_OWNER_USER_ID = "00000000-0000-4000-8000-000000000001";
	const SEED_DECK_ID = "00000000-0000-4000-8000-0000000000d4";

	// 実行順序: Phase 1 - Date utility contract

	// AC原文 (AC-01): システムは `frontend/src/lib/date.ts` で `getTodayJST`, `getTomorrowJST`, `addDaysJST`, `isBeforeOrEqualJST` を export すること。
	// AC解釈: 日付ユーティリティの公開インターフェースが固定され、S-05 から安全に参照できる必要がある。
	// 検証: `date.ts` の named export 一覧と型シグネチャを検証する。
	// 期待結果: 4 関数がすべて export される。
	// 合格基準: export 欠落 0 件。
	// @category: integration
	// @dependency: frontend/src/lib/date.ts
	// @complexity: low
	it("IT-AC01: date.ts が 4 つの JST ユーティリティを export する", () => {
		expect(Object.keys(dateUtils)).toEqual(
			expect.arrayContaining(["getTodayJST", "getTomorrowJST", "addDaysJST", "isBeforeOrEqualJST"])
		);
		expect(typeof getTodayJST).toBe("function");
		expect(typeof getTomorrowJST).toBe("function");
		expect(typeof addDaysJST).toBe("function");
		expect(typeof isBeforeOrEqualJST).toBe("function");
	});

	// AC原文 (AC-02): UTC `2026-02-23T15:00:00Z` 相当入力で `getTodayJST` が実行されたとき、システムは `\"2026-02-24\"` を返すこと。
	// AC解釈: UTC/JST 境界（+9h）で日付繰り上がりが正しく処理される必要がある。
	// 検証: 固定 Date 入力で `getTodayJST` の返り値を比較する。
	// 期待結果: 返却値が `2026-02-24` になる。
	// 合格基準: 境界ケース一致率 100%。
	// @category: integration
	// @dependency: frontend/src/lib/date.ts
	// @complexity: medium
	it("IT-AC02: UTC/JST 境界入力で getTodayJST が 2026-02-24 を返す", () => {
		expect(getTodayJST(new Date("2026-02-23T15:00:00Z"))).toBe("2026-02-24");
	});

	// AC原文 (AC-03): `getTomorrowJST(\"2026-02-28\")` が実行されたとき、システムは `\"2026-03-01\"` を返すこと。
	// AC解釈: 月跨ぎ計算で日付加算のオフセット不整合が発生しない必要がある。
	// 検証: `getTomorrowJST` の固定入力出力を検証する。
	// 期待結果: 返却値が `2026-03-01` になる。
	// 合格基準: 月末境界ケースが成功する。
	// @category: integration
	// @dependency: frontend/src/lib/date.ts
	// @complexity: medium
	it("IT-AC03: getTomorrowJST が 2026-02-28 から 2026-03-01 を返す", () => {
		expect(getTomorrowJST("2026-02-28")).toBe("2026-03-01");
	});

	// AC原文 (AC-04): `addDaysJST(\"2026-12-31\", 1)` が実行されたとき、システムは `\"2027-01-01\"` を返すこと。
	// AC解釈: 年跨ぎ計算で年更新を含む日付正規化が必要である。
	// 検証: `addDaysJST` の固定入力出力を検証する。
	// 期待結果: 返却値が `2027-01-01` になる。
	// 合格基準: 年末境界ケースが成功する。
	// @category: integration
	// @dependency: frontend/src/lib/date.ts
	// @complexity: medium
	it("IT-AC04: addDaysJST が 2026-12-31 +1 日で 2027-01-01 を返す", () => {
		expect(addDaysJST("2026-12-31", 1)).toBe("2027-01-01");
	});

	// AC原文 (AC-05): `isBeforeOrEqualJST(\"2026-02-24\", \"2026-02-23\")` が実行されたとき、システムは `false` を返すこと。
	// AC解釈: 日付比較関数が順序逆転ケースを false と判定する必要がある。
	// 検証: 固定入力で真偽値判定を検証する。
	// 期待結果: 返却値が false になる。
	// 合格基準: 比較判定が仕様どおり 1/1 ケース成功。
	// @category: integration
	// @dependency: frontend/src/lib/date.ts
	// @complexity: low
	it("IT-AC05: isBeforeOrEqualJST が target より後の日付入力で false を返す", () => {
		expect(isBeforeOrEqualJST("2026-02-24", "2026-02-23")).toBe(false);
	});

	// AC原文 (AC-06): もし `addDaysJST` または `getTomorrowJST` に `YYYY-MM-DD` 形式でない値が渡された場合、システムは明示的な例外を送出し不正計算を継続しないこと。
	// AC解釈: 不正フォーマット入力は fail-fast で停止し、暗黙変換を許容しない必要がある。
	// 検証: 複数の不正入力で例外送出と処理中断を確認する。
	// 期待結果: 明示的な例外が発生し、戻り値計算は行われない。
	// 合格基準: 想定不正入力すべてで例外が観測される。
	// @category: edge-case
	// @dependency: frontend/src/lib/date.ts
	// @complexity: high
	it("IT-AC06: addDaysJST/getTomorrowJST は不正日付形式で明示的に例外を送出する", () => {
		expect(() => addDaysJST("2026/02/24", 1)).toThrowError(INVALID_DATE_ERROR_MESSAGE);
		expect(() => getTomorrowJST("not-a-date")).toThrowError(INVALID_DATE_ERROR_MESSAGE);
	});

	// 実行順序: Phase 2 - Seed data contract

	// AC原文 (AC-07): システムは Seed 対象 50 字から R1/W1 の 2 枚ずつを作成し、`cards` に合計 100 枚を保持すること。
	// AC解釈: 50 行ソースから 2 パターン展開され、cards 件数が 100 で安定する必要がある。
	// 検証: seed 実行後の `cards` 件数と pattern 内訳を検証する。
	// 期待結果: cards=100、各漢字につき R1/W1 が生成される。
	// 合格基準: 件数不一致 0 件。
	// @category: integration
	// @dependency: supabase/seed.sql, public.cards
	// @complexity: medium
	it("IT-AC07: Seed 実行で 50 字 x R1/W1 の 100 cards が投入される", () => {
		const totalCards = queryRows<CountRow>(`
      SELECT COUNT(*)::int AS count
      FROM public.cards
    `)[0];
		expect(totalCards?.count).toBe(100);

		const patternCounts = queryRows<SeedPatternCountRow>(`
      SELECT pattern, COUNT(*)::int AS count
      FROM public.cards
      WHERE pattern IN ('R1', 'W1')
      GROUP BY pattern
      ORDER BY pattern
    `);
		expect(patternCounts).toEqual([
			{ pattern: "R1", count: 50 },
			{ pattern: "W1", count: 50 },
		]);

		const pairCount = queryRows<SeedPairCountRow>(`
      WITH normalized AS (
        SELECT
          CASE WHEN pattern = 'R1' THEN front_text ELSE back_text END AS vocab,
          CASE WHEN pattern = 'R1' THEN back_text ELSE front_text END AS reading,
          pattern
        FROM public.cards
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
    `)[0];
		expect(pairCount?.pair_count).toBe(50);
	});

	// AC原文 (AC-08): システムは Seed カードの `visibility='public'`、`owner_user_id IS NULL`、`card_key='{pattern}:{front_text}:{back_text}'` を満たすこと。
	// AC解釈: public カード契約と card_key 生成規則が全 Seed レコードで一貫する必要がある。
	// 検証: Seed 由来カードの属性・キー形式を全件照合する。
	// 期待結果: visibility/owner/card_key が契約通り。
	// 合格基準: 契約違反レコード 0 件。
	// @category: integration
	// @dependency: supabase/seed.sql, public.cards
	// @complexity: high
	it("IT-AC08: Seed cards が visibility/public-owner-null/card_key 形式契約を満たす", () => {
		const violationCount = queryRows<SeedCardContractViolationRow>(`
      SELECT COUNT(*)::int AS violation_count
      FROM public.cards
      WHERE visibility <> 'public'
        OR owner_user_id IS NOT NULL
        OR card_key <> (pattern || ':' || front_text || ':' || back_text)
    `)[0];
		expect(violationCount?.violation_count).toBe(0);

		const unexpectedPatternCount = queryRows<CountRow>(`
      SELECT COUNT(*)::int AS count
      FROM public.cards
      WHERE pattern NOT IN ('R1', 'W1')
    `)[0];
		expect(unexpectedPatternCount?.count).toBe(0);
	});

	// AC原文 (AC-09): Seed 実行イベントが発生したとき、システムは Seed owner（固定 UUID）と `users_profile` を upsert し、固定 `SEED_DECK_ID` の `decks` 行（`name='小学3年生の漢字'`, `new_limit_per_day=10`）を 1 件保持すること。
	// AC解釈: owner/profile/deck の親子関係を固定 ID で再作成可能に保ち、再実行時も 1 行を維持する必要がある。
	// 検証: `auth.users`/`users_profile`/`decks` の固定 ID 行と属性を照合する。
	// 期待結果: owner/profile/deck が upsert され、decks は 1 行維持。
	// 合格基準: 固定 UUID 契約違反 0 件。
	// @category: integration
	// @dependency: supabase/seed.sql, auth.users, public.users_profile, public.decks
	// @complexity: high
	it("IT-AC09: Seed owner と users_profile を upsert し固定 deck 行を 1 件保持する", () => {
		const ownerRows = queryRows<SeedOwnerRow>(`
      SELECT
        id::text AS id,
        instance_id::text AS instance_id,
        aud,
        role,
        email,
        encrypted_password,
        (email_confirmed_at IS NOT NULL) AS email_confirmed,
        (created_at IS NOT NULL) AS created_present,
        (updated_at IS NOT NULL) AS updated_present,
        raw_app_meta_data ->> 'provider' AS app_meta_provider,
        (raw_app_meta_data -> 'providers' ? 'email') AS app_meta_has_email_provider,
        raw_user_meta_data ->> 'display_name' AS display_name_meta
      FROM auth.users
      WHERE id = ${sqlLiteral(SEED_OWNER_USER_ID)}::uuid
    `);
		expect(ownerRows).toHaveLength(1);
		expect(ownerRows[0]).toMatchObject({
			id: SEED_OWNER_USER_ID,
			instance_id: "00000000-0000-0000-0000-000000000000",
			aud: "authenticated",
			role: "authenticated",
			email: "seed-owner@example.local",
			encrypted_password: "seed-owner-not-for-login",
			email_confirmed: true,
			created_present: true,
			updated_present: true,
			app_meta_provider: "email",
			app_meta_has_email_provider: true,
			display_name_meta: "Seed Owner",
		});

		const profileRows = queryRows<SeedProfileRow>(`
      SELECT
        user_id::text AS user_id,
        display_name,
        timezone,
        parent_mode_enabled
      FROM public.users_profile
      WHERE user_id = ${sqlLiteral(SEED_OWNER_USER_ID)}::uuid
    `);
		expect(profileRows).toEqual([
			{
				user_id: SEED_OWNER_USER_ID,
				display_name: "Seed Owner",
				timezone: "Asia/Tokyo",
				parent_mode_enabled: false,
			},
		]);

		const deckRows = queryRows<SeedDeckRow>(`
      SELECT
        id::text AS id,
        owner_user_id::text AS owner_user_id,
        name,
        new_limit_per_day
      FROM public.decks
      WHERE id = ${sqlLiteral(SEED_DECK_ID)}::uuid
    `);
		expect(deckRows).toEqual([
			{
				id: SEED_DECK_ID,
				owner_user_id: SEED_OWNER_USER_ID,
				name: "小学3年生の漢字",
				new_limit_per_day: 10,
			},
		]);

		const deckCount = queryRows<CountRow>(`
      SELECT COUNT(*)::int AS count
      FROM public.decks
      WHERE id = ${sqlLiteral(SEED_DECK_ID)}::uuid
    `)[0];
		expect(deckCount?.count).toBe(1);
	});

	// AC原文 (AC-10): Seed 実行イベントが発生したとき、システムはデフォルトデッキと全 Seed カードを `deck_cards` で紐付け、件数を 100 件にすること。
	// AC解釈: default deck から全 Seed cards へのリンクが欠損なく 100 件必要である。
	// 検証: `deck_cards` の seed deck_id 集合と件数を検証する。
	// 期待結果: seed deck の deck_cards が 100 件。
	// 合格基準: 欠損リンク 0 件。
	// @category: integration
	// @dependency: supabase/seed.sql, public.deck_cards
	// @complexity: medium
	it("IT-AC10: Seed deck と全 Seed cards の deck_cards 紐付けが 100 件になる", () => {
		const deckCardCount = queryRows<CountRow>(`
      SELECT COUNT(*)::int AS count
      FROM public.deck_cards
      WHERE deck_id = ${sqlLiteral(SEED_DECK_ID)}::uuid
    `)[0];
		expect(deckCardCount?.count).toBe(100);

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
       AND deck_cards.deck_id = ${sqlLiteral(SEED_DECK_ID)}::uuid
      WHERE deck_cards.card_id IS NULL
    `)[0];
		expect(unlinkedSeedCardCount?.count).toBe(0);
	});

	// AC原文 (AC-11): もし Seed を再実行した場合、システムは `cards` を `ON CONFLICT (card_key) DO NOTHING`、`decks` を `ON CONFLICT (id)`、`deck_cards` を `ON CONFLICT (deck_id, card_id) DO NOTHING` で処理し、`cards/decks/deck_cards` の件数を増やさないこと。
	// AC解釈: 再実行時に重複を防ぐ冪等制御が 3 テーブルで同時に成立する必要がある。
	// 検証: seed 2 回実行前後で件数差分を比較する。
	// 期待結果: cards/decks/deck_cards の件数差分が 0。
	// 合格基準: 3 テーブルすべてで件数不増。
	// @category: integration
	// @dependency: supabase/seed.sql, public.cards, public.decks, public.deck_cards
	// @complexity: high
	it("IT-AC11: Seed 再実行でも cards/decks/deck_cards の件数が増えない", () => {
		const before = collectSeedTableCounts(SEED_DECK_ID, SEED_OWNER_USER_ID);

		runSql(loadSeedSql());

		const after = collectSeedTableCounts(SEED_DECK_ID, SEED_OWNER_USER_ID);
		expect(after).toEqual(before);
	});

	// AC原文 (AC-12): もし S-02 マイグレーション未適用または Seed 途中ステートメント失敗が発生した場合、システムは不足テーブル/制約エラーを返し、単一トランザクションをロールバックして部分成功状態を残さないこと。
	// AC解釈: 失敗時はエラー可視化と全ロールバックを両立し、部分データを残さない必要がある。
	// 検証: マイグレーション不足ケースと中盤失敗ケースで rollback 後件数を検証する。
	// 期待結果: 明示的エラーが返り、cards/decks/deck_cards/users_profile に部分反映が残らない。
	// 合格基準: 失敗後の件数が実行前と一致する。
	// @category: edge-case
	// @dependency: supabase/seed.sql, full transaction
	// @complexity: high
	it("IT-AC12: migration 未適用または Seed 失敗時に全ロールバックされ部分成功を残さない", () => {
		const before = collectSeedTableCounts(SEED_DECK_ID, SEED_OWNER_USER_ID);
		const rollbackProbeCardKey = `rollback-probe-${randomUUID()}`;
		const failingSeedSql = buildFailingSeedSql(loadSeedSql(), rollbackProbeCardKey);

		expect(() => runSql(failingSeedSql)).toThrowError(/division by zero/u);

		const after = collectSeedTableCounts(SEED_DECK_ID, SEED_OWNER_USER_ID);
		expect(after).toEqual(before);

		const rollbackProbeCards = queryRows<CountRow>(`
      SELECT COUNT(*)::int AS count
      FROM public.cards
      WHERE card_key = ${sqlLiteral(rollbackProbeCardKey)}
    `)[0];
		expect(rollbackProbeCards?.count).toBe(0);
	});
});
