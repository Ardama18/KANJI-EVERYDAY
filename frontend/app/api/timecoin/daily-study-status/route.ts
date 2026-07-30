import { handleTimeCoinDailyStudyStatusRoute } from "@/lib/timecoin/daily-study-status-route";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
	return await handleTimeCoinDailyStudyStatusRoute(request);
}

export async function OPTIONS(request: Request): Promise<Response> {
	return await handleTimeCoinDailyStudyStatusRoute(request);
}

export async function POST(request: Request): Promise<Response> {
	return await handleTimeCoinDailyStudyStatusRoute(request);
}

export async function PUT(request: Request): Promise<Response> {
	return await handleTimeCoinDailyStudyStatusRoute(request);
}

export async function PATCH(request: Request): Promise<Response> {
	return await handleTimeCoinDailyStudyStatusRoute(request);
}

export async function DELETE(request: Request): Promise<Response> {
	return await handleTimeCoinDailyStudyStatusRoute(request);
}
