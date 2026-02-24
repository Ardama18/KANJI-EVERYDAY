type AuthErrorBannerProps = {
	message?: string;
};

export function AuthErrorBanner({ message }: AuthErrorBannerProps) {
	if (!message) {
		return null;
	}

	return (
		<p
			role="alert"
			aria-live="polite"
			className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
		>
			{message}
		</p>
	);
}
