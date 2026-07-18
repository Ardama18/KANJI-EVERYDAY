# よくある失敗パターンと回避方法

1. **別プロジェクトの前提を持ち込む**
   - NestJS、Prisma、workspace、Playwright、CDK を存在確認なしで使わない。source tree と `frontend/package.json` を先に読む。
2. **middleware だけで認可したつもりになる**
   - Server Action で認証・owner check を行い、RLS を最終防衛線にする。
3. **browser / server Supabase client を混ぜる**
   - 実行境界ごとの factory を使い、server secret を client bundle に入れない。
4. **DB の片側だけ変える**
   - migration、RLS、Storage、Database 型、seed、Action、tests をまとめて追跡する。
5. **JST と UTC を暗黙変換する**
   - 学習日は `frontend/src/lib/date.ts` を使い、固定時刻の境界テストを追加する。
6. **SRS queue を client state だけで進める**
   - `study_sessions` を正本にし、離脱・reload・revealed 状態の再開を確認する。
7. **retry を total に加えて進捗を壊す**
   - total / remaining はユニークカード基準という ADR 契約を守る。
8. **イラスト生成を同期的に待つ**
   - MVP の非同期契約と placeholder fallback を守り、学習を止めない。
9. **fallback で本質的エラーを隠す**
   - illustration failure は劣化可能だが、認証・owner・rating 保存失敗を成功扱いしない。
10. **mock が実 API と異なる**
    - Supabase chain と error shape を実装どおりに表現し、未認証時の副作用 0 回も assert する。
11. **テスト名だけで E2E と判断する**
    - `*.e2e.test.*` がブラウザ / real DB を使うかを読み、実際の検証レベルを報告する。
12. **Accepted ADR より古い epic 記述を採用する**
    - status と related story を照合し、矛盾は最新の Accepted decision を優先する。
13. **実装を追加しただけで利用経路へ接続しない**
    - page、component、Action、domain、DB の upstream / downstream を追い、ユーザー操作から新実装へ到達することをテストする。
14. **置換のつもりで旧経路と新経路を並存させる**
    - replacement では caller を切り替え、旧 export、fallback、条件分岐、重複書き込みを除去する。互換期間が必要なら期限と正本を明記する。
15. **破壊的変更のデータ形状を確認しない**
    - delete、rename、型変更、backfill 前に対象件数、NULL、重複、外部キー、constraint を read-only query で確認し、rollback / forward-fix を用意する。
16. **Story の受入条件がテストへ到達しない**
    - AC と test / 手動確認の対応表を requirements、design、plan で維持し、未検証条件を明記する。
