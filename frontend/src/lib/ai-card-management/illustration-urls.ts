import type { AiCardListPage, ManagedAiCard } from "./types";

/**
 * Server-only helper for the AI card management list.
 *
 * `import "server-only"` is intentionally omitted (it breaks Vitest in this
 * repository). Server-only behaviour is preserved by dependency injection:
 * this module never touches Supabase, secrets, or `storage_path` sources by
 * itself. Only `"use server"` callers may supply loaders that do.
 */

/** Matches the study screen expiry (S-09) without importing its constant. */
export const AI_CARD_ILLUSTRATION_SIGNED_URL_EXPIRES_IN_SECONDS = 3600;

/** Resolves owner-scoped ready illustration ids to their storage paths. */
export type ReadyIllustrationPathLoader = (
	illustrationIds: readonly string[]
) => Promise<ReadonlyMap<string, string>>;

/** Signs one storage path, or returns null when signing is not possible. */
export type SignIllustrationUrl = (storagePath: string) => Promise<string | null>;

export interface AttachIllustrationUrlsDependencies {
	readonly loadPaths: ReadyIllustrationPathLoader;
	readonly sign: SignIllustrationUrl;
}

const collectReadyIllustrationIds = (items: readonly ManagedAiCard[]): string[] => {
	const ids = new Set<string>();
	for (const item of items) {
		if (item.illustration !== null && item.illustration.status === "ready") {
			ids.add(item.illustration.id);
		}
	}
	return [...ids];
};

const signUniquePaths = async (
	pathsById: ReadonlyMap<string, string>,
	sign: SignIllustrationUrl
): Promise<ReadonlyMap<string, string>> => {
	const uniquePaths = [...new Set(pathsById.values())];
	const signed = await Promise.all(
		uniquePaths.map(async (path) => [path, await sign(path)] as const)
	);
	const urlByPath = new Map<string, string>();
	for (const [path, url] of signed) {
		if (url !== null) urlByPath.set(path, url);
	}
	return urlByPath;
};

/**
 * Adds expiring signed URLs to ready illustrations of one list page.
 *
 * Degradation is intentional (AC-4): a failing loader or a failing signature
 * leaves `url` null instead of failing the list, so search, edit, delete, and
 * illustration assignment keep working. `storage_path` is never returned,
 * logged, or embedded in an error message.
 */
export async function attachIllustrationUrls(
	page: AiCardListPage,
	deps: AttachIllustrationUrlsDependencies
): Promise<AiCardListPage> {
	const readyIds = collectReadyIllustrationIds(page.items);
	if (readyIds.length === 0) return page;

	try {
		const pathsById = await deps.loadPaths(readyIds);
		if (pathsById.size === 0) return page;

		const urlByPath = await signUniquePaths(pathsById, deps.sign);
		if (urlByPath.size === 0) return page;

		return {
			items: page.items.map((item) => {
				const illustration = item.illustration;
				if (illustration === null || illustration.status !== "ready") return item;
				const storagePath = pathsById.get(illustration.id);
				const url = storagePath === undefined ? undefined : urlByPath.get(storagePath);
				if (url === undefined) return item;
				return { ...item, illustration: { ...illustration, url } };
			}),
			nextCursor: page.nextCursor,
		};
	} catch {
		return page;
	}
}
