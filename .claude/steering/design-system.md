# デザインシステム baseline（まいにち漢字）

現行の実装正本は `frontend/app/globals.css`、`frontend/tailwind.config.ts`、既存 component。専用 token library はまだないため、存在しない design system を仮定しない。

## プロダクト原則

- 小学生がスマートフォンで迷わず毎日使えることを優先する。
- 1画面の主目的と primary action を一つに絞る。
- 漢字・読み・回答・次回間隔を十分なサイズと余白で見せる。
- 装飾より、テンポ、可読性、安心感を優先する。
- イラストは連想補強であり、答え表示前のヒントにしない。

## 現行 baseline

- content width: `.app-page` の最大 680px
- background: 淡い slate / blue gradient
- body text: slate 系、link / focus: blue 系
- radius: 現行 `.app-link` の 8px を基準に、同種 component 内で統一
- light color scheme を前提

新しい色や spacing を大量に inline hard-code せず、反復が3箇所以上に広がる場合は token 化を検討する。

## 学習 UI

- Show Answer を primary action として明確にする。
- 評価は `むり` / `あやしい` / `できた` のラベルを常に表示し、icon や色だけに依存しない。
- 次回目安は評価ラベルの補助情報として表示する。
- 主要 button の touch target は 48 × 48px 以上。
- front / back の切替で layout が過度に跳ねないようにする。
- pending / failed illustration は明確な placeholder にし、rating button を押せる状態に保つ。

## 状態設計

各画面で必要な状態を明示する。

- loading / pending
- empty
- validation / action error
- success
- disabled / submitting
- session complete

error は原因と次の行動が分かる短い日本語にする。内部 error や英語 stack trace を表示しない。

## Accessibility

- semantic HTML を優先し、clickable `div` を作らない。
- keyboard focus を `:focus-visible` で確認できるようにする。
- form control に label、button / link に一意な accessible name を付ける。
- text / UI component は WCAG AA 相当の contrast を目安とする。
- 200% zoom、320px 幅、長い日本語で横 scroll を発生させない。
- animation は操作理解に必要な最小限にし、reduced motion を尊重する。

## UI 変更時の確認

- mobile と desktop
- keyboard only
- loading / error / empty / long content
- Show Answer 前後の情報露出
- touch target、focus、contrast、overflow
- console error と failed network request
