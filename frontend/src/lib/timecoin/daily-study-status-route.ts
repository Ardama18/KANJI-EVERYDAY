import {
	type DailyStudyStatusData,
	getDailyStudyStatusForActor,
} from "@/lib/deck/daily-study-status";
import {
	type TimeCoinApiEnvConfig,
	getTimeCoinApiEnvConfig,
	isTimeCoinApiEnabled,
} from "@/lib/env";
import { type JwtScopedSupabaseClient, createJwtScopedClient } from "@/lib/supabase/server";

import {
	type TimeCoinActorContext,
	authenticateTimeCoinRequest,
	createDefaultTimeCoinAuthDependencies,
	parseTimeCoinBearerToken,
} from "./auth";

const TIMECOIN_SCOPES = "openid email profile";

export interface TimeCoinDailyStatusRouteDependencies {
	readonly isEnabled: () => boolean;
	readonly getEnv: typeof getTimeCoinApiEnvConfig;
	readonly authenticate: (authorization: readonly string[]) => Promise<TimeCoinActorContext>;
	readonly parseToken: (authorization: readonly string[]) => string;
	readonly createClient: (accessToken: string) => JwtScopedSupabaseClient;
	readonly getStatus: (
		client: JwtScopedSupabaseClient,
		actor: Pick<TimeCoinActorContext, "userId">
	) => Promise<DailyStudyStatusData>;
}

export function createDefaultTimeCoinDailyStatusRouteDependencies(): TimeCoinDailyStatusRouteDependencies {
	return {
		isEnabled: isTimeCoinApiEnabled,
		getEnv: getTimeCoinApiEnvConfig,
		authenticate: async (authorization) =>
			await authenticateTimeCoinRequest(authorization, createDefaultTimeCoinAuthDependencies()),
		parseToken: parseTimeCoinBearerToken,
		createClient: createJwtScopedClient,
		getStatus: getDailyStudyStatusForActor,
	};
}

export async function handleTimeCoinDailyStudyStatusRoute(
	request: Request,
	dependencies: TimeCoinDailyStatusRouteDependencies = createDefaultTimeCoinDailyStatusRouteDependencies()
): Promise<Response> {
	if (!dependencies.isEnabled()) return unavailableResponse();

	let env: TimeCoinApiEnvConfig;
	try {
		env = dependencies.getEnv();
	} catch {
		return unavailableResponse();
	}
	if (!env.enabled) return unavailableResponse();

	const originBoundary = validateOrigin(request, env.allowedOrigin);
	if (originBoundary !== undefined) return originBoundary;
	if (request.method === "OPTIONS") return optionsResponse(request, env.allowedOrigin);
	if (request.method !== "GET") return methodNotAllowedResponse(request, env.allowedOrigin);
	if (new URL(request.url).search.length > 0)
		return jsonErrorResponse("bad_request", 400, request, env.allowedOrigin);
	if (!acceptsJson(request.headers.get("accept")))
		return jsonErrorResponse("not_acceptable", 406, request, env.allowedOrigin);

	const authorization = authorizationValues(request);
	let token: string;
	let actor: TimeCoinActorContext;
	try {
		token = dependencies.parseToken(authorization);
		actor = await dependencies.authenticate(authorization);
	} catch {
		return unauthorizedResponse(request, env.allowedOrigin);
	}

	try {
		const client = dependencies.createClient(token);
		const status = await dependencies.getStatus(client, { userId: actor.userId });
		return Response.json(projectDailyStudyStatus(status), {
			status: 200,
			headers: responseHeaders(request, env.allowedOrigin),
		});
	} catch {
		return jsonErrorResponse("internal_error", 500, request, env.allowedOrigin);
	}
}

function authorizationValues(request: Request): readonly string[] {
	const authorization = request.headers.get("authorization");
	return authorization === null ? [] : [authorization];
}

function validateOrigin(request: Request, allowedOrigin: string): Response | undefined {
	const origin = request.headers.get("origin");
	if (origin !== null && origin !== allowedOrigin) return forbiddenResponse();
	return undefined;
}

function acceptsJson(value: string | null): boolean {
	if (value === null) return true;
	return value
		.split(",")
		.map((part) => parseAcceptPart(part))
		.some(
			(part) =>
				part.quality > 0 &&
				(part.mediaType === "application/json" ||
					part.mediaType === "application/*" ||
					part.mediaType === "*/*")
		);
}

function parseAcceptPart(value: string): Readonly<{ mediaType: string; quality: number }> {
	const [mediaType = "", ...parameters] = value.split(";").map((part) => part.trim());
	const qualityParameter = parameters.find((parameter) => parameter.toLowerCase().startsWith("q="));
	if (qualityParameter === undefined) return { mediaType: mediaType.toLowerCase(), quality: 1 };
	const parsedQuality = Number(qualityParameter.slice(2).trim());
	return {
		mediaType: mediaType.toLowerCase(),
		quality:
			Number.isFinite(parsedQuality) && parsedQuality >= 0 && parsedQuality <= 1
				? parsedQuality
				: 0,
	};
}

function projectDailyStudyStatus(status: DailyStudyStatusData): DailyStudyStatusData {
	return {
		contractVersion: status.contractVersion,
		date: status.date,
		state: status.state,
		completed: status.completed,
	};
}

function unavailableResponse(): Response {
	return new Response(null, { status: 404, headers: noStoreHeaders() });
}

function forbiddenResponse(): Response {
	return Response.json({ error: "forbidden" }, { status: 403, headers: noStoreHeaders() });
}

function unauthorizedResponse(request: Request, allowedOrigin: string): Response {
	return Response.json(
		{ error: "unauthorized" },
		{
			status: 401,
			headers: {
				...responseHeaders(request, allowedOrigin),
				"WWW-Authenticate": `Bearer scope="${TIMECOIN_SCOPES}"`,
			},
		}
	);
}

function jsonErrorResponse(
	error: "bad_request" | "not_acceptable" | "internal_error",
	status: 400 | 406 | 500,
	request: Request,
	allowedOrigin: string
): Response {
	return Response.json({ error }, { status, headers: responseHeaders(request, allowedOrigin) });
}

function methodNotAllowedResponse(request: Request, allowedOrigin: string): Response {
	return new Response(null, {
		status: 405,
		headers: {
			...responseHeaders(request, allowedOrigin),
			Allow: "GET, OPTIONS",
		},
	});
}

function optionsResponse(request: Request, allowedOrigin: string): Response {
	return new Response(null, {
		status: 204,
		headers: {
			...responseHeaders(request, allowedOrigin),
			"Access-Control-Allow-Headers": "Authorization, Accept",
			"Access-Control-Allow-Methods": "GET, OPTIONS",
		},
	});
}

function responseHeaders(request: Request, allowedOrigin: string): Record<string, string> {
	return {
		...noStoreHeaders(),
		...corsHeaders(request, allowedOrigin),
	};
}

function noStoreHeaders(): Record<string, string> {
	return { "Cache-Control": "no-store" };
}

function corsHeaders(request: Request, allowedOrigin: string): Record<string, string> {
	return request.headers.get("origin") === allowedOrigin
		? { "Access-Control-Allow-Origin": allowedOrigin, Vary: "Origin" }
		: {};
}
