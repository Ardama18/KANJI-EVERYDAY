import type { Database } from "@/types/database";
import { createServerClient as createSupabaseServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getEnvConfig } from "../env";

export const createServerClient = () => {
	const { supabaseUrl, supabaseAnonKey } = getEnvConfig();

	const cookieStore = cookies();

	return createSupabaseServerClient<Database>(supabaseUrl, supabaseAnonKey, {
		cookies: {
			get(name: string) {
				return cookieStore.get(name)?.value;
			},
			set(name: string, value: string, options: Record<string, unknown> = {}) {
				cookieStore.set({
					name,
					value,
					...(options ?? {}),
				});
			},
			remove(name: string, options: Record<string, unknown> = {}) {
				cookieStore.set({
					name,
					value: "",
					...(options ?? {}),
				});
			},
		},
	});
};
