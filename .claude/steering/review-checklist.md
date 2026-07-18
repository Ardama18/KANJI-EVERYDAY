# レビューチェックリスト

## 仕様

- 対象 story / requirements / Accepted ADR と一致しているか
- 古い epic や別プロジェクトの前提を採用していないか
- scope 外の refactor や依存追加を混ぜていないか

## 正しさ

- empty、error、retry、reload、並行 / 二重操作を扱っているか
- JST date と timestamp を区別しているか
- SRS queue 順、retry 上限、進捗契約を維持しているか
- server state と UI state が失敗時に乖離しないか

## セキュリティ

- Action の認証・owner check・入力検証が副作用前にあるか
- RLS / Storage policy と application filter が整合するか
- secret / token / signed URL / PII が client や log に漏れないか
- reveal 前に答えやイラストを取得・表示していないか

## DB / 外部境界

- migration、RLS、Database 型、seed、tests を同時更新したか
- Supabase error を握りつぶしていないか
- Gemini timeout / malformed response / key missing が安全に劣化するか
- private object path と signed URL expiry が契約どおりか

## UI / UX

- loading / disabled / empty / error / complete が明確か
- 主要操作が mobile で 48px 以上か
- keyboard、focus、accessible name、色以外の情報があるか
- 長い日本語と狭い viewport で崩れないか

## テストと運用

- 回帰 test が観測可能な contract を検証しているか
- mock が production boundary と一致するか
- skip / only / 弱い assertion がないか
- 実行 command と未検証範囲が明記されているか
