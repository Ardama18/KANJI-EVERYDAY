-- S-10 AI card import foundation
-- This forward migration is intentionally transactional. Repository Seed data is
-- upgraded separately in supabase/seed.sql.

BEGIN;

CREATE COLLATION public.ai_und_icu (
  provider = icu,
  locale = 'und',
  deterministic = true
);

CREATE FUNCTION public.ai_normalize_display_text(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT pg_catalog.regexp_replace(
    pg_catalog.btrim(
      pg_catalog.translate(
        pg_catalog.normalize(value, 'NFKC'),
        U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000',
        pg_catalog.repeat(' ', 25)
      ),
      ' '
    ),
    ' +',
    ' ',
    'g'
  )
$$;

CREATE FUNCTION public.ai_normalize_key_text(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT pg_catalog.lower(
    public.ai_normalize_display_text(value) COLLATE public.ai_und_icu
  )
$$;

CREATE FUNCTION public.ai_compute_card_key(
  pattern text,
  front_text text,
  back_text text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pattern || pg_catalog.chr(31) ||
        public.ai_normalize_key_text(front_text) || pg_catalog.chr(31) ||
        public.ai_normalize_key_text(back_text),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$$;

-- Fail fast when this PostgreSQL build cannot honor the shared Unicode contract.
DO $$
BEGIN
  IF public.ai_normalize_display_text(
    U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000漢\0009\3000字\00A0'
  ) IS DISTINCT FROM '漢 字' THEN
    RAISE EXCEPTION 'S-10 Unicode fixed White_Space self-check failed';
  END IF;

  IF public.ai_normalize_key_text(U&'\3000\FF21\FF22\FF23\3000Ä\3000')
    IS DISTINCT FROM 'abc ä' THEN
    RAISE EXCEPTION 'S-10 ICU NFKC/lowercase self-check failed';
  END IF;

  IF public.ai_normalize_key_text(U&' \FEFF\FF21\FEFF ')
    IS DISTINCT FROM U&'\FEFFa\FEFF' THEN
    RAISE EXCEPTION 'S-10 FEFF exclusion self-check failed';
  END IF;

  IF public.ai_compute_card_key('R1', U&'\3000漢字\3000', ' かんじ ')
    IS DISTINCT FROM '0b699c1cdeb4af9725f1d9f1d796a80e7728e096ab1d9a1aa92e3eaf9d55dc1c' THEN
    RAISE EXCEPTION 'S-10 card-key fixture self-check failed';
  END IF;

  IF current_setting('app.s10_failpoint', true) = 'after_helper_self_check' THEN
    RAISE EXCEPTION 'S-10 injected migration failure after helper self-check';
  END IF;
END;
$$;

CREATE TEMPORARY TABLE s10_card_key_backfill
ON COMMIT DROP
AS
SELECT
  cards.id,
  cards.owner_user_id,
  cards.visibility,
  public.ai_compute_card_key(cards.pattern, cards.front_text, cards.back_text) AS card_key
FROM public.cards AS cards;

DO $$
DECLARE
  public_collision_key text;
  private_collision_key text;
BEGIN
  SELECT card_key
  INTO public_collision_key
  FROM s10_card_key_backfill
  WHERE visibility = 'public'
  GROUP BY card_key
  HAVING count(*) > 1
  ORDER BY card_key
  LIMIT 1;

  IF public_collision_key IS NOT NULL THEN
    RAISE EXCEPTION 'S-10 public card-key collision detected before backfill';
  END IF;

  SELECT card_key
  INTO private_collision_key
  FROM s10_card_key_backfill
  WHERE visibility = 'private'
  GROUP BY owner_user_id, card_key
  HAVING count(*) > 1
  ORDER BY card_key
  LIMIT 1;

  IF private_collision_key IS NOT NULL THEN
    RAISE EXCEPTION 'S-10 private owner/card-key collision detected before backfill';
  END IF;

  IF current_setting('app.s10_failpoint', true) = 'after_collision_check' THEN
    RAISE EXCEPTION 'S-10 injected migration failure after collision check';
  END IF;
END;
$$;

ALTER TABLE public.cards
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT cards_owner_visibility_check CHECK (
    (visibility = 'public' AND owner_user_id IS NULL) OR
    (visibility = 'private' AND owner_user_id IS NOT NULL)
  ),
  ADD CONSTRAINT cards_id_owner_uq UNIQUE (id, owner_user_id);

ALTER TABLE public.cards
  DROP CONSTRAINT cards_card_key_key;

UPDATE public.cards AS cards
SET card_key = backfill.card_key
FROM s10_card_key_backfill AS backfill
WHERE backfill.id = cards.id;

ALTER TABLE public.cards
  ADD CONSTRAINT cards_card_key_sha256_check
  CHECK (card_key ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX cards_public_card_key_uidx
  ON public.cards (card_key)
  WHERE visibility = 'public';

CREATE UNIQUE INDEX cards_private_owner_card_key_uidx
  ON public.cards (owner_user_id, card_key)
  WHERE visibility = 'private';

CREATE FUNCTION public.ai_set_card_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  NEW.card_key := public.ai_compute_card_key(
    NEW.pattern,
    NEW.front_text,
    NEW.back_text
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_cards_card_key
BEFORE INSERT OR UPDATE ON public.cards
FOR EACH ROW
EXECUTE FUNCTION public.ai_set_card_key();

CREATE TRIGGER set_cards_updated_at
BEFORE UPDATE ON public.cards
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DO $$
BEGIN
  IF current_setting('app.s10_failpoint', true) = 'after_card_key_backfill' THEN
    RAISE EXCEPTION 'S-10 injected migration failure after card-key backfill';
  END IF;
END;
$$;

ALTER TABLE public.decks
  ADD CONSTRAINT decks_id_owner_uq UNIQUE (id, owner_user_id);

CREATE TABLE public.ai_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  source text NOT NULL,
  target_deck_id uuid,
  auto_created_deck_id uuid,
  status text NOT NULL DEFAULT 'committed',
  idempotency_key text NOT NULL,
  import_request_hash text NOT NULL,
  card_reservation_key text,
  requested_card_count smallint NOT NULL,
  requested_image_count smallint NOT NULL,
  finalized_count smallint NOT NULL DEFAULT 0,
  failed_count smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  undone_at timestamptz,
  undo_result jsonb,
  CONSTRAINT ai_import_batches_owner_fkey
    FOREIGN KEY (owner_user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT ai_import_batches_target_deck_fkey
    FOREIGN KEY (target_deck_id) REFERENCES public.decks (id) ON DELETE SET NULL,
  CONSTRAINT ai_import_batches_auto_deck_fkey
    FOREIGN KEY (auto_created_deck_id) REFERENCES public.decks (id) ON DELETE SET NULL,
  CONSTRAINT ai_import_batches_source_check CHECK (source IN ('app_ai', 'remote_mcp')),
  CONSTRAINT ai_import_batches_status_check
    CHECK (status IN ('committed', 'processing', 'completed', 'undone')),
  CONSTRAINT ai_import_batches_idempotency_key_check
    CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  CONSTRAINT ai_import_batches_import_hash_check
    CHECK (import_request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ai_import_batches_card_reservation_key_check
    CHECK (card_reservation_key IS NULL OR char_length(card_reservation_key) BETWEEN 1 AND 128),
  CONSTRAINT ai_import_batches_requested_counts_check CHECK (
    requested_card_count BETWEEN 1 AND 50 AND
    requested_image_count BETWEEN 0 AND 50
  ),
  CONSTRAINT ai_import_batches_result_counts_check CHECK (
    finalized_count BETWEEN 0 AND requested_card_count AND
    failed_count BETWEEN 0 AND requested_card_count AND
    finalized_count + failed_count <= requested_card_count
  ),
  CONSTRAINT ai_import_batches_terminal_state_check CHECK (
    (
      status IN ('committed', 'processing') AND
      completed_at IS NULL AND undone_at IS NULL AND undo_result IS NULL
    ) OR
    (
      status = 'completed' AND
      completed_at IS NOT NULL AND undone_at IS NULL AND undo_result IS NULL
    ) OR
    (
      status = 'undone' AND
      undone_at IS NOT NULL AND undo_result IS NOT NULL
    )
  ),
  CONSTRAINT ai_import_batches_owner_idempotency_uq
    UNIQUE (owner_user_id, idempotency_key),
  CONSTRAINT ai_import_batches_id_owner_uq UNIQUE (id, owner_user_id)
);

CREATE INDEX ai_import_batches_owner_created_idx
  ON public.ai_import_batches (owner_user_id, created_at DESC);
CREATE INDEX ai_import_batches_status_created_idx
  ON public.ai_import_batches (status, created_at);

CREATE TABLE public.ai_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  upload_key text NOT NULL,
  purpose text NOT NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL,
  status text NOT NULL DEFAULT 'ready',
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  CONSTRAINT ai_uploads_owner_fkey
    FOREIGN KEY (owner_user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT ai_uploads_upload_key_check
    CHECK (char_length(upload_key) BETWEEN 1 AND 128),
  CONSTRAINT ai_uploads_purpose_check CHECK (purpose = 'card_illustration'),
  CONSTRAINT ai_uploads_storage_path_check CHECK (
    char_length(storage_path) BETWEEN 1 AND 1024 AND
    left(storage_path, 1) <> '/' AND
    storage_path !~ '(^|/)\.\.(/|$)'
  ),
  CONSTRAINT ai_uploads_mime_type_check
    CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  CONSTRAINT ai_uploads_byte_size_check CHECK (byte_size BETWEEN 1 AND 10485760),
  CONSTRAINT ai_uploads_status_check CHECK (status IN ('ready', 'consumed', 'deleted')),
  CONSTRAINT ai_uploads_status_time_check CHECK (
    (status = 'ready' AND consumed_at IS NULL) OR
    (status = 'consumed' AND consumed_at IS NOT NULL) OR
    status = 'deleted'
  ),
  CONSTRAINT ai_uploads_id_owner_uq UNIQUE (id, owner_user_id),
  CONSTRAINT ai_uploads_owner_upload_key_uq UNIQUE (owner_user_id, upload_key),
  CONSTRAINT ai_uploads_owner_storage_path_uq UNIQUE (owner_user_id, storage_path)
);

CREATE TABLE public.ai_import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  client_item_id text NOT NULL,
  concept_id text NOT NULL,
  ordinal smallint NOT NULL,
  pattern text NOT NULL,
  skill text NOT NULL,
  front_text text NOT NULL,
  back_text text NOT NULL,
  card_key text NOT NULL,
  image_mode text NOT NULL DEFAULT 'none',
  upload_id uuid,
  illustration_reservation_key text,
  status text NOT NULL DEFAULT 'committed',
  result_card_id uuid,
  deleted_card_id uuid,
  error_code text,
  error_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  terminal_attempt_key text,
  user_edited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  failed_at timestamptz,
  deleted_at timestamptz,
  undone_at timestamptz,
  CONSTRAINT ai_import_items_batch_owner_fkey
    FOREIGN KEY (batch_id, owner_user_id)
    REFERENCES public.ai_import_batches (id, owner_user_id) ON DELETE CASCADE,
  CONSTRAINT ai_import_items_upload_owner_fkey
    FOREIGN KEY (upload_id, owner_user_id)
    REFERENCES public.ai_uploads (id, owner_user_id),
  CONSTRAINT ai_import_items_result_card_fkey
    FOREIGN KEY (result_card_id) REFERENCES public.cards (id) ON DELETE SET NULL,
  CONSTRAINT ai_import_items_client_item_id_check
    CHECK (char_length(client_item_id) BETWEEN 1 AND 64),
  CONSTRAINT ai_import_items_concept_id_check
    CHECK (char_length(concept_id) BETWEEN 1 AND 64),
  CONSTRAINT ai_import_items_ordinal_check CHECK (ordinal BETWEEN 0 AND 49),
  CONSTRAINT ai_import_items_pattern_skill_check CHECK (
    (pattern = 'R1' AND skill = 'reading') OR
    (pattern = 'W1' AND skill = 'writing')
  ),
  CONSTRAINT ai_import_items_front_text_check
    CHECK (char_length(front_text) BETWEEN 1 AND 200),
  CONSTRAINT ai_import_items_back_text_check
    CHECK (char_length(back_text) BETWEEN 1 AND 200),
  CONSTRAINT ai_import_items_card_key_check CHECK (card_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ai_import_items_image_mode_check CHECK (image_mode IN ('none', 'ai', 'upload')),
  CONSTRAINT ai_import_items_image_upload_check CHECK (
    (image_mode = 'upload' AND upload_id IS NOT NULL) OR
    (image_mode IN ('none', 'ai') AND upload_id IS NULL)
  ),
  CONSTRAINT ai_import_items_illustration_reservation_key_check CHECK (
    illustration_reservation_key IS NULL OR
    char_length(illustration_reservation_key) BETWEEN 1 AND 128
  ),
  CONSTRAINT ai_import_items_status_check
    CHECK (status IN ('committed', 'processing', 'finalized', 'failed', 'deleted', 'undone')),
  CONSTRAINT ai_import_items_error_code_check
    CHECK (error_code IS NULL OR char_length(error_code) BETWEEN 1 AND 64),
  CONSTRAINT ai_import_items_terminal_attempt_key_check
    CHECK (terminal_attempt_key IS NULL OR char_length(terminal_attempt_key) BETWEEN 1 AND 128),
  CONSTRAINT ai_import_items_terminal_state_check CHECK (
    (
      status IN ('committed', 'processing') AND
      result_card_id IS NULL AND deleted_card_id IS NULL AND error_code IS NULL AND
      finalized_at IS NULL AND failed_at IS NULL AND deleted_at IS NULL AND undone_at IS NULL
    ) OR
    (
      status = 'finalized' AND
      result_card_id IS NOT NULL AND finalized_at IS NOT NULL AND
      deleted_card_id IS NULL AND error_code IS NULL AND
      failed_at IS NULL AND deleted_at IS NULL AND undone_at IS NULL
    ) OR
    (
      status = 'failed' AND
      result_card_id IS NULL AND error_code IS NOT NULL AND failed_at IS NOT NULL AND
      deleted_card_id IS NULL AND finalized_at IS NULL AND deleted_at IS NULL AND undone_at IS NULL
    ) OR
    (
      status = 'deleted' AND
      result_card_id IS NULL AND deleted_card_id IS NOT NULL AND deleted_at IS NOT NULL AND
      undone_at IS NULL
    ) OR
    (
      status = 'undone' AND
      result_card_id IS NULL AND deleted_card_id IS NULL AND undone_at IS NOT NULL
    )
  ),
  CONSTRAINT ai_import_items_batch_client_item_uq UNIQUE (batch_id, client_item_id),
  CONSTRAINT ai_import_items_batch_ordinal_uq UNIQUE (batch_id, ordinal),
  CONSTRAINT ai_import_items_batch_card_key_uq UNIQUE (batch_id, card_key),
  CONSTRAINT ai_import_items_batch_concept_pattern_uq UNIQUE (batch_id, concept_id, pattern),
  CONSTRAINT ai_import_items_id_owner_uq UNIQUE (id, owner_user_id)
);

CREATE UNIQUE INDEX ai_import_items_result_card_uidx
  ON public.ai_import_items (result_card_id)
  WHERE result_card_id IS NOT NULL;
CREATE INDEX ai_import_items_owner_status_created_idx
  ON public.ai_import_items (owner_user_id, status, created_at);
CREATE INDEX ai_import_items_batch_status_idx
  ON public.ai_import_items (batch_id, status);

CREATE TABLE public.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  display_name text NOT NULL,
  normalized_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tags_owner_fkey
    FOREIGN KEY (owner_user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT tags_display_name_check CHECK (char_length(display_name) BETWEEN 1 AND 30),
  CONSTRAINT tags_normalized_name_check CHECK (char_length(normalized_name) BETWEEN 1 AND 30),
  CONSTRAINT tags_owner_normalized_name_uq UNIQUE (owner_user_id, normalized_name),
  CONSTRAINT tags_id_owner_uq UNIQUE (id, owner_user_id)
);

CREATE TABLE public.ai_import_item_tags (
  owner_user_id uuid NOT NULL,
  item_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  CONSTRAINT ai_import_item_tags_pkey PRIMARY KEY (item_id, tag_id),
  CONSTRAINT ai_import_item_tags_item_owner_fkey
    FOREIGN KEY (item_id, owner_user_id)
    REFERENCES public.ai_import_items (id, owner_user_id) ON DELETE CASCADE,
  CONSTRAINT ai_import_item_tags_tag_owner_fkey
    FOREIGN KEY (tag_id, owner_user_id)
    REFERENCES public.tags (id, owner_user_id) ON DELETE CASCADE
);

CREATE TABLE public.card_tags (
  owner_user_id uuid NOT NULL,
  card_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT card_tags_pkey PRIMARY KEY (card_id, tag_id),
  CONSTRAINT card_tags_card_owner_fkey
    FOREIGN KEY (card_id, owner_user_id)
    REFERENCES public.cards (id, owner_user_id) ON DELETE CASCADE,
  CONSTRAINT card_tags_tag_owner_fkey
    FOREIGN KEY (tag_id, owner_user_id)
    REFERENCES public.tags (id, owner_user_id) ON DELETE CASCADE
);

CREATE INDEX card_tags_owner_tag_idx ON public.card_tags (owner_user_id, tag_id);

CREATE TABLE public.ai_usage_daily (
  owner_user_id uuid NOT NULL,
  usage_date date NOT NULL,
  generated_card_count integer NOT NULL DEFAULT 0,
  generated_image_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_usage_daily_pkey PRIMARY KEY (owner_user_id, usage_date),
  CONSTRAINT ai_usage_daily_owner_fkey
    FOREIGN KEY (owner_user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT ai_usage_daily_card_count_check
    CHECK (generated_card_count BETWEEN 0 AND 200),
  CONSTRAINT ai_usage_daily_image_count_check
    CHECK (generated_image_count BETWEEN 0 AND 50)
);

CREATE TABLE public.ai_quota_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  reservation_key text NOT NULL,
  kind text NOT NULL,
  source text NOT NULL,
  generation_request_hash text NOT NULL,
  import_request_hash text,
  usage_date date NOT NULL,
  batch_id uuid,
  item_id uuid,
  concept_id text,
  units integer NOT NULL,
  status text NOT NULL,
  provider_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_quota_reservations_owner_fkey
    FOREIGN KEY (owner_user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT ai_quota_reservations_batch_fkey
    FOREIGN KEY (batch_id) REFERENCES public.ai_import_batches (id) ON DELETE SET NULL,
  CONSTRAINT ai_quota_reservations_item_fkey
    FOREIGN KEY (item_id) REFERENCES public.ai_import_items (id) ON DELETE SET NULL,
  CONSTRAINT ai_quota_reservations_key_check
    CHECK (char_length(reservation_key) BETWEEN 1 AND 128),
  CONSTRAINT ai_quota_reservations_kind_check
    CHECK (kind IN ('card_generation', 'illustration_concept')),
  CONSTRAINT ai_quota_reservations_source_check CHECK (source IN ('app_ai', 'remote_mcp')),
  CONSTRAINT ai_quota_reservations_generation_hash_check
    CHECK (generation_request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ai_quota_reservations_import_hash_check
    CHECK (import_request_hash IS NULL OR import_request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ai_quota_reservations_concept_id_check
    CHECK (concept_id IS NULL OR char_length(concept_id) BETWEEN 1 AND 64),
  CONSTRAINT ai_quota_reservations_status_check CHECK (status IN ('reserved', 'exempt')),
  CONSTRAINT ai_quota_reservations_status_units_check CHECK (
    (
      status = 'reserved' AND units BETWEEN 1 AND 200 AND
      (
        (kind = 'card_generation' AND source = 'app_ai') OR
        kind = 'illustration_concept'
      )
    ) OR
    (status = 'exempt' AND units = 0)
  ),
  CONSTRAINT ai_quota_reservations_owner_key_kind_uq
    UNIQUE (owner_user_id, reservation_key, kind)
);

CREATE INDEX ai_quota_reservations_owner_usage_idx
  ON public.ai_quota_reservations (owner_user_id, usage_date);
CREATE INDEX ai_quota_reservations_batch_idx
  ON public.ai_quota_reservations (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX ai_quota_reservations_item_idx
  ON public.ai_quota_reservations (item_id) WHERE item_id IS NOT NULL;

CREATE FUNCTION public.normalize_tag_names()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  NEW.display_name := public.ai_normalize_display_text(NEW.display_name);
  NEW.normalized_name := public.ai_normalize_key_text(NEW.display_name);

  IF NEW.display_name IS NULL OR char_length(NEW.display_name) NOT BETWEEN 1 AND 30 OR
     NEW.normalized_name IS NULL OR char_length(NEW.normalized_name) NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P1000',
      MESSAGE = 'S-10 tag validation failed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER normalize_tag_names
BEFORE INSERT OR UPDATE ON public.tags
FOR EACH ROW
EXECUTE FUNCTION public.normalize_tag_names();

CREATE FUNCTION public.enforce_import_batch_deck_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.target_deck_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.decks AS decks
    WHERE decks.id = NEW.target_deck_id
      AND decks.owner_user_id = NEW.owner_user_id
    FOR KEY SHARE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P1003', MESSAGE = 'S-10 deck not found';
  END IF;

  IF NEW.auto_created_deck_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.decks AS decks
    WHERE decks.id = NEW.auto_created_deck_id
      AND decks.owner_user_id = NEW.owner_user_id
    FOR KEY SHARE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P1003', MESSAGE = 'S-10 deck not found';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_import_batch_deck_owner
BEFORE INSERT OR UPDATE OF owner_user_id, target_deck_id, auto_created_deck_id
ON public.ai_import_batches
FOR EACH ROW
EXECUTE FUNCTION public.enforce_import_batch_deck_owner();

CREATE FUNCTION public.enforce_deck_card_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  deck_owner_id uuid;
  card_owner_id uuid;
  card_visibility text;
BEGIN
  SELECT decks.owner_user_id, cards.owner_user_id, cards.visibility
  INTO deck_owner_id, card_owner_id, card_visibility
  FROM public.decks AS decks
  CROSS JOIN public.cards AS cards
  WHERE decks.id = NEW.deck_id
    AND cards.id = NEW.card_id
  FOR KEY SHARE OF decks, cards;

  IF NOT FOUND OR NOT (
    card_visibility = 'public' OR
    (card_visibility = 'private' AND card_owner_id = deck_owner_id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P1003', MESSAGE = 'S-10 deck or card not found';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_deck_card_owner
BEFORE INSERT OR UPDATE OF deck_id, card_id ON public.deck_cards
FOR EACH ROW
EXECUTE FUNCTION public.enforce_deck_card_owner();

CREATE FUNCTION public.enforce_ai_import_item_tag_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF (
    SELECT count(*)
    FROM public.ai_import_item_tags AS item_tags
    WHERE item_tags.item_id = NEW.item_id
  ) > 10 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P1000',
      MESSAGE = 'S-10 item tag limit exceeded';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER enforce_ai_import_item_tag_limit
AFTER INSERT OR UPDATE OF item_id ON public.ai_import_item_tags
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.enforce_ai_import_item_tag_limit();

CREATE TRIGGER set_ai_import_batches_updated_at
BEFORE UPDATE ON public.ai_import_batches
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_ai_import_items_updated_at
BEFORE UPDATE ON public.ai_import_items
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_tags_updated_at
BEFORE UPDATE ON public.tags
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_ai_usage_daily_updated_at
BEFORE UPDATE ON public.ai_usage_daily
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DO $$
BEGIN
  IF current_setting('app.s10_failpoint', true) = 'after_import_schema' THEN
    RAISE EXCEPTION 'S-10 injected migration failure after import schema';
  END IF;
END;
$$;

CREATE FUNCTION public.ai_session_card_ids(
  current_card_id uuid,
  queue_due jsonb,
  queue_learn jsonb,
  queue_new jsonb,
  queue_retry jsonb
)
RETURNS TABLE (card_id uuid)
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT current_card_id WHERE current_card_id IS NOT NULL
  UNION
  SELECT (entry.value #>> '{}')::uuid
  FROM unnest(ARRAY[queue_due, queue_learn, queue_new, queue_retry]) AS queues(value)
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(queues.value) = 'array' THEN queues.value ELSE '[]'::jsonb END
  ) AS entry(value)
  WHERE jsonb_typeof(entry.value) = 'string'
    AND (entry.value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
$$;

CREATE FUNCTION public.lock_study_session_cards()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE locked_card_id uuid;
BEGIN
  FOR locked_card_id IN
    SELECT DISTINCT ids.card_id
    FROM (
      SELECT * FROM public.ai_session_card_ids(NEW.current_card_id, NEW.queue_due, NEW.queue_learn, NEW.queue_new, NEW.queue_retry)
      UNION
      SELECT * FROM public.ai_session_card_ids(OLD.current_card_id, OLD.queue_due, OLD.queue_learn, OLD.queue_new, OLD.queue_retry)
    ) AS ids
    ORDER BY ids.card_id
  LOOP
    PERFORM 1 FROM public.cards WHERE id = locked_card_id FOR UPDATE;
    PERFORM pg_advisory_xact_lock(hashtextextended(locked_card_id::text, 1010));
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER lock_study_session_cards
BEFORE INSERT OR UPDATE ON public.study_sessions
FOR EACH ROW EXECUTE FUNCTION public.lock_study_session_cards();

CREATE FUNCTION public.guard_card_active_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE active_session_id uuid;
DECLARE active_deck_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(OLD.id::text, 1010));
  SELECT sessions.id, sessions.deck_id INTO active_session_id, active_deck_id
  FROM public.study_sessions AS sessions
  WHERE sessions.finished_at IS NULL
    AND sessions.user_id = OLD.owner_user_id
    AND OLD.id IN (
      SELECT ids.card_id FROM public.ai_session_card_ids(
        sessions.current_card_id, sessions.queue_due, sessions.queue_learn,
        sessions.queue_new, sessions.queue_retry
      ) AS ids
    )
  ORDER BY sessions.id
  LIMIT 1;
  IF active_session_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P1006', MESSAGE = 'S-10 card is in an active session',
      DETAIL = json_build_object('sessionId', active_session_id, 'deckId', active_deck_id)::text;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER guard_card_active_session
BEFORE UPDATE OR DELETE ON public.cards
FOR EACH ROW EXECUTE FUNCTION public.guard_card_active_session();

CREATE FUNCTION public.reset_review_state_on_content_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.front_text IS DISTINCT FROM NEW.front_text OR
     OLD.back_text IS DISTINCT FROM NEW.back_text OR
     OLD.skill IS DISTINCT FROM NEW.skill OR
     OLD.pattern IS DISTINCT FROM NEW.pattern THEN
    DELETE FROM public.review_states WHERE card_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reset_review_state_on_content_change
AFTER UPDATE ON public.cards
FOR EACH ROW EXECUTE FUNCTION public.reset_review_state_on_content_change();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 's10_migration_owner') THEN
    CREATE ROLE s10_migration_owner NOLOGIN BYPASSRLS;
  END IF;
END;
$$;

GRANT s10_migration_owner TO postgres;
GRANT USAGE, CREATE ON SCHEMA public TO s10_migration_owner;
GRANT USAGE ON SCHEMA extensions TO s10_migration_owner;

CREATE SCHEMA IF NOT EXISTS s10_private AUTHORIZATION s10_migration_owner;
REVOKE ALL ON SCHEMA s10_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE s10_private.internal_context_secret (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  token text NOT NULL
);
ALTER TABLE s10_private.internal_context_secret ENABLE ROW LEVEL SECURITY;
ALTER TABLE s10_private.internal_context_secret OWNER TO s10_migration_owner;
REVOKE ALL ON s10_private.internal_context_secret FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO s10_private.internal_context_secret (singleton, token)
VALUES (true, gen_random_uuid()::text);

CREATE FUNCTION public.ai_enable_internal_context()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE internal_token text;
BEGIN
  SELECT secrets.token
  INTO STRICT internal_token
  FROM s10_private.internal_context_secret AS secrets
  WHERE secrets.singleton;

  PERFORM set_config('app.s10_internal_token', internal_token, true);
END;
$$;

CREATE FUNCTION public.ai_internal_context_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT current_setting('app.s10_internal_token', true) = secrets.token
  FROM s10_private.internal_context_secret AS secrets
  WHERE secrets.singleton
$$;

CREATE FUNCTION public.ai_raise_import_error(
  error_code text,
  safe_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE error_state text;
DECLARE allowed_keys text[];
BEGIN
  error_state := CASE error_code
    WHEN 'VALIDATION_ERROR' THEN 'P1000'
    WHEN 'DUPLICATE_IN_REQUEST' THEN 'P1001'
    WHEN 'DUPLICATE_EXISTING' THEN 'P1002'
    WHEN 'DECK_NOT_FOUND' THEN 'P1003'
    WHEN 'DECK_AMBIGUOUS' THEN 'P1004'
    WHEN 'QUOTA_EXCEEDED' THEN 'P1005'
    WHEN 'ACTIVE_SESSION' THEN 'P1006'
    WHEN 'CARD_MODIFIED' THEN 'P1007'
    WHEN 'CONFLICT' THEN 'P1008'
    WHEN 'UNAUTHORIZED' THEN '42501'
    ELSE NULL
  END;
  allowed_keys := CASE error_code
    WHEN 'VALIDATION_ERROR' THEN ARRAY['field', 'rule']
    WHEN 'DUPLICATE_IN_REQUEST' THEN ARRAY['clientItemId']
    WHEN 'DUPLICATE_EXISTING' THEN ARRAY['itemId']
    WHEN 'DECK_AMBIGUOUS' THEN ARRAY['normalizedName']
    WHEN 'QUOTA_EXCEEDED' THEN ARRAY['limit', 'current', 'requested', 'date']
    WHEN 'ACTIVE_SESSION' THEN ARRAY['sessionId', 'deckId']
    WHEN 'CARD_MODIFIED' THEN ARRAY['cardId']
    ELSE ARRAY[]::text[]
  END;

  IF error_state IS NULL OR safe_detail IS NULL OR jsonb_typeof(safe_detail) <> 'object' OR
     EXISTS (
       SELECT 1
       FROM jsonb_object_keys(safe_detail) AS detail_keys(key)
       WHERE NOT (detail_keys.key = ANY(allowed_keys))
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P1000',
      MESSAGE = 'S-10 request rejected';
  END IF;

  IF safe_detail = '{}'::jsonb THEN
    RAISE EXCEPTION USING
      ERRCODE = error_state,
      MESSAGE = 'S-10 request rejected';
  ELSE
    RAISE EXCEPTION USING
      ERRCODE = error_state,
      MESSAGE = 'S-10 request rejected',
      DETAIL = safe_detail::text;
  END IF;
END;
$$;

CREATE FUNCTION public.ai_prepare_import_request(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  deck_value jsonb;
  deck_mode text;
  deck_id uuid;
  deck_name text;
  prepared_deck jsonb;
  item_value jsonb;
  image_value jsonb;
  tag_value jsonb;
  prepared_items jsonb := '[]'::jsonb;
  prepared_tags jsonb;
  prepared_item jsonb;
  client_item_id text;
  concept_id text;
  item_pattern text;
  item_skill text;
  front_value text;
  back_value text;
  image_mode text;
  upload_id uuid;
  tag_display text;
  tag_normalized text;
  item_card_key text;
  client_item_ids text[] := ARRAY[]::text[];
  card_keys text[] := ARRAY[]::text[];
  tag_names text[];
  item_count integer;
  image_count integer;
  ordinal_index integer;
  canonical_deck text;
  canonical_items text := '';
  canonical_tags text;
  canonical_image text;
  canonical_request text;
  request_hash text;
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_request) <> 'object' OR
     NOT (p_request ?& ARRAY['deck', 'items']) OR
     EXISTS (
       SELECT 1 FROM jsonb_object_keys(p_request) AS request_keys(key)
       WHERE request_keys.key NOT IN ('deck', 'items')
     ) THEN
    PERFORM public.ai_raise_import_error(
      'VALIDATION_ERROR', jsonb_build_object('field', 'request', 'rule', 'shape')
    );
  END IF;

  deck_value := p_request -> 'deck';
  IF jsonb_typeof(deck_value) <> 'object' OR
     (SELECT count(*) FROM jsonb_object_keys(deck_value)) <> 1 OR
     EXISTS (
       SELECT 1 FROM jsonb_object_keys(deck_value) AS deck_keys(key)
       WHERE deck_keys.key NOT IN ('id', 'name', 'create')
     ) THEN
    PERFORM public.ai_raise_import_error(
      'VALIDATION_ERROR', jsonb_build_object('field', 'deck', 'rule', 'shape')
    );
  END IF;

  IF deck_value ? 'id' THEN
    IF jsonb_typeof(deck_value -> 'id') <> 'string' OR
       (deck_value ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      PERFORM public.ai_raise_import_error(
        'VALIDATION_ERROR', jsonb_build_object('field', 'deck.id', 'rule', 'uuid')
      );
    END IF;
    deck_mode := 'id';
    deck_id := (deck_value ->> 'id')::uuid;
    prepared_deck := jsonb_build_object('mode', deck_mode, 'id', deck_id::text);
    canonical_deck := '{"id":' || to_jsonb(deck_id::text)::text || '}';
  ELSIF deck_value ? 'name' THEN
    IF jsonb_typeof(deck_value -> 'name') <> 'string' THEN
      PERFORM public.ai_raise_import_error(
        'VALIDATION_ERROR', jsonb_build_object('field', 'deck.name', 'rule', 'string')
      );
    END IF;
    deck_mode := 'name';
    deck_name := public.ai_normalize_display_text(deck_value ->> 'name');
    IF char_length(deck_name) NOT BETWEEN 1 AND 200 THEN
      PERFORM public.ai_raise_import_error(
        'VALIDATION_ERROR', jsonb_build_object('field', 'deck.name', 'rule', 'length')
      );
    END IF;
    prepared_deck := jsonb_build_object('mode', deck_mode, 'name', deck_name);
    canonical_deck := '{"name":' || to_jsonb(deck_name)::text || '}';
  ELSE
    IF jsonb_typeof(deck_value -> 'create') <> 'object' OR
       NOT ((deck_value -> 'create') ? 'name') OR
       (SELECT count(*) FROM jsonb_object_keys(deck_value -> 'create')) <> 1 OR
       jsonb_typeof(deck_value #> '{create,name}') <> 'string' THEN
      PERFORM public.ai_raise_import_error(
        'VALIDATION_ERROR', jsonb_build_object('field', 'deck.create', 'rule', 'shape')
      );
    END IF;
    deck_mode := 'create';
    deck_name := public.ai_normalize_display_text(deck_value #>> '{create,name}');
    IF char_length(deck_name) NOT BETWEEN 1 AND 200 THEN
      PERFORM public.ai_raise_import_error(
        'VALIDATION_ERROR', jsonb_build_object('field', 'deck.create.name', 'rule', 'length')
      );
    END IF;
    prepared_deck := jsonb_build_object('mode', deck_mode, 'name', deck_name);
    canonical_deck := '{"create":{"name":' || to_jsonb(deck_name)::text || '}}';
  END IF;

  IF jsonb_typeof(p_request -> 'items') <> 'array' THEN
    PERFORM public.ai_raise_import_error(
      'VALIDATION_ERROR', jsonb_build_object('field', 'items', 'rule', 'array')
    );
  END IF;
  item_count := jsonb_array_length(p_request -> 'items');
  IF item_count NOT BETWEEN 1 AND 50 THEN
    PERFORM public.ai_raise_import_error(
      'VALIDATION_ERROR', jsonb_build_object('field', 'items', 'rule', 'count')
    );
  END IF;

  FOR item_value, ordinal_index IN
    SELECT entries.value, (entries.ordinality - 1)::integer
    FROM jsonb_array_elements(p_request -> 'items') WITH ORDINALITY AS entries(value, ordinality)
    ORDER BY entries.ordinality
  LOOP
    IF jsonb_typeof(item_value) <> 'object' OR
       NOT (item_value ?& ARRAY['clientItemId', 'conceptId', 'pattern', 'front', 'back', 'tags', 'image']) OR
       EXISTS (
         SELECT 1 FROM jsonb_object_keys(item_value) AS item_keys(key)
         WHERE item_keys.key NOT IN ('clientItemId', 'conceptId', 'pattern', 'front', 'back', 'tags', 'image')
       ) OR
       jsonb_typeof(item_value -> 'clientItemId') <> 'string' OR
       jsonb_typeof(item_value -> 'conceptId') <> 'string' OR
       jsonb_typeof(item_value -> 'pattern') <> 'string' OR
       jsonb_typeof(item_value -> 'front') <> 'string' OR
       jsonb_typeof(item_value -> 'back') <> 'string' OR
       jsonb_typeof(item_value -> 'tags') <> 'array' OR
       jsonb_typeof(item_value -> 'image') <> 'object' THEN
      PERFORM public.ai_raise_import_error(
        'VALIDATION_ERROR', jsonb_build_object('field', 'items', 'rule', 'shape')
      );
    END IF;

    client_item_id := item_value ->> 'clientItemId';
    concept_id := item_value ->> 'conceptId';
    item_pattern := item_value ->> 'pattern';
    front_value := public.ai_normalize_display_text(item_value ->> 'front');
    back_value := public.ai_normalize_display_text(item_value ->> 'back');
    IF char_length(client_item_id) NOT BETWEEN 1 AND 64 OR
       char_length(concept_id) NOT BETWEEN 1 AND 64 OR
       item_pattern NOT IN ('R1', 'W1') OR
       char_length(front_value) NOT BETWEEN 1 AND 200 OR
       char_length(back_value) NOT BETWEEN 1 AND 200 OR
       (item_pattern = 'R1' AND front_value !~ '[㐀-䶿一-鿿𠀀-𫠟々〇〆]') OR
       (item_pattern = 'W1' AND back_value !~ '[㐀-䶿一-鿿𠀀-𫠟々〇〆]') THEN
      PERFORM public.ai_raise_import_error(
        'VALIDATION_ERROR', jsonb_build_object('field', 'items', 'rule', 'content')
      );
    END IF;
    IF client_item_id = ANY(client_item_ids) THEN
      PERFORM public.ai_raise_import_error(
        'DUPLICATE_IN_REQUEST', jsonb_build_object('clientItemId', client_item_id)
      );
    END IF;
    client_item_ids := array_append(client_item_ids, client_item_id);
    item_skill := CASE item_pattern WHEN 'R1' THEN 'reading' ELSE 'writing' END;

    image_value := item_value -> 'image';
    IF NOT (image_value ? 'mode') OR jsonb_typeof(image_value -> 'mode') <> 'string' OR
       (image_value ->> 'mode') NOT IN ('none', 'ai', 'upload') THEN
      PERFORM public.ai_raise_import_error(
        'VALIDATION_ERROR', jsonb_build_object('field', 'items.image', 'rule', 'mode')
      );
    END IF;
    image_mode := image_value ->> 'mode';
    upload_id := NULL;
    IF image_mode IN ('none', 'ai') THEN
      IF (SELECT count(*) FROM jsonb_object_keys(image_value)) <> 1 THEN
        PERFORM public.ai_raise_import_error(
          'VALIDATION_ERROR', jsonb_build_object('field', 'items.image', 'rule', 'shape')
        );
      END IF;
    ELSE
      IF NOT (image_value ? 'uploadId') OR
         (SELECT count(*) FROM jsonb_object_keys(image_value)) <> 2 OR
         jsonb_typeof(image_value -> 'uploadId') <> 'string' OR
         (image_value ->> 'uploadId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        PERFORM public.ai_raise_import_error(
          'VALIDATION_ERROR', jsonb_build_object('field', 'items.image.uploadId', 'rule', 'uuid')
        );
      END IF;
      upload_id := (image_value ->> 'uploadId')::uuid;
    END IF;

    IF jsonb_array_length(item_value -> 'tags') > 10 THEN
      PERFORM public.ai_raise_import_error(
        'VALIDATION_ERROR', jsonb_build_object('field', 'items.tags', 'rule', 'count')
      );
    END IF;
    prepared_tags := '[]'::jsonb;
    tag_names := ARRAY[]::text[];
    FOR tag_value IN SELECT value FROM jsonb_array_elements(item_value -> 'tags') LOOP
      IF jsonb_typeof(tag_value) <> 'string' THEN
        PERFORM public.ai_raise_import_error(
          'VALIDATION_ERROR', jsonb_build_object('field', 'items.tags', 'rule', 'string')
        );
      END IF;
      tag_display := public.ai_normalize_display_text(tag_value #>> '{}');
      tag_normalized := public.ai_normalize_key_text(tag_display);
      IF char_length(tag_display) NOT BETWEEN 1 AND 30 OR
         char_length(tag_normalized) NOT BETWEEN 1 AND 30 THEN
        PERFORM public.ai_raise_import_error(
          'VALIDATION_ERROR', jsonb_build_object('field', 'items.tags', 'rule', 'length')
        );
      END IF;
      IF tag_normalized = ANY(tag_names) THEN
        PERFORM public.ai_raise_import_error(
          'VALIDATION_ERROR', jsonb_build_object('field', 'items.tags', 'rule', 'unique')
        );
      END IF;
      tag_names := array_append(tag_names, tag_normalized);
      prepared_tags := prepared_tags || jsonb_build_array(jsonb_build_object(
        'displayName', tag_display, 'normalizedName', tag_normalized
      ));
    END LOOP;
    SELECT coalesce(jsonb_agg(tags.value ORDER BY tags.value ->> 'normalizedName'), '[]'::jsonb)
    INTO prepared_tags
    FROM jsonb_array_elements(prepared_tags) AS tags(value);

    item_card_key := public.ai_compute_card_key(item_pattern, front_value, back_value);
    IF item_card_key = ANY(card_keys) THEN
      PERFORM public.ai_raise_import_error(
        'DUPLICATE_IN_REQUEST', jsonb_build_object('clientItemId', client_item_id)
      );
    END IF;
    card_keys := array_append(card_keys, item_card_key);
    prepared_items := prepared_items || jsonb_build_array(jsonb_build_object(
      'clientItemId', client_item_id,
      'conceptId', concept_id,
      'ordinal', ordinal_index,
      'pattern', item_pattern,
      'skill', item_skill,
      'frontText', front_value,
      'backText', back_value,
      'cardKey', item_card_key,
      'tags', prepared_tags,
      'imageMode', image_mode,
      'uploadId', upload_id
    ));
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        items.value ->> 'conceptId' AS concept_id,
        count(*) FILTER (WHERE items.value ->> 'pattern' = 'R1') AS r1_count,
        count(*) FILTER (WHERE items.value ->> 'pattern' = 'W1') AS w1_count,
        min(items.value ->> 'frontText') FILTER (WHERE items.value ->> 'pattern' = 'R1') AS r1_front,
        min(items.value ->> 'backText') FILTER (WHERE items.value ->> 'pattern' = 'R1') AS r1_back,
        min(items.value ->> 'frontText') FILTER (WHERE items.value ->> 'pattern' = 'W1') AS w1_front,
        min(items.value ->> 'backText') FILTER (WHERE items.value ->> 'pattern' = 'W1') AS w1_back
      FROM jsonb_array_elements(prepared_items) AS items(value)
      GROUP BY items.value ->> 'conceptId'
    ) AS concepts
    WHERE concepts.r1_count > 1 OR concepts.w1_count > 1 OR
      (concepts.r1_count = 1 AND concepts.w1_count = 1 AND
       (concepts.r1_front IS DISTINCT FROM concepts.w1_back OR
        concepts.r1_back IS DISTINCT FROM concepts.w1_front))
  ) THEN
    PERFORM public.ai_raise_import_error(
      'VALIDATION_ERROR', jsonb_build_object('field', 'items', 'rule', 'pair')
    );
  END IF;

  SELECT count(DISTINCT items.value ->> 'conceptId')::integer
  INTO image_count
  FROM jsonb_array_elements(prepared_items) AS items(value)
  WHERE items.value ->> 'imageMode' = 'ai';

  FOR prepared_item IN
    SELECT value FROM jsonb_array_elements(prepared_items)
    ORDER BY (value ->> 'ordinal')::integer
  LOOP
    SELECT coalesce(
      string_agg(to_jsonb(tags.value ->> 'normalizedName')::text, ',' ORDER BY tags.value ->> 'normalizedName'),
      ''
    ) INTO canonical_tags
    FROM jsonb_array_elements(prepared_item -> 'tags') AS tags(value);
    canonical_image := CASE prepared_item ->> 'imageMode'
      WHEN 'upload' THEN '{"mode":"upload","uploadId":' ||
        to_jsonb(prepared_item ->> 'uploadId')::text || '}'
      ELSE '{"mode":' || to_jsonb(prepared_item ->> 'imageMode')::text || '}'
    END;
    IF canonical_items <> '' THEN
      canonical_items := canonical_items || ',';
    END IF;
    canonical_items := canonical_items ||
      '{"clientItemId":' || to_jsonb(prepared_item ->> 'clientItemId')::text ||
      ',"conceptId":' || to_jsonb(prepared_item ->> 'conceptId')::text ||
      ',"pattern":' || to_jsonb(prepared_item ->> 'pattern')::text ||
      ',"front":' || to_jsonb(prepared_item ->> 'frontText')::text ||
      ',"back":' || to_jsonb(prepared_item ->> 'backText')::text ||
      ',"tags":[' || canonical_tags || ']' ||
      ',"image":' || canonical_image || '}';
  END LOOP;
  canonical_request := '{"deck":' || canonical_deck || ',"items":[' || canonical_items || ']}';
  request_hash := encode(
    extensions.digest(convert_to(canonical_request, 'UTF8'), 'sha256'), 'hex'
  );

  RETURN jsonb_build_object(
    'deck', prepared_deck,
    'items', prepared_items,
    'requestedCardCount', item_count,
    'requestedImageCount', coalesce(image_count, 0),
    'importRequestHash', request_hash
  );
END;
$$;

CREATE FUNCTION public.commit_import_internal(
  p_actor_user_id uuid,
  p_source text,
  p_idempotency_key text,
  p_import_request_hash text,
  p_request jsonb,
  p_card_reservation_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  prepared jsonb;
  prepared_item jsonb;
  prepared_tag jsonb;
  candidate_id uuid;
  candidate_key text;
  upload_candidate uuid;
  locked_upload_owner uuid;
  locked_upload_status text;
  existing_batch public.ai_import_batches%ROWTYPE;
  reservation public.ai_quota_reservations%ROWTYPE;
  resolved_deck_id uuid;
  auto_deck_id uuid;
  matching_deck_ids uuid[];
  created_batch_id uuid;
  created_item_id uuid;
  resolved_tag_id uuid;
  requested_card_count integer;
  requested_image_count integer;
  expected_reservation_units integer;
  expected_reservation_status text;
  duplicate_client_item_id text;
BEGIN
  prepared := public.ai_prepare_import_request(p_request);
  requested_card_count := (prepared ->> 'requestedCardCount')::integer;
  requested_image_count := (prepared ->> 'requestedImageCount')::integer;

  FOR candidate_id IN
    SELECT cards.id
    FROM public.cards AS cards
    WHERE cards.owner_user_id = p_actor_user_id
      AND cards.visibility = 'private'
      AND cards.card_key IN (
        SELECT items.value ->> 'cardKey'
        FROM jsonb_array_elements(prepared -> 'items') AS items(value)
      )
    ORDER BY cards.id
    FOR UPDATE
  LOOP
    NULL;
  END LOOP;

  FOR candidate_key IN
    SELECT DISTINCT items.value ->> 'cardKey'
    FROM jsonb_array_elements(prepared -> 'items') AS items(value)
    ORDER BY items.value ->> 'cardKey'
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      p_actor_user_id::text || chr(31) || 'card-key' || chr(31) || candidate_key, 1011
    ));
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_actor_user_id::text || chr(31) || 'commit' || chr(31) || p_idempotency_key, 1012
  ));

  SELECT batches.* INTO existing_batch
  FROM public.ai_import_batches AS batches
  WHERE batches.owner_user_id = p_actor_user_id
    AND batches.idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF existing_batch.source IS DISTINCT FROM p_source OR
       existing_batch.import_request_hash IS DISTINCT FROM p_import_request_hash OR
       existing_batch.card_reservation_key IS DISTINCT FROM p_card_reservation_key THEN
      PERFORM public.ai_raise_import_error('CONFLICT');
    END IF;
    IF prepared ->> 'importRequestHash' IS DISTINCT FROM p_import_request_hash THEN
      PERFORM public.ai_raise_import_error(
        'VALIDATION_ERROR', jsonb_build_object('field', 'importRequestHash', 'rule', 'mismatch')
      );
    END IF;
    RETURN jsonb_build_object(
      'batchId', existing_batch.id,
      'status', existing_batch.status,
      'requestedCardCount', existing_batch.requested_card_count,
      'requestedImageCount', existing_batch.requested_image_count
    );
  END IF;

  IF prepared ->> 'importRequestHash' IS DISTINCT FROM p_import_request_hash THEN
    PERFORM public.ai_raise_import_error(
      'VALIDATION_ERROR', jsonb_build_object('field', 'importRequestHash', 'rule', 'mismatch')
    );
  END IF;

  SELECT items.value ->> 'clientItemId'
  INTO duplicate_client_item_id
  FROM jsonb_array_elements(prepared -> 'items') AS items(value)
  WHERE EXISTS (
    SELECT 1 FROM public.cards AS cards
    WHERE cards.owner_user_id = p_actor_user_id
      AND cards.visibility = 'private'
      AND cards.card_key = items.value ->> 'cardKey'
  )
  ORDER BY (items.value ->> 'ordinal')::integer
  LIMIT 1;
  IF duplicate_client_item_id IS NOT NULL THEN
    PERFORM public.ai_raise_import_error(
      'DUPLICATE_EXISTING', jsonb_build_object('itemId', duplicate_client_item_id)
    );
  END IF;

  SELECT reservations.* INTO reservation
  FROM public.ai_quota_reservations AS reservations
  WHERE reservations.owner_user_id = p_actor_user_id
    AND reservations.reservation_key = p_card_reservation_key
    AND reservations.kind = 'card_generation'
  FOR UPDATE;
  expected_reservation_units := CASE p_source WHEN 'app_ai' THEN requested_card_count ELSE 0 END;
  expected_reservation_status := CASE p_source WHEN 'app_ai' THEN 'reserved' ELSE 'exempt' END;
  IF NOT FOUND OR reservation.source IS DISTINCT FROM p_source OR
     reservation.units IS DISTINCT FROM expected_reservation_units OR
     reservation.status IS DISTINCT FROM expected_reservation_status OR
     reservation.provider_started_at IS NULL OR
     reservation.item_id IS NOT NULL OR reservation.concept_id IS NOT NULL OR
     reservation.import_request_hash IS NOT NULL AND
       reservation.import_request_hash IS DISTINCT FROM p_import_request_hash OR
     reservation.batch_id IS NOT NULL THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;

  IF prepared #>> '{deck,mode}' = 'id' THEN
    SELECT decks.id INTO resolved_deck_id
    FROM public.decks AS decks
    WHERE decks.id = (prepared #>> '{deck,id}')::uuid
      AND decks.owner_user_id = p_actor_user_id
    FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
    END IF;
  ELSIF prepared #>> '{deck,mode}' = 'name' THEN
    SELECT array_agg(decks.id ORDER BY decks.id)
    INTO matching_deck_ids
    FROM public.decks AS decks
    WHERE decks.owner_user_id = p_actor_user_id
      AND public.ai_normalize_key_text(decks.name) =
        public.ai_normalize_key_text(prepared #>> '{deck,name}');
    IF matching_deck_ids IS NULL THEN
      PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
    END IF;
    IF array_length(matching_deck_ids, 1) > 1 THEN
      PERFORM public.ai_raise_import_error(
        'DECK_AMBIGUOUS', jsonb_build_object(
          'normalizedName', public.ai_normalize_key_text(prepared #>> '{deck,name}')
        )
      );
    END IF;
    SELECT decks.id INTO STRICT resolved_deck_id
    FROM public.decks AS decks
    WHERE decks.id = matching_deck_ids[1]
    FOR UPDATE;
  ELSE
    INSERT INTO public.decks (owner_user_id, name)
    VALUES (p_actor_user_id, prepared #>> '{deck,name}')
    RETURNING id INTO STRICT resolved_deck_id;
    auto_deck_id := resolved_deck_id;
  END IF;

  FOR upload_candidate IN
    SELECT DISTINCT (items.value ->> 'uploadId')::uuid
    FROM jsonb_array_elements(prepared -> 'items') AS items(value)
    WHERE items.value ->> 'imageMode' = 'upload'
    ORDER BY (items.value ->> 'uploadId')::uuid
  LOOP
    SELECT uploads.owner_user_id, uploads.status
    INTO locked_upload_owner, locked_upload_status
    FROM public.ai_uploads AS uploads
    WHERE uploads.id = upload_candidate
    FOR UPDATE;
    IF NOT FOUND OR locked_upload_owner IS DISTINCT FROM p_actor_user_id THEN
      PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
    END IF;
    IF locked_upload_status IS DISTINCT FROM 'ready' THEN
      PERFORM public.ai_raise_import_error('CONFLICT');
    END IF;
  END LOOP;

  INSERT INTO public.ai_import_batches (
    owner_user_id, source, target_deck_id, auto_created_deck_id, status,
    idempotency_key, import_request_hash, card_reservation_key,
    requested_card_count, requested_image_count
  ) VALUES (
    p_actor_user_id, p_source, resolved_deck_id, auto_deck_id, 'committed',
    p_idempotency_key, p_import_request_hash, p_card_reservation_key,
    requested_card_count, requested_image_count
  ) RETURNING id INTO STRICT created_batch_id;

  UPDATE public.ai_quota_reservations
  SET import_request_hash = p_import_request_hash, batch_id = created_batch_id
  WHERE id = reservation.id;

  FOR prepared_tag IN
    SELECT DISTINCT ON (tags.value ->> 'normalizedName') tags.value
    FROM jsonb_array_elements(prepared -> 'items') AS items(value)
    CROSS JOIN LATERAL jsonb_array_elements(items.value -> 'tags') AS tags(value)
    ORDER BY tags.value ->> 'normalizedName', tags.value ->> 'displayName'
  LOOP
    INSERT INTO public.tags (owner_user_id, display_name, normalized_name)
    VALUES (
      p_actor_user_id,
      prepared_tag ->> 'displayName',
      prepared_tag ->> 'displayName'
    )
    ON CONFLICT (owner_user_id, normalized_name) DO NOTHING;
  END LOOP;

  IF current_setting('app.s10_failpoint', true) = 'commit_after_tags' THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;

  FOR prepared_item IN
    SELECT value FROM jsonb_array_elements(prepared -> 'items')
    ORDER BY (value ->> 'ordinal')::integer
  LOOP
    INSERT INTO public.ai_import_items (
      owner_user_id, batch_id, client_item_id, concept_id, ordinal,
      pattern, skill, front_text, back_text, card_key, image_mode, upload_id
    ) VALUES (
      p_actor_user_id, created_batch_id,
      prepared_item ->> 'clientItemId', prepared_item ->> 'conceptId',
      (prepared_item ->> 'ordinal')::integer,
      prepared_item ->> 'pattern', prepared_item ->> 'skill',
      prepared_item ->> 'frontText', prepared_item ->> 'backText',
      prepared_item ->> 'cardKey', prepared_item ->> 'imageMode',
      (prepared_item ->> 'uploadId')::uuid
    ) RETURNING id INTO STRICT created_item_id;

    FOR prepared_tag IN
      SELECT value FROM jsonb_array_elements(prepared_item -> 'tags')
      ORDER BY value ->> 'normalizedName'
    LOOP
      SELECT tags.id INTO STRICT resolved_tag_id
      FROM public.tags AS tags
      WHERE tags.owner_user_id = p_actor_user_id
        AND tags.normalized_name = prepared_tag ->> 'normalizedName'
      FOR KEY SHARE;
      INSERT INTO public.ai_import_item_tags (owner_user_id, item_id, tag_id)
      VALUES (p_actor_user_id, created_item_id, resolved_tag_id);
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'batchId', created_batch_id,
    'status', 'committed',
    'requestedCardCount', requested_card_count,
    'requestedImageCount', requested_image_count
  );
END;
$$;

CREATE FUNCTION public.commit_import(
  p_actor_user_id uuid,
  p_source text,
  p_idempotency_key text,
  p_import_request_hash text,
  p_request jsonb,
  p_card_reservation_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
  IF p_actor_user_id IS NULL OR p_source NOT IN ('app_ai', 'remote_mcp') OR
     p_idempotency_key IS NULL OR char_length(p_idempotency_key) NOT BETWEEN 1 AND 128 OR
     p_import_request_hash !~ '^[0-9a-f]{64}$' OR
     p_request IS NULL OR jsonb_typeof(p_request) <> 'object' OR
     p_card_reservation_key IS NULL OR
       char_length(p_card_reservation_key) NOT BETWEEN 1 AND 128 THEN
    PERFORM public.ai_raise_import_error(
      'VALIDATION_ERROR', jsonb_build_object('field', 'commit', 'rule', 'arguments')
    );
  END IF;
  RETURN public.commit_import_internal(
    p_actor_user_id, p_source, p_idempotency_key, p_import_request_hash,
    p_request, p_card_reservation_key
  );
END;
$$;

CREATE FUNCTION public.register_ai_upload_internal(
  p_owner_user_id uuid,
  p_upload_key text,
  p_purpose text,
  p_storage_path text,
  p_mime_type text,
  p_byte_size bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE existing_upload public.ai_uploads%ROWTYPE;
DECLARE path_upload public.ai_uploads%ROWTYPE;
DECLARE storage_owner uuid;
DECLARE storage_owner_id text;
DECLARE storage_metadata jsonb;
DECLARE created_upload_id uuid;
DECLARE failed_constraint text;
BEGIN
  IF p_owner_user_id IS NULL OR p_upload_key IS NULL OR
     char_length(p_upload_key) NOT BETWEEN 1 AND 128 OR
     p_purpose IS DISTINCT FROM 'card_illustration' OR
     p_storage_path IS NULL OR char_length(p_storage_path) NOT BETWEEN 1 AND 1024 OR
     left(p_storage_path, 1) = '/' OR p_storage_path ~ '(^|/)\.\.(/|$)' OR
     p_mime_type IS NULL OR p_mime_type NOT IN ('image/png', 'image/jpeg', 'image/webp') OR
     p_byte_size IS NULL OR p_byte_size NOT BETWEEN 1 AND 10485760 THEN
    PERFORM public.ai_raise_import_error(
      'VALIDATION_ERROR', jsonb_build_object('field', 'upload', 'rule', 'metadata')
    );
  END IF;
  IF p_storage_path NOT LIKE p_owner_user_id::text || '/%' OR
     char_length(p_storage_path) <= char_length(p_owner_user_id::text) + 1 THEN
    PERFORM public.ai_raise_import_error(
      'VALIDATION_ERROR', jsonb_build_object('field', 'storagePath', 'rule', 'ownerPrefix')
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_owner_user_id::text || chr(31) || 'upload-key' || chr(31) || p_upload_key, 1013
  ));

  SELECT uploads.* INTO existing_upload
  FROM public.ai_uploads AS uploads
  WHERE uploads.owner_user_id = p_owner_user_id
    AND uploads.upload_key = p_upload_key
  FOR UPDATE;
  IF FOUND THEN
    IF existing_upload.status IS DISTINCT FROM 'ready' OR
       existing_upload.purpose IS DISTINCT FROM p_purpose OR
       existing_upload.storage_path IS DISTINCT FROM p_storage_path OR
       existing_upload.mime_type IS DISTINCT FROM p_mime_type OR
       existing_upload.byte_size IS DISTINCT FROM p_byte_size THEN
      PERFORM public.ai_raise_import_error('CONFLICT');
    END IF;
    RETURN jsonb_build_object('uploadId', existing_upload.id, 'status', existing_upload.status);
  END IF;

  SELECT objects.owner, objects.owner_id, objects.metadata
  INTO storage_owner, storage_owner_id, storage_metadata
  FROM storage.objects AS objects
  WHERE objects.bucket_id = 'illustrations'
    AND objects.name = p_storage_path
  FOR UPDATE;
  IF NOT FOUND OR
     COALESCE(storage_owner_id, storage_owner::text) IS DISTINCT FROM p_owner_user_id::text THEN
    PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
  END IF;
  IF storage_metadata IS NULL OR jsonb_typeof(storage_metadata) <> 'object' OR
     storage_metadata ->> 'mimetype' IS DISTINCT FROM p_mime_type OR
     storage_metadata ->> 'size' IS DISTINCT FROM p_byte_size::text THEN
    PERFORM public.ai_raise_import_error(
      'VALIDATION_ERROR', jsonb_build_object('field', 'upload', 'rule', 'storageMetadata')
    );
  END IF;

  SELECT uploads.* INTO path_upload
  FROM public.ai_uploads AS uploads
  WHERE uploads.owner_user_id = p_owner_user_id
    AND uploads.storage_path = p_storage_path
  FOR UPDATE;
  IF FOUND THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;

  BEGIN
    INSERT INTO public.ai_uploads (
      owner_user_id, upload_key, purpose, storage_path, mime_type, byte_size, status
    ) VALUES (
      p_owner_user_id, p_upload_key, p_purpose, p_storage_path, p_mime_type, p_byte_size, 'ready'
    ) RETURNING id INTO STRICT created_upload_id;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
      IF failed_constraint IN (
        'ai_uploads_owner_upload_key_uq', 'ai_uploads_owner_storage_path_uq'
      ) THEN
        PERFORM public.ai_raise_import_error('CONFLICT');
      END IF;
      RAISE;
    WHEN foreign_key_violation THEN
      GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
      IF failed_constraint = 'ai_uploads_owner_fkey' THEN
        PERFORM public.ai_raise_import_error('UNAUTHORIZED');
      END IF;
      RAISE;
  END;

  RETURN jsonb_build_object('uploadId', created_upload_id, 'status', 'ready');
END;
$$;

CREATE FUNCTION public.register_ai_upload(
  p_owner_user_id uuid,
  p_upload_key text,
  p_purpose text,
  p_storage_path text,
  p_mime_type text,
  p_byte_size bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
  RETURN public.register_ai_upload_internal(
    p_owner_user_id, p_upload_key, p_purpose, p_storage_path, p_mime_type, p_byte_size
  );
END;
$$;

CREATE FUNCTION public.reserve_provider_usage_internal(
  p_owner_user_id uuid,
  p_reservation_key text,
  p_kind text,
  p_source text,
  p_generation_request_hash text,
  p_units integer,
  p_batch_id uuid DEFAULT NULL,
  p_item_id uuid DEFAULT NULL,
  p_concept_id text DEFAULT NULL,
  p_now timestamptz DEFAULT statement_timestamp()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE existing_reservation public.ai_quota_reservations%ROWTYPE;
DECLARE batch_source text;
DECLARE item_image_mode text;
DECLARE item_concept_id text;
DECLARE item_status text;
DECLARE item_reservation_key text;
DECLARE effective_status text;
DECLARE usage_day date;
DECLARE current_card_count integer;
DECLARE current_image_count integer;
DECLARE quota_limit integer;
DECLARE current_usage integer;
DECLARE created_reservation public.ai_quota_reservations%ROWTYPE;
DECLARE failed_constraint text;
BEGIN
  IF p_owner_user_id IS NULL THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
  IF p_reservation_key IS NULL OR char_length(p_reservation_key) NOT BETWEEN 1 AND 128 OR
     p_kind NOT IN ('card_generation', 'illustration_concept') OR
     p_source NOT IN ('app_ai', 'remote_mcp') OR
     p_generation_request_hash !~ '^[0-9a-f]{64}$' OR
     p_units IS NULL OR p_units NOT BETWEEN 0 AND 200 OR p_now IS NULL THEN
    PERFORM public.ai_raise_import_error(
      'VALIDATION_ERROR', jsonb_build_object('field', 'reservation', 'rule', 'invalid')
    );
  END IF;
  IF p_kind = 'card_generation' AND (
    p_batch_id IS NOT NULL OR p_item_id IS NOT NULL OR p_concept_id IS NOT NULL OR
    (p_source = 'app_ai' AND p_units NOT BETWEEN 1 AND 200) OR
    (p_source = 'remote_mcp' AND p_units <> 0)
  ) THEN
    PERFORM public.ai_raise_import_error(
      'VALIDATION_ERROR', jsonb_build_object('field', 'cardGeneration', 'rule', 'trustedContext')
    );
  END IF;
  IF p_kind = 'illustration_concept' AND (
    p_batch_id IS NULL OR p_item_id IS NULL OR p_concept_id IS NULL OR
    char_length(p_concept_id) NOT BETWEEN 1 AND 64 OR p_units > 50
  ) THEN
    PERFORM public.ai_raise_import_error(
      'VALIDATION_ERROR', jsonb_build_object('field', 'illustration', 'rule', 'trustedContext')
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_owner_user_id::text || chr(31) || p_reservation_key || chr(31) || p_kind,
      1010
    )
  );

  SELECT reservations.*
  INTO existing_reservation
  FROM public.ai_quota_reservations AS reservations
  WHERE reservations.owner_user_id = p_owner_user_id
    AND reservations.reservation_key = p_reservation_key
    AND reservations.kind = p_kind;

  IF FOUND THEN
    IF existing_reservation.source IS DISTINCT FROM p_source OR
       existing_reservation.generation_request_hash IS DISTINCT FROM p_generation_request_hash OR
       existing_reservation.units IS DISTINCT FROM p_units OR
       existing_reservation.batch_id IS DISTINCT FROM p_batch_id OR
       existing_reservation.item_id IS DISTINCT FROM p_item_id OR
       existing_reservation.concept_id IS DISTINCT FROM p_concept_id THEN
      PERFORM public.ai_raise_import_error('CONFLICT');
    END IF;
    RETURN jsonb_build_object(
      'reservationId', existing_reservation.id,
      'status', existing_reservation.status,
      'usageDate', existing_reservation.usage_date,
      'units', existing_reservation.units,
      'providerStartedAt', existing_reservation.provider_started_at
    );
  END IF;

  IF p_kind = 'illustration_concept' THEN
    SELECT batches.source
    INTO batch_source
    FROM public.ai_import_batches AS batches
    WHERE batches.id = p_batch_id
      AND batches.owner_user_id = p_owner_user_id
    FOR UPDATE;
    IF NOT FOUND OR batch_source IS DISTINCT FROM p_source THEN
      PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
    END IF;

    SELECT items.image_mode, items.concept_id, items.status,
      items.illustration_reservation_key
    INTO item_image_mode, item_concept_id, item_status, item_reservation_key
    FROM public.ai_import_items AS items
    WHERE items.id = p_item_id
      AND items.batch_id = p_batch_id
      AND items.owner_user_id = p_owner_user_id
    FOR UPDATE;
    IF NOT FOUND OR item_concept_id IS DISTINCT FROM p_concept_id THEN
      PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
    END IF;
    IF item_status NOT IN ('committed', 'processing') OR
       (item_reservation_key IS NOT NULL AND item_reservation_key <> p_reservation_key) THEN
      PERFORM public.ai_raise_import_error('CONFLICT');
    END IF;

    IF item_image_mode = 'ai' THEN
      IF p_units NOT BETWEEN 1 AND 50 THEN
        PERFORM public.ai_raise_import_error(
          'VALIDATION_ERROR', jsonb_build_object('field', 'units', 'rule', 'aiIllustration')
        );
      END IF;
      effective_status := 'reserved';
    ELSIF item_image_mode = 'upload' THEN
      IF p_units <> 0 THEN
        PERFORM public.ai_raise_import_error(
          'VALIDATION_ERROR', jsonb_build_object('field', 'units', 'rule', 'uploadExempt')
        );
      END IF;
      effective_status := 'exempt';
    ELSE
      PERFORM public.ai_raise_import_error(
        'VALIDATION_ERROR', jsonb_build_object('field', 'imageMode', 'rule', 'notReservable')
      );
    END IF;

    UPDATE public.ai_import_items
    SET status = 'processing', illustration_reservation_key = p_reservation_key
    WHERE id = p_item_id;
  ELSE
    effective_status := CASE WHEN p_source = 'app_ai' THEN 'reserved' ELSE 'exempt' END;
  END IF;

  usage_day := (p_now AT TIME ZONE 'Asia/Tokyo')::date;
  BEGIN
    INSERT INTO public.ai_usage_daily (owner_user_id, usage_date)
    VALUES (p_owner_user_id, usage_day)
    ON CONFLICT (owner_user_id, usage_date) DO NOTHING;
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    IF failed_constraint = 'ai_usage_daily_owner_fkey' THEN
      PERFORM public.ai_raise_import_error('UNAUTHORIZED');
    END IF;
    RAISE;
  END;

  SELECT usage.generated_card_count, usage.generated_image_count
  INTO STRICT current_card_count, current_image_count
  FROM public.ai_usage_daily AS usage
  WHERE usage.owner_user_id = p_owner_user_id
    AND usage.usage_date = usage_day
  FOR UPDATE;

  IF effective_status = 'reserved' THEN
    IF p_kind = 'card_generation' THEN
      quota_limit := 200;
      current_usage := current_card_count;
    ELSE
      quota_limit := 50;
      current_usage := current_image_count;
    END IF;
    IF current_usage + p_units > quota_limit THEN
      PERFORM public.ai_raise_import_error(
        'QUOTA_EXCEEDED',
        jsonb_build_object(
          'limit', quota_limit,
          'current', current_usage,
          'requested', p_units,
          'date', usage_day::text
        )
      );
    END IF;

    UPDATE public.ai_usage_daily
    SET generated_card_count = generated_card_count +
          CASE WHEN p_kind = 'card_generation' THEN p_units ELSE 0 END,
        generated_image_count = generated_image_count +
          CASE WHEN p_kind = 'illustration_concept' THEN p_units ELSE 0 END
    WHERE owner_user_id = p_owner_user_id AND usage_date = usage_day;
  END IF;

  INSERT INTO public.ai_quota_reservations (
    owner_user_id, reservation_key, kind, source, generation_request_hash,
    usage_date, batch_id, item_id, concept_id, units, status, provider_started_at
  ) VALUES (
    p_owner_user_id, p_reservation_key, p_kind, p_source, p_generation_request_hash,
    usage_day, p_batch_id, p_item_id, p_concept_id, p_units, effective_status, p_now
  )
  RETURNING * INTO STRICT created_reservation;

  RETURN jsonb_build_object(
    'reservationId', created_reservation.id,
    'status', created_reservation.status,
    'usageDate', created_reservation.usage_date,
    'units', created_reservation.units,
    'providerStartedAt', created_reservation.provider_started_at
  );
END;
$$;

CREATE FUNCTION public.reserve_provider_usage(
  p_owner_user_id uuid,
  p_reservation_key text,
  p_kind text,
  p_source text,
  p_generation_request_hash text,
  p_units integer,
  p_batch_id uuid DEFAULT NULL,
  p_item_id uuid DEFAULT NULL,
  p_concept_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
  RETURN public.reserve_provider_usage_internal(
    p_owner_user_id, p_reservation_key, p_kind, p_source,
    p_generation_request_hash, p_units, p_batch_id, p_item_id, p_concept_id,
    statement_timestamp()
  );
END;
$$;

CREATE FUNCTION public.protect_public_cards()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.visibility = 'public' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'S-10 public card is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER protect_public_cards
BEFORE UPDATE OR DELETE ON public.cards
FOR EACH ROW EXECUTE FUNCTION public.protect_public_cards();

ALTER TABLE public.ai_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_import_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_import_item_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_quota_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY cards_select_private_owner ON public.cards;
DROP POLICY cards_insert_private_owner ON public.cards;
DROP POLICY cards_update_private_owner ON public.cards;
DROP POLICY cards_delete_private_owner ON public.cards;
CREATE POLICY cards_select_private_owner ON public.cards FOR SELECT
  USING (visibility = 'private' AND (SELECT auth.uid()) = owner_user_id);
CREATE POLICY cards_insert_private_owner ON public.cards FOR INSERT
  WITH CHECK (visibility = 'private' AND (SELECT auth.uid()) = owner_user_id);
CREATE POLICY cards_update_private_owner ON public.cards FOR UPDATE
  USING (visibility = 'private' AND (SELECT auth.uid()) = owner_user_id)
  WITH CHECK (visibility = 'private' AND (SELECT auth.uid()) = owner_user_id);
CREATE POLICY cards_delete_private_owner ON public.cards FOR DELETE
  USING (visibility = 'private' AND (SELECT auth.uid()) = owner_user_id);

DROP POLICY deck_cards_select_owner_deck ON public.deck_cards;
DROP POLICY deck_cards_insert_owner_deck ON public.deck_cards;
DROP POLICY deck_cards_update_owner_deck ON public.deck_cards;
CREATE POLICY deck_cards_select_owner_deck ON public.deck_cards FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.decks AS decks
    WHERE decks.id = deck_cards.deck_id
      AND decks.owner_user_id = (SELECT auth.uid()))
);

CREATE POLICY ai_import_batches_select_owner ON public.ai_import_batches FOR SELECT
  USING ((SELECT auth.uid()) = owner_user_id);
CREATE POLICY ai_import_items_select_owner ON public.ai_import_items FOR SELECT
  USING ((SELECT auth.uid()) = owner_user_id);
CREATE POLICY ai_uploads_select_owner ON public.ai_uploads FOR SELECT
  USING ((SELECT auth.uid()) = owner_user_id);
CREATE POLICY tags_select_owner ON public.tags FOR SELECT
  USING ((SELECT auth.uid()) = owner_user_id);
CREATE POLICY tags_insert_owner ON public.tags FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = owner_user_id);
CREATE POLICY tags_update_owner ON public.tags FOR UPDATE
  USING ((SELECT auth.uid()) = owner_user_id)
  WITH CHECK ((SELECT auth.uid()) = owner_user_id);
CREATE POLICY tags_delete_owner ON public.tags FOR DELETE
  USING ((SELECT auth.uid()) = owner_user_id);
CREATE POLICY ai_import_item_tags_select_owner ON public.ai_import_item_tags FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.ai_import_items AS items
    WHERE items.id = ai_import_item_tags.item_id
      AND items.owner_user_id = (SELECT auth.uid()))
);
CREATE POLICY card_tags_select_owner ON public.card_tags FOR SELECT
  USING ((SELECT auth.uid()) = owner_user_id);
CREATE POLICY ai_usage_daily_select_owner ON public.ai_usage_daily FOR SELECT
  USING ((SELECT auth.uid()) = owner_user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cards TO authenticated;
GRANT SELECT ON public.cards TO anon;
GRANT SELECT ON public.deck_cards TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.deck_cards FROM anon, authenticated, service_role;
GRANT SELECT ON public.ai_import_batches, public.ai_import_items,
  public.ai_uploads, public.ai_import_item_tags, public.card_tags,
  public.ai_usage_daily TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tags TO authenticated;
REVOKE ALL ON public.ai_quota_reservations FROM anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON public.ai_import_batches, public.ai_import_items,
  public.ai_uploads, public.ai_import_item_tags, public.card_tags,
  public.ai_usage_daily FROM anon, authenticated, service_role;
REVOKE ALL ON public.tags FROM anon, service_role;

ALTER FUNCTION public.ai_normalize_display_text(text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.ai_normalize_key_text(text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.ai_compute_card_key(text, text, text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.ai_set_card_key() OWNER TO s10_migration_owner;
ALTER FUNCTION public.normalize_tag_names() OWNER TO s10_migration_owner;
ALTER FUNCTION public.enforce_import_batch_deck_owner() OWNER TO s10_migration_owner;
ALTER FUNCTION public.enforce_deck_card_owner() OWNER TO s10_migration_owner;
ALTER FUNCTION public.enforce_ai_import_item_tag_limit() OWNER TO s10_migration_owner;
ALTER FUNCTION public.protect_public_cards() OWNER TO s10_migration_owner;
ALTER FUNCTION public.ai_session_card_ids(uuid, jsonb, jsonb, jsonb, jsonb) OWNER TO s10_migration_owner;
ALTER FUNCTION public.lock_study_session_cards() OWNER TO s10_migration_owner;
ALTER FUNCTION public.guard_card_active_session() OWNER TO s10_migration_owner;
ALTER FUNCTION public.reset_review_state_on_content_change() OWNER TO s10_migration_owner;
ALTER FUNCTION public.ai_enable_internal_context() OWNER TO s10_migration_owner;
ALTER FUNCTION public.ai_internal_context_active() OWNER TO s10_migration_owner;
ALTER FUNCTION public.ai_raise_import_error(text, jsonb) OWNER TO s10_migration_owner;
ALTER FUNCTION public.ai_prepare_import_request(jsonb) OWNER TO s10_migration_owner;
ALTER FUNCTION public.commit_import_internal(uuid, text, text, text, jsonb, text)
  OWNER TO s10_migration_owner;
ALTER FUNCTION public.commit_import(uuid, text, text, text, jsonb, text)
  OWNER TO s10_migration_owner;
ALTER FUNCTION public.register_ai_upload_internal(uuid, text, text, text, text, bigint)
  OWNER TO s10_migration_owner;
ALTER FUNCTION public.register_ai_upload(uuid, text, text, text, text, bigint)
  OWNER TO s10_migration_owner;
ALTER FUNCTION public.reserve_provider_usage_internal(
  uuid, text, text, text, text, integer, uuid, uuid, text, timestamptz
) OWNER TO s10_migration_owner;
ALTER FUNCTION public.reserve_provider_usage(
  uuid, text, text, text, text, integer, uuid, uuid, text
) OWNER TO s10_migration_owner;

REVOKE ALL ON FUNCTION public.ai_normalize_display_text(text),
  public.ai_normalize_key_text(text), public.ai_compute_card_key(text, text, text),
  public.ai_set_card_key(), public.normalize_tag_names(),
  public.enforce_import_batch_deck_owner(), public.enforce_deck_card_owner(),
  public.enforce_ai_import_item_tag_limit(), public.protect_public_cards(),
  public.ai_session_card_ids(uuid, jsonb, jsonb, jsonb, jsonb),
  public.lock_study_session_cards(), public.guard_card_active_session(),
  public.reset_review_state_on_content_change(),
  public.update_updated_at_column()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ai_enable_internal_context(),
  public.ai_internal_context_active(), public.ai_raise_import_error(text, jsonb),
  public.ai_prepare_import_request(jsonb),
  public.commit_import_internal(uuid, text, text, text, jsonb, text),
  public.register_ai_upload_internal(uuid, text, text, text, text, bigint),
  public.reserve_provider_usage_internal(
    uuid, text, text, text, text, integer, uuid, uuid, text, timestamptz
  )
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reserve_provider_usage(
  uuid, text, text, text, text, integer, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_import(uuid, text, text, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_ai_upload(uuid, text, text, text, text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_normalize_display_text(text),
  public.ai_normalize_key_text(text), public.ai_compute_card_key(text, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_provider_usage(
  uuid, text, text, text, text, integer, uuid, uuid, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_import(uuid, text, text, text, jsonb, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.register_ai_upload(uuid, text, text, text, text, bigint)
  TO service_role;
GRANT USAGE ON SCHEMA extensions TO authenticated, service_role;

GRANT USAGE ON SCHEMA public, extensions, storage TO s10_migration_owner;
GRANT SELECT, UPDATE ON public.cards TO s10_migration_owner;
GRANT SELECT, INSERT, UPDATE ON public.decks TO s10_migration_owner;
GRANT SELECT ON public.study_sessions TO s10_migration_owner;
GRANT SELECT, DELETE ON public.review_states TO s10_migration_owner;
GRANT SELECT, INSERT, UPDATE ON public.ai_import_batches, public.ai_import_items,
  public.tags TO s10_migration_owner;
GRANT SELECT, INSERT ON public.ai_import_item_tags TO s10_migration_owner;
GRANT SELECT, INSERT, UPDATE ON public.ai_uploads TO s10_migration_owner;
GRANT SELECT, INSERT, UPDATE ON public.ai_usage_daily, public.ai_quota_reservations
  TO s10_migration_owner;
GRANT SELECT, UPDATE ON storage.objects TO s10_migration_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
ALTER SCHEMA public OWNER TO s10_migration_owner;
GRANT CREATE ON SCHEMA public TO s10_migration_owner;

COMMIT;
