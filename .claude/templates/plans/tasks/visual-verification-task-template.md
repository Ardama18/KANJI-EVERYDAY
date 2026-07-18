# 廃止済み: 個別ビジュアル検証 task テンプレート

KANJI-EVERYDAY の現行フローでは `tasks/` や個別 task ファイルを新規作成しない。このファイルは旧フローからの参照を安全に止めるための互換 notice であり、コピーして使用しない。

UI 検証は対象 Story の `plan.md` に直接記載する。

最低限、次を含める。

- 対象 route と実際に確認した URL
- mobile と desktop の viewport
- loading / empty / error / disabled / pending / complete
- keyboard focus、accessible name、200% zoom、48px touch target
- requirements、design system、既存 component を比較基準とする
- console error、failed request、unexpected redirect の有無
- 自動ブラウザテストを実行していない場合は、手動確認と明記する

標準の記載先は `.claude/templates/plans/template.md` の「Phase 3: 統合・品質保証」と「検証結果」。
