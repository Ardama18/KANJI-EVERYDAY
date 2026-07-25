// S-16H T4-3: claim_ai_import_concept が承認済み slots を返す migration の SQL 契約テスト。
// `owner-fix-migration-contract.test.ts` と同じ read + normalize 方式。
// 設計根拠: specs/stories/S-16H-worker-mnemonic-prompt/design.md D1。

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = resolve(process.cwd(), "../supabase/migrations");
const S16H_MIGRATION_FILE = "20260725000000_s16h_claim_returns_mnemonic_slots.sql";
const S11_MIGRATION_FILE = "20260715000000_s11_ai_card_async_processing.sql";

const readSql = (file: string): string => readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
// -- 行コメントを除いた実行 SQL だけを対象にする（コメント中の語句を誤検知しない）
const stripComments = (sql: string): string => sql.replace(/--[^\n]*/g, "");
const normalizeSql = (sql: string): string => stripComments(sql).replace(/\s+/g, " ").toLowerCase();
// plpgsql の関数本体（$$ ... $$）は呼び出し時に実行される。migration 実行時の DDL / DML を
// 検査するときは本体を除いた「トップレベルの文」だけを見る。
const FUNCTION_BODY_PLACEHOLDER = "__function_body__";
const stripFunctionBody = (sql: string): string =>
	sql.replace(/\$\$[\s\S]*?\$\$/g, ` ${FUNCTION_BODY_PLACEHOLDER} `);

const s16hSql = readSql(S16H_MIGRATION_FILE);
const normalized = normalizeSql(s16hSql);
const topLevel = normalizeSql(stripFunctionBody(s16hSql));

describe("S-16H claim_ai_import_concept migration contract", () => {
	// 検証項目 1: CREATE OR REPLACE で再定義し、DROP しない（service_role の EXECUTE GRANT を保つ）
	it("CREATE OR REPLACE で claim_ai_import_concept を再定義し DROP FUNCTION を書かない", () => {
		expect(normalized).toContain("create or replace function public.claim_ai_import_concept");
		expect(normalized).not.toContain("drop function");
		expect(normalized).toContain(
			"returns jsonb language plpgsql security definer set search_path = pg_catalog, pg_temp"
		);
		expect(normalized).toContain("perform public.ai_s11_require_service_role();");
	});

	// 検証項目 2: slots 取得は owner-scope かつ承認済みのみ（draft は使わない）
	it("card_mnemonics の join が owner-scope で status='approved' に限定される", () => {
		expect(normalized).toContain("declare mnemonic_slots jsonb;");
		expect(normalized).toContain("if representative.image_mode = 'ai' then");
		expect(normalized).toContain("select mnemonics.slots into mnemonic_slots");
		expect(normalized).toContain("from public.card_mnemonics as mnemonics");
		expect(normalized).toContain("join public.illustrations as ill");
		expect(normalized).toContain("on ill.illustration_key = mnemonics.illustration_key");
		expect(normalized).toContain("and ill.owner_user_id = mnemonics.owner_user_id");
		expect(normalized).toContain("where ill.id = job.illustration_id");
		expect(normalized).toContain("and mnemonics.owner_user_id = job.owner_user_id");
		expect(normalized).toContain("and mnemonics.status = 'approved'");
	});

	// 検証項目 3: 返り値に mnemonicSlots を追加し、既存キーの契約を保持する
	it("返り値に 'mnemonicSlots' を追加し既存キーを保持する", () => {
		expect(normalized).toContain("'mnemonicslots'");
		for (const key of [
			"'outcome'",
			"'jobid'",
			"'batchid'",
			"'claimtoken'",
			"'attempt'",
			"'imagemode'",
			"'backtext'",
			"'skill'",
			"'sourcepath'",
			"'sourcebucket'",
			"'sourcemime'",
			"'illustrationid'",
			"'illustrationpath'",
		]) {
			expect(normalized).toContain(key);
		}
		// 未承認時にキー自体が現れないよう jsonb_strip_nulls を維持する
		expect(normalized).toContain("return jsonb_strip_nulls(jsonb_build_object(");
	});

	// 検証項目 4: SECURITY DEFINER の実行 identity を明示的に固定する
	it("owner を s10_migration_owner に冪等再宣言する", () => {
		expect(normalized).toContain(
			"alter function public.claim_ai_import_concept(uuid,bigint,uuid) owner to s10_migration_owner"
		);
	});

	// 検証項目 5: 権限とデータに触らない
	it("grant / revoke / policy / table / データ更新文を含まない", () => {
		for (const forbidden of [
			"grant",
			"revoke",
			"create policy",
			"drop policy",
			"alter policy",
			"alter table",
			"create table",
			"drop table",
			"create trigger",
			"drop trigger",
			"truncate",
			"enable row level security",
			"disable row level security",
		]) {
			expect(normalized, `${forbidden} を含んではいけない`).not.toContain(forbidden);
		}
		// 関数本体内の UPDATE は claim 時の状態遷移（S-11 由来）。migration 実行時に走る
		// トップレベルの DML が無いことを検査する。
		for (const forbidden of ["update public.", "delete from", "insert into"]) {
			expect(topLevel, `${forbidden} を migration 実行時に走らせてはいけない`).not.toContain(
				forbidden
			);
		}
		// トップレベルは関数の再定義と owner 固定の 2 文のみ
		const expectedTopLevel = [
			"create or replace function public.claim_ai_import_concept(",
			"p_job_id uuid, p_message_id bigint, p_claim_token uuid )",
			"returns jsonb language plpgsql security definer",
			"set search_path = pg_catalog, pg_temp as",
			FUNCTION_BODY_PLACEHOLDER,
			"; alter function public.claim_ai_import_concept(uuid,bigint,uuid)",
			"owner to s10_migration_owner;",
		].join(" ");
		expect(topLevel.replace(/\s+/g, " ").trim()).toBe(expectedTopLevel);
	});

	// 検証項目 6: timestamp prefix が既存 migration と衝突しない
	it("timestamp prefix 20260725000000 が既存 migration と衝突しない", () => {
		const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql"));
		const prefix = S16H_MIGRATION_FILE.slice(0, 14);
		const samePrefix = files.filter((file) => file.startsWith(prefix));

		expect(files).toContain(S16H_MIGRATION_FILE);
		expect(samePrefix).toEqual([S16H_MIGRATION_FILE]);
		// 既存の最大 prefix より後に並ぶ
		const others = files.filter((file) => file !== S16H_MIGRATION_FILE).sort();
		expect(prefix > (others[others.length - 1]?.slice(0, 14) ?? "")).toBe(true);
	});
});

describe("S-16H が S-11 claim_ai_import_concept 本体を保持する（状態機械の回帰防止）", () => {
	// 検証項目 7: 関数本体は S-16H の 3 つの追加を除いて S-11 と 1 文字も違わない
	it("追加は DECLARE 1 行 / owner-scope join / 返り値 1 キーのみ", () => {
		const s11Lines = readSql(S11_MIGRATION_FILE).split("\n");
		const s11Start = s11Lines.findIndex((line) =>
			line.startsWith("CREATE OR REPLACE FUNCTION public.claim_ai_import_concept")
		);
		const s11End = s11Lines.indexOf("$$;", s11Start);
		const s11Body = s11Lines.slice(s11Start, s11End + 1);

		const s16hLines = s16hSql.split("\n");
		const s16hStart = s16hLines.findIndex((line) =>
			line.startsWith("CREATE OR REPLACE FUNCTION public.claim_ai_import_concept")
		);
		const s16hEnd = s16hLines.indexOf("$$;", s16hStart);
		const reverted = s16hLines.slice(s16hStart, s16hEnd + 1);

		// (a) DECLARE mnemonic_slots jsonb;
		const declareIndex = reverted.indexOf("DECLARE mnemonic_slots jsonb;");
		expect(declareIndex).toBeGreaterThan(0);
		reverted.splice(declareIndex, 1);

		// (b) image_mode='ai' 時の owner-scope join ブロック（コメント〜END IF; と直後の空行）
		const joinStart = reverted.findIndex((line) => line.includes("SELECT mnemonics.slots"));
		const blockStart = joinStart - 2; // コメント行と IF 行
		const blockEnd = reverted.indexOf("  END IF;", joinStart);
		expect(blockStart).toBeGreaterThan(0);
		expect(blockEnd).toBeGreaterThan(joinStart);
		reverted.splice(blockStart, blockEnd - blockStart + 2);

		// (c) 返り値の mnemonicSlots キー
		const keyIndex = reverted.findIndex((line) => line.includes("mnemonicSlots"));
		expect(keyIndex).toBeGreaterThan(0);
		reverted.splice(keyIndex, 1);

		expect(reverted).toEqual(s11Body);
	});
});
