---
id: ADR-001
feature: project-foundation-supabase-clients
type: adr
version: 1.0.0
created: 2026-02-23
status: Accepted
based_on: specs/stories/S-01-project-scaffolding/requirements.md
related_epic: specs/epics/E-01-project-foundation-auth/epic.md
---

# ADR-001: frontend配下でのSupabaseクライアント分離と環境変数フェイルファストを採用

## ステータス

Accepted

## コンテキスト

`S-01 project-scaffolding` では、`frontend/` 配下に Next.js App Router 基盤を構築する。Supabase は `server` と `client` の実行境界が異なるため、初期化方法を誤ると以下の事故が起きる:

- SSR と CSR で `createClient` を使い分けず実行時エラーが発生
- `SUPABASE_SERVICE_ROLE_KEY` の誤露出
- テスト実行時（`NODE_ENV=test`）だけ検証を逃し、CI で後から失敗する

このストーリーは、認証ロジックを先送りしつつも、基盤として安全な Supabase 初期化を必須化する必要がある。

## 決定事項

1. Frontend は `frontend/src/lib/supabase/server.ts` に `createServerClient` を集約し、Server Components / Server Actions からのみ利用する。
2. Frontend は `frontend/src/lib/supabase/client.ts` に `createBrowserClient` を集約し、Client Component からのみ利用する。
3. `frontend/src/lib/env.ts` を新設し、環境変数は 1 箇所で検証・型安全に管理する。
4. `SUPABASE_SERVICE_ROLE_KEY` の必須検証を常時有効化し、`NODE_ENV=test` でも起動前に失敗させる。
5. `.env.local.example` にはキー名（`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`）のみを記載する。

## 根拠

### 検討した選択肢

#### 選択肢1: 全処理で `createClient` を使う
- 利点
  - 実装量が少なく、開始が早い
- 欠点
  - 実行コンテキストの責務境界が崩れ、Cookie同期やセキュリティ要件に不整合
  - `SUPABASE_SERVICE_ROLE_KEY` 運用ルールが曖昧になりやすい

#### 選択肢2: `server.ts` のみ分離し、クライアント側は固定値参照
- 利点
  - 変更コストは中程度
- 欠点
  - Client/Server 両方の責務が混在し続け、将来の認証・SSR 実装の拡張時に差分が肥大化

#### 選択肢3（採用）: `createServerClient` と `createBrowserClient` を分離し、環境検証を共通レイヤー化
- 利点
  - 実行境界と副作用（Cookie, Key 使用）が明確に分離
  - `NODE_ENV=test` を含む起動時フェイルファストで運用事故を早期検知
  - 後続ストーリー（認証、RLS、データ取得）で安全に再利用できる
- 欠点
  - 初期実装時のファイル数が増え、基盤整備コストが若干上がる

### 決定理由

- ストーリーの最上位制約は「将来の認証フロー実装前提での土台整備」であり、責務分離は後続実装への前提条件にする価値が高い。
- `.env` チェックを単一ポイント化することで、CI とローカルの挙動差を減らせる。
- テスト環境まで適用する必須チェックは、後から障害として発見されるリスクを事前に潰せる。

## 影響

### ポジティブな影響

- サーバー/クライアント用途が明確化し、秘密情報露出事故リスクを抑制できる。
- 起動時に未設定キーを即時検知するため、開発初期のリトライコストを低減できる。
- テスト・ローカル・CI の再現性が揃いやすくなる。

### ネガティブな影響

- `frontend/src/lib` 配下の初期化層が増え、最初のセットアップ作業が長くなる。
- 既存の簡易実装を置き換える場合、初期導線ルートの導入設計が必要になる。

### 中立的な影響

- 将来の Playwright/Vitest 設定方針には影響なしだが、スタブページ整備との整合が必要になる。

## 実装への指針

- 環境変数アクセスは `process.env` 直参照を禁止し、`frontend/src/lib/env.ts` 経由でのみ行う。
- `createServerClient`/`createBrowserClient` の import 先は明示し、用途外 import を禁止する lint/レビュー観点を設ける。
- `SUPABASE_SERVICE_ROLE_KEY` は未設定時に例外を throw し、エラーメッセージに不足キー一覧のみを出力する。
- `frontend/.env.local.example` には値を入れずキー名のみを記載する。

## 受入条件（EARS）

- 遍在型: システムは `frontend/src/lib/env.ts` 経由で 3 つの Supabase 環境変数を必須チェック対象として扱うこと。
- 複合型: **システムが起動フェーズ中**に、**`SUPABASE_SERVICE_ROLE_KEY` が未設定**ならば、**`NODE_ENV` が何であっても**起動時に明示的な設定エラーを例外として返すこと。
- 選択型: もし `createServerClient` が使用される場合、システムは `cookies()` ベースのサーバー向け初期化を返すこと。
- 選択型: もし `createBrowserClient` が使用される場合、システムは公開キー（`NEXT_PUBLIC_*`）のみを参照すること。
- 不測型: もし環境変数不足が発生した場合、システムは `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` の不足リストをログに出し、起動処理を停止すること。

## 参考資料

- Supabase公式: Supabase SSR ガイド（Next.js）
- Supabase公式: `@supabase/ssr` パッケージリファレンス

## 関連情報

- specs/adr/ADR-001-project-foundation-supabase-clients.md
- specs/stories/S-01-project-scaffolding/requirements.md
- specs/stories/S-01-project-scaffolding/design.md
