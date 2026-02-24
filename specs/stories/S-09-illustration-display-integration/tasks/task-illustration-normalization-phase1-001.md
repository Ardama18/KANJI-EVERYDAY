# タスク: イラスト状態契約と正規化関数を固定する

メタ情報:
- ストーリー: S-09-illustration-display-integration
- フェーズ: 1
- 依存: なし
- 提供成果物:
  - `frontend/src/actions/session-actions.ts`
  - `frontend/src/actions/session-actions.test.ts`
- 関連AC: AC-01, AC-02, AC-04, AC-05, AC-06, AC-07
- サイズ: 標準（4-10ファイル）

## 実装内容
`CardBackData` / `IllustrationDisplayStatus` 契約を5状態列挙へ更新し、`illustration_key` / `illustrations` 行の入力を一元判定する `normalizeIllustrationState` を実装する。`ready` のSigned URL契約（`expiresIn=3600`）と `failed` 非trigger契約を先に固定し、後続タスクで `revealCard` / `phase=back` へ安全に適用できる状態を作る。

## 対象ファイル
- [ ] `frontend/src/actions/session-actions.ts`
- [ ] `frontend/src/actions/session-actions.test.ts`

## テスト観点
- Unit:
  - 5状態以外を返さない（AC-01）
  - `illustration_key=null` を `none/null` へ正規化（AC-02）
  - `ready + storage_path` でSigned URLを返し、期限が3600秒（AC-04, AC-05）
  - `pending` 行は `pending/null`（AC-06）
  - `failed` 行は `failed/null` かつtrigger呼び出しなし（AC-07）

## 実装手順（TDD: Red-Green-Refactor）

### 1. Red Phase
- [ ] `frontend/src/actions/session-actions.test.ts` に正規化ケース（none/ready/pending/failed）の失敗テストを追加する。
- [ ] Signed URL期限が3600秒であることを検証する失敗テストを追加する。
- [ ] `failed` ケースでtriggerが呼ばれないことを検証する失敗テストを追加する。

```bash
npm run test --prefix frontend -- src/actions/session-actions.test.ts
```

### 2. Green Phase
- [ ] `frontend/src/actions/session-actions.ts` で `IllustrationDisplayStatus` 列挙を5状態に固定する。
- [ ] `normalizeIllustrationState` を実装し、DB行/入力条件から `status + url|null` を返す。
- [ ] `ready` で Signed URL 生成に `expiresIn=3600` を設定する。
- [ ] 追加したテストを再実行して通過させる。

```bash
npm run test --prefix frontend -- src/actions/session-actions.test.ts
```

### 3. Refactor Phase
- [ ] 正規化ロジックの条件分岐を整理し、重複fixtureを削減する。
- [ ] 回帰がないことを再実行で確認する。

```bash
npm run test --prefix frontend -- src/actions/session-actions.test.ts
```

## 完了条件
- [ ] 5状態契約（`ready|pending|generating|failed|none`）が型/実装/テストで一致している。
- [ ] AC-02/04/05/06/07 を対象ユニットテストで検証できる。
- [ ] 後続タスクが `normalizeIllustrationState` を再利用できる構造になっている。
- [ ] 動作確認レベル L1（対象Unit + 静的確認）が満たされている。

## 動作確認
- [ ] `npm run test --prefix frontend -- src/actions/session-actions.test.ts`
- [ ] `npm run check --prefix frontend`
- [ ] `git diff --name-only`
