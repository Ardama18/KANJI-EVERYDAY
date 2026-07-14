---
id: S-10
feature: ai-card-import-foundation
type: design
version: 1.1.1
created: 2026-07-14
updated: 2026-07-14
based_on: specs/stories/S-10-ai-card-import-foundation/requirements.md
adr: specs/adr/ADR-007-ai-card-import-foundation.md
---

# AI Card Import Foundation Design Document

## 1. 概要

S-10は、AI生成済みのR1/W1案をprivate cardへ安全に取り込むDB基盤と共有ドメイン契約を追加する。既存Auth、`cards`、`decks`、`deck_cards`、`review_states`、`study_sessions`、`illustrations`は互換接続先とし、import経路は新しいschema、RPC、RLS、Unicode key、TypeScript validator、preview HMACだけを使う。

永続化は二段階である。信頼済みserver adapterだけが`commit_import`を呼び、batch/items/tagsと既存quota reservation keyの関連を原子的に確定する。provider利用量は`reserve_provider_usage`がprovider直前に予約する。Issue #12 workerがprovider/Storage処理を終えた後、`finalize_import_item`がcard/deck/tag関連をitem単位で原子的に確定する。S-10はQueueを作成しない。

## 2. スコープと実装境界

| 層 | S-10 | 後続 |
|---|---|---|
| shared domain | schema、type guard、normalization、card key、canonical hash、HMAC | UI/MCP adapterで再利用 |
| DB | forward migration、tables、RLS、trigger、RPC、quota、undo | Queue/`pgmq`なし |
| worker境界 | `reserve_provider_usage`、`finalize_import_item`、`mark_import_item_failed` primitive | #12が呼出・retry |
| app/transport | shared入力契約、trusted server adapter契約、error mapper | UI #13、Remote MCP #11 |
| provider/Storage | upload metadataのowner/state検証まで | provider実行、画像生成、Storage処理 #12 |

## 3. アーキテクチャ

```text
UI (#13) ----\
               > shared schema -> Stage 1 -> preview HMAC
MCP (#11) ---/                         |
                                       v
                     trusted server adapter
                    auth/HMAC/hash/source verify
                                       |
                                       v service_role only
                              commit_import wrapper
                     batch + items + tags + reservation links
                                       |
                         reserve_provider_usage
                           (immediately pre-provider)
                                       |
                          [Queue/worker is Issue #12]
                                       |
                                       v
                         finalize_import_item (1 tx)
                         card + deck_card + card_tags
                                       |
                                       v
               existing cards/decks/review/study/illustrations
```

### 状態遷移

```text
batch:  committed ----> processing ----> completed
           |                |                 |
           +----------------+-----------------+--> undone

item:   committed ----> processing ----> finalized
   |                      |    \----------> failed
   +----------------------+---------------> deleted
   +--------------------------------------> undone
                          +-- retry keeps the same item id

finalize(finalized): return the recorded result (no new side effect)
undo(undone):         return the recorded result (no new side effect)
```

`processing`への遷移は#12が利用できるがQueueの存在を前提にしない。`deleted`は個別削除tombstone、`undone`はbatch undoが実際に取り消したitemである。batchは全itemが`finalized|failed|deleted|undone`の終状態になったとき`completed`または`undone`へ更新する。

## 4. データ設計

### 4.1 既存tableのforward変更

#### `cards`

| 列/制約 | 設計 |
|---|---|
| `updated_at timestamptz NOT NULL DEFAULT now()` | `set_cards_updated_at` triggerで実更新時に更新 |
| owner/visibility check | publicはowner NULL、privateはowner NOT NULL |
| `card_key` check | lowercase hex 64文字 |
| 旧`UNIQUE(card_key)` | drop |
| `cards_public_card_key_uidx` | unique(`card_key`) where public |
| `cards_private_owner_card_key_uidx` | unique(`owner_user_id`,`card_key`) where private |
| `cards_id_owner_uq` | unique(`id`,`owner_user_id`)、private複合FK用 |

`compute_card_key`をBEFORE INSERT OR UPDATEで実行し、caller提供keyを信用せず新Unicode規則で常に再計算する。`card_key`だけを直接改変するUPDATEも元の本文から正しい値へ戻る。既存cardはmigration内で同じ関数を使いbackfillする。Seedの他の列と関連は更新しない。公開cardのUPDATE/DELETEはRLSと`protect_public_cards` triggerの双方で拒否する。

既存`seed.sql`もforward互換に更新する。key materialを`ai_compute_card_key`で作り、`ON CONFLICT (card_key) WHERE visibility='public' DO NOTHING`へ確定する。解決CTEも新keyでjoinする。これにより部分unique移行後のseed再実行でcard ID・deck関連・件数を変えない。

#### `deck_cards`

`enforce_deck_card_owner`をBEFORE INSERT OR UPDATEで実行する。deck ownerを取得し、cardが`public`または`private AND card.owner_user_id=deck.owner_user_id`の場合だけ許可する。card/deckが見つからない場合はFKへ委ねず安全なnot-foundにする。`idx_deck_cards_card_id`は維持する。

#### `study_sessions` / `review_states`

- `study_sessions`のINSERT/UPDATE triggerはcurrentと4 queueから有効なUUID文字列だけを抽出し、INSERTではNEW、UPDATEではOLDとNEWの和集合についてcard advisory lockをUUID昇順取得する。
- `cards` UPDATE/DELETE triggerも同じlockを取得後、ownerの未完了sessionを検索する。
- front/back/skill/patternが`IS DISTINCT FROM`で変わったcards UPDATEのAFTER triggerは`review_states WHERE card_id=NEW.id`を削除する。

### 4.2 新規tables

すべてのUUID PKは`gen_random_uuid()`、時刻は`timestamptz NOT NULL DEFAULT now()`とする。text enumはCHECKで値を固定し、後続追加はforward migrationで行う。

#### `ai_import_batches`

| 列 | 型/制約 | 用途 |
|---|---|---|
| `id` | uuid PK | batch ID |
| `owner_user_id` | uuid NOT NULL FK auth.users | owner |
| `source` | text CHECK `app_ai|remote_mcp` | quota判定元 |
| `target_deck_id` | uuid NULL FK decks ON DELETE SET NULL | 確定先。deck削除後もbatch履歴を保持 |
| `auto_created_deck_id` | uuid NULL FK decks SET NULL | undoで空なら削除するdeck |
| `status` | text CHECK `committed|processing|completed|undone` | batch状態 |
| `idempotency_key` | text CHECK 1..128 | owner単位冪等key |
| `import_request_hash` | text CHECK lowercase hex 64 | provider結果を含む最終canonical import hash |
| `card_reservation_key` | text NULL | provider直前card reservationとの関連 |
| `requested_card_count` | smallint CHECK 1..50 | 展開後card数 |
| `requested_image_count` | smallint CHECK 0..50 | AI画像concept数 |
| `finalized_count`,`failed_count` | smallint NOT NULL DEFAULT 0 | 集計 |
| `created_at`,`updated_at`,`completed_at`,`undone_at` | timestamptz | 監査 |
| `undo_result` | jsonb NULL | 再undoで返すsafe counts/auto-deck結果 |

制約/index:

- unique `(owner_user_id,idempotency_key)`
- unique `(id,owner_user_id)`（子table複合FK用）
- index `(owner_user_id,created_at DESC)`、`(status,created_at)`
- triggerでtarget/auto-created deck ownerがbatch ownerと一致することを保証する

#### `ai_import_items`

| 列 | 型/制約 | 用途 |
|---|---|---|
| `id` | uuid PK | item ID |
| `owner_user_id`,`batch_id` | uuid NOT NULL | batchとのowner複合FK |
| `client_item_id` | text CHECK 1..64 | request内識別子 |
| `concept_id` | text CHECK 1..64 | R1/W1 pair単位 |
| `ordinal` | smallint CHECK 0..49 | canonical順 |
| `pattern` | text CHECK `R1|W1` | pattern |
| `skill` | text CHECK pattern対応 | `R1=reading`,`W1=writing` |
| `front_text`,`back_text` | text CHECK char_length 1..200 | 正規化表示値 |
| `card_key` | text CHECK lowercase hex 64 | duplicate key |
| `image_mode` | text CHECK `none|ai|upload` | 画像方式 |
| `upload_id` | uuid NULL | owner付きupload参照 |
| `illustration_reservation_key` | text NULL | concept単位reservationとの関連 |
| `status` | text CHECK `committed|processing|finalized|failed|deleted|undone` | item状態 |
| `result_card_id` | uuid NULL FK cards SET NULL | finalize結果 |
| `deleted_card_id` | uuid NULL | 個別削除card ID tombstone（FKにしない） |
| `error_code` | text NULL | 安定codeのみ |
| `error_detail` | jsonb NOT NULL DEFAULT `{}` | 非機密detailのみ |
| `terminal_attempt_key` | text NULL | failed再送の冪等key |
| `user_edited_at` | timestamptz NULL | undo guard |
| `created_at`,`updated_at`,`finalized_at`,`failed_at`,`deleted_at`,`undone_at` | timestamptz | 監査 |

制約/index:

- FK `(batch_id,owner_user_id)` -> batches `(id,owner_user_id)` CASCADE
- unique `(batch_id,client_item_id)`、`(batch_id,ordinal)`、`(batch_id,card_key)`
- unique `(id,owner_user_id)`、partial unique `(result_card_id) WHERE result_card_id IS NOT NULL`
- image/upload整合: `upload`だけupload_id必須、それ以外NULL
- finalizedはresult_card_id/finalized_at必須。deletedはresult_card_id NULL、deleted_card_id/deleted_at必須。failedはresult_card_id NULL、error_code必須。undoneはresult_card_id NULL、undone_at必須。committed/processingは結果・削除・undo列をすべてNULLとする
- index `(owner_user_id,status,created_at)`、`(batch_id,status)`

R1/W1 pairの相互一致とconcept内各pattern最大1件は、commitのset validationに加えunique `(batch_id,concept_id,pattern)`で保証する。

#### `ai_uploads`

| 列 | 型/制約 |
|---|---|
| `id`, `owner_user_id` | uuid、owner FK |
| `upload_key` | text CHECK 1..128、owner単位冪等key |
| `purpose` | text CHECK `card_illustration` |
| `storage_path` | text NOT NULL、1..1024、先頭`/`禁止、`..` segment禁止 |
| `mime_type` | text CHECK allow list (`image/png`,`image/jpeg`,`image/webp`) |
| `byte_size` | bigint CHECK 1..10 MiB |
| `status` | text CHECK `ready|consumed|deleted` |
| `created_at`,`consumed_at` | timestamptz |

unique `(id,owner_user_id)`、unique `(owner_user_id,upload_key)`、unique `(owner_user_id,storage_path)`。itemは`(upload_id,owner_user_id)`複合FKで参照し、commit時に`ready`をlockする。consumeはfinalizeと同一transactionで一度だけ行う。

#### `tags`

| 列 | 型/制約 |
|---|---|
| `id`, `owner_user_id` | uuid、owner FK |
| `display_name` | text CHECK 1..30 |
| `normalized_name` | text CHECK 1..30 |
| `created_at`,`updated_at` | timestamptz |

unique `(owner_user_id,normalized_name)`、unique `(id,owner_user_id)`。client/RPCは`normalized_name`を指定できない。BEFORE INSERT OR UPDATE triggerが入力`display_name`をNFKC・固定空白処理した表示値へ上書きし、その値からUnicode lowercaseした`normalized_name`を必ず再導出する。空/長さ超過はtriggerで拒否する。upsert競合時は最初の表示名を保持し、冪等再送で上書きしない。

#### `ai_import_item_tags`

`owner_user_id`,`item_id`,`tag_id`を持ち、PK `(item_id,tag_id)`、複合FK `(item_id,owner_user_id)`と`(tag_id,owner_user_id)`でownerを固定する。1 item最大10件はdeferred constraint triggerでも検証するが、commitは挿入前に全件検証する。

#### `card_tags`

`owner_user_id`,`card_id`,`tag_id`,`created_at`を持つ。PK `(card_id,tag_id)`。複合FKでprivate card/tag/関連ownerを一致させる。public cardへのtag付与はS-10では禁止する。index `(owner_user_id,tag_id)`。

#### `ai_usage_daily` と `ai_quota_reservations`

`ai_usage_daily`:

- `owner_user_id uuid`, `usage_date date`, `generated_card_count int DEFAULT 0`, `generated_image_count int DEFAULT 0`, `updated_at`
- PK `(owner_user_id,usage_date)`
- CHECK `0..200` cards、`0..50` images

`ai_quota_reservations`:

- `id uuid`, `owner_user_id`, `reservation_key text`, `kind text CHECK ('card_generation','illustration_concept')`, `source text`, `generation_request_hash text`, `import_request_hash text NULL`, `usage_date date`
- `batch_id uuid NULL ON DELETE SET NULL`, `item_id uuid NULL ON DELETE SET NULL`, `concept_id text NULL`, `units int`, `status text CHECK ('reserved','exempt')`, `provider_started_at`, `created_at`
- unique `(owner_user_id,reservation_key,kind)`。同じkey/kindでsource/generation hash/unitsが異なる再送は`CONFLICT`。`import_request_hash`はcommit初回に一度だけ関連付け、以後変更不可
- `reserved`はunits > 0、`exempt`はunits = 0。app AIだけがreservedになり、MCP card/upload imageの免除はtrusted contextからexemptとして記録する

`reserve_provider_usage`がgeneration入力+requested unitsの`generation_request_hash`、usage、reservationを同一transactionで確定する。app card generationはprovider呼出直前に`card_generation`を、illustrationは各distinct concept処理開始直前に`illustration_concept`を予約する。provider開始前の入力拒否はRPCを呼ばないため消費0、予約成功後はprovider結果にかかわらず返却しない。`commit_import`はusageを加算せず、owner/source/key/unitsを検証して最終`import_request_hash`を初回関連付けする。workflow同一性はreservation keyで追跡する。

## 5. RLS・権限matrix

| table | owner SELECT | owner direct write | non-owner/anon | 書込経路 |
|---|---:|---:|---:|---|
| private `cards` | allow | allow、trigger guard付き | deny | 既存DML + 管理/finalize RPC |
| public `cards` | 既存public read | deny | SELECTのみ既存契約 | Seed/service保守のみ |
| `deck_cards` | owner deckのみ | deny | deny | 管理RPC/finalizeのみ |
| batches/items | allow | deny | deny | trusted/internal RPCのみ |
| uploads | allow | deny | deny | owner認証済みupload登録RPC + finalize consume |
| tags | allow | owner CRUD | deny | direct/RPC、複合FK適用 |
| item_tags | batch owner SELECT | deny | deny | commitのみ |
| card_tags | owner SELECT | deny | deny | 管理RPC/finalizeのみ |
| usage/reservations | usageのみowner SELECT | deny | deny | trusted quota RPCのみ。reservationはclient非公開 |

全owner policyは`(SELECT auth.uid()) = owner_user_id`を使う。新規domain tablesはRLSを有効化し、書込policyを持たないtableは`SECURITY DEFINER` wrapper/internal primitiveだけから変更する。clientから来るJWTの`authenticated` roleと、secretを保持する信頼済みserver adapter/workerの`service_role`を区別する。service role wrapperもowner/source/hash/stateを保存済み行と照合し、roleだけを業務認可にしない。

### RPC EXECUTE

| function | authenticated | service_role | anon/public |
|---|---:|---:|---:|
| `commit_import`,`reserve_provider_usage` | deny | allow（trusted adapterのみ） | deny |
| `update_imported_card`,`delete_private_card`,`undo_import`,`set_card_decks`,`set_card_tags`,`set_card_illustration` | allow | deny | deny |
| `register_ai_upload`,`finalize_import_item`,`mark_import_item_failed` | deny | allow（trusted adapter/workerのみ） | deny |
| `*_internal`、全trigger functions | deny | deny（直接呼出不可） | deny |
| normalization/card-key helpers | 必要なimmutable関数のみallow | allow | 原則deny |

wrapperは`SECURITY DEFINER`かつ`SET search_path = pg_catalog, pg_temp`とし、`public` objectを必ず完全修飾してinternal primitiveを呼ぶ。internal/trigger関数を含む全functionは作成直後に`REVOKE ALL ON FUNCTION ... FROM PUBLIC`し、wrapperだけを表のroleへgrantする。function ownerはlogin用途に使わないmigration ownerへ固定する。`REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated`を適用し、schema CREATEはmigration ownerだけへgrantする。

## 6. 共有TypeScript契約

配置:

```text
frontend/src/lib/ai-import/schema.ts
frontend/src/lib/ai-import/normalize.ts
frontend/src/lib/ai-import/card-key.ts
frontend/src/lib/ai-import/canonical-request.ts
frontend/src/lib/ai-import/preview-token.ts
frontend/src/lib/ai-import/errors.ts
specs/stories/S-10-ai-card-import-foundation/fixtures/unicode-card-key.json
```

外部runtime validator依存は追加しない。`unknown`を受けるtype guardはfield path付きissue配列を返し、検証成功時だけbranded normalized typeを生成する。

```ts
type Pattern = 'R1' | 'W1'
type ImageInput =
  | { mode: 'none' }
  | { mode: 'ai' }
  | { mode: 'upload'; uploadId: string }

type ImportItemInput = {
  clientItemId: string
  conceptId: string
  pattern: Pattern
  front: string
  back: string
  tags: string[]
  image: ImageInput
}

type ImportRequestInput = {
  deck: { id: string } | { name: string } | { create: { name: string } }
  items: ImportItemInput[]
}
```

`source`はclient schema/canonical requestから完全に除外する。trusted server adapterだけがroute/configから`'app_ai'|'remote_mcp'`を導出し、HMAC検証済みowner/request hashと一緒にservice-role wrapperへ渡す。MCP/upload免除もこのtrusted contextと保存済みimage modeから決め、request内flagを受け付けない。

Stage 1は次を全件収集してから失敗させる: shape、1..50 cards、client ID、R1/W1 skill/pair、漢字含有、text長、tag上限/重複、batch card key重複、deck指定の排他。DB lookupが必要なowner内重複、deck/upload所有権、quotaはread-only preview serviceで行い、途中失敗時も書き込まない。

### Unicode正規化

`normalizeForKey`:

1. `value.normalize('NFKC')`
2. 固定White_Space集合をASCII SPACEへ置換
3. 先頭末尾SPACE除去、連続SPACEを1文字へ圧縮
4. `toLowerCase()`

表示値は1〜3までを適用しcaseを保持する。tag normalized nameだけ4も適用する。`U+FEFF`は置換しない。漢字判定はUnicode Script=Han相当の固定regexp fixtureを用い、R1ではfront、W1ではbackを漢字側とする。

```ts
cardKey = hex(sha256(utf8(
  pattern + '\u001f' + normalizeForKey(front) + '\u001f' + normalizeForKey(back)
)))
```

SQL `ai_normalize_key_text` / `ai_compute_card_key`も同じfixtureを通す。NFKC、固定space文字列、ICU `und` lowercaseのいずれかが利用不能ならmigration/CIを失敗させる。

### generation/import request hash

- `generation_request_hash`: providerへ渡す正規化生成入力、model-independent generation options、requested unitsをcanonical化したUTF-8 SHA-256。provider呼出前reservationの冪等内容を固定する。
- `import_request_hash`: provider結果をStage 1で正規化した最終ImportRequestのcanonical JSONに対するUTF-8 SHA-256。preview/commit内容を固定する。
- 両hashが一致する必要はない。provider前後を同一workflowとして結ぶ識別子はowner scoped `reservationKey`である。

- object key順はschemaで固定する
- itemsは入力ordinal順を保持する
- item tagsは`normalized_name`昇順にsortする
- UUIDはlowercase canonical form、数値はJSON integer、未使用optional keyは省略する
- canonical JSONに余分な空白を入れずUTF-8 SHA-256を取る
- hash対象にはowner/reservation keyを含めず、preview payloadが`userId`と`reservationKey`を別に束縛する

### preview HMAC

```ts
type PreviewPayload = {
  v: 1
  userId: string
  reservationKey: string
  importRequestHash: string
  expiresAt: number // Unix seconds
}

token = base64url(canonicalJson(payload)) + '.' +
        base64url(hmacSha256(secret, payloadPart))
```

発行時TTLは1800秒固定。`sign(payload, secret, now)`と`verify(token, expected, secret, now)`は環境変数を参照しない純粋関数とする。verifyは形式、version、署名（constant-time）、userId、reservation key、期限、import hashの順に検証し、どの失敗もtoken本文をlogしない。adapterがtoken検証を完了するまで`commit_import`を呼ばない。

## 7. RPC契約

JSON引数は`jsonb`で受けるが、関数内で必要列へ展開し、未知field・型・件数を再検証する。戻り値は安定したnamed compositeまたはJSON objectとし、内部rowをそのまま返さない。

### `commit_import`

```sql
commit_import(
  p_actor_user_id uuid,
  p_source text,
  p_idempotency_key text,
  p_import_request_hash text,
  p_request jsonb,
  p_card_reservation_key text
) returns jsonb
```

`service_role`だけへgrantするtrusted adapter wrapperであり、一般`authenticated`は直接呼べない。adapterは呼出前にJWT owner、preview HMAC、reservation key、期限、canonical import hashを検証し、client requestではなくroute/configから`p_source`を導出する。wrapperは引数形式と許可sourceを確認後、外部grantのない`commit_import_internal`を呼ぶ。

internal primitiveの処理:

1. requestを非lock展開してcard key/関連IDを収集し、既存duplicate候補card rowをUUID昇順lockする。
2. actor/idempotencyとowner/card-key advisory lockをcanonical順で取得する。
3. 同key batchをlock。import hash/source/reservation一致なら既存結果を返し、相違なら`CONFLICT`。
4. requestを全set validationし、DB計算`import_request_hash`と引数を比較。lock後のowner既存cardを再照会し、存在時`DUPLICATE_EXISTING`。
5. deck、upload rowsをmatrix順でlockしowner/statusを検証する。deck ID/nameなし・非ownerは`DECK_NOT_FOUND`、name複数は`DECK_AMBIGUOUS`。createはこのtransactionで作る。
6. card reservationをlockし、owner/source/key/kind/requested unitsを照合する。`app_ai`は`reserved`、`remote_mcp`はtrusted contextで作られた`exempt`だけを許可する。初回だけreservationへ`import_request_hash`を設定し、既存別値は`CONFLICT`。usageを増減しない。
7. batchへreservation keyと`import_request_hash`を関連付け、tagsをdisplay nameだけでupsertする。DB triggerが表示/normalized nameを強制導出する。
8. items/item_tagsをordinal順insert。batch ID、status、countsを返す。例外時はdeckを含む全変更をrollback。

同一owner/key/hashの再送は同じbatchを返す。sourceまたはreservation関係が異なる再送も`CONFLICT`であり、既存batchを変更しない。

### `reserve_provider_usage`

```sql
reserve_provider_usage(
  p_owner_user_id uuid,
  p_reservation_key text,
  p_kind text,
  p_source text,
  p_generation_request_hash text,
  p_units integer,
  p_batch_id uuid default null,
  p_item_id uuid default null,
  p_concept_id text default null
) returns jsonb
```

service role専用のQueue非依存wrapperで、外部grantのないinternal primitiveを呼ぶ。app card generationではprovider呼出直前にbatch/itemなしで`card_generation`を予約し、後続commitが同じkeyを関連付ける。illustrationでは#12がdistinct concept処理開始直前にbatch/item/conceptを指定して`illustration_concept`を予約する。

1. owner/reservation key/kind advisory lockを取得。
2. 既存reservationをnon-lock read。同じsource/generation hash/units/関連で確定済みなら同じ結果を返しusage加算0、相違なら`CONFLICT`。
3. 新規確定または関連更新が必要な場合だけ、batch→itemをUUID昇順lockしてowner、generation hash、image mode、conceptを再検証する。
4. DB clockからJST日付を求め、usage rowを`FOR UPDATE`。その後reservation rowを`FOR UPDATE`またはinsertし、advisory取得後に見えた状態を再検証する。順序は必ずbatch/item→usage→reservationである。
5. illustrationはupload modeをtrusted DB rowから`exempt`、AI modeを`reserved`としてitemを`processing`へ遷移。card generationは`app_ai`だけをchargeし、`remote_mcp`を`exempt`とする。client由来免除flagは存在しない。
6. `reserved`は200/50上限を検証・加算し、`exempt`はunits=0で記録する。`provider_started_at`を同transactionで設定し、成功後のquotaは返却しない。

### `register_ai_upload`

```sql
register_ai_upload(
  p_owner_user_id uuid,
  p_upload_key text,
  p_purpose text,
  p_storage_path text,
  p_mime_type text,
  p_byte_size bigint
) returns jsonb
```

Storage uploadとowner確認を終えたtrusted server adapterだけが呼ぶservice-role wrapper。owner/upload-key advisory lock後、同owner/key rowをlockする。同じpurpose/path/MIME/bytesなら既存`ready` rowを返し、差分があれば`CONFLICT`。新規時はowner path prefix、Storage object owner/存在、MIME allow list、1..10 MiBを検証して`ready`をinsertする。`consumed|deleted`のkey再利用は拒否する。内部SQL/Storage metadataをerrorへ出さない。Queue処理は行わない。

### `finalize_import_item`

```sql
finalize_import_item(
  p_owner_user_id uuid,
  p_batch_id uuid,
  p_item_id uuid,
  p_illustration_id uuid default null
) returns jsonb
```

service role専用wrapper。provider出力でfront/back/keyを書き換えず、commit済みitemを正本とする。処理:

1. batch/itemを非lock読取してcard key、illustration、deck/upload IDを収集する。
2. owner/card-key advisory lock、illustration row、batch→item、deck→uploadをmatrix順にlockし、全owner/関係/stateを再照合。非一致はnot-found。
3. finalizedなら記録済みcard IDを返す。failed/deleted/undoneは`CONFLICT`。target deckがNULLなら`DECK_NOT_FOUND`。
4. image modeに応じ、illustrationが同ownerのready rowでstorage pathを持つことを検証し、その`illustration_key`だけをcardへ採用する。`none`ではID指定を拒否する。
5. 同owner private cardを再確認し、同keyが既にあればitemだけを`failed/DUPLICATE_EXISTING`へ確定してcard関連を0件にする。
6. internal flagをtransaction-local設定し、private cardをinsert。
7. `deck_cards`、item_tags由来`card_tags`をinsert。upload使用時はuploadをconsumedへ更新。
8. itemをfinalized、result card、時刻へ更新し、batch counts/statusを再計算。
9. すべて成功時だけ返す。予期しない例外は全変更rollback。

同時finalizeはitem row lockとprivate部分unique indexの双方で直列化する。unique conflictはconstraint名を確認して手順5と同じitem failedへ変換するため、cardだけ残らない。

### `mark_import_item_failed`

```sql
mark_import_item_failed(
  p_owner_user_id uuid,
  p_batch_id uuid,
  p_item_id uuid,
  p_attempt_key text,
  p_error_code text,
  p_safe_detail jsonb default '{}'::jsonb
) returns jsonb
```

Issue #12 worker向けservice-role wrapper。許可error code allow listとdetail key/sizeを検証し、provider本文・stackを拒否する。lock matrixに従ってbatch/itemをlockし、`committed|processing`だけを`failed`へ遷移、attempt key/errorが同じ再送は同じ結果を返す。別attemptで既にfailed、またはfinalized/deleted/undoneは`CONFLICT`。result/deleted列はNULLのまま、errorと`failed_at`を設定し、batchのfinalized/failed/terminal countsと`completed_at`を同transactionで再集計する。Queue ack/retry判断は#12に残す。

### `undo_import`

```sql
undo_import(p_batch_id uuid) returns jsonb
```

1. `auth.uid()`でbatch候補と対象IDを非lock読取し、relation/cardをUUID昇順lockした後、batch/itemsをlockしてowner/stateを再検証。非ownerはnot-found。
2. undoneなら保存済み`undo_result`を返す。
3. finalized itemに`user_edited_at IS NOT NULL`があれば`CARD_MODIFIED`。`status='deleted'` tombstoneはskip対象として数える。
4. 現存cardのadvisory lock後、active session検査。1件でもあれば`ACTIVE_SESSION`。
5. internal flagを立て、このbatch由来`card_tags`/`deck_cards`を削除後、現存private cardを削除してitemを`undone`、`result_card_id=NULL`、`undone_at`へ更新。deleted itemは変更しない。
6. batch由来で参照されなくなったitem-tag関連を削除。共有tagは残し、owner内で未参照のtagだけ削除可能。
7. auto-created deckをlockし、空なら削除する。FKの`ON DELETE SET NULL`でtarget/auto IDはNULLになり、削除有無は`undo_result`へ保存する。非空なら維持。
8. batchをundoneにし、deleted skip数、削除card数、auto deck結果を`undo_result`と時刻へ保存。quota reservationは返却しない。

### 管理更新/削除

`update_imported_card(p_card_id,p_patch,p_expected_updated_at)`はowner、optimistic timestamp、active guardを検証し、key対象列変更時に新card keyを再計算する。成功後、関連itemの`user_edited_at`を設定する。

`delete_private_card(p_card_id,p_expected_updated_at)`と直接DELETEは、active guard後、BEFORE DELETE tombstone triggerがfinalized itemを`status='deleted'`,`deleted_card_id=OLD.id`,`deleted_at=now()`,`result_card_id=NULL`へ更新する。DELETEは`user_edited_at`を立てない明示例外である。FK `ON DELETE SET NULL`後もCHECKが成立し、undoはdeleted itemを無視する。内部finalize rollback/undoではtransaction-local flagによりtombstoneを抑制する。

`deck_cards`、`card_tags`、cardのillustration relationはそれぞれ`set_card_decks(p_card_id,p_deck_ids)`,`set_card_tags(p_card_id,p_tag_ids)`,`set_card_illustration(p_card_id,p_illustration_id)`管理RPCだけで変更する。owner `authenticated`へのrelation INSERT/UPDATE/DELETE grant/policyは撤回し、既存SELECT policyは維持する。各RPCは`auth.uid()`、card rowを最初にlockし、card advisory後にillustration/deck/tagをUUID昇順lockしてowner invariantを再検証する。直接`cards.illustration_key`変更はtriggerがinternal flagなしでは拒否する。

## 8. transaction・lock順序

直接DMLではPostgreSQLが対象rowをtriggerより先にlockするため、それを起点に含めた次の単一matrixを使う。対象IDは最初にnon-locking readで収集し、各段階内はUUID/canonical key昇順、lock後にowner/stateを再検証する。`—`はそのclassを取得しないことを示す。

| 経路 | 0 直接対象/relation row | 1 card row | 2 card/key advisory | 3 illustration | 4 batch/item | 5 deck/upload | 6 usage/reservation | 7 tags/relations |
|---|---|---|---|---|---|---|---|---|
| commit | — | duplicate候補 | owner+card-key、idempotency | — | existing batch/reservation link | deck、uploads | reservation照合のみ | tags/items |
| reserve usage | — | — | owner+reservation-key | — | non-lock既存確認後batch→item | — | usage row→reservation row | — |
| finalize | — | 既存resultのみ | owner+card-key | UUID昇順 | batch→item | deck→upload | reservation参照 | insert relations |
| mark failed | — | — | attempt-key | — | batch→item | — | reservation参照 | — |
| undo | — | UUID昇順 | card UUID昇順 | batch由来のみUUID昇順 | batch→items | auto deck | reservation参照のみ | internal flagでcascade/relations |
| card UPDATE/DELETE | card row（暗黙） | 同左 | card UUID | illustration変更時UUID | item marker/tombstone | — | — | — |
| relation管理RPC | — | card UUID | card UUID | 指定時UUID昇順 | item marker | deck/tag UUID昇順 | — | relation rows |
| session DML | session row（暗黙） | queue/current card UUID昇順 | card UUID昇順 | — | — | — | — | — |
| upload登録 | — | — | owner+upload-key | — | — | upload/path | — | — |

internal flag経路ではedit/tombstone relation triggerをskipし、cascade deleteを含むundo/finalizeが逆順lockを追加しない。card guardはsession rowをlockせずadvisory protocolで判定し、session側はcard rowの存在・ownerをlock後に再検証する。`deadlock_timeout`を短くしたcommit/finalize/undo/session/direct card/relation管理RPC/illustration/cascade交差試験を反復し、deadlock 0と不変条件を確認する。

## 9. active-session、review reset、編集印

### queue UUID抽出

`jsonb_array_elements`の各要素について`jsonb_typeof='string'`かつcanonical UUID regexp一致時だけUUID castする。object、number、null、不正文字列は無視する。currentと4 queueをUNIONしdistinct/sortする。

### trigger分担

| trigger | timing | 契約 |
|---|---|---|
| `normalize_card_key` | cards BEFORE INSERT/UPDATE | INVOKER。本文からkey強制導出 |
| `normalize_tag_names` | tags BEFORE INSERT/UPDATE | INVOKER。display/normalized name強制導出 |
| `lock_study_session_cards` | study_sessions BEFORE INSERT/UPDATE | DEFINER。OLD/NEW和集合のcard row→advisory lock |
| `guard_card_active_session` | cards BEFORE UPDATE/DELETE | DEFINER。activeなら`ACTIVE_SESSION` |
| `reset_review_state_on_content_change` | cards AFTER UPDATE | DEFINER。本文4列実変更時だけ全review state DELETE |
| `mark_import_item_user_edited` | cards BEFORE UPDATE | DEFINER。finalized itemに編集時刻。内部flag時skip |
| `tombstone_import_item_on_delete` | cards BEFORE DELETE | DEFINER。個別削除をdeletedへ。編集印は付けない |
| `enforce_deck_card_owner`,`enforce_card_tag_owner` | relation BEFORE DML | DEFINER。不可視rowを含めowner invariant強制 |
| `mark_import_item_relation_edited` | deck_cards/card_tags AFTER DML | DEFINER。import cardの関連変更を編集扱い。内部flag時skip |

DEFINERはmigration owner、`SET search_path = pg_catalog, pg_temp`、`public` object参照は完全修飾とし、全trigger functionのPUBLIC/role EXECUTEをrevokeする。trigger経由実行だけを許す。`public` schema CREATEもmigration ownerだけに限定する。triggerでエラーになればstatement/transaction全体がrollbackし、review state、tombstone、編集印だけが残らない。

## 10. error契約

| code | DB識別 | HTTP目安 | safe detail |
|---|---|---:|---|
| `VALIDATION_ERROR` | `P1000` | 400 | field path / rule |
| `DUPLICATE_IN_REQUEST` | `P1001` | 409 | clientItemId |
| `DUPLICATE_EXISTING` | `P1002`/named 23505 | 409 | item IDのみ |
| `DECK_NOT_FOUND` | `P1003` | 404 | なし |
| `DECK_AMBIGUOUS` | `P1004` | 409 | normalized nameのみ |
| `QUOTA_EXCEEDED` | `P1005` | 429 | limit/current/requested/date |
| `ACTIVE_SESSION` | `P1006` | 409 | owner session ID/deck ID |
| `CARD_MODIFIED` | `P1007` | 409 | card ID |
| `CONFLICT` | `P1008` | 409 | idempotency keyは返さない |
| `UNAUTHORIZED` | `42501` | 401/403 | なし |
| `INTERNAL_ERROR` | adapter fallback | 500 | correlation ID |

owner不一致はresource存在を示さない404相当へ変換する。DB message/detailをそのままclientへ返さない。log allow listはcode、correlation ID、ownerの不可逆hash、batch/item ID、durationだけで、token/request/card本文/SQL stackは除外する。

## 11. migration計画

forward migration SQLは既存migrationを編集せず、単独のDB transactionで次順に適用する。repository file更新やseed実行をこのtransactionへ混在させない。

1. ICU collation、normalization/key関数を作成し、共通fixture self-check。
2. 既存cardsの新keyをtemporary tableへ計算し、public/private衝突時は全rollback。
3. cards列/checkを準備し、旧global unique drop、key backfill、部分unique indexes作成。
4. 新tables、constraints、indexes、triggerを依存順に作成。
5. RLS/policies、wrapper/internal RPC、function owner、`search_path=pg_catalog,pg_temp`、function EXECUTE revoke/grantを作成。`public` schema CREATEをPUBLIC/anon/authenticatedからrevokeしmigration ownerだけへgrant。
6. `NOT VALID`既存行constraintをVALIDATEしmigration transactionをcommit。

repository変更として`supabase/seed.sql`を別途更新し、public upsertは`ON CONFLICT (card_key) WHERE visibility = 'public' DO NOTHING`に確定する。predicateなしの旧構文や曖昧な`ON CONFLICT DO NOTHING`は使わない。

### rollback

- migration途中の任意failpointではtransaction rollbackし、schema、constraints、key値が適用前と一致することをtestする。
- deploy後に問題が出た場合、appを旧互換read経路へ戻し、修正forward migrationを適用する。
- private card作成後のglobal unique復元は異なるownerの正当な重複を破壊するため禁止する。

### 検証経路

- baseline: `tests/fixtures/pre-s10-seed.sql`をpre-S10時点のseedとして凍結し、旧migrationへ適用してID/本文/skill/pattern/deck関連/件数/旧key snapshotを取得
- fresh: 空DB -> 全migration -> 更新済みrepo `seed.sql` -> 全DB契約test
- upgrade: 旧migration -> frozen pre-S10 seed -> baseline snapshot -> S-10 migration -> 更新済みrepo seedを別transactionで再実行 -> 一般snapshot/新key比較 -> 全DB契約test

## 12. failure modeと回復

| failure | DB結果 | caller/worker action |
|---|---|---|
| Stage 1不正/token不正 | 変更0 | 入力修正、token再発行 |
| commit同key同hash競合 | batch 1件、同じ応答 | そのbatchを使用 |
| commit同key別hash | 既存batch不変 | 新keyで明示再試行 |
| provider直前quota競合 | 上限内reservationだけcommit、provider未開始 | JST翌日または入力減 |
| commit後owner重複発生 | finalize item failed、card関連0 | UI/MCPへduplicate通知 |
| worker timeout | item committed/processingのまま | #12が同itemをretry |
| finalize応答消失 | finalized結果は1回分 | 同item再呼出で結果取得 |
| active session競合 | 更新/削除/undo 0件 | session終了後再試行 |
| migration key衝突 | migration全rollback | 衝突reportを調査、勝手に統合しない |

## 13. テスト戦略

### pure unit

- schema field matrix、R1/W1 pair、1/50/51、client ID、tag 0/10/11
- Unicode全White_Space、FEFF非空白、NFKC、case、astral文字、UTF-8 SHA-256 fixture
- canonical JSON/hashのkey順・tag順・同値入力
- HMAC正常、改ざん、owner違い、期限境界、hash違い、constant-time compare wrapper

### DB integration

- actor（owner A/B/anon/service）×table×SELECT/INSERT/UPDATE/DELETE RLS matrix
- authenticatedからcommit/reserve/upload/worker wrapper直呼出拒否、service wrapperからinternal直呼出不可、owner/source偽装拒否
- public/private部分unique、owner間同値、公開Seed同値private
- composite FKとdeck_cards triggerのINSERT/UPDATE cross-owner
- generation/import hash相違、preview reservation key改ざん、commit初回hash関連付け、同key再送/別key分離
- commit同時実行、別import hash/source/reservation、Stage 1各失敗の全table差分0・usage差分0
- reserve直前JST 23:59:59/00:00:00、199+1、199+2、49+1、49+2、並行、同key再送、MCP/upload trusted免除
- upload登録の同key同metadata/別metadata、owner/path/MIME/size/state、mark failedの同attempt/別attempt/terminal state/batch再集計
- finalize再実行/並行、commit-finalize間duplicate、illustration owner/state、途中failpoint rollback
- reserveのadvisory→non-lock read→batch/item→usage→reservation順と同key並行
- commit/finalize/undo/session/direct card/relation管理RPC/illustration/cascadeのlock交差とdeadlock 0
- authenticated relation直接write拒否、SELECT互換、管理RPC owner/cross-owner検証
- current + 4 queues、無効JSON、RPC + direct DML、session追加との競合
- content 4列reset、illustration/tag/deck keep、UPDATE失敗rollback
- tag displayからDB強制正規化、normalized_name偽装不可、owner内unique
- undo edited/active/deleted tombstone/result FK SET NULL/再undo/auto deck空・非空/target deck NULL

### migration

- frozen pre-S10 seed baseline、fresh、upgradeを別jobで実行
- Seed一般snapshot差分0、旧key記録、新key個別期待値、seed再実行後key差分0
- 各DDL/backfill区間failpointでtransaction rollback snapshot一致

## 14. ACトレーサビリティ

| AC | 設計要素 | 主テスト |
|---|---|---|
| AC-01 | private owner部分unique、複合FK、deck trigger | owner A/B・Seed同値finalize |
| AC-02 | Stage 1 set validation、card-key lock、named unique mapping | request/既存/finalize競合 |
| AC-03 | temp backfill、部分index、public immutable | Seed snapshot/key再計算 |
| AC-04 | canonical hash、HMAC、idempotency lock | 改ざん・並行同hash・別hash |
| AC-05 | provider直前reserve、usage row lock、JST DB clock | 境界・並行・trusted免除・再送 |
| AC-06 | pure Stage 1、commit/finalize tx分離 | 全table差分、failpoint、再実行 |
| AC-07 | symmetric advisory lock、undo batch lock | 5参照位置、直接DML、undo分岐 |
| AC-08 | content-change AFTER trigger | 列別reset/keep、失敗rollback |
| AC-09 | RLS matrix、複合FK、owner triggers、EXECUTE grant | actor×operation、owner偽装 |
| AC-10 | transactional forward migration | fresh/upgrade/failure injection |

## 15. 実装順序と完了条件

1. 共通fixture、schema/normalization/hash/HMACとunit tests。
2. forward migrationのfunctions/backfill/部分unique。
3. import tables、constraints/indexes、RLS/grants。
4. owner/session/review triggersとdirect DML tests。
5. trusted commit wrapper/internal、provider直前reserve、upload登録とparallel tests。
6. finalize/mark-failed/delete tombstone/undo RPCとidempotency tests。
7. generated `frontend/src/types/database.ts`更新、error mapper。
8. fresh/upgrade/failure-injection suites、AC trace report。

完了条件はAC-01〜10の自動testが両migration経路で成功し、Queue/provider/Storage実行を一切必要とせず`commit_import`、`reserve_provider_usage`、upload登録、failure/finalize/undoのDB契約を検証できることである。

## 16. Open questions

実装を止めるopen questionはない。次の値は本設計で固定したが、後続storyが変更する場合は契約versionとforward migrationを必要とする。

- `idempotency_key`最大128文字
- upload上限10 MiBとMIME allow list
- batch/itemの中間`processing`状態
- fixed ICU `und` collationをSQL lowercase基準とすること

## 17. 変更履歴

| 日付 | 版 | 変更内容 | 作成者 |
|---|---|---|---|
| 2026-07-14 | 1.1.1 | TDR-R01〜R04反映。generation/import hash分離、reservation lock順、relation管理RPC限定、DEFINER search_path/schema CREATE権限を確定 | Codex |
| 2026-07-14 | 1.1.0 | TDR-001〜008反映。trusted commit境界、provider直前reservation、削除tombstone、単一lock matrix、trigger security、補助RPC、DB tag正規化、migration/seed検証分離を追加 | Codex |
| 2026-07-14 | 1.0.0 | 初版。schema、RLS、commit/finalize、Unicode/HMAC、migration、AC traceabilityを定義 | Codex |
