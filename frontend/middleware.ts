import { createMiddlewareClient } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const PROTECTED_ROUTE_PREFIXES = ["/decks", "/ai", "/oauth/connections"] as const;
export const GUEST_ONLY_ROUTES = ["/login", "/signup"] as const;
export const PUBLIC_ROUTES = ["/"] as const;
export const EXCLUDED_ROUTE_PREFIXES = ["/_next/static", "/_next/image"] as const;
export const EXCLUDED_ROUTES = ["/favicon.ico"] as const;

const isRoutePrefixMatch = (pathname: string, prefixes: readonly string[]) =>
	prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

export const isProtectedRoute = (pathname: string) =>
	isRoutePrefixMatch(pathname, PROTECTED_ROUTE_PREFIXES);

export const isGuestOnlyRoute = (pathname: string) =>
	GUEST_ONLY_ROUTES.some((route) => route === pathname);

export const isPublicRoute = (pathname: string) =>
	PUBLIC_ROUTES.some((route) => route === pathname);

export const isExcludedRoute = (pathname: string) =>
	isRoutePrefixMatch(pathname, EXCLUDED_ROUTE_PREFIXES) ||
	EXCLUDED_ROUTES.some((route) => route === pathname);

export async function middleware(request: NextRequest) {
	const { pathname } = request.nextUrl;

	if (isExcludedRoute(pathname) || isPublicRoute(pathname)) {
		return NextResponse.next();
	}

	const isProtected = isProtectedRoute(pathname);
	const isGuestOnly = isGuestOnlyRoute(pathname);
	if (!isProtected && !isGuestOnly) {
		return NextResponse.next();
	}

	const response = NextResponse.next();
	let supabase: ReturnType<typeof createMiddlewareClient>;
	try {
		supabase = createMiddlewareClient(request, response);
	} catch {
		if (isProtected) return NextResponse.redirect(new URL("/login", request.url));
		return response;
	}

	// Claims は補助情報として取得し、最終判定は getUser を使う。
	await supabase.auth.getClaims().catch(() => undefined);

	const {
		data: { user },
	} = await supabase.auth.getUser();

	if (!user && isProtected) {
		return NextResponse.redirect(new URL("/login", request.url));
	}

	if (user && isGuestOnly) {
		return NextResponse.redirect(new URL("/decks", request.url));
	}

	return response;
}

export const config = {
	// Next.js statically analyzes this value and does not resolve identifiers here.
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
