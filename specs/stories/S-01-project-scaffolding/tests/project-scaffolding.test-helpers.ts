import { readFileSync } from "node:fs"
import path from "node:path"

const STORY_TEST_ROOT = path.resolve(__dirname, "../../../..")
const FRONTEND_ROOT = path.resolve(STORY_TEST_ROOT, "frontend")

export type RequiredEnvKey =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  | "SUPABASE_SERVICE_ROLE_KEY"

export const REQUIRED_ENV_KEYS: readonly RequiredEnvKey[] = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]

type EnvSnapshotKey = RequiredEnvKey | "NODE_ENV"
const ENV_SNAPSHOT_KEYS: readonly EnvSnapshotKey[] = [...REQUIRED_ENV_KEYS, "NODE_ENV"]
type EnvSnapshot = Partial<Record<EnvSnapshotKey, string | undefined>>

export const BASELINE_ENV: Record<RequiredEnvKey, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
}

export const PROJECT_FILES = {
  envExample: path.resolve(FRONTEND_ROOT, ".env.local.example"),
  env: path.resolve(FRONTEND_ROOT, "src/lib/env.ts"),
  serverClient: path.resolve(FRONTEND_ROOT, "src/lib/supabase/server.ts"),
  browserClient: path.resolve(FRONTEND_ROOT, "src/lib/supabase/client.ts"),
  homePage: path.resolve(FRONTEND_ROOT, "app/page.tsx"),
  loginPage: path.resolve(FRONTEND_ROOT, "app/login/page.tsx"),
  decksPage: path.resolve(FRONTEND_ROOT, "app/(auth)/decks/page.tsx"),
} as const

export const SERVICE_ROLE_MISSING_ERROR =
  "Missing required environment variables: SUPABASE_SERVICE_ROLE_KEY"

export const readTextFile = (filePath: string): string => readFileSync(filePath, "utf8")

export const takeEnvSnapshot = (): EnvSnapshot => {
  const snapshot: EnvSnapshot = {}
  for (const key of ENV_SNAPSHOT_KEYS) {
    snapshot[key] = process.env[key]
  }
  return snapshot
}

export const restoreEnv = (snapshot: EnvSnapshot): void => {
  for (const key of ENV_SNAPSHOT_KEYS) {
    const previous = snapshot[key]
    if (previous === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = previous
    }
  }
}

export const withBaselineEnv = (
  nodeEnv: string | undefined,
  fn: () => void,
): void => {
  const snapshot = takeEnvSnapshot()
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = BASELINE_ENV.NEXT_PUBLIC_SUPABASE_URL
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = BASELINE_ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY
    delete process.env.SUPABASE_SERVICE_ROLE_KEY

    if (nodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = nodeEnv
    }

    fn()
  } finally {
    restoreEnv(snapshot)
  }
}
