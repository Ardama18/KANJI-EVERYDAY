export interface FakeHttpCall {
	readonly url: string;
	readonly method: string;
}

export function createFakeFetch(
	responses: readonly { readonly status: number; readonly body?: unknown }[]
): {
	readonly fetch: typeof fetch;
	readonly calls: FakeHttpCall[];
} {
	const calls: FakeHttpCall[] = [];
	let index = 0;
	return {
		calls,
		fetch: async (input, init) => {
			calls.push({ url: String(input), method: init?.method ?? "GET" });
			const response = responses[index] ?? { status: 500 };
			index += 1;
			return Response.json(response.body ?? {}, { status: response.status });
		},
	};
}
