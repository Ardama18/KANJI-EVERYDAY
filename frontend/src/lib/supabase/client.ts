import type { Database } from "@/types/database";
import { createBrowserClient as createSupabaseBrowserClient } from "@supabase/ssr";

import { getPublicEnvConfig } from "../env";

export const createBrowserClient = () => {
	const { supabaseUrl, supabaseAnonKey } = getPublicEnvConfig();

	return createSupabaseBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
};
