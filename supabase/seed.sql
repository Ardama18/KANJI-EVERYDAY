-- S-04 Phase 1 seed: fixed owner/profile/deck + 50 kanji source (R1/W1 100 cards)

BEGIN;

INSERT INTO auth.users (
	id,
	instance_id,
	aud,
	role,
	email,
	encrypted_password,
	email_confirmed_at,
	raw_app_meta_data,
	raw_user_meta_data,
	created_at,
	updated_at
)
VALUES (
	'00000000-0000-4000-8000-000000000001'::uuid,
	'00000000-0000-0000-0000-000000000000'::uuid,
	'authenticated',
	'authenticated',
	'seed-owner@example.local',
	'seed-owner-not-for-login',
	now(),
	'{"provider":"email","providers":["email"]}'::jsonb,
	'{"display_name":"Seed Owner"}'::jsonb,
	now(),
	now()
)
ON CONFLICT (id) DO UPDATE
SET
	instance_id = EXCLUDED.instance_id,
	aud = EXCLUDED.aud,
	role = EXCLUDED.role,
	email = EXCLUDED.email,
	encrypted_password = EXCLUDED.encrypted_password,
	email_confirmed_at = EXCLUDED.email_confirmed_at,
	raw_app_meta_data = EXCLUDED.raw_app_meta_data,
	raw_user_meta_data = EXCLUDED.raw_user_meta_data,
	updated_at = now();

INSERT INTO public.users_profile (
	user_id,
	display_name,
	timezone,
	parent_mode_enabled
)
VALUES (
	'00000000-0000-4000-8000-000000000001'::uuid,
	'Seed Owner',
	'Asia/Tokyo',
	false
)
ON CONFLICT (user_id) DO UPDATE
SET
	display_name = EXCLUDED.display_name,
	timezone = EXCLUDED.timezone,
	parent_mode_enabled = EXCLUDED.parent_mode_enabled;

INSERT INTO public.decks (
	id,
	owner_user_id,
	name,
	new_limit_per_day
)
VALUES (
	'00000000-0000-4000-8000-0000000000d4'::uuid,
	'00000000-0000-4000-8000-000000000001'::uuid,
	'小学3年生の漢字',
	10
)
ON CONFLICT (id) DO UPDATE
SET
	owner_user_id = EXCLUDED.owner_user_id,
	name = EXCLUDED.name,
	new_limit_per_day = EXCLUDED.new_limit_per_day;

WITH seed_source (kanji, vocab, reading) AS (
	VALUES
		('悪', '悪い', 'わるい'),
		('安', '安心', 'あんしん'),
		('暗', '暗い', 'くらい'),
		('医', '医者', 'いしゃ'),
		('委', '委員', 'いいん'),
		('意', '意味', 'いみ'),
		('育', '育つ', 'そだつ'),
		('院', '病院', 'びょういん'),
		('飲', '飲む', 'のむ'),
		('運', '運ぶ', 'はこぶ'),
		('泳', '泳ぐ', 'およぐ'),
		('駅', '駅', 'えき'),
		('央', '中央', 'ちゅうおう'),
		('横', '横', 'よこ'),
		('屋', '屋根', 'やね'),
		('温', '温かい', 'あたたかい'),
		('化', '文化', 'ぶんか'),
		('荷', '荷物', 'にもつ'),
		('界', '世界', 'せかい'),
		('開', '開く', 'ひらく'),
		('階', '階段', 'かいだん'),
		('寒', '寒い', 'さむい'),
		('感', '感動', 'かんどう'),
		('漢', '漢字', 'かんじ'),
		('館', '図書館', 'としょかん'),
		('岸', '海岸', 'かいがん'),
		('起', '起きる', 'おきる'),
		('期', '期限', 'きげん'),
		('客', '客', 'きゃく'),
		('究', '研究', 'けんきゅう'),
		('急', '急ぐ', 'いそぐ'),
		('級', '学級', 'がっきゅう'),
		('宮', '神宮', 'じんぐう'),
		('球', '地球', 'ちきゅう'),
		('去', '去る', 'さる'),
		('橋', '大橋', 'おおはし'),
		('業', '授業', 'じゅぎょう'),
		('曲', '曲がる', 'まがる'),
		('局', '郵便局', 'ゆうびんきょく'),
		('銀', '銀行', 'ぎんこう'),
		('区', '地区', 'ちく'),
		('苦', '苦い', 'にがい'),
		('具', '道具', 'どうぐ'),
		('君', '君', 'きみ'),
		('係', '係員', 'かかりいん'),
		('軽', '軽い', 'かるい'),
		('血', '血液', 'けつえき'),
		('決', '決める', 'きめる'),
		('研', '研ぐ', 'とぐ'),
		('県', '県庁', 'けんちょう')
),
seed_card_blueprints AS (
	SELECT
		'reading'::text AS skill,
		'R1'::text AS pattern,
		vocab AS front_text,
		reading AS back_text,
		vocab AS illustration_key
	FROM seed_source
	UNION ALL
	SELECT
		'writing'::text AS skill,
		'W1'::text AS pattern,
		reading AS front_text,
		vocab AS back_text,
		vocab AS illustration_key
	FROM seed_source
),
seed_cards AS (
	SELECT
		NULL::uuid AS owner_user_id,
		'public'::text AS visibility,
		skill,
		pattern,
		front_text,
		back_text,
		illustration_key,
		public.ai_compute_card_key(pattern, front_text, back_text) AS card_key
	FROM seed_card_blueprints
),
upserted_seed_cards AS (
	INSERT INTO public.cards (
		owner_user_id,
		visibility,
		skill,
		pattern,
		front_text,
		back_text,
		illustration_key,
		card_key
	)
	SELECT
		owner_user_id,
		visibility,
		skill,
		pattern,
		front_text,
		back_text,
		illustration_key,
		card_key
	FROM seed_cards
	ON CONFLICT (card_key) WHERE visibility = 'public' DO NOTHING
	RETURNING
		id,
		card_key
),
resolved_seed_cards AS (
	SELECT
		id,
		card_key
	FROM upserted_seed_cards
	UNION
	SELECT
		cards.id,
		cards.card_key
	FROM public.cards AS cards
	INNER JOIN seed_cards ON seed_cards.card_key = cards.card_key
)
INSERT INTO public.deck_cards (
	deck_id,
	card_id
)
SELECT
	'00000000-0000-4000-8000-0000000000d4'::uuid AS deck_id,
	resolved_seed_cards.id AS card_id
FROM resolved_seed_cards
ON CONFLICT (deck_id, card_id) DO NOTHING;

COMMIT;
