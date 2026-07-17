/** @type {import("next").NextConfig} */
const nextConfig = {
	webpack(config) {
		config.module.rules.unshift({
			test: /@imagemagick[\\/]magick-wasm[\\/]dist[\\/]magick\.wasm$/u,
			type: "asset/resource",
		});
		return config;
	},
	experimental: {
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
