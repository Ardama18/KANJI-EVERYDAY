-- Keep Hosted Supabase OAuth access-token audience aligned with the stable
-- KANJI-EVERYDAY MCP production origin. ChatGPT receives this JWT after consent
-- and the MCP resource server validates `aud` exactly before tool dispatch.

CREATE OR REPLACE FUNCTION public.s14_phase0_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  claims jsonb;
BEGIN
  claims := event -> 'claims';
  IF claims ? 'client_id' THEN
    claims := jsonb_set(
      claims,
      '{aud}',
      to_jsonb('https://kanji-everyday.vercel.app/api/mcp'::text),
      true
    );
  END IF;
  RETURN jsonb_build_object('claims', claims);
END;
$function$;

ALTER FUNCTION public.s14_phase0_access_token_hook(jsonb) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.s14_phase0_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.s14_phase0_access_token_hook(jsonb)
  TO service_role, supabase_auth_admin;
