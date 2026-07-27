# S-23 Requirements

## Functional Requirements

- **FR-01**: AIカード作成フォームはカード形式の選択肢を「読みを練習」「書きを練習」「読みと書きの両方」として表示し、送信値は既存の `GenerationPattern` のまま維持しなければならない。
- **FR-02**: AIカード作成フォームは「読みと書きの両方」を選んだ場合に、1つの漢字から2枚作ることと合計枚数が偶数になることを説明しなければならない。
- **FR-03**: AIカード作成フォームは「作成する枚数（展開後）」の代わりに、利用者が生成結果を予測できる枚数ラベルと補助文を表示しなければならない。
- **FR-04**: 教材画像入力は `source` を含む内部表現ではなく、教科書やプリントの写真を使えることが分かる日本語を表示しなければならない。
- **FR-05**: カード案一覧は各カード案を確認順に並べ、「読み練習カード」「書き練習カード」などの親向け見出しを表示しなければならない。
- **FR-06**: カード案一覧の主要見出しは `conceptId` を表示してはならない。
- **FR-07**: アップロード画像が必須のカード案では、読み書きペアで同じ画像を使うため画像が必要であることを自然な日本語で説明しなければならない。

## Non-Functional Requirements

- **NFR-01**: 変更は UI 表示、補助文、関連テストに限定し、API / schema / DB / RPC / MCP 契約を変えてはならない。
- **NFR-02**: 新しい文言は狭い画面で折り返せる通常テキストとして実装し、主要操作の touch target を維持しなければならない。
- **NFR-03**: 内部コード値はテストデータや payload contract には残してよいが、ユーザー向けラベルとして表示されないことを回帰テストで検証しなければならない。

## Acceptance Mapping

| AC | Requirements | Verification |
|---|---|---|
| AC-01 | FR-01, NFR-03 | AiCardForm markup test |
| AC-02 | FR-05, FR-06, NFR-03 | DraftCardList markup test |
| AC-03 | FR-01, FR-02, FR-03, FR-04 | AiCardForm markup test |
| AC-04 | FR-07 | DraftCardList markup test |
| AC-05 | NFR-01 | diff review, typecheck |
| AC-06 | NFR-03 | updated Vitest tests |
| AC-07 | NFR-01 | lint, typecheck |
