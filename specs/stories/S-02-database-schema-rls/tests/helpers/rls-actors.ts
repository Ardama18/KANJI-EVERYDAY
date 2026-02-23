import { randomUUID } from "node:crypto";

import {
  createAuthUserFixture,
  queryRows,
  queryRowsAsRls,
  runSql,
  runSqlAsRls,
  sqlLiteral,
  type RlsSession,
} from "./s02-db-testkit";

interface IdRow {
  id: string;
}

export interface RlsActor {
  role: RlsSession["role"];
  userId: string | null;
  runSql(sql: string): void;
  queryRows<T extends Record<string, unknown>>(sql: string): T[];
}

export interface RlsActors {
  owner: RlsActor;
  nonOwner: RlsActor;
  anonymous: RlsActor;
}

export interface RlsFixture {
  actors: RlsActors;
  ownerUserId: string;
  nonOwnerUserId: string;
  ownerDeckId: string;
  nonOwnerDeckId: string;
  publicCardId: string;
  privateCardId: string;
  ownerSecondaryCardId: string;
  ownerIllustrationId: string;
  ownerStudySessionId: string;
  cleanup: () => void;
}

function createActor(session: RlsSession): RlsActor {
  return {
    role: session.role,
    userId: session.userId,
    runSql(sql: string): void {
      runSqlAsRls(session, sql);
    },
    queryRows<T extends Record<string, unknown>>(sql: string): T[] {
      return queryRowsAsRls<T>(session, sql);
    },
  };
}

function requireId(rows: IdRow[], context: string): string {
  const id = rows[0]?.id;

  if (id === undefined) {
    throw new Error(`Missing id in ${context}`);
  }

  return id;
}

export function createRlsActors(prefix = "s02-rls"): {
  ownerUserId: string;
  nonOwnerUserId: string;
  actors: RlsActors;
} {
  const owner = createAuthUserFixture(`${prefix}-owner`);
  const nonOwner = createAuthUserFixture(`${prefix}-non-owner`);

  return {
    ownerUserId: owner.userId,
    nonOwnerUserId: nonOwner.userId,
    actors: {
      owner: createActor({ role: "authenticated", userId: owner.userId }),
      nonOwner: createActor({ role: "authenticated", userId: nonOwner.userId }),
      anonymous: createActor({ role: "anon", userId: null }),
    },
  };
}

export function createRlsFixture(prefix = "s02-rls"): RlsFixture {
  const suffix = randomUUID().slice(0, 8);
  const fixturePrefix = `${prefix}-${suffix}`;
  const { ownerUserId, nonOwnerUserId, actors } = createRlsActors(fixturePrefix);

  runSql(`
    INSERT INTO public.users_profile (user_id, display_name)
    VALUES
      (${sqlLiteral(ownerUserId)}::uuid, ${sqlLiteral(`${fixturePrefix}-owner-profile`)}),
      (${sqlLiteral(nonOwnerUserId)}::uuid, ${sqlLiteral(`${fixturePrefix}-non-owner-profile`)})
  `);

  const ownerDeckId = requireId(
    queryRows<IdRow>(`
      INSERT INTO public.decks (owner_user_id, name)
      VALUES (${sqlLiteral(ownerUserId)}::uuid, ${sqlLiteral(`${fixturePrefix}-owner-deck`)})
      RETURNING id::text AS id
    `),
    "owner deck insert"
  );
  const nonOwnerDeckId = requireId(
    queryRows<IdRow>(`
      INSERT INTO public.decks (owner_user_id, name)
      VALUES (${sqlLiteral(nonOwnerUserId)}::uuid, ${sqlLiteral(`${fixturePrefix}-non-owner-deck`)})
      RETURNING id::text AS id
    `),
    "non-owner deck insert"
  );

  const publicCardKey = `${fixturePrefix}-public-${randomUUID().slice(0, 8)}`;
  const privateCardKey = `${fixturePrefix}-private-${randomUUID().slice(0, 8)}`;
  const ownerSecondaryCardKey = `${fixturePrefix}-private-secondary-${randomUUID().slice(0, 8)}`;

  const publicCardId = requireId(
    queryRows<IdRow>(`
      INSERT INTO public.cards (
        visibility,
        skill,
        pattern,
        front_text,
        back_text,
        card_key
      ) VALUES (
        'public',
        'reading',
        'R1',
        ${sqlLiteral(`${fixturePrefix}-public-front`)},
        ${sqlLiteral(`${fixturePrefix}-public-back`)},
        ${sqlLiteral(publicCardKey)}
      )
      RETURNING id::text AS id
    `),
    "public card insert"
  );
  const privateCardId = requireId(
    queryRows<IdRow>(`
      INSERT INTO public.cards (
        owner_user_id,
        visibility,
        skill,
        pattern,
        front_text,
        back_text,
        card_key
      ) VALUES (
        ${sqlLiteral(ownerUserId)}::uuid,
        'private',
        'reading',
        'R2',
        ${sqlLiteral(`${fixturePrefix}-private-front`)},
        ${sqlLiteral(`${fixturePrefix}-private-back`)},
        ${sqlLiteral(privateCardKey)}
      )
      RETURNING id::text AS id
    `),
    "private card insert"
  );
  const ownerSecondaryCardId = requireId(
    queryRows<IdRow>(`
      INSERT INTO public.cards (
        owner_user_id,
        visibility,
        skill,
        pattern,
        front_text,
        back_text,
        card_key
      ) VALUES (
        ${sqlLiteral(ownerUserId)}::uuid,
        'private',
        'writing',
        'W1',
        ${sqlLiteral(`${fixturePrefix}-secondary-front`)},
        ${sqlLiteral(`${fixturePrefix}-secondary-back`)},
        ${sqlLiteral(ownerSecondaryCardKey)}
      )
      RETURNING id::text AS id
    `),
    "owner secondary card insert"
  );

  runSql(`
    INSERT INTO public.deck_cards (deck_id, card_id)
    VALUES (${sqlLiteral(ownerDeckId)}::uuid, ${sqlLiteral(privateCardId)}::uuid)
  `);

  runSql(`
    INSERT INTO public.review_states (user_id, card_id, due_date)
    VALUES (${sqlLiteral(ownerUserId)}::uuid, ${sqlLiteral(privateCardId)}::uuid, CURRENT_DATE)
  `);

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
    "illustration insert"
  );

  const ownerStudySessionId = requireId(
    queryRows<IdRow>(`
      INSERT INTO public.study_sessions (user_id, deck_id, current_card_id)
      VALUES (
        ${sqlLiteral(ownerUserId)}::uuid,
        ${sqlLiteral(ownerDeckId)}::uuid,
        ${sqlLiteral(privateCardId)}::uuid
      )
      RETURNING id::text AS id
    `),
    "study session insert"
  );

  return {
    actors,
    ownerUserId,
    nonOwnerUserId,
    ownerDeckId,
    nonOwnerDeckId,
    publicCardId,
    privateCardId,
    ownerSecondaryCardId,
    ownerIllustrationId,
    ownerStudySessionId,
    cleanup: () => {
      runSql(`
        DELETE FROM auth.users
        WHERE id IN (
          ${sqlLiteral(ownerUserId)}::uuid,
          ${sqlLiteral(nonOwnerUserId)}::uuid
        )
      `);

      runSql(`
        DELETE FROM public.cards
        WHERE card_key IN (
          ${sqlLiteral(publicCardKey)},
          ${sqlLiteral(privateCardKey)},
          ${sqlLiteral(ownerSecondaryCardKey)}
        )
      `);
    },
  };
}
