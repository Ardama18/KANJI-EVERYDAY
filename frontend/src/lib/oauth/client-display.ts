export const TIMECOIN_OAUTH_CLIENT_ID = "4eaeedb5-f275-43d4-8a97-e00624849443";

export type OAuthClientDisplayKind = "mcp" | "timecoin";

export type OAuthClientDisplay = Readonly<{
	kind: OAuthClientDisplayKind;
	heading: string;
	permissions: readonly string[];
	description: readonly string[];
	revokeNotice: string;
}>;

const MCP_DISPLAY: OAuthClientDisplay = Object.freeze({
	kind: "mcp",
	heading: "外部AIとの連携を確認",
	permissions: Object.freeze(["デッキ名の参照", "非公開カードの作成・編集・削除"]),
	description: Object.freeze([
		"標準の本人確認情報（openid / email / profile）を使います。拒否してもアプリ内AI生成は引き続き利用できます。",
	]),
	revokeNotice: "この外部AIは直ちにカード操作できなくなります。",
});

const TIMECOIN_DISPLAY: OAuthClientDisplay = Object.freeze({
	kind: "timecoin",
	heading: "TimeCoin との連携を確認",
	permissions: Object.freeze(["本日の学習完了状態の確認"]),
	description: Object.freeze([
		"標準の本人確認情報（openid / email / profile）を使います。",
		"TimeCoin には、学習完了判定に必要な contractVersion / date / state / completed だけを共有します。",
		"デッキ名、カード内容、学習枚数は共有しません。",
	]),
	revokeNotice: "この連携は直ちに本日の学習完了状態を確認できなくなります。",
});

export function getOAuthClientDisplay(clientId: string, _clientName: string): OAuthClientDisplay {
	return clientId === TIMECOIN_OAUTH_CLIENT_ID ? TIMECOIN_DISPLAY : MCP_DISPLAY;
}
