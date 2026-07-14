import { requireS10TestDatabaseUrl } from "./s10-db-testkit";

export type S10DatabaseJob = "fresh" | "upgrade" | "failure";

export interface S10DatabaseJobSelection {
	job: S10DatabaseJob;
	databaseUrl: string;
	testFile: string;
	testNamePattern: string;
}

const CONTRACT_E2E_FILE =
	"../specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.e2e.test.ts";

const JOB_TEST_PATTERN = {
	fresh: "E2E-MIGRATION-01",
	upgrade: "E2E-MIGRATION-02",
	failure: "E2E-MIGRATION-03",
} as const satisfies Record<S10DatabaseJob, string>;

export function selectS10DatabaseJob(
	job: S10DatabaseJob,
	environment: Readonly<Record<string, string | undefined>> = process.env
): S10DatabaseJobSelection {
	return {
		job,
		databaseUrl: requireS10TestDatabaseUrl(environment),
		testFile: CONTRACT_E2E_FILE,
		testNamePattern: JOB_TEST_PATTERN[job],
	};
}
