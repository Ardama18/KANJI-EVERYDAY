# AI 開発者ガイド

## 作業開始時

1. `AGENTS.md` と対象階層の指示を読む。
2. `git status` で user の既存変更を把握し、未関連変更を巻き戻さない。
3. 対象 story、親 epic、Accepted ADR を読む。
4. `frontend/package.json`、source tree、近接 test で現行構成を確認する。
5. caller → boundary → persistence → result の data flow を追う。

別 repository の記憶や一般的な最新 version より、この repository の実 code と Accepted decision を優先する。

## 技術判断

### Fail-fast と劣化動作

- auth、owner、required env、schema contract の違反は副作用前に失敗させる。
- illustration provider failure は placeholder へ劣化させ、学習を止めない。
- fallback は要件に根拠がある場合だけ使い、原因を空配列・`null`・成功 response へ潰さない。

### Rule of Three

- 1回目は局所実装、2回目は比較、3回目で安定した共通性があるとき抽象化を検討する。
- auth / owner / env の security boundary は回数に関係なく既存の共通 utility を優先する。
- 形が似ていても domain の意味や変更理由が違うものは統合しない。

### 最小変更

- 要求を満たす最小の責務範囲を変更する。
- feature fix と package upgrade、全体 rename、format を同時に行わない。
- 新規 dependency / layer / service は既存構成で解けない根拠を示す。

## プロジェクト固有の赤信号

- server secret または server client を Client Component へ import する。
- middleware があることを理由に Action の認証を省く。
- owner filter なしで client supplied ID を query する。
- migration だけ変更して RLS / Database type / seed / test を放置する。
- `new Date()` を SRS 純粋関数の内部で呼び JST 境界を暗黙化する。
- session queue を mutate し、retry / reload 後だけ壊れる状態を作る。
- reveal 前に back text / illustration URL を client へ渡す。
- Gemini 呼び出しを rating / study response と同期させる。
- 実在しない script、Playwright、独立 backend、CDK を前提にする。
- `*.e2e.test.*` という名前だけで real browser E2E 済みと報告する。

## デバッグ手順

1. 期待 contract と実際の症状を一文で固定する。
2. 最小再現 test または手順を作る。
3. error の最初の自 project frame と boundary response を読む。
4. input、auth actor、owner ID、JST date、session state を機密情報なしで確認する。
5. 仮説を一つずつ検証し、同じ失敗を無変更で繰り返さない。
6. 根本原因へ回帰 test を置いてから修正する。

### 領域別の切り分け

- auth loop: middleware、server client cookie、route protection、redirect target
- Supabase query: actor、RLS、owner filter、nullable / error result
- SRS: fixed `today` / `now`、input mutation、queue category、retry count
- illustration: env、sanitized prompt、HTTP status / payload、Storage upload、row transition
- UI: server props、client state、pending、double submit、console / network

## 品質コマンド

実際の script は `frontend/package.json` を確認し、`frontend/` で実行する。

```bash
npm run lint
npm run typecheck
npm run test
npm run check
npm run build
```

- 変更中: 対象 test
- 実装完了: `npm run check`
- route / Server-Client 境界 / env / bundling 変更: `npm run build` も実行
- UI 変更: 実ブラウザで mobile / desktop と主要 state を確認
- migration / RLS: 隔離した Supabase 環境が利用可能なら actor 別 integration test

存在しない coverage / E2E / cleanup script を推測で実行しない。

## 完了報告

- 何を変更し、どの contract を守ったか
- 変更 file
- 実行した command と結果
- real DB / browser / Gemini など未検証の範囲
- migration、data、security、cost に関する残課題

テスト未実施を「問題なし」と表現せず、理由と代替確認を明記する。
