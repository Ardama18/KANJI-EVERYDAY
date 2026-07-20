-- ChatGPT may rotate the OAuth client identity between preview_card_import and
-- commit_card_import. The Next.js service already accepts that rotation while
-- preserving the owner, request hash, reservation, expiry, and HMAC boundary.
-- Keep the database-side commit wrapper aligned with that contract.

CREATE OR REPLACE FUNCTION public.s14_remote_commit_import(
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

  preview_secret := public.s14_remote_preview_hmac_secret();
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

ALTER FUNCTION public.s14_remote_commit_import(text,text,text,text,text,text,jsonb,text) OWNER TO s10_migration_owner;

REVOKE ALL ON FUNCTION public.s14_remote_commit_import(text,text,text,text,text,text,jsonb,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.s14_remote_commit_import(text,text,text,text,text,text,jsonb,text)
  TO authenticated;
