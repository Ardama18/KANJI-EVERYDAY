ALTER TABLE public.decks
  ADD COLUMN daily_study_limit integer NOT NULL DEFAULT 20;

ALTER TABLE public.decks
  ADD CONSTRAINT decks_daily_study_limit_check
  CHECK (daily_study_limit BETWEEN 1 AND 100);
