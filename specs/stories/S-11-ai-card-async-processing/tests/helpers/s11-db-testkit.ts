export {
	createS10DbClient as createS11DbClient,
	type S10DbClient as S11DbClient,
} from "../../../S-10-ai-card-import-foundation/tests/helpers/s10-db-testkit";

export function requireDistinctS11DatabaseUrls(
	environment: Readonly<Record<string, string | undefined>> = process.env
): readonly string[] {
	const keys = [
		"S11_FRESH_DATABASE_URL",
		"S11_UPGRADE_DATABASE_URL",
		"S11_FAILURE_DATABASE_URL",
	] as const;
	const urls = keys.map((key) => {
		const value = environment[key]?.trim();
		if (value === undefined || value.length === 0) throw new Error(`${key} is required`);
		return value;
	});
	if (new Set(urls).size !== 3)
		throw new Error("S-11 database jobs require three distinct connection strings");
	const names = urls.map((value) => new URL(value).pathname);
	if (new Set(names).size !== 3)
		throw new Error("S-11 database jobs require three distinct databases");
	return urls;
}
