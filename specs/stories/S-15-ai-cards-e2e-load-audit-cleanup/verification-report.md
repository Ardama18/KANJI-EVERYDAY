# S-15 最終検証レポート

作成日: 2026-07-19
対象 issue: #15 `[AI Cards 6/6] E2E・負荷・監査・清掃`
対象 epic: #9 `AIから漢字カードを作成・登録・管理できるようにする`

## 判定サマリ

S-15 は確認専用の story であり、新規機能実装は不要である。現在の repository / PR 証跡から、S-10〜S-14 の実装は main に統合済み。ただし、S-14 のPR #25 が明示した外部 release gate は未完了であり、S-15 全体を完了扱いにするには追加実施が必要である。

| S-15 AC | 現在判定 | 根拠 | 残作業 |
|---|---|---|---|
| AC1 Epic 23条件の証跡 | partial | S-10〜S-14 の story tests、`.codex/release-evidence.json`、S-12 hosted evidence、PR #23/#25 | 全23条件を1枚の inventory に束ねる |
| AC2 staging 100 commit p95 <= 2s / 5xx 0 | not_run_for_s15 | S-11 hosted real-e2e は commitMs 785ms の単発証跡あり | S-15として100件staging計測を実施 |
| AC3 50カード並行、重複/quota/orphan 0 | partial | S-10/S-11/S-13 のDB・Queue・cleanup系テストあり | S-15として50カード並行サマリを記録 |
| AC4 24時間temporary cleanup | passed_inherited | `.codex/release-evidence.json` hosted gates、S-11 accepted state | S-15 inventory へ継承証跡として束ねる |
| AC5 secret / image bytes / raw prompt redaction | partial | `.codex/release-evidence.json` secretScans、S-12 hosted redaction、PR #25 secret scan | S-15対象差分とruntime log/bundle scanを追加 |
| AC6 Claude / ChatGPT live-client flow | not_run | PR #25 と issue #11 closeout が未完了外部gateとして明記 | Claude と ChatGPT で実接続を実施 |
| AC7 `npm run check` と既存回帰 | partial | PR #25: 83 files / 947 tests passed、PR #23: 64 files / 835 passed | S-15 branch上で再実行 |
| AC8 feature flag stop/restart rollback | partial | S-12 hosted E2E flag off、S-14 PRにrollback未完了明記 | UI/MCP/worker/DCR/grant-token境界の統合rollback確認 |

## 既存の主要証跡

- S-10 DB/RLS/import foundation: PR #16、issue #9進捗コメント。
- S-11 Queue/image/cleanup: `.codex/release-evidence.json`、S-11 `meta.json` state `accepted_hosted_7_passed`。
- S-12 OpenAI UI: `specs/stories/S-12-ai-card-openai-generation-ui/tests/hosted-e2e-evidence.json`、S-12 `meta.json` state `s11_hosted_7_passed_s12_hosted_e2e_7_passed_ready_to_merge`。
- S-13 AI card management / undo: PR #23。local check、isolated DB gate、browser QA、gitleaks passed。
- S-14 Remote MCP/OAuth: PR #25。repo tests、isolated DB、staging migration dry-run、Vercel preview smoke passed。

## ブロッカー

以下は S-15 issue 本文の受入条件に含まれるが、現在の repo 証跡だけでは完了と言えない。

1. Claude live-client gate。
2. ChatGPT live-client gate。
3. staging 100 commit p95 / 5xx 0 のS-15専用計測。
4. flag、DCR、grant/token revoke、worker継続をまたぐ統合 rollback 確認。

これらを実施しないまま #15 を閉じる場合は、「本番未稼働のため S-15 は release gate runbook / evidence tracker 作成で完了」と issue 側でスコープ変更を明記する。

## 推奨次アクション

1. `docs/runbooks/ai-card-import.md` の手順に従って、S-15 の外部 gate を実行する。
2. 実行結果を機密情報なしで本ファイルまたは dedicated evidence JSON に追記する。
3. すべて `passed` になった時点で issue #15 を close する。
