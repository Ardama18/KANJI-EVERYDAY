---
id: ADR-005
feature: study-session-flow
type: adr
version: 1.0.0
created: 2026-02-24
status: Accepted
based_on: specs/stories/S-07-study-session-flow/requirements.md
related_epic: specs/epics/E-02-core-study-flow/epic.md
---

# ADR-005: Study Session Flow の状態遷移を Server Actions 主導で統合する

## ステータス
Accepted

## コンテキスト
S-07 では、S-05 の SRS ロジックをセッション進行（開始・表面・裏面・評価・完了）に接続し、
中断再開を含む学習体験を一貫した契約で提供する必要がある。

主要論点:
1. 学習状態をクライアントのみで持つか、DBセッションを単一ソースにするか
2. 再開時の表示復元（front/back）をどこで判定するか
3. 進捗 total/remaining を retry 再提示とどう分離するか
4. `rateCard` での state 更新順序と一貫性担保をどうするか

## 決定事項
1. セッション状態の単一ソースは `study_sessions` とし、Server Actions からのみ更新する。
2. 学習画面初期化は `getStudySessionState` で行い、`current_card_id` と `revealed` から front/back/complete を判定する。
3. `progress.total/remaining` はユニークカード基準とし、retry は total に加算しない。
4. `rateCard` は ReviewState UPSERT → queue更新 → 次カード決定の順に実行し、次カードを同一レスポンスで返す。
5. イラストは S-07 では常に `illustrationUrl=null` を返し、UIはプレースホルダを表示する。

## 根拠
- DBセッション主導にすると離脱/再開時の再現性が高く、複数画面遷移でも状態が失われない。
- 初期化ロジックを Server Action に集約すると、page.tsx から条件分岐が明確になりテスト可能性が高い。
- retry を進捗に含めないことで、学習者の「今日の対象ユニーク枚数」と表示が一致する。

## 影響
### ポジティブ
- 中断再開時に `revealed=true` の裏面復帰が安定する。
- `StudyClient` は UI遷移に専念し、データ整合の責務を持たない。

### トレードオフ
- `rateCard` は複数クエリ更新のため、真のDBトランザクションではない。
- ただし本ストーリーでは「同等の原子処理」方針として順序を固定し、失敗時は例外で処理を止める。

## 受入条件（EARS）
- 契機型: `startStudySession` 呼び出し時、システムは既存アクティブセッションを再利用する。
- 契機型: `getStudySessionState` 呼び出し時、システムは `revealed` に応じて front/back/complete を返す。
- 契機型: `rateCard` 呼び出し時、システムは次カードを同一レスポンスで返し追加取得を不要にする。
- 遍在型: システムは S-07 で `illustrationUrl` を常に `null` とする。

## 参考
- specs/stories/S-07-study-session-flow/requirements.md
- specs/stories/S-05-srs-engine/design.md
