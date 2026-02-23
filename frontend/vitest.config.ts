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
		include: [
			"src/**/*.test.ts",
			"src/**/*.test.tsx",
			"../specs/stories/S-01-project-scaffolding/tests/*.test.ts",
			"../specs/stories/S-01-project-scaffolding/tests/*.test.tsx",
		],
	},
});
