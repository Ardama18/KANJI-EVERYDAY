---
id: ADR-010
feature: ai-card-openai-generation-ui
type: adr
version: 1.0.1
created: 2026-07-18
updated: 2026-07-18
status: Accepted
based_on: specs/stories/S-12-ai-card-openai-generation-ui/requirements.md
related_epic: GH-9
---

# ADR-010: AIカードUIを再preview・source即時release・batch status復元で構成する

## ステータス

Accepted

## コンテキスト

S-12のUIは、未信頼の生成draft、S-10で検証済みpreview、S-11へcommit済みbatchという3つの信頼段階を扱う。preview後編集をそのままcommitするとHMACが古い内容を承認し、draftをbrowserへ永続保存すると個人情報・カード本文・tokenが残る。また教材sourceはOpenAI入力終了後は不要だが、S-11の既存即時releaseはcommit後jobを起点とするため、commit前の生成終了・取消にowner-scoped release補助が必要である。

Rollbackは新規作成を止めても既存batchのstatusを残す必要がある。したがってfeature flagをstatusまで一括遮断できない。

## 決定事項

### 1. draft、preview、committedを分離する

- UI stateは`editing | generating | previewValid | previewDirty | committing | tracking | terminal`のdiscriminated unionとする。
- `previewValid`だけがpreview token、import hash、reservation key、expiresAtを持てる。card本文・tag・illustration・include/orderを変更したイベントは同期的にtokenを破棄して`previewDirty`へ遷移する。
- `POST /api/ai/imports/preview`は変更後requestをS-10 validatorとread-only DB validationへ通し、新しいhash/tokenを返す。commit endpointもrequest hash、HMAC、owner、reservation、期限を再検証する。
- warning confirmationはpreview versionごとのclient stateとし、再preview後にfalseへ戻す。commit bodyに`confirmedWarnings: true`を必須とし、serverでもexact booleanを検査する。

### 2. illustration uploadはconcept単位で扱う

- `none | ai | upload`は各conceptの設定とする。`both`のR1/W1は同一controlを共有し、item単位に別uploadを選べない。
- `upload`選択時は教材sourceとは別のfile controlからS-11 source prepare/completeを使って1つのready `uploadId`を得て、pair両itemへ同じIDを写像する。
- S-12 forward migrationで`ai_uploads.usage_scope`を`generation_source | card_illustration`として追加し、既存rowは`card_illustration`へbackfillする。教材uploadはprepare時に`generation_source`をserver保存し、import用uploadは`card_illustration`を維持する。
- conceptのmode/file変更はpreviewをdirtyにする。除外でconceptの片側だけを残すことは許可するが、残したitemのimage設定はconcept controlの値を使う。
- source教材をillustrationへ暗黙転用しない。

### 3. generation sourceにowner-scoped即時releaseを追加する

- S-11 migrationを編集せず、S-12 forward migrationでservice-role専用`release_ai_generation_source`と`complete_ai_generation_source_release`を追加する。
- release RPCはowner/upload IDをlockし、`usage_scope='generation_source'`、`prepared | ready | cleanup_pending`、記録済みbucket/path、active consumer不在を確認する。削除対象を`cleanup_pending`かつ`delete_due_at <= now`へし、raw/source pathを返す。
- Route Handlerは記録済みpathだけをStorageから削除する。successと404はdeleted completion、transient failureはretry completionとする。response loss時は同じowner/uploadでreleaseを再実行し、同じpathを再削除して収束する。
- generate routeはsourceのowner、`usage_scope`、ready state、記録済みpathを検証した直後、Storage byte readより前に全IDをrelease setへ入れ、その後のsource read失敗を含む全terminal pathを`finally`相当でreleaseする。明示取消は`POST /api/ai/card-drafts/sources/release`を呼ぶ。browser crash/通信断はS-11 cleanup markerと作成後24時間gateへ委ねる。
- S-11の`claim_ai_import_cleanup`、`verify_ai_import_cleanup`、`complete_ai_import_cleanup`を変更せず再利用する。`created_at + 24 hours <= DB now`、active consumerなし、owner path、claim tokenを満たすときだけage cleanupする。

### 4. reload復元はbatch pointerだけに限定する

- `localStorage` keyは`kanji-everyday:ai-card-import:v1:{deckId}`、valueは`{ version: 1, deckId, batchId }`だけとする。instruction、source、draft、card本文、token、reservation/idempotency keyを保存しない。
- 202をstrict parseした後だけ保存する。terminal status取得後または404で削除する。
- pollはvisibility中2秒、30秒経過後5秒へbackoffし、`completed | partial | failed | undone`、404/401、明示取消で停止する。network/503は5秒で継続し、文字の「再取得」操作を常に提供する。
- 同一originの`BroadcastChannel('ai-card-import-status-v1')`でtabごとにlease heartbeatを共有する。最小lexicographic tab IDのvisible tabだけがpollし、他tabはbroadcast結果を表示する。BroadcastChannel非対応時は各tab pollを許容するが、status GETはread-onlyである。

### 5. feature flagを新規mutation境界だけへ適用する

- `AI_CARD_IMPORT_ENABLED`はtrim後のexact `true`だけをenabledとする。未設定、空、`false`、不正値はfail-safe disabledである。
- disabled時はdeck導線非表示、new page 404、generate/preview/source prepare/source complete/new `app_ai` commitを404またはdisabledにする。
- status GETとowner-scoped source releaseはflag判定外とし、既存batchの復元と切替前sourceの回収を維持する。既存card/deck/study/worker/cleanupも停止しない。
- S-11 source prepare/completeは現在authenticated app専用routeであるため、このflagでserver gateする。remote MCPは別のtrusted adapter契約を維持する。

## 根拠と選択肢

### 選択肢1: form/draft/tokenをlocalStorageへ全保存する

- 利点: reload時に編集を完全復元できる。
- 欠点: PII、教材由来text、tokenを長期保存し、古いpreviewを誤commitしやすい。

### 選択肢2: server-side draft session tableとsource専用workflowを新設する

- 利点: multi-device復元と厳密なworkflow stateを提供できる。
- 欠点: Issue #13を超えてS-10/S-11と並行する永続基盤を作り、移行・cleanup対象を増やす。

### 選択肢3（採用）: memory draft + 再preview + batch pointer + S-11 lifecycle拡張

- 利点: token/contentの保存を避け、S-10 HMACとS-11 status/cleanupを正本にできる。
- 欠点: commit前reloadではdraftを復元できず、ユーザーは再生成が必要になる。

| 評価軸 | 全local保存 | draft table新設 | 採用案 |
|---|---:|---:|---:|
| PII/token最小化 | 低 | 中 | 高 |
| S-10/S-11再利用 | 低 | 低 | 高 |
| reload後tracking | 高 | 高 | 高 |
| 実装・運用複雑性 | 中 | 高 | 中 |
| rollback安全性 | 低 | 中 | 高 |

## 影響

### ポジティブ

- preview内容差し替えをhash/HMACとUI stateの二重で防ぐ。
- sourceは通常即時、異常時24時間cleanupへ収束する。
- flag停止後も既存batch/cardを見失わない。

### ネガティブ

- commit前reloadでdraftは失われる。
- concept単位illustration UIとmulti-tab leaseの状態管理が必要になる。
- S-12用forward RPCとrelease routeが追加される。

### 中立

- status pollの重複は完全排除を保証しない。read-only GETとDB owner境界により安全性へ影響しない。

## 実装への指針

- UI state reducerはpure functionにし、tokenを持てるstateを型で限定する。
- `localStorage` parseは`unknown`からversion/deckId/batchIdだけをallowlistする。
- source deleteはDBに記録されたowner pathだけを対象とし、client pathを信用しない。
- flag helperをserver configへ一元化し、routeごとの`process.env`参照を禁止する。

## 関連情報

- `specs/adr/ADR-007-ai-card-import-foundation.md`
- `specs/adr/ADR-008-ai-card-async-queue-image-processing.md`
- `specs/adr/ADR-009-openai-card-generation-safety-boundary.md`
- `specs/stories/S-12-ai-card-openai-generation-ui/design.md`

## 変更履歴

| 日付 | 版 | 変更内容 |
|---|---|---|
| 2026-07-18 | 1.0.0 | 初版 |
| 2026-07-18 | 1.0.1 | S-10/S-11非置換、preview改ざん防止、source read失敗を含む即時/24時間cleanup、rollback時status維持を第三者document reviewで再確認しAccepted |
