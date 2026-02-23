import type { Database } from "@/types/database";
import { createBrowserClient as createSupabaseBrowserClient } from "@supabase/ssr";

import { getEnvConfig } from "../env";

export const createBrowserClient = () => {
	const { supabaseUrl, supabaseAnonKey } = getEnvConfig();

	return createSupabaseBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
};
