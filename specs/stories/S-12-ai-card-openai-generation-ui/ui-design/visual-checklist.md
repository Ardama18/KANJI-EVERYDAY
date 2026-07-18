# S-12 ビジュアル・アクセシビリティ検証チェックリスト

- ID: S-12
- 機能: アプリ内OpenAIカード生成UI
- 生成日: 2026-07-18
- Design Doc上、Figma cacheは存在しない。既存deck detailの`max-w-lg`、spacing、blue/slate tone、44px以上の主要controlをUI baselineとする。
- 実行タイミング: UI実装完了後、E2E-06と同じbuildで確認する。

## 1. デッキ詳細

- URL: `/decks/{ownedDeckId}`
- 状態: flag enabled / disabled、0件deck / cardありdeck

- [ ] enabled時だけ「AIでカードを作る」導線が既存操作と判別可能に表示される。
- [ ] disabled時に導線が消えても、既存deck情報・学習開始・card操作の配置が崩れない。
- [ ] 360px viewportで`scrollWidth <= clientWidth`となる。
- [ ] 導線のaccessible nameとfocus indicatorが視認できる。
- [ ] keyboardのTabとEnterだけで導線へ移動・起動できる。

## 2. AIカード作成ページ

- URL: `/decks/{ownedDeckId}/ai/new`
- 状態: editing、generating、previewValid、previewDirty、committing、tracking、completed、partial、failed、flag disabled

### 360px・layout

- [ ] 各状態で横scrollがなく、card本文・長いerror・tag・source名がcontainerを突き抜けない。
- [ ] instruction、source、R1/W1/both、tag、illustration、requestedCardCount、主要buttonの順序が一貫する。
- [ ] 主要controlのhit areaが44px以上で、隣接操作が誤操作しにくい間隔を持つ。
- [ ] preview cardのfront/back、pattern、include状態、concept共有illustrationが文字でも識別できる。
- [ ] generating/committing/trackingはspinnerや色だけでなく状態文字を表示する。
- [ ] partialは成功cardと失敗itemを色だけでなくlabel/safe codeで区別する。

### Keyboard操作

- [ ] Tab/Shift+Tabのfocus順が視覚順と一致する。
- [ ] Space/Enterでradio、checkbox、source削除、card除外、警告確認、commit、status再取得を操作できる。
- [ ] text編集後にpreviewDirtyとなり、古いcommit操作へ到達できない。
- [ ] dialogを使用する場合、focus trap、初期focus、Escape、close後focus復帰を満たす。
- [ ] keyboardだけで入力から生成、全card確認、編集/除外、再preview、確認、commit、status再取得まで完了できる。

### Label・error・非同期通知

- [ ] 全input/controlがvisible labelまたは同等のaccessible nameを持つ。
- [ ] field errorのIDが対応controlの`aria-describedby`へ関連付く。
- [ ] invalid controlへ`aria-invalid`が付き、submit後のfocusが先頭errorまたはerror summaryへ移る。
- [ ] source upload・generate・commit・pollの状態変化が文字と適切なlive regionで通知される。
- [ ] schema mismatch、refusal、text moderation、image moderation、output moderation、provider failureが異なる安全な文言になる。
- [ ] raw provider response、refusal本文、source/card本文、secretがerror UIへ表示されない。
- [ ] 誤り・個人情報・著作権の注意がpreview前後で継続表示され、confirmationの対象が明確である。

### Reload・rollback

- [ ] queued/processingでreloadすると同じbatchのstatusが復元され、draft本文やtokenが復元表示されない。
- [ ] terminal後はstatus pointerが消え、古いtracking UIが次回表示されない。
- [ ] flag disabled時はpageが404またはdisabledとなる一方、既存batch statusとsource recovery操作は利用可能である。

## 実行記録

- [ ] 360×800 screenshot: editing
- [ ] 360×800 screenshot: previewValid
- [ ] 360×800 screenshot: previewDirty + field error
- [ ] 360×800 screenshot: tracking
- [ ] 360×800 screenshot: partial
- [ ] keyboard-only操作記録
- [ ] accessibility tree/自動scan結果
- [ ] 既存deck detail baseline比較

## 完了条件

- [ ] 全check項目がpass、または未達項目に承認済みissueが紐付いている。
- [ ] E2E-06がpassする。
- [ ] 360pxで横overflow 0件。
- [ ] keyboard blocker、accessible name欠落、label/error未関連付けが0件。

