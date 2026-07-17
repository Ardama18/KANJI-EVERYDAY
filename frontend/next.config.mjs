/** @type {import("next").NextConfig} */
const nextConfig = {
	experimental: {
		serverComponentsExternalPackages: ["@imagemagick/magick-wasm"],
		outputFileTracingIncludes: {
			"/api/ai/imports/sources/complete": [
				"./node_modules/@imagemagick/magick-wasm/dist/magick.wasm",
			],
		},
	},
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "*.supabase.co",
				pathname: "/storage/v1/object/sign/**",
			},
		],
	},
};

export default nextConfig;
