# 外部ツール・Connector 方針

KANJI-EVERYDAY の開発に、プロジェクト固有の MCP Server は必須ではない。存在しない `.mcp.json`、同期 script、外部アカウントを前提にしない。

## GitHub

- Issue、Pull Request、comment の API 操作は GitHub Connector/MCP を優先する。
- Codex sandbox で GitHub CLI が必要な場合は、`AGENTS.md` に従い `GH_PAGER=cat gh ...` を使用する。
- token を repository、ログ、コマンド例へ埋め込まない。

## Supabase / Vercel / Gemini

- 接続や変更は各公式 CLI/API を使用し、対象環境と project を確認してから実行する。
- remote migration、production deploy、実 Gemini request は外部状態・データ・費用への影響を明示する。
- credential が利用できない場合は mock / static validation の結果と実環境未検証を分けて報告する。

## UI デザイン

Figma は使用しない。Figma MCP、Personal Access Token、Figma cache、Figma importer をセットアップしない。UI の正本は Story requirements/design、`.claude/steering/design-system.md`、既存 component とする。

## セキュリティ

- access token、service account key、Supabase key、Gemini key を Git に commit しない。
- secret の存在確認で値を画面やログへ出力しない。
- 最小権限と環境分離を守り、漏洩時は即時 revoke / rotate する。
