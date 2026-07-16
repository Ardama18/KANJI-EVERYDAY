-- Frozen populated S-10 lifecycle states used by the S-11 upgrade job.
BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '11000000-0000-4000-8000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated','authenticated','s11-upgrade@example.local','fixture-not-for-login',now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ai_uploads (
  id,owner_user_id,upload_key,purpose,storage_path,mime_type,byte_size,status,consumed_at
) VALUES
  ('11000000-0000-4000-8000-000000000011','11000000-0000-4000-8000-000000000001','upgrade-ready',
   'card_illustration','11000000-0000-4000-8000-000000000001/ready','image/png',128,'ready',NULL),
  ('11000000-0000-4000-8000-000000000012','11000000-0000-4000-8000-000000000001','upgrade-consumed',
   'card_illustration','11000000-0000-4000-8000-000000000001/consumed','image/jpeg',256,'consumed',now()),
  ('11000000-0000-4000-8000-000000000013','11000000-0000-4000-8000-000000000001','upgrade-deleted',
   'card_illustration','11000000-0000-4000-8000-000000000001/deleted','image/webp',512,'deleted',NULL)
ON CONFLICT (id) DO NOTHING;

COMMIT;
