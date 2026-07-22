-- S-16A card_mnemonics: 承認済みニーモニック穴埋め(slots)と表示用説明(explanation)
-- AC-1 / AC-2 / AC-3 / AC-4

CREATE TABLE public.card_mnemonics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  illustration_key text NOT NULL,
  slots jsonb NOT NULL,
  explanation jsonb NOT NULL,
  status text NOT NULL DEFAULT 'approved',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT card_mnemonics_owner_illustration_key_unique UNIQUE (owner_user_id, illustration_key),
  CONSTRAINT card_mnemonics_status_check CHECK (status IN ('draft', 'approved'))
);

CREATE TRIGGER set_card_mnemonics_updated_at
BEFORE UPDATE ON public.card_mnemonics
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.card_mnemonics ENABLE ROW LEVEL SECURITY;

CREATE POLICY card_mnemonics_select_owner
ON public.card_mnemonics
FOR SELECT
USING (auth.uid() = owner_user_id);

CREATE POLICY card_mnemonics_insert_owner
ON public.card_mnemonics
FOR INSERT
WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY card_mnemonics_update_owner
ON public.card_mnemonics
FOR UPDATE
USING (auth.uid() = owner_user_id)
WITH CHECK (auth.uid() = owner_user_id);

GRANT SELECT, INSERT, UPDATE ON TABLE public.card_mnemonics TO authenticated;
