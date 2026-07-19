# TypeScript 開発ルール

## 基本原則

- `strict` 前提で、コンパイラが保証できる条件を実行時の思い込みにしない。
- 変更は小さく保ち、無関係な整形・改名・抽象化を混ぜない。
- 既存の Server Action、Supabase client、SRS utility、component を先に検索して再利用する。
- 複雑な domain rule は I/O から分離した純粋関数にする。
- 仕様互換のため意図的に一般ルールを外す場合は Accepted ADR または近接コメントで理由を残す。

## 型安全性

- `any`、二重 assertion、無根拠な non-null assertion を避ける。
- 外部入力（FormData、URL param、Supabase JSON、Gemini response）は `unknown` として検証する。
- 状態は discriminated union で表し、不可能な組み合わせを作りにくくする。
- DB の nullable field を都合よく non-null にしない。
- `Database` 型と query result の同期を保つ。
- client / server の境界を型だけでなく module 配置でも守る。

## 関数と制御フロー

- 一つの関数は一つの責務に絞る。
- guard clause で異常系を早く返し、深いネストを避ける。
- 暗黙の現在時刻、random、network、process env を純粋関数へ持ち込まない。
- 入力配列や object を原則 mutate せず、新しい値を返す。
- 3引数を超える関数は object parameter を検討する。ただし既存の Accepted ADR が位置引数契約を固定している場合は ADR を優先する。

## エラー処理

- 想定内の利用者エラーと、予期しないインフラ / programming error を区別する。
- catch して成功値や空配列へ無条件に変換しない。
- fallback は「要件として許容される劣化動作」に限定する。イラスト failure の placeholder は許容されるが、認証・所有権・評価保存の失敗は成功扱いしない。
- ログへ secret、access token、cookie、API key、個人情報、signed URL を出さない。

## React / Next.js

- Server Component を標準とし、必要最小限の境界だけ Client Component にする。
- render 中に副作用を起こさない。
- list key に不安定な index を使わない（静的で並び替えのない一覧を除く）。
- `defaultValue` / `defaultChecked`は初回mount時だけ反映される。同じkeyのままserver DTOを再取得する編集UIでは、controlled stateにするか、`updatedAt`と編集対象relationを含む同期keyでremountし、dirty入力が最新server値へ戻ることをinteraction testで固定する。
- button の type、form の pending、二重送信防止、error message を明示する。
- `redirect` / `notFound` の制御フローを generic catch で潰さない。

## コメント

- 「何をしているか」ではなく、制約、理由、外部契約、非自明な境界を書く。
- 古い仕様や実装と食い違うコメントはコード変更と同時に更新する。
- TODO には条件または追跡先を添え、将来の希望だけを書かない。

## 品質コマンド

`frontend/` で実行する。

```bash
npm run lint
npm run typecheck
npm run test
npm run check
npm run build
```

自動修正は差分を確認してから採用し、未関連ファイルの一括整形を避ける。
