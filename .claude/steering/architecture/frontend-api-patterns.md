# フロントエンドからサーバーを呼び出すルール

## 基本方針

本プロジェクトのアプリケーション更新境界は Next.js Server Actions。独立した NestJS API や汎用 `/api` client は存在しない。Supabase をブラウザから直接操作する場合も、公開 anon key + RLS の範囲に限定する。

## 推奨パターン

| 用途 | パターン |
|---|---|
| ページ初期読込 | Server Component から server client / read Action |
| form mutation | `<form action={serverAction}>` または Client Component から Server Action |
| 学習中の操作 | typed Server Action を呼び、次状態を同一レスポンスで受け取る |
| 認証セッション更新 | Supabase SSR client + middleware |
| 外部 Gemini 呼び出し | server-only library 経由。ブラウザから直接呼ばない |

## Action 実装順序

```text
parse input
  → authenticate
  → authorize owner/resource
  → execute domain logic
  → persist
  → return typed result / revalidate or redirect
```

- DB や外部 API の前に認証と入力検証を終える。
- `deckId`、`sessionId`、`cardId` は client が渡した値だけで信用しない。
- mutation 後のキャッシュ更新が必要なら `revalidatePath` または redirect を意図的に選ぶ。
- redirect などフレームワーク制御例外を通常エラーとして握りつぶさない。

## 戻り値とエラー

- 認証フォームのような想定内エラーは discriminated union または明示型で返す。
- インフラ障害や契約違反はログに安全な context を残して失敗させる。
- Supabase / Gemini の生エラー、SQL、secret、内部 object path をそのまま利用者へ表示しない。
- 空結果と通信失敗を同じ `null` に潰さない。仕様上 `null` が契約の場合はテストで固定する。
- deck、tag、illustrationなど既存relationを置換する選択肢の取得失敗を空集合へ変換しない。明示的なerrorと再試行を表示し、誤って全解除し得るmutationを無効化する。
- mutation成功後に一覧や選択肢の再取得が失敗した場合は、成功表示だけを残さない。server stateと`updatedAt`を再同期できるまで追加mutationを停止し、再取得操作を提供する。

## テスト

- Supabase client factory、`auth.getUser()`、query builder、Storage、`fetch` を外部境界で mock する。
- 未認証時に DML / 外部 API が 0 回であることを検証する。
- owner 外 ID、存在しない ID、Supabase error、二重送信・再実行可能性を含める。
- mock は production の chain と戻り値を過不足なく表現し、`as any` で契約不整合を隠さない。
- 選択肢取得失敗時のrelation不変、mutation後再取得失敗時の追加操作停止、再同期成功後の復旧を検証する。
