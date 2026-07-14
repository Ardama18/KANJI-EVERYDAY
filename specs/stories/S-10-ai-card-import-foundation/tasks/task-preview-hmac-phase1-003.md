# タスク: preview HMACを実装しPhase 1品質ゲートを通す

メタ情報:
- ストーリー: S-10-ai-card-import-foundation / Issue #10
- フェーズ: 1（最終タスク）
- 依存: `tasks/task-key-canonical-phase1-002.md`
- 提供成果物: `preview-token.ts`, UT-HMAC 7件、Phase 1 approved証跡
- 関連AC: AC-04、UT-HMAC-01〜07
- サイズ: 標準（2-3ファイル、security-sensitive vertical slice）

## 実装内容

`v/userId/reservationKey/importRequestHash/expiresAt`を束縛する1800秒固定TTLのbase64url HMAC-SHA256 tokenを、secretとclock注入の純粋関数として実装する。形式/version/署名/owner/key/期限/hashの失敗を安全に拒否し、Phase 1の22 Unitを回帰する。

## 対象ファイル

- [ ] `frontend/src/lib/ai-import/preview-token.ts`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.test.ts`
- [ ] `specs/stories/S-10-ai-card-import-foundation/tasks/task-preview-hmac-phase1-003.md`（品質結果記録）

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [ ] `UT-HMAC-01〜07`を失敗テストへ置換し、正常、1 byte改ざん、不正形式/version、owner/key/hash/secret不一致、期限境界、長さ違いを検証する。

```bash
npm --prefix frontend run test:s10:unit -- -t "UT-HMAC"
```

### 2. Green Phase

- [ ] canonical payloadをbase64url化し、HMAC-SHA256で署名する。
- [ ] verify順を形式→version→constant-time署名→userId→reservationKey→expiresAt→import hashに固定する。
- [ ] secret/nowは必須引数とし、`process.env`、DB、networkを参照しない。
- [ ] 期限内最終秒を許可し、期限超過を拒否する。

### 3. Refactor / Phase gate

- [ ] Phase 1対象Unit 22件をまとめて回帰し、TODO inventoryがUnit残10/Integration 61/E2E 13であることを確認する。
- [ ] token/secret/payload本文がerror/logへ出ないことをassertする。
- [ ] task-executorから `/quality-fixer frontend` を呼び、lint/typecheck/対象Unitを修正ループ後に再実行する。

```bash
npm --prefix frontend run test:s10:unit -- -t "UT-NORM|UT-CARDKEY|UT-HASH|UT-HMAC"
npm --prefix frontend run typecheck
npm --prefix frontend run lint
```

## 完了条件

- [ ] `UT-NORM` 5、`UT-CARDKEY` 3、`UT-HASH` 7、`UT-HMAC` 7の計22件がPASSする。
- [ ] TTLは1800秒、署名比較はconstant-time primitiveを使い、token本文を露出しない。
- [ ] fixture/helper/productionに`any`、外部network/provider依存がない。
- [ ] `/quality-fixer frontend`の構造化結果が`status=approved`で記録される。
- [ ] Phase 1の動作確認レベルL2を満たし、Phase 2開始条件が成立する。

## 注意事項

- preview secretの環境変数配線やadapter/Route HandlerはIssue #10対象外。
- Contract E2E TODOは変更しない。

