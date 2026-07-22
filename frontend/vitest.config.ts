import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
	esbuild: {
		jsx: "automatic",
		jsxImportSource: "react",
	},
	resolve: {
		alias: {
			react: path.resolve(__dirname, "node_modules/react"),
			"react-dom": path.resolve(__dirname, "node_modules/react-dom"),
			"react-dom/server": path.resolve(__dirname, "node_modules/react-dom/server.node.js"),
			"@": path.resolve(__dirname, "./src"),
		},
	},
	test: {
		// S-10 DB contract files intentionally share one isolated database and actor fixture.
		fileParallelism: false,
		include: [
			"src/**/*.test.ts",
			"src/**/*.test.tsx",
			"../specs/stories/S-10-ai-card-import-foundation/tests/*.test.ts",
			"../specs/stories/S-11-ai-card-async-processing/tests/*.test.ts",
			"../specs/stories/S-12-ai-card-openai-generation-ui/tests/*.test.ts",
			"../specs/stories/S-16C-ai-mnemonic-draft/tests/*.test.ts",
			"../specs/stories/S-16D-approval-ui/tests/*.test.ts",
			"../specs/stories/S-16D-approval-ui/tests/*.test.tsx",
			"../specs/stories/S-01-project-scaffolding/tests/*.test.ts",
			"../specs/stories/S-01-project-scaffolding/tests/*.test.tsx",
			"../specs/stories/S-03-authentication-flow/tests/*.test.ts",
			"../specs/stories/S-03-authentication-flow/tests/*.test.tsx",
			"../specs/stories/S-04-seed-data-and-utilities/tests/*.test.ts",
			"../specs/stories/S-04-seed-data-and-utilities/tests/*.test.tsx",
			"../specs/stories/S-05-srs-engine/tests/*.test.ts",
			"../specs/stories/S-05-srs-engine/tests/*.test.tsx",
			"../specs/stories/S-08-illustration-generation-backend/tests/*.test.ts",
			"../specs/stories/S-08-illustration-generation-backend/tests/*.test.tsx",
			"../specs/stories/S-09-illustration-display-integration/tests/*.test.ts",
			"../specs/stories/S-09-illustration-display-integration/tests/*.test.tsx",
			"../specs/stories/S-09-illustration-display-integration/tests/*.int.test.ts",
			"../specs/stories/S-09-illustration-display-integration/tests/*.e2e.test.ts",
		],
	},
});
