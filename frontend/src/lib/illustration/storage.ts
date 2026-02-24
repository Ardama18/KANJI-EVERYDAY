import { createServiceRoleClient } from "@/lib/supabase/server";

const ILLUSTRATIONS_BUCKET = "illustrations";
const PNG_CONTENT_TYPE = "image/png";
const DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS = 3600;

type QueryError = {
	message: string;
};

type StorageUploadResult = {
	error: QueryError | null;
};

type SignedUrlData = {
	signedUrl: string;
};

type SignedUrlResult = {
	data: SignedUrlData | null;
	error: QueryError | null;
};

type StorageClient = {
	storage: {
		from: (bucket: typeof ILLUSTRATIONS_BUCKET) => {
			upload: (
				path: string,
				fileBody: Buffer,
				options: { contentType: typeof PNG_CONTENT_TYPE; upsert: boolean }
			) => Promise<StorageUploadResult>;
			createSignedUrl: (path: string, expiresIn: number) => Promise<SignedUrlResult>;
		};
	};
};

type StorageDependencies = {
	createServiceRoleClientFn?: () => StorageClient;
};

export const buildIllustrationStoragePath = (ownerUserId: string, illustrationId: string): string =>
	`${ownerUserId}/${illustrationId}.png`;

export const uploadIllustration = async (
	imageBuffer: Buffer,
	storagePath: string,
	dependencies: StorageDependencies = {}
): Promise<boolean> => {
	const createServiceRoleClientFn =
		dependencies.createServiceRoleClientFn ?? createServiceRoleClient;
	const supabase = createServiceRoleClientFn();
	const { error } = await supabase.storage
		.from(ILLUSTRATIONS_BUCKET)
		.upload(storagePath, imageBuffer, {
			contentType: PNG_CONTENT_TYPE,
			upsert: true,
		});

	return error === null;
};

export const getSignedUrl = async (
	storagePath: string,
	expiresIn = DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS,
	dependencies: StorageDependencies = {}
): Promise<string | null> => {
	const createServiceRoleClientFn =
		dependencies.createServiceRoleClientFn ?? createServiceRoleClient;
	const supabase = createServiceRoleClientFn();
	const { data, error } = await supabase.storage
		.from(ILLUSTRATIONS_BUCKET)
		.createSignedUrl(storagePath, expiresIn);

	if (error || !data?.signedUrl) {
		return null;
	}

	return data.signedUrl;
};
