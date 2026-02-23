import { expect } from "vitest";

import { queryRows, sqlLiteral } from "./s02-db-testkit";

type TableName =
  | "users_profile"
  | "decks"
  | "cards"
  | "deck_cards"
  | "review_states"
  | "illustrations"
  | "study_sessions";

interface ExpectedColumn {
  columnName: string;
  dataType: string;
  notNull: boolean;
  defaultIncludes?: string;
}

interface ExpectedForeignKey {
  columnName: string;
  targetTable: string;
  targetColumn: string;
  onDelete: "CASCADE" | "NO ACTION";
}

interface ExpectedIndex {
  expression: string;
  unique: boolean;
}

interface TableContract {
  columns: ExpectedColumn[];
  primaryKey: string[];
  foreignKeys: ExpectedForeignKey[];
  checks: string[][];
  indexes: ExpectedIndex[];
}

interface TableNameRow {
  table_name: string;
}

interface ColumnRow {
  column_name: string;
  data_type: string;
  not_null: boolean;
  default_expr: string | null;
}

interface PrimaryKeyRow {
  column_name: string;
}

interface ForeignKeyRow {
  column_name: string;
  target_table: string;
  target_column: string;
  on_delete: "CASCADE" | "NO ACTION";
}

interface CheckRow {
  definition: string;
}

interface IndexRow {
  indexdef: string;
}

const TABLES: readonly TableName[] = [
  "users_profile",
  "decks",
  "cards",
  "deck_cards",
  "review_states",
  "illustrations",
  "study_sessions",
];

const TABLE_CONTRACTS: Record<TableName, TableContract> = {
  users_profile: {
    columns: [
      { columnName: "user_id", dataType: "uuid", notNull: true },
      { columnName: "display_name", dataType: "text", notNull: true },
      { columnName: "timezone", dataType: "text", notNull: true, defaultIncludes: "Asia/Tokyo" },
      { columnName: "parent_mode_enabled", dataType: "boolean", notNull: true, defaultIncludes: "false" },
      { columnName: "created_at", dataType: "timestamp with time zone", notNull: true, defaultIncludes: "now()" },
      { columnName: "updated_at", dataType: "timestamp with time zone", notNull: true, defaultIncludes: "now()" },
    ],
    primaryKey: ["user_id"],
    foreignKeys: [
      {
        columnName: "user_id",
        targetTable: "users",
        targetColumn: "id",
        onDelete: "CASCADE",
      },
    ],
    checks: [],
    indexes: [],
  },
  decks: {
    columns: [
      { columnName: "id", dataType: "uuid", notNull: true, defaultIncludes: "gen_random_uuid()" },
      { columnName: "owner_user_id", dataType: "uuid", notNull: true },
      { columnName: "name", dataType: "text", notNull: true },
      { columnName: "new_limit_per_day", dataType: "integer", notNull: true, defaultIncludes: "10" },
      { columnName: "created_at", dataType: "timestamp with time zone", notNull: true, defaultIncludes: "now()" },
      { columnName: "updated_at", dataType: "timestamp with time zone", notNull: true, defaultIncludes: "now()" },
    ],
    primaryKey: ["id"],
    foreignKeys: [
      {
        columnName: "owner_user_id",
        targetTable: "users",
        targetColumn: "id",
        onDelete: "CASCADE",
      },
    ],
    checks: [],
    indexes: [],
  },
  cards: {
    columns: [
      { columnName: "id", dataType: "uuid", notNull: true, defaultIncludes: "gen_random_uuid()" },
      { columnName: "owner_user_id", dataType: "uuid", notNull: false },
      { columnName: "visibility", dataType: "text", notNull: true, defaultIncludes: "public" },
      { columnName: "skill", dataType: "text", notNull: true },
      { columnName: "pattern", dataType: "text", notNull: true },
      { columnName: "front_text", dataType: "text", notNull: true },
      { columnName: "back_text", dataType: "text", notNull: true },
      { columnName: "illustration_key", dataType: "text", notNull: false },
      { columnName: "card_key", dataType: "text", notNull: true },
      { columnName: "created_at", dataType: "timestamp with time zone", notNull: true, defaultIncludes: "now()" },
    ],
    primaryKey: ["id"],
    foreignKeys: [
      {
        columnName: "owner_user_id",
        targetTable: "users",
        targetColumn: "id",
        onDelete: "CASCADE",
      },
    ],
    checks: [
      ["visibility", "public", "private"],
      ["skill", "reading", "writing"],
      ["pattern", "R1", "R2", "W1", "W2"],
    ],
    indexes: [
      { expression: "(card_key)", unique: true },
      { expression: "(illustration_key)", unique: false },
    ],
  },
  deck_cards: {
    columns: [
      { columnName: "deck_id", dataType: "uuid", notNull: true },
      { columnName: "card_id", dataType: "uuid", notNull: true },
    ],
    primaryKey: ["deck_id", "card_id"],
    foreignKeys: [
      {
        columnName: "deck_id",
        targetTable: "decks",
        targetColumn: "id",
        onDelete: "CASCADE",
      },
      {
        columnName: "card_id",
        targetTable: "cards",
        targetColumn: "id",
        onDelete: "CASCADE",
      },
    ],
    checks: [],
    indexes: [{ expression: "(card_id)", unique: false }],
  },
  review_states: {
    columns: [
      { columnName: "user_id", dataType: "uuid", notNull: true },
      { columnName: "card_id", dataType: "uuid", notNull: true },
      { columnName: "level", dataType: "integer", notNull: true, defaultIncludes: "0" },
      { columnName: "due_date", dataType: "date", notNull: true },
      { columnName: "last_rating", dataType: "text", notNull: false },
      { columnName: "retry_today_count", dataType: "integer", notNull: true, defaultIncludes: "0" },
      { columnName: "last_reviewed_at", dataType: "timestamp with time zone", notNull: false },
    ],
    primaryKey: ["user_id", "card_id"],
    foreignKeys: [
      {
        columnName: "user_id",
        targetTable: "users",
        targetColumn: "id",
        onDelete: "CASCADE",
      },
      {
        columnName: "card_id",
        targetTable: "cards",
        targetColumn: "id",
        onDelete: "CASCADE",
      },
    ],
    checks: [["last_rating", "again", "hard", "good"]],
    indexes: [{ expression: "(user_id, due_date)", unique: false }],
  },
  illustrations: {
    columns: [
      { columnName: "id", dataType: "uuid", notNull: true, defaultIncludes: "gen_random_uuid()" },
      { columnName: "owner_user_id", dataType: "uuid", notNull: true },
      { columnName: "illustration_key", dataType: "text", notNull: true },
      { columnName: "status", dataType: "text", notNull: true, defaultIncludes: "pending" },
      { columnName: "storage_path", dataType: "text", notNull: false },
      { columnName: "prompt", dataType: "text", notNull: false },
      { columnName: "model_info", dataType: "text", notNull: false },
      { columnName: "created_at", dataType: "timestamp with time zone", notNull: true, defaultIncludes: "now()" },
      { columnName: "updated_at", dataType: "timestamp with time zone", notNull: true, defaultIncludes: "now()" },
    ],
    primaryKey: ["id"],
    foreignKeys: [
      {
        columnName: "owner_user_id",
        targetTable: "users",
        targetColumn: "id",
        onDelete: "CASCADE",
      },
    ],
    checks: [["status", "pending", "ready", "failed"]],
    indexes: [],
  },
  study_sessions: {
    columns: [
      { columnName: "id", dataType: "uuid", notNull: true, defaultIncludes: "gen_random_uuid()" },
      { columnName: "user_id", dataType: "uuid", notNull: true },
      { columnName: "deck_id", dataType: "uuid", notNull: true },
      { columnName: "queue_due", dataType: "jsonb", notNull: true, defaultIncludes: "[]" },
      { columnName: "queue_learn", dataType: "jsonb", notNull: true, defaultIncludes: "[]" },
      { columnName: "queue_new", dataType: "jsonb", notNull: true, defaultIncludes: "[]" },
      { columnName: "queue_retry", dataType: "jsonb", notNull: true, defaultIncludes: "[]" },
      { columnName: "current_card_id", dataType: "uuid", notNull: false },
      { columnName: "revealed", dataType: "boolean", notNull: true, defaultIncludes: "false" },
      { columnName: "created_at", dataType: "timestamp with time zone", notNull: true, defaultIncludes: "now()" },
      { columnName: "finished_at", dataType: "timestamp with time zone", notNull: false },
    ],
    primaryKey: ["id"],
    foreignKeys: [
      {
        columnName: "user_id",
        targetTable: "users",
        targetColumn: "id",
        onDelete: "CASCADE",
      },
      {
        columnName: "deck_id",
        targetTable: "decks",
        targetColumn: "id",
        onDelete: "CASCADE",
      },
      {
        columnName: "current_card_id",
        targetTable: "cards",
        targetColumn: "id",
        onDelete: "NO ACTION",
      },
    ],
    checks: [],
    indexes: [{ expression: "(user_id, finished_at)", unique: false }],
  },
};

function getTables(): string[] {
  const names = TABLES.map((table) => sqlLiteral(table)).join(", ");
  const rows = queryRows<TableNameRow>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (${names})
  `);

  return rows.map((row) => row.table_name);
}

function getColumns(table: TableName): ColumnRow[] {
  return queryRows<ColumnRow>(`
    SELECT
      a.attname AS column_name,
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
      a.attnotnull AS not_null,
      pg_get_expr(ad.adbin, ad.adrelid) AS default_expr
    FROM pg_catalog.pg_attribute AS a
    INNER JOIN pg_catalog.pg_class AS c
      ON c.oid = a.attrelid
    INNER JOIN pg_catalog.pg_namespace AS n
      ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef AS ad
      ON ad.adrelid = a.attrelid
      AND ad.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND c.relname = ${sqlLiteral(table)}
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY a.attnum
  `);
}

function getPrimaryKeyColumns(table: TableName): string[] {
  const rows = queryRows<PrimaryKeyRow>(`
    SELECT a.attname AS column_name
    FROM pg_class AS c
    INNER JOIN pg_namespace AS n
      ON n.oid = c.relnamespace
    INNER JOIN pg_index AS i
      ON i.indrelid = c.oid
    INNER JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS cols(attnum, ord)
      ON TRUE
    INNER JOIN pg_attribute AS a
      ON a.attrelid = c.oid
      AND a.attnum = cols.attnum
    WHERE n.nspname = 'public'
      AND c.relname = ${sqlLiteral(table)}
      AND i.indisprimary
    ORDER BY cols.ord
  `);

  return rows.map((row) => row.column_name);
}

function getForeignKeys(table: TableName): ForeignKeyRow[] {
  return queryRows<ForeignKeyRow>(`
    SELECT
      source_column.attname AS column_name,
      target_table.relname AS target_table,
      target_column.attname AS target_column,
      CASE constraint_row.confdeltype
        WHEN 'c' THEN 'CASCADE'
        ELSE 'NO ACTION'
      END AS on_delete
    FROM pg_constraint AS constraint_row
    INNER JOIN pg_class AS source_table
      ON source_table.oid = constraint_row.conrelid
    INNER JOIN pg_namespace AS source_namespace
      ON source_namespace.oid = source_table.relnamespace
    INNER JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS source_keys(attnum, ord)
      ON TRUE
    INNER JOIN LATERAL unnest(constraint_row.confkey) WITH ORDINALITY AS target_keys(attnum, ord)
      ON target_keys.ord = source_keys.ord
    INNER JOIN pg_attribute AS source_column
      ON source_column.attrelid = source_table.oid
      AND source_column.attnum = source_keys.attnum
    INNER JOIN pg_class AS target_table
      ON target_table.oid = constraint_row.confrelid
    INNER JOIN pg_attribute AS target_column
      ON target_column.attrelid = target_table.oid
      AND target_column.attnum = target_keys.attnum
    WHERE source_namespace.nspname = 'public'
      AND source_table.relname = ${sqlLiteral(table)}
      AND constraint_row.contype = 'f'
    ORDER BY constraint_row.conname, source_keys.ord
  `);
}

function getCheckDefinitions(table: TableName): string[] {
  const rows = queryRows<CheckRow>(`
    SELECT pg_get_constraintdef(oid, TRUE) AS definition
    FROM pg_constraint
    WHERE conrelid = ${sqlLiteral(`public.${table}`)}::regclass
      AND contype = 'c'
  `);

  return rows.map((row) => row.definition);
}

function getIndexDefinitions(table: TableName): string[] {
  const rows = queryRows<IndexRow>(`
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = ${sqlLiteral(table)}
  `);

  return rows.map((row) => row.indexdef);
}

function assertColumns(table: TableName, expectedColumns: ExpectedColumn[]): void {
  const actualColumns = getColumns(table);

  for (const expectedColumn of expectedColumns) {
    const actualColumn = actualColumns.find((column) => column.column_name === expectedColumn.columnName);

    expect(actualColumn, `${table}.${expectedColumn.columnName} should exist`).toBeDefined();
    expect(actualColumn?.data_type).toBe(expectedColumn.dataType);
    expect(actualColumn?.not_null).toBe(expectedColumn.notNull);

    if (expectedColumn.defaultIncludes !== undefined) {
      expect(actualColumn?.default_expr, `${table}.${expectedColumn.columnName} default should exist`).not.toBeNull();
      expect(actualColumn?.default_expr).toContain(expectedColumn.defaultIncludes);
    }
  }
}

function assertPrimaryKey(table: TableName, expectedColumns: string[]): void {
  expect(getPrimaryKeyColumns(table)).toEqual(expectedColumns);
}

function assertForeignKeys(table: TableName, expectedForeignKeys: ExpectedForeignKey[]): void {
  const foreignKeys = getForeignKeys(table);

  expect(foreignKeys).toEqual(expect.arrayContaining(expectedForeignKeys));
  expect(foreignKeys).toHaveLength(expectedForeignKeys.length);
}

function assertChecks(table: TableName, checks: string[][]): void {
  const definitions = getCheckDefinitions(table);

  for (const fragments of checks) {
    const matchedDefinition = definitions.find((definition) =>
      fragments.every((fragment) => definition.includes(fragment))
    );

    expect(matchedDefinition, `${table} check constraint should include ${fragments.join(",")}`).toBeDefined();
  }
}

function assertIndexes(table: TableName, expectedIndexes: ExpectedIndex[]): void {
  const indexDefinitions = getIndexDefinitions(table);

  for (const expectedIndex of expectedIndexes) {
    const matchedDefinition = indexDefinitions.find((definition) => {
      const isUnique = definition.includes("UNIQUE INDEX");
      return isUnique === expectedIndex.unique && definition.includes(expectedIndex.expression);
    });

    expect(matchedDefinition, `${table} index missing: ${expectedIndex.expression}`).toBeDefined();
  }
}

export function assertSchemaContract(): void {
  const actualTables = getTables();

  expect(actualTables).toHaveLength(TABLES.length);
  expect(actualTables).toEqual(expect.arrayContaining(TABLES));

  for (const table of TABLES) {
    const contract = TABLE_CONTRACTS[table];
    assertColumns(table, contract.columns);
    assertPrimaryKey(table, contract.primaryKey);
    assertForeignKeys(table, contract.foreignKeys);
    assertChecks(table, contract.checks);
    assertIndexes(table, contract.indexes);
  }
}

export function hasUniqueIllustrationKeyConstraint(): boolean {
  const definitions = getIndexDefinitions("illustrations");

  return definitions.some(
    (definition) => definition.includes("UNIQUE INDEX") && definition.includes("(illustration_key)")
  );
}
