# タスク: card-keyとcanonical request hashを実装する

メタ情報:
- ストーリー: S-10-ai-card-import-foundation / Issue #10
- フェーズ: 1
- 依存: `tasks/task-test-foundation-normalize-phase1-001.md`
- 提供成果物: `card-key.ts`, `canonical-request.ts`, Unit 10件
- 関連AC: AC-01〜05、UT-CARDKEY-01〜03、UT-HASH-01〜07
- サイズ: 標準（3-4ファイル）

## 実装内容

共有fixtureと`normalizeForKey`を使い、U+001F区切りのcard key、provider前generation hash、provider結果後import hashを決定的な純粋関数として実装する。client由来`source`、owner、reservation key、quota免除flagはcanonical hash対象/入力型に含めない。

## 対象ファイル

- [x] `frontend/src/lib/ai-import/card-key.ts`
- [x] `frontend/src/lib/ai-import/canonical-request.ts`
- [x] `specs/stories/S-10-ai-card-import-foundation/fixtures/canonical-requests.json`
- [x] `specs/stories/S-10-ai-card-import-foundation/tests/ai-card-import-foundation.test.ts`

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase

- [x] `UT-CARDKEY-01〜03`と`UT-HASH-01〜07`をfixture駆動の失敗テストへ置換する。
- [x] pattern/front/back順、NFKC/空白/case同値、意味差分、object挿入順、tag順、ordinal、UUID、integer、optional省略を個別に検証する。

```bash
npm --prefix frontend run test:s10:unit -- -t "UT-CARDKEY|UT-HASH"
```

### 2. Green Phase

- [x] `pattern + U+001F + normalizedFront + U+001F + normalizedBack`のUTF-8 SHA-256 lowercase hexを返す。
- [x] generation入力/options/requested unitsと最終ImportRequestを別canonical form/hashとして実装する。
- [x] item ordinalを維持し、tagはnormalized name順、UUIDはlowercase、未使用optional keyは省略、JSON空白なしとする。
- [x] owner/reservation key/source/trusted flagをcanonical requestから排除する。

```bash
npm --prefix frontend run test:s10:unit -- -t "UT-CARDKEY|UT-HASH"
```

### 3. Refactor Phase

- [x] Web/Nodeの環境依存やDB/network参照を除き、UTF-8/SHA-256処理を重複させない。
- [x] generation/import hashが一致することを要求せず、意味差分だけでdigestが変わることを確認する。

## 完了条件

- [x] 対象10件がPASSし、Unit累計15/32件が実テスト化される。
- [x] digestが常にlowercase 64文字hexで、fixture全vectorと一致する。
- [x] canonical input/result型に`any`およびtrusted/client境界違反がない。
- [x] `npm --prefix frontend run typecheck`がPASSする。
- [x] 動作確認レベルL1が満たされる。

## 注意事項

- preview HMAC、DB migration、schema validationはこのタスクで実装しない。
- provider SDK、Queue、MCP transportを追加しない。
