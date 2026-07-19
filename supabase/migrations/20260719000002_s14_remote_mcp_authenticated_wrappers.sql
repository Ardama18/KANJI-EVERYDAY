-- S-14 Remote MCP authenticated wrappers.
-- This migration deliberately does not read Supabase internal auth tables.  The
-- remote actor is derived solely from the packed PostgREST JWT claims GUC.

BEGIN;

-- Login continuation state is deliberately durable and server-side. The
-- browser only carries an opaque random UUID cookie; consuming it deletes the
-- authorization ID before the consent page is rendered.
CREATE SCHEMA IF NOT EXISTS s14_private;
CREATE TABLE s14_private.oauth_consent_states (
  state_id uuid PRIMARY KEY,
  authorization_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE INDEX oauth_consent_states_expiry_idx ON s14_private.oauth_consent_states(expires_at);

CREATE FUNCTION public.s14_create_oauth_consent_state(
  p_state_id uuid,
  p_authorization_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_state_id IS NULL OR p_authorization_id IS NULL THEN
    PERFORM public.ai_raise_import_error('VALIDATION_ERROR');
  END IF;
  DELETE FROM s14_private.oauth_consent_states WHERE expires_at <= statement_timestamp();
  INSERT INTO s14_private.oauth_consent_states(state_id, authorization_id, expires_at)
  VALUES (p_state_id, p_authorization_id, statement_timestamp() + interval '5 minutes');
EXCEPTION WHEN unique_violation THEN
  PERFORM public.ai_raise_import_error('CONFLICT');
END;
$$;

CREATE FUNCTION public.s14_consume_oauth_consent_state(p_state_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE authorization_id uuid;
BEGIN
  IF p_state_id IS NULL THEN
    PERFORM public.ai_raise_import_error('VALIDATION_ERROR');
  END IF;
  DELETE FROM s14_private.oauth_consent_states
  WHERE state_id = p_state_id AND expires_at > statement_timestamp()
  RETURNING oauth_consent_states.authorization_id INTO authorization_id;
  RETURN authorization_id;
END;
$$;

CREATE FUNCTION public.ai_s14_remote_mcp_actor(
  p_expected_client_id text,
  p_expected_session_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  claims jsonb;
  actor_id uuid;
  actor_sub text;
BEGIN
  IF p_expected_client_id IS NULL OR char_length(p_expected_client_id) NOT BETWEEN 1 AND 512
    OR p_expected_session_id IS NULL OR char_length(p_expected_session_id) NOT BETWEEN 1 AND 512 THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
  BEGIN
    claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END;
  IF claims IS NULL OR jsonb_typeof(claims) <> 'object'
    OR claims ->> 'role' IS DISTINCT FROM 'authenticated'
    OR claims ->> 'client_id' IS DISTINCT FROM p_expected_client_id
    OR claims ->> 'session_id' IS DISTINCT FROM p_expected_session_id THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
  actor_sub := claims ->> 'sub';
  IF actor_sub IS NULL
    OR actor_sub !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
  actor_id := actor_sub::uuid;
  RETURN actor_id;
END;
$$;

CREATE FUNCTION public.s14_remote_validate_import_preview(
  p_client_id text,
  p_session_id text,
  p_deck_id uuid,
  p_reservation_key text,
  p_import_request_hash text,
  p_upload_ids uuid[],
  p_items jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  actor_id uuid;
  duplicate_client_item_id text;
BEGIN
  actor_id := public.ai_s14_remote_mcp_actor(p_client_id, p_session_id);
  IF p_deck_id IS NULL OR p_reservation_key IS NULL
    OR char_length(p_reservation_key) NOT BETWEEN 1 AND 128
    OR p_import_request_hash IS NULL OR p_import_request_hash !~ '^[0-9a-f]{64}$'
    OR p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) AS item(value)
      WHERE jsonb_typeof(item.value) <> 'object'
        OR item.value ->> 'clientItemId' IS NULL
        OR item.value ->> 'cardKey' !~ '^[0-9a-f]{64}$'
    ) THEN
    PERFORM public.ai_raise_import_error('VALIDATION_ERROR');
  END IF;
  PERFORM 1 FROM public.decks AS decks
  WHERE decks.id = p_deck_id AND decks.owner_user_id = actor_id;
  IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
  -- Preview is intentionally write-free.  Existing cards and uploads are only
  -- inspected under owner predicates; reservation, batch, usage and queue rows
  -- are created exclusively by the authenticated commit wrapper below.
  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_upload_ids, ARRAY[]::uuid[])) AS ids(id)
    LEFT JOIN public.ai_uploads AS uploads
      ON uploads.id = ids.id AND uploads.owner_user_id = actor_id
        AND uploads.usage_scope = 'card_illustration' AND uploads.status = 'ready'
    WHERE uploads.id IS NULL
  ) THEN
    PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
  END IF;
  SELECT item.value ->> 'clientItemId' INTO duplicate_client_item_id
  FROM jsonb_array_elements(p_items) AS item(value)
  JOIN public.cards AS cards ON cards.owner_user_id = actor_id
    AND cards.visibility = 'private' AND cards.card_key = item.value ->> 'cardKey'
  ORDER BY item.value ->> 'clientItemId'
  LIMIT 1;
  IF duplicate_client_item_id IS NOT NULL THEN
    PERFORM public.ai_raise_import_error(
      'DUPLICATE_EXISTING', jsonb_build_object('itemId', duplicate_client_item_id)
    );
  END IF;
END;
$$;

-- The S-11 queue/body has no caller authorization of its own.  Keep it private
-- and have the legacy service-role and S-14 authenticated entry points call it.
CREATE FUNCTION public.ai_s14_enqueue_import_internal(
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
  result jsonb;
  target_batch_id uuid;
  concept_row record;
  created_job_id uuid;
  created_illustration_id uuid;
  message_id bigint;
BEGIN
  result := public.commit_import_internal(
    p_actor_user_id, p_source, p_idempotency_key, p_import_request_hash,
    p_request, p_card_reservation_key
  );
  target_batch_id := (result ->> 'batchId')::uuid;
  FOR concept_row IN
    SELECT items.concept_id, min(items.image_mode) AS image_mode,
      max(items.image_mode) AS max_image_mode, min(items.upload_id::text)::uuid AS upload_id,
      max(items.upload_id::text)::uuid AS max_upload_id
    FROM public.ai_import_items AS items
    WHERE items.batch_id = target_batch_id AND items.owner_user_id = p_actor_user_id
    GROUP BY items.concept_id
    ORDER BY items.concept_id
  LOOP
    IF concept_row.image_mode IS DISTINCT FROM concept_row.max_image_mode
      OR concept_row.upload_id IS DISTINCT FROM concept_row.max_upload_id THEN
      PERFORM public.ai_raise_import_error('VALIDATION_ERROR');
    END IF;
    SELECT jobs.id INTO created_job_id
    FROM public.ai_import_concept_jobs AS jobs
    WHERE jobs.batch_id = target_batch_id AND jobs.concept_id = concept_row.concept_id
    FOR UPDATE;
    IF FOUND THEN CONTINUE; END IF;
    IF concept_row.image_mode <> 'none' THEN
      INSERT INTO public.illustrations (owner_user_id, illustration_key, status, storage_path, prompt, model_info)
      VALUES (
        p_actor_user_id,
        's11:' || target_batch_id::text || ':' || encode(extensions.digest(convert_to(concept_row.concept_id, 'UTF8'), 'sha256'), 'hex'),
        'pending', NULL, NULL, NULL
      ) RETURNING id INTO STRICT created_illustration_id;
    ELSE
      created_illustration_id := NULL;
    END IF;
    INSERT INTO public.ai_import_concept_jobs (owner_user_id, batch_id, concept_id, illustration_id)
    VALUES (p_actor_user_id, target_batch_id, concept_row.concept_id, created_illustration_id)
    RETURNING id INTO STRICT created_job_id;
    IF concept_row.upload_id IS NOT NULL THEN
      INSERT INTO public.ai_upload_consumers(upload_id, job_id, owner_user_id)
      SELECT uploads.id, created_job_id, p_actor_user_id
      FROM public.ai_uploads AS uploads
      WHERE uploads.id = concept_row.upload_id AND uploads.owner_user_id = p_actor_user_id AND uploads.status = 'ready';
      IF NOT FOUND THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
    END IF;
    IF created_illustration_id IS NOT NULL THEN
      INSERT INTO public.ai_illustration_objects (
        owner_user_id, job_id, illustration_id, storage_path, state, delete_due_at
      ) VALUES (
        p_actor_user_id, created_job_id, created_illustration_id,
        p_actor_user_id::text || '/s11-managed/' || created_illustration_id::text || '.png',
        'uploading', statement_timestamp() + interval '23 hours 45 minutes'
      );
    END IF;
    SELECT pgmq.send(
      'ai_card_imports', jsonb_build_object('version', 1, 'jobId', created_job_id, 'batchId', target_batch_id)
    ) INTO STRICT message_id;
    UPDATE public.ai_import_concept_jobs SET queue_message_id = message_id WHERE id = created_job_id;
  END LOOP;
  RETURN jsonb_build_object(
    'batchId', target_batch_id, 'status', 'queued',
    'statusUrl', '/api/ai/imports/status?batchId=' || target_batch_id::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_import_async(
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
  PERFORM public.ai_s11_require_service_role();
  RETURN public.ai_s14_enqueue_import_internal(
    p_actor_user_id, p_source, p_idempotency_key, p_import_request_hash, p_request, p_card_reservation_key
  );
END;
$$;

CREATE FUNCTION public.s14_remote_commit_import(
  p_client_id text,
  p_session_id text,
  p_idempotency_key text,
  p_import_request_hash text,
  p_generation_request_hash text,
  p_preview_token text,
  p_request jsonb,
  p_card_reservation_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  actor_id uuid;
  expected_generation_hash text;
  preview_secret text;
  preview_parts text[];
  preview_payload_text text;
  preview_payload jsonb;
  preview_payload_part text;
  preview_signature_part text;
  preview_signature_expected text;
  preview_payload_base64 text;
  preview_payload_padding integer;
  preview_expires_at bigint;
BEGIN
  actor_id := public.ai_s14_remote_mcp_actor(p_client_id, p_session_id);
  IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) NOT BETWEEN 1 AND 128
    OR p_import_request_hash IS NULL OR p_import_request_hash !~ '^[0-9a-f]{64}$'
    OR p_generation_request_hash IS NULL OR p_generation_request_hash !~ '^[0-9a-f]{64}$'
    OR p_preview_token IS NULL OR char_length(p_preview_token) NOT BETWEEN 1 AND 4096
    OR p_request IS NULL OR jsonb_typeof(p_request) <> 'object'
    OR p_card_reservation_key IS NULL OR char_length(p_card_reservation_key) NOT BETWEEN 1 AND 128 THEN
    PERFORM public.ai_raise_import_error('VALIDATION_ERROR');
  END IF;

  preview_secret := NULLIF(current_setting('app.ai_preview_hmac_secret', true), '');
  IF preview_secret IS NULL THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
  preview_parts := regexp_split_to_array(p_preview_token, '\.');
  IF array_length(preview_parts, 1) IS DISTINCT FROM 2
    OR preview_parts[1] !~ '^[A-Za-z0-9_-]+$'
    OR preview_parts[2] !~ '^[A-Za-z0-9_-]+$' THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
  preview_payload_part := preview_parts[1];
  preview_signature_part := preview_parts[2];
  preview_signature_expected := rtrim(translate(encode(extensions.hmac(
    convert_to(preview_payload_part, 'UTF8'),
    convert_to(preview_secret, 'UTF8'),
    'sha256'
  ), 'base64'), '+/', '-_'), '=');
  IF preview_signature_part IS DISTINCT FROM preview_signature_expected THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
  IF length(preview_payload_part) % 4 = 1 THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
  preview_payload_padding := (4 - length(preview_payload_part) % 4) % 4;
  preview_payload_base64 := translate(preview_payload_part, '-_', '+/') || repeat('=', preview_payload_padding);
  BEGIN
    preview_payload_text := convert_from(decode(preview_payload_base64, 'base64'), 'UTF8');
    preview_payload := preview_payload_text::jsonb;
  EXCEPTION WHEN others THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END;
  IF preview_payload IS NULL OR jsonb_typeof(preview_payload) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(preview_payload)) <> 7
    OR preview_payload ->> 'v' IS DISTINCT FROM '2'
    OR preview_payload ->> 'domain' IS DISTINCT FROM 'kanji-everyday:remote-mcp:preview:v2'
    OR lower(preview_payload ->> 'userId') IS DISTINCT FROM lower(actor_id::text)
    OR lower(preview_payload ->> 'clientId') IS DISTINCT FROM lower(p_client_id)
    OR preview_payload ->> 'reservationKey' IS DISTINCT FROM p_card_reservation_key
    OR preview_payload ->> 'importRequestHash' IS DISTINCT FROM p_import_request_hash
    OR jsonb_typeof(preview_payload -> 'expiresAt') <> 'number'
    OR (preview_payload ->> 'expiresAt') !~ '^[0-9]+$' THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;
  preview_expires_at := (preview_payload ->> 'expiresAt')::bigint;
  IF floor(extract(epoch FROM statement_timestamp()))::bigint > preview_expires_at THEN
    PERFORM public.ai_raise_import_error('UNAUTHORIZED');
  END IF;

  -- Keep the byte contract identical to deriveRemoteGenerationRequestHash:
  -- each UTF-8 component is prefixed by a 4-byte big-endian length.
  expected_generation_hash := encode(extensions.digest(
    int4send(octet_length(convert_to('kanji-everyday:remote-mcp:generation:v1', 'UTF8')))
      || convert_to('kanji-everyday:remote-mcp:generation:v1', 'UTF8')
      || int4send(octet_length(convert_to(p_import_request_hash, 'UTF8')))
      || convert_to(p_import_request_hash, 'UTF8')
      || int4send(octet_length(convert_to(lower(p_client_id), 'UTF8')))
      || convert_to(lower(p_client_id), 'UTF8'),
    'sha256'
  ), 'hex');
  IF p_generation_request_hash IS DISTINCT FROM expected_generation_hash THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ai_import_batches AS batches
    WHERE batches.owner_user_id = actor_id AND batches.idempotency_key = p_idempotency_key
  ) THEN
    RETURN public.ai_s14_enqueue_import_internal(
      actor_id, 'remote_mcp', p_idempotency_key, p_import_request_hash, p_request, p_card_reservation_key
    );
  END IF;
  PERFORM public.reserve_provider_usage_internal(
    actor_id, p_card_reservation_key, 'card_generation', 'remote_mcp',
    p_generation_request_hash, 0, NULL, NULL, NULL, statement_timestamp()
  );
  RETURN public.ai_s14_enqueue_import_internal(
    actor_id, 'remote_mcp', p_idempotency_key, p_import_request_hash, p_request, p_card_reservation_key
  );
END;
$$;

CREATE FUNCTION public.ai_s14_import_status_internal(
  p_actor_user_id uuid,
  p_batch_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  target_batch public.ai_import_batches%ROWTYPE;
  response_status text;
  item_rows jsonb;
  succeeded_count integer;
  failed_count integer;
BEGIN
  IF p_actor_user_id IS NULL OR (p_batch_id IS NULL) = (p_idempotency_key IS NULL) THEN
    PERFORM public.ai_raise_import_error('VALIDATION_ERROR');
  END IF;
  SELECT batches.* INTO target_batch FROM public.ai_import_batches AS batches
  WHERE batches.owner_user_id = p_actor_user_id
    AND ((p_batch_id IS NOT NULL AND batches.id = p_batch_id)
      OR (p_idempotency_key IS NOT NULL AND batches.idempotency_key = p_idempotency_key));
  IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
  SELECT count(*) FILTER (WHERE items.status = 'finalized'),
    count(*) FILTER (WHERE items.status = 'failed'),
    coalesce(jsonb_agg(jsonb_build_object(
      'itemId', items.id, 'conceptId', items.concept_id,
      'status', CASE items.status WHEN 'committed' THEN 'queued' WHEN 'finalized' THEN 'succeeded'
        WHEN 'deleted' THEN 'undone' ELSE items.status END,
      'cardId', items.result_card_id, 'errorCode', items.error_code
    ) ORDER BY items.ordinal), '[]'::jsonb)
  INTO succeeded_count, failed_count, item_rows
  FROM public.ai_import_items AS items WHERE items.batch_id = target_batch.id;
  response_status := CASE
    WHEN target_batch.status = 'undone' THEN 'undone'
    WHEN succeeded_count + failed_count = target_batch.requested_card_count AND failed_count = 0 THEN 'completed'
    WHEN succeeded_count + failed_count = target_batch.requested_card_count AND succeeded_count = 0 THEN 'failed'
    WHEN succeeded_count + failed_count = target_batch.requested_card_count THEN 'partial'
    WHEN EXISTS (SELECT 1 FROM public.ai_import_items AS items WHERE items.batch_id = target_batch.id AND items.status = 'processing') THEN 'processing'
    ELSE 'queued'
  END;
  RETURN jsonb_build_object(
    'batchId', target_batch.id, 'status', response_status,
    'counts', jsonb_build_object('total', target_batch.requested_card_count, 'succeeded', succeeded_count, 'failed', failed_count),
    'items', item_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ai_import_status(
  p_actor_user_id uuid,
  p_batch_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM public.ai_s11_require_service_role();
  RETURN public.ai_s14_import_status_internal(p_actor_user_id, p_batch_id, p_idempotency_key);
END;
$$;

CREATE FUNCTION public.s14_remote_get_import_status(
  p_client_id text,
  p_session_id text,
  p_batch_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE actor_id uuid;
BEGIN
  actor_id := public.ai_s14_remote_mcp_actor(p_client_id, p_session_id);
  RETURN public.ai_s14_import_status_internal(actor_id, p_batch_id, p_idempotency_key);
END;
$$;

-- Composite updates remain an authenticated boundary.  The existing S-13
-- content primitive supplies its own owner/optimistic-concurrency checks.
CREATE FUNCTION public.s14_remote_update_imported_card(
  p_client_id text,
  p_session_id text,
  p_card_id uuid,
  p_patch jsonb,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE actor_id uuid;
BEGIN
  actor_id := public.ai_s14_remote_mcp_actor(p_client_id, p_session_id);
  RETURN public.update_imported_card_internal(actor_id, p_card_id, p_patch, p_expected_updated_at);
END;
$$;

-- MCP's single update tool may combine card content and relations.  Keep that
-- request atomic: every existing S-13 primitive is invoked from one definer
-- transaction after a single owner/client/session/optimistic-concurrency gate.
CREATE FUNCTION public.s14_remote_update_ai_card(
  p_client_id text,
  p_session_id text,
  p_card_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  actor_id uuid;
  locked_card public.cards%ROWTYPE;
  target_deck_ids uuid[];
  target_tag_ids uuid[];
  target_tag_names text[];
  target_illustration_id uuid;
  final_updated_at timestamptz;
BEGIN
  actor_id := public.ai_s14_remote_mcp_actor(p_client_id, p_session_id);
  IF p_card_id IS NULL OR p_expected_updated_at IS NULL OR p_patch IS NULL
    OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb
    OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_patch) keys(key)
      WHERE keys.key NOT IN ('content', 'deckIds', 'tagIds', 'tagNames', 'illustrationId')
    )
    OR (p_patch ? 'content' AND jsonb_typeof(p_patch->'content') <> 'object')
    OR (p_patch ? 'deckIds' AND jsonb_typeof(p_patch->'deckIds') <> 'array')
    OR (p_patch ? 'tagIds' AND jsonb_typeof(p_patch->'tagIds') <> 'array')
    OR (p_patch ? 'tagNames' AND jsonb_typeof(p_patch->'tagNames') <> 'array')
    OR (p_patch ? 'deckIds' AND jsonb_array_length(p_patch->'deckIds') > 100)
    OR (p_patch ? 'tagIds' AND jsonb_array_length(p_patch->'tagIds') > 10)
    OR (p_patch ? 'tagNames' AND jsonb_array_length(p_patch->'tagNames') > 10)
    OR (p_patch ? 'illustrationId' AND jsonb_typeof(p_patch->'illustrationId') NOT IN ('string', 'null'))
    OR (p_patch ? 'tagIds' AND p_patch ? 'tagNames')
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_patch->'deckIds', '[]'::jsonb)) values(value)
      WHERE jsonb_typeof(values.value) <> 'string'
        OR values.value #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_patch->'tagIds', '[]'::jsonb)) values(value)
      WHERE jsonb_typeof(values.value) <> 'string'
        OR values.value #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_patch->'tagNames', '[]'::jsonb)) values(value)
      WHERE jsonb_typeof(values.value) <> 'string'
    )
    OR (p_patch ? 'illustrationId' AND jsonb_typeof(p_patch->'illustrationId') = 'string'
      AND p_patch->>'illustrationId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  THEN
    PERFORM public.ai_raise_import_error('VALIDATION_ERROR');
  END IF;

  SELECT cards.* INTO locked_card
  FROM public.cards AS cards
  WHERE cards.id = p_card_id AND cards.owner_user_id = actor_id AND cards.visibility = 'private'
  FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
  PERFORM public.ai_s13_assert_managed_card(actor_id, p_card_id);
  IF locked_card.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    PERFORM public.ai_raise_import_error('CONFLICT');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_card_id::text, 1010));
  PERFORM public.ai_assert_card_inactive(p_card_id, actor_id);
  PERFORM 1 FROM public.ai_import_items AS items
  WHERE items.result_card_id = p_card_id AND items.owner_user_id = actor_id
  ORDER BY items.id FOR UPDATE;

  IF p_patch ? 'content' THEN
    PERFORM public.update_imported_card_internal(
      actor_id, p_card_id, p_patch->'content', p_expected_updated_at
    );
  END IF;
  IF p_patch ? 'deckIds' THEN
    SELECT COALESCE(array_agg(value::uuid ORDER BY value::uuid), '{}'::uuid[])
    INTO target_deck_ids
    FROM jsonb_array_elements_text(p_patch->'deckIds') values(value);
    PERFORM public.set_card_decks_internal(actor_id, p_card_id, target_deck_ids);
  END IF;
  IF p_patch ? 'tagIds' THEN
    SELECT COALESCE(array_agg(value::uuid ORDER BY value::uuid), '{}'::uuid[])
    INTO target_tag_ids
    FROM jsonb_array_elements_text(p_patch->'tagIds') values(value);
    PERFORM public.set_card_tags_internal(actor_id, p_card_id, target_tag_ids);
  END IF;
  IF p_patch ? 'tagNames' THEN
    SELECT COALESCE(array_agg(value ORDER BY value), '{}'::text[])
    INTO target_tag_names
    FROM jsonb_array_elements_text(p_patch->'tagNames') values(value);
    PERFORM public.set_card_tag_names_internal(actor_id, p_card_id, target_tag_names);
  END IF;
  IF p_patch ? 'illustrationId' THEN
    target_illustration_id := CASE
      WHEN jsonb_typeof(p_patch->'illustrationId') = 'null' THEN NULL
      ELSE (p_patch->>'illustrationId')::uuid
    END;
    PERFORM public.set_card_illustration_internal(actor_id, p_card_id, target_illustration_id);
  END IF;

  SELECT cards.updated_at INTO final_updated_at
  FROM public.cards AS cards
  WHERE cards.id = p_card_id AND cards.owner_user_id = actor_id;
  RETURN jsonb_build_object('cardId', p_card_id, 'updatedAt', final_updated_at);
END;
$$;

ALTER FUNCTION public.ai_s14_remote_mcp_actor(text,text) OWNER TO s10_migration_owner;
ALTER SCHEMA s14_private OWNER TO s10_migration_owner;
ALTER TABLE s14_private.oauth_consent_states OWNER TO s10_migration_owner;
ALTER FUNCTION public.s14_create_oauth_consent_state(uuid,uuid) OWNER TO s10_migration_owner;
ALTER FUNCTION public.s14_consume_oauth_consent_state(uuid) OWNER TO s10_migration_owner;
ALTER FUNCTION public.s14_remote_validate_import_preview(text,text,uuid,text,text,uuid[],jsonb) OWNER TO s10_migration_owner;
ALTER FUNCTION public.ai_s14_enqueue_import_internal(uuid,text,text,text,jsonb,text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.commit_import_async(uuid,text,text,text,jsonb,text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.s14_remote_commit_import(text,text,text,text,text,text,jsonb,text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.ai_s14_import_status_internal(uuid,uuid,text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.get_ai_import_status(uuid,uuid,text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.s14_remote_get_import_status(text,text,uuid,text) OWNER TO s10_migration_owner;
ALTER FUNCTION public.s14_remote_update_imported_card(text,text,uuid,jsonb,timestamptz) OWNER TO s10_migration_owner;
ALTER FUNCTION public.s14_remote_update_ai_card(text,text,uuid,timestamptz,jsonb) OWNER TO s10_migration_owner;

REVOKE ALL ON FUNCTION public.ai_s14_remote_mcp_actor(text,text),
  public.ai_s14_enqueue_import_internal(uuid,text,text,text,jsonb,text),
  public.ai_s14_import_status_internal(uuid,uuid,text)
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE s14_private.oauth_consent_states FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SCHEMA s14_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.s14_create_oauth_consent_state(uuid,uuid),
  public.s14_consume_oauth_consent_state(uuid)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.s14_create_oauth_consent_state(uuid,uuid),
  public.s14_consume_oauth_consent_state(uuid)
TO anon, authenticated;
REVOKE ALL ON FUNCTION public.s14_remote_validate_import_preview(text,text,uuid,text,text,uuid[],jsonb),
  public.s14_remote_commit_import(text,text,text,text,text,text,jsonb,text),
  public.s14_remote_get_import_status(text,text,uuid,text),
  public.s14_remote_update_imported_card(text,text,uuid,jsonb,timestamptz),
  public.s14_remote_update_ai_card(text,text,uuid,timestamptz,jsonb)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.s14_remote_validate_import_preview(text,text,uuid,text,text,uuid[],jsonb),
  public.s14_remote_commit_import(text,text,text,text,text,text,jsonb,text),
  public.s14_remote_get_import_status(text,text,uuid,text),
  public.s14_remote_update_imported_card(text,text,uuid,jsonb,timestamptz),
  public.s14_remote_update_ai_card(text,text,uuid,timestamptz,jsonb)
TO authenticated;

COMMIT;
