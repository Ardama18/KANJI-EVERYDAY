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

COMMIT;
