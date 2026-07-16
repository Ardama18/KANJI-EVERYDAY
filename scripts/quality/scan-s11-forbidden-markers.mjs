import { spawn } from "node:child_process";

const markers = process.env.S11_FORBIDDEN_MARKERS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
if (markers.length === 0) {
	process.stderr.write(`${JSON.stringify({ gate: "forbidden-marker-scan", status: "not_run", reason: "S11_FORBIDDEN_MARKERS is required" })}\n`);
	process.exitCode = 2;
} else {
	let failed = false;
	for (const marker of markers) {
		const exitCode = await gitGrep(marker);
		if (exitCode === 0 || (exitCode !== 1 && exitCode !== 0)) failed = true;
	}
	if (failed) {
		process.stderr.write(`${JSON.stringify({ gate: "forbidden-marker-scan", status: "failed" })}\n`);
		process.exitCode = 1;
	} else {
		process.stdout.write(`${JSON.stringify({ gate: "forbidden-marker-scan", status: "passed", markers: markers.length })}\n`);
	}
}

async function gitGrep(marker) {
	return await new Promise((resolve) => {
		const child = spawn("git", ["grep", "--quiet", "--fixed-strings", "--", marker], {
			stdio: "ignore",
		});
		child.once("error", () => resolve(2));
		child.once("close", (code, signal) => resolve(signal === null ? code ?? 2 : 2));
	});
}
