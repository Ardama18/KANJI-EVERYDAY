---
id: ADR-015
story_id: S-30
title: mnemonic-completion-and-illustration-repair
type: adr
created: 2026-10-04
status: Accepted
based_on: specs/stories/S-30-mnemonic-completion-and-repair/requirements.md
related_adr:
  - specs/adr/ADR-012-mnemonic-approval-commit-write-boundary.md
  - specs/adr/ADR-013-post-commit-mnemonic-edit-write-boundary.md
---

# ADR-015: 語単位の未完了状態とカードを再作成しない画像修復

Issue #97 と利用者の「修正をすすめて」に基づく実装判断。S-21 の失敗した mnemonic を省略して import を完成させる契約を、この story の Remote MCP・AI画像・漢字を含む語について置換する。ADR-012 の commit 同一トランザクション保存、ADR-013 の通常の mnemonic 編集は継続する。

1. 生成結果は語ごとに `approved / blocked / not_required` を返す。型検証、拒否、安全確認、HTTP、通信、時間切れ、件数・時間制限、設定不足を固定コードへ写像し、provider本文・例外・キーを返さない。
2. required は DB が R1 の表／W1 の裏と image mode から導出する。欠落・不正な slots は `blocked_mnemonic` に保存する。image quota・providerより前のclaim gateとfinalize gateを設ける。commitの `queued` は受理を表し、完成を表さない。
3. 対象語の再試行はowner-bound RPCで短期leaseを得てからserverで生成・安全確認する。承認後、同じjob/batch/illustrationを再queueする。commitの再送で既存の結果を上書きしない。
4. 既存AIカードの修復は専用jobと新しいimage objectを作り、owner内で旧imageを共有するカード群をrevision snapshotに固定する。生成済みdigestを保存してから、cardsの `illustration_key` だけを同一TXで更新する。カードID、内容、R1/W1、deck_cards、card_tags、review_states、study_sessionsを作り直さない。新しい参照の共有も保持する。
5. 学習中は旧画像を保持し、生成済み画像の差替えを延期する。同時編集・旧mnemonic更新・共有カード増減は競合として停止する。旧画像はreference_countが0になるまで削除対象にしない。修復成功はuser editとしてoriginal undoから保護する。
6. 複数字語のshapeHintは場面の小道具・配置として使い、語全体を一つの部首に変形しない。slots snapshot/hash、template version、prompt hashをimage objectへ記録する。frontendとEdgeのprompt一致をテストする。

追加テーブルは `ai_illustration_repair_jobs`。既存jobにmnemonic状態・固定コード・lease・attempt、objectにprovenanceとrepair_job_idを追加する。元jobかrepair jobのいずれか一方のみをobjectへ関連付ける。ownerが読めるstatus列からworker leaseを除外し、private helpersとworker mutationはpublic/anon/authenticatedへ公開しない。

画像修復は意図的なowner操作のみ。失敗時は旧カードと画像参照を保持する。曖昧な生成／upload再試行は3claimに制限し、学習待機でdigestがある場合は再生成しない。既存成功カードのbackfill、Sept29の暫定復旧再実行、remote DB適用、merge、deployはこの変更に含めない。
