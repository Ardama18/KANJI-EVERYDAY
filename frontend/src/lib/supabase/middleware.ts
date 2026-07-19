import type { Database } from "@/types/database";
import { createServerClient as createSupabaseServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

import { getPublicEnvConfig } from "../env";

export const createMiddlewareClient = (request: NextRequest, response: NextResponse) => {
	const { supabaseUrl, supabaseAnonKey } = getPublicEnvConfig();

	return createSupabaseServerClient<Database>(supabaseUrl, supabaseAnonKey, {
		cookies: {
			get(name: string) {
				return request.cookies.get(name)?.value;
			},
			set(name: string, value: string, options: Record<string, unknown> = {}) {
				request.cookies.set({
					name,
					value,
					...(options ?? {}),
				});
				response.cookies.set({
					name,
					value,
					...(options ?? {}),
				});
			},
			remove(name: string, options: Record<string, unknown> = {}) {
				request.cookies.set({
					name,
					value: "",
					...(options ?? {}),
				});
				response.cookies.set({
					name,
					value: "",
					...(options ?? {}),
				});
			},
		},
	});
};
