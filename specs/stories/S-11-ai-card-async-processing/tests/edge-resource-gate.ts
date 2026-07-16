import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const CPU_LIMIT_SECONDS = 1.6;
const RSS_LIMIT_BYTES = 204 * 1024 * 1024;
const WALL_LIMIT_MS = 120_000;
const required = [
	"S11_RESOURCE_FIXTURE_DIR",
	"S11_RESOURCE_BUNDLE_PATH",
	"S11_RESOURCE_WASM_PATH",
] as const;
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length > 0) {
	process.stderr.write(
		`${JSON.stringify({
			gate: "s11-edge-resource",
			status: "not_run",
			reason: `required environment missing: ${missing.join(",")}; unbound or mock fallback is forbidden`,
		})}\n`
	);
	process.exit(2);
}

const fixtureDirectory = path.resolve(requiredEnvironment("S11_RESOURCE_FIXTURE_DIR"));
const bundlePath = path.resolve(requiredEnvironment("S11_RESOURCE_BUNDLE_PATH"));
const wasmPath = path.resolve(requiredEnvironment("S11_RESOURCE_WASM_PATH"));
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const manifestPath = path.join(
	projectRoot,
	"supabase/functions/ai-card-import-resource-gate/artifact-manifest.json"
);
const manifest = parseArtifactManifest(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
const packageLock = parsePackageLock(
	JSON.parse(await readFile(path.join(projectRoot, manifest.packageLockPath), "utf8")) as unknown,
	manifest.packageLockKey
);
if (
	packageLock.version !== manifest.wasmPackageVersion ||
	packageLock.integrity !== manifest.packageIntegrity
) {
	throw new Error("pinned WASM package identity does not match the deterministic package lock");
}
if ((await realpath(wasmPath)) !== (await realpath(path.join(projectRoot, manifest.wasmRelativePath)))) {
	throw new Error("S11_RESOURCE_WASM_PATH is not the manifest-pinned package artifact");
}
const denoBin = process.env.S11_RESOURCE_DENO_BIN?.trim() || "deno";
try {
	await execFileAsync(denoBin, ["--version"]);
} catch {
	process.stderr.write(
		`${JSON.stringify({
			gate: "s11-edge-resource",
			status: "not_run",
			reason: "configured Deno executable is unavailable; mock fallback is forbidden",
		})}\n`
	);
	process.exit(2);
}
const bundleMetadata = await stat(bundlePath);
const wasmMetadata = await stat(wasmPath);
if (!bundleMetadata.isFile() || !wasmMetadata.isFile()) {
	throw new Error("resource artifact entry and WASM must both be files");
}
const bundle = await readFile(bundlePath);
const wasm = await readFile(wasmPath);
const bundleSha256 = createHash("sha256").update(bundle).digest("hex");
const wasmSha256 = createHash("sha256").update(wasm).digest("hex");
if (wasm.byteLength !== manifest.wasmBytes || wasmSha256 !== manifest.wasmSha256) {
	throw new Error("configured WASM bytes do not match the deterministic artifact manifest");
}
if (hasExternalModuleImport(new TextDecoder().decode(bundle))) {
	throw new Error(
		"S11_RESOURCE_BUNDLE_PATH must be a self-contained bundle with no external module imports"
	);
}
const artifactBytes = bundle.byteLength + wasm.byteLength;
if (artifactBytes > 16 * 1024 * 1024) throw new Error("served artifact plus WASM exceeds 16 MiB");
const artifactRevision = createHash("sha256")
	.update("s11-resource-bundle\0")
	.update(bundle)
	.update("\0s11-resource-wasm\0")
	.update(wasm)
	.digest("hex");

const successfulFixtures = [
	["max-16mp.png", "image/png", true],
	["max-16mp.jpg", "image/jpeg", true],
	["max-16mp.webp", "image/webp", true],
] as const;
const providerMaximum = await readFile(path.join(fixtureDirectory, "max-16mp.png"));
if (providerMaximum.byteLength !== 10 * 1024 * 1024) {
	throw new Error("maximum provider response fixture must be exact 10 MiB");
}
const providerOversized = Buffer.alloc(10 * 1024 * 1024 + 1);
const imageDecodeFailure = providerMaximum.subarray(0, Math.min(64, providerMaximum.byteLength));
if (imageDecodeFailure.byteLength < 24) {
	throw new Error("maximum PNG fixture cannot derive an independent truncated decode failure");
}

const edgePort = randomPort();
const providerPort = randomPort(edgePort);
const workerSecret = randomBytes(32).toString("base64url");
let providerMaximumCalls = 0;
let providerTimeoutCalls = 0;
let providerTimeoutAborts = 0;
const fakeProvider = createServer((request, response) => {
	if (request.method !== "POST") {
		response.writeHead(405).end();
		return;
	}
	if (request.url === "/provider-max") {
		providerMaximumCalls += 1;
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(JSON.stringify({ data: [{ b64_json: providerMaximum.toString("base64") }] }));
		return;
	}
	if (request.url === "/provider-timeout") {
		providerTimeoutCalls += 1;
		response.on("close", () => {
			if (!response.writableEnded) providerTimeoutAborts += 1;
		});
		return;
	}
	if (request.url === "/provider-oversized-base64") {
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(JSON.stringify({ data: [{ b64_json: providerOversized.toString("base64") }] }));
		return;
	}
	if (request.url === "/provider-missing-content-length") {
		response.writeHead(200, { "Content-Type": "application/json", "Transfer-Encoding": "chunked" });
		response.write('{"data":[{"b64_json":"');
		response.write(providerOversized.toString("base64"));
		response.end('"}]}');
		return;
	}
	if (request.url === "/provider-declared-oversized") {
		response.writeHead(200, {
			"Content-Type": "application/json",
			"Content-Length": String(16 * 1024 * 1024),
		});
		response.end(Buffer.alloc(16 * 1024 * 1024, 32));
		return;
	}
	response.writeHead(404).end();
});
await new Promise<void>((resolve, reject) => {
	fakeProvider.once("error", reject);
	fakeProvider.listen(providerPort, "127.0.0.1", resolve);
});

const edge = spawn(
	denoBin,
	[
		"run",
		"--no-prompt",
		"--allow-env=AI_CARD_WORKER_SECRET,S11_RESOURCE_PORT,S11_RESOURCE_WASM_PATH,S11_RESOURCE_PROVIDER_BASE_URL",
		`--allow-net=127.0.0.1:${edgePort},127.0.0.1:${providerPort}`,
		`--allow-read=${wasmPath}`,
		bundlePath,
	],
	{
		env: {
			...process.env,
			AI_CARD_WORKER_SECRET: workerSecret,
			S11_RESOURCE_PORT: String(edgePort),
			S11_RESOURCE_WASM_PATH: wasmPath,
			S11_RESOURCE_PROVIDER_BASE_URL: `http://127.0.0.1:${providerPort}`,
		},
		stdio: ["ignore", "pipe", "pipe"],
	}
);
let edgeDiagnostic = "";
edge.stderr?.on("data", (chunk: Buffer) => {
	edgeDiagnostic = `${edgeDiagnostic}${chunk.toString("utf8")}`.slice(-4_000);
});
const endpoint = `http://127.0.0.1:${edgePort}`;
const reports: unknown[] = [];
try {
	await waitForReady(edge, endpoint);
	for (const [name, mime, shouldSucceed] of successfulFixtures) {
		const bytes = await readFile(path.join(fixtureDirectory, name));
		if (bytes.byteLength < 1 || bytes.byteLength > 10 * 1024 * 1024) {
			throw new Error(`${name} is outside the supported 1..10 MiB boundary`);
		}
		if (shouldSucceed && bytes.byteLength !== 10 * 1024 * 1024) {
			throw new Error(`${name} must be the exact 10 MiB maximum fixture`);
		}
		const measured = await measureRequest(edge, `${endpoint}/`, {
			method: "POST",
			headers: {
				"Content-Type": mime,
				"Content-Length": String(bytes.byteLength),
				"x-ai-worker-secret": workerSecret,
				"x-require-max-fixture": shouldSucceed ? "true" : "false",
			},
			body: ownedArrayBuffer(bytes),
		});
		const report: unknown = await measured.response.json();
		assertProcessedReport(measured, report, "processed", name);
		reports.push({ name, ...withoutResponse(measured), report });
	}

	for (const [name, bytes] of [
		["decode-bomb", await readFile(path.join(fixtureDirectory, "decode-bomb.png"))],
		["image-decode-failure", imageDecodeFailure],
	] as const) {
		if (bytes.byteLength < 1 || bytes.byteLength > 10 * 1024 * 1024) {
			throw new Error(`${name} is outside the supported 1..10 MiB boundary`);
		}
		const measured = await measureRequest(edge, `${endpoint}/`, {
			method: "POST",
			headers: {
				"Content-Type": "image/png",
				"Content-Length": String(bytes.byteLength),
				"x-ai-worker-secret": workerSecret,
			},
			body: ownedArrayBuffer(bytes),
		});
		const report: unknown = await measured.response.json();
		assertDecodeFailureReport(measured, report, name);
		reports.push({ name, ...withoutResponse(measured), report });
	}

	const providerMaximumMeasured = await measureRequest(edge, `${endpoint}/`, {
		method: "POST",
		headers: {
			"x-ai-worker-secret": workerSecret,
			"x-resource-case": "provider-max",
		},
	});
	const providerMaximumReport: unknown = await providerMaximumMeasured.response.json();
	assertProcessedReport(
		providerMaximumMeasured,
		providerMaximumReport,
		"provider_processed",
		"maximum provider response"
	);
	if (providerMaximumCalls !== 1)
		throw new Error("served provider maximum case was not called once");
	reports.push({
		name: "provider-max-10mib-16mp",
		...withoutResponse(providerMaximumMeasured),
		report: providerMaximumReport,
	});

	for (const resourceCase of [
		"provider-oversized-base64",
		"provider-missing-content-length",
		"provider-declared-oversized",
	] as const) {
		const measured = await measureRequest(edge, `${endpoint}/`, {
			method: "POST",
			headers: { "x-ai-worker-secret": workerSecret, "x-resource-case": resourceCase },
		});
		const report: unknown = await measured.response.json();
		if (
			measured.response.status !== 422 || !isRecord(report) ||
			report.status !== "provider_rejected" || report.errorCode !== "IMAGE_TOO_LARGE"
		) throw new Error(`${resourceCase} did not enforce the served provider response bound`);
		assertResourceMeasurements(measured, report, resourceCase);
		reports.push({ name: resourceCase, ...withoutResponse(measured), report });
	}

	const providerTimeoutMeasured = await measureRequest(edge, `${endpoint}/`, {
		method: "POST",
		headers: {
			"x-ai-worker-secret": workerSecret,
			"x-resource-case": "provider-timeout",
		},
	});
	const providerTimeoutReport: unknown = await providerTimeoutMeasured.response.json();
	await waitFor(() => providerTimeoutAborts === 1, 1_000);
	if (
		providerTimeoutMeasured.response.status !== 504 ||
		!isRecord(providerTimeoutReport) ||
		providerTimeoutReport.status !== "provider_timeout" ||
		providerTimeoutMeasured.wallSeconds < 109 ||
		providerTimeoutMeasured.wallSeconds > 120 ||
		providerTimeoutMeasured.cpuSeconds > CPU_LIMIT_SECONDS ||
		Math.max(
			numberValue(providerTimeoutReport.peakRssBytes),
			providerTimeoutMeasured.peakProcessRssBytes
		) > RSS_LIMIT_BYTES ||
		providerTimeoutCalls !== 1 ||
		providerTimeoutAborts !== 1
	) {
		throw new Error("served provider timeout/resource boundary failed");
	}
	reports.push({
		name: "provider-timeout-110s",
		...withoutResponse(providerTimeoutMeasured),
		report: providerTimeoutReport,
	});
} catch (error) {
	if (edge.exitCode !== null) {
		throw new Error(`exact local artifact server exited ${edge.exitCode}: ${edgeDiagnostic}`);
	}
	throw error;
} finally {
	await stopChild(edge);
	fakeProvider.closeAllConnections();
	await new Promise<void>((resolve) => fakeProvider.close(() => resolve()));
}

process.stdout.write(
	`${JSON.stringify({
		gate: "s11-edge-resource",
		status: "passed",
		runtime: "direct-local-deno-artifact",
		artifactRevision,
		artifactBytes,
		bundle: { bytes: bundle.byteLength, sha256: bundleSha256 },
		wasm: {
			bytes: wasm.byteLength,
			sha256: wasmSha256,
			package: manifest.wasmPackage,
			version: manifest.wasmPackageVersion,
			integrity: manifest.packageIntegrity,
			manifest: path.relative(projectRoot, manifestPath),
		},
		limits: {
			rssMiB: RSS_LIMIT_BYTES / 1024 / 1024,
			cpuSeconds: CPU_LIMIT_SECONDS,
			artifactMiB: 16,
			wallSeconds: WALL_LIMIT_MS / 1_000,
		},
		reports,
	})}\n`
);

async function measureRequest(
	edge: ChildProcess,
	url: string,
	init: RequestInit
): Promise<MeasuredResponse> {
	const pid = edge.pid;
	if (pid === undefined || edge.exitCode !== null)
		throw new Error("artifact server is not running");
	const cpuBefore = await processCpuSeconds(pid);
	let peakProcessRssBytes = await processRssBytes(pid);
	const started = performance.now();
	let completed = false;
	let enforcedViolation: string | undefined;
	const controller = new AbortController();
	const enforce = (reason: string): void => {
		if (enforcedViolation !== undefined) return;
		enforcedViolation = reason;
		controller.abort();
		edge.kill("SIGKILL");
	};
	const deadline = setTimeout(() => enforce("wall deadline exceeded"), WALL_LIMIT_MS);
	const monitor = (async (): Promise<void> => {
		while (!completed && enforcedViolation === undefined) {
			const [cpu, rss] = await Promise.all([processCpuSeconds(pid), processRssBytes(pid)]);
			peakProcessRssBytes = Math.max(peakProcessRssBytes, rss);
			if (cpu - cpuBefore > CPU_LIMIT_SECONDS) enforce("CPU limit exceeded");
			else if (peakProcessRssBytes > RSS_LIMIT_BYTES) enforce("RSS limit exceeded");
			if (!completed && enforcedViolation === undefined) await delay(25);
		}
	})();
	let response: Response;
	try {
		response = await fetch(url, { ...init, signal: controller.signal });
	} catch (error) {
		if (enforcedViolation !== undefined) throw new Error(enforcedViolation);
		throw error;
	} finally {
		completed = true;
		clearTimeout(deadline);
		await monitor;
	}
	const wallSeconds = (performance.now() - started) / 1_000;
	const cpuSeconds = Math.max(0, (await processCpuSeconds(pid)) - cpuBefore);
	peakProcessRssBytes = Math.max(peakProcessRssBytes, await processRssBytes(pid));
	if (cpuSeconds > CPU_LIMIT_SECONDS) throw new Error("CPU limit exceeded");
	if (peakProcessRssBytes > RSS_LIMIT_BYTES) throw new Error("RSS limit exceeded");
	if (wallSeconds * 1_000 > WALL_LIMIT_MS) throw new Error("wall deadline exceeded");
	return { response, wallSeconds, cpuSeconds, peakProcessRssBytes };
}

function assertProcessedReport(
	measured: MeasuredResponse,
	report: unknown,
	expectedStatus: string,
	name: string
): void {
	if (measured.response.status !== 200 || !isRecord(report) || report.status !== expectedStatus) {
		throw new Error(`${name} failed the directly served artifact codec path`);
	}
	const peakRssBytes = Math.max(
		numberValue(report.peakRssBytes),
		measured.peakProcessRssBytes
	);
	if (
		measured.cpuSeconds > CPU_LIMIT_SECONDS ||
		peakRssBytes > RSS_LIMIT_BYTES ||
		measured.wallSeconds * 1_000 > WALL_LIMIT_MS ||
		numberValue(report.processingMs) > WALL_LIMIT_MS
	) {
		throw new Error(`${name} exceeded Edge resource limits`);
	}
}

function assertDecodeFailureReport(
	measured: MeasuredResponse,
	report: unknown,
	name: string
): void {
	if (
		measured.response.status !== 422 ||
		!isRecord(report) ||
		report.status !== "image_decode_failed" ||
		report.errorCode !== "IMAGE_DECODE_FAILED"
	) {
		throw new Error(`${name} did not return the exact 422/IMAGE_DECODE_FAILED contract`);
	}
	const peakRssBytes = Math.max(
		numberValue(report.peakRssBytes),
		measured.peakProcessRssBytes
	);
	if (
		measured.cpuSeconds > CPU_LIMIT_SECONDS ||
		peakRssBytes > RSS_LIMIT_BYTES ||
		measured.wallSeconds * 1_000 > WALL_LIMIT_MS ||
		numberValue(report.processingMs) > WALL_LIMIT_MS
	) {
		throw new Error(`${name} exceeded enforced failure-path resource limits`);
	}
}

function assertResourceMeasurements(
	measured: MeasuredResponse,
	report: Readonly<Record<string, unknown>>,
	name: string
): void {
	const peakRssBytes = Math.max(numberValue(report.peakRssBytes), measured.peakProcessRssBytes);
	if (
		measured.cpuSeconds > CPU_LIMIT_SECONDS || peakRssBytes > RSS_LIMIT_BYTES ||
		measured.wallSeconds * 1_000 > WALL_LIMIT_MS || numberValue(report.processingMs) > WALL_LIMIT_MS
	) throw new Error(`${name} exceeded Edge resource limits`);
}

async function processCpuSeconds(pid: number): Promise<number> {
	const { stdout } = await execFileAsync("/bin/ps", ["-o", "time=", "-p", String(pid)]);
	const value = stdout.trim();
	const parts = value.split(":").map(Number);
	if (parts.some((part) => !Number.isFinite(part)) || parts.length < 2 || parts.length > 3) {
		throw new Error("could not measure served Deno process CPU time");
	}
	return parts.reduce((total, part) => total * 60 + part, 0);
}

async function processRssBytes(pid: number): Promise<number> {
	const { stdout } = await execFileAsync("/bin/ps", ["-o", "rss=", "-p", String(pid)]);
	const rssKiB = Number(stdout.trim());
	if (!Number.isFinite(rssKiB) || rssKiB < 0) {
		throw new Error("could not measure served Deno process RSS");
	}
	return rssKiB * 1024;
}

async function waitForReady(edge: ChildProcess, endpoint: string): Promise<void> {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		if (edge.exitCode !== null) throw new Error("artifact server exited before readiness");
		try {
			const response = await fetch(`${endpoint}/health`);
			if (response.status === 204) return;
		} catch {
			// The exact local artifact is still starting.
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("exact local artifact server readiness timed out");
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

async function stopChild(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null) return;
	child.kill("SIGTERM");
	await Promise.race([
		new Promise<void>((resolve) => child.once("exit", () => resolve())),
		new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
	]);
	if (child.exitCode === null) child.kill("SIGKILL");
}

function randomPort(except?: number): number {
	let result = 20_000 + (randomBytes(2).readUInt16BE(0) % 20_000);
	if (result === except) result += 1;
	return result;
}

function hasExternalModuleImport(source: string): boolean {
	return /(^|\n)\s*import\s+(?!meta\b)|\bimport\s*\(/mu.test(source);
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

function withoutResponse(value: MeasuredResponse): Omit<MeasuredResponse, "response"> {
	return {
		wallSeconds: value.wallSeconds,
		cpuSeconds: value.cpuSeconds,
		peakProcessRssBytes: value.peakProcessRssBytes,
	};
}

async function delay(milliseconds: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new Error("resource endpoint returned an invalid measurement");
	}
	return value;
}

function requiredEnvironment(name: (typeof required)[number]): string {
	const value = process.env[name]?.trim();
	if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
	return value;
}

interface MeasuredResponse {
	readonly response: Response;
	readonly wallSeconds: number;
	readonly cpuSeconds: number;
	readonly peakProcessRssBytes: number;
}

interface ArtifactManifest {
	readonly packageIntegrity: string;
	readonly packageLockKey: string;
	readonly packageLockPath: string;
	readonly wasmBytes: number;
	readonly wasmPackage: string;
	readonly wasmPackageVersion: string;
	readonly wasmRelativePath: string;
	readonly wasmSha256: string;
}

function parseArtifactManifest(value: unknown): ArtifactManifest {
	if (
		!isRecord(value) || value.schemaVersion !== 1 ||
		value.wasmPackage !== "@imagemagick/magick-wasm" ||
		typeof value.wasmPackageVersion !== "string" ||
		typeof value.packageLockPath !== "string" ||
		typeof value.packageLockKey !== "string" ||
		typeof value.packageIntegrity !== "string" ||
		typeof value.wasmRelativePath !== "string" ||
		typeof value.wasmBytes !== "number" || !Number.isSafeInteger(value.wasmBytes) ||
		typeof value.wasmSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.wasmSha256)
	) throw new Error("resource artifact manifest contract is invalid");
	return {
		wasmPackage: value.wasmPackage,
		wasmPackageVersion: value.wasmPackageVersion,
		packageLockPath: value.packageLockPath,
		packageLockKey: value.packageLockKey,
		packageIntegrity: value.packageIntegrity,
		wasmRelativePath: value.wasmRelativePath,
		wasmBytes: value.wasmBytes,
		wasmSha256: value.wasmSha256,
	};
}

function parsePackageLock(
	value: unknown,
	packageLockKey: string
): { readonly version: string; readonly integrity: string } {
	const entry = isRecord(value) && isRecord(value.packages) ? value.packages[packageLockKey] : undefined;
	if (!isRecord(entry) || typeof entry.version !== "string" || typeof entry.integrity !== "string") {
		throw new Error("deterministic package-lock entry is missing");
	}
	return { version: entry.version, integrity: entry.integrity };
}
