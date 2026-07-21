import { classifyCard } from "./classify";
import type { CardCategory, CardWithState, SessionQueue, SessionQueueLimits } from "./types";

const QUEUE_PRIORITY = ["due", "learn", "new", "retry"] as const;

type QueueSource = (typeof QUEUE_PRIORITY)[number];

export interface NextCardResult {
	cardId: string | null;
	source: QueueSource | null;
}

const normalizeLimit = (value: number): number => {
	if (!Number.isFinite(value)) {
		return 0;
	}

	return Math.max(0, Math.floor(value));
};

export function buildSessionQueue(
	cards: readonly CardWithState[],
	today: string,
	limits: SessionQueueLimits | number
): SessionQueue {
	const normalizedLimits =
		typeof limits === "number"
			? { newLimit: limits, dailyStudyLimit: Number.MAX_SAFE_INTEGER }
			: limits;
	const normalizedNewLimit = normalizeLimit(normalizedLimits.newLimit);
	let remaining = normalizeLimit(normalizedLimits.dailyStudyLimit);
	const candidates: Record<CardCategory, string[]> = {
		due: [],
		learn: [],
		new: [],
	};

	for (const card of cards) {
		const category = classifyCard(card.reviewState, today);
		if (category === null) {
			continue;
		}

		candidates[category].push(card.cardId);
	}

	const due = candidates.due.slice(0, remaining);
	remaining -= due.length;
	const learn = candidates.learn.slice(0, remaining);
	remaining -= learn.length;
	const newCards = candidates.new.slice(0, Math.min(normalizedNewLimit, remaining));

	return {
		due,
		learn,
		new: newCards,
		retry: [],
	};
}

const cloneQueue = (queue: SessionQueue): SessionQueue => ({
	due: [...queue.due],
	learn: [...queue.learn],
	new: [...queue.new],
	retry: [...queue.retry],
});

export function getNextCardId(queue: SessionQueue): NextCardResult {
	for (const source of QUEUE_PRIORITY) {
		const cardId = queue[source][0];
		if (cardId !== undefined) {
			return { cardId, source };
		}
	}

	return { cardId: null, source: null };
}

export function dequeueCard(queue: SessionQueue, source: QueueSource): SessionQueue {
	const nextQueue = cloneQueue(queue);
	if (nextQueue[source].length > 0) {
		nextQueue[source] = nextQueue[source].slice(1);
	}

	return nextQueue;
}

export function addToRetryQueue(queue: SessionQueue, cardId: string): SessionQueue {
	return {
		...cloneQueue(queue),
		retry: [...queue.retry, cardId],
	};
}

export function isSessionComplete(queue: SessionQueue): boolean {
	return QUEUE_PRIORITY.every((source) => queue[source].length === 0);
}
