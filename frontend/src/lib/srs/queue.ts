import { classifyCard } from "./classify";
import type { CardWithState, SessionQueue } from "./types";

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
