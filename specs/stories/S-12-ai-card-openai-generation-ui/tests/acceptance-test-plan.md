# S-12 受入テスト計画

- 対象: `S-12-ai-card-openai-generation-ui`
- 正本: `../design.md` v1.0.1、`../requirements.md` v1.1.1
- 生成日: 2026-07-18
- planning gate制約: skeletonは`it.todo`・コメント・importのみ。assertion、mock、fixture、helper、production実装は後続実装gateまで作成しない。
- 既存境界: S-10/S-11の既存test、実装、migrationは変更しない。

## テスト層と成果物

| 層 | 成果物 | ケース数 | 実装時期 |
|---|---|---:|---|
| Unit | 本書のケース一覧のみ | 16 | pure contract実装と同時。現gateでは実装ファイルを作らない |
| Integration | `ai-card-openai-generation-ui.int.test.ts` | 15 todo | provider/route/S-10/S-11接続実装と同時 |
| E2E | `ai-card-openai-generation-ui.e2e.test.ts` | 7 todo | 全実装およびS-11 hosted gate完了後 |
| Visual/accessibility | `../ui-design/visual-checklist.md` | 2ページ/状態群 | UIが機能的に動作した後 |

## Unit test計画（16件、実装ファイルは作成しない）

1. text-only Responses payloadがserver model、`store:false`、`background:false`、toolsなし、strict `text.format`を持つ。
2. source画像付きpayloadがsanitized data URLとallowlisted `detail`を持ち、外部URLを受け付けない。
3. requested concept数を`minItems=maxItems`へ反映したStructured Outputs schemaを構築する。
4. provider conceptをR1のfront/backへmappingする。
5. provider conceptをW1のfront/backへmappingする。
6. `both`を同一concept IDのfront/back交換pairへ展開する。
7. 展開後0・51・both奇数・provider件数不一致を拒否する。
8. completed responseからallowlisted reasoning itemを無視し、assistant message 1件/output_text 1件だけをparseする。
9. refusal contentを`OPENAI_REFUSAL`へmappingし本文を破棄する。
10. incompleteの`max_output_tokens`/`content_filter`を`OPENAI_INCOMPLETE_OUTPUT`へmappingしpartialを破棄する。
11. JSON/schema/未知output/追加message/複数output_textを`OPENAI_OUTPUT_SCHEMA_MISMATCH`へmappingする。
12. text 1回・画像ごと1回・output 1回のmoderation payloadと`results.length === 1`/boolean shapeを判定する。
13. timeout/network/408/429/5xx/401/403/その他4xx/error objectをtransient/config/permanentへmappingする。
14. generation canonical hash、同一quota key再送、別hash/units conflictを判定する。
15. edit/exclude/order/tag/image eventがtokenを破棄しconfirmationをresetするUI reducer遷移を判定する。
16. localStorage batch pointer、status response、poll terminal/backoff、BroadcastChannel lease payloadをstrict parseする。

## 実行順序と依存関係

1. ADR-009/010 Acceptedとconfigured model capability testを確認する。
2. Unit 1〜14でprovider/domain境界を固定する。
3. Integration INT-03〜09でpayload/output/error mappingを固定する。
4. Unit 15〜16とIntegration INT-01/02/10〜15でUI state・Route・S-10/S-11接続を固定する。
5. S-11 Hosted7、cleanup schedule、24時間境界をpassさせる。`not_run`はpassにしない。
6. E2E-01〜07とvisual/accessibility checklistを実行する。
7. `npm run check`、S-10/S-11 inventory、既存deck/study回帰を実行する。

## AC traceability

| AC | Unit計画 | Integration skeleton | E2E skeleton | Checklist |
|---|---|---|---|---|
| AC-01 text/image generation | U-01〜03、U-08、U-12 | INT-01〜03 | E2E-01、E2E-02 | source/form/preview状態 |
| AC-02 both/count | U-03〜07 | INT-04、INT-05 | E2E-02 | both card layout |
| AC-03 error separation | U-08〜13 | INT-06〜09 | E2E-05 | error文字/focus/live region |
| AC-04 edit/exclude/confirmation | U-15 | INT-10、INT-11 | E2E-01、E2E-02 | keyboard/focus/confirmation |
| AC-05 token defense | U-14 | INT-12、INT-14 | E2E-01のdirty commit境界 | token本文はvisual対象外 |
| AC-06 source deletion | U-12のimage stage | INT-02、INT-13、INT-14 | E2E-02 | source状態表示 |
| AC-07 UI/accessibility | U-15、U-16 | INT-10 | E2E-06 | 全項目 |
| AC-08 quality/rollback/regression | U-16 | INT-15 | E2E-03、04、07 | flag off/status状態 |

## 合格基準

- Unit 16、Integration 15、E2E 7の実装済みcaseがすべてpassする。
- schema mismatch、refusal、incomplete、text/image/output moderation、provider transient/config/permanentが期待safe codeへ一意にmappingされる。
- provider前拒否はquota/provider/batch副作用0、予約後失敗はquota保持かつpreview/batch副作用0となる。
- sourceは通常即時削除、削除失敗は24時間cleanupへ収束し、別owner・illustration scope・active consumerを削除しない。
- E2Eのtext、image、reload、partialの4必須シナリオが独立してpassする。
- 360px、keyboard-only、label/error/live regionのchecklistが完了する。
- `cd frontend && npm run check`、`npm run test:s10:inventory`、`npm run test:s11:inventory`がpassし、既存deck/studyに回帰がない。

## 確認事項

ユーザー確認は不要。Design Docがテスト境界、safe code、件数、cleanup、rollbackを測定可能に定義している。実行環境上の必須確認は、S-11 hosted acceptanceとconfigured OpenAI model capability gateであり、未成立時は実装・E2Eをblockedとする。

## 実行結果（2026-07-19）

- Unit 20件、Integration 17件、E2E 7件、合計44件がpassし、S-12内todo/skip/not_runは0件。
- QA回帰test 5件（paired edit 3件、partial表示1件、除外後commit 1件）がpass。
- `npm run check`: 56 test files、790 pass、既存9 skip。lint・typecheckもpass。
- `npm run test:s12:real-db`: illustration列権限/RLS、failed→pending限定遷移、preview既存重複検査がpass。
- production buildがローカルSupabase環境変数をprocess内だけで与えた状態でpass。
- 実OpenAI text/image生成、source即時削除、360px横overflow 0、reload復元、partial表示、keyboard-only生成→除外→再preview→確認→commitをブラウザで確認。
- 除外後commitは生成時quota 2 unitsを保持したまま最終batch 1枚を202で受理し、reservationとbatchの紐付けを実DBで確認。
