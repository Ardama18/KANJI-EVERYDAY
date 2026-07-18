# ローカル開発・UI 検証ランブック

## 前提

- Node.js と `frontend/node_modules` が利用可能
- `frontend/.env.local` に必要な Supabase 値を設定
- 接続先 Supabase に migration と必要な seed が適用済み

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=   # イラスト生成を実確認する場合だけ
```

実値を commit、画面 capture、ログへ含めない。

## worktree・環境分離

- worktree ごとに `pwd`、branch、`frontend/.env.local` の参照先を確認する。別 worktree の相対パスや生成物を使い回さない。
- local / preview / production の Supabase URL と key を混在させない。接続先が不明な状態で migration、seed、データ削除を実行しない。
- 複数 worktree で同時起動する場合は port を明示的に分け、実際に使用した URL を検証記録へ残す。
- 起動前に予定 port の使用状況を確認し、既存プロセスを所有者確認なしに停止しない。
- `.next` や test cache による誤判定が疑われる場合も、対象 worktree を確認してから再生成する。

## 起動

現行 `frontend/package.json` には `dev` script がないため、存在しない `npm run dev` を前提にしない。ローカルに install 済みの Next.js を使う場合は次を `frontend/` で実行できる。

```bash
npm exec -- next dev
```

既定 URL は `http://localhost:3000`。使用中なら `npm exec -- next dev -p 3001` のように別 port を明示し、実際の URL を検証記録へ残す。恒常的に利用するなら `dev` script の追加を別変更として検討する。

ルートの `docker-compose.yml` は現行 Next.js + Supabase 構成と一致しない legacy file を含むため、正本として起動しない。

## 認証用データ

- personal / production account をテストに使わない。
- owner A と別 user B を用意し、cross-user 境界を確認する。
- password、token、cookie を test report に書かない。
- seed が auth user を必要とする場合は、その作成手順と SQL seed の責務を区別する。

## 最小 smoke flow

1. `/signup` または `/login` で認証する。
2. `/decks` に遷移し、New / Learn / Due を確認する。
3. deck overview から study を開始する。
4. front に答え / illustration が出ていないことを確認する。
5. Show Answer 後に back、次回目安、placeholder / illustration を確認する。
6. 3段階 rating を行い、次カードまたは complete へ進む。
7. reload し、session state が復元されることを確認する。
8. logout 後、保護 route へ戻れないことを確認する。

## UI matrix

- viewport: 320px 程度の mobile と desktop
- input: touch 相当、mouse、keyboard
- state: loading、empty、error、pending illustration、complete
- content: 長い deck 名、長い漢字 / 読み
- diagnostics: console error、failed request、unexpected redirect の有無

## 自動チェック

```bash
cd frontend
npm run check
npm run build
```

実ブラウザ自動化は現行 package に含まれない。手動確認を行った場合は、自動 E2E 済みと表現せず URL、操作、期待結果、実結果を記録する。

## 後始末

- 開発 server を停止する。
- 作成した test user / data を消す場合は対象を明示し、共有環境の data を一括削除しない。
- 一時的に変更した env や redirect URL を戻す。
