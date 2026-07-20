# 要件定義書: 初回ユーザー向けデッキ作成導線とMCP create_deck

## 1. 方針

S-16 は既存 `decks` table と owner-scoped RLS / Supabase Auth 境界を使い、初回ユーザーがUIまたはRemote MCPから本人所有デッキを1件作成できるようにする。カード登録の意味、preview HMAC、commit idempotency、status pollはS-10〜S-14の既存契約を変更しない。

## 2. 前提

- `decks` table は `id gen_random_uuid()`, `owner_user_id NOT NULL`, `name NOT NULL`, `new_limit_per_day DEFAULT 10` を持つ。
- `decks_insert_owner` RLS policy は `auth.uid() = owner_user_id` を要求する。
- `createJwtScopedClient` を使うMCP serviceはBearer JWT actorでRLSを通る。
- 現行 `frontend/package.json` に Playwright と `dev` script はない。UIのL3確認は `npm exec -- next dev` または手動/外部browser runnerで記録する。

## 3. Must

- REQ-UI-01: `/decks` はデッキ0件時と既存デッキあり時の両方でデッキ作成フォームを表示する。
- REQ-UI-02: デッキ作成フォームは送信中にsubmitをdisabledにし、ユーザーに処理中状態とvalidation errorを表示する。
- REQ-UI-03: 作成成功後、`/decks` の一覧へ作成済みデッキが表示される。
- REQ-ACTION-01: Server Action は副作用前に `auth.getUser()` でログインを確認し、未認証なら安全な失敗を返す。
- REQ-ACTION-02: Server Action は `owner_user_id` をフォーム/MCP入力から受け取らず、認証済みuser IDだけをinsertに使う。
- REQ-ACTION-03: デッキ名は共有validatorでtrim後1〜80文字、制御文字なしを要求し、失敗時はDBへinsertしない。
- REQ-ACTION-04: 作成時は `new_limit_per_day` を入力に持たせず、DB defaultを使う。
- REQ-ACTION-05: 作成成功後は `/decks` をrevalidateし、UIの次renderで一覧に反映する。
- REQ-MCP-01: `create_deck` を静的MCP allowlist、descriptor、runtime schema、service interfaceへ追加する。
- REQ-MCP-02: `create_deck` inputは `{ name: string }` のstrict objectとし、未知field、空文字、長すぎる名前、制御文字をservice呼出し前またはservice内で拒否する。
- REQ-MCP-03: `create_deck` はJWT actor本人の `owner_user_id` だけで `decks` にinsertし、成功時に `{ deck: { id, name } }` を返す。
- REQ-MCP-04: `create_deck` は他owner ID、owner override、`new_limit_per_day` overrideを受理しない。
- REQ-MCP-05: `list_decks` は `create_deck` 後の本人所有deckを返し、他owner deckを返さない。
- REQ-FLOW-01: ChatGPT / MCPの手順は `list_decks` が空なら `create_deck` を実行し、その `deck.id` を `preview_card_import.request.deck.id` に使い、`commit_card_import` と `get_import_status` へ進める。
- REQ-DOC-01: runbook は初回ユーザー向けの `create_deck` 分岐と、証跡にdeck名やcard本文など不要な個人情報を残さない注意を含む。

## 4. Should

- SHOULD-01: UIとMCPで同じデッキ名validatorを再利用し、エラーメッセージの意味を揃える。
- SHOULD-02: 同じフォームの連続クリックは `useFormStatus` のpending disabledで抑止する。
- SHOULD-03: ネットワーク再送やブラウザ戻る再送で同名deckが複数できた場合でも、作成後の一覧表示とエラー表示が破綻しない。

## 5. Won't

- WON'T-01: デッキ名の一意制約やDB migrationは追加しない。
- WON'T-02: `create_deck` にidempotency keyを必須化しない。
- WON'T-03: AIカード import request の `deck.create` モードをRemote MCP tool inputへ追加しない。
- WON'T-04: デッキ削除、編集、並び替え、学習設定編集は実装しない。

## 6. 非機能・セキュリティ要件

- NFR-SEC-01: 未認証requestではDMLを0回にする。
- NFR-SEC-02: MCP tool result、error、logにaccess token、secret、SQL、stack、他owner情報を含めない。
- NFR-SEC-03: service role clientを本人owner deck作成に使わない。
- NFR-UX-01: `/decks` の主要submitは48px以上のtouch targetを持ち、320px幅で横scrollしない。
- NFR-COMPAT-01: `MCP_ENABLED=false` のfail-closed挙動、既存8 toolのschema/error契約、既存デッキ詳細からのAIカード作成リンクを維持する。

## 7. 受入条件対応

| AC | 要件 |
|---|---|
| AC-01 デッキ0件の `/decks` 作成 | REQ-UI-01, REQ-ACTION-01〜05 |
| AC-02 作成後一覧表示 | REQ-UI-03, REQ-ACTION-05 |
| AC-03 `list_decks` 反映 | REQ-MCP-05 |
| AC-04 `create_deck` 本人所有作成 | REQ-MCP-01〜03 |
| AC-05 他owner非参照 | REQ-ACTION-02, REQ-MCP-04, NFR-SEC-01〜03 |
| AC-06 preview/commit連携 | REQ-FLOW-01 |
| AC-07 入力検証 | REQ-ACTION-03, REQ-MCP-02 |
| AC-08 重複送信 | REQ-UI-02, SHOULD-02, SHOULD-03 |
| AC-09 既存導線維持 | NFR-COMPAT-01 |

## 8. 未解決事項

- `create_deck` の完全な冪等性を idempotency key + unique marker で保証するかはFuture。S-16ではpending disabledと、DB migrationなしの許容可能なUXに留める。
