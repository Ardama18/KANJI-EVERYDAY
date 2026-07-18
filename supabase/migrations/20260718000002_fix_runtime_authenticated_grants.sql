-- Runtime repair for the owner-scoped tables used directly by the existing
-- study and illustration flows. RLS remains the row-authorization boundary.

GRANT SELECT, INSERT, UPDATE ON TABLE
	public.review_states,
	public.illustrations,
	public.study_sessions
TO authenticated;

