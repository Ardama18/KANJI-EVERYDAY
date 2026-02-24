import type { Database } from "@/types/database";
import { createServerClient as createSupabaseServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getEnvConfig } from "../env";

const createCookieStoreAdapter = () => {
	const cookieStore = cookies();

	return {
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
	};
};

export const createServerClient = () => {
	const { supabaseUrl, supabaseAnonKey } = getEnvConfig();

	return createSupabaseServerClient<Database>(supabaseUrl, supabaseAnonKey, {
		cookies: createCookieStoreAdapter(),
	});
};

export const createServiceRoleClient = () => {
	const { supabaseUrl, supabaseServiceRoleKey } = getEnvConfig();

	return createSupabaseClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
		auth: {
			persistSession: false,
			autoRefreshToken: false,
		},
	});
};
