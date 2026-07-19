# 実行計画: AIカード最終検証・負荷・監査・清掃

## Phase 1: 証跡棚卸し

- 対象: `verification-report.md`
- S-10〜S-14 のPR本文、issue closeout、story meta、hosted evidence、release evidenceを棚卸しする。
- Epic #9 の23ACそれぞれに evidence source と status を付与する。
- 完了条件: pass済み、partial、not_run が混在しても、未実施をpass扱いしない。

## Phase 2: Runbook整備

- 対象: `docs/runbooks/ai-card-import.md`
- staging load、50-card concurrency、cleanup、redaction、Claude、ChatGPT、rollback/restart の手順を定義する。
- 完了条件: 実行者が secret を証跡へ残さず同じ確認を再実施できる。

## Phase 3: S-15 evidence gate追加

次のファイルを追加する。

- `specs/stories/S-15-ai-cards-e2e-load-audit-cleanup/tests/final-verification-evidence.json`
- `specs/stories/S-15-ai-cards-e2e-load-audit-cleanup/tests/s15-final-verification.test.ts`
- 必要なら `frontend/package.json` に `test:s15:final` を追加する。

検証内容:

- S-15 ACの status が `passed` または明示的な scoped-out であること。
- p95 <= 2000ms、5xx = 0。
- duplicates / quotaOverruns / orphanObjects = 0。
- cleanup boundary が pass。
- redaction flags が false。
- Claude / ChatGPT live-client gates が pass、またはスコープ変更により release block として残っていること。

## Phase 4: ローカル品質確認

`frontend/` で実行する。

```bash
npm run check
npm run build
```

依存環境がある場合は以下も実行する。

```bash
npm run test:s10:inventory
npm run test:s11:inventory
npm run test:s13:database
```

## Phase 5: 外部release gate

runbookに従って実施する。

- Claude live-client gate
- ChatGPT live-client gate
- staging 100 commit load gate
- 50-card concurrency gate
- rollback / restart gate

## Phase 6: Closeout

- 全gateがpassなら issue #15 を close する。
- 外部gate未実施の場合は issue を open のままにし、残gateをコメントする。
