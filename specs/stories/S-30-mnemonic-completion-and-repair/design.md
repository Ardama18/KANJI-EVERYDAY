# Design: Issue #97

ADR-015が変更判断の正本。S-21のsuccess-only生成をlosslessな語ごとのoutcomeに切り替える。providerの生body/exceptionを固定コードへ写像し、MCP外部入力にはmnemonic/ownerを許可しない。

## 登録と語単位再試行

- `s14_remote_commit_import` の既存signatureとJWT/client/session/preview/hash検証を維持する。`p_mnemonics`にapproved slotsかblocked codeを載せる。approved mnemonic・job state・queueの更新は同じTX。
- requiredはDBで導出し、欠落は `blocked_mnemonic`。mnemonic_state/error_code/attemptをjobへ保存しqueueをarchiveする。他の成功語の処理は継続する。
- `get_import_status` のbatch/itemに未完了状態とsafe codeを投影する。成功・失敗countへ未完了を足さない。pollは止まり、明示refreshとMCP `retry_mnemonic` が復旧経路となる。
- retry準備はowner認可後に90秒leaseを確保する。serverがDBから得た語を生成・安全確認し、completeがtoken/state/期限/targetを再検証する。承認後は同じjob/illustrationをrequeueする。commitのidempotent replayは既存結果を返す。
- claimはprovider/quotaより先にapproved slotsを検証・pinする。objectにslots snapshot/hashと `mnemonic-v2` を保存。workerはprompt hashをupload登録へ渡す。finalizeはcurrent approved slotsとsnapshot hash、template version、prompt hashを再照合し、欠落や途中編集なら完成させない。

## カードを保つ画像修復

`repair_card_illustration(cardId, expectedUpdatedAt, idempotencyKey)` をMCPへ追加する。owner-bound prepareがoriginal succeeded AI jobを解決し、旧画像を共有するカードのID・updatedAt・cardKeyと旧mnemonic updatedAtをsnapshotに固定する。既存の有効なapproved mnemonicは再利用し、欠落ならserverで生成・安全確認する。

新しいillustration/key/objectと専用repair jobを作成する。旧カードは生成・upload中もready画像を参照する。workerはslotsから生成したPNGのdigest/寸法/prompt hashを保存してから差替える。曖昧なuploadでは存在するbytesのdigest一致を確認し、upsertで上書きしない。

claimでoriginal jobがundone等へ変わっていればproviderより先に競合停止する。finalizeはoriginal job → repair job → ID順cards → lifecycleの順でlockし、snapshotと旧mnemonic revisionを再確認する。画像を共有するcard群の `illustration_key` だけを一括更新する。deck/tag/review/sessionへDMLしない。reference-count triggerにより旧画像は0参照でのみdelete_pending、新画像へ共有参照を移す。user_edited_atを立て、original import undoが修復済みカードを削除しないよう保護する。

学習中は `generated / ACTIVE_SESSION`、次のclaimを60秒延期し、既存digestを検証して再生成せずfinalizeする。provider/uploadが曖昧でdigestを記録できない場合のclaimは3回まで。quotaは既存illustration_concept枠でrepair IDごとに一度予約する。failed/conflictの新objectはorphan cleanupへ送り、旧imageは保持する。再操作は同じkeyでstatus確認、新keyで明示的な新修復となる。

## Schema / migration

| Migration | 追加・変更 | 既存データへの作用 |
|---|---|---|
| 20261004000000_s30_mnemonic_completion.sql | concept jobのrequired/state/code/attempt/lease、blocked_mnemonic state、objectのslots snapshot/hash・prompt version/hash、commit/claim/finalize/status/retry/undo契約 | 非破壊。既存成功をbackfillしない。未処理Remote MCP対象は次claimで検証 |
| 20261004000001_s30_illustration_repair.sql | repair jobs・RLS・RPC、objectのnullable job_idとrepair_job_id、元job/repairのXOR制約 | 既存objectはjob_idを保持しXORを満たす。repair作成まで画像・カードを変更しない |

SECURITY DEFINER ownerはs10_migration_owner、固定search_path。private helpersは全外部roleからrevoke、worker mutationはservice_roleだけ、remote wrapperはauthenticatedだけでactorを再導出。owner SELECTにもworker claim tokenを公開しない。

schema追加は必要であり、既存migrationは書換えない。schema適用後PostgREST schema reloadが必要。workerを一時停止し、migration → 新worker → frontend/MCPの順で整合を取り、stagingで下記未検証gateを通してから再開する。旧workerはprompt hashを記録しないのでrequired jobをfinalizeできない。戻す場合も旧generic completionを再許可せずworker停止で保全する。remote適用・deployは今回未実施。

## 検証と残る境界

`tests/database-gate.mjs fresh|upgrade` は使い捨てPGlite PostgreSQL/pgcrypto上でmigration全系列とRPCを実行する。Auth/Storage/pgmqはfixture、cron/netを使うschedule migrationのみ除外する。Hosted/PostgREST/実provider、実pgmq配信、真の複数接続deadlock試験、ブラウザ・OAuth経由の修復は別gateであり、隔離DBの成功を代替証拠にしない。

requirementsのAC対応表に示すテストを正本とする。利用者の暫定復旧は再実行せず、必要時にownerが選択したカードだけを修復する。
