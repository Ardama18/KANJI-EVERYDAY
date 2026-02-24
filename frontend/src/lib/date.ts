const JST_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1000;
const DATE_TEXT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const INVALID_DATE_ERROR_MESSAGE = "Invalid JST date format: expected YYYY-MM-DD";

const formatDatePart = (value: number): string => value.toString().padStart(2, "0");

const formatIsoDate = (date: Date): string =>
	`${date.getUTCFullYear()}-${formatDatePart(date.getUTCMonth() + 1)}-${formatDatePart(date.getUTCDate())}`;

const parseJstDate = (dateText: string): Date => {
	const match = DATE_TEXT_PATTERN.exec(dateText);
	if (!match) {
		throw new Error(INVALID_DATE_ERROR_MESSAGE);
	}

	const [, yearText, monthText, dayText] = match;
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const parsedDate = new Date(Date.UTC(year, month - 1, day));

	if (
		parsedDate.getUTCFullYear() !== year ||
		parsedDate.getUTCMonth() !== month - 1 ||
		parsedDate.getUTCDate() !== day
	) {
		throw new Error(INVALID_DATE_ERROR_MESSAGE);
	}

	return parsedDate;
};

export function getTodayJST(now: Date = new Date()): string {
	return formatIsoDate(new Date(now.getTime() + JST_OFFSET_MILLISECONDS));
}

export function addDaysJST(baseDate: string, days: number): string {
	const date = parseJstDate(baseDate);
	date.setUTCDate(date.getUTCDate() + days);
	return formatIsoDate(date);
}

export function getTomorrowJST(baseDate?: string): string {
	return addDaysJST(baseDate ?? getTodayJST(), 1);
}

export function isBeforeOrEqualJST(date: string, target: string): boolean {
	return formatIsoDate(parseJstDate(date)) <= formatIsoDate(parseJstDate(target));
}
