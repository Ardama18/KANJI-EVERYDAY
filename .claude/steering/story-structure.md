# ストーリー中心のディレクトリ構造ガイド

## 概要

AI駆動開発における最適化されたディレクトリ構造を定義します。Gitリポジトリを唯一の情報源（SSOT）とし、開発効率を最大化します。

## ディレクトリ構造

```
specs/
├── stories/{STORY_ID}-{title}/  # 例: S-34-user-authentication
│   ├── meta.json                # ストーリーメタ情報（必須）
│   ├── story.md                 # ストーリー定義（要件概要・機能詳細）
│   ├── requirements.md          # 要件定義書（必須、AIが生成）
│   ├── design.md                # 設計書（必須、AIが生成）
│   └── tasks/                   # タスク一覧（Gitでは管理しない）
│
├── epics/{EPIC_ID}-{title}/     # 例: E-7-authentication-system
│   └── epic.md                  # エピック全体のアーキテクチャ方針
│
└── adr/                         # 技術的意思決定記録（通し番号）

```

## 各ディレクトリの役割

### `specs/stories/{STORY_ID}-{title}/`

**目的**: ストーリー単位で関連ドキュメントを集約

**配置ファイル**:
- `meta.json`: ストーリーメタ情報（ID、エピック、ステータス等）（必須）
- `story.md`: ストーリー定義（エピック分解時に生成される要件概要・機能詳細）
- `requirements.md`: 要件定義書（AIが生成）
- `design.md`: 設計書（AIが生成）

**命名規則**: `{STORY_ID}-{title}` 例: `S-34-user-authentication`

**親子ストーリーの概念**:
- ストーリーのスコープが大きすぎる場合、親ストーリーを複数の子ストーリーに分割できます
- 子ストーリーは独立したストーリーディレクトリとして作成されます
- 親子関係は`meta.json`の`parent_story_id`フィールドで管理されます
- 親ストーリーの`requirements.md`および`design.md`には「## 子ストーリー」セクションが追加され、子ストーリーへのリンクが記載されます

### `specs/epics/{EPIC_ID}-{title}/`

**目的**: エピック全体の技術方針を記録

**配置ファイル**: `epic.md` - エピック全体のアーキテクチャ方針、技術スタック、共通設計方針

**epic.mdに記載する内容**:
- ✅ 技術スタック、共通設計方針、セキュリティ要件、パフォーマンス要件、関連ADR
- ❌ 管理情報（ステータス、進捗率、担当PM、スケジュール）

**命名規則**: `{EPIC_ID}-{title}` 例: `E-7-authentication-system`

### `specs/adr/`

**目的**: プロジェクト全体の技術的意思決定を記録

**命名規則**: `{num}-{title}.md` 例: `001-story-centric-directory-structure.md`（ストーリーIDは含めない）

**記載内容**: 背景（Context）、決定内容（Decision）、影響（Consequences）、代替案（Alternatives）

## ID採番ルール

### ストーリーID
- プレフィックス: `S-`
- 採番方法: `specs/stories/S-*` ディレクトリをスキャンし、最大番号+1
- 例: 既存が S-33 まであれば、次は S-34

### エピックID
- プレフィックス: `E-`
- 採番方法: `specs/epics/E-*` ディレクトリをスキャンし、最大番号+1

## Gitが「正」とする情報（SSOT原則）

すべての開発情報はGitリポジトリで一元管理します。

| 情報 | 保存場所 | 更新タイミング |
|------|---------|---------------|
| ストーリー定義 | `story.md` | エピック/ストーリー分解時 |
| 要件詳細 | `requirements.md` | 要件分析時 |
| 設計書 | `design.md` | 技術設計時 |
| ADR | `specs/adr/` | 技術決定時 |
| epic.md（技術方針） | `specs/epics/*/epic.md` | エピック作成時 |
| ストーリーメタ情報 | `meta.json` | 各フェーズ完了時 |
| コード | Git | 実装時 |

### meta.json フォーマット

```json
{
  "story_id": "S-34",
  "epic_id": "E-2",
  "parent_story_id": "",
  "status": "not_started",
  "github_pr_url": "",
  "github_branch": ""
}
```

**フィールド説明**:
| フィールド | 説明 | 更新タイミング |
|-----------|------|---------------|
| `story_id` | ストーリーID | 作成時 |
| `epic_id` | 所属エピックID | 作成時 |
| `parent_story_id` | 親ストーリーID（子ストーリーの場合） | 作成時 |
| `status` | ステータス（not_started / in_progress / design_review / impl_review / done） | 各フェーズ完了時 |
| `github_pr_url` | PRのURL | PR作成時 |
| `github_branch` | ブランチ名 | 実装開始時 |
