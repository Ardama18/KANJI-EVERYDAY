# インフラストラクチャ運用方針（legacy filename）

> このファイル名は参照互換のため残している。KANJI-EVERYDAY は AWS CDK を使用していない。現行インフラは Vercel + Supabase であり、CDK construct、stack、IAM、CloudFormation の規約を適用しない。

## 現行の管理対象

- Vercel: Next.js application の build / hosting / server runtime
- Supabase Auth: email/password 認証と session
- Supabase PostgreSQL: schema、constraint、RLS
- Supabase Storage: private `illustrations` bucket と policy
- Gemini API: server-only image generation dependency

## Infrastructure as Code の正本

- DB / function / trigger / RLS: `supabase/migrations/*.sql`
- Storage bucket / policy: SQL migration
- seed: `supabase/seed.sql`
- frontend env contract: `frontend/.env.local.example` と `frontend/src/lib/env.ts`
- application build contract: `frontend/package.json`

Dashboard で行った恒久設定は再現可能な migration / document へ反映する。remote dashboard の状態だけを正本にしない。

## 変更原則

- 適用済み migration を編集せず、新しい migration を追加する。
- project ref と対象環境（local / preview / production）を適用前に明示する。
- production migration、reset、secret 変更、deploy は明示的な承認なしに行わない。
- RLS を無効化することで開発を進めない。
- Vercel と Supabase の env を環境ごとに分離し、preview が production DB を誤参照しないようにする。
- secret は repository、build log、client bundle に含めない。

## Stateful change

schema / policy / storage は stateful である。変更計画には次を含める。

- forward migration
- 既存 data への影響と backfill
- lock / rewrite / downtime risk
- application との適用順
- rollback または forward-fix 方針
- owner / anon / cross-user の権限検証

## Deploy checklist

- [ ] `frontend/package.json` の check / build が成功
- [ ] migration の対象環境と差分を確認
- [ ] RLS / Storage policy の allow / deny test を確認
- [ ] public / server-only env の分類を確認
- [ ] preview と production の Supabase 接続先を確認
- [ ] Auth redirect URL / cookie / middleware を確認
- [ ] Gemini key 未設定時も学習が継続することを確認
- [ ] deploy 後に login → decks → study → reveal → rate を smoke test
- [ ] console / server log に secret や signed URL がないことを確認
