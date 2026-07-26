import type { CommitImportWrapperArgs, NormalizedImportRequest } from "@/lib/ai-import/schema";
import { buildCommitImportRpcArgs } from "@/lib/ai-import/schema";

import type { Database, Json } from "./database";

type Tables = Database["public"]["Tables"];
type Functions = Database["public"]["Functions"];

type RequiredS10Table =
	| "ai_import_batches"
	| "ai_import_items"
	| "ai_uploads"
	| "tags"
	| "ai_import_item_tags"
	| "card_tags"
	| "ai_usage_daily"
	| "ai_quota_reservations";

type RequiredPublicWrapper =
	| "commit_import"
	| "reserve_provider_usage"
	| "register_ai_upload"
	| "finalize_import_item"
	| "mark_import_item_failed"
	| "update_imported_card"
	| "delete_private_card"
	| "set_card_decks"
	| "set_card_tags"
	| "set_card_tag_names"
	| "set_card_illustration"
	| "undo_import"
	| "list_ai_managed_cards"
	| "bulk_delete_imported_cards"
	| "s14_remote_validate_import_preview"
	| "s14_create_oauth_consent_state"
	| "s14_consume_oauth_consent_state"
	| "s14_remote_commit_import"
	| "s14_remote_get_import_status"
	| "s14_remote_update_imported_card"
	| "s14_remote_update_ai_card";

type Assert<T extends true> = T;
type AllTablesPresent = Assert<
	Exclude<RequiredS10Table, keyof Tables> extends never ? true : false
>;
type AllWrappersPresent = Assert<
	Exclude<RequiredPublicWrapper, keyof Functions> extends never ? true : false
>;

/**
 * S-21: the Remote MCP commit wrapper carries the server-generated approved
 * mnemonics (migration 20260727000000). `p_mnemonics` must stay optional so the
 * pre-S-21 eight-argument call site keeps compiling against the same wrapper.
 */
type RemoteCommitArgs = Functions["s14_remote_commit_import"]["Args"];
type RemoteCommitAcceptsMnemonics = Assert<
	RemoteCommitArgs extends { p_mnemonics?: Json | null } ? true : false
>;
type RemoteCommitMnemonicsOptional = Assert<
	Omit<RemoteCommitArgs, "p_mnemonics"> extends RemoteCommitArgs ? true : false
>;

export type CardsRow = Tables["cards"]["Row"];
export type CardsInsert = Tables["cards"]["Insert"];
export type CardsUpdate = Tables["cards"]["Update"];
export type CardsUpdatedAt = CardsRow["updated_at"];

export type S10TableContract = {
	readonly [Name in RequiredS10Table]: {
		readonly Row: Tables[Name]["Row"];
		readonly Insert: Tables[Name]["Insert"];
		readonly Update: Tables[Name]["Update"];
	};
};

export type S10WrapperContract = {
	readonly [Name in RequiredPublicWrapper]: {
		readonly Args: Functions[Name]["Args"];
		readonly Returns: Functions[Name]["Returns"];
	};
};

export function assertCommitImportArgs(
	wrapperArgs: CommitImportWrapperArgs,
	normalizedRequest: NormalizedImportRequest
): Json {
	const commitArgs: Functions["commit_import"]["Args"] = buildCommitImportRpcArgs({
		...wrapperArgs,
		request: normalizedRequest,
	});
	return commitArgs.p_request;
}

export type DatabaseTypeAssertions = [
	AllTablesPresent,
	AllWrappersPresent,
	RemoteCommitAcceptsMnemonics,
	RemoteCommitMnemonicsOptional,
];
