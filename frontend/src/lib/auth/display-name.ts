export const DISPLAY_NAME_MAX_LENGTH = 20;
export const DEFAULT_DISPLAY_NAME_FALLBACK = "user";

const getEmailLocalPart = (email: string) => {
	const [localPart = ""] = email.split("@");
	return localPart;
};

export const normalizeDisplayName = (rawValue: string) =>
	rawValue.trim().slice(0, DISPLAY_NAME_MAX_LENGTH);

export const resolveDisplayName = (input: { displayName: string; email: string }) => {
	const normalizedDisplayName = normalizeDisplayName(input.displayName);
	if (normalizedDisplayName.length > 0) {
		return normalizedDisplayName;
	}

	const normalizedLocalPart = normalizeDisplayName(getEmailLocalPart(input.email));
	if (normalizedLocalPart.length > 0) {
		return normalizedLocalPart;
	}

	return DEFAULT_DISPLAY_NAME_FALLBACK;
};
