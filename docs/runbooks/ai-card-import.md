# AIカード import release runbook

この runbook は AIカード作成機能を本番相当環境で有効化する前の確認手順である。secret、token、cookie、画像bytes、カード本文、原文promptは記録しない。

## 1. 事前確認

- 対象 git SHA を記録する。
- 対象 Vercel URL と Supabase project ref を記録する。
- `AI_CARD_IMPORT_ENABLED`、`MCP_ENABLED`、OpenAI/Gemini provider 設定、worker / cleanup schedule の有効状態を確認する。
- Supabase migration が対象環境で最新であることを確認する。

## 2. Repo gate

`frontend/` で実行する。

```bash
npm run check
npm run build
```

DB接続がある場合は、対象 story の追加 gate も実行する。

```bash
npm run test:s10:inventory
npm run test:s11:inventory
npm run test:s13:database
```

S-14 MCP の real DB gate は、必要な環境変数が揃っている場合だけ実行する。未実施を pass として記録しない。

## 3. Staging load gate

目的は provider / upload 処理時間を除いた commit API の受付性能を測ること。

- 100件の commit request を staging に送る。
- p95 が 2,000ms 以下であること。
- HTTP 5xx が0件であること。
- request body、card text、preview token、idempotency key、authorization token は証跡へ保存しない。
- 証跡には件数、p50/p95/max、5xx件数、対象SHA、対象URL、実行日時だけを残す。

## 4. 50カード並行 gate

- 50カード相当の import を並行または同時再送条件で実行する。
- duplicate card、quota overrun、orphan Storage object が0件であることをDB/Storage集計で確認する。
- 別ownerのdeck/card/batch IDを指定する negative case が404または権限エラーになることを確認する。

## 5. Cleanup gate

- source/upload temporary object の 23:59:59 と 24:00:00 境界を固定して確認する。
- 24時間未満のobjectが削除されないこと。
- 24時間到達後のcleanupで対象objectと tracking row が削除または deleted terminal へ遷移すること。
- active reference のある illustration object は削除されないこと。

## 6. Redaction gate

次を確認する。

- client bundle に server-only env 名の実値が含まれない。
- runtime log に API key、token、cookie、画像bytes、raw prompt、card front/back、provider raw body が含まれない。
- evidence JSON / markdown には secret 実値を入れない。

## 7. Claude live-client gate

Claude の本番相当クライアントで次を1回以上実行する。

1. MCP resource discovery。
2. Dynamic Client Registration。
3. OAuth Authorization Code + PKCE。
4. 日本語 consent approve。
5. `list_decks`。
6. `list_decks` が空なら `create_deck` を実行し、返却された `deck.id` を以降の登録先にする。既存deckがある場合は本人所有deckの `id` を1件選ぶ。
7. `preview_card_import` の `request.deck.id` に、前手順で決めたdeck IDを指定する。
8. `commit_card_import`。
9. `get_import_status` terminal poll。
10. connection revoke。
11. revoke後の同一接続または旧tokenが401になること。

証跡には client名/version、日時、対象SHA、public MCP URL、Hosted project ref、tool名、HTTP status、safe resultだけを残す。secret、token、cookie、deck名、カード本文、raw prompt、raw errorは残さない。

## 8. ChatGPT live-client gate

ChatGPT の本番相当クライアントで Claude と同じ flow を実行する。`list_decks` が空の場合は `create_deck` を挟み、返却された `deck.id` を `preview_card_import.request.deck.id` に使う。ChatGPT 固有の再認証要求が出る場合は、`_meta["mcp/www_authenticate"]` の challenge が auth failure のみに付くことを確認する。

## 9. Rollback / restart gate

1. `AI_CARD_IMPORT_ENABLED=false` でUI/routeの新規受付が停止すること。
2. `MCP_ENABLED=false` でMCP endpoint/tool dispatchが停止すること。
3. Supabase OAuth DCRを停止し、新規client登録が拒否されること。
4. 既存grantをrevokeし、旧access tokenの次requestが401になること。
5. Queue worker停止中も既存queue dataが保持されること。
6. worker再開後に既存queueが重複なく継続すること。

## 10. 完了判定

S-15 を close できるのは、次のどちらかの場合だけである。

- issue #15 の全ACが `passed` 証跡を持つ。
- 本番未稼働などの理由でユーザーが明示的にスコープを「runbook/evidence tracker 作成まで」に変更し、その判断を issue コメントへ残す。
