-- S-16D: Persist human-approved mnemonics inside the app_ai commit RPC.
--
-- Extends the UI-only wrapper commit_generated_import_async with an optional
-- p_mnemonics jsonb argument (DEFAULT NULL keeps existing/non-approval commits
-- on their prior behaviour). Inside the same SECURITY DEFINER transaction that
-- materialises illustration rows, the approved mnemonics are upserted into
-- card_mnemonics after resolving the real illustration_key from the freshly
-- materialised rows (ADR-012 decisions 1/2/3/5).
--
-- The shared primitive commit_import_async (also used by the Remote MCP path
-- s14_remote_commit_import) is NOT modified. Only this wrapper changes, so the
-- Remote MCP boundary is untouched.

DROP FUNCTION IF EXISTS public.commit_generated_import_async(uuid,text,text,jsonb,text);

CREATE FUNCTION public.commit_generated_import_async(
	p_actor_user_id uuid,
	p_idempotency_key text,
	p_import_request_hash text,
	p_request jsonb,
	p_card_reservation_key text,
	p_mnemonics jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE prepared jsonb;
DECLARE final_card_count integer;
DECLARE charged_units integer;
DECLARE reservation_id uuid;
DECLARE existing_batch_id uuid;
DECLARE result jsonb;
DECLARE target_batch_id uuid;
DECLARE mnemonic_row record;
DECLARE resolved_key text;
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
		-- Idempotent re-commit: collect the result and fall through so the
		-- mnemonic upsert below runs for retries as well (ON CONFLICT keeps it
		-- idempotent because the join resolves the same illustration_key).
		result := public.commit_import_async(
			p_actor_user_id,'app_ai',p_idempotency_key,p_import_request_hash,
			p_request,p_card_reservation_key
		);
	ELSE
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
	END IF;

	-- Same-transaction mnemonic upsert. owner is always the authenticated actor
	-- (never client-supplied). illustration_key is resolved from the rows that
	-- commit_import_async just materialised, never recomputed here (ADR-012 #2).
	target_batch_id := (result->>'batchId')::uuid;
	IF p_mnemonics IS NOT NULL THEN
		IF jsonb_typeof(p_mnemonics) <> 'array' THEN
			PERFORM public.ai_raise_import_error(
				'VALIDATION_ERROR', jsonb_build_object('field','mnemonics','rule','type')
			);
		END IF;
		FOR mnemonic_row IN
			SELECT entry.value ->> 'conceptId'  AS concept_id,
			       entry.value -> 'slots'       AS slots,
			       entry.value -> 'explanation' AS explanation
			FROM jsonb_array_elements(p_mnemonics) AS entry(value)
		LOOP
			resolved_key := NULL;
			SELECT ill.illustration_key INTO resolved_key
			FROM public.ai_import_concept_jobs AS jobs
			JOIN public.illustrations AS ill ON ill.id = jobs.illustration_id
			WHERE jobs.batch_id = target_batch_id
				AND jobs.owner_user_id = p_actor_user_id
				AND jobs.concept_id = mnemonic_row.concept_id
				AND ill.owner_user_id = p_actor_user_id;
			-- image_mode='none' (no illustration row) or an unknown conceptId
			-- yields no key and is skipped: no card_mnemonics row is written.
			IF resolved_key IS NULL THEN CONTINUE; END IF;
			INSERT INTO public.card_mnemonics (
				owner_user_id, illustration_key, slots, explanation, status
			) VALUES (
				p_actor_user_id, resolved_key, mnemonic_row.slots, mnemonic_row.explanation, 'approved'
			)
			ON CONFLICT (owner_user_id, illustration_key) DO UPDATE
				SET slots       = EXCLUDED.slots,
					explanation = EXCLUDED.explanation,
					status      = 'approved',
					updated_at  = now();
		END LOOP;
	END IF;

	RETURN result;
END;
$$;

ALTER FUNCTION public.commit_generated_import_async(uuid,text,text,jsonb,text,jsonb)
	OWNER TO s10_migration_owner;

REVOKE ALL ON FUNCTION public.commit_generated_import_async(uuid,text,text,jsonb,text,jsonb)
	FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_generated_import_async(uuid,text,text,jsonb,text,jsonb)
	TO service_role;
