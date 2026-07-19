# S-12 ビジュアル・アクセシビリティ検証チェックリスト

- ID: S-12
- 機能: アプリ内OpenAIカード生成UI
- 生成日: 2026-07-18
- Design Doc上、Figma cacheは存在しない。既存deck detailの`max-w-lg`、spacing、blue/slate tone、44px以上の主要controlをUI baselineとする。
- 実行タイミング: UI実装完了後、E2E-06と同じbuildで確認する。

## 1. デッキ詳細

- URL: `/decks/{ownedDeckId}`
- 状態: flag enabled / disabled、0件deck / cardありdeck

- [x] enabled時だけ「AIでカードを作る」導線が既存操作と判別可能に表示される。
- [x] disabled時に導線が消えても、既存deck情報・学習開始・card操作の配置が崩れない。
- [x] 360px viewportで`scrollWidth <= clientWidth`となる。
- [x] 導線のaccessible nameとfocus indicatorが視認できる。
- [x] keyboardのTabとEnterだけで導線へ移動・起動できる。

## 2. AIカード作成ページ

- URL: `/decks/{ownedDeckId}/ai/new`
- 状態: editing、generating、previewValid、previewDirty、committing、tracking、completed、partial、failed、flag disabled

### 360px・layout

- [x] 各状態で横scrollがなく、card本文・長いerror・tag・source名がcontainerを突き抜けない。
- [x] instruction、source、R1/W1/both、tag、illustration、requestedCardCount、主要buttonの順序が一貫する。
- [x] 主要controlのhit areaが44px以上で、隣接操作が誤操作しにくい間隔を持つ。
- [x] preview cardのfront/back、pattern、include状態、concept共有illustrationが文字でも識別できる。
- [x] generating/committing/trackingはspinnerや色だけでなく状態文字を表示する。
- [x] partialは成功cardと失敗itemを色だけでなくlabel/safe codeで区別する。

### Keyboard操作

- [x] Tab/Shift+Tabのfocus順が視覚順と一致する。
- [x] Space/Enterでradio、checkbox、source削除、card除外、警告確認、commit、status再取得を操作できる。
- [x] text編集後にpreviewDirtyとなり、古いcommit操作へ到達できない。
- [x] dialogを使用しない実装のため、focus trap/Escape/close後focus復帰は非該当である。
- [x] keyboardだけで入力から生成、全card確認、編集/除外、再preview、確認、commit、status再取得まで完了できる。

### Label・error・非同期通知

- [x] 全input/controlがvisible labelまたは同等のaccessible nameを持つ。
- [x] field errorのIDが対応controlの`aria-describedby`へ関連付く。
- [x] invalid controlへ`aria-invalid`が付き、submit後のfocusが先頭errorまたはerror summaryへ移る。
- [x] source upload・generate・commit・pollの状態変化が文字と適切なlive regionで通知される。
- [x] schema mismatch、refusal、text moderation、image moderation、output moderation、provider failureが異なる安全な文言になる。
- [x] raw provider response、refusal本文、source/card本文、secretがerror UIへ表示されない。
- [x] 誤り・個人情報・著作権の注意がpreview前後で継続表示され、confirmationの対象が明確である。

### Reload・rollback

- [x] queued/processingでreloadすると同じbatchのstatusが復元され、draft本文やtokenが復元表示されない。
- [x] terminal後はstatus pointerが消え、古いtracking UIが次回表示されない。
- [x] flag disabled時はpageが404またはdisabledとなる一方、既存batch statusとsource recovery操作は利用可能である。

## 実行記録

- [x] 360×800 screenshot: editing (`.gstack/qa-reports/screenshots/ai-editing-mobile.png`)
- [x] 360×800 screenshot: previewValid (`.gstack/qa-reports/screenshots/ai-preview-mobile.png`)
- [x] 360×800 screenshot: previewDirty + field error (`.gstack/qa-reports/screenshots/ai-count-error-mobile.png`、`issue-001-repreview-validation.png`)
- [x] 360×800 screenshot: tracking (`.gstack/qa-reports/screenshots/ai-tracking-mobile.png`)
- [x] 360×800 screenshot: partial (`.gstack/qa-reports/screenshots/ai-partial-mobile.png`、`issue-002-after.png`)
- [x] keyboard-only操作記録（2026-07-19: text生成→card除外→再preview→警告確認→commit 202→status復元）
- [x] accessibility tree/自動scan結果（accessible name、label、error関連、live region、focusを確認）
- [x] 既存deck detail baseline比較 (`deck-detail.png`、`deck-detail-mobile.png`)

## 完了条件

- [x] 全check項目がpass、または非該当理由が記録されている。
- [x] E2E-06がpassする。
- [x] 360pxで横overflow 0件。
- [x] keyboard blocker、accessible name欠落、label/error未関連付けが0件。
