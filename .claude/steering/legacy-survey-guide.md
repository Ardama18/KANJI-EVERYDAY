# 既存コード調査ガイド

設計・実装前に、対象機能を次の順で横断して読む。

## 調査対象

1. `specs/stories/{対象}/` の story / requirements / design / plan / tests
2. 親 `specs/epics/` と関連 `specs/adr/`
3. `frontend/app/` の実 route と layout
4. `frontend/src/actions/` の Server Action contract
5. `frontend/src/lib/` の Supabase / SRS / date / illustration
6. `frontend/src/components/` と近接 test
7. `supabase/migrations/`、`seed.sql`、`frontend/src/types/database.ts`
8. `frontend/package.json` と test config

## 呼び出し関係

次を一本の data flow として追う。

```text
route/page
  → component/form
  → Server Action
  → auth + owner check
  → Supabase query / domain utility / external API
  → DB or Storage
  → typed result
  → UI state
```

## 再利用候補

- server / browser / middleware Supabase client factory
- auth error と profile 作成 utility
- JST date utility
- SRS calculate / classify / queue functions と types
- illustration prompt / generator / Storage utility
- deck / study component と Action result type
- story test helper と RLS actor fixture

## 高リスク領域

- auth cookie と middleware redirect
- Server Action の IDOR / owner filter
- RLS `USING` / `WITH CHECK` と Storage policy
- SRS の JST 境界、retry 上限、queue 順
- session の中断再開と複数更新の途中失敗
- Gemini key、prompt、外部 response、fire-and-forget
- migration / seed の再実行と既存 data

## 調査結果に含めること

- 再利用する既存実装
- 変更する caller / callee
- 維持すべき contract と Accepted ADR
- 既存 test と不足する回帰 test
- spec と code の不一致
- 未導入 tool / script / environment dependency
