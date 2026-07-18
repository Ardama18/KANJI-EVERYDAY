# ストーリー中心のディレクトリ構造

Git repository の `specs/` を要件・設計判断の SSOT とする。

## 標準構造

```text
specs/
├── epics/E-{NN}-{title}/
│   └── epic.md
├── stories/S-{NN}-{title}/
│   ├── meta.json
│   ├── story.md
│   ├── requirements.md
│   ├── design.md
│   ├── plan.md
│   └── tests/                 # story 固有の integration / traceability（必要時）
└── adr/
    └── ADR-{NNN}-{title}.md
```

既存の `tasks/` と `task-*.md` は旧フローの成果物として残っている。新規作業では `plan.md` を実装計画の正本とし、ユーザーが明示しない限り個別 task file を追加・更新しない。

## 各文書

- `epic.md`: 複数 story に共通する目的、scope、domain / architecture 方針
- `story.md`: user value、scope、acceptance の概要
- `requirements.md`: EARS 等で検証可能にした機能 / 非機能 / security 要件
- `design.md`: 現行調査、選択肢、責務、data flow、test strategy
- `plan.md`: implementation order、対象 file、各 phase の完了条件と command
- `meta.json`: ID、epic、status、GitHub link などの metadata
- ADR: 長期に影響する技術判断、代替案、影響、status

## ID

- story: `S-{NN}`。既存 `specs/stories/S-*` の最大番号 + 1
- epic: `E-{NN}`。既存 `specs/epics/E-*` の最大番号 + 1
- GitHub issue 番号を story / epic ID に流用しない
- ADR は既存番号に重複があるため、番号だけでなく filename、front matter の `feature`、関連 story を照合する

## Status

既存 `meta.json` の語彙をその story で優先する。新規では少なくとも `not_started`、`in_progress`、review、`completed` を一貫して使い、成果物や code と矛盾する status を機械的に更新しない。

## Traceability

`Epic → Story → Requirement / AC → Design decision / ADR → Plan phase → Code → Test`

- requirement ID がある場合は plan と test から参照する。
- scope 変更は story / requirements から下流へ反映する。
- code だけ先行した場合も、後から実装を正当化せず仕様差分を明示する。
