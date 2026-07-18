# TypeScript テストルール（まいにち漢字）

## 現行ツール

- runner: Vitest
- frontend unit / component / Action: `frontend/src/**/*.test.ts(x)`
- story integration: `specs/stories/**/tests/*.int.test.ts(x)`
- story E2E 相当: `specs/stories/**/tests/*.e2e.test.ts(x)`
- config: `frontend/vitest.config.ts` とルート `vitest.config.mjs`

Playwright は現時点で未導入。ファイル名に `e2e` が含まれていても、必ずしも実ブラウザ E2E ではない。テストが実際に何を起動し、何を mock するかで検証レベルを報告する。

## 基本方針

- Red → Green → Refactor を基本とし、bug fix は再現テストを先に追加する。
- requirements の各受入条件（AC）を、design / plan のテストまたは手動検証へ明示的に対応付ける。未対応 AC を残したまま完了扱いにしない。
- 実装詳細ではなく、公開関数の contract と利用者が観測できる振る舞いをテストする。
- happy path だけでなく、未認証、別 owner、空、境界日、外部失敗、再実行を扱う。
- `test.skip`、`.only`、弱い assertion を残さない。
- timezone と現在時刻を固定し、実行日依存をなくす。
- Arrange / Act / Assert を分離し、1つのテストが複数の無関係な失敗理由を持たないようにする。
- テスト間で DB、mock、clock、module state を共有せず、単独実行・順序変更・再実行でも同じ結果になるようにする。

失敗原因が不明な場合は、修正を重ねる前に「なぜ」を掘り下げ、再現条件、最初の不正な状態、契約違反の境界を特定する。

## 領域別の必須観点

### SRS

- good / hard / again の level、interval、due date
- level / retry 上限と JST 日付切替
- due → learn → new → retry の順序
- new limit の正規化
- empty queue の no-op と入力非破壊性
- 同一入力・同一時刻で同一結果

### Server Actions

- 未認証なら DML と external API が 0 回
- resource owner の一致 / 不一致
- Supabase error を成功へ潰さない
- session の front / back / complete 復元
- rate 後に review state、queue、次カードが整合する
- illustration ready / pending / failed / missing の contract

### Supabase / RLS / Storage

- owner は許可、別 user と anon は拒否
- public / private card の select 境界
- insert / update 時の `WITH CHECK`
- Storage path owner と signed URL
- migration / generated-like Database type / seed の整合

### UI

- loading / disabled / error / empty / complete
- Show Answer 前に答えとイラストが露出しない
- 3段階評価と次回目安
- 二重操作防止と action failure 後の復旧
- accessible name、keyboard 操作、主要 touch target

## mock 方針

- mock は Supabase / network / browser API など process 外の境界に置く。
- SRS など純粋な自作 domain logic は mock せず実装を通す。
- fluent query mock は production が使う method と戻り値を正確に表す。
- `vi.clearAllMocks()` 等で test 間の状態を隔離する。
- mock の不足を `as any` や常時成功 stub で隠さない。

## 実行

```bash
cd frontend
npm test -- path/to/file.test.ts
npm run test
npm run check
npm run build
```

変更中は対象 test を絞り、完了前に全 test と check を実行する。Next.js build でしか検出できない Server / Client 境界もあるため、route や bundling に影響する変更では build も行う。

## テスト結果の記録

- 実行 command、成功 / 失敗、未実施理由を明記する。
- AC と検証結果の対応表を残し、自動テストで覆わない条件は手動確認手順と理由を記録する。
- local Supabase、network、credential が必要で未実施なら unit test 成功と混同しない。
- UI は URL、viewport、確認した経路、console / network error の有無を記録する。
