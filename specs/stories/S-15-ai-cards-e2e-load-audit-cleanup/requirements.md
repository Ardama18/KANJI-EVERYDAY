# 要件定義: AIカード最終検証・負荷・監査・清掃

## 方針

S-15 は確認専用である。プロダクト機能を追加せず、S-10〜S-14 の既存機能が Epic #9 の受入条件を満たしているかを、実行可能なテストまたは本番相当証跡で判定する。

## Must

- REQ-1: Epic #9 の23受入条件を、既存テスト、既存PR証跡、S-15追加証跡のいずれかへ対応付ける。
- REQ-2: staging で provider/upload を除く commit 100件の p95 と 5xx 件数を記録する。
- REQ-3: 50カード並行または同等の高負荷条件で、重複、quota超過、孤立Storage objectが0件であることを確認する。
- REQ-4: temporary source/upload object が24時間境界で清掃され、active reference を削除しないことを確認する。
- REQ-5: source、logs、DB、client bundle、evidence に API key、token、cookie、画像bytes、raw prompt、card front/back、provider raw body を残さない。
- REQ-6: Claude と ChatGPT の本番相当クライアントで OAuth discovery、DCR、consent、preview、commit、poll、revoke、revoke後401を確認する。
- REQ-7: `frontend/` の `npm run check` と必要な story-specific regression gate を実行する。
- REQ-8: feature flag、MCP flag、DCR、grant revoke、worker停止/再開の rollback / restart を確認する。

## Won't

- 新しいDB schema、Route、UI、MCP toolを追加しない。
- 実クライアント未確認を mock 成功で代替しない。
- 本番データを負荷試験に使わない。
- secret 実値や教材画像本文を証跡へ保存しない。

## 完了条件

`verification-report.md` の全S-15 ACが `passed` になること。ただしユーザーが「本番未稼働のため runbook/evidence tracker 作成まで」と明示した場合は、そのスコープ変更を issue コメントへ残し、未実施 gate を未完了として維持したままこのPRを完了できる。
