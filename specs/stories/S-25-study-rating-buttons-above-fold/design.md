# S-25 Design

## 1. 現行調査

| 対象 | 確認結果 |
|---|---|
| `frontend/src/components/study/CardBack.tsx` | root が `min-h-[calc(100dvh-2rem)]` で、`app-page` の上下 padding 合計 5rem を考慮していない。裏面本文は `flex-1` + `justify-center`、評価ボタンは末尾に通常配置される。 |
| `frontend/src/components/study/RatingButtons.tsx` | `again` / `hard` / `good` の順で3ボタンを表示し、`onRate(rating)` を直接呼ぶ。 |
| `frontend/src/components/study/IllustrationDisplay.tsx` | ready 画像は最大幅 `max-w-xs` の正方形に近く、pending/fallback でも高さ `h-28` を持つ。 |
| `frontend/src/components/study/MnemonicExplanation.tsx` | ready + explanation の場合に説明 block が追加され、裏面の縦方向サイズをさらに押し広げる。 |
| `frontend/app/globals.css` | `.app-page` は上下に `2rem` / `3rem` の padding を持つ。 |

## 2. Scope / Non-goal

本設計は学習裏面の layout と評価ボタンの視認性だけを変更する。評価ボタンの意味、順序、SRS 保存経路、Server Action、review state 更新処理には触れない。

## 3. 実装アプローチ

`CardBack` を viewport 内の tool surface として扱う。

1. root 高さを `.app-page` の上下 padding 合計に合わせて `h-[calc(100dvh-5rem)]` にする。
2. header と評価領域を `shrink-0` にし、中央の裏面本文領域だけ `min-h-0 flex-1 overflow-y-auto` にする。
3. 評価領域に `sticky bottom-0` と背景 gradient を付け、長い内容で page 側の scroll が発生しても操作領域を見失いにくくする。
4. `RatingButtons` は既存の `button` semantics を維持しつつ、`min-h-16` と focus-visible outline を明示する。

この approach では DOM 順序が `header -> content -> rating buttons` のままなので、keyboard のフォーカス順序は既存と同じである。本文が長い場合だけ本文領域が scroll し、評価操作は固定領域として残る。

## 4. Impact Map

| Area | Impact |
|---|---|
| Study back UI | Layout height, scroll containment, sticky action area |
| Rating buttons | Minimum touch target and explicit focus-visible style |
| SRS/session/action | No change |
| DB/auth/RLS | No change |
| Dependencies | No change |

## 5. Test Strategy

| Level | Target | Coverage |
|---|---|---|
| L1 component markup | `CardBack.test.tsx` | viewport-aware root height, scrollable content area, sticky rating action area, illustration/mnemonic fixture still renders rating controls |
| L1 component contract | `RatingButtons.test.tsx` | rating order, labels, `onRate`, `type="button"`, minimum touch target, focus-visible class |
| L3 manual | local browser or documented steps | mobile 320px and desktop viewport on `/decks/[deckId]/study` after answer reveal |

## 6. Rollback

No data migration is involved. Rollback is reverting the layout classes/tests and removing this story artifact.

## 7. Unresolved Questions

- None blocking. Playwright is not installed, so browser verification is manual or documented as not run.
