import { classifyCard } from "./classify";
import type { CardWithState, SessionQueue } from "./types";

const QUEUE_PRIORITY = ["due", "learn", "new", "retry"] as const;

type QueueSource = (typeof QUEUE_PRIORITY)[number];

export interface NextCardResult {
	cardId: string | null;
	source: QueueSource | null;
}

const normalizeNewLimit = (newLimit: number): number => {
	if (!Number.isFinite(newLimit)) {
		return 0;
	}

	return Math.max(0, Math.floor(newLimit));
};

export function buildSessionQueue(
	cards: readonly CardWithState[],
	today: string,
	newLimit: number
): SessionQueue {
	const normalizedNewLimit = normalizeNewLimit(newLimit);
	const queue: SessionQueue = {
		due: [],
		learn: [],
		new: [],
		retry: [],
	};

	for (const card of cards) {
		const category = classifyCard(card.reviewState, today);
		if (category === null) {
			continue;
		}

		if (category === "new") {
			if (queue.new.length < normalizedNewLimit) {
				queue.new.push(card.cardId);
			}
			continue;
		}

		queue[category].push(card.cardId);
	}

	return queue;
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
