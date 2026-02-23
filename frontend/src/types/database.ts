export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
	public: {
		Tables: {
			users_profile: {
				Row: {
					user_id: string;
					display_name: string;
					timezone: string;
					parent_mode_enabled: boolean;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					user_id: string;
					display_name: string;
					timezone?: string;
					parent_mode_enabled?: boolean;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					user_id?: string;
					display_name?: string;
					timezone?: string;
					parent_mode_enabled?: boolean;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "users_profile_user_id_fkey";
						columns: ["user_id"];
						isOneToOne: true;
						referencedRelation: "users";
						referencedColumns: ["id"];
					},
				];
			};
			decks: {
				Row: {
					id: string;
					owner_user_id: string;
					name: string;
					new_limit_per_day: number;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id?: string;
					owner_user_id: string;
					name: string;
					new_limit_per_day?: number;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					owner_user_id?: string;
					name?: string;
					new_limit_per_day?: number;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "decks_owner_user_id_fkey";
						columns: ["owner_user_id"];
						isOneToOne: false;
						referencedRelation: "users";
						referencedColumns: ["id"];
					},
				];
			};
			cards: {
				Row: {
					id: string;
					owner_user_id: string | null;
					visibility: string;
					skill: string;
					pattern: string;
					front_text: string;
					back_text: string;
					illustration_key: string | null;
					card_key: string;
					created_at: string;
				};
				Insert: {
					id?: string;
					owner_user_id?: string | null;
					visibility?: string;
					skill: string;
					pattern: string;
					front_text: string;
					back_text: string;
					illustration_key?: string | null;
					card_key: string;
					created_at?: string;
				};
				Update: {
					id?: string;
					owner_user_id?: string | null;
					visibility?: string;
					skill?: string;
					pattern?: string;
					front_text?: string;
					back_text?: string;
					illustration_key?: string | null;
					card_key?: string;
					created_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "cards_owner_user_id_fkey";
						columns: ["owner_user_id"];
						isOneToOne: false;
						referencedRelation: "users";
						referencedColumns: ["id"];
					},
				];
			};
			deck_cards: {
				Row: {
					deck_id: string;
					card_id: string;
				};
				Insert: {
					deck_id: string;
					card_id: string;
				};
				Update: {
					deck_id?: string;
					card_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "deck_cards_deck_id_fkey";
						columns: ["deck_id"];
						isOneToOne: false;
						referencedRelation: "decks";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "deck_cards_card_id_fkey";
						columns: ["card_id"];
						isOneToOne: false;
						referencedRelation: "cards";
						referencedColumns: ["id"];
					},
				];
			};
			review_states: {
				Row: {
					user_id: string;
					card_id: string;
					level: number;
					due_date: string;
					last_rating: string | null;
					retry_today_count: number;
					last_reviewed_at: string | null;
				};
				Insert: {
					user_id: string;
					card_id: string;
					level?: number;
					due_date: string;
					last_rating?: string | null;
					retry_today_count?: number;
					last_reviewed_at?: string | null;
				};
				Update: {
					user_id?: string;
					card_id?: string;
					level?: number;
					due_date?: string;
					last_rating?: string | null;
					retry_today_count?: number;
					last_reviewed_at?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "review_states_user_id_fkey";
						columns: ["user_id"];
						isOneToOne: false;
						referencedRelation: "users";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "review_states_card_id_fkey";
						columns: ["card_id"];
						isOneToOne: false;
						referencedRelation: "cards";
						referencedColumns: ["id"];
					},
				];
			};
			illustrations: {
				Row: {
					id: string;
					owner_user_id: string;
					illustration_key: string;
					status: string;
					storage_path: string | null;
					prompt: string | null;
					model_info: string | null;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id?: string;
					owner_user_id: string;
					illustration_key: string;
					status?: string;
					storage_path?: string | null;
					prompt?: string | null;
					model_info?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Update: {
					id?: string;
					owner_user_id?: string;
					illustration_key?: string;
					status?: string;
					storage_path?: string | null;
					prompt?: string | null;
					model_info?: string | null;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "illustrations_owner_user_id_fkey";
						columns: ["owner_user_id"];
						isOneToOne: false;
						referencedRelation: "users";
						referencedColumns: ["id"];
					},
				];
			};
			study_sessions: {
				Row: {
					id: string;
					user_id: string;
					deck_id: string;
					queue_due: Json;
					queue_learn: Json;
					queue_new: Json;
					queue_retry: Json;
					current_card_id: string | null;
					revealed: boolean;
					created_at: string;
					finished_at: string | null;
				};
				Insert: {
					id?: string;
					user_id: string;
					deck_id: string;
					queue_due?: Json;
					queue_learn?: Json;
					queue_new?: Json;
					queue_retry?: Json;
					current_card_id?: string | null;
					revealed?: boolean;
					created_at?: string;
					finished_at?: string | null;
				};
				Update: {
					id?: string;
					user_id?: string;
					deck_id?: string;
					queue_due?: Json;
					queue_learn?: Json;
					queue_new?: Json;
					queue_retry?: Json;
					current_card_id?: string | null;
					revealed?: boolean;
					created_at?: string;
					finished_at?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "study_sessions_user_id_fkey";
						columns: ["user_id"];
						isOneToOne: false;
						referencedRelation: "users";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "study_sessions_deck_id_fkey";
						columns: ["deck_id"];
						isOneToOne: false;
						referencedRelation: "decks";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "study_sessions_current_card_id_fkey";
						columns: ["current_card_id"];
						isOneToOne: false;
						referencedRelation: "cards";
						referencedColumns: ["id"];
					},
				];
			};
		};
		Views: {
			[_ in never]: never;
		};
		Functions: {
			[_ in never]: never;
		};
		Enums: {
			[_ in never]: never;
		};
		CompositeTypes: {
			[_ in never]: never;
		};
	};
};
