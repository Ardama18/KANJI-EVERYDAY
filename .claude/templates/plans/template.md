---
id: S-[NN]
feature: [機能名]
type: plan
version: 1.0.0
created: [YYYY-MM-DD]
based_on: specs/stories/S-[NN]-[title]/design.md
---

# 作業計画書: [機能名]

## 目的・完了条件

- 目的: [この変更で実現する価値]
- 完了条件: [観測可能な結果]
- 対象外: [今回行わないこと]

## 参照

- Story: `specs/stories/S-[NN]-[title]/story.md`
- Requirements: `specs/stories/S-[NN]-[title]/requirements.md`
- Design: `specs/stories/S-[NN]-[title]/design.md`
- ADR: [該当する `specs/adr/ADR-...`]
- UI baseline: requirements / `.claude/steering/design-system.md` / 既存 component

## 影響範囲

| 領域 | 対象パス | 変更内容 |
|---|---|---|
| Route / UI | `frontend/app/**`, `frontend/src/components/**` | [内容] |
| Server Action | `frontend/src/actions/**` | [内容] |
| Domain / Supabase client | `frontend/src/lib/**` | [内容] |
| DB / RLS / Storage | `supabase/**` | [内容] |
| Types / Tests / Specs | [path] | [内容] |

## 実装フェーズ

フェーズは依存順に並べる。`tasks/` や個別 task ファイルへ分解せず、この `plan.md` を単一の作業正本とする。

### Phase 1: [観測可能な単位]

- [ ] 先に失敗するテストまたは契約テストを追加する
- [ ] [対象 path / symbol] を実装する
- [ ] 旧経路を置換する場合は upstream wiring と旧実装の除去を確認する
- [ ] 対象テストを実行する

完了条件:

- [AC-ID と対応する結果]

### Phase 2: [観測可能な単位]

- [ ] [実装内容]
- [ ] [認証 / owner / RLS / error 境界]
- [ ] [対象テスト]

完了条件:

- [AC-ID と対応する結果]

### Phase 3: 統合・品質保証

- [ ] すべての AC とテストの対応を確認する
- [ ] loading / empty / error / disabled / complete を確認する
- [ ] UI変更時は mobile / desktop / keyboard / console を実ブラウザで確認する
- [ ] migration 変更時は隔離環境で apply、constraint、RLS actor、seed 再実行を確認する
- [ ] `npm --prefix frontend run check`
- [ ] route、Server/Client 境界、env、production bundling 変更時は `npm --prefix frontend run build`
- [ ] `git diff --check` と差分レビュー

## 受入条件トレーサビリティ

| AC | 実装 | 自動テスト | 手動確認 |
|---|---|---|---|
| AC-01 | [path / symbol] | [test path] | [手順または不要] |

## リスクと停止条件

- schema / RLS / Storage / 認証 / secret / 外部料金へ影響する場合は実行前に対象環境と方針を確認する。
- 同一原因の失敗が続く場合は、追加修正前に根本原因を再分析する。
- credential や外部環境が必要で未検証なら、unit test 成功と混同せず明記する。

## 検証結果

| Command / 手順 | 結果 | 備考 |
|---|---|---|
| [command] | pass / fail / not-run | [理由] |

## 残課題

- [なければ「なし」]
