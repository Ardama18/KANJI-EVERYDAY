# 技術設計ルール

## 正本と前提確認

- version / script: `frontend/package.json`
- schema / policy: `supabase/migrations/*.sql`
- architecture decision: Accepted ADR
- feature contract: story の `requirements.md`
- 実 route / module: 現在の source tree

設計文書へ存在しない package、script、service、directory を書かない。

## 設計時に明示する境界

1. Server Component と Client Component の分割
2. Server Action の入力、認証、所有権、戻り値、エラー
3. Supabase table / RLS / Storage への影響
4. JST date と absolute timestamp の扱い
5. SRS / queue の不変条件と再開可能性
6. external Gemini failure 時の劣化動作
7. unit / integration / UI verification の検証範囲

## 環境変数

環境変数は `frontend/src/lib/env.ts` を入口とし、起動時または利用境界で fail-fast に検証する。

- browser 公開可: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- server only: `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`

server-only 値に `NEXT_PUBLIC_` を付けない。値そのものを docs、test fixture、ログへ記録しない。

## データフロー

- read は Server Component を優先する。
- mutation は Server Action に集約する。
- browser から Supabase を利用する場合は RLS 前提のユーザー権限に限定する。
- DB row、Storage object、signed URL の owner 境界を揃える。
- 学習 UI の一時 state と `study_sessions` の永続 state を区別する。

## 変更判断

次は ADR を作成または更新する。

- 認証 / 認可境界の変更
- schema、RLS、Storage policy の非互換変更
- SRS の評価規則、queue 順、日付基準の変更
- セッション正本や更新順序の変更
- external provider / dependency / async 実行方式の変更
- 学習表面に答えのヒントとなる情報を出す変更

## 完了基準

- requirement と implementation の traceability が説明できる。
- error / empty / pending / retry / unauthorized の経路を検討している。
- `npm run check` を通し、必要に応じて `npm run build` と実 UI を確認している。
- DB 変更は policy / type / seed / tests を含めて整合している。
