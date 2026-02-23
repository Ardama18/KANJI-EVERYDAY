-- S-02 Phase 0
-- AC-01 / AC-02 / AC-03 / AC-11

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.users_profile (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Tokyo',
  parent_mode_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.decks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL,
  new_limit_per_day integer NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid DEFAULT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  visibility text NOT NULL DEFAULT 'public',
  skill text NOT NULL,
  pattern text NOT NULL,
  front_text text NOT NULL,
  back_text text NOT NULL,
  illustration_key text DEFAULT NULL,
  card_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cards_visibility_check CHECK (visibility IN ('public', 'private')),
  CONSTRAINT cards_skill_check CHECK (skill IN ('reading', 'writing')),
  CONSTRAINT cards_pattern_check CHECK (pattern IN ('R1', 'R2', 'W1', 'W2'))
);

CREATE TABLE public.deck_cards (
  deck_id uuid NOT NULL REFERENCES public.decks (id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES public.cards (id) ON DELETE CASCADE,
  PRIMARY KEY (deck_id, card_id)
);

CREATE TABLE public.review_states (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES public.cards (id) ON DELETE CASCADE,
  level integer NOT NULL DEFAULT 0,
  due_date date NOT NULL,
  last_rating text DEFAULT NULL,
  retry_today_count integer NOT NULL DEFAULT 0,
  last_reviewed_at timestamptz DEFAULT NULL,
  PRIMARY KEY (user_id, card_id),
  CONSTRAINT review_states_last_rating_check CHECK (last_rating IN ('again', 'hard', 'good'))
);

CREATE TABLE public.illustrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  illustration_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  storage_path text DEFAULT NULL,
  prompt text DEFAULT NULL,
  model_info text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT illustrations_status_check CHECK (status IN ('pending', 'ready', 'failed'))
);

CREATE TABLE public.study_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  deck_id uuid NOT NULL REFERENCES public.decks (id) ON DELETE CASCADE,
  queue_due jsonb NOT NULL DEFAULT '[]'::jsonb,
  queue_learn jsonb NOT NULL DEFAULT '[]'::jsonb,
  queue_new jsonb NOT NULL DEFAULT '[]'::jsonb,
  queue_retry jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_card_id uuid DEFAULT NULL REFERENCES public.cards (id),
  revealed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz DEFAULT NULL
);

CREATE INDEX idx_cards_illustration_key ON public.cards (illustration_key);
CREATE INDEX idx_deck_cards_card_id ON public.deck_cards (card_id);
CREATE INDEX idx_review_states_user_id_due_date ON public.review_states (user_id, due_date);
CREATE INDEX idx_study_sessions_user_id_finished_at ON public.study_sessions (user_id, finished_at);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_users_profile_updated_at
BEFORE UPDATE ON public.users_profile
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_decks_updated_at
BEFORE UPDATE ON public.decks
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_illustrations_updated_at
BEFORE UPDATE ON public.illustrations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
