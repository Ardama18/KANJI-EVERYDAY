# S-15: AIカード最終検証・負荷・監査・清掃

## 概要

S-15 は新しいプロダクト機能を追加する story ではない。S-10〜S-14 で実装された AIカード作成、Queue、OpenAI生成UI、Remote MCP/OAuth、AIカード管理を本番投入前に確認する最終検証 story である。

## ユーザー価値

保護者・先生が AI からカードを作成・登録する機能を有効化したとき、重複登録、quota破壊、Storage孤児、secret漏えい、MCP認証不備、rollback不能が起きないことを、実行可能なテストまたは実接続証跡で判断できる。

## スコープ

- Epic #9 の23受入条件に対する証跡棚卸し
- staging / preview / hosted Supabase / local isolated DB の検証境界の明確化
- 100 commit p95、50カード並行、24時間cleanup、secret redaction、feature flag rollback の確認
- Claude / ChatGPT live-client gate の実施または未実施状態の明記
- AIカード運用 runbook の整備

## スコープ外

- 新しいAIカード機能の追加
- 本番データを使った負荷試験
- 外部provider自身の可用性保証
- Claude / ChatGPT の実クライアント確認を mock / repo test 成功で代替すること

## 受入条件

1. Epic #9 の23受入条件に、自動テストまたは実接続証跡が対応している。
2. provider/upload を除く commit p95 が staging 100件で2秒以下、5xx が0件である。
3. 50カード並行処理で重複、quota超過、孤立objectが0件である。
4. source/upload temporary object が作成24時間以内に削除される。
5. ログ、DB、client bundle に API key、画像bytes、原文promptがない。
6. Claude / ChatGPT で OAuth、preview、commit、poll、revoke を完走する。
7. `npm run check` と既存 auth / deck / SRS / study regression が成功する。
8. feature flag 停止後に新規受付せず、再開後に既存 queue を継続できる。

## 現在の判定

現在の main には S-10〜S-14 の repo 実装と複数の hosted / local 証跡が入っている。ただし S-14 のPR本文と issue closeout は、Claude / ChatGPT live-client gate と rollback 確認を「外部 release gate」として未完了に分離している。

したがって、S-15 の完全完了判定はそれらの外部 gate 実施後に行う。現時点では `verification-report.md` を正本として、pass済み、未実施、要追加実行を分ける。
