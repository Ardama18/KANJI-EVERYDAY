-- Commit an app-generated preview after the user excludes cards without
-- refunding or understating the provider units already charged at generation.

CREATE FUNCTION public.commit_generated_import_async(
	p_actor_user_id uuid,
	p_idempotency_key text,
	p_import_request_hash text,
	p_request jsonb,
	p_card_reservation_key text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prepared jsonb;
DECLARE final_card_count integer;
DECLARE charged_units integer;
DECLARE reservation_id uuid;
DECLARE existing_batch_id uuid;
DECLARE result jsonb;
BEGIN
	PERFORM public.ai_s11_require_service_role();
	IF p_actor_user_id IS NULL OR p_idempotency_key IS NULL
		OR char_length(p_idempotency_key) NOT BETWEEN 1 AND 128
		OR p_import_request_hash !~ '^[0-9a-f]{64}$'
		OR p_request IS NULL OR jsonb_typeof(p_request) <> 'object'
		OR p_card_reservation_key IS NULL
		OR char_length(p_card_reservation_key) NOT BETWEEN 1 AND 128 THEN
		PERFORM public.ai_raise_import_error(
			'VALIDATION_ERROR', jsonb_build_object('field','commit','rule','arguments')
		);
	END IF;

	-- Serialize with commit_import_internal so concurrent first attempts and
	-- retries observe the same batch before touching the reservation units.
	PERFORM pg_advisory_xact_lock(hashtextextended(
		p_actor_user_id::text || chr(31) || 'commit' || chr(31) || p_idempotency_key, 1012
	));
	SELECT batches.id INTO existing_batch_id
	FROM public.ai_import_batches AS batches
	WHERE batches.owner_user_id=p_actor_user_id
		AND batches.idempotency_key=p_idempotency_key
	FOR UPDATE;
	IF FOUND THEN
		RETURN public.commit_import_async(
			p_actor_user_id,'app_ai',p_idempotency_key,p_import_request_hash,
			p_request,p_card_reservation_key
		);
	END IF;

	prepared := public.ai_prepare_import_request(p_request);
	final_card_count := (prepared->>'requestedCardCount')::integer;
	SELECT reservations.id,reservations.units INTO reservation_id,charged_units
	FROM public.ai_quota_reservations AS reservations
	WHERE reservations.owner_user_id=p_actor_user_id
		AND reservations.reservation_key=p_card_reservation_key
		AND reservations.kind='card_generation'
		AND reservations.source='app_ai'
		AND reservations.status='reserved'
		AND reservations.provider_started_at IS NOT NULL
		AND reservations.batch_id IS NULL
	FOR UPDATE;
	IF NOT FOUND OR charged_units < final_card_count THEN
		PERFORM public.ai_raise_import_error('CONFLICT');
	END IF;

	UPDATE public.ai_quota_reservations SET units=final_card_count
	WHERE id=reservation_id;
	result := public.commit_import_async(
		p_actor_user_id,'app_ai',p_idempotency_key,p_import_request_hash,
		p_request,p_card_reservation_key
	);
	UPDATE public.ai_quota_reservations SET units=charged_units
	WHERE id=reservation_id AND batch_id=(result->>'batchId')::uuid;
	IF NOT FOUND THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
	RETURN result;
END;
$$;

ALTER FUNCTION public.commit_generated_import_async(uuid,text,text,jsonb,text)
	OWNER TO s10_migration_owner;

REVOKE ALL ON FUNCTION public.commit_generated_import_async(uuid,text,text,jsonb,text)
	FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_generated_import_async(uuid,text,text,jsonb,text)
	TO service_role;
