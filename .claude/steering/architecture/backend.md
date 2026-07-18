# Backend アーキテクチャ（Next.js Server + Supabase）

本プロジェクトに独立した `backend/` はない。ここでいう Backend は、Next.js の Server Components / Server Actions と Supabase の組み合わせを指す。

## 技術スタック

- Next.js 14 App Router
- Server Actions
- Supabase Auth / PostgreSQL / Storage
- Gemini REST API（イラスト生成のみ）
- TypeScript / Vitest

## 配置

```text
frontend/src/actions/
├── auth-actions.ts
├── deck-actions.ts
├── session-actions.ts
└── illustration-actions.ts
frontend/src/lib/
├── auth/
├── illustration/
├── srs/
└── supabase/
```

## Server Action の契約

すべての Server Action は外部入力境界として次を満たす。

1. `'use server'` 境界を明示する。
2. セッションから利用者を取得し、未認証なら副作用前に終了する。
3. ID、FormData、rating などを実行時に検証する。
4. 対象行を `user_id` / `owner_user_id` で絞り、所有権を確認する。
5. Supabase のエラーを握りつぶさず、UI に安全な形へ変換する。
6. 戻り値の union / type を明示し、UI が文字列解析に依存しないようにする。

RLS は最終防衛線だが、Action 内の認証・所有権検証の代替ではない。

## Supabase client の使い分け

- Server Component / Server Action: `frontend/src/lib/supabase/server.ts`
- Client Component: `frontend/src/lib/supabase/client.ts`
- middleware: `frontend/src/lib/supabase/middleware.ts`
- service role: owner scoped な通常 CRUD には使用しない。イラスト生成・Storage 保存など、Action で認証と所有権を確認した後の隔離された server-only 処理に限定する

server-only secret を `NEXT_PUBLIC_` で定義しない。server client を Client Component から import しない。

## ドメインロジック

- SRS の計算・分類・queue 操作は `src/lib/srs` の純粋関数へ置く。
- Action は認証、DB I/O、ドメイン関数の呼び出し、結果の永続化を調整する。
- 時刻依存値は注入し、JST 日付ユーティリティを経由する。
- 学習セッションの更新順は Accepted ADR に従う。特に `rateCard` は review state、queue、次カードの整合を崩さない。

## 外部 AI / Storage

- Gemini は `frontend/src/lib/illustration/gemini-client.ts` に隔離する。
- API key 未設定や外部失敗は安全に `failed` へ遷移させ、学習要求は継続可能にする。
- Storage bucket は private。object path は `{user_id}/{illustration_id}.png`。
- Signed URL は server で短時間だけ発行する。
- prompt や model info に secret、メール、user ID など不要な個人情報を含めない。

## テスト

- Action: Supabase client と外部 API を境界で mock し、未認証・所有権・失敗・成功を検証する。
- SRS: 固定時刻と固定入力で純粋関数の境界値・非破壊性を検証する。
- RLS / Storage policy: SQL またはローカル Supabase を使う integration test で別ユーザー拒否を検証する。
