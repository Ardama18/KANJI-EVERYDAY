# セキュリティ標準（まいにち漢字）

## Secret と実行境界

- `SUPABASE_SERVICE_ROLE_KEY`、`GEMINI_API_KEY`、`OPENAI_API_KEY`、`AI_PREVIEW_HMAC_SECRET` は server only。
- `NEXT_PUBLIC_` は公開してよい Supabase URL / anon key だけに使う。
- secret、cookie、access / refresh token、signed URL を source、docs、snapshot、ログへ残さない。
- browser module から server client や server-only env を import しない。
- secret を chat、issue、PR、ログへ貼った場合は漏えい済みとして provider 側で失効・再発行する。環境変数やローカルファイルから削除しただけでは完了扱いにしない。

## 認証・認可

- middleware は UX 上の早期 redirect。唯一の認可境界にしない。
- Server Action ごとに `auth.getUser()` で認証し、副作用前に失敗させる。
- `deckId`、`sessionId`、`cardId`、`illustrationKey` は攻撃者が変更できる入力として扱う。
- RLS と Action の owner filter を両方実施する。
- service role で user request を処理する場合は、迂回が必要な根拠と明示的 owner 検証を要求する。

## DB / RLS / Storage

- 全 user data table で RLS の有効化を確認する。
- policy は select / insert / update / delete を個別に検討する。
- Storage bucket `illustrations` は private、path は owner scoped。
- signed URL は短命にし、必要な利用者にだけ server から返す。
- migration review では privilege、function security、search_path、policy の `USING` / `WITH CHECK` を確認する。
- `SECURITY DEFINER` 関数は固定 `search_path`、明示的な owner、PUBLIC / anon / authenticated からの revoke、必要 role だけへの grant を一体で定義する。
- Hosted Supabase では `CREATE OR REPLACE FUNCTION` の owner が migration 実行 role に依存する。作成後に完全な signature を指定して `ALTER FUNCTION ... OWNER TO s10_migration_owner` を実行し、適用後は `pg_proc` / `pg_roles` の catalog query で実 owner を確認する。

## 入力と外部サービス

- FormData、URL params、Supabase JSON、Gemini / OpenAI response を実行時に検証する。
- prompt input と教材画像を信頼しない入力として扱い、不要な個人情報を外部 AI provider へ送らない。
- external response の MIME、base64、size、status を検証してから Storage へ保存する。
- raw provider error を利用者へ表示しない。安全な運用情報だけ `model_info` に残す。
- API key 未設定時は外部 AI provider を呼ばず、仕様で定めた安全な error / failed 状態へ遷移する。

## 学習体験固有

- 答えとイラストを reveal 前に返さない / render しない。
- 他 user の session / review state / illustration を IDOR で読めないこと。
- rating の再送や並行操作で owner 外更新や無制限 retry を起こさないこと。

## レビュー必須ケース

- env / auth / middleware / cookie の変更
- migration / RLS / Storage policy の変更
- service role の新規利用
- Gemini / OpenAI request、response、prompt、moderation の変更
- HTML 注入、URL redirect、file upload / download の追加
