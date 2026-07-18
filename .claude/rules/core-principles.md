# 共通原則（KANJI-EVERYDAY）

AI エージェントが「まいにち漢字」を変更するときの常時適用ルール。詳細は `.claude/steering/` を正本とし、このファイルへ別プロジェクト固有の構成を複製しない。

## 実装原則

- `AGENTS.md` と `.claude/steering/rules-index.yaml` から対象領域の文書を選ぶ。
- 仕様は Accepted ADR、対象 Story の requirements、story、design、plan の順で確認する。
- 実際のバージョンと利用可能なコマンドは `frontend/package.json` を正本とする。
- 変更は最小差分とし、既存の未関連変更を巻き戻さない。
- Server Action では認証と所有権を検証し、RLS を最終防衛線として併用する。
- server-only secret を Client Component やブラウザ用モジュールから参照しない。
- DB 変更は migration、RLS、Storage、Database 型、seed、テストを一体で扱う。
- 不具合修正では再現テストを先に追加し、受入条件とテストの対応を記録する。
- シークレット、個人情報、認証済みデータをコード、ログ、文書、画像へ含めない。

## 標準品質ゲート

リポジトリルートから次を実行する。

```bash
npm --prefix frontend run check
```

ルーティング、Server/Client 境界、環境変数、production bundling に影響する場合は追加で実行する。

```bash
npm --prefix frontend run build
```

Playwright、Jest、Prisma、NestJS、AWS CDK、npm workspaces は現時点で導入されていない。存在確認なしに計画やコマンドへ含めない。

## 停止・確認が必要な変更

- schema、migration、RLS、Storage policy、認証境界の変更
- 既存データを削除・変換する操作
- 外部依存、環境変数、secret、外部 API 契約、利用料金の変更
- production deploy、remote migration、force push
- 仕様上の優先順位を安全に決められない不一致

詳細は `.claude/steering/implementation-flow.md` と `.claude/steering/security-standards.md` を参照する。
