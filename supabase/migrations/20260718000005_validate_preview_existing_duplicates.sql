-- Extend read-only preview validation with owner-private card-key duplicate checks.

DROP FUNCTION IF EXISTS public.validate_ai_import_preview(uuid,uuid,text,text,uuid[]);
DROP FUNCTION IF EXISTS public.validate_ai_import_preview(uuid,uuid,text,text,uuid[],jsonb);

CREATE FUNCTION public.validate_ai_import_preview(
	p_owner_user_id uuid,
	p_deck_id uuid,
	p_reservation_key text,
	p_import_request_hash text,
	p_upload_ids uuid[] DEFAULT '{}'::uuid[],
	p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE duplicate_client_item_id text;
BEGIN
	PERFORM public.ai_s11_require_service_role();
	IF NOT EXISTS (SELECT 1 FROM public.decks WHERE id=p_deck_id AND owner_user_id=p_owner_user_id) THEN
		PERFORM public.ai_raise_import_error('DECK_NOT_FOUND');
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM public.ai_quota_reservations
		WHERE owner_user_id=p_owner_user_id AND reservation_key=p_reservation_key
			AND kind='card_generation' AND source='app_ai' AND status='reserved'
			AND provider_started_at IS NOT NULL
	) THEN PERFORM public.ai_raise_import_error('CONFLICT'); END IF;
	IF p_import_request_hash !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_items) <> 'array'
		OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
		PERFORM public.ai_raise_import_error('VALIDATION_ERROR');
	END IF;
	IF EXISTS (
		SELECT 1 FROM jsonb_array_elements(p_items) item
		WHERE jsonb_typeof(item) <> 'object'
			OR item->>'clientItemId' IS NULL
			OR item->>'cardKey' !~ '^[0-9a-f]{64}$'
	) THEN PERFORM public.ai_raise_import_error('VALIDATION_ERROR'); END IF;
	SELECT item->>'clientItemId' INTO duplicate_client_item_id
	FROM jsonb_array_elements(p_items) item
	JOIN public.cards cards ON cards.owner_user_id=p_owner_user_id
		AND cards.visibility='private' AND cards.card_key=item->>'cardKey'
	ORDER BY item->>'clientItemId' LIMIT 1;
	IF duplicate_client_item_id IS NOT NULL THEN
		PERFORM public.ai_raise_import_error(
			'DUPLICATE_EXISTING', jsonb_build_object('itemId',duplicate_client_item_id)
		);
	END IF;
	IF EXISTS (
		SELECT 1 FROM unnest(p_upload_ids) upload_id
		WHERE NOT EXISTS (
			SELECT 1 FROM public.ai_uploads uploads WHERE uploads.id=upload_id
				AND uploads.owner_user_id=p_owner_user_id AND uploads.usage_scope='card_illustration'
				AND uploads.status='ready'
		)
	) THEN PERFORM public.ai_raise_import_error('DECK_NOT_FOUND'); END IF;
	RETURN jsonb_build_object('valid',true);
END;
$$;

ALTER FUNCTION public.validate_ai_import_preview(uuid,uuid,text,text,uuid[],jsonb)
	OWNER TO s10_migration_owner;

REVOKE ALL ON FUNCTION public.validate_ai_import_preview(uuid,uuid,text,text,uuid[],jsonb)
	FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.validate_ai_import_preview(uuid,uuid,text,text,uuid[],jsonb)
	TO service_role;
