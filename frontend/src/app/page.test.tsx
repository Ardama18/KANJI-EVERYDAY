import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.hoisted(() => vi.fn());
const createReadOnlyServerClientMock = vi.hoisted(() =>
	vi.fn(() => ({
		auth: {
			getUser: getUserMock,
		},
	}))
);

vi.mock("@/lib/supabase/server", () => ({
	createReadOnlyServerClient: createReadOnlyServerClientMock,
}));

import HomePage, {
	ROOT_AUTHENTICATED_NAV_LINK,
	ROOT_GUEST_NAV_LINKS,
	ROOT_PAGE_DESCRIPTION,
	ROOT_PAGE_TITLE,
} from "../../app/page";

describe("frontend/app/page.tsx", () => {
	beforeEach(() => {
		getUserMock.mockReset();
		createReadOnlyServerClientMock.mockClear();
	});

	it("未ログイン状態で /login と /signup への導線を返す", async () => {
		getUserMock.mockResolvedValue({ data: { user: null }, error: null });

		const html = renderToStaticMarkup(await HomePage());

		expect(html).toContain(ROOT_PAGE_TITLE);
		expect(html).toContain(ROOT_PAGE_DESCRIPTION);
		for (const link of ROOT_GUEST_NAV_LINKS) {
			expect(html).toContain(`href="${link.href}"`);
			expect(html).toContain(link.label);
		}
		expect(html).not.toContain("将来実装予定");
		expect(html).not.toContain(`href="${ROOT_AUTHENTICATED_NAV_LINK.href}"`);
		expect(createReadOnlyServerClientMock).toHaveBeenCalledTimes(1);
		expect(getUserMock).toHaveBeenCalledTimes(1);
	});

	it("ログイン済み状態で /decks への学習導線を返す", async () => {
		getUserMock.mockResolvedValue({
			data: { user: { id: "user-1", email: "learner@example.test" } },
			error: null,
		});

		const html = renderToStaticMarkup(await HomePage());

		expect(html).toContain(`href="${ROOT_AUTHENTICATED_NAV_LINK.href}"`);
		expect(html).toContain(ROOT_AUTHENTICATED_NAV_LINK.label);
		for (const link of ROOT_GUEST_NAV_LINKS) {
			expect(html).not.toContain(`href="${link.href}"`);
			expect(html).not.toContain(link.label);
		}
	});

	it("auth.getUser が error を返した場合は guest 導線へ劣化する", async () => {
		getUserMock.mockResolvedValue({ data: { user: null }, error: { message: "expired" } });

		const html = renderToStaticMarkup(await HomePage());

		expect(html).toContain('href="/login"');
		expect(html).toContain('href="/signup"');
		expect(html).not.toContain("expired");
	});

	it("auth.getUser が throw した場合は guest 導線へ劣化する", async () => {
		getUserMock.mockRejectedValue(new Error("network details"));

		const html = renderToStaticMarkup(await HomePage());

		expect(html).toContain('href="/login"');
		expect(html).toContain('href="/signup"');
		expect(html).not.toContain("network details");
	});
});
