# ドキュメント作成基準

文書は量ではなく、将来の実装者が scope、contract、判断理由、検証方法を再現できることを目的とする。配置は `story-structure.md` に従う。

## 作成判定

| 変更 | 必須成果物 |
|---|---|
| 小さな bug / 1〜2 file の局所変更 | 既存 story / issue と回帰 test。必要なら簡易 plan |
| 3〜5 file、複数境界 | story / requirements の確認、design、plan |
| 6 file 以上または新機能 | story、requirements、design、plan |
| schema / RLS / auth / SRS contract / external provider の判断変更 | 上記 + ADR |
| 既存 Accepted ADR の範囲内の実装 | 新規 ADR は不要。該当 ADR を参照 |

file 数は目安。data loss、cross-user access、secret、外部費用、学習 contract に影響する場合は文書レベルを引き上げる。

## Epic

複数 story に共有される次を記載する。

- 背景、目的、対象 user
- in scope / out of scope
- domain model と共通 architecture
- security / performance / UX の横断要件
- story 一覧と依存順

個別実装手順や日々の進捗は書かない。

## Story

- user value と解決する課題
- in scope / out of scope
- 前提と依存
- 観測可能な acceptance criteria
- related epic / ADR

1 story は独立して検証可能な user value を持つ粒度にする。

## Requirements

- Must / Should / Could / Won't
- actor、trigger、input、output、error / empty / retry
- security / privacy / performance / accessibility
- data retention、JST boundary、external failure（該当時）
- requirement ID と測定可能な acceptance criteria
- MVP と Future の境界

solution の詳細は Design へ分離する。曖昧な「適切に」「必要に応じて」「高速に」は判定値または具体的な挙動へ変える。

## ADR

### 作成条件

- Supabase client / auth / owner boundary の変更
- schema、RLS、Storage policy の構造的・非互換変更
- SRS algorithm、JST date、queue / session 正本の変更
- Server Action 以外の API / backend 境界の導入
- Gemini provider、SDK、async job 基盤、公開 Storage の導入
- package / framework の重要な追加・置換

### 内容

- status、context、decision
- 現実的な選択肢と比較（数合わせの3案は不要）
- decision reason と trade-off
- positive / negative impact
- migration / security / test strategy
- supersedes / related story

既存 ADR を変更する場合は履歴を消さず、Superseded または新 ADR で関係を明示する。現在は ADR-004 の番号重複があるため feature と filename も識別に使う。

## Design Document

最低限次を含める。

1. 現行調査と再利用する code
2. scope と non-goal
3. 選択した実装 approach と責務境界
4. Server / Client / Action / Supabase / external の data flow
5. interface / type / schema / state transition
6. auth、owner、RLS、secret、failure handling
7. impact map（直接 / 間接 / 非影響）
8. requirement ごとの test strategy（L1 / L2 / L3）
9. rollout、migration、rollback / forward-fix（該当時）
10. unresolved question

diagram は3つ以上の component / state / step の関係を文章より明確にできる場合に使う。形式だけの図を必須にしない。

## Plan

`plan.md` は実装の単一情報源とし、依存順の phase に分ける。

各 phase に次を記載する。

- 対象 requirement / design section
- 変更 file と変更内容
- 先行 dependency
- implementation の完了条件
- test / verification command と期待結果
- security / data / external risk

最後に全体の `npm run check`、必要な build、UI / Supabase 検証を置く。存在しない tool や script は書かない。新規個別 `tasks/` file は作らない。

## 更新規則

- requirement 変更は story → requirements → design → plan → tests の順で同期する。
- 実装中に前提が崩れた場合は plan だけを黙って変更せず、上流文書へ戻す。
- code と docs の不一致を見つけたら、どちらが正本かを優先順位で判断し差分を記録する。
- 実装完了時に status、test result、未検証範囲を更新する。
