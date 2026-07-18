# 実装アプローチ選択ルール

Design Doc と `plan.md` では、変更特性に応じて Vertical Slice、Horizontal Layering、Hybrid を選び、各段階の検証を明示する。

## 1. 変更特性

| 観点 | KANJI-EVERYDAY での確認 |
|---|---|
| UI | route / Server Component / Client Component / state |
| server | Server Action、auth、owner check、error contract |
| domain | SRS、JST date、session queue、illustration state |
| data | migration、RLS、Storage、Database type、seed |
| external | Supabase / Gemini / Vercel と secret / cost |
| risk | cross-user 漏洩、data loss、学習中断、answer leak |

## 2. 戦略

### Vertical Slice

page → component → Action → data → test を一つの user behavior 単位で通す。独立して確認できる UI / use case に使う。

### Horizontal Layering

migration / domain contract → Action → UI の順に積む。上位層が schema や SRS contract に強く依存する変更に使う。

### Hybrid

共通の auth / schema / domain boundary を小さく固定し、その後は use case ごとの slice で進める。複数 route に波及する機能に使う。

基盤フェーズを必要以上に広げず、最初の観測可能な user behavior へ早く接続する。

## 3. 確認レベル

| Level | 内容 | 例 |
|---|---|---|
| L1 | 静的・純粋関数 | lint、typecheck、SRS unit test |
| L2 | module / boundary integration | Action test、component test、RLS actor test |
| L3 | user journey | 実ブラウザ操作、real/local Supabase smoke |

- auth / RLS / owner boundary は最低 L2。
- UI を含む受入経路は L3 を計画する。
- migration は隔離環境への apply と権限検証を計画する。
- Gemini は mock failure test を必須とし、real smoke は key、外部送信、費用の許可を区別する。
- Playwright は未導入なので、L3 と自動 E2E を同義にしない。

## 4. Design / Plan への記載

- 選択戦略と理由
- Server / Client / Supabase / external の責務境界
- 依存順と各 phase の観測可能な完了条件
- L1 / L2 / L3 の test / verification command
- rollback / fallback / retry と security boundary
- 未導入 tool、credential、external environment による未検証範囲
