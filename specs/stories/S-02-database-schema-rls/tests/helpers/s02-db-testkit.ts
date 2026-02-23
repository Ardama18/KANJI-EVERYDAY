import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const DEFAULT_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export interface AuthUserFixture {
  userId: string;
  email: string;
}

export type RlsRole = "anon" | "authenticated";

export interface RlsSession {
  role: RlsRole;
  userId: string | null;
}

function getDatabaseUrl(): string {
  return (
    process.env.S02_TEST_DATABASE_URL ??
    process.env.SUPABASE_DB_URL ??
    process.env.DATABASE_URL ??
    DEFAULT_DATABASE_URL
  );
}

function trimTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;\s*$/u, "");
}

function psql(args: string[]): string {
  const baseArgs = [
    getDatabaseUrl(),
    "-v",
    "ON_ERROR_STOP=1",
    "-X",
    "-A",
    "-t",
    "-q",
  ];

  try {
    return execFileSync("psql", [...baseArgs, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        PGAPPNAME: "s02-schema-rls-tests",
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`psql command failed: ${reason}`);
  }
}

function queryRowsFromStatement<T extends Record<string, unknown>>(statement: string): T[] {
  const wrappedQuery = `
    WITH result_row AS (
      ${statement}
    )
    SELECT COALESCE(json_agg(row_to_json(result_row)), '[]'::json)::text AS data
    FROM result_row
  `;
  const output = psql(["-c", wrappedQuery]).trim();
  return parseJsonRows<T>(output);
}

function parseJsonRows<T extends Record<string, unknown>>(output: string): T[] {
  if (output.length === 0) {
    return [];
  }

  return JSON.parse(output) as T[];
}

function buildJwtClaims(session: RlsSession): string {
  const claims: Record<string, string> = {
    role: session.role,
  };

  if (session.userId !== null) {
    claims.sub = session.userId;
  }

  return JSON.stringify(claims);
}

function buildSessionScopedSql(session: RlsSession, statement: string): string {
  const subject = session.userId ?? "";
  const claims = buildJwtClaims(session);

  return `
    BEGIN;
    SET LOCAL ROLE ${session.role};
    SET LOCAL request.jwt.claim.role = ${sqlLiteral(session.role)};
    SET LOCAL request.jwt.claim.sub = ${sqlLiteral(subject)};
    SET LOCAL request.jwt.claims = ${sqlLiteral(claims)};
    ${statement};
    COMMIT;
  `;
}

export function runSql(sql: string): void {
  const statement = trimTrailingSemicolon(sql);
  psql(["-c", statement]);
}

export function queryRows<T extends Record<string, unknown>>(sql: string): T[] {
  const statement = trimTrailingSemicolon(sql);
  return queryRowsFromStatement<T>(statement);
}

export function runSqlAsRls(session: RlsSession, sql: string): void {
  const statement = trimTrailingSemicolon(sql);
  psql(["-c", buildSessionScopedSql(session, statement)]);
}

export function queryRowsAsRls<T extends Record<string, unknown>>(
  session: RlsSession,
  sql: string
): T[] {
  const statement = trimTrailingSemicolon(sql);
  const wrappedQuery = `
    WITH result_row AS (
      ${statement}
    )
    SELECT COALESCE(json_agg(row_to_json(result_row)), '[]'::json)::text AS data
    FROM result_row
  `;
  const scopedSql = buildSessionScopedSql(session, wrappedQuery);
  const output = psql(["-c", scopedSql]).trim();

  return parseJsonRows<T>(output);
}

export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

export function createAuthUserFixture(prefix = "s02"): AuthUserFixture {
  const userId = randomUUID();
  const email = `${prefix}-${userId.slice(0, 8)}@example.com`;

  runSql(`
    INSERT INTO auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) VALUES (
      ${sqlLiteral(userId)}::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated',
      'authenticated',
      ${sqlLiteral(email)},
      'encrypted-test-password',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    )
    ON CONFLICT (id) DO NOTHING
  `);

  return {
    userId,
    email,
  };
}
