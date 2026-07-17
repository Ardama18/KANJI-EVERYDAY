import { readFile } from "node:fs/promises";

import { createBrowserClient } from "../../../../frontend/node_modules/@supabase/ssr/dist/module/index.js";

import { hashImportRequest } from "../../../../frontend/src/lib/ai-import/canonical-request";
import {
	parseCommitAsyncResponse,
	parseImportStatusResponse,
} from "../../../../frontend/src/lib/ai-import/async-contract";
import { signPreviewToken } from "../../../../frontend/src/lib/ai-import/preview-token";
import { resolveProviderEndpointBinding } from "../../../../supabase/functions/_shared/ai-card-import/provider.ts";
import {
	assertOwnerProjectionBoundary,
	fetchServiceOwnerRows,
} from "./helpers/s11-real-e2e-data-boundary";

const required = [
	"S11_REAL_APP_BASE_URL",
	"S11_REAL_EDGE_BASE_URL",
	"S11_REAL_SUPABASE_URL",
	"S11_REAL_USER_EMAIL",
	"S11_REAL_USER_PASSWORD",
	"S11_REAL_USER_B_EMAIL",
	"S11_REAL_USER_B_PASSWORD",
	"S11_REAL_PREVIEW_HMAC_SECRET",
	"S11_REAL_WORKER_SECRET",
	"S11_REAL_STAGING_SUPPORT_SECRET",
	"S11_REAL_ANON_KEY",
	"S11_REAL_SERVICE_ROLE_KEY",
	"S11_REAL_SOURCE_FIXTURE_PATH",
	"S11_REAL_FAKE_PROVIDER_STATS_URL",
	"S11_REAL_FAKE_PROVIDER_CONTROL_URL",
	"S11_REAL_FAKE_PROVIDER_ENDPOINT",
	"S11_REAL_PROVIDER_ENDPOINT_BINDING",
	"S11_REAL_RUNTIME_LOGS_URL",
	"S11_REAL_RECOVERABLE_WORKER_URL",
	"S11_REAL_WORKER_ARTIFACT_SHA256",
	"S11_REAL_MAIN_WORKER_ARTIFACT_ATTESTATION_URL",
	"S11_REAL_RECOVERABLE_WORKER_ARTIFACT_ATTESTATION_URL",
	"S11_REAL_PROVIDER_SECRET_MARKER",
] as const;
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length > 0) {
	process.stderr.write(
		`${JSON.stringify({ gate: "s11-real-e2e", status: "not_run", reason: `required environment missing: ${missing.join(",")}; mock fallback is forbidden` })}\n`
	);
	process.exit(2);
}

const appBase = requiredEnvironment("S11_REAL_APP_BASE_URL").replace(/\/$/u, "");
const edgeBase = requiredEnvironment("S11_REAL_EDGE_BASE_URL").replace(/\/$/u, "");
const productionWorkerUrl = `${edgeBase}/functions/v1/ai-card-import-worker`;
const recoverableWorkerUrl = requiredEnvironment("S11_REAL_RECOVERABLE_WORKER_URL");
const supabaseBase = requiredEnvironment("S11_REAL_SUPABASE_URL").replace(/\/$/u, "");
const anonKey = requiredEnvironment("S11_REAL_ANON_KEY");
const serviceRoleKey = requiredEnvironment("S11_REAL_SERVICE_ROLE_KEY");
const stagingSupportHeaders = {
	"x-s11-staging-support-secret": requiredEnvironment("S11_REAL_STAGING_SUPPORT_SECRET"),
} as const;
const expectedProviderBinding = resolveProviderEndpointBinding({
	ILLUSTRATION_PROVIDER_ENDPOINT: requiredEnvironment("S11_REAL_FAKE_PROVIDER_ENDPOINT"),
	ILLUSTRATION_PROVIDER_ENDPOINT_BINDING: requiredEnvironment(
		"S11_REAL_PROVIDER_ENDPOINT_BINDING"
	),
});
if (!("endpoint" in expectedProviderBinding)) {
	throw new Error("real E2E fake provider endpoint binding is required");
}
await assertWorkerArtifactIdentity();
const ownerA = await signInWithSsrCookies(
	requiredEnvironment("S11_REAL_USER_EMAIL"),
	requiredEnvironment("S11_REAL_USER_PASSWORD")
);
const ownerB = await signInWithSsrCookies(
	requiredEnvironment("S11_REAL_USER_B_EMAIL"),
	requiredEnvironment("S11_REAL_USER_B_PASSWORD")
);
const userId = ownerA.userId;
if (ownerB.userId === userId) throw new Error("real E2E users A and B must be different owners");
await assertAppSessionAuthenticated(ownerA, "owner-A");
await assertAppSessionAuthenticated(ownerB, "owner-B");
const postgrestAHeaders = {
	Authorization: `Bearer ${ownerA.accessToken}`,
	"Content-Type": "application/json",
};
const postgrestBHeaders = {
	Authorization: `Bearer ${ownerB.accessToken}`,
	"Content-Type": "application/json",
};
const serviceHeaders = {
	Authorization: `Bearer ${serviceRoleKey}`,
	apikey: serviceRoleKey,
	"Content-Type": "application/json",
};
const postgrestBoundary = { fetch, supabaseBase, anonKey } as const;
const workerHeaders = { "x-ai-worker-secret": requiredEnvironment("S11_REAL_WORKER_SECRET") };
const runId = crypto.randomUUID();
const providerBodyMarker = `s11-provider-body-${runId}`;
await setFakeProviderMode("success", providerBodyMarker);
const sourceBytes = new Uint8Array(
	await readFile(requiredEnvironment("S11_REAL_SOURCE_FIXTURE_PATH"))
);
if (sourceBytes.byteLength < 1 || sourceBytes.byteLength > 10 * 1024 * 1024) {
	throw new Error("source fixture must be a real image of at most 10 MiB");
}

const providerCallsBefore = await fakeProviderCalls();
const objectPathsBefore = new Set(
	(await serviceOwnerObjects(userId)).map((row) => row.storage_path)
);
await assertServiceRpcDenied(anonKey, "anon");
await assertServiceRpcDenied(ownerA.accessToken, "authenticated");

const prepared = await prepareSource(`real-e2e-${runId}`, sourceBytes.byteLength);
await uploadSignedSource(prepared.path, prepared.token, sourceBytes);
const completedSource = await fetchApp(ownerA, "/api/ai/imports/sources/complete", {
	method: "POST",
	body: JSON.stringify({ uploadId: prepared.uploadId }),
});
if (completedSource.status !== 200) {
	throw new Error(
		`authenticated source completion through the real codec failed: ${completedSource.status}`
	);
}
const liveSourceUrl = storageObjectUrl("ai-card-sources", `${userId}/${prepared.uploadId}/source`);
const liveSource = await fetch(liveSourceUrl, { headers: serviceHeaders });
if (liveSource.status !== 200 || (await liveSource.arrayBuffer()).byteLength === 0) {
	throw new Error(`owner-A live source was not readable at the service boundary: ${liveSource.status}`);
}
await assertStorageDenied(liveSourceUrl, anonKey, "anon live source");
await assertStorageDenied(liveSourceUrl, ownerB.accessToken, "owner-B live source");
await assertCrossOwnerUploadCommitDenied(prepared.uploadId, runId);

const request = buildRequest(runId, prepared.uploadId);
const runtimeSensitiveMarkers = [
	providerBodyMarker,
	...request.items.flatMap((item) => [item.front, item.back]),
	Buffer.from(sourceBytes).toString("base64").slice(0, 64),
];
const importRequestHash = await hashImportRequest(request);
const cardReservationKey = `s11-real-card-${runId}`;
await serviceRpc("reserve_provider_usage", {
	p_owner_user_id: userId,
	p_reservation_key: cardReservationKey,
	p_kind: "card_generation",
	p_source: "app_ai",
	p_generation_request_hash: importRequestHash,
	p_units: request.items.length,
	p_batch_id: null,
	p_item_id: null,
	p_concept_id: null,
}, 200);
const previewToken = await signPreviewToken(
	{ userId, reservationKey: cardReservationKey, importRequestHash },
	requiredEnvironment("S11_REAL_PREVIEW_HMAC_SECRET"),
	Math.floor(Date.now() / 1000)
);
const started = performance.now();
const commit = await fetchApp(ownerA, "/api/ai/imports/commit", {
	method: "POST",
	body: JSON.stringify({
		idempotencyKey: `s11-real-${runId}`,
		importRequestHash,
		cardReservationKey,
		previewToken,
		request,
	}),
});
const elapsedMs = performance.now() - started;
if (commit.status !== 202 || elapsedMs >= 2_000) {
	throw new Error(`commit boundary failed: ${commit.status}/${elapsedMs}`);
}
const committed = parseCommitAsyncResponse(await commit.json());
if (committed === undefined || committed.status !== "queued" ||
	committed.statusUrl !== `/api/ai/imports/status?batchId=${committed.batchId}`) {
	throw new Error("strict commit response contract failed");
}
const queuedSnapshot = await batchSideEffectSnapshot(committed.batchId);
const retryCommit = await fetchApp(ownerA, "/api/ai/imports/commit", {
	method: "POST",
	body: JSON.stringify({
		idempotencyKey: `s11-real-${runId}`,
		importRequestHash,
		cardReservationKey,
		previewToken,
		request,
	}),
});
const retryCommitted = retryCommit.status === 202
	? parseCommitAsyncResponse(await retryCommit.json())
	: undefined;
if (retryCommitted === undefined || JSON.stringify(retryCommitted) !== JSON.stringify(committed)) {
	throw new Error("idempotent commit retry did not return the exact same allowlisted DTO");
}
const queuedByBatch = await fetchStrictStatus(ownerA, `batchId=${encodeURIComponent(committed.batchId)}`);
const queuedByKey = await fetchStrictStatus(ownerA, `idempotencyKey=${encodeURIComponent(`s11-real-${runId}`)}`);
if (JSON.stringify(queuedByBatch) !== JSON.stringify(queuedByKey)) {
	throw new Error("queued reconnect by batch and idempotency key returned different snapshots");
}
if (JSON.stringify(await batchSideEffectSnapshot(committed.batchId)) !== JSON.stringify(queuedSnapshot)) {
	throw new Error("idempotent reconnect created duplicate pre-worker side effects");
}

let terminalStatus: ReturnType<typeof parseImportStatusResponse>;
for (let index = 0; index < 12; index += 1) {
	const worker = await fetch(`${edgeBase}/functions/v1/ai-card-import-worker`, {
		method: "POST",
		headers: workerHeaders,
	});
	if (worker.status !== 200) throw new Error(`served worker failed: ${worker.status}`);
	const status = await fetchApp(
		ownerA,
		`/api/ai/imports/status?batchId=${encodeURIComponent(committed.batchId)}`
	);
	if (status.status !== 200) throw new Error(`status recovery failed: ${status.status}`);
	const body = parseImportStatusResponse(await status.json());
	if (body !== undefined && ["completed", "partial", "failed"].includes(body.status)) {
		terminalStatus = body;
		break;
	}
	await new Promise((resolve) => setTimeout(resolve, 250));
}
if (terminalStatus?.status !== "completed") {
	throw new Error(
		`served worker did not complete both upload and AI concepts: ${String(terminalStatus?.status)}`
	);
}
const terminalByKey = await fetchStrictStatus(
	ownerA,
	`idempotencyKey=${encodeURIComponent(`s11-real-${runId}`)}`
);
if (JSON.stringify(terminalByKey) !== JSON.stringify(terminalStatus)) {
	throw new Error("terminal reconnect by idempotency key was not full-snapshot equal");
}
const terminalSnapshot = await batchSideEffectSnapshot(committed.batchId);
const terminalRetry = await fetchApp(ownerA, "/api/ai/imports/commit", {
	method: "POST",
	body: JSON.stringify({
		idempotencyKey: `s11-real-${runId}`,
		importRequestHash,
		cardReservationKey,
		previewToken,
		request,
	}),
});
const terminalRetryDto = terminalRetry.status === 202
	? parseCommitAsyncResponse(await terminalRetry.json())
	: undefined;
if (terminalRetryDto === undefined || terminalRetryDto.batchId !== committed.batchId ||
	JSON.stringify(await batchSideEffectSnapshot(committed.batchId)) !== JSON.stringify(terminalSnapshot)) {
	throw new Error("terminal commit retry duplicated a persisted side effect");
}
const providerCallsAfter = await fakeProviderCalls(true);
if (providerCallsAfter !== providerCallsBefore + 1) {
	throw new Error(
		`fake provider boundary was not exercised exactly once: ${providerCallsBefore}/${providerCallsAfter}`
	);
}

const ownerRows = await serviceOwnerObjects(userId);
const newReadyRows = ownerRows.filter(
	(row) => row.state === "ready" && !objectPathsBefore.has(row.storage_path)
);
if (newReadyRows.length !== 2) {
	throw new Error(`expected two real Edge codec outputs, found ${newReadyRows.length}`);
}
await assertOwnerProjectionBoundary(
	{
		...postgrestBoundary,
		ownerHeaders: postgrestAHeaders,
		otherOwnerHeaders: postgrestBHeaders,
	},
	newReadyRows[0]?.id ?? ""
);
let managedFixtureBytes: Uint8Array | undefined;
for (const row of newReadyRows) {
	if (!row.storage_path.startsWith(`${userId}/s11-managed/`)) {
		throw new Error("served worker wrote outside the reserved S-11 managed path");
	}
	const objectUrl = storageObjectUrl("illustrations", row.storage_path);
	const serviceRead = await fetch(objectUrl, { headers: serviceHeaders });
	const objectBytes = new Uint8Array(await serviceRead.arrayBuffer());
	if (serviceRead.status !== 200 || objectBytes.byteLength === 0) {
		throw new Error(`private output Storage read failed: ${serviceRead.status}`);
	}
	managedFixtureBytes ??= objectBytes;
	await assertStorageDenied(objectUrl, anonKey, "anon");
	await assertStorageDenied(objectUrl, ownerB.accessToken, "owner-B");
}
if (managedFixtureBytes === undefined) throw new Error("managed Storage fixture bytes were absent");
await assertManagedStorageMutationBoundary(newReadyRows[0].storage_path, managedFixtureBytes);
const sourceUrl = storageObjectUrl("ai-card-sources", `${userId}/${prepared.uploadId}/source`);
const deletedSource = await fetch(sourceUrl, { headers: serviceHeaders });
await assertStorageObjectNotFound(deletedSource, "terminal upload consumer source");

const ownerBStatus = await fetchApp(
	ownerB,
	`/api/ai/imports/status?batchId=${encodeURIComponent(committed.batchId)}`
);
await assertAppNotFound(ownerBStatus, "owner-B status isolation");

const uploadConcept = request.items[0]?.conceptId;
const sharedItems = terminalStatus.items.filter((item) => item.conceptId === uploadConcept);
if (sharedItems.length !== 2 || sharedItems.some((item) => item.cardId === undefined)) {
	throw new Error("terminal status did not expose the two allowlisted shared-illustration card IDs");
}
const sharedPath = await cardIllustrationPath(sharedItems[0]?.cardId ?? "");
if (sharedPath !== await cardIllustrationPath(sharedItems[1]?.cardId ?? "")) {
	throw new Error("R1/W1 cards did not share one illustration object");
}
await deleteOwnerCard(sharedItems[0]?.cardId ?? "");
await invokeCleanup();
const afterFirstDelete = await fetch(storageObjectUrl("illustrations", sharedPath), { headers: serviceHeaders });
if (afterFirstDelete.status !== 200) {
	throw new Error("first shared-card deletion removed the still-referenced object");
}
await assertStorageDenied(storageObjectUrl("illustrations", sharedPath), ownerB.accessToken, "owner-B shared object");
await deleteOwnerCard(sharedItems[1]?.cardId ?? "");
let sharedRemoved = false;
for (let index = 0; index < 12; index += 1) {
	await invokeCleanup();
	const object = await fetch(storageObjectUrl("illustrations", sharedPath), { headers: serviceHeaders });
	if (object.status === 200) continue;
	await assertStorageObjectNotFound(object, "last-reference shared illustration");
	sharedRemoved = true;
	break;
}
if (!sharedRemoved) throw new Error("last shared-card deletion did not remove the object");

const retryScenario = await runProviderRuntimeScenario("transient_once", runId);
const permanentScenario = await runProviderRuntimeScenario("permanent", runId);
const recoverableInvocationId = await runRecoverableWorkerScenario();
runtimeSensitiveMarkers.push(...retryScenario.sensitiveMarkers, ...permanentScenario.sensitiveMarkers);
await assertRuntimeLogs(
	runId,
	permanentScenario.batchId,
	recoverableInvocationId,
	runtimeSensitiveMarkers
);

process.stdout.write(
	`${JSON.stringify({
		gate: "s11-real-e2e",
		status: "passed",
		commitMs: elapsedMs,
		boundaries: [
			"pre-worker-source-owner-isolation",
			"cross-owner-upload-commit-denial",
			"authenticated-source-upload",
			"authenticated-commit",
			"strict-commit-status-dto",
			"batch-key-reconnect-snapshot",
			"duplicate-side-effect-snapshot",
			"postgrest-rpc-roles",
			"postgrest-rls",
			"pgmq",
			"served-worker",
			"fake-provider",
			"exact-edge-codec",
			"private-storage-output",
			"managed-storage-owner-mutation-denial",
			"legacy-storage-owner-mutation-compatibility",
			"served-provider-endpoint-binding",
			"source-lifecycle",
			"shared-reference-delete-lifecycle",
			"served-cleanup",
			"runtime-success-retry-permanent-cleanup-log-scan",
			"served-recoverable-worker-log-correlation",
			"immutable-worker-artifact-attestation",
		],
	})}\n`
);

async function runProviderRuntimeScenario(
	mode: "transient_once" | "permanent",
	id: string
): Promise<{ readonly batchId: string; readonly sensitiveMarkers: readonly string[] }> {
	const suffix = `${mode}-${id.slice(0, 8)}`;
	const responseMarker = `s11-${mode}-provider-body-${id}`;
	await setFakeProviderMode(mode, responseMarker);
	const scenarioRequest = {
		deck: { create: { name: `S11 ${suffix}` } },
		items: [{
			clientItemId: `item-${suffix}`,
			conceptId: `concept-${suffix}`,
			pattern: "R1",
			front: `front-${suffix}`,
			back: `back-${suffix}`,
			tags: [],
			image: { mode: "ai" },
		}],
	};
	const requestHash = await hashImportRequest(scenarioRequest);
	const reservationKey = `reservation-${suffix}`;
	await serviceRpc("reserve_provider_usage", {
		p_owner_user_id: userId,
		p_reservation_key: reservationKey,
		p_kind: "card_generation",
		p_source: "app_ai",
		p_generation_request_hash: requestHash,
		p_units: 1,
		p_batch_id: null,
		p_item_id: null,
		p_concept_id: null,
	}, 200);
	const token = await signPreviewToken(
		{ userId, reservationKey, importRequestHash: requestHash },
		requiredEnvironment("S11_REAL_PREVIEW_HMAC_SECRET"),
		Math.floor(Date.now() / 1000)
	);
	const commitResponse = await fetchApp(ownerA, "/api/ai/imports/commit", {
		method: "POST",
		body: JSON.stringify({
			idempotencyKey: `s11-${suffix}`,
			importRequestHash: requestHash,
			cardReservationKey: reservationKey,
			previewToken: token,
			request: scenarioRequest,
		}),
	});
	const commitDto = commitResponse.status === 202
		? parseCommitAsyncResponse(await commitResponse.json())
		: undefined;
	if (commitDto === undefined) throw new Error(`${mode} runtime commit failed: ${commitResponse.status}`);
	let status: ReturnType<typeof parseImportStatusResponse> = undefined;
	for (let index = 0; index < 48; index += 1) {
		const worker = await fetch(`${edgeBase}/functions/v1/ai-card-import-worker`, {
			method: "POST",
			headers: workerHeaders,
		});
		if (worker.status !== 200) throw new Error(`${mode} served worker failed: ${worker.status}`);
		status = await fetchStrictStatus(ownerA, `batchId=${encodeURIComponent(commitDto.batchId)}`);
		if (["completed", "failed", "partial"].includes(status.status)) break;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	const expected = mode === "permanent" ? "failed" : "completed";
	if (status?.status !== expected) throw new Error(`${mode} runtime scenario did not reach ${expected}`);
	return {
		batchId: commitDto.batchId,
		sensitiveMarkers: [
		responseMarker,
		scenarioRequest.items[0].front,
		scenarioRequest.items[0].back,
	],
	};
}

async function runRecoverableWorkerScenario(): Promise<string> {
	const recoverable = new URL(recoverableWorkerUrl);
	const production = new URL(productionWorkerUrl);
	if (
		recoverableWorkerUrl === productionWorkerUrl ||
		recoverable.origin !== production.origin ||
		!recoverable.pathname.startsWith("/functions/v1/")
	) {
		throw new Error("recoverable worker must be a separate served instance of the same artifact");
	}
	const invocationId = crypto.randomUUID();
	const response = await fetch(recoverableWorkerUrl, {
		method: "POST",
		headers: {
			...workerHeaders,
			...stagingSupportHeaders,
			"x-ai-worker-invocation-id": invocationId,
		},
	});
	const body: unknown = await response.json();
	if (
		response.status !== 500 ||
		!isRecord(body) ||
		Object.keys(body).sort().join(",") !== "errorCode,invocationId" ||
		body.errorCode !== "INTERNAL_ERROR" ||
		body.invocationId !== invocationId
	) {
		throw new Error(`served recoverable worker probe failed: ${response.status}`);
	}
	return invocationId;
}

async function assertWorkerArtifactIdentity(): Promise<void> {
	const expectedDigest = requiredEnvironment("S11_REAL_WORKER_ARTIFACT_SHA256");
	if (!/^[0-9a-f]{64}$/u.test(expectedDigest)) {
		throw new Error("expected worker artifact SHA-256 is invalid");
	}
	const attestations = [
		{
			deploymentUrl: productionWorkerUrl,
			attestationUrl: requiredEnvironment("S11_REAL_MAIN_WORKER_ARTIFACT_ATTESTATION_URL"),
		},
		{
			deploymentUrl: recoverableWorkerUrl,
			attestationUrl: requiredEnvironment(
				"S11_REAL_RECOVERABLE_WORKER_ARTIFACT_ATTESTATION_URL"
			),
		},
	] as const;
	if (attestations[0].attestationUrl === attestations[1].attestationUrl) {
		throw new Error("worker deployments require independent immutable control-plane artifact attestations");
	}
	for (const { deploymentUrl, attestationUrl } of attestations) {
		const attestation = new URL(attestationUrl);
		if (attestation.origin === new URL(deploymentUrl).origin) {
			throw new Error("immutable control-plane artifact attestation must be independent of worker runtime");
		}
		const response = await fetch(attestation, { headers: stagingSupportHeaders });
		const body: unknown = await response.json();
		if (
			response.status !== 200 ||
			!isRecord(body) ||
			Object.keys(body).sort().join(",") !== "artifactSha256,deploymentUrl,immutable" ||
			body.deploymentUrl !== deploymentUrl ||
			body.artifactSha256 !== expectedDigest ||
			body.immutable !== true
		) {
			throw new Error("immutable control-plane artifact attestation did not match deployment");
		}
	}
}

async function setFakeProviderMode(
	mode: "success" | "transient_once" | "permanent",
	responseMarker: string
): Promise<void> {
	const response = await fetch(requiredEnvironment("S11_REAL_FAKE_PROVIDER_CONTROL_URL"), {
		method: "POST",
		headers: {
			...stagingSupportHeaders,
			"Content-Type": "application/json",
			"x-s11-provider-binding": expectedProviderBinding.binding,
		},
		body: JSON.stringify({
			mode,
			responseMarker,
			providerEndpoint: expectedProviderBinding.endpoint,
			binding: expectedProviderBinding.binding,
		}),
	});
	if (response.status !== 204) throw new Error(`fake provider control contract failed: ${response.status}`);
}

async function assertRuntimeLogs(
	runIdentifier: string,
	permanentBatchId: string,
	recoverableInvocationId: string,
	sensitiveMarkers: readonly string[]
): Promise<void> {
	const url = new URL(requiredEnvironment("S11_REAL_RUNTIME_LOGS_URL"));
	url.searchParams.set("runId", runIdentifier);
	const response = await fetch(url, { headers: stagingSupportHeaders });
	const body: unknown = await response.json();
	if (
		response.status !== 200 || !isRecord(body) || body.complete !== true ||
		!Array.isArray(body.logs) || !body.logs.every((line) => typeof line === "string")
	) throw new Error("configured runtime log capture contract is incomplete");
	const logLines = body.logs as string[];
	const logs = logLines.join("\n");
	for (const event of [
		"worker_success",
		"worker_retry",
		"worker_failure",
		"worker_recoverable",
		"cleanup",
	]) {
		if (!logs.includes(`\"event\":\"${event}\"`)) {
			throw new Error(`configured runtime logs did not capture ${event}`);
		}
	}
	const terminalFailureLines = logLines.filter((line) =>
		line.includes('"event":"worker_failure"')
	);
	const durableTerminalLines = new Map<string, string>();
	for (const line of terminalFailureLines) {
		const eventId = line.match(/"eventId":"([0-9a-f-]{36})"/iu)?.[1];
		if (eventId === undefined) throw new Error("terminal worker_failure lacked durable eventId");
		durableTerminalLines.set(eventId, line);
	}
	const uniqueTerminalLines = [...durableTerminalLines.values()];
	const correlatedTerminalLines = uniqueTerminalLines.filter((line) =>
		line.includes(`"batchId":"${permanentBatchId}"`)
	);
	if (correlatedTerminalLines.length !== 1) {
		throw new Error("terminal worker_failure count was not exactly one");
	}
	if (uniqueTerminalLines.length !== correlatedTerminalLines.length) {
		throw new Error("recoverable scenario emitted worker_failure");
	}
	const correlatedRecoverableLines = logLines.filter(
		(line) =>
			line.includes('"event":"worker_recoverable"') &&
			line.includes(`"invocationId":"${recoverableInvocationId}"`)
	);
	if (correlatedRecoverableLines.length !== 1) {
		throw new Error("correlated worker_recoverable count was not exactly one");
	}
	if (
		uniqueTerminalLines.some((line) =>
			line.includes(`"invocationId":"${recoverableInvocationId}"`)
		)
	) {
		throw new Error("correlated recoverable invocation emitted worker_failure");
	}
	const forbidden = [
		...sensitiveMarkers,
		requiredEnvironment("S11_REAL_PREVIEW_HMAC_SECRET"),
		requiredEnvironment("S11_REAL_WORKER_SECRET"),
		requiredEnvironment("S11_REAL_STAGING_SUPPORT_SECRET"),
		requiredEnvironment("S11_REAL_ANON_KEY"),
		requiredEnvironment("S11_REAL_SERVICE_ROLE_KEY"),
		requiredEnvironment("S11_REAL_PROVIDER_SECRET_MARKER"),
	];
	for (const marker of forbidden) {
		if (marker.length > 0 && logs.includes(marker)) throw new Error("forbidden runtime log marker detected");
	}
	if (/Authorization|Bearer\s+|b64_json|inlineData|responseBody|requestBody/iu.test(logs) ||
		/"version"\s*:\s*1[^\n]*"jobId"[^\n]*"batchId"/u.test(logs)) {
		throw new Error("forbidden Authorization/provider body/whole queue payload detected in runtime logs");
	}
}

async function assertCrossOwnerUploadCommitDenied(uploadId: string, id: string): Promise<void> {
	const suffix = id.slice(0, 8);
	const crossOwnerRequest = {
		deck: { create: { name: `S11 cross owner ${suffix}` } },
		items: [{
			clientItemId: `cross-${suffix}`,
			conceptId: `cross-${suffix}`,
			pattern: "R1",
			front: `cross-front-${suffix}`,
			back: `cross-back-${suffix}`,
			tags: [],
			image: { mode: "upload", uploadId },
		}],
	};
	const requestHash = await hashImportRequest(crossOwnerRequest);
	const reservationKey = `s11-cross-owner-${id}`;
	await serviceRpc("reserve_provider_usage", {
		p_owner_user_id: ownerB.userId,
		p_reservation_key: reservationKey,
		p_kind: "card_generation",
		p_source: "app_ai",
		p_generation_request_hash: requestHash,
		p_units: 1,
		p_batch_id: null,
		p_item_id: null,
		p_concept_id: null,
	}, 200);
	const token = await signPreviewToken(
		{ userId: ownerB.userId, reservationKey, importRequestHash: requestHash },
		requiredEnvironment("S11_REAL_PREVIEW_HMAC_SECRET"),
		Math.floor(Date.now() / 1000)
	);
	const response = await fetchApp(ownerB, "/api/ai/imports/commit", {
		method: "POST",
		body: JSON.stringify({
			idempotencyKey: `s11-cross-owner-${id}`,
			importRequestHash: requestHash,
			cardReservationKey: reservationKey,
			previewToken: token,
			request: crossOwnerRequest,
		}),
	});
	const body: unknown = await response.json();
	if (
		response.status !== 409 || !isRecord(body) || !isRecord(body.error) ||
		body.error.code !== "CONFLICT"
	) throw new Error("owner-B cross-owner upload commit did not return exact HTTP 409/CONFLICT");
}

async function fetchStrictStatus(session: AppSession, selector: string) {
	const response = await fetchApp(session, `/api/ai/imports/status?${selector}`);
	const parsed = response.status === 200 ? parseImportStatusResponse(await response.json()) : undefined;
	if (parsed === undefined) throw new Error(`strict status DTO failed for ${selector}: ${response.status}`);
	return parsed;
}

async function batchSideEffectSnapshot(batchId: string): Promise<Readonly<Record<string, unknown>>> {
	const items = await fetchInternalRows(
		`ai_import_items?select=id,concept_id,status,result_card_id,error_code&batch_id=eq.${batchId}`
	);
	const jobs = await fetchInternalRows(
		`ai_import_concept_jobs?select=id,state,queue_message_id,attempt,illustration_id&batch_id=eq.${batchId}`
	);
	const jobIds = jobs.map((row) => String(row.id));
	const objects = jobIds.length === 0 ? [] : await fetchInternalRows(
		`ai_illustration_objects?select=id,job_id,illustration_id,storage_path,state&job_id=in.(${jobIds.join(",")})`
	);
	const reservations = await fetchInternalRows(
		`ai_quota_reservations?select=id,reservation_key,kind,units,status&batch_id=eq.${batchId}`
	);
	const cardIds = items.flatMap((row) => typeof row.result_card_id === "string" ? [row.result_card_id] : []);
	const cards = cardIds.length === 0 ? [] : await fetchInternalRows(
		`cards?select=id,card_key,illustration_key&id=in.(${cardIds.join(",")})`
	);
	return {
		items: sortRows(items),
		jobs: sortRows(jobs),
		objects: sortRows(objects),
		reservations: sortRows(reservations),
		cards: sortRows(cards),
	};
}

async function fetchInternalRows(pathAndQuery: string): Promise<Record<string, unknown>[]> {
	return await fetchServiceOwnerRows(postgrestBoundary, serviceHeaders, userId, pathAndQuery);
}

function sortRows(rows: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
	return [...rows].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

async function cardIllustrationPath(cardId: string): Promise<string> {
	const cards = await fetchInternalRows(
		`cards?select=illustration_key&id=eq.${encodeURIComponent(cardId)}`
	);
	const illustrationKey = cards[0]?.illustration_key;
	if (cards.length !== 1 || typeof illustrationKey !== "string") {
		throw new Error("shared card illustration lookup failed");
	}
	const illustrations = await fetchInternalRows(
		`illustrations?select=storage_path&illustration_key=eq.${encodeURIComponent(illustrationKey)}`
	);
	const storagePath = illustrations[0]?.storage_path;
	if (illustrations.length !== 1 || typeof storagePath !== "string") {
		throw new Error("shared illustration Storage path lookup failed");
	}
	return storagePath;
}

async function deleteOwnerCard(cardId: string): Promise<void> {
	const response = await fetch(`${supabaseBase}/rest/v1/cards?id=eq.${encodeURIComponent(cardId)}`, {
		method: "DELETE",
		headers: { ...postgrestAHeaders, apikey: anonKey },
	});
	if (response.status !== 204) throw new Error(`owner card deletion failed: ${response.status}`);
}

async function invokeCleanup(): Promise<void> {
	const response = await fetch(`${edgeBase}/functions/v1/ai-card-import-cleanup`, {
		method: "POST",
		headers: workerHeaders,
	});
	if (response.status !== 200) throw new Error(`served cleanup failed: ${response.status}`);
}

async function prepareSource(uploadKey: string, byteSize: number): Promise<PreparedSource> {
	const response = await fetchApp(ownerA, "/api/ai/imports/sources/prepare", {
		method: "POST",
		body: JSON.stringify({
			sources: [{ uploadKey, declaredMime: "image/png", byteSize }],
		}),
	});
	const body: unknown = await response.json();
	const row = isRecord(body) && Array.isArray(body.uploads) ? body.uploads[0] : undefined;
	if (response.status !== 201 || !isPreparedSource(row)) {
		throw new Error(`authenticated source prepare failed: ${response.status}`);
	}
	return row;
}

async function signInWithSsrCookies(email: string, password: string): Promise<AppSession> {
	const cookies = new SsrCookieJar();
	const client = createBrowserClient(supabaseBase, anonKey, {
		cookies: {
			getAll: () => cookies.getAll(),
			setAll: (values: readonly { name: string; value: string }[]) => cookies.setAll(values),
		},
	});
	const { data, error } = await client.auth.signInWithPassword({ email, password });
	if (error !== null || data.session === null || data.user === null) {
		throw new Error("real Supabase password login failed");
	}
	const verified = await client.auth.getUser(data.session.access_token);
	if (verified.error !== null || verified.data.user?.id !== data.user.id || cookies.isEmpty()) {
		throw new Error("real Supabase SSR session/cookie establishment failed");
	}
	return {
		accessToken: data.session.access_token,
		userId: data.user.id,
		cookies,
	};
}

async function assertAppSessionAuthenticated(session: AppSession, label: string): Promise<void> {
	const response = await fetchApp(session, `/api/ai/imports/status?batchId=${crypto.randomUUID()}`);
	await assertAppNotFound(response, `${label} Supabase SSR cookie boundary`);
}

async function fetchApp(
	session: AppSession,
	path: string,
	init: RequestInit = {}
): Promise<Response> {
	const headers = new Headers(init.headers);
	headers.set("Cookie", session.cookies.header());
	headers.set("Content-Type", "application/json");
	if (headers.has("Authorization")) {
		throw new Error(
			"Next app routes must authenticate from Supabase SSR cookies, not Authorization"
		);
	}
	const response = await fetch(`${appBase}${path}`, { ...init, headers });
	session.cookies.absorb(response.headers);
	return response;
}

async function uploadSignedSource(path: string, token: string, bytes: Uint8Array): Promise<void> {
	const response = await fetch(
		`${supabaseBase}/storage/v1/object/upload/sign/ai-card-sources/${encodePath(path)}?token=${encodeURIComponent(token)}`,
		{
			method: "PUT",
			headers: { "Content-Type": "image/png", "x-upsert": "false" },
			body: ownedArrayBuffer(bytes),
		}
	);
	if (response.status !== 200)
		throw new Error(`signed private Storage upload failed: ${response.status}`);
}

async function serviceRpc(
	name: string,
	args: Readonly<Record<string, unknown>>,
	expectedStatus: 200 | 204
): Promise<unknown> {
	const response = await fetch(`${supabaseBase}/rest/v1/rpc/${name}`, {
		method: "POST",
		headers: serviceHeaders,
		body: JSON.stringify(args),
	});
	if (response.status !== expectedStatus)
		throw new Error(`service PostgREST RPC ${name} failed: ${response.status}`);
	return response.status === 204 ? undefined : await response.json();
}

async function assertServiceRpcDenied(jwt: string, role: string): Promise<void> {
	const response = await fetch(`${supabaseBase}/rest/v1/rpc/read_ai_import_queue`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${jwt}`,
			apikey: anonKey,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ p_visibility_seconds: 300, p_quantity: 1 }),
	});
	const body: unknown = await response.json();
	if (response.status !== 404 || !isRecord(body) || body.code !== "PGRST202") {
		throw new Error(
			`${role} service-only pgmq RPC denial contract failed: ${response.status}/${String(isRecord(body) ? body.code : undefined)}`
		);
	}
}

async function serviceOwnerObjects(ownerId: string): Promise<IllustrationObject[]> {
	const body = await fetchServiceOwnerRows(
		postgrestBoundary,
		serviceHeaders,
		ownerId,
		"ai_illustration_objects?select=id,storage_path,state&order=created_at.asc"
	);
	return body.map((row) => {
		if (!isIllustrationObject(row)) {
			throw new Error("service-role owner-scoped illustration response contract failed");
		}
		return row;
	});
}

async function assertStorageDenied(objectUrl: string, jwt: string, role: string): Promise<void> {
	const response = await fetch(objectUrl, {
		headers: { Authorization: `Bearer ${jwt}`, apikey: anonKey },
	});
	await assertStorageObjectNotFound(response, `${role} private illustration denial`);
}

async function assertAppNotFound(response: Response, scenario: string): Promise<void> {
	const body: unknown = await response.json();
	if (
		response.status !== 404 ||
		!isRecord(body) ||
		!isRecord(body.error) ||
		body.error.code !== "NOT_FOUND"
	) {
		throw new Error(`${scenario} did not return exact HTTP 404/NOT_FOUND`);
	}
}

async function assertStorageObjectNotFound(response: Response, scenario: string): Promise<void> {
	const body: unknown = await response.json();
	if (
		response.status !== 400 ||
		!isRecord(body) ||
		body.statusCode !== "404" ||
		body.error !== "not_found"
	) {
		throw new Error(
			`${scenario} did not return exact Storage HTTP 400/404/not_found contract`
		);
	}
}

async function fakeProviderCalls(requireCurrentBinding = false): Promise<number> {
	const response = await fetch(requiredEnvironment("S11_REAL_FAKE_PROVIDER_STATS_URL"), {
		headers: stagingSupportHeaders,
	});
	const body: unknown = await response.json();
	if (
		response.status !== 200 ||
		!isRecord(body) ||
		!Number.isSafeInteger(body.calls) ||
		(requireCurrentBinding && body.lastBinding !== expectedProviderBinding.binding)
	) {
		throw new Error(`fake provider stats contract failed: ${response.status}`);
	}
	return body.calls as number;
}

async function assertManagedStorageMutationBoundary(
	fixturePath: string,
	bytes: Uint8Array
): Promise<void> {
	const fixtureUrl = storageObjectUrl("illustrations", fixturePath);
	await assertStorageMutationSucceeded(
		fixtureUrl,
		serviceRoleKey,
		undefined,
		false,
		"service delete before owner INSERT gate",
		"DELETE"
	);
	for (const [role, jwt] of [
		["owner-A", ownerA.accessToken],
		["owner-B", ownerB.accessToken],
		["anonymous", anonKey],
	] as const) {
		await assertStorageMutationDenied(
			fixtureUrl,
			jwt,
			"POST",
			false,
			bytes,
			`${role} managed INSERT`
		);
	}
	await assertStorageMutationSucceeded(fixtureUrl, serviceRoleKey, bytes, false, "service restore");
	for (const [role, jwt] of [
		["owner-A", ownerA.accessToken],
		["owner-B", ownerB.accessToken],
		["anonymous", anonKey],
	] as const) {
		await assertStorageMutationDenied(
			fixtureUrl,
			jwt,
			"POST",
			true,
			bytes,
			`${role} managed UPDATE`
		);
		await assertStorageMutationDenied(
			fixtureUrl,
			jwt,
			"DELETE",
			false,
			undefined,
			`${role} managed DELETE`
		);
	}

	const legacyUrl = storageObjectUrl(
		"illustrations",
		`${userId}/s11-managed/legacy-${crypto.randomUUID()}.png`
	);
	await assertStorageMutationSucceeded(legacyUrl, ownerA.accessToken, bytes, false, "legacy insert");
	await assertStorageMutationSucceeded(legacyUrl, ownerA.accessToken, bytes, true, "legacy update");
	await assertStorageMutationSucceeded(
		legacyUrl,
		ownerA.accessToken,
		undefined,
		false,
		"legacy delete",
		"DELETE"
	);
}

async function assertStorageMutationDenied(
	url: string,
	jwt: string,
	method: "POST" | "DELETE",
	upsert: boolean,
	bodyBytes: Uint8Array | undefined,
	scenario: string
): Promise<void> {
	const response = await fetch(url, {
		method,
		headers: {
			Authorization: `Bearer ${jwt}`,
			apikey: anonKey,
			...(method === "POST"
				? { "Content-Type": "image/png", "x-upsert": String(upsert) }
				: {}),
		},
		body: bodyBytes === undefined ? undefined : ownedArrayBuffer(bodyBytes),
	});
	const body: unknown = await response.json();
	if (
		response.status !== 403 ||
		!isRecord(body) ||
		body.statusCode !== "403" ||
		body.error !== "Unauthorized"
	) {
		throw new Error(`${scenario} did not return exact Storage HTTP 403/403/Unauthorized`);
	}
}

async function assertStorageMutationSucceeded(
	url: string,
	jwt: string,
	bodyBytes: Uint8Array | undefined,
	upsert: boolean,
	scenario: string,
	method: "POST" | "DELETE" = "POST"
): Promise<void> {
	const response = await fetch(url, {
		method,
		headers: {
			Authorization: `Bearer ${jwt}`,
			apikey: jwt === serviceRoleKey ? serviceRoleKey : anonKey,
			...(method === "POST"
				? { "Content-Type": "image/png", "x-upsert": String(upsert) }
				: {}),
		},
		body: bodyBytes === undefined ? undefined : ownedArrayBuffer(bodyBytes),
	});
	if (response.status !== 200) {
		throw new Error(`${scenario} failed exact Storage HTTP 200 contract: ${response.status}`);
	}
}

function buildRequest(id: string, uploadId: string) {
	const suffix = id.slice(0, 8);
	return {
		deck: { create: { name: `S11 real ${suffix}` } },
		items: [
			{
				clientItemId: `u-r-${suffix}`,
				conceptId: `upload-${suffix}`,
				pattern: "R1",
				front: `漢${suffix}`,
				back: `かん${suffix}`,
				tags: [],
				image: { mode: "upload", uploadId },
			},
			{
				clientItemId: `u-w-${suffix}`,
				conceptId: `upload-${suffix}`,
				pattern: "W1",
				front: `かん${suffix}`,
				back: `漢${suffix}`,
				tags: [],
				image: { mode: "upload", uploadId },
			},
			{
				clientItemId: `a-r-${suffix}`,
				conceptId: `ai-${suffix}`,
				pattern: "R1",
				front: `字${suffix}`,
				back: `じ${suffix}`,
				tags: [],
				image: { mode: "ai" },
			},
			{
				clientItemId: `a-w-${suffix}`,
				conceptId: `ai-${suffix}`,
				pattern: "W1",
				front: `じ${suffix}`,
				back: `字${suffix}`,
				tags: [],
				image: { mode: "ai" },
			},
		],
	};
}

function storageObjectUrl(bucket: string, path: string): string {
	return `${supabaseBase}/storage/v1/object/${bucket}/${encodePath(path)}`;
}

function encodePath(path: string): string {
	return path.split("/").map(encodeURIComponent).join("/");
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

interface PreparedSource {
	readonly uploadId: string;
	readonly path: string;
	readonly token: string;
}

interface AppSession {
	readonly accessToken: string;
	readonly userId: string;
	readonly cookies: SsrCookieJar;
}

class SsrCookieJar {
	readonly #values = new Map<string, string>();

	getAll(): { name: string; value: string }[] {
		return Array.from(this.#values, ([name, value]) => ({ name, value }));
	}

	setAll(values: readonly { name: string; value: string }[]): void {
		for (const { name, value } of values) {
			if (value.length === 0) this.#values.delete(name);
			else this.#values.set(name, value);
		}
	}

	header(): string {
		if (this.#values.size === 0) throw new Error("Supabase SSR cookie jar is empty");
		return Array.from(this.#values, ([name, value]) => `${name}=${value}`).join("; ");
	}

	isEmpty(): boolean {
		return this.#values.size === 0;
	}

	absorb(headers: Headers): void {
		const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
		const values = getSetCookie?.call(headers) ?? splitSetCookie(headers.get("set-cookie"));
		for (const value of values) {
			const pair = value.split(";", 1)[0];
			const separator = pair.indexOf("=");
			if (separator <= 0) continue;
			const name = pair.slice(0, separator).trim();
			const cookieValue = pair.slice(separator + 1).trim();
			if (cookieValue.length === 0) this.#values.delete(name);
			else this.#values.set(name, cookieValue);
		}
	}
}

function splitSetCookie(value: string | null): string[] {
	return value === null ? [] : value.split(/,(?=\s*[^;,=]+=[^;,]*)/u);
}

interface IllustrationObject {
	readonly id: string;
	readonly storage_path: string;
	readonly state: string;
}

function isPreparedSource(value: unknown): value is PreparedSource {
	return (
		isRecord(value) &&
		typeof value.uploadId === "string" &&
		typeof value.path === "string" &&
		typeof value.token === "string"
	);
}

function isIllustrationObject(value: unknown): value is IllustrationObject {
	return (
		isRecord(value) && typeof value.id === "string" && typeof value.storage_path === "string" &&
		typeof value.state === "string"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredEnvironment(name: (typeof required)[number]): string {
	const value = process.env[name]?.trim();
	if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
	return value;
}
