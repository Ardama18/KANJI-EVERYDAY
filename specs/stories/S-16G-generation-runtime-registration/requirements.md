# S-16G Requirements

Issue: #53 / Epic: E-16 / 規模: 小（seam 配線 + 回帰テスト）

## 背景・本質

`illustration-generation-runtime.ts` の `runProcessIllustrationGeneration` が呼ぶ実装の
default が **no-op** で、実生成ロジック `processIllustrationGeneration`（`generator.ts`）は
テスト用 setter 経由でしか差し込まれない。本番 server 実行時に実ロジックへ到達させる。

引数 shape・依存注入・承認判定・fire-and-forget・生成起動制御は S-08 / S-16E で実装済み。
本ストーリーは **seam の本番配線のみ** をスコープとする。

## 受入条件（測定可能）

| ID | 条件 | 検証手段 |
|---|---|---|
| AC-1 | 本番 server 実行時、承認済み slots で trigger → 実 `processIllustrationGeneration` が呼ばれ、Gemini → storage → `illustrations.status='ready'` まで到達（no-op でない） | 単体（generator を mock し、本番 default 経路で呼ばれることを検証）＋依存モックの統合 |
| AC-2 | 未承認 illustration_key では生成が起動しない（S-16E 挙動不変） | 既存 `illustration-actions.test.ts` の該当ケースが green のまま |
| AC-3 | server-only secret（`SUPABASE_SERVICE_ROLE_KEY` / `GEMINI_API_KEY`）がブラウザバンドルへ露出しない | `build` 成功（server-only 境界違反は build エラー化）＋ `.next` client chunk に generator/service-role シンボル・secret env 非混入を確認 |
| AC-4 | テスト差し替え機構（`__set/__reset...ForTest`）が引き続き機能 | runtime 回帰テスト（set 上書き / reset 復元）＋既存 action テスト green |
| AC-5 | `npm --prefix frontend run check` と `npm --prefix frontend run build` 通過 | CI/ローカル実行 |

## 対象外（Out of Scope）

- 旧 ready 画像の一括再生成。
- プロンプトテンプレ・slots スキーマ・承認 UI・答え側表示（S-16B〜F 対応済み）の変更。
- schema / migration / RLS / Storage policy / 認証境界の変更（本ストーリーでは一切なし）。

## 制約・不変条件

- Browser 用と Server 用の Supabase client を混在させない。
- server-only secret を Client Component / ブラウザ用モジュールから参照しない。
- 最小差分。既存の fire-and-forget 挙動・失敗時 `model_info` 記録・status 遷移を踏襲。
