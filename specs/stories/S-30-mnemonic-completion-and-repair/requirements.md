# Requirements: Issue #97 恒久対策

対象はRemote MCP importの `image.mode=ai`、R1表／W1裏にHan文字を含む語。かなのみ、画像なし、upload画像は従来契約を維持する。既存の成功カードを自動backfill／再生成しない。

| AC | 観測可能な契約 | 実装単位 | 回帰テスト |
|---|---|---|---|
| 1 | 語ごとにapproved・固定コード付きblocked・not_requiredを返す。上限超過や未着手も消さない | mnemonic-generation / mnemonic-outcomes / MCP services | mnemonic-outcomes.test、mnemonic-generation.test、services.test |
| 2 | requiredの欠落は未完了。汎用画像生成・quota消費・カード作成へ進まない | remote commit、claim/finalize、status、ImportStatus | database-gate、worker-claim-prompt、outcome contract、ImportStatus regression |
| 3 | 本人の対象語だけを短期leaseで再試行し、承認後に同じjob/batchを再queue。旧commit再送では上書きしない | retry_mnemonic / prepare-complete RPC | mnemonic-recovery.test、database-gate（owner/anon/replay/stale token） |
| 4 | 既存カードID、表裏、R1/W1、deck_cards、card_tags、review_statesを保つ。共有画像は共有したまま一括差替え | repair_card_illustration / repair job / finalize | database-gate（exact snapshot、旧ref0・新ref2） |
| 5 | 学習中は旧画像を保持し差替え延期。同時編集・旧mnemonic編集・共有カード変更は競合停止 | snapshot、lease、active-session guard、lifecycle locks | database-gate、repair-worker.test |
| 6 | 複数字語のshapeHint.part/picture、meaningHint、storyを画像プロンプトへ反映。語全体を一つの部首に変形しない | frontend prompt / Edge mnemonic-prompt | prompt.test、worker-mnemonic-prompt、worker-claim-prompt、repair-worker.test |
| 7 | provider本文・secret・内部path・worker tokenをtool結果へ出さない。認可前にproviderを呼ばない | recovery projection、safe codes、RPC grants/RLS | mnemonic-outcomes、mnemonic-recovery、database-gate ACL |
| 8 | 既存復旧済みカードと画像はmigration適用だけでは変わらない | nullable provenance＋非破壊migration | database-gate upgrade（pre-S30成功カードとimageの完全一致） |

失敗コードは `MNEMONIC_HTTP_TRANSIENT / HTTP_PERMANENT / TIMEOUT / NETWORK / RESPONSE_INVALID / VALIDATION_FAILED / REFUSED / MODERATION_BLOCKED / MODERATION_UNAVAILABLE / LIMIT_EXCEEDED / BUDGET_EXCEEDED / DISABLED / CONFIG_MISSING / TARGET_UNSUPPORTED / INTERNAL_ERROR`（全てMNEMONIC_接頭辞）。利用者表示はsafeCodeMessageの日本語のみ。

単一コードポイントと語長はserverで導出する。required語が16コードポイントを超える場合はTARGET_UNSUPPORTEDで停止する。generatorの上限・wall-clock budgetはgenerationとmoderationを合わせて適用する。承認前に完成扱いにしない。

修復対象は本人のprivateな既存AI importカード。新しい画像objectを作り、同じ旧image keyを持つowner内カード群をsnapshotに含める。カードを削除しない。共有参照の付け替えは一括TXであり、生成・upload失敗や競合では旧画像参照を保持する。旧objectの削除は既存reference-count cleanupのみで行う。
