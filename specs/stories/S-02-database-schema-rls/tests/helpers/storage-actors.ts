import { randomUUID } from "node:crypto";

import { type RlsActors, createRlsActors } from "./rls-actors";
import { buildOwnerScopedPath, queryRows, runSql, sqlLiteral } from "./s02-db-testkit";

interface IdRow {
	id: string;
}

export const ILLUSTRATIONS_STORAGE_BUCKET = "illustrations";
export const ILLUSTRATIONS_STORAGE_OWNER_SEGMENT_SQL = "split_part(name, '/', 1)";
export const ILLUSTRATIONS_STORAGE_POLICY_NAMES = {
	selectOwner: "storage_objects_select_owner_illustrations",
	insertOwner: "storage_objects_insert_owner_illustrations",
	updateOwner: "storage_objects_update_owner_illustrations",
	deleteOwner: "storage_objects_delete_owner_illustrations",
} as const;

export function buildIllustrationsStorageObjectName(ownerUserId: string, leafName: string): string {
	return buildOwnerScopedPath(ownerUserId, leafName);
}

export interface StorageBoundaryFixture {
	actors: RlsActors;
	ownerUserId: string;
	nonOwnerUserId: string;
	ownerIllustrationId: string;
	ownerObjectId: string;
	ownerObjectName: string;
	cleanup: () => void;
}

function requireId(rows: IdRow[], context: string): string {
	const id = rows[0]?.id;

	if (id === undefined) {
		throw new Error(`Missing id in ${context}`);
	}

	return id;
}

export function createStorageBoundaryFixture(prefix = "s02-storage"): StorageBoundaryFixture {
	const suffix = randomUUID().slice(0, 8);
	const fixturePrefix = `${prefix}-${suffix}`;
	const { ownerUserId, nonOwnerUserId, actors } = createRlsActors(fixturePrefix);

	const ownerIllustrationId = requireId(
		queryRows<IdRow>(`
      INSERT INTO public.illustrations (owner_user_id, illustration_key, status)
      VALUES (
        ${sqlLiteral(ownerUserId)}::uuid,
        ${sqlLiteral(`${fixturePrefix}-illustration`)},
        'pending'
      )
      RETURNING id::text AS id
    `),
		"owner illustration insert"
	);

	const ownerObjectName = buildIllustrationsStorageObjectName(
		ownerUserId,
		`${fixturePrefix}-object.png`
	);
	const ownerObjectId = requireId(
		actors.owner.queryRows<IdRow>(`
      INSERT INTO storage.objects (bucket_id, name)
      VALUES (
        ${sqlLiteral(ILLUSTRATIONS_STORAGE_BUCKET)},
        ${sqlLiteral(ownerObjectName)}
      )
      RETURNING id::text AS id
    `),
		"owner storage object insert"
	);

	return {
		actors,
		ownerUserId,
		nonOwnerUserId,
		ownerIllustrationId,
		ownerObjectId,
		ownerObjectName,
		cleanup: () => {
			runSql(`
        DELETE FROM storage.objects
        WHERE bucket_id = ${sqlLiteral(ILLUSTRATIONS_STORAGE_BUCKET)}
          AND (
            ${ILLUSTRATIONS_STORAGE_OWNER_SEGMENT_SQL} = ${sqlLiteral(ownerUserId)}
            OR ${ILLUSTRATIONS_STORAGE_OWNER_SEGMENT_SQL} = ${sqlLiteral(nonOwnerUserId)}
          )
      `);

			runSql(`
        DELETE FROM public.illustrations
        WHERE owner_user_id IN (
          ${sqlLiteral(ownerUserId)}::uuid,
          ${sqlLiteral(nonOwnerUserId)}::uuid
        )
      `);

			runSql(`
        DELETE FROM auth.users
        WHERE id IN (
          ${sqlLiteral(ownerUserId)}::uuid,
          ${sqlLiteral(nonOwnerUserId)}::uuid
        )
      `);
		},
	};
}
