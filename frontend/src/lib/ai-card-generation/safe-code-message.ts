const SAFE_MESSAGES: Readonly<Record<string, string>> = {
	MNEMONIC_HTTP_TRANSIENT: "覚え方の生成サービスに一時的な問題があります。再試行してください。",
	MNEMONIC_HTTP_PERMANENT: "覚え方を生成できませんでした。入力や設定を確認してください。",
	MNEMONIC_TIMEOUT: "覚え方の生成が時間切れになりました。再試行してください。",
	MNEMONIC_NETWORK: "覚え方の生成中に通信が失敗しました。再試行してください。",
	MNEMONIC_RESPONSE_INVALID: "覚え方の出力を読み取れませんでした。再試行してください。",
	MNEMONIC_VALIDATION_FAILED: "覚え方の形式を確認できませんでした。再試行してください。",
	MNEMONIC_REFUSED: "AIが覚え方の生成を拒否しました。入力を見直してください。",
	MNEMONIC_MODERATION_BLOCKED: "覚え方が安全確認を通過しませんでした。入力を見直してください。",
	MNEMONIC_MODERATION_UNAVAILABLE:
		"覚え方の安全確認を完了できませんでした。後で再試行してください。",
	MNEMONIC_LIMIT_EXCEEDED: "一度に生成できる覚え方の上限を超えました。この語を再試行してください。",
	MNEMONIC_BUDGET_EXCEEDED: "覚え方の生成時間の上限に達しました。この語を再試行してください。",
	MNEMONIC_DISABLED: "覚え方の生成が無効です。設定を確認してください。",
	MNEMONIC_CONFIG_MISSING: "覚え方の生成設定を確認できません。管理者へ連絡してください。",
	MNEMONIC_TARGET_UNSUPPORTED: "この語は覚え方の生成対象として扱えません。入力を見直してください。",
	MNEMONIC_INTERNAL_ERROR: "覚え方の生成を完了できませんでした。後で再試行してください。",
	OPENAI_INPUT_TEXT_MODERATION: "指示の内容を見直してください。",
	OPENAI_INPUT_IMAGE_MODERATION: "教材画像の内容を見直してください。",
	OPENAI_OUTPUT_MODERATION: "安全上の理由でカード案を表示できません。",
	OPENAI_REFUSAL: "AIがこの生成を拒否しました。入力を見直してください。",
	OPENAI_INCOMPLETE_OUTPUT: "AIの出力が不完全でした。もう一度お試しください。",
	OPENAI_OUTPUT_SCHEMA_MISMATCH: "カード形式を確認できませんでした。もう一度お試しください。",
	OPENAI_MODERATION_UNAVAILABLE: "安全確認サービスを利用できません。後で再試行してください。",
	OPENAI_PROVIDER_TRANSIENT: "AIサービスに一時的な問題があります。後で再試行してください。",
	OPENAI_PROVIDER_CONFIG: "AIサービスの設定を確認できません。管理者へ連絡してください。",
	OPENAI_PROVIDER_PERMANENT: "AIサービスが生成を完了できませんでした。入力を見直してください。",
	IMAGE_FORMAT_INVALID:
		"画像形式を確認できません。PNGは8-bit・透過なし、またはJPEGを使用してください。",
	IMAGE_TOO_LARGE: "画像は1枚10MiB以下にしてください。",
	IMAGE_DIMENSIONS_INVALID:
		"画像サイズを確認してください。縦横64px以上、合計1,048,576画素以下が必要です。",
	IMAGE_DECODE_FAILED:
		"画像を読み込めませんでした。破損していないPNG/JPEG/WebPを使用してください。",
	SOURCE_PREPARE_FAILED: "画像アップロードを準備できませんでした。後で再試行してください。",
	SOURCE_WRITE_FAILED: "画像をアップロードできませんでした。通信を確認して再試行してください。",
	SOURCE_FINALIZE_FAILED: "画像の安全確認を完了できませんでした。後で再試行してください。",
	CONFIRMATION_REQUIRED: "注意事項を確認してください。",
	VALIDATION_ERROR: "入力内容を確認してください。",
	DUPLICATE_IN_REQUEST: "同じ内容のカード案が含まれています。",
	DUPLICATE_EXISTING: "同じ内容のカードがすでに登録されています。",
	DECK_NOT_FOUND: "対象デッキを確認できません。",
	QUOTA_EXCEEDED: "本日のAIカード作成上限に達しました。",
	CONFLICT: "別の処理と競合しました。状況を再取得してください。",
	SERVICE_UNAVAILABLE: "登録サービスを利用できません。後で再試行してください。",
};

export function safeCodeMessage(code: string): string {
	return (
		SAFE_MESSAGES[code] ?? "処理を完了できませんでした。安全のため入力内容は表示していません。"
	);
}
