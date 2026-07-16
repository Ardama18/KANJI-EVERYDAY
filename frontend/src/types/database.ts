export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
	public: {
		Tables: {
			ai_upload_consumers: {
				Row: {
					created_at: string;
					job_id: string;
					owner_user_id: string;
					upload_id: string;
				};
				Insert: {
					created_at?: string;
					job_id: string;
					owner_user_id: string;
					upload_id: string;
				};
				Update: Partial<Database["public"]["Tables"]["ai_upload_consumers"]["Insert"]>;
				Relationships: [];
			};
			ai_import_concept_jobs: {
				Row: {
					attempt: number;
					batch_id: string;
					claim_expires_at: string | null;
					claim_token: string | null;
					terminal_claim_token_hash: string | null;
					terminal_message_id: number | null;
					completed_at: string | null;
					concept_id: string;
					created_at: string;
					error_code: string | null;
					id: string;
					illustration_id: string | null;
					next_attempt_at: string | null;
					owner_user_id: string;
					queue_message_id: number | null;
					state: string;
					updated_at: string;
				};
				Insert: {
					attempt?: number;
					batch_id: string;
					claim_expires_at?: string | null;
					claim_token?: string | null;
					terminal_claim_token_hash?: string | null;
					terminal_message_id?: number | null;
					completed_at?: string | null;
					concept_id: string;
					created_at?: string;
					error_code?: string | null;
					id?: string;
					illustration_id?: string | null;
					next_attempt_at?: string | null;
					owner_user_id: string;
					queue_message_id?: number | null;
					state?: string;
					updated_at?: string;
				};
				Update: Partial<Database["public"]["Tables"]["ai_import_concept_jobs"]["Insert"]>;
				Relationships: [];
			};
			ai_illustration_objects: {
				Row: {
					cleanup_claimed_at: string | null;
					cleanup_claim_token: string | null;
					cleanup_previous_state: string | null;
					created_at: string;
					delete_due_at: string | null;
					deleted_at: string | null;
					digest: string | null;
					error_code: string | null;
					height: number | null;
					id: string;
					illustration_id: string;
					job_id: string;
					owner_user_id: string;
					reference_count: number;
					state: string;
					storage_bucket: string;
					storage_path: string;
					updated_at: string;
					width: number | null;
				};
				Insert: {
					cleanup_claimed_at?: string | null;
					cleanup_claim_token?: string | null;
					cleanup_previous_state?: string | null;
					created_at?: string;
					delete_due_at?: string | null;
					deleted_at?: string | null;
					digest?: string | null;
					error_code?: string | null;
					height?: number | null;
					id?: string;
					illustration_id: string;
					job_id: string;
					owner_user_id: string;
					reference_count?: number;
					state?: string;
					storage_bucket?: string;
					storage_path: string;
					updated_at?: string;
					width?: number | null;
				};
				Update: Partial<Database["public"]["Tables"]["ai_illustration_objects"]["Insert"]>;
				Relationships: [];
			};
			ai_worker_log_outbox: {
				Row: {
					attempt: number | null;
					batch_id: string | null;
					created_at: string;
					dispatch_claim_token: string | null;
					dispatch_claimed_at: string | null;
					dispatched_at: string | null;
					error_code: string | null;
					event_id: string;
					event_type: string;
					job_id: string | null;
					queue_message_id: number;
					reason: string | null;
				};
				Insert: {
					attempt?: number | null;
					batch_id?: string | null;
					created_at?: string;
					dispatch_claim_token?: string | null;
					dispatch_claimed_at?: string | null;
					dispatched_at?: string | null;
					error_code?: string | null;
					event_id?: string;
					event_type: string;
					job_id?: string | null;
					queue_message_id: number;
					reason?: string | null;
				};
				Update: Partial<Database["public"]["Tables"]["ai_worker_log_outbox"]["Insert"]>;
				Relationships: [];
			};
			ai_import_batches: {
				Row: {
					auto_created_deck_id: string | null;
					card_reservation_key: string | null;
					completed_at: string | null;
					created_at: string;
					failed_count: number;
					finalized_count: number;
					id: string;
					idempotency_key: string;
					import_request_hash: string;
					owner_user_id: string;
					requested_card_count: number;
					requested_image_count: number;
					source: string;
					status: string;
					target_deck_id: string | null;
					undo_result: Json | null;
					undone_at: string | null;
					updated_at: string;
				};
				Insert: {
					auto_created_deck_id?: string | null;
					card_reservation_key?: string | null;
					completed_at?: string | null;
					created_at?: string;
					failed_count?: number;
					finalized_count?: number;
					id?: string;
					idempotency_key: string;
					import_request_hash: string;
					owner_user_id: string;
					requested_card_count: number;
					requested_image_count: number;
					source: string;
					status?: string;
					target_deck_id?: string | null;
					undo_result?: Json | null;
					undone_at?: string | null;
					updated_at?: string;
				};
				Update: {
					auto_created_deck_id?: string | null;
					card_reservation_key?: string | null;
					completed_at?: string | null;
					created_at?: string;
					failed_count?: number;
					finalized_count?: number;
					id?: string;
					idempotency_key?: string;
					import_request_hash?: string;
					owner_user_id?: string;
					requested_card_count?: number;
					requested_image_count?: number;
					source?: string;
					status?: string;
					target_deck_id?: string | null;
					undo_result?: Json | null;
					undone_at?: string | null;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "ai_import_batches_auto_deck_fkey";
						columns: ["auto_created_deck_id"];
						isOneToOne: false;
						referencedRelation: "decks";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "ai_import_batches_target_deck_fkey";
						columns: ["target_deck_id"];
						isOneToOne: false;
						referencedRelation: "decks";
						referencedColumns: ["id"];
					},
				];
			};
			ai_import_item_tags: {
				Row: {
					item_id: string;
					owner_user_id: string;
					tag_id: string;
				};
				Insert: {
					item_id: string;
					owner_user_id: string;
					tag_id: string;
				};
				Update: {
					item_id?: string;
					owner_user_id?: string;
					tag_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "ai_import_item_tags_item_owner_fkey";
						columns: ["item_id", "owner_user_id"];
						isOneToOne: false;
						referencedRelation: "ai_import_items";
						referencedColumns: ["id", "owner_user_id"];
					},
					{
						foreignKeyName: "ai_import_item_tags_tag_owner_fkey";
						columns: ["tag_id", "owner_user_id"];
						isOneToOne: false;
						referencedRelation: "tags";
						referencedColumns: ["id", "owner_user_id"];
					},
				];
			};
			ai_import_items: {
				Row: {
					back_text: string;
					batch_id: string;
					card_key: string;
					client_item_id: string;
					concept_id: string;
					created_at: string;
					deleted_at: string | null;
					deleted_card_id: string | null;
					error_code: string | null;
					error_detail: Json;
					failed_at: string | null;
					finalized_at: string | null;
					front_text: string;
					id: string;
					illustration_reservation_key: string | null;
					image_mode: string;
					ordinal: number;
					owner_user_id: string;
					pattern: string;
					result_card_id: string | null;
					skill: string;
					status: string;
					terminal_attempt_key: string | null;
					undone_at: string | null;
					updated_at: string;
					upload_id: string | null;
					user_edited_at: string | null;
				};
				Insert: {
					back_text: string;
					batch_id: string;
					card_key: string;
					client_item_id: string;
					concept_id: string;
					created_at?: string;
					deleted_at?: string | null;
					deleted_card_id?: string | null;
					error_code?: string | null;
					error_detail?: Json;
					failed_at?: string | null;
					finalized_at?: string | null;
					front_text: string;
					id?: string;
					illustration_reservation_key?: string | null;
					image_mode?: string;
					ordinal: number;
					owner_user_id: string;
					pattern: string;
					result_card_id?: string | null;
					skill: string;
					status?: string;
					terminal_attempt_key?: string | null;
					undone_at?: string | null;
					updated_at?: string;
					upload_id?: string | null;
					user_edited_at?: string | null;
				};
				Update: {
					back_text?: string;
					batch_id?: string;
					card_key?: string;
					client_item_id?: string;
					concept_id?: string;
					created_at?: string;
					deleted_at?: string | null;
					deleted_card_id?: string | null;
					error_code?: string | null;
					error_detail?: Json;
					failed_at?: string | null;
					finalized_at?: string | null;
					front_text?: string;
					id?: string;
					illustration_reservation_key?: string | null;
					image_mode?: string;
					ordinal?: number;
					owner_user_id?: string;
					pattern?: string;
					result_card_id?: string | null;
					skill?: string;
					status?: string;
					terminal_attempt_key?: string | null;
					undone_at?: string | null;
					updated_at?: string;
					upload_id?: string | null;
					user_edited_at?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "ai_import_items_batch_owner_fkey";
						columns: ["batch_id", "owner_user_id"];
						isOneToOne: false;
						referencedRelation: "ai_import_batches";
						referencedColumns: ["id", "owner_user_id"];
					},
					{
						foreignKeyName: "ai_import_items_result_card_fkey";
						columns: ["result_card_id"];
						isOneToOne: false;
						referencedRelation: "cards";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "ai_import_items_upload_owner_fkey";
						columns: ["upload_id", "owner_user_id"];
						isOneToOne: false;
						referencedRelation: "ai_uploads";
						referencedColumns: ["id", "owner_user_id"];
					},
				];
			};
			ai_quota_reservations: {
				Row: {
					batch_id: string | null;
					concept_id: string | null;
					created_at: string;
					generation_request_hash: string;
					id: string;
					import_request_hash: string | null;
					item_id: string | null;
					kind: string;
					owner_user_id: string;
					provider_started_at: string | null;
					reservation_key: string;
					source: string;
					status: string;
					units: number;
					usage_date: string;
				};
				Insert: {
					batch_id?: string | null;
					concept_id?: string | null;
					created_at?: string;
					generation_request_hash: string;
					id?: string;
					import_request_hash?: string | null;
					item_id?: string | null;
					kind: string;
					owner_user_id: string;
					provider_started_at?: string | null;
					reservation_key: string;
					source: string;
					status: string;
					units: number;
					usage_date: string;
				};
				Update: {
					batch_id?: string | null;
					concept_id?: string | null;
					created_at?: string;
					generation_request_hash?: string;
					id?: string;
					import_request_hash?: string | null;
					item_id?: string | null;
					kind?: string;
					owner_user_id?: string;
					provider_started_at?: string | null;
					reservation_key?: string;
					source?: string;
					status?: string;
					units?: number;
					usage_date?: string;
				};
				Relationships: [
					{
						foreignKeyName: "ai_quota_reservations_batch_fkey";
						columns: ["batch_id"];
						isOneToOne: false;
						referencedRelation: "ai_import_batches";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "ai_quota_reservations_item_fkey";
						columns: ["item_id"];
						isOneToOne: false;
						referencedRelation: "ai_import_items";
						referencedColumns: ["id"];
					},
				];
			};
			ai_uploads: {
				Row: {
					byte_size: number;
					cleanup_claimed_at: string | null;
					cleanup_claim_token: string | null;
					cleanup_previous_status: string | null;
					consumed_at: string | null;
					created_at: string;
					delete_due_at: string | null;
					deleted_at: string | null;
					detected_mime_type: string | null;
					height: number | null;
					id: string;
					mime_type: string;
					owner_user_id: string;
					purpose: string;
					raw_storage_path: string | null;
					raw_storage_bucket: string | null;
					raw_cleanup_claimed_at: string | null;
					raw_cleanup_claim_token: string | null;
					sha256: string | null;
					source_storage_path: string | null;
					source_storage_bucket: string | null;
					source_write_intent_path: string | null;
					source_write_intent_bucket: string | null;
					status: string;
					storage_path: string;
					upload_key: string;
					width: number | null;
				};
				Insert: {
					byte_size: number;
					consumed_at?: string | null;
					created_at?: string;
					cleanup_claimed_at?: string | null;
					cleanup_claim_token?: string | null;
					cleanup_previous_status?: string | null;
					delete_due_at?: string | null;
					deleted_at?: string | null;
					detected_mime_type?: string | null;
					height?: number | null;
					id?: string;
					mime_type: string;
					owner_user_id: string;
					purpose: string;
					raw_storage_path?: string | null;
					raw_storage_bucket?: string | null;
					raw_cleanup_claimed_at?: string | null;
					raw_cleanup_claim_token?: string | null;
					sha256?: string | null;
					source_storage_path?: string | null;
					source_storage_bucket?: string | null;
					source_write_intent_path?: string | null;
					source_write_intent_bucket?: string | null;
					status?: string;
					storage_path: string;
					upload_key: string;
					width?: number | null;
				};
				Update: {
					byte_size?: number;
					consumed_at?: string | null;
					created_at?: string;
					cleanup_claimed_at?: string | null;
					cleanup_claim_token?: string | null;
					cleanup_previous_status?: string | null;
					delete_due_at?: string | null;
					deleted_at?: string | null;
					detected_mime_type?: string | null;
					height?: number | null;
					id?: string;
					mime_type?: string;
					owner_user_id?: string;
					purpose?: string;
					raw_storage_path?: string | null;
					raw_storage_bucket?: string | null;
					raw_cleanup_claimed_at?: string | null;
					raw_cleanup_claim_token?: string | null;
					sha256?: string | null;
					source_storage_path?: string | null;
					source_storage_bucket?: string | null;
					source_write_intent_path?: string | null;
					source_write_intent_bucket?: string | null;
					status?: string;
					storage_path?: string;
					upload_key?: string;
					width?: number | null;
				};
				Relationships: [];
			};
			ai_usage_daily: {
				Row: {
					generated_card_count: number;
					generated_image_count: number;
					owner_user_id: string;
					updated_at: string;
					usage_date: string;
				};
				Insert: {
					generated_card_count?: number;
					generated_image_count?: number;
					owner_user_id: string;
					updated_at?: string;
					usage_date: string;
				};
				Update: {
					generated_card_count?: number;
					generated_image_count?: number;
					owner_user_id?: string;
					updated_at?: string;
					usage_date?: string;
				};
				Relationships: [];
			};
			card_tags: {
				Row: {
					card_id: string;
					created_at: string;
					owner_user_id: string;
					tag_id: string;
				};
				Insert: {
					card_id: string;
					created_at?: string;
					owner_user_id: string;
					tag_id: string;
				};
				Update: {
					card_id?: string;
					created_at?: string;
					owner_user_id?: string;
					tag_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "card_tags_card_owner_fkey";
						columns: ["card_id", "owner_user_id"];
						isOneToOne: false;
						referencedRelation: "cards";
						referencedColumns: ["id", "owner_user_id"];
					},
					{
						foreignKeyName: "card_tags_tag_owner_fkey";
						columns: ["tag_id", "owner_user_id"];
						isOneToOne: false;
						referencedRelation: "tags";
						referencedColumns: ["id", "owner_user_id"];
					},
				];
			};
			cards: {
				Row: {
					back_text: string;
					card_key: string;
					created_at: string;
					front_text: string;
					id: string;
					illustration_key: string | null;
					owner_user_id: string | null;
					pattern: string;
					skill: string;
					updated_at: string;
					visibility: string;
				};
				Insert: {
					back_text: string;
					card_key: string;
					created_at?: string;
					front_text: string;
					id?: string;
					illustration_key?: string | null;
					owner_user_id?: string | null;
					pattern: string;
					skill: string;
					updated_at?: string;
					visibility?: string;
				};
				Update: {
					back_text?: string;
					card_key?: string;
					created_at?: string;
					front_text?: string;
					id?: string;
					illustration_key?: string | null;
					owner_user_id?: string | null;
					pattern?: string;
					skill?: string;
					updated_at?: string;
					visibility?: string;
				};
				Relationships: [];
			};
			deck_cards: {
				Row: {
					card_id: string;
					deck_id: string;
				};
				Insert: {
					card_id: string;
					deck_id: string;
				};
				Update: {
					card_id?: string;
					deck_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "deck_cards_card_id_fkey";
						columns: ["card_id"];
						isOneToOne: false;
						referencedRelation: "cards";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "deck_cards_deck_id_fkey";
						columns: ["deck_id"];
						isOneToOne: false;
						referencedRelation: "decks";
						referencedColumns: ["id"];
					},
				];
			};
			decks: {
				Row: {
					created_at: string;
					id: string;
					name: string;
					new_limit_per_day: number;
					owner_user_id: string;
					updated_at: string;
				};
				Insert: {
					created_at?: string;
					id?: string;
					name: string;
					new_limit_per_day?: number;
					owner_user_id: string;
					updated_at?: string;
				};
				Update: {
					created_at?: string;
					id?: string;
					name?: string;
					new_limit_per_day?: number;
					owner_user_id?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
			illustrations: {
				Row: {
					created_at: string;
					id: string;
					illustration_key: string;
					model_info: string | null;
					owner_user_id: string;
					prompt: string | null;
					status: string;
					storage_path: string | null;
					updated_at: string;
				};
				Insert: {
					created_at?: string;
					id?: string;
					illustration_key: string;
					model_info?: string | null;
					owner_user_id: string;
					prompt?: string | null;
					status?: string;
					storage_path?: string | null;
					updated_at?: string;
				};
				Update: {
					created_at?: string;
					id?: string;
					illustration_key?: string;
					model_info?: string | null;
					owner_user_id?: string;
					prompt?: string | null;
					status?: string;
					storage_path?: string | null;
					updated_at?: string;
				};
				Relationships: [];
			};
			review_states: {
				Row: {
					card_id: string;
					due_date: string;
					last_rating: string | null;
					last_reviewed_at: string | null;
					level: number;
					retry_today_count: number;
					user_id: string;
				};
				Insert: {
					card_id: string;
					due_date: string;
					last_rating?: string | null;
					last_reviewed_at?: string | null;
					level?: number;
					retry_today_count?: number;
					user_id: string;
				};
				Update: {
					card_id?: string;
					due_date?: string;
					last_rating?: string | null;
					last_reviewed_at?: string | null;
					level?: number;
					retry_today_count?: number;
					user_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "review_states_card_id_fkey";
						columns: ["card_id"];
						isOneToOne: false;
						referencedRelation: "cards";
						referencedColumns: ["id"];
					},
				];
			};
			study_sessions: {
				Row: {
					created_at: string;
					current_card_id: string | null;
					deck_id: string;
					finished_at: string | null;
					id: string;
					queue_due: Json;
					queue_learn: Json;
					queue_new: Json;
					queue_retry: Json;
					revealed: boolean;
					user_id: string;
				};
				Insert: {
					created_at?: string;
					current_card_id?: string | null;
					deck_id: string;
					finished_at?: string | null;
					id?: string;
					queue_due?: Json;
					queue_learn?: Json;
					queue_new?: Json;
					queue_retry?: Json;
					revealed?: boolean;
					user_id: string;
				};
				Update: {
					created_at?: string;
					current_card_id?: string | null;
					deck_id?: string;
					finished_at?: string | null;
					id?: string;
					queue_due?: Json;
					queue_learn?: Json;
					queue_new?: Json;
					queue_retry?: Json;
					revealed?: boolean;
					user_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "study_sessions_current_card_id_fkey";
						columns: ["current_card_id"];
						isOneToOne: false;
						referencedRelation: "cards";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "study_sessions_deck_id_fkey";
						columns: ["deck_id"];
						isOneToOne: false;
						referencedRelation: "decks";
						referencedColumns: ["id"];
					},
				];
			};
			tags: {
				Row: {
					created_at: string;
					display_name: string;
					id: string;
					normalized_name: string;
					owner_user_id: string;
					updated_at: string;
				};
				Insert: {
					created_at?: string;
					display_name: string;
					id?: string;
					normalized_name: string;
					owner_user_id: string;
					updated_at?: string;
				};
				Update: {
					created_at?: string;
					display_name?: string;
					id?: string;
					normalized_name?: string;
					owner_user_id?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
			users_profile: {
				Row: {
					created_at: string;
					display_name: string;
					parent_mode_enabled: boolean;
					timezone: string;
					updated_at: string;
					user_id: string;
				};
				Insert: {
					created_at?: string;
					display_name: string;
					parent_mode_enabled?: boolean;
					timezone?: string;
					updated_at?: string;
					user_id: string;
				};
				Update: {
					created_at?: string;
					display_name?: string;
					parent_mode_enabled?: boolean;
					timezone?: string;
					updated_at?: string;
					user_id?: string;
				};
				Relationships: [];
			};
		};
		Views: {
			[_ in never]: never;
		};
		Functions: {
			claim_ai_import_concept: {
				Args: { p_job_id: string; p_message_id: number; p_claim_token: string };
				Returns: Json;
			};
			claim_ai_import_cleanup: {
				Args: { p_limit: number };
				Returns: {
					trackingId: string;
					bucket: string;
					path: string;
					claimToken: string;
				}[];
			};
			verify_ai_import_cleanup: {
				Args: {
					p_tracking_id: string;
					p_bucket: string;
					p_path: string;
					p_claim_token: string;
				};
				Returns: Json;
			};
			complete_ai_import_cleanup: {
				Args: {
					p_tracking_id: string;
					p_bucket: string;
					p_path: string;
					p_claim_token: string;
					p_outcome: string;
				};
				Returns: undefined;
			};
			claim_ai_worker_log_outbox: {
				Args: { p_claim_token: string };
				Returns: Json;
			};
			complete_ai_worker_log_outbox: {
				Args: { p_event_id: string; p_claim_token: string };
				Returns: undefined;
			};
			commit_import_async: {
				Args: {
					p_actor_user_id: string;
					p_card_reservation_key: string;
					p_idempotency_key: string;
					p_import_request_hash: string;
					p_request: Json;
					p_source: string;
				};
				Returns: Json;
			};
			get_ai_import_status: {
				Args: {
					p_actor_user_id: string;
					p_batch_id?: string | null;
					p_idempotency_key?: string | null;
				};
				Returns: Json;
			};
			prepare_ai_source_upload: {
				Args: {
					p_owner_user_id: string;
					p_upload_key: string;
					p_declared_mime: string;
					p_byte_size: number;
				};
				Returns: Json;
			};
			mark_ai_source_ready: {
				Args: {
					p_owner_user_id: string;
					p_upload_id: string;
					p_detected_mime: string;
					p_actual_byte_size: number;
					p_width: number;
					p_height: number;
					p_digest: string;
				};
				Returns: Json;
			};
			mark_ai_source_write_intent: {
				Args: {
					p_owner_user_id: string;
					p_upload_id: string;
					p_source_path: string;
				};
				Returns: undefined;
			};
			mark_ai_source_raw_deleted: {
				Args: { p_owner_user_id: string; p_upload_id: string };
				Returns: undefined;
			};
			mark_ai_upload_cleanup: {
				Args: {
					p_owner_user_id: string;
					p_upload_id: string;
					p_source_path?: string | null;
				};
				Returns: undefined;
			};
			ai_assert_card_inactive: {
				Args: { p_card_id: string; p_owner_user_id: string };
				Returns: undefined;
			};
			ai_compute_card_key: {
				Args: { back_text: string; front_text: string; pattern: string };
				Returns: string;
			};
			ai_disable_internal_context: { Args: never; Returns: undefined };
			ai_enable_internal_context: { Args: never; Returns: undefined };
			ai_internal_context_active: { Args: never; Returns: boolean };
			ai_management_context_active: { Args: never; Returns: boolean };
			ai_normalize_display_text: { Args: { value: string }; Returns: string };
			ai_normalize_key_text: { Args: { value: string }; Returns: string };
			ai_prepare_import_request: { Args: { p_request: Json }; Returns: Json };
			ai_raise_import_error: {
				Args: { error_code: string; safe_detail?: Json };
				Returns: undefined;
			};
			ai_recount_import_batch: {
				Args: { p_batch_id: string; p_owner_user_id: string };
				Returns: Json;
			};
			ai_session_card_ids: {
				Args: {
					current_card_id: string;
					queue_due: Json;
					queue_learn: Json;
					queue_new: Json;
					queue_retry: Json;
				};
				Returns: {
					card_id: string;
				}[];
			};
			commit_import: {
				Args: {
					p_actor_user_id: string;
					p_card_reservation_key: string;
					p_idempotency_key: string;
					p_import_request_hash: string;
					p_request: Json;
					p_source: string;
				};
				Returns: Json;
			};
			commit_import_internal: {
				Args: {
					p_actor_user_id: string;
					p_card_reservation_key: string;
					p_idempotency_key: string;
					p_import_request_hash: string;
					p_request: Json;
					p_source: string;
				};
				Returns: Json;
			};
			delete_private_card: {
				Args: { p_card_id: string; p_expected_updated_at: string };
				Returns: Json;
			};
			delete_private_card_internal: {
				Args: {
					p_card_id: string;
					p_expected_updated_at: string;
					p_owner_user_id: string;
				};
				Returns: Json;
			};
			finalize_import_item: {
				Args: {
					p_batch_id: string;
					p_illustration_id?: string;
					p_item_id: string;
					p_owner_user_id: string;
				};
				Returns: Json;
			};
			finalize_import_item_internal: {
				Args: {
					p_batch_id: string;
					p_illustration_id?: string;
					p_item_id: string;
					p_owner_user_id: string;
				};
				Returns: Json;
			};
			mark_import_item_failed: {
				Args: {
					p_attempt_key: string;
					p_batch_id: string;
					p_error_code: string;
					p_item_id: string;
					p_owner_user_id: string;
					p_safe_detail?: Json;
				};
				Returns: Json;
			};
			mark_import_item_failed_internal: {
				Args: {
					p_attempt_key: string;
					p_batch_id: string;
					p_error_code: string;
					p_item_id: string;
					p_owner_user_id: string;
					p_safe_detail?: Json;
				};
				Returns: Json;
			};
			register_ai_upload: {
				Args: {
					p_byte_size: number;
					p_mime_type: string;
					p_owner_user_id: string;
					p_purpose: string;
					p_storage_path: string;
					p_upload_key: string;
				};
				Returns: Json;
			};
			register_ai_upload_internal: {
				Args: {
					p_byte_size: number;
					p_mime_type: string;
					p_owner_user_id: string;
					p_purpose: string;
					p_storage_path: string;
					p_upload_key: string;
				};
				Returns: Json;
			};
			reserve_provider_usage: {
				Args: {
					p_batch_id?: string;
					p_concept_id?: string;
					p_generation_request_hash: string;
					p_item_id?: string;
					p_kind: string;
					p_owner_user_id: string;
					p_reservation_key: string;
					p_source: string;
					p_units: number;
				};
				Returns: Json;
			};
			reserve_provider_usage_internal: {
				Args: {
					p_batch_id?: string;
					p_concept_id?: string;
					p_generation_request_hash: string;
					p_item_id?: string;
					p_kind: string;
					p_now?: string;
					p_owner_user_id: string;
					p_reservation_key: string;
					p_source: string;
					p_units: number;
				};
				Returns: Json;
			};
			set_card_decks: {
				Args: { p_card_id: string; p_deck_ids: string[] };
				Returns: Json;
			};
			set_card_decks_internal: {
				Args: {
					p_card_id: string;
					p_deck_ids: string[];
					p_owner_user_id: string;
				};
				Returns: Json;
			};
			set_card_illustration: {
				Args: { p_card_id: string; p_illustration_id?: string };
				Returns: Json;
			};
			set_card_illustration_internal: {
				Args: {
					p_card_id: string;
					p_illustration_id?: string;
					p_owner_user_id: string;
				};
				Returns: Json;
			};
			set_card_tags: {
				Args: { p_card_id: string; p_tag_ids: string[] };
				Returns: Json;
			};
			set_card_tags_internal: {
				Args: {
					p_card_id: string;
					p_owner_user_id: string;
					p_tag_ids: string[];
				};
				Returns: Json;
			};
			undo_import: { Args: { p_batch_id: string }; Returns: Json };
			undo_import_internal: {
				Args: { p_batch_id: string; p_owner_user_id: string };
				Returns: Json;
			};
			update_imported_card: {
				Args: {
					p_card_id: string;
					p_expected_updated_at: string;
					p_patch: Json;
				};
				Returns: Json;
			};
			update_imported_card_internal: {
				Args: {
					p_card_id: string;
					p_expected_updated_at: string;
					p_owner_user_id: string;
					p_patch: Json;
				};
				Returns: Json;
			};
		};
		Enums: {
			[_ in never]: never;
		};
		CompositeTypes: {
			[_ in never]: never;
		};
	};
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
	DefaultSchemaTableNameOrOptions extends
		| keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
		| { schema: keyof DatabaseWithoutInternals },
	TableName extends DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
				DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
		: never = never,
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
			DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
			Row: infer R;
		}
		? R
		: never
	: DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
		? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
				Row: infer R;
			}
			? R
			: never
		: never;

export type TablesInsert<
	DefaultSchemaTableNameOrOptions extends
		| keyof DefaultSchema["Tables"]
		| { schema: keyof DatabaseWithoutInternals },
	TableName extends DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
		: never = never,
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
			Insert: infer I;
		}
		? I
		: never
	: DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
		? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
				Insert: infer I;
			}
			? I
			: never
		: never;

export type TablesUpdate<
	DefaultSchemaTableNameOrOptions extends
		| keyof DefaultSchema["Tables"]
		| { schema: keyof DatabaseWithoutInternals },
	TableName extends DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
		: never = never,
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
			Update: infer U;
		}
		? U
		: never
	: DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
		? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
				Update: infer U;
			}
			? U
			: never
		: never;

export type Enums<
	DefaultSchemaEnumNameOrOptions extends
		| keyof DefaultSchema["Enums"]
		| { schema: keyof DatabaseWithoutInternals },
	EnumName extends DefaultSchemaEnumNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
		: never = never,
> = DefaultSchemaEnumNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
	: DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
		? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
		: never;

export type CompositeTypes<
	PublicCompositeTypeNameOrOptions extends
		| keyof DefaultSchema["CompositeTypes"]
		| { schema: keyof DatabaseWithoutInternals },
	CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
		: never = never,
> = PublicCompositeTypeNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
	: PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
		? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
		: never;

export const Constants = {
	public: {
		Enums: {},
	},
} as const;
