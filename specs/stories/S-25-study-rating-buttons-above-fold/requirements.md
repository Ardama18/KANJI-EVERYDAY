# S-25 Requirements

## 1. 正本と前提

- 正本は issue-sprint child process が渡した GitHub issue #80 の summary / acceptance criteria である。
- `gh issue view 80 --repo Ardama18/KANJI-EVERYDAY --comments` は sandbox 内で HTTP 401 になったため、issue 本文の追加情報は取得できていない。
- 対象は Next.js 14 App Router の `frontend/` 配下にある学習画面の UI component である。
- DB schema / migration / RLS / auth / Server Action / SRS は変更しない。

## 2. Must

- **REQ-01**: `CardBack` はページの上下 padding を含めても viewport 内に収まりやすい高さで描画しなければならない。
- **REQ-02**: 評価ボタン領域は裏面本文、イラスト、ニーモニック説明よりも下に押し出され続けず、viewport 下部で押せる状態を維持しなければならない。
- **REQ-03**: 裏面本文、イラスト、ニーモニック説明が長い場合は、評価操作ではなく本文側をスクロール対象にしなければならない。
- **REQ-04**: 評価ボタンの DOM 順序、表示順、rating 値は `again` / `hard` / `good` を維持しなければならない。
- **REQ-05**: 評価ラベルは `むり` / `あやしい` / `できた` を維持しなければならない。
- **REQ-06**: rating button は `type="button"` と既存 `onRate(rating)` 呼び出しを維持しなければならない。
- **REQ-07**: 主要タップ領域は 48px 以上を維持し、focus-visible が判別できる状態にしなければならない。
- **REQ-08**: SRS 計算、session reveal/rate Action、review state 更新処理に差分を出してはならない。

## 3. Should

- **SHOULD-01**: Sticky footer 相当の評価領域は本文と重なっても操作しやすい背景を持つ。
- **SHOULD-02**: PC 幅では必要以上に下へ沈めず、学習内容と評価操作を同じ viewport 内で確認しやすくする。
- **SHOULD-03**: UI 変更は既存 `CardBack` / `RatingButtons` component とテストに閉じる。

## 4. Won't

- **WON'T-01**: 評価アルゴリズム、interval preview、保存 API、DB schema は変更しない。
- **WON'T-02**: Playwright や新規 UI dependency は追加しない。

## 5. AC / 要件対応

| AC | 要件 | 検証 |
|---|---|---|
| AC-1 mobile でスクロールなしまたは固定操作 | REQ-01, REQ-02, REQ-03, SHOULD-01 | CardBack markup test, manual viewport steps |
| AC-2 PC でも沈みすぎない | REQ-01, REQ-02, SHOULD-02 | CardBack markup test, manual viewport steps |
| AC-3 ラベルと意味維持 | REQ-04, REQ-05 | RatingButtons test |
| AC-4 keyboard/focus/tap 悪化なし | REQ-06, REQ-07 | RatingButtons test, manual keyboard steps |
| AC-5 illustration/mnemonic ありでも押しにくくしない | REQ-02, REQ-03 | CardBack test with explanation fixture |
| AC-6 SRS / 保存契約を変更しない | REQ-08 | git diff review |
| AC-7 UI 確認結果を記載可能 | REQ-01, REQ-02 | manual verification record |

## 6. 未解決事項

- Playwright は導入されていないため、この story では自動ブラウザ E2E を追加しない。実ブラウザ確認ができない場合は、実行できなかった理由と手動確認手順を記録する。
