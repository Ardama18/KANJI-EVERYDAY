# 回帰防止

## 最優先の不変条件

- 未認証 user は保護 route と Server Action を利用できない。
- user A は user B の deck、review state、session、illustration を読取・更新できない。
- Show Answer 前に back text と illustration が露出しない。
- SRS の good / hard / again、JST 境界、retry 上限、queue 順が維持される。
- reload / 再訪時に `study_sessions` から front / back / complete を復元できる。
- illustration pending / failed でも学習と rating を続けられる。
- private Storage と signed URL の owner 境界を維持する。

## 変更別チェック

| 変更 | 必須回帰確認 |
|---|---|
| auth / middleware | login、signup、logout、保護 route、Action 未認証 |
| SRS / date | 全 rating、level 上下限、JST 日替り、queue 非破壊 |
| session Action | start 再利用、reveal 復元、rate、retry、complete |
| schema / RLS | owner 成功、cross-user / anon 拒否、型・seed 同期 |
| illustration | no hint、状態遷移、API failure、private path、signed URL |
| UI | loading、error、二重操作、mobile、keyboard、overflow |

## bug fix の手順

1. 失敗を最小の自動 test または再現手順で固定する。
2. 根本原因と影響する隣接経路を特定する。
3. 最小修正を行う。
4. 対象 test、関連領域、全 `npm run check` の順に検証する。
5. test で固定できない場合は理由と手動確認を記録する。
