export type ExclusiveOperationRunner = (
	operation: () => Promise<void>,
	onRejected: () => void
) => Promise<boolean>;

export function createExclusiveOperationRunner(
	setPending: (pending: boolean) => void
): ExclusiveOperationRunner {
	let running = false;
	return async (operation, onRejected) => {
		if (running) return false;
		running = true;
		setPending(true);
		try {
			await operation();
		} catch {
			onRejected();
		} finally {
			running = false;
			setPending(false);
		}
		return true;
	};
}
