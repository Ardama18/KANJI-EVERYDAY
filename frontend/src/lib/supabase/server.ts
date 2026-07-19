import type { Database } from "@/types/database";
import { createServerClient as createSupabaseServerClient } from "@supabase/ssr";
import { type SupabaseClient, createClient as createSupabaseClient } from "@supabase/supabase-js";
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

export type ServerSupabaseClient = SupabaseClient<Database, "public", "public", Database["public"]>;

export const createServerClient = (): ServerSupabaseClient => {
	const { supabaseUrl, supabaseAnonKey } = getEnvConfig();

	// @supabase/ssr 0.6's declaration targets the three-parameter SupabaseClient.
	// Let the factory use its compatibility overload while this module exposes
	// the current four-parameter client type to keep generated RPC/table types.
	// This is the typed equivalent of createSupabaseServerClient<Database>( for
	// the currently installed supabase-js four-parameter client declaration.
	return createSupabaseServerClient(supabaseUrl, supabaseAnonKey, {
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
