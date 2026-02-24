export const GOOD_INTERVALS = [1, 3, 7, 14, 30, 60, 120] as const;

export const HARD_INTERVALS = [1, 2, 4, 7, 14, 30, 60] as const;

export const MAX_GOOD_LEVEL = GOOD_INTERVALS.length - 1;

export const MAX_HARD_LEVEL = HARD_INTERVALS.length - 1;

export const RETRY_TODAY_LIMIT = 2;
