"use server";

import {
	type ProcessIllustrationGenerationArgs,
	runProcessIllustrationGeneration,
} from "@/actions/illustration-generation-runtime";
import { getSignedUrl } from "@/lib/illustration/storage";
import { createServerClient } from "@/lib/supabase/server";

type TriggerErrorCode = "unauthorized" | "card_not_found" | "card_missing_illustration_key";

type IllustrationStatus = "pending" | "ready" | "failed";

type CardLookupRow = {
	id: string;
	owner_user_id: string | null;
	illustration_key: string | null;
	back_text: string;
	skill: string;
};

type IllustrationLookupRow = {
	id: string;
	status: string;
};

type MutationIdRow = {
	id: string;
};

type ReadyIllustrationLookupRow = {
	id: string;
	storage_path: string | null;
};

type QueryError = {
	message: string;
};

type QueryResult<TData> = {
	data: TData;
	error: QueryError | null;
};

type TriggerSupabaseClient = {
	auth: {
		getUser: () => Promise<QueryResult<{ user: { id: string } | null }>>;
	};
	from(table: "cards"): {
		select: (columns: string) => {
			eq: (
				column: "id",
				value: string
			) => {
				eq: (
					column: "owner_user_id",
					value: string
				) => {
					maybeSingle: () => Promise<QueryResult<CardLookupRow | null>>;
				};
			};
		};
	};
	from(table: "illustrations"): {
		select: (columns: string) => {
			eq: (
				column: "owner_user_id",
				value: string
			) => {
				eq: (
					column: "illustration_key",
					value: string
				) => {
					order: (
						column: "updated_at",
						options?: { ascending: boolean }
					) => {
						order: (
							column: "id",
							options?: { ascending: boolean }
						) => {
							limit: (count: number) => {
								maybeSingle: () => Promise<QueryResult<IllustrationLookupRow | null>>;
							};
						};
					};
				};
			};
		};
		update: (values: { status: "pending" }) => {
			eq: (
				column: "id",
				value: string
			) => {
				eq: (
					column: "owner_user_id",
					value: string
				) => {
					select: (columns: "id") => {
						single: () => Promise<QueryResult<MutationIdRow | null>>;
					};
				};
			};
		};
		insert: (values: {
			owner_user_id: string;
			illustration_key: string;
			status?: "pending";
		}) => {
			select: (columns: "id") => {
				single: () => Promise<QueryResult<MutationIdRow | null>>;
			};
		};
	};
};

type UrlLookupSupabaseClient = {
	auth: {
		getUser: () => Promise<QueryResult<{ user: { id: string } | null }>>;
	};
	from(table: "illustrations"): {
		select: (columns: string) => {
			eq: (
				column: "owner_user_id",
				value: string
			) => {
				eq: (
					column: "illustration_key",
					value: string
				) => {
					eq: (
						column: "status",
						value: "ready"
					) => {
						not: (
							column: "storage_path",
							operator: "is",
							value: null
						) => {
							order: (
								column: "updated_at",
								options?: { ascending: boolean }
							) => {
								order: (
									column: "id",
									options?: { ascending: boolean }
								) => {
									limit: (count: number) => {
										maybeSingle: () => Promise<QueryResult<ReadyIllustrationLookupRow | null>>;
									};
								};
							};
						};
					};
				};
			};
		};
	};
};

export type TriggerIllustrationGenerationResult =
	| {
			ok: true;
			started: boolean;
			illustrationId: string | null;
	  }
	| {
			ok: false;
			code: TriggerErrorCode;
	  };

export type { ProcessIllustrationGenerationArgs } from "@/actions/illustration-generation-runtime";

const READY_ILLUSTRATION_STATUS_FOR_URL_LOOKUP = "ready";
const SIGNED_URL_EXPIRES_IN_SECONDS = 3600;
const ILLUSTRATION_URL_LOOKUP_SORT = {
	updatedAt: "updated_at",
	id: "id",
} as const;

const asTriggerSupabaseClient = (
	client: ReturnType<typeof createServerClient>
): TriggerSupabaseClient => client as unknown as TriggerSupabaseClient;

const asUrlLookupSupabaseClient = (
	client: ReturnType<typeof createServerClient>
): UrlLookupSupabaseClient => client as unknown as UrlLookupSupabaseClient;

const isIllustrationStatus = (status: string): status is IllustrationStatus =>
	status === "pending" || status === "ready" || status === "failed";

const assertNoQueryError = (label: string, error: QueryError | null) => {
	if (error) {
		throw new Error(`${label}: ${error.message}`);
	}
};

const assertData = <TData>(label: string, data: TData | null): TData => {
	if (!data) {
		throw new Error(`${label}: data not returned`);
	}

	return data;
};

const resolveShouldStartGeneration = (
	existing: IllustrationLookupRow | null
): {
	shouldStart: boolean;
	shouldRetry: boolean;
} => {
	if (!existing) {
		return {
			shouldStart: true,
			shouldRetry: false,
		};
	}

	if (!isIllustrationStatus(existing.status)) {
		throw new Error(`Unexpected illustration status: ${existing.status}`);
	}

	if (existing.status === "ready" || existing.status === "pending") {
		return {
			shouldStart: false,
			shouldRetry: false,
		};
	}

	return {
		shouldStart: true,
		shouldRetry: true,
	};
};

const findCardForOwner = async (params: {
	supabase: TriggerSupabaseClient;
	cardId: string;
	ownerUserId: string;
}) => {
	const { data, error } = await params.supabase
		.from("cards")
		.select("id, owner_user_id, illustration_key, back_text, skill")
		.eq("id", params.cardId)
		.eq("owner_user_id", params.ownerUserId)
		.maybeSingle();

	assertNoQueryError("cards lookup failed", error);

	return data;
};

const findLatestIllustration = async (params: {
	supabase: TriggerSupabaseClient;
	illustrationKey: string;
	ownerUserId: string;
}) => {
	const { data, error } = await params.supabase
		.from("illustrations")
		.select("id, status")
		.eq("owner_user_id", params.ownerUserId)
		.eq("illustration_key", params.illustrationKey)
		.order("updated_at", { ascending: false })
		.order("id", { ascending: false })
		.limit(1)
		.maybeSingle();

	assertNoQueryError("illustrations lookup failed", error);

	return data;
};

const retryFailedIllustration = async (params: {
	supabase: TriggerSupabaseClient;
	illustrationId: string;
	ownerUserId: string;
}) => {
	const { data, error } = await params.supabase
		.from("illustrations")
		.update({ status: "pending" })
		.eq("id", params.illustrationId)
		.eq("owner_user_id", params.ownerUserId)
		.select("id")
		.single();

	assertNoQueryError("illustrations retry update failed", error);

	return assertData("illustrations retry update failed", data);
};

const insertPendingIllustration = async (params: {
	supabase: TriggerSupabaseClient;
	illustrationKey: string;
	ownerUserId: string;
}) => {
	const { data, error } = await params.supabase
		.from("illustrations")
		.insert({
			owner_user_id: params.ownerUserId,
			illustration_key: params.illustrationKey,
		})
		.select("id")
		.single();

	assertNoQueryError("illustrations insert failed", error);

	return assertData("illustrations insert failed", data);
};

const findLatestReadyIllustrationForOwner = async (params: {
	supabase: UrlLookupSupabaseClient;
	illustrationKey: string;
	ownerUserId: string;
}) => {
	const { data, error } = await params.supabase
		.from("illustrations")
		.select("id, storage_path")
		.eq("owner_user_id", params.ownerUserId)
		.eq("illustration_key", params.illustrationKey)
		.eq("status", READY_ILLUSTRATION_STATUS_FOR_URL_LOOKUP)
		.not("storage_path", "is", null)
		.order(ILLUSTRATION_URL_LOOKUP_SORT.updatedAt, { ascending: false })
		.order(ILLUSTRATION_URL_LOOKUP_SORT.id, { ascending: false })
		.limit(1)
		.maybeSingle();

	assertNoQueryError("illustrations ready lookup failed", error);

	return data;
};

export async function processIllustrationGeneration(
	args: ProcessIllustrationGenerationArgs
): Promise<void> {
	await runProcessIllustrationGeneration(args);
}

export async function triggerIllustrationGeneration(
	cardId: string
): Promise<TriggerIllustrationGenerationResult> {
	const supabase = asTriggerSupabaseClient(createServerClient());
	const { data: authData, error: authError } = await supabase.auth.getUser();

	assertNoQueryError("auth lookup failed", authError);

	if (!authData.user) {
		return {
			ok: false,
			code: "unauthorized",
		};
	}

	const ownerUserId = authData.user.id;
	const card = await findCardForOwner({
		supabase,
		cardId,
		ownerUserId,
	});
	if (!card || card.owner_user_id !== ownerUserId) {
		return {
			ok: false,
			code: "card_not_found",
		};
	}

	if (!card.illustration_key) {
		return {
			ok: false,
			code: "card_missing_illustration_key",
		};
	}

	const existingIllustration = await findLatestIllustration({
		supabase,
		illustrationKey: card.illustration_key,
		ownerUserId,
	});
	const transition = resolveShouldStartGeneration(existingIllustration);

	if (!transition.shouldStart) {
		return {
			ok: true,
			started: false,
			illustrationId: existingIllustration?.id ?? null,
		};
	}

	let pendingRecord: MutationIdRow;
	if (transition.shouldRetry) {
		const retrySource = assertData(
			"retry transition requires existing illustration",
			existingIllustration
		);
		pendingRecord = await retryFailedIllustration({
			supabase,
			illustrationId: retrySource.id,
			ownerUserId,
		});
	} else {
		pendingRecord = await insertPendingIllustration({
			supabase,
			illustrationKey: card.illustration_key,
			ownerUserId,
		});
	}

	const processArgs: ProcessIllustrationGenerationArgs = {
		illustrationId: pendingRecord.id,
		illustrationKey: card.illustration_key,
		backText: card.back_text,
		skill: card.skill,
		ownerUserId,
	};

	void processIllustrationGeneration(processArgs).catch((error: unknown) => {
		console.error("S-08 detached generation failed", {
			illustrationId: processArgs.illustrationId,
			error,
		});
	});

	return {
		ok: true,
		started: true,
		illustrationId: pendingRecord.id,
	};
}

export async function getIllustrationUrl(illustrationKey: string): Promise<string | null> {
	const supabase = asUrlLookupSupabaseClient(createServerClient());
	const { data: authData, error: authError } = await supabase.auth.getUser();

	assertNoQueryError("auth lookup failed", authError);

	if (!authData.user) {
		return null;
	}

	const latestReadyIllustration = await findLatestReadyIllustrationForOwner({
		supabase,
		illustrationKey,
		ownerUserId: authData.user.id,
	});
	if (!latestReadyIllustration?.storage_path) {
		return null;
	}
	if (!latestReadyIllustration.storage_path.startsWith(`${authData.user.id}/`)) return null;

	return getSignedUrl(latestReadyIllustration.storage_path, SIGNED_URL_EXPIRES_IN_SECONDS);
}
