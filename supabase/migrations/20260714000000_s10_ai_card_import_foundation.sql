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
    (status = 'reserved' AND source = 'app_ai' AND units BETWEEN 1 AND 200) OR
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

COMMIT;
