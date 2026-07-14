---
id: ADR-007
feature: ai-card-import-foundation
type: adr
version: 1.1.1
created: 2026-07-14
updated: 2026-07-14
status: Accepted
based_on: specs/stories/S-10-ai-card-import-foundation/requirements.md
related_epic: GH-9
---

# ADR-007: AIカード登録をowner境界・二段階確定・DB不変条件で構成する

## ステータス

Accepted

## コンテキスト

S-10は、アプリ内AIと外部AIから同じ契約でprivate cardを登録するための基盤である。既存Auth、`cards`、`decks`、`deck_cards`、`review_states`、`study_sessions`、`illustrations` は互換接続先として維持する。一方、AI import tables、RLS、RPC、card-key、TypeScript schema、preview HMAC、テストはclean-slateで設計し、旧`card_key`生成処理や既存直接CRUDをimport経路へ流用しない。

Queue、provider呼び出し、Storage処理、workerはIssue #12の責務である。ただしQueue実装に依存しない確定primitiveがなければworkerとDBの責務が逆転するため、S-10は`finalize_import_item`までを提供する。

主な判断点は次のとおりである。

1. owner、公開Seed、deck/card/tag関連の整合をどのDB層で保証するか
2. preview、commit、provider処理後finalizeの責務をどこで分けるか
3. 冪等commit、日次quota、同時finalizeをどのlock規約で直列化するか
4. 直接DMLを含む編集・削除・undoと未完了学習sessionの競合をどう防ぐか
5. Unicode正規化と`card_key`をruntime間で一致させるか
6. Seed済みDBを停止・破壊せずforward migrationするか

## 決定事項

### 1. 責務境界

- Stage 1は共有TypeScript schemaで全件を純粋検証・正規化し、DB書き込みを行わない。preview tokenもTypeScriptの純粋HMAC関数で発行・検証する。
- client requestに`source`を含めない。信頼済みserver adapterが認証、HMAC、owner、request hashを検証し、route/configから`source`とquota免除可否を導出した後だけ、service-role専用`commit_import` wrapperを呼ぶ。一般`authenticated`にはcommitのDB EXECUTEをgrantしない。
- `commit_import` wrapperと外部grantを持たない`commit_import_internal`を分離する。internal primitiveはDB transaction内でowner、source、request hash、重複、deck/upload、reservation keyを再検証し、batch、items、tagsを原子的に確定する。card、`deck_cards`、`card_tags`、usage加算は行わない。
- `finalize_import_item`はIssue #12 workerが呼ぶQueue非依存DB primitiveとし、card、deck関連、tag関連、item結果を1 transactionで確定する。Queue作成、enqueue、retry、provider/Storage処理は含めない。
- 管理更新とundoはRPCを正規経路とする。ただし既存RLSが許す`cards`直接UPDATE/DELETEでも不変条件を迂回できないようtriggerを併用する。

### 2. DB保証の配置

- 単一行の形式は`CHECK`、ownerをまたぐ参照は複合FKまたはconstraint trigger、公開/private重複は部分unique index、認証主体ごとの可視性はRLS、複数行の業務操作はRPCで保証する。
- `cards`の旧全体`UNIQUE(card_key)`を削除し、publicは`card_key`、privateは`(owner_user_id, card_key)`の部分unique indexへ置換する。publicは`owner_user_id IS NULL`、privateは非NULLを必須とする。
- `deck_cards`はINSERT/UPDATEのたびに「cardがpublic、またはprivate card ownerとdeck ownerが一致」をDB triggerで検証する。RLSを迂回するservice roleにも適用する。
- `card_tags`はownerを明示保持し、`(card_id, owner_user_id)`と`(tag_id, owner_user_id)`への複合FKで三者のowner一致を保証する。

### 3. RPC・trigger・権限

- user-facing管理RPCと`undo_import`は`authenticated`へgrantし、`auth.uid()`を唯一のcaller ownerとする。`commit_import`、`reserve_provider_usage`、upload登録、worker結果RPCは信頼済みserver adapter/workerが使う`service_role`だけへgrantし、明示ownerを保存済みbatch/item/requestと照合する。
- 外部wrapperと内部primitiveを分け、internal関数と全trigger関数は`PUBLIC`、`anon`、`authenticated`、`service_role`からの直接EXECUTEをrevokeする。wrapperだけを用途別roleへgrantする。
- import tablesのbatch/item変更とusage加算はRPCだけに限定する。RLSではowner SELECTのみを許可し、直接INSERT/UPDATE/DELETE policyを作らない。
- cross-table write/readが必要なactive guard、review reset、編集/tombstone、owner invariant triggerはmigration ownerの`SECURITY DEFINER`とする。純粋なcard-key/tag正規化triggerはinvokerでよい。全DEFINER関数は`SET search_path = pg_catalog, pg_temp`とし、`public` objectを完全修飾し、固定owner、PUBLIC EXECUTE revokeを必須とする。`public` schemaのCREATEはmigration ownerだけに許可し、`PUBLIC`、`anon`、`authenticated`からrevokeする。
- triggerは新規則による`card_key`再計算、tag表示名/正規化名の強制導出、公開card不変、deck/card owner整合、card/tag owner整合、active-session guard、本文変更時review reset、import済みcardの編集または削除tombstoneを担う。RPC内部処理だけはtransaction-local flagで編集印付けを抑制し、flagを設定できる関数は外部公開しない。

### 4. 冪等性・request hash

- `(owner_user_id, idempotency_key)`をuniqueとし、commit冒頭でowner/key由来のtransaction advisory lockを取得する。
- 既存batchのrequest hashが一致すれば、そのbatchを返して一切加算しない。不一致なら`CONFLICT`とする。
- provider前の`generation_request_hash`とprovider結果を含む最終canonical importの`import_request_hash`を分離する。reservationは生成入力+requested unitsのgeneration hashを保持し、preview tokenはowner、reservation key、import hash、期限を束縛する。
- commit初回はreservationのowner/source/key/unitsとgeneration hashが確定済みであることを検証後、最終`import_request_hash`をreservation/batchへ一度だけ関連付ける。再送は同じimport hashだけを許可する。provider前後のworkflow同一性はhash一致そのものではなくreservation keyで追跡する。
- DB unique violationはconstraint名で分類する。同一owner card競合は`DUPLICATE_EXISTING`、冪等key別hashは`CONFLICT`とし、不明な`23505`を一律duplicate扱いしない。

### 5. JST quotaとprovider直前予約

- quota日付はcaller/client値ではなくDB clockを`Asia/Tokyo`へ変換して決める。テスト専用のclock注入は公開RPCと分離する。
- `reserve_provider_usage`をQueue非依存・冪等primitiveとする。app card generationはprovider呼出直前、AI illustrationはconcept処理開始直前に予約する。MCP生成cardとupload画像の免除はclient値ではなくtrusted contextから決定する。
- `ai_quota_reservations`を冪等reservation台帳、`ai_usage_daily`を日次集計とする。同一owner/reservation key/kindは1回だけ加算する。reservation key advisory取得後、既存reservationをnon-lock readし、必要時だけbatch/item、usage row、reservation rowの順でlockして再検証する。
- commitはusageを加算せず、検証済みreservation keyをbatch/item/conceptへ関連付けるだけとする。provider前reservationと後続commitは同じowner、request hash、source、reservation keyで照合する。
- `ai_usage_daily`を`INSERT ... ON CONFLICT DO NOTHING`後に`SELECT ... FOR UPDATE`し、上限判定と加算を同じtransactionで行う。provider開始済みreservationは結果にかかわらず返却しない。

### 6. active guard・review reset・undo

- card変更の直接DMLとsession DMLは対象row lockを起点にする。`deck_cards`、`card_tags`、card↔illustration relationのwriteはowner authenticatedの直接grantを撤回し、card rowを最初にlockする管理RPCだけへ限定する。SELECT互換は維持する。
- 管理RPC/triggerはcard row、card advisory、illustration、batch/item、deck/upload、usage/reservation、tag/relationの単一matrixを守り、同種複数rowはUUID昇順とする。cascade deleteもinternal flag付き管理経路で同じprotocolを使う。
- guardは`finished_at IS NULL`かつ`current_card_id`または4 queue内のUUID文字列に対象cardがあるsessionを検出する。UUID文字列でないJSON値は無視する。該当時はsession IDとdeck IDだけを安全なdetailとして`ACTIVE_SESSION`を返す。
- `cards`のfront/back/skill/patternの実値が変わるUPDATEでは、AFTER triggerが全`review_states`を削除する。同一transactionなのでUPDATE失敗時はresetもrollbackする。illustration、tag、deckだけの変更では削除しない。
- 個別削除はitemへ`deleted_at`、`deleted_card_id`、`status='deleted'`を先に記録する。DELETEは`user_edited_at`を立てない例外とし、`result_card_id ON DELETE SET NULL`後もtombstoneで由来を保持する。
- undoはlock matrixに従い、既にundoneなら保存済み`undo_result`を返す。編集済みitemまたはactive cardが1件でもあれば全体を拒否し、deleted tombstoneは無視する。batch由来関連だけを削除し、自動作成deckは空の場合だけ削除する。target/auto deck FKは`ON DELETE SET NULL`で履歴rowを壊さない。

### 7. Unicode `card_key`

- NFKC、固定Unicode White_SpaceのASCII SPACE化、trim、連続SPACE圧縮、Unicode lowercaseを共通fixtureで固定する。`U+FEFF`は空白として扱わない。
- key materialは`pattern + U+001F + normalizedFront + U+001F + normalizedBack`、digestはUTF-8 SHA-256 lowercase hexとする。
- TypeScript実装をAPI入力の正本とし、SQLにも同値の検証関数を置く。SQL lowercaseはmigrationで作成する固定ICU `und` collationを使用し、collationを作成できない環境ではmigrationをfail-fastする。
- runtime/library更新時は共通fixtureを先に通し、差分があればsilent変更せず新ADRとmigrationで扱う。

### 8. migration・rollback

- 既存migrationは編集せず、単一のforward migrationをtransactional DDLとして追加する。
- 旧unique制約を外す前に全cardの新keyを一時領域で計算し、public/private各契約の衝突を検査する。衝突時は削除・統合せずmigration全体を失敗させる。
- SeedのID、本文、skill、pattern、deck関連、件数を変更しない。`card_key`だけを期待変更としてbackfillし、部分unique indexを作成する。
- migration SQLのtransactionとrepositoryの`seed.sql`更新を分離する。upgrade基準は凍結したpre-S10 seed fixtureで作り、適用前baseline snapshotを採取する。migration完了後に更新済みrepo seedを別transactionで再実行して検証する。
- `seed.sql`は新key関数と`ON CONFLICT (card_key) WHERE visibility='public' DO NOTHING`へ確定更新する。旧`ON CONFLICT (card_key)`は残さない。seed再実行は既存public cardを新keyで解決し、ID・関連を維持する。
- 適用前失敗はtransaction rollbackを正式なrollbackとする。適用後はデータを保持したままapp互換を戻し、修正forward migrationを出す。private import data作成後に旧global uniqueへ戻すdown migrationは行わない。
- fresh resetとSeed済みupgradeを別fixtureで検証し、upgrade失敗注入ではschema・constraint・backfill値が適用前snapshotへ戻ることを確認する。

### 9. エラー写像

- DB関数は専用SQLSTATEと安定codeを対応させる。adapterは`VALIDATION_ERROR`、`DUPLICATE_IN_REQUEST`、`DUPLICATE_EXISTING`、`DECK_NOT_FOUND`、`DECK_AMBIGUOUS`、`QUOTA_EXCEEDED`、`ACTIVE_SESSION`、`CARD_MODIFIED`、`CONFLICT`、`UNAUTHORIZED`へ写像する。
- 予期しない例外だけを`INTERNAL_ERROR`へ正規化する。SQL本文、stack、token、request本文、card本文をclient error/logへ出さない。
- owner不一致の行識別子は存在秘匿のためnot-found相当に正規化する。`ACTIVE_SESSION` detailは認証済みowner自身のsession ID/deck IDだけを返す。

## 検討した選択肢

### 選択肢1: TypeScript serviceだけで整合を保証

- 利点: SQLが小さく、単体テストしやすい。
- 欠点: service role、既存直接DML、同時実行から不変条件を迂回でき、AC-04/05/07/08/09を満たさない。

### 選択肢2: commit時にcardまで同期作成

- 利点: batch確定後すぐcardが利用可能になる。
- 欠点: provider/Storage処理とtransaction境界が結合し、Queue責務がS-10へ流入する。失敗再試行の冪等境界も曖昧になる。

### 選択肢3（採用）: preview / commit / finalizeの二段階永続化 + DB不変条件

- 利点: Queue非依存で、commitとworker結果確定を個別に原子化できる。直接DMLを含むowner・session・review不変条件をDBで保証できる。
- 欠点: table、trigger、lock規約、統合テストが増える。commit成功後にitem単位finalize失敗という中間状態を運用上扱う必要がある。

## 影響

### ポジティブ

- UI、MCP、将来workerが同じschema・key・error契約を利用できる。
- 同時commit/finalizeでも二重batch、quota超過、owner内重複が発生しない。
- 公開Seedと異なるownerのprivate cardを共存させられる。

### ネガティブ

- advisory lockとtriggerを含むDB統合テストが必須になる。
- ICU/Unicode versionはmigration互換性要件となり、更新時にfixture確認が必要になる。
- `SECURITY DEFINER`関数の監査対象が増える。

### 中立

- Queue/worker/provider/Storage配線はIssue #12に残る。
- UI、Route Handler、Remote MCP transportは後続storyに残る。

## 実装への指針

- 先に共通Unicode fixtureとcanonical request fixtureを作成し、TypeScript/SQL両方から参照する。
- constraint、index、trigger、RPCには安定名を付け、error mappingはその名前を列挙する。
- lock取得はhelperへ集約し、全RPC/triggerで同じ順序を使う。
- `mark_import_item_failed`とowner upload登録wrapperについて、署名、grant、state遷移、lock、冪等key、safe error、batch再集計をDesign Docどおり固定する。Queue処理は#12へ残す。
- `SECURITY DEFINER`関数内でcaller由来識別子を動的SQLへ連結しない。
- migration、RLS matrix、parallel commit/quota/finalize、直接DML guardをDB統合試験で検証する。

## 関連情報

- `specs/stories/S-10-ai-card-import-foundation/requirements.md`
- `specs/stories/S-10-ai-card-import-foundation/design.md`
- `specs/adr/ADR-002-database-schema-rls-access-boundary.md`
- GitHub Issue #10 / Epic #9 / Queue follow-up #12

## 変更履歴

| 日付 | 版 | status | 変更内容 |
|---|---|---|---|
| 2026-07-14 | 1.1.1 | Accepted | TDR-R01〜R04反映。generation/import hash分離、reservation lock順、relation write管理RPC限定、DEFINER search_path/schema CREATE権限を確定。設計承認checkpointでAcceptedを再確認 |
| 2026-07-14 | 1.1.0 | Accepted | TDR-001〜008反映。trusted adapter境界、provider直前quota予約、削除tombstone、単一lock matrix、trigger権限、補助RPC、tag強制正規化、migration/seed検証分離を確定 |
| 2026-07-14 | 1.0.0 | Accepted | 初版。owner境界、commit/finalize分離、RLS、Unicode key、migration方針を確定 |
