---
id: ADR-008
feature: ai-card-async-processing
type: adr
version: 2.0.5
created: 2026-07-15
updated: 2026-07-16
status: Accepted
based_on: specs/stories/S-11-ai-card-async-processing/requirements.md
related_epic: GH-9
supersedes_for_ai_import: specs/adr/ADR-004-illustration-generation-backend-mvp-decisions.md
---

# ADR-008: AIカード確定をPostgres原子enqueue・concept job・claim fencingで非同期化する

## ステータス

Accepted

## コンテキスト

S-10は`commit_import`、`reserve_provider_usage`、`finalize_import_item`、`mark_import_item_failed`をQueue非依存primitiveとして提供した。現行実装はNext.js 14、Supabase PostgreSQL/Storage、Vitestであり、専用backendやEdge Function、`pgmq`設定はまだない。S-08のNext.js fire-and-forget Gemini生成はプロセス停止時の永続再開、重複delivery、OpenAI選択、入力画像検証、参照安全な削除を保証しないため、AI import経路だけを新しい非同期基盤へ移す。

この決定では次を同時に固定する必要がある。

1. DB commitとQueue enqueueの間に欠落または二重enqueueを作らない方法
2. 5分visibility、`queued -> processing`、worker喪失後の再取得、旧workerの遅延書込み拒否
3. 一時障害だけを5秒、30秒、120秒で永続retryし、terminal重複をACKする方法
4. conceptのR1/W1を一体で成功/失敗させ、card/quota/illustration/objectを重複させない方法
5. OpenAI/Geminiの選択とEdge runtime内の画像検証・PNG正規化

Supabase QueuesはPostgres上の`pgmq`を利用し、messageは明示的にarchive/deleteされるまで保持される。`read`はvisibility timeoutを取り、`send`は秒単位delayを持つため、同じPostgres transaction内のenqueueと永続retryに利用できる。Edge FunctionsはDeno TypeScript/WASMをサポートし、Supabase公式の画像操作例はnative依存のSharpではなく`magick-wasm`を使用している。一方、Hosted Edge Functionsにはmemory/CPU/wall-clock上限があり、同じ公式例も大容量の複雑な画像処理はresource limitになり得ると警告している。したがって形式別に最大10MiBの入力を許容する本件は、WASMを採用しただけでは実現可能性が確定せず、最悪入力でのdeployment gateを必要とする。

## 決定事項

### 1. 同一Postgres transactionでcommitとconcept messageを確定する

- logged queue `ai_card_imports`を作成する。unlogged queueはdurability要件に反するため使用しない。
- service-role専用`commit_import_async` RPCは、S-10の`commit_import_internal`、`ai_import_concept_jobs`の作成、各distinct conceptの`pgmq.send`、返却用enqueue情報の保存を同一transactionで行う。
- message粒度はbatchでもitemでもなくconceptとする。payloadはversion、`jobId`、`batchId`だけとし、owner ID、card本文、prompt、画像を含めない。
- `(batch_id, concept_id)` uniqueと保存済み`queue_message_id`により、同一idempotency key/hashの再commitは同じbatch/job/messageを返し、新しいcard、quota、illustration、object、messageを作らない。
- Queue障害時はtransaction全体をrollbackし、APIは202を返さない。DBだけcommittedでmessageがない状態を許容しない。Queue転送用outbox dispatcherは設けない。terminal observabilityには別目的のsafe durable log outboxを用いる。
- Queue/RPC infrastructureまたはavailability failureはcommit adapterでHTTP 503 `SERVICE_UNAVAILABLE`へ写像する。既知のvalidation、authorization、conflict SQLSTATEは従来のsafe mappingを維持し、成功応答の不正payloadは内部contract failureとして500にする。

### 2. concept jobとclaim tokenを業務上のfenceにする

- `ai_import_concept_jobs`をQueueとは独立した永続正本とし、stateは`queued | processing | succeeded | failed | undone`とする。
- workerは`pgmq.read('ai_card_imports', 300, n)`で5分visibilityを取得後、`claim_ai_import_concept` RPCを呼ぶ。RPCが`queued -> processing`を条件付き更新できた場合、または5分を過ぎた旧claimをcompare-and-swapで置換できた場合だけ副作用を開始する。
- claimごとにランダムUUID `claim_token`と`claim_expires_at`を発行する。reserve、Storage前後確認、retry scheduling、pair finalize、pair failureはjob IDと現在のtokenを必須引数とする。失効tokenのDB書込みは`CLAIM_LOST`で拒否する。
- provider request timeoutとworker内処理budgetはvisibilityより短くする。処理中のvisibility延長は行わず、5分経過後は新claimだけを正とする。
- success時は`finalize_ai_import_concept`がR1/W1のcard確定、jobの`succeeded`化、当該messageの`pgmq.archive`を同一DB transactionで行う。permanent failure/retry枯渇時もpair failure、jobの`failed`化、archiveを同一DB transactionで行う。RPC応答喪失後の再配信はterminal判定だけでACKでき、新しい業務副作用を作らない。
- failure transactionは確定したmessage IDとclaim tokenのSHA-256をjobのterminal identityとして永続化する。raw tokenはowner-readable rowへ残さない。`get_ai_import_failure_state`はjobがfailedであるだけでは`terminal_failed`を返さず、両identityがcallerと一致する場合だけ返す。これにより期限切れclaim Aの遅延reconciliationがclaim Bのterminal failureを二重記録しない。
- ACK規則をmessage IDまで固定する。`succeeded | failed | undone`なら現在のdeliveryをarchiveする。delivery IDがjobの`queue_message_id`と異なるならreplacement済みのstale messageとしてarchiveする。現在IDかつ別claimが有効ならarchiveせず副作用なしで返し、visibility経過後の回復可能性を残す。ACK/archive自体が失敗した場合もmessageを失わせず、次回deliveryで同じ判定を繰り返す。

### 3. retryはdelayed replacement messageとして原子的に永続化する

- retry対象はfetch/network timeout・接続例外とprovider/Storage HTTP `408 | 429 | 5xx`だけとする。
- 初回後のdelayは固定配列`[5, 30, 120]`秒、retry最大3回、総試行最大4回とする。jitter、provider固有回数、自動model/provider切替は加えない。
- transient failure時、`schedule_ai_import_retry`はclaim tokenを検証し、jobを`queued`へ戻し、retry count/`next_attempt_at`を保存し、`pgmq.send(..., delay)`でreplacement messageを作り、旧messageをarchiveするまでを同一DB transactionで行う。process内sleepは使用しない。
- 3 retry消費後は`fail_ai_import_concept`がR1/W1を同一transactionでfailedにし、messageをarchiveする。
- validation/decode/MIME/size/dimension、safety/moderation、401/403/404等408/429以外の4xx、provider/key/config不正はretryせずpermanent failureとする。ただし冪等なStorage deleteの404は成功、決定済みpathへのupload競合は下記の既存object検証へ分類し、一般4xx failureとしてconceptを壊さない。
- DB呼出自体が完了しなかった場合はapplication retryとして数えず、未ACK messageが5分後に再配信される。繰返すDB障害はqueue age/claim-lost metricで運用検知する。

### 4. providerは明示的adapter選択、fallbackなしとする

- `ILLUSTRATION_PROVIDER`は`openai | gemini`だけを受理し、未設定時は`openai`とする。
- startup/claim前に選択providerのAPI keyとmodel設定を検証する。不正またはkey欠落はpermanent `PROVIDER_CONFIG_ERROR`とする。
- OpenAI/Geminiを同じ`IllustrationProvider` interfaceへadapter化し、返値を`success | transient | permanent`へ正規化する。HTTPはDeno標準`fetch`を用い、S-08とS-11は同じpure prompt-safety moduleを直接呼ぶ。Node `Buffer`依存とS-08の状態更新責務はworkerへ持ち込まない。
- 選択providerが失敗しても他provider adapterを呼ばない。modelの自動fallbackも行わない。
- provider request/response body、base64、prompt、API key、Authorization headerはlog/model_infoへ保存しない。
- adapterは成功HTTP bodyを`response.json()`で無制限にmaterializeしない。Content-Lengthとstream累計を固定response budgetで制限し、base64 decoded-sizeを`atob`前に算出して4MiB超を恒久`IMAGE_TOO_LARGE`にする。decoded文字列は固定長bufferへindex copyする。欠落・過少Content-Lengthもstream側でfail closedとする。宣言oversizeはbody read前にbest-effort cancelし、cancelの欠落・同期throw・非同期rejectは元のsize classificationを置換しない。OpenAI/Geminiは同じbounded reader/cancel helperを使用し、cancel error/raw bodyをlogしない。
- production defaultはadapter内の公式OpenAI/Gemini endpointとする。test/real E2E overrideはHTTPS endpointと非機密binding IDのpaired設定だけを許可し、partial/HTTP/userinfo URLをclaim前にfail closedで拒否する。override requestへbinding headerを付け、control/stats側のlast bindingとcall増分をgateで照合するため、fake-provider controlとserved workerの誤接続をpassにしない。

### 5. 画像はWASMで検証・正規化し、決定的objectと参照再確認で収束させる

- S-11新規sourceはprivate `ai-card-sources` bucketの`{ownerUserId}/{uploadId}/source`へ置き、upload rowにbucket/pathを永続化する。S-10のready/consumed sourceは既存`illustrations` bucketを記録してその場で利用し、upgradeでobjectを移動・複製しない。prepare時に1 request最大5件、各10MiB、合計50MiBを検査し、complete時に実bytesのPNG/JPEG/WebP magic、宣言MIME一致、decode、1,048,576 pixels以下、PNG 8-bit、PNG/WebP非透過を検証する。workerのStorage readerも宣言`Content-Length`とstream累計の両方を10MiBで打ち切り、欠落/過少申告で全bytesをmaterializeしない。providerへ渡す前にmetadataを除去したsanitized bytesへ再encodeし、元sourceのEXIF等を外部providerへ送らない。
- `ai_upload_consumers(upload_id,job_id)`をdurable associationとし、job stateをreference lifecycleの正本にする。同一uploadの全consumer jobがterminalになったtransactionだけがsourceをcleanup pendingへ遷移し、記録済みbucket/pathを一度だけ即時削除へ渡す。parallel/out-of-order terminal化でも非terminal/retry consumerが1件でもあれば保持する。
- illustration入力にも10MiB・1,048,576 pixels上限を適用し、PNGは8-bit、PNG/WebPは非透過、正規化前の幅・高さとも64px以上を要求する。provider出力はdecoded 4MiB・最大辺1024pxをWASM初期化前に要求する。保存前に最大辺1024pxへ縦横比維持でBox縮小し、1回のfull decodeで元寸法照合とPNG再encodeを行ってmetadataを除去する。小さい画像を拡大せず、入力条件を満たす極端な縦横比では正規化後の短辺が64px未満でも受理して各辺1..1024を永続化する。
- Edge runtime公式例に合わせ、version pinした`@imagemagick/magick-wasm`を用いる。native `sharp`は使わない。magic/dimension/PNG bit depth/color typeをfull decode前に検査し、1 invocation 1 concept、画像処理並列度1を基本とする。PNG/JPEG/WebP各10MiB・1,048,576 pixels（PNGは8-bit RGB）、provider 4MiB/1024px、dimension bomb、独立truncated decode failureをfresh Deno processで測り、memory/CPU/wall-clockの全上限内に収まることをdeployment hard gateにする。満たさない場合は本ADRをAccepted/本番deployせず、Edge worker要件を維持した処理分割または別codec案を再決定する。
- dimension bombはHTTP 422 `IMAGE_DIMENSIONS_INVALID`、独立truncated image decode failureはHTTP 422 `IMAGE_DECODE_FAILED`を必須とする。gate parentは失敗応答でもspawn PID CPU/RSSを継続sampleし、runtime baseline後のrequest増分RSSとcodec報告peak RSSを照合する。CPU 1.6秒、RSS 248MiB、wall 120秒の上限到達時はrequest abortとlocal Deno process killを行い、任意non-2xxを合格扱いしない。248MiBはHosted 256MiBに対して8MiBを残し、ImageMagick/WASMの実測固定メモリ床を反映する。
- `(owner,batch,concept)`でillustration rowを一意化し、R1/W1は同じillustration ID/keyを参照する。pair card確定は1 transactionで行い、片側だけを作らない。
- object pathは`{ownerUserId}/s11-managed/{illustrationId}.png`、uploadは`upsert:false`とする。pathをclaimごとに変えないため、旧worker/duplicate deliveryでも論理objectは最大1個である。uploadのAsset Already Existsはbounded readとtracking/digest一致時だけ冪等成功とする。DB finalizeが`DUPLICATE_EXISTING`を返すかclaim-bound reconciliationが`terminal_duplicate`を確認した場合、workerはbusiness duplicateとしてfailure logから分離し、DB transactionが作ったdurable orphanを確認した後だけ即時best-effort削除する。削除失敗は同じorphan cleanupへ残す。未確定・claim-lost時に先行削除しない。
- forward Storage policyはdurable `ai_illustration_objects` trackingに一致するobjectのauthenticated owner INSERT/UPDATE/DELETEを拒否する。path prefixだけで拒否しないため、pre-S-11のuntracked legacy owner objectは同じ第二segmentを含んでも従来操作でき、service roleはworker upload/cleanupを継続できる。SELECT/private owner境界とsource signed-upload flowは変更しない。
- cardのillustration参照変更/削除はDB triggerでdelete候補を記録するだけとし、Storage削除はcleanup workerが同一ownerのcard参照を再確認して0件の場合だけStorage APIで行う。`storage.objects`への直接DELETEは行わない。これによりR1/W1の片方削除ではobjectを保持し、最後の参照後だけ削除する。
- shared illustrationはtracking rowのatomic reference countを正本とする。全production pathのrow-lock classを既存cards（UUID順）→illustrations（UUID順）→tracking（UUID順）へ固定する。新規card INSERTはillustrationsから入り、tracking-only claim/recoveryは前段classを後取りしない。S-10 attach/create/update/delete/undo、S-11 finalize/fail/triggers、cleanup verify/complete、owner/service lifecycle updateは共通helperまたは同じprefix/suffixを使い、sibling cardをlockしない。S-10 different-key attachはOLD+NEW illustrationを同時に解決してhelperへ一括投入し、target-only先行lockを禁止する。2→1ではready、1→0だけをdelete_pendingにし、unclaimed pending再参照とcleanup claimは同じtracking lockで直列化する。これによりcompleteがtracking→illustration、attachがillustration→trackingとなるinversionに加え、A→B/B→A attachがNEWを逆順に先取りする`40P01` inversionを除去する。
- cleanup-deleted lifecycleの内部権限はSECURITY DEFINER実行者ではなくcaller JWTのservice-role contextで判定する。authenticated ownerの復活を拒否し、service cleanupとuntracked legacy owner updateを維持する。
- terminal/archive transaction後のfailure/duplicate outbox dispatchはbest-effort副作用であり、claim/complete failureはdurable terminal outcomeを変更しない。upload source releaseを即時継続し、未complete stable eventはDB-clock lease後に同じIDで再claimする。dispatch exceptionの生情報は記録しない。
- 全consumer terminal後のsourceと未参照orphanは通常経路で即時削除する。15分間隔のage cleanupは`created_at + 24 hours <= now`を満たすtracking rowだけをdue順に5分leaseでclaimし、初回のlifecycle stateをstale再claimで上書きせず、記録bucket、age、owner path、consumer/card参照を再確認する。eligible後に未回収の件数をalert対象にし、最初のscheduled runを逃した状態を検知する。
- source/orphanのage cleanupは23:59:59まで保護し24:00:00でeligibleとする。card削除trigger由来の`delete_pending`はage待ちをせず、同一ownerの最後の参照が0件であることをcleanup直前に再確認して削除する。cleanup claimは直前stateをdurableに保持し、Storage削除失敗時に`delete_pending`を復元して即時retry可能にする。各retryでlease、owner path、参照0件を再確認し、再参照objectを削除しない。
- cleanupはillustration/source/raw別のUUID claim identityを発行し、verify/completeでtracking/bucket/path/tokenの完全一致を要求する。stale completeは`CLAIM_LOST`であり、新leaseを利用できない。実在しないsource pathは記録せず、eligibleなsource/rawは同じ最初のrunで独立claimする。

### 6. statusはQueueではなくowner-scoped DB状態から復旧する

- commit APIはprovider/画像処理を呼ばず、transactional enqueue成功後にHTTP 202相当で同じ`batchId`、`status: queued`、status参照を2秒以内に返す。応答喪失時、同じowner/idempotency key/request hashは保存済みbatchを返す。
- status APIはQueueの可視性やEdge process memoryを正本にせず、owner-scopedのbatch/items/concept jobsから外部状態と安全なerror codeを導出する。`batchId`またはidempotency keyから再接続しても同じcard IDとterminal結果を返す。
- worker/cleanupはservice roleがRLSを迂回するため、すべてのRPCでjobからownerを解決し、caller提供owner/pathを信用せず、owner、batch、concept、Storage pathの一致をDBで再検証する。
- commit/status adapterはRPC成功objectを直接serializeせず、enum、UUID、nonnegative counts、item/card relation、safe error code、同一batch相対status URLを検査してallowlist DTOを再構築する。malformed JSONは400、PreviewTokenErrorは401、Queue/RPC availabilityだけを503にする。
- safe terminal error contractはS-10で発生し得る`DUPLICATE_EXISTING`をSQL、shared Edge、frontend strict parserで同一列挙に含め、unknown/malformed codeは拒否する。

### 7. deployment証跡は独立artifact identityとconfigured runtime log gateで固定する

- resource gateはself-contained bundleとWASMのbytes/SHA-256を別々に出力し、WASMをrepository artifact manifestと`package-lock.json`のversion/integrityへ照合する。combined revisionは補助値であり、WASM identityの代替にしない。
- real DB gateはclaim A→300秒expiry→claim B、Aのfinalize/fail/retry拒否、B成功、副作用件数、pair failure+sibling success、cleanup 23:59:59/24:00/reference/owner-pathをrollback transaction内で実行する。
- real E2Eはworker前のsource isolation/cross-owner commit、strict commit/status reconnect、duplicate snapshot、R1/W1参照削除を通す。main/recoverable両deploymentをruntimeとは独立したimmutable control-plane attestationのSHA-256へ束縛し、probe invocation UUIDに相関するrecoverable exactly one/failure zeroを要求する。self-reported digest、stale/unrelated log、incomplete collectorはpassにしない。
- normal permanent provider/Storage failureとretry exhaustionをDBでterminal確定した経路だけが、safe codeを持つ`worker_failure`をexactly one件出す。configuration、画像/input validation/decode、provider/Storage contract、poison、duplicate/business outcome、retry scheduling fault、DB/RPC/network ambiguity、claim loss、未確定/setup結果は`worker_failure`を出さず、対応するsafe allowlist eventで観測する。ACK/archive規則は変更しない。
- actual worker handlerはtrim済みnon-empty configured secretの取得・検証を共通outer boundary内で行う。missing/blank/read/setup faultはsafe 500+`worker_recoverable` one、valid secretに対するmissing/mismatch headerは401+log zeroとする。
- malformed payload/job missingはexact deliveryのarchive成功booleanをDB応答で確認後にだけqueue message ID相関のsafe `worker_poison` oneを出す。false/例外/不明ではpoison zeroとしてrecoverableに残す。DB-confirmed duplicateは`worker_duplicate` oneを出し、いずれも`worker_failure` zeroとする。
- failure/poison/duplicateはterminal/archiveと同じtransactionで`ai_worker_log_outbox`へ一意に記録する。dispatcherはUUID leaseとstable `eventId`を使い、stdout前crash後も再送可能にし、同一IDをlogger/collectorで重複排除する。outboxはsafe allowlist列だけを持つ。
- cleanup handlerもtrim済みnon-empty secretの取得とdatabase/Storage setupをouter boundaryへ含め、missing/blank/read/setup faultはsafe 500+cleanup one、有効secretへのmissing/mismatch headerはlogなし401とする。

## 検討した選択肢

### 選択肢1: Next.js同期commitまたはfire-and-forgetを延長する

- 概要: commit request内または`void` promiseでprovider/Storage/card確定を行う。
- 利点: migration、Edge Function、Queueが不要で変更量が小さい。
- 欠点: 2秒応答、process停止後の再開、5分visibility、永続backoff、duplicate deliveryを満たさない。S-08で受容したMVP弱点をそのまま残す。

### 選択肢2: DB outbox tableとdispatcherでpgmqへ転送し、batch単位workerで処理する

- 概要: commitはoutboxまでをtransactionalに書き、別dispatcherがQueueへ送り、1 messageで最大50itemを処理する。
- 利点: Queue実装をcommit transactionから分離でき、他queue製品へ置換しやすい。
- 欠点: outbox→pgmq間にも重複制御・監視・dispatcher scheduleが必要になる。batch処理はEdge durationと5分visibilityを超えやすく、1 concept失敗の分離とretryが粗い。

### 選択肢3（採用）: transactional pgmq enqueue + concept job + fenced pair finalize

- 概要: PostgreSQL transaction内でbatch/items/jobs/messagesを確定し、concept単位deliveryをclaim tokenでfenceする。
- 利点: enqueue欠落窓がなく、S-10のPostgres transaction/owner境界を維持できる。retry、failure fanout、並列性、Edge実行時間の単位が一致する。業務結果をunique制約とfenceでexactly-once相当にできる。
- 欠点: pgmqへの結合が強く、forward migrationでS-10 RPCと状態mappingを拡張する必要がある。StorageはDB transaction外なのでtracking/補償/cleanupが必要である。

### 比較マトリクス

| 評価軸 | 1: 同期/fire-and-forget | 2: outbox+batch | 3: tx enqueue+concept（採用） |
|---|---:|---:|---:|
| 2秒commit | 低 | 高 | 高 |
| DB↔Queue欠落防止 | 低 | 高 | 高 |
| 構成要素の少なさ | 高 | 低 | 中 |
| 5分claim fencing | 低 | 中 | 高 |
| concept失敗分離 | 低 | 中 | 高 |
| 永続5/30/120 retry | 低 | 高 | 高 |
| Edge runtime適合 | 低 | 低 | 中（hard gate付き） |
| S-10 DB primitive整合 | 中 | 中 | 高 |

## 影響

### ポジティブ

- commit応答と長時間画像処理が分離され、切断後も同じbatchへ再接続できる。
- at-least-once deliveryでもcard/quota/illustration/objectをstable keyとDB transactionで一意にできる。
- provider、Storage、concept単位のfailure/retryを独立して観測できる。

### ネガティブ

- `pgmq`、Cron、Edge secrets、WASM bundle/resource limitが新しい運用対象になる。
- 公式例が警告する大容量画像処理に対し、本件はsource最大10MiB、provider 4MiB/1024pxを要求する。fresh-process deployment gateに不合格なら性能調整ではなくarchitecture decisionの再検討が必要になる。
- S-10のitem単位finalizeはconcept pair atomicityに不足するため、新しいconcept RPCとforward-compatible state mappingが必要になる。
- StorageとDBは原子的でないため、補償とcleanupなしには完了できない。
- claim tokenはDB書込みをfenceできるが、既に開始されたprovider/Storage I/O自体は取り消せない。stable path、existing-object検証、claim前後確認、orphan cleanupで収束させる必要がある。

### 中立

- S-08 reveal時生成は既存学習card向けに残すが、AI import経路では本workerを正とする。
- 外部Batch statusは`queued | processing | completed | partial | failed | undone`、Item statusは`queued | processing | succeeded | failed | undone`とする。既存S-10物理値`committed/finalized`は互換mappingとして残す。
- OpenAIカード本文生成UIとOAuth/MCP transportは変更しない。

## 実装への指針

- DB unique/check/FK、service-role wrapper、claim tokenを正本とし、TypeScriptの事前検査だけに依存しない。
- Queue schema/functionsをData APIへ公開せず、commit adapter/worker/cleanupだけがservice roleでRPCを呼ぶ。
- provider、clock、fetch、Storage、image codec、loggerをinterfaceで注入し、pure classifier/validator/backoffをunit test可能にする。
- ACKは成功/failed/undone/terminal duplicateだけで行う。処理中例外をcatchして無条件ACKしない。
- raw error/bodyを保存せず、safe code、provider、HTTP status、attempt、duration、IDだけを構造化logへ出す。

## 参考資料

- [Supabase Queues](https://supabase.com/docs/guides/queues): Postgres-native durable queueとvisibility window
- [Supabase Queues API](https://supabase.com/docs/guides/queues/api): `send` delay、`read` visibility、`archive`契約
- [PGMQ extension](https://supabase.com/docs/guides/queues/pgmq): logged queue、message record、明示archive
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions): Deno TypeScript/WASMとshort-lived/idempotent設計
- [Supabase Edge image manipulation](https://supabase.com/docs/guides/functions/examples/image-manipulation): `magick-wasm`利用とnative Sharp非対応
- [Supabase Edge Functions limits](https://supabase.com/docs/guides/functions/limits): hosted memory、CPU、wall-clock、bundle上限
- [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions): `pg_cron` + `pg_net` + Vault
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control): private objectのRLSとservice key境界
- [Supabase Storage schema](https://supabase.com/docs/guides/storage/schema/design): object操作はStorage API経由とする制約
- [Supabase Storage standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads): `upsert:false`相当のpath競合と6MB超uploadの注意
- [OpenAI image generation](https://developers.openai.com/api/docs/guides/image-generation): Image API、base64 image、size/format制御
- [Gemini image generation](https://ai.google.dev/gemini-api/docs/image-generation): Gemini画像生成REST/inline image契約

## 関連情報

- `specs/adr/ADR-002-database-schema-rls-access-boundary.md`
- `specs/adr/ADR-004-illustration-generation-backend-mvp-decisions.md`
- `specs/adr/ADR-007-ai-card-import-foundation.md`
- `specs/stories/S-10-ai-card-import-foundation/design.md`
- `specs/stories/S-11-ai-card-async-processing/requirements.md`

## 変更履歴

| 日付 | 版 | status | 変更内容 |
|---|---|---|---|
| 2026-07-15 | 1.0.2 | Accepted | composite review承認を反映 |
| 2026-07-15 | 1.0.1 | Proposed | reviewer修正。ACK matrix、terminal finalize/archive、Storage path競合、status復旧、Edge hard gate、cleanup期限を明確化 |
| 2026-07-15 | 1.0.0 | Proposed | transactional enqueue、concept claim fencing、永続retry、provider非fallback、画像/cleanup境界を提案 |
| 2026-07-15 | 1.1.0 | Accepted | legacy/new bucket永続契約、durable shared-source consumer、recoverable cleanup lease、実WASM初期化とfail-closed real/resource gateを確定 |
| 2026-07-15 | 1.1.1 | Accepted | Queue/RPC 503とdecode-bomb/decode-failureの厳密HTTP契約・外部CPU/RSS/deadline強制を確定 |
| 2026-07-15 | 1.2.0 | Accepted | F-01〜F-13 remediation。provider streaming/base64 bounds、strict DTO/safe 4xx、exact cleanup age、real fencing/pair/reference/E2E、independent artifact identity、runtime log gateを決定 |
| 2026-07-15 | 1.3.0 | Accepted | F-14〜F-18 remediation。safe duplicate status、paired provider endpoint binding、exact terminal failure log、bounded conflict read、tracked managed Storage mutation denialとlegacy/service互換を決定 |
| 2026-07-15 | 1.4.0 | Accepted | P3-01/P3-02 remediation。DB-confirmed terminal failureだけの`worker_failure`、safe recoverable event、入力限定64pxと極端縦横比の正規化寸法契約を決定 |
| 2026-07-15 | 1.5.0 | Accepted | Review attempt 1 remediation。entrypoint recoverable boundary、claim-bound terminal failure identity、served recoverable runtime count/correlation gateを決定 |
| 2026-07-15 | 1.6.0 | Accepted | Review attempt 2 remediation。actual auth/config boundary、immutable artifact attestation+invocation correlation、poison event、duplicate outcomeとdurable-orphan補償を決定 |
| 2026-07-15 | 1.7.0 | Accepted | Fresh remediation cycle 4。failure taxonomy、confirmed poison ACK、durable delete_pending retry、cleanup auth boundaryを決定 |
| 2026-07-15 | 1.8.0 | Accepted | Review attempt 1 remediation。terminal observability outbox、cleanup UUID identity fence、実在source限定trackingとsource/raw first-run回収を決定 |
| 2026-07-15 | 1.9.0 | Accepted | Review attempt 2 remediation。DB-clock claim expiry、pre-write source intent、entity cleanup limit、complete lease、deleted illustration fenceを決定 |
| 2026-07-15 | 2.0.0 | Accepted | Bounded remediation cycle 5。caller clockをconcept/cleanup/outbox RPCから除去し、deleted lifecycle、actual Response streaming、共有prompt policyを決定 |
| 2026-07-15 | 2.0.1 | Accepted | Cycle 5 independent review 1 remediation。shared reference lock、2→1 ready、last-reference pending、S-10 attach/cleanup競合を決定 |
| 2026-07-15 | 2.0.2 | Accepted | Cycle 5 independent review 2 remediation。atomic reference count、canonical lifecycle lock order、bounded concurrency gatesを決定 |
| 2026-07-16 | 2.0.3 | Accepted | Fresh bounded remediation cycle 6。cards→illustrations→trackingの全経路順序とcomplete/attach gate、cancel-safe provider oversize classificationを決定 |
| 2026-07-16 | 2.0.4 | Accepted | Cycle 6 independent review 1 remediation。S-10 different-key attachのOLD+NEW一括lockとA↔B cross-swap二順序gateを決定 |
| 2026-07-16 | 2.0.5 | Accepted | Cycle 6 independent review 2 remediation。caller JWT lifecycle fenceとpost-terminal outbox/source-release isolationを決定 |
