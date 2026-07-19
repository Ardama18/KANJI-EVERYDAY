# 設計: AIカード最終検証・負荷・監査・清掃

## 1. 設計判断

S-15 では production code を変更しない。既存の S-10〜S-14 実装を対象に、証跡の有無と検証レベルを判定する。

## 2. 検証レベル

| レベル | 用途 | 例 |
|---|---|---|
| local automated | repo内で再実行できる回帰 | `npm run check`、story-specific Vitest |
| local DB / isolated DB | migration、RLS、RPC、cleanup境界 | S-10/S-11/S-13 gate |
| hosted / preview | Supabase hosted、Vercel preview、worker/cleanup | `.codex/release-evidence.json`、S-12 hosted evidence、S-14 preview smoke |
| live client | Claude / ChatGPT 本番相当MCP接続 | OAuth、preview、commit、poll、revoke |

## 3. 証跡ポリシー

- 証跡は対象SHA、環境種別、実行日時、非機密project識別子、pass/fail、集計値だけを残す。
- secret、token、cookie、preview token、card本文、raw prompt、画像bytes、Storage path、raw provider bodyは保存しない。
- repo testやmock成功を hosted / live-client 成功へ昇格しない。
- `not_run` と `partial` を `passed` として扱わない。

## 4. 現状評価

S-10〜S-13 は repo / DB / hosted / browser の証跡が比較的揃っている。S-14 は repo実装、isolated DB、staging dry-run、Vercel preview smoke までは完了しているが、PR #25 が Claude / ChatGPT live-client gate と rollback confirmation を未完了として明記している。

そのため、S-15 の現時点の設計上の責務は次の2つである。

1. 既存証跡を集約し、どのACがpass済みかを明示する。
2. 未実施の外部release gateを runbook と evidence gate で実行可能にする。

## 5. 完了判定

S-15 を完全完了とするには、`verification-report.md` の全ACが `passed` である必要がある。本番未稼働などの理由で外部 gate を今は実行しない場合、issue #15 のスコープを「runbook/evidence tracker 作成まで」に明示変更し、未実施 gate は release block として残す。
