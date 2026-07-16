import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const denoBin = process.env.S11_DENO_BIN?.trim() || "deno";
const version = spawnSync(denoBin, ["--version"], { encoding: "utf8" });
if (version.error !== undefined || version.status !== 0) {
	process.stderr.write(`${JSON.stringify({
		gate: "s11-deno-check",
		status: "not_run",
		reason: "configured Deno executable is unavailable; check fallback is forbidden",
	})}\n`);
	process.exit(2);
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const targets = [
	"supabase/functions/ai-card-import-worker/index.ts",
	"supabase/functions/ai-card-import-cleanup/index.ts",
	"supabase/functions/ai-card-import-resource-gate/index.ts",
].map((target) => path.join(projectRoot, target));
const result = spawnSync(
	denoBin,
	["check", "--config", path.join(projectRoot, "supabase/functions/deno.json"), ...targets],
	{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);
process.stdout.write(`${JSON.stringify({
	gate: "s11-deno-check",
	status: "passed",
	targets: targets.map((target) => path.relative(projectRoot, target)),
})}\n`);
