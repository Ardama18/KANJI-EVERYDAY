-- S-02 Phase 2
-- AC-10

INSERT INTO storage.buckets (id, name, public)
VALUES ('illustrations', 'illustrations', false)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public;

DROP POLICY IF EXISTS storage_objects_select_owner_illustrations ON storage.objects;
CREATE POLICY storage_objects_select_owner_illustrations
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'illustrations'
  AND split_part(name, '/', 1) = auth.uid()::text
);

DROP POLICY IF EXISTS storage_objects_insert_owner_illustrations ON storage.objects;
CREATE POLICY storage_objects_insert_owner_illustrations
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'illustrations'
  AND split_part(name, '/', 1) = auth.uid()::text
);

DROP POLICY IF EXISTS storage_objects_update_owner_illustrations ON storage.objects;
CREATE POLICY storage_objects_update_owner_illustrations
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'illustrations'
  AND split_part(name, '/', 1) = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'illustrations'
  AND split_part(name, '/', 1) = auth.uid()::text
);

DROP POLICY IF EXISTS storage_objects_delete_owner_illustrations ON storage.objects;
CREATE POLICY storage_objects_delete_owner_illustrations
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'illustrations'
  AND split_part(name, '/', 1) = auth.uid()::text
);
