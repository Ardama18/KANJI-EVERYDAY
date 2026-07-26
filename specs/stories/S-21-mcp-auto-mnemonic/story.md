# S-21: Remote MCP 登録カードのニーモニック自動生成・自動承認

- Epic: E-16
- Issue: https://github.com/Ardama18/KANJI-EVERYDAY/issues/70
- 関連: S-14 (#25 remote MCP) / S-16C / S-16D (#44) / S-16E / S-16H (#59) / #52 / #55 / #57 / #61

## 背景

Remote MCP（ChatGPT / Claude 等）から登録したカードには `card_mnemonics` 行が作られない。そのため
答え側の説明ブロック（#52）が出ず、画像も S-16H の承認 slots 駆動テンプレではなく旧・汎用プロンプトの
フォールバックになる。アプリ経路（`commit_generated_import_async`）は S-16D で `p_mnemonics` 対応済みで、
MCP 経路（`s14_remote_commit_import`）だけが取り残されている。

## やること

MCP 登録時に、対象カードのニーモニック slots / explanation をサーバ側で自動生成し、moderation を通し、
`status='approved'` で `card_mnemonics` に owner スコープ保存する。MCP カードもアプリ経路と同じ E-16 体験
（#52 説明表示 ＋ #59 承認 slots 駆動画像）にする。MCP には人による承認 UI が無いため、方針は
**A: サーバ側で自動生成 → 自動承認**。

## やらないこと

- アプリ経由の承認 UI（S-16D 既存）
- 既存 MCP カードへの遡及的ニーモニック付与（別 follow-up）
- 画像モデルの変更
- ニーモニック生成を新しい quota kind として計上すること

## 実装前に確定した重大な前提（design.md D0 参照）

`card_mnemonics` は `(owner_user_id, illustration_key)` で一意であり、#52 と #59 の双方が
`cards.illustration_key` を起点に引く。`cards.illustration_key` は concept job に illustration 行がある
ときだけ設定され、illustration 行は `image_mode <> 'none'` のときだけ作られる。ところが現行の MCP tool schema
（`frontend/src/lib/mcp/tools.ts:32`）は `image.mode === "ai"` を拒否し、MCP には upload 用の tool も無い。

つまり **現状の MCP で登録できるカードは実質すべて `image_mode='none'` であり、`illustration_key` を持たない。
RPC をどれだけ拡張しても `card_mnemonics` に書ける行が存在しない。** issue の AC-1 / AC-3 は、MCP からの
`image.mode = "ai"` を許可するという前提とセットでのみ成立する。この前提の承認が本 Story の着手条件になる。
