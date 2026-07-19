---
id: S-13
feature: ai-card-management-undo
type: requirements
version: 1.0.0
created: 2026-07-19
updated: 2026-07-19
github_issue: 14
parent_epic: 9
parent_story: S-10
---

# 要件定義書: AIカード管理・取り消し

## 1. 概要

### 1.1 目的

AI importで確定した本人所有のprivate cardを、owner境界、学習session、review state、batch、共有イラストの不変条件を維持したまま検索・編集・削除・undoできる管理体験を提供する。

### 1.2 正本と前提

- Accepted ADR-007のowner scoped管理RPC、content-only review reset、active-session guard、undo契約を継承する。
- Accepted ADR-008のcards → illustrations → `ai_illustration_objects` lock順、atomic `reference_count`、`delete_pending` cleanup契約を変更しない。
- AIカードとは、本人所有の `ai_import_items` が確定して `result_card_id` で参照する `visibility='private'` の現存cardをいう。公開Seed、直接作成card、failed/deleted/undone itemは一覧対象外とする。
- `study_sessions` がactive sessionの正本であり、Issue #14の「学習中」はactive sessionを意味する。`review_states` は本文変更時のreset対象であり、その存在だけではundoを拒否しない。
- 既存migrationは編集せず、必要なDB変更はforward migrationで追加する。

## 2. スコープと優先順位

### Must

1. owner限定一覧、cursor pagination、deck/tag/source/登録日filterを提供する。
2. content、illustration、tag、所属deckを検証済み管理境界から編集する。
3. 個別・複数削除と、未編集でactive session対象でないbatchの冪等undoを提供する。
4. content実変更時だけreview stateをresetし、全管理変更をactive-session guardで保護する。
5. 公開Seedとcross-owner IDを404相当で存在秘匿し、Server境界とRLSを併用する。
6. 管理による実変更の `user_edited_at`、個別削除で編集印を付けないtombstone例外、S-11共有画像reference lifecycleを全管理経路で一貫させる。
7. feature flagで管理経路を停止しても既存データと作成・学習・status/cleanup経路を保持する。

### Should

- 競合更新を検知し、他の操作を上書きせず再読込を促す。
- 一覧・編集・削除・undoのempty、pending、validation、conflict、error状態を日本語で区別する。

### Won't

- 公開Seedの変更、AIカードの公開・共有、カード複製。
- 新しい本文・イラストのAI生成、Storage bytesの直接編集。
- Queue、worker、cleanup schedule、SRS間隔、session queue契約の変更。
- Playwrightや未導入package/scriptの追加。

## 3. 機能要件

### REQ-LIST-01 認証・対象範囲

- WHEN 未認証利用者が `/ai/cards` または管理Server境界へアクセスした場合、THE SYSTEM SHALL 既存認証契約に従ってloginへ遷移または未認証応答を返し、DB mutationを行わない。
- WHEN 認証済み利用者が一覧を取得した場合、THE SYSTEM SHALL 本人所有の確定済みAI private cardだけを返す。
- THE SYSTEM SHALL public card、別owner card、削除・undo済みitem、result cardのないitemを一覧へ含めない。
- 同一cardが複数deck/tagに属しても、THE SYSTEM SHALL 一覧でcardを1件だけ返す。

### REQ-LIST-02 cursor pagination

- THE SYSTEM SHALL cardの `created_at DESC, id DESC` を唯一の一覧順序とする。
- `limit` 未指定時、THE SYSTEM SHALL 20件を返す。指定値は整数1〜100だけを受理し、それ以外は副作用なしのvalidation errorとする。
- cursorは直前ページ末尾cardの `created_at` と `id` を表すopaque値とし、次ページは `(created_at, id)` がそのtupleより厳密に小さい行だけを返す。
- THE SYSTEM SHALL 同一 `created_at` のcardを `id` で安定整列し、静的な対象集合を全ページ走査した結果に重複と欠落を生じさせない。
- 次ページがある場合だけ `nextCursor` を返し、末尾では `nextCursor=null` とする。改ざん・形式不正cursorはvalidation errorとし、内部値をログへ出さない。

### REQ-LIST-03 filter

- THE SYSTEM SHALL optionalな `deckId`、`tagId`、`source`、`createdFrom`、`createdTo` を同時指定でき、指定条件をANDで適用する。
- `deckId`と`tagId`はowner scopedなUUID、`source`は既存値 `app_ai | remote_mcp` だけを受理する。
- `createdFrom`と`createdTo`は `YYYY-MM-DD` のJST暦日とし、fromは当日00:00:00以上、toは翌日00:00:00未満の包含範囲としてcardの `created_at` へ適用する。fromがtoより後ならvalidation errorとする。
- 他ownerまたは存在しないdeck/tag filter IDは同じ404相当とする。
- filter適用後もREQ-LIST-02のcursor順序・件数契約を維持する。

### REQ-LIST-04 一覧表示データ

- 各行はcard ID、front/back、skill、pattern、作成日時、更新日時、source、batch ID、本人所有deck/tag、illustrationの安全な表示状態を含む。
- Storage path、画像bytes、provider request/response、raw DB errorはclient DTOへ含めない。画像表示が必要な場合はowner検証後の短命signed URLだけを返す。
- UIはloading、empty、filter結果0件、取得失敗、次ページ読込中を区別する。

### REQ-EDIT-01 content編集

- WHEN ownerがfront/back/skill/patternを保存する場合、THE SYSTEM SHALL S-10の正規化・1〜200文字・漢字包含・R1=`reading`・W1=`writing`契約を全項目の最終値へ適用する。
- WHEN front/back/skill/patternの実値が1つ以上変化した場合、THE SYSTEM SHALL card更新、`card_key`再計算、対象cardの全 `review_states` 削除、関連 `ai_import_items.user_edited_at` の初回時刻設定を同一transactionで行う。
- WHEN 正規化後の実値が全て同一の場合、THE SYSTEM SHALL card、review state、`user_edited_at`を変更しない。
- 同一owner内のcontent重複または更新日時競合は409相当とし、既存cardを上書きしない。

### REQ-EDIT-02 illustration編集

- Ownerはcardのillustrationを解除するか、本人所有かつreadyでStorage参照可能な既存illustrationへ付け替えられる。
- THE SYSTEM SHALL illustration bytesを管理UIから直接更新せず、公開・別owner・非ready・cleanup中/削除済みillustration IDを404相当または安全なconflictとして拒否する。
- 実際の付け替え・解除では `review_states` を維持し、`user_edited_at`を設定する。
- R1/W1共有objectの参照変更はREQ-IMAGE-01を満たす。

### REQ-EDIT-03 tag編集

- Ownerはcardのtag集合を0〜10件へ置換できる。各tag表示名はS-10のNFKC/Unicode空白/小文字化契約に従い、正規化後1〜30文字、同一owner内で一意とする。
- 既存owner tagは再利用し、新しい表示名はowner tagとして作成できる。別owner tag IDと存在しないtag IDは404相当とする。
- tag集合の実変更はcard、tag、関連のowner一致を原子的に維持し、`review_states`を維持して `user_edited_at`を設定する。実変更がない場合は永続値を変更しない。

### REQ-EDIT-04 deck編集

- Ownerはcardの所属deck集合を0件以上の本人所有deckへ置換できる。public deckまたは別owner/存在しないdeck IDは404相当とする。
- deck集合の実変更はowner整合を原子的に維持し、`review_states`を維持して `user_edited_at`を設定する。通常のdeck付け替えでは空deckを自動削除しない。

### REQ-GUARD-01 active session

- content、illustration、tag、deck、個別削除、複数削除、batch undoの前に、THE SYSTEM SHALL `finished_at IS NULL` かつ対象cardが `current_card_id` または4 queueのUUID文字列に含まれるowner sessionを同一transactionで確認する。
- 対象が1枚でもactive sessionに含まれる場合、THE SYSTEM SHALL 操作全体を副作用なしで409 `ACTIVE_SESSION`として拒否し、safe detailとして該当session IDとdeck IDだけを返す。
- UUID文字列でないqueue値は既存契約どおり無視する。card本文、他owner情報、queue全体はerror/detailへ含めない。
- 存在・owner確認をactive判定より先に行い、別owner cardのsession情報を漏らさない。

### REQ-DELETE-01 個別削除

- Ownerは本人所有AI cardを、更新日時競合とREQ-GUARD-01を通過した場合だけ削除できる。
- 削除は関連AI itemをtombstone化し、DELETEを明示例外として `user_edited_at` を新規設定せず、cardとFK/cascade対象のdeck/tag/review関連を原子的に削除する。
- 個別削除は、そのcardが過去に学習済みでも明示操作として許可する。ただしactive session中は拒否する。
- 同じ削除を再送して対象が既にない場合は、他owner/公開/未知IDと同じ404相当とする。

### REQ-DELETE-02 複数削除

- Ownerは現在の一覧で選択可能な1〜100件の重複しないcard IDを一括削除できる。
- THE SYSTEM SHALL 全IDの存在、owner、AI import対象、更新日時、active sessionを全削除前に検証し、1件でも失敗すれば全体を副作用なしで拒否する。
- 成功時は全cardへREQ-DELETE-01とREQ-IMAGE-01を1transactionで適用し、削除件数を返す。

### REQ-UNDO-01 実行条件

- Ownerだけが本人所有batchをundoできる。別ownerまたは存在しないbatchは同じ404相当とする。
- deleted tombstoneを除くbatch itemに `user_edited_at` が1件でも設定済みなら、THE SYSTEM SHALL batch全体を `CARD_MODIFIED` で拒否する。
- batchの現存cardがactive session対象なら、THE SYSTEM SHALL REQ-GUARD-01でbatch全体を拒否する。
- 拒否時はcard、item、batch、relation、tag、deck、illustration trackingを一切変更しない。
- undo前に個別削除済みでtombstone化されたitemは、undo拒否判定と削除対象から除外してskip件数へ含める。

### REQ-UNDO-02 成功・冪等性

- 条件を満たすundoは、batch由来の現存card、deck/card/tag/review関連、不要になったowner tagを原子的に削除し、itemとbatchを `undone` として監査可能に保持する。
- `auto_created_deck_id` はundo後に空の場合だけ削除し、他cardが残る場合は保持する。手動選択deck、他batch、公開Seed、quota/reservationは変更しない。
- 既にundoneの同一owner batchへの再送は、保存済みの同じ成功結果を返し追加削除を行わない。
- 成功結果は少なくともbatch ID、status、削除card件数、個別削除skip件数、自動deckの結果を含む。

### REQ-IMAGE-01 R1/W1共有画像

- illustrationの付け替え、個別/複数削除、batch undoはADR-008のcanonical lock順とatomic `reference_count`を使用する。
- 共有objectの参照が2→1になった場合、THE SYSTEM SHALL objectをreadyのまま保持する。最後の参照が1→0になった場合だけ `delete_pending` とする。
- `delete_pending` objectはDB transaction内でStorageから直接削除せず、S-11 cleanupが削除直前にowner、path、lease、参照0を再確認する。削除失敗時は同じintentを保持して再試行する。
- cleanup前に同一owner cardから再参照された場合は既存S-11契約に従いreadyへ復帰でき、cleaning/deleted/orphan objectはattachできない。

### REQ-AUTH-01 存在秘匿・多層防御

- すべてのread/mutation Server境界は `auth.getUser()`、owner filter、入力validationを副作用前に実行し、RLSを最終防衛線として維持する。
- public card、別owner card/deck/tag/illustration/batch、存在しないIDへの直接アクセスは同じ404相当・同じ安全な応答形状とする。
- service roleを通常のowner CRUDに使用しない。DB不変条件に必要なSECURITY DEFINER RPCはJWT ownerを正本とし、固定 `search_path`、function owner、revoke/grantを既存規約どおり定義する。

### REQ-FLAG-01 rollback flag

- 管理専用feature flagはexact `true` の場合だけenableし、未設定・空・その他の値ではfail closedとする。
- disabled時は管理導線を非表示にし、`/ai/cards` と管理read/mutation境界を404相当にしてDB mutationを行わない。
- disabled時も既存card、batch、review state、AI新規作成の既存flag、status参照、worker/cleanup、deck/studyを削除・停止しない。

## 4. 非機能要件

### NFR-SEC-01 privacy/logging

- log、metric、errorへsecret、token、cookie、signed URL、card front/back、tag表示名、画像bytes、Storage path、provider body、raw SQL/stackを出さない。
- 記録が必要な場合はsafe code、operation、件数、duration、非機密IDだけをallowlistで出す。

### NFR-DATA-01 原子性・競合

- content reset、relation編集、複数削除、undoの各操作は成功時に全副作用が揃い、失敗時に増減0である。
- 同種複数rowはUUID順、共有画像を含む操作はADR-008のlock順に従い、並行操作でdeadlockまたはreference count負値を生じさせない。

### NFR-UI-01 accessibility

- 管理画面は320〜360px幅とdesktopで横scrollを生じさせず、主要操作は48px相当のtouch target、visible focus、semantic label、keyboard操作を提供する。
- 削除・undoは対象と影響を確認してから実行し、pending中は二重送信を防止する。色だけで状態や危険操作を表現しない。

### NFR-TEST-01 検証境界

- Unitはfilter/cursor/form validationとsafe error mappingをVitestで検証する。
- DB/Integrationはowner/RLS、content reset、active guard、atomic bulk delete、undo refusal/idempotence、shared image reference lifecycle、fresh/upgrade migrationを検証する。
- UI/user journeyはedit、bulk delete、undo、flag off、mobile/desktop、keyboard、empty/errorを実ブラウザで検証する。
- 現行repoにPlaywrightと `test:e2e` scriptはないため導入済みと仮定しない。Vitest contract testと手動または利用可能な外部browser runnerを区別し、URL、viewport、接続したDB/HTTP/Storage/cleanup境界を記録する。

## 5. AC-to-requirement/test対応

| Issue AC | 対応要件 | 必須検証 |
|---|---|---|
| AC-1 本人所有だけ | REQ-LIST-01, REQ-AUTH-01 | owner/other/anon/public actor matrix、route direct access |
| AC-2 cursor paging | REQ-LIST-02, REQ-LIST-03 | limit 20/1/100/invalid、同一timestamp、全page union、filter組合せ |
| AC-3 contentだけNew | REQ-EDIT-01〜04 | 4 content列それぞれreset、no-opとimage/tag/deckでkeep、transaction rollback |
| AC-4 active guard | REQ-GUARD-01 | current+4 queues、bulk/undo全体rollback、session/deck safe detail |
| AC-5 未編集undo | REQ-UNDO-01〜02, REQ-IMAGE-01 | card/relation/tag、last reference、auto deck empty/retained、cleanup handoff |
| AC-6 編集済み/学習中拒否 | REQ-UNDO-01 | `user_edited_at` 設定済みitem、active session対象cardの各1件で全snapshot不変 |
| AC-7 undo再送・削除skip | REQ-DELETE-01, REQ-UNDO-02 | tombstone skip、stored result同値、副作用増分0 |
| AC-8 public/cross-owner 404 | REQ-AUTH-01 | card/deck/tag/illustration/batchのunknown/other/public同形応答 |

## 6. 外部境界と未検証時の扱い

- Storage objectの物理削除はS-11 cleanup workerによるeventual処理であり、DB integration成功だけで物理削除済みと表現しない。
- local/Hosted Supabase、Storage、scheduler、worker、認証cookieが利用できない場合は、その境界を未検証として明記する。
- migrationは隔離DBでfresh chainと既存S-12 schemaからのupgradeを検証する。接続先不明のDBへreset/applyしない。

## 7. Open questions

実装を停止する要件上のopen questionはない。次を本要件の固定解釈とする。

- 「学習中」は `study_sessions` を正本とするactive sessionを意味し、`review_states` の存在だけではundoを拒否しない。
- `user_edited_at` はcontent/illustration/tag/deckの実変更で設定する。no-opと個別・複数DELETEでは設定せず、DELETEはtombstoneを残してundoでskipする明示例外とする。未編集を前提とするbatch undo自体でも設定しない。
- illustration編集は既存owner-ready illustrationの付け替え/解除であり、新規provider生成や画像bytes編集は含まない。
- date filterはJST暦日、cursor対象はcardの `created_at, id` とする。

## 8. 完了条件

- Issue #14の8 ACが上表の自動/手動検証へ追跡され、未検証の外部境界が明記される。
- DB/RLS/Auth/Storage契約はforward migration、Database型、Server境界、testで一体に更新される。
- `npm --prefix frontend run check` とroute変更を含むため `npm --prefix frontend run build` が成功する。
- 実ブラウザのowner journeyで一覧filter/page、全編集種別、bulk delete、undo、404、flag offを確認する。
