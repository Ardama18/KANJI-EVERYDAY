# UI Design Integration

KANJI-EVERYDAY では Figma を使用しない。Figma MCP、token、cache、importer、`data-design-id` を要求しない。

UI の正本と優先順位は次のとおり。

1. 対象 Story の requirements / design
2. `.codex/steering/design-system.md`
3. 既存 component と `frontend/app/globals.css`
4. 実ブラウザで観測した現行挙動

UI 実装では loading / error / empty / disabled / pending / complete、mobile / desktop、keyboard、accessible name、200% zoom、48px touch target を確認する。検証 URL、viewport、操作、期待結果、console / network error の有無を記録する。
