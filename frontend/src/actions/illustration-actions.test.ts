import { describe, expect, it } from "vitest";

import { createServerClient, createServiceRoleClient } from "@/lib/supabase/server";

describe("frontend/src/actions/illustration-actions.ts", () => {
	it("UT-SETUP-SUPABASE-BOUNDARY: Server Action用と非同期処理用のSupabase境界を提供する", () => {
		expect(typeof createServerClient).toBe("function");
		expect(typeof createServiceRoleClient).toBe("function");
	});
});
