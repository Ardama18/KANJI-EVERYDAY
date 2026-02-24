import type { IllustrationSkill } from "./types";

const MAX_PROMPT_INPUT_LENGTH = 100;

const isControlCharacter = (character: string): boolean => {
	const codePoint = character.charCodeAt(0);

	return codePoint <= 31 || codePoint === 127;
};

const buildSkillDirective = (skill: IllustrationSkill): string =>
	skill === "reading"
		? "読み問題向けとして、意味がひと目で分かる構図にしてください。"
		: "書き問題向けとして、漢字語彙の意味が伝わる構図にしてください。";

export const sanitizePromptInput = (text: string): string =>
	Array.from(text)
		.filter((character) => !isControlCharacter(character))
		.join("")
		.slice(0, MAX_PROMPT_INPUT_LENGTH);

export const generatePrompt = (backText: string, skill: IllustrationSkill): string => {
	const sanitizedBackText = sanitizePromptInput(backText).trim();
	const concept = sanitizedBackText.length > 0 ? sanitizedBackText : "意味が伝わる対象";
	const skillDirective = buildSkillDirective(skill);

	return [
		"シンプルでかわいいフラットイラストを作成してください。",
		"背景は白、明るい色使いで小学生向けにしてください。",
		`「${concept}」の意味を視覚的に表現してください。`,
		skillDirective,
		"文字・テキストは一切描かないでください。",
		"怖い表現、暴力的表現、不適切表現は禁止です。",
	].join("\n");
};
