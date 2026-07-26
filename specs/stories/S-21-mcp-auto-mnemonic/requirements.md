# 要件定義書: Remote MCP 登録カードのニーモニック自動生成・自動承認（S-21 / issue #70）

## 1. 目的

Remote MCP 経由で登録されたカードにも、アプリ経由カードと同じ E-16 体験を与える。すなわち
答え側の説明ブロック（#52）が表示され、イラストが S-16H の承認 slots 駆動テンプレで生成される状態にする。
そのために、MCP 登録の対象カードについてニーモニック slots / explanation をサーバ側で生成し、
moderation を通し、`status='approved'` で `card_mnemonics` へ owner スコープ保存する。

## 2. 実コードで確認した現状（2026-07-26 時点 / 全て実ファイル参照）

| 事実 | 参照 |
|---|---|
| MCP は共有 service `previewCardImport` / `commitCardImport` を actor=`remote_mcp` で使う | `frontend/src/lib/mcp/services.ts:37-60` |
| commit は `s14_remote_commit_import` を 8 引数で呼ぶ（`p_mnemonics` なし） | `frontend/src/lib/ai-import/remote-mcp-repository.ts:34-43` |
| `s14_remote_commit_import` は SECURITY DEFINER / OWNER `s10_migration_owner` / GRANT `authenticated` のみ | `supabase/migrations/20260720000004_...sql:6-127` |
| 同 RPC は `ai_s14_enqueue_import_internal` を呼ぶだけで `card_mnemonics` を書かない | 同上 :104-118 |
| `ai_s14_enqueue_import_internal` は同一 TX で concept job と illustration 行を materialize する（`image_mode <> 'none'` のときのみ） | `supabase/migrations/20260719000002_...sql:161-214` |
| illustration_key は `'s11:' || batchId || ':' || sha256(conceptId)` | 同上 :209 |
| `cards.illustration_key` は job に illustration がある場合のみ設定される（無ければ NULL） | `supabase/migrations/20260715000000_...sql:1360-1393` |
| **MCP tool schema は `image.mode === "ai"` を拒否する** | `frontend/src/lib/mcp/tools.ts:32` |
| MCP には upload 用 tool が無い（`uploadId` は MCP 単体では取得できない） | `frontend/src/lib/mcp/tools.ts:72-120` |
| #52 の説明表示は `card_mnemonics` を `illustration_key` で引く | `frontend/src/actions/session-actions.ts:530-552` |
| #59 の画像生成は承認済み `card_mnemonics.slots` を `illustration_key` で引き、無ければ起動しない／旧プロンプトへ落ちる | `frontend/src/actions/illustration-actions.ts:313-464`, `supabase/migrations/20260725000000_...sql` |
| `card_mnemonics` は `UNIQUE (owner_user_id, illustration_key)`、`illustration_key` は NOT NULL | `supabase/migrations/20260721000001_...sql:4-15` |
| `card_mnemonics` の owner は `s10_migration_owner`（#55 で修正済み） | `supabase/migrations/20260724000000_...sql:18` |
| アプリ経路の先例は DROP + CREATE（`p_mnemonics jsonb DEFAULT NULL` 追加）で GRANT を同一 migration 内に再宣言 | `supabase/migrations/20260722000000_...sql:14-143` |
| 単体の「漢字＋意味 → mnemonic」生成関数は存在しない。S-16C の concept 生成に内包 | `frontend/src/lib/ai-card-generation/openai-adapter.ts:19-276` |
| mnemonic の正本形（mappings 2–4・maxLength・小学生向け日本語）は S-16C の strict schema と `parseMnemonic` | 同上 :14-17, 129-132, 229-276 |
| moderation / sanitize は再利用可能 | `frontend/src/lib/ai-card-generation/moderation.ts`, `.../mnemonic-sanitize.ts` |
| `reserve_provider_usage_internal` は `kind='card_generation'` かつ `source='remote_mcp'` のとき **units は 0 でなければならない** | `supabase/migrations/20260714000000_...sql:2728-2731` |
| `kind='illustration_concept'` は `source='remote_mcp'` を許容（batch の source と一致必須） | 同上 :2737-2790 |
| MCP route は `runtime = "nodejs"`、`maxDuration` 未設定 | `frontend/app/api/mcp/route.ts:3` |
| flag は `isAiCardImportEnabled()`（`AI_CARD_IMPORT_ENABLED`） | `frontend/src/lib/env.ts:82` |

## 3. issue の前提との差分（最重要）

issue AC-1 は「MCP 登録（image ai/upload、対象カード）」を前提にしているが、**MCP からは `image.mode="ai"` を
送れず、`upload` も MCP 単体では到達不能**。したがって現状の MCP カードは全て `illustration_key = NULL` であり、
`card_mnemonics` に紐付ける先が存在しない。RPC 拡張だけでは AC-1 / AC-3 は達成できない。

→ 本 Story は「MCP からの `image.mode="ai"` 許可」を **前提条件 R-0** として含める（design.md D0）。
これは外部 MCP tool 契約の変更かつ MCP 利用者に画像生成コストを発生させる変更なので、**実装着手前に承認が必要**。

## 4. 機能要件

- **R-0**（前提・要承認）: MCP tool `preview_card_import` / `commit_card_import` の `items[].image` が
  `{mode:"ai"}` を受け付ける。`isAiCardImportEnabled()` が false のときは従来どおり拒否する。
- **R-1**: MCP commit 時、`image.mode === "ai"` の concept について、サーバ側で mnemonic slots / explanation を
  生成する。生成は MCP client 入力を受け取らない（client は mnemonic を指定できない）。
- **R-2**: 漢字文字列と `isSingleKanji` は `front` / `back` と `pattern` からサーバ側で決定論的に導出し、
  モデル出力で上書きしない。
- **R-3**: 生成結果は S-16C の正本形（`mappings` 2–4、各フィールド maxLength、小学生向けやさしい日本語）に
  適合し、既存 sanitize を通す。
- **R-4**: 生成テキストは output 段の moderation を通す。flag された concept はその concept のみ破棄する。
- **R-5**: `s14_remote_commit_import` が `p_mnemonics jsonb` を受け取り、同一 TX で `card_mnemonics` へ
  `status='approved'` の owner スコープ upsert を行う。owner は JWT claims 由来の actor で、payload から取らない。
- **R-6**: 生成 / moderation / 保存の失敗はカード登録をブロックしない。mnemonic のみ欠落する。
- **R-7**: MCP tool 応答に slots / explanation / storage 内部情報を含めない。
- **R-8**: `isAiCardImportEnabled()` が false、または OpenAI 設定が不備のときは従来動作（mnemonic なし）。
- **R-9**: 新しい quota kind を増やさない。`reserve_provider_usage(card_generation, remote_mcp)` は
  units=0 の既存契約を維持する。

## 5. 非機能要件

- **N-1（レイテンシ）**: MCP commit は外部 client の同期 tool 呼び出し。生成対象 concept 数の上限、
  並列度、全体 wall-clock 予算を設け、超過分は生成をスキップして commit を完了させる。
- **N-2（セキュリティ）**: owner 三層分離（認証 / 所有権 / RLS）を維持。`OPENAI_API_KEY` を
  ブラウザ・MCP 応答・ログへ出さない。共有 service に MCP 固有フィールドを足さない（#61 の教訓）。
- **N-3（回帰なし）**: 既存 MCP preview / commit / status / undo とアプリ経路の挙動を変えない。

## 6. 受入条件（issue #70 AC のトレース）

| AC | 内容 | 検証 |
|---|---|---|
| AC-1 | MCP 登録（`image.mode="ai"` の concept）で `card_mnemonics` に `status='approved'` 行が owner スコープで作られる | 契約テスト + 可能なら int |
| AC-2 | 生成が正本形（mappings 2–4・小学生向け日本語）に適合し moderation を通る | unit |
| AC-3 | MCP カードでも #52 説明表示・#59 承認 slots 駆動画像になる | 既存経路の再利用で担保（illustration_key 一致）+ int |
| AC-4 | 生成 / moderation 失敗でもカードは作成される | unit |
| AC-5 | MCP 出力に slots / explanation / storage 内部が漏れない。owner 分離維持 | unit（応答 shape 断定）+ 契約テスト |
| AC-6 | flag 無効時は従来動作 | unit |
| AC-7 | 既存 MCP / アプリ経路に回帰なし | 既存テスト全通過 |
| AC-8 | `npm --prefix frontend run check` 通過 | 品質ゲート |

## 7. 規模判定

**大規模**。変更ファイル 8〜12（migration、Database 型、MCP tool schema、MCP services、
remote-mcp-repository、新規生成モジュール、env、テスト）。migration・外部 API 契約（MCP tool schema / OpenAI）・
料金・認証境界に触れるため、ファイル数に関わらず大規模として扱う。ADR は既存 ADR-012（承認済み mnemonic の
commit 同伴・owner 非受領）の適用で足り、新規 ADR は不要。ADR-012 の決定 4/5 を MCP 経路へ拡張する旨を
design.md に記録する。

## 8. 停止・承認が必要な事項

1. **R-0**: MCP からの `image.mode="ai"` 許可（外部 tool 契約変更 ＋ MCP 利用者への画像生成コスト発生）。
2. 新規 migration の適用（`s14_remote_commit_import` の signature 変更）。適用先環境の確認が必要。
3. MCP route への `maxDuration` 設定（Vercel 実行時間・課金に影響）。
4. 新規環境変数（生成上限・並列度）の追加。
