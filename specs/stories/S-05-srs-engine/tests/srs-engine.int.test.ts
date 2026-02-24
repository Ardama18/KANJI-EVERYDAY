// S-05 統合テスト - Design Doc: srs-engine
// 生成日: 2026-02-24
// テスト種別: Integration Test
// 実装タイミング: 機能実装と同時
//
// ACトレーサビリティ（Design AC#1〜#24）:
// AC#1  -> IT-AC01-CONSTANT-TABLES
// AC#2  -> IT-AC02-RATING-TYPE-CONTRACT
// AC#3  -> IT-AC03-CALCULATE-SIGNATURE-NOW-INJECTION
// AC#4  -> IT-AC04-GOOD-L0-TRANSITION
// AC#5  -> IT-AC05-HARD-L2-TRANSITION
// AC#6  -> IT-AC06-AGAIN-L3-TRANSITION
// AC#7  -> IT-AC07-AGAIN-RETRY-LIMIT
// AC#8  -> IT-AC08-AGAIN-DAILY-RESET
// AC#9  -> IT-AC09-NULL-STATE-FIRST-REVIEW
// AC#10 -> IT-AC10-LEVEL-CLAMP
// AC#11 -> IT-AC11-INTERVAL-PREVIEW-LABELS
// AC#12 -> IT-AC12-CLASSIFY-NULL-AS-NEW
// AC#13 -> IT-AC13-CLASSIFY-LEARN-DUE-BRANCH
// AC#14 -> IT-AC14-CLASSIFY-FUTURE-AS-NULL
// AC#15 -> IT-AC15-COUNT-EXCLUDES-NULL
// AC#16 -> IT-AC16-BUILD-QUEUE-BASELINE
// AC#17 -> IT-AC17-NEWLIMIT-NORMALIZATION
// AC#18 -> IT-AC18-CATEGORY-STABLE-ORDER
// AC#19 -> IT-AC19-NEXT-CARD-PRIORITY
// AC#20 -> IT-AC20-DEQUEUE-IMMUTABLE-SINGLE-STEP
// AC#21 -> IT-AC21-DEQUEUE-EMPTY-NOOP-NEW-REF
// AC#22 -> IT-AC22-RETRY-APPEND-DUPLICATE
// AC#23 -> IT-AC23-SESSION-COMPLETE-ONLY-WHEN-ALL-EMPTY
// AC#24 -> IT-AC24-JST-MIDNIGHT-RESET

import { describe, it } from "vitest"

describe("srs-engine 統合テスト", () => {
	// 実行順序: Phase 1 - 定数/型/評価ロジック契約

	// ACトレース: AC#1
	// 検証観点: 固定テーブル値 GOOD/HARD/RETRY_TODAY_LIMIT が仕様値で公開される。
	// @category: integration
	// @dependency: frontend/src/lib/srs/constants.ts
	// @complexity: low
	it.todo("IT-AC01: 固定テーブル定数が仕様値で公開される")

	// ACトレース: AC#2
	// 検証観点: Rating が good/hard/again の3値契約で運用される。
	// @category: integration
	// @dependency: frontend/src/lib/srs/types.ts
	// @complexity: low
	it.todo("IT-AC02: Rating の3値契約を型レベルと呼び出し契約で満たす")

	// ACトレース: AC#3
	// 検証観点: calculateRating(state, rating, today, now) が4引数契約を維持し、lastReviewedAt=now を返す。
	// @category: integration
	// @dependency: frontend/src/lib/srs/calculate.ts
	// @complexity: medium
	it.todo("IT-AC03: calculateRating が now 注入をそのまま lastReviewedAt へ反映する")

	// ACトレース: AC#4
	// 検証観点: level0 + good で dueDate=today+1, level=1, addToRetryQueue=false。
	// @category: integration
	// @dependency: frontend/src/lib/srs/calculate.ts
	// @complexity: medium
	it.todo("IT-AC04: level0 good 評価で翌日設定と level 上昇を行う")

	// ACトレース: AC#5
	// 検証観点: level2 + hard で dueDate=today+4, level据え置き, retryTodayCount据え置き。
	// @category: integration
	// @dependency: frontend/src/lib/srs/calculate.ts
	// @complexity: medium
	it.todo("IT-AC05: level2 hard 評価で level と retryTodayCount を維持する")

	// ACトレース: AC#6
	// 検証観点: level3 + again で dueDate=tomorrow, level=0, retryTodayCount+1, addToRetryQueue=true。
	// @category: integration
	// @dependency: frontend/src/lib/srs/calculate.ts
	// @complexity: medium
	it.todo("IT-AC06: level3 again 評価で翌日再学習用のリセット遷移を行う")

	// ACトレース: AC#7
	// 検証観点: again 後 retryTodayCount が上限超過なら addToRetryQueue=false。
	// @category: integration
	// @dependency: frontend/src/lib/srs/calculate.ts
	// @complexity: medium
	it.todo("IT-AC07: again の当日再提示上限超過時に retry 追加を停止する")

	// ACトレース: AC#8
	// 検証観点: lastReviewedAt の JST 日付が today と異なる場合は retryTodayCount を 0 から再計算する。
	// @category: integration
	// @dependency: frontend/src/lib/srs/calculate.ts, frontend/src/lib/date.ts
	// @complexity: high
	it.todo("IT-AC08: JST 日次境界で again の retryTodayCount をリセットして再計算する")

	// ACトレース: AC#9
	// 検証観点: state=null を初回レビューとして level0 基準で計算する。
	// @category: integration
	// @dependency: frontend/src/lib/srs/calculate.ts
	// @complexity: low
	it.todo("IT-AC09: state=null 入力を初回レビューとして処理する")

	// ACトレース: AC#10
	// 検証観点: level 範囲外入力を 0..MAX_GOOD_LEVEL に clamp して計算継続する。
	// @category: integration
	// @dependency: frontend/src/lib/srs/calculate.ts, frontend/src/lib/srs/constants.ts
	// @complexity: medium
	it.todo("IT-AC10: level 範囲外入力でも clamp 後に安全に計算する")

	// ACトレース: AC#11
	// 検証観点: getIntervalPreview(level=2) が good=7日後, hard=4日後, again=今日さいご + 明日 を返す。
	// @category: integration
	// @dependency: frontend/src/lib/srs/calculate.ts
	// @complexity: low
	it.todo("IT-AC11: getIntervalPreview が仕様文言を返す")

	// 実行順序: Phase 2 - 分類/集計契約

	// ACトレース: AC#12
	// 検証観点: classifyCard(null, today) は 'new' を返す。
	// @category: integration
	// @dependency: frontend/src/lib/srs/classify.ts
	// @complexity: low
	it.todo("IT-AC12: classifyCard は null state を new と分類する")

	// ACトレース: AC#13
	// 検証観点: level<=1 && due<=today は learn、level>=2 && due<=today は due。
	// @category: integration
	// @dependency: frontend/src/lib/srs/classify.ts
	// @complexity: medium
	it.todo("IT-AC13: classifyCard が learn/due の分岐条件を満たす")

	// ACトレース: AC#14
	// 検証観点: dueDate > today なら null を返す。
	// @category: integration
	// @dependency: frontend/src/lib/srs/classify.ts
	// @complexity: low
	it.todo("IT-AC14: classifyCard は future due を null で返す")

	// ACトレース: AC#15
	// 検証観点: countByCategory は null 分類をカウント対象に含めない。
	// @category: integration
	// @dependency: frontend/src/lib/srs/classify.ts
	// @complexity: medium
	it.todo("IT-AC15: countByCategory は null 分類カードを除外して集計する")

	// 実行順序: Phase 3 - キュー構築/消化契約

	// ACトレース: AC#16
	// 検証観点: buildSessionQueue が due/learn/new を分類し retry=[] 初期化、newLimit 正規化を適用する。
	// @category: integration
	// @dependency: frontend/src/lib/srs/queue.ts, frontend/src/lib/srs/classify.ts
	// @complexity: medium
	it.todo("IT-AC16: buildSessionQueue が分類と retry 初期化を正しく行う")

	// ACトレース: AC#17
	// 検証観点: newLimit 正規化で 1.9->1, -1->0, NaN->0 を満たす。
	// @category: integration
	// @dependency: frontend/src/lib/srs/queue.ts
	// @complexity: medium
	it.todo("IT-AC17: buildSessionQueue の newLimit 正規化ルールを満たす")

	// ACトレース: AC#18
	// 検証観点: buildSessionQueue の各カテゴリ内部順序を入力順で維持する。
	// @category: integration
	// @dependency: frontend/src/lib/srs/queue.ts
	// @complexity: medium
	it.todo("IT-AC18: buildSessionQueue がカテゴリ内の入力順を保持する")

	// ACトレース: AC#19
	// 検証観点: getNextCardId は due->learn->new->retry 優先順を守る。
	// @category: integration
	// @dependency: frontend/src/lib/srs/queue.ts
	// @complexity: low
	it.todo("IT-AC19: getNextCardId が優先順どおり先頭カードを返す")

	// ACトレース: AC#20
	// 検証観点: dequeueCard は指定 source 先頭のみを削除し入力キューを破壊しない。
	// @category: integration
	// @dependency: frontend/src/lib/srs/queue.ts
	// @complexity: medium
	it.todo("IT-AC20: dequeueCard は指定キューの先頭1件のみ削除して不変性を維持する")

	// ACトレース: AC#21
	// 検証観点: dequeueCard 対象キューが空なら内容 no-op かつ新規オブジェクト参照を返す。
	// @category: integration
	// @dependency: frontend/src/lib/srs/queue.ts
	// @complexity: medium
	it.todo("IT-AC21: dequeueCard は空キュー指定で no-op だが新規 SessionQueue を返す")

	// ACトレース: AC#22
	// 検証観点: addToRetryQueue は重複 cardId を許可し末尾追加する。
	// @category: integration
	// @dependency: frontend/src/lib/srs/queue.ts
	// @complexity: low
	it.todo("IT-AC22: addToRetryQueue は重複IDを拒否せず末尾へ追加する")

	// ACトレース: AC#23
	// 検証観点: 4キュー全空時のみ isSessionComplete=true。
	// @category: integration
	// @dependency: frontend/src/lib/srs/queue.ts
	// @complexity: low
	it.todo("IT-AC23: isSessionComplete は4キュー全空のときだけ true を返す")

	// 実行順序: Phase 4 - 日付境界の複合統合

	// ACトレース: AC#24
	// 検証観点: JST 00:00 跨ぎの again で前日 lastReviewedAt を日次リセット対象として扱う。
	// @category: integration
	// @dependency: frontend/src/lib/srs/calculate.ts, frontend/src/lib/date.ts
	// @complexity: high
	it.todo("IT-AC24: JST 00:00 境界を跨ぐ again で retryTodayCount を日次リセットする")
})
