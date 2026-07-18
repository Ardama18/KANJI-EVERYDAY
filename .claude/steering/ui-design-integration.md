# UI デザイン統合ルール

本プロジェクトでは Figma を使用しない。Figma URL、token、MCP、cache、`data-design-id` を実装・計画・完了条件へ含めない。

## UI の正本

1. 対象 Story の `requirements.md` / `design.md`
2. `.claude/steering/design-system.md`
3. 既存 component と `frontend/app/globals.css`
4. 実ブラウザで観測した現行挙動

正本同士が矛盾する場合は、認証、学習状態、Show Answer 前の情報非表示、48px touch target などの product contract を優先し、実装前に差異を明記する。

## Asset

- image / icon は利用権と source を確認し、repository 内の適切な asset path に置く。
- screenshot を pixel 値の唯一の根拠にせず、requirements、design system、responsive contract を併用する。
- secret や認証済み個人 data を screenshot や検証記録に含めない。
- 新しい外部 asset service や icon package は、依存追加として事前に確認する。

## 実装

- Server / Client Component 境界と既存 component ownership を守る。
- desktop 表示だけから mobile behavior を推測せず、要件と既存 layout に沿って定義する。
- loading、empty、error、disabled、pending illustration、complete を補完する。
- literal の大量複製を避け、反復する値だけ適切な token / component にまとめる。
- 視覚的一致のために semantic HTML、focus、contrast、touch target を犠牲にしない。

## 検証

- target viewport と 320px 程度の mobile
- long Japanese text と 200% zoom
- keyboard focus と accessible name
- front / back / complete の全 state
- loading / error / illustration placeholder
- console / network error

差異は blocking（操作不能・contract 違反・重大な a11y）、major（hierarchy / responsive）、minor（微小な spacing / decoration）に分類し、修正後に同じ条件で再確認する。
