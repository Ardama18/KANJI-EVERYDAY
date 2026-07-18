# チェックシート規約

QA チェックシートは対象 story の `specs/stories/{STORY_ID}-{title}/` 配下に置き、requirements の受入条件へ trace できるようにする。

## ファイル名

- 機能: `{story-id}-functional-check-sheet.md`
- 非機能: `{story-id}-non-functional-check-sheet.md`
- セキュアコードレビュー: `{story-id}-secure-code-review.md`
- 実施結果: `{story-id}-qa-report.md`

既存 story に異なる命名の traceability 文書がある場合は、無理に重複作成せず役割を確認する。

## 必須列

| 列 | 内容 |
|---|---|
| ID | story 内で一意 |
| Requirement / AC | `requirements.md` の参照 |
| 観点 | 何を保証するか |
| 前提条件 | actor、data、env、viewport |
| 手順 | 再現可能な操作 |
| 期待結果 | 観測可能で一意な判定 |
| 結果 | Pass / Fail / Blocked / Not Run |
| 証跡 | test、log、capture 等。secret を含めない |
| 備考 | blocker、issue、未検証理由 |

## 必須観点

- happy path、empty、error、boundary、reload、retry、二重操作
- authenticated owner、other user、anonymous
- RLS / Storage / Server Action の境界
- mobile / desktop、keyboard、focus、overflow、touch target
- Show Answer 前後の情報露出
- JST 日付境界と SRS queue / retry
- Gemini pending / failed / malformed response

自動 test の名前だけで Pass にせず、その test が real browser / DB / external API のどこまで検証したかを証跡へ書く。
