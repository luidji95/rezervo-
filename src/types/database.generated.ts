export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_settings: {
        Row: {
          allow_cancellation: boolean
          allow_reschedule: boolean
          assistant_name: string
          auto_booking_enabled: boolean
          auto_reply_enabled: boolean
          booking_confirmation_required: boolean
          cancellation_notice_hours: number
          created_at: string
          enabled: boolean
          fallback_message: string | null
          greeting_message: string | null
          human_takeover_enabled: boolean
          id: string
          max_active_bookings_per_client: number
          max_booking_days_ahead: number
          max_daily_bookings_per_client: number
          max_suggestions_per_reply: number
          min_notice_minutes: number
          reminder_enabled: boolean
          reminder_hours_before: number
          salon_id: string
          tone: string
          updated_at: string
        }
        Insert: {
          allow_cancellation?: boolean
          allow_reschedule?: boolean
          assistant_name?: string
          auto_booking_enabled?: boolean
          auto_reply_enabled?: boolean
          booking_confirmation_required?: boolean
          cancellation_notice_hours?: number
          created_at?: string
          enabled?: boolean
          fallback_message?: string | null
          greeting_message?: string | null
          human_takeover_enabled?: boolean
          id?: string
          max_active_bookings_per_client?: number
          max_booking_days_ahead?: number
          max_daily_bookings_per_client?: number
          max_suggestions_per_reply?: number
          min_notice_minutes?: number
          reminder_enabled?: boolean
          reminder_hours_before?: number
          salon_id: string
          tone?: string
          updated_at?: string
        }
        Update: {
          allow_cancellation?: boolean
          allow_reschedule?: boolean
          assistant_name?: string
          auto_booking_enabled?: boolean
          auto_reply_enabled?: boolean
          booking_confirmation_required?: boolean
          cancellation_notice_hours?: number
          created_at?: string
          enabled?: boolean
          fallback_message?: string | null
          greeting_message?: string | null
          human_takeover_enabled?: boolean
          id?: string
          max_active_bookings_per_client?: number
          max_booking_days_ahead?: number
          max_daily_bookings_per_client?: number
          max_suggestions_per_reply?: number
          min_notice_minutes?: number
          reminder_enabled?: boolean
          reminder_hours_before?: number
          salon_id?: string
          tone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_settings_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: true
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_reminder_deliveries: {
        Row: {
          appointment_id: string
          appointment_start_snapshot: string
          attempt_count: number
          cancelled_at: string | null
          channel: Database["public"]["Enums"]["reminder_channel"]
          claim_token: string | null
          claimed_at: string | null
          client_id: string | null
          created_at: string
          delivered_at: string | null
          delivery_report_received_at: string | null
          failed_at: string | null
          id: string
          last_attempt_at: string | null
          last_error_code: string | null
          last_error_message: string | null
          lease_expires_at: string | null
          max_attempts: number
          next_retry_at: string | null
          provider: string | null
          provider_done_at: string | null
          provider_error_code: string | null
          provider_error_name: string | null
          provider_error_permanent: boolean | null
          provider_message_id: string | null
          provider_status_group: string | null
          provider_status_id: number | null
          provider_status_name: string | null
          recipient_snapshot: string | null
          reminder_type: string
          salon_id: string
          salon_timezone_snapshot: string
          scheduled_for: string
          sent_at: string | null
          skipped_at: string | null
          status: Database["public"]["Enums"]["reminder_delivery_status"]
          updated_at: string
        }
        Insert: {
          appointment_id: string
          appointment_start_snapshot: string
          attempt_count?: number
          cancelled_at?: string | null
          channel: Database["public"]["Enums"]["reminder_channel"]
          claim_token?: string | null
          claimed_at?: string | null
          client_id?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_report_received_at?: string | null
          failed_at?: string | null
          id?: string
          last_attempt_at?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          lease_expires_at?: string | null
          max_attempts?: number
          next_retry_at?: string | null
          provider?: string | null
          provider_done_at?: string | null
          provider_error_code?: string | null
          provider_error_name?: string | null
          provider_error_permanent?: boolean | null
          provider_message_id?: string | null
          provider_status_group?: string | null
          provider_status_id?: number | null
          provider_status_name?: string | null
          recipient_snapshot?: string | null
          reminder_type?: string
          salon_id: string
          salon_timezone_snapshot: string
          scheduled_for: string
          sent_at?: string | null
          skipped_at?: string | null
          status?: Database["public"]["Enums"]["reminder_delivery_status"]
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          appointment_start_snapshot?: string
          attempt_count?: number
          cancelled_at?: string | null
          channel?: Database["public"]["Enums"]["reminder_channel"]
          claim_token?: string | null
          claimed_at?: string | null
          client_id?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_report_received_at?: string | null
          failed_at?: string | null
          id?: string
          last_attempt_at?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          lease_expires_at?: string | null
          max_attempts?: number
          next_retry_at?: string | null
          provider?: string | null
          provider_done_at?: string | null
          provider_error_code?: string | null
          provider_error_name?: string | null
          provider_error_permanent?: boolean | null
          provider_message_id?: string | null
          provider_status_group?: string | null
          provider_status_id?: number | null
          provider_status_name?: string | null
          recipient_snapshot?: string | null
          reminder_type?: string
          salon_id?: string
          salon_timezone_snapshot?: string
          scheduled_for?: string
          sent_at?: string | null
          skipped_at?: string | null
          status?: Database["public"]["Enums"]["reminder_delivery_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_reminder_deliveries_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_reminder_deliveries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_reminder_deliveries_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_services: {
        Row: {
          appointment_id: string
          created_at: string
          duration_minutes_snapshot: number
          id: string
          price_snapshot: number
          service_id: string
          service_name_snapshot: string
          sort_order: number
        }
        Insert: {
          appointment_id: string
          created_at?: string
          duration_minutes_snapshot: number
          id?: string
          price_snapshot: number
          service_id: string
          service_name_snapshot: string
          sort_order?: number
        }
        Update: {
          appointment_id?: string
          created_at?: string
          duration_minutes_snapshot?: number
          id?: string
          price_snapshot?: number
          service_id?: string
          service_name_snapshot?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "appointment_services_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          booking_source: Database["public"]["Enums"]["booking_source"]
          buffer_minutes: number
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          client_id: string
          completed_at: string | null
          confirmed_at: string | null
          created_at: string
          currency: string
          customer_note: string | null
          duration_minutes: number
          employee_id: string | null
          end_time: string
          id: string
          idempotency_key: string | null
          internal_note: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          price: number
          primary_service_id: string | null
          reminder_sent_at: string | null
          resource_id: string | null
          salon_id: string
          start_time: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        Insert: {
          booking_source?: Database["public"]["Enums"]["booking_source"]
          buffer_minutes?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_id: string
          completed_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          customer_note?: string | null
          duration_minutes: number
          employee_id?: string | null
          end_time: string
          id?: string
          idempotency_key?: string | null
          internal_note?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          price: number
          primary_service_id?: string | null
          reminder_sent_at?: string | null
          resource_id?: string | null
          salon_id: string
          start_time: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Update: {
          booking_source?: Database["public"]["Enums"]["booking_source"]
          buffer_minutes?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_id?: string
          completed_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          customer_note?: string | null
          duration_minutes?: number
          employee_id?: string | null
          end_time?: string
          id?: string
          idempotency_key?: string | null
          internal_note?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          price?: number
          primary_service_id?: string | null
          reminder_sent_at?: string | null
          resource_id?: string | null
          salon_id?: string
          start_time?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_primary_service_id_fkey"
            columns: ["primary_service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_profile_id: string | null
          actor_type: Database["public"]["Enums"]["audit_actor_type"]
          client_id: string | null
          created_at: string
          description: string | null
          entity_id: string
          entity_type: string
          id: string
          new_values: Json | null
          old_values: Json | null
          salon_id: string
        }
        Insert: {
          action: string
          actor_profile_id?: string | null
          actor_type: Database["public"]["Enums"]["audit_actor_type"]
          client_id?: string | null
          created_at?: string
          description?: string | null
          entity_id: string
          entity_type: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          salon_id: string
        }
        Update: {
          action?: string
          actor_profile_id?: string | null
          actor_type?: Database["public"]["Enums"]["audit_actor_type"]
          client_id?: string | null
          created_at?: string
          description?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          salon_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_access_overrides: {
        Row: {
          created_at: string
          created_by_profile_id: string | null
          enabled: boolean
          ends_at: string | null
          id: string
          override_type: string
          plan_id: string
          reason: string
          salon_id: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id?: string | null
          enabled?: boolean
          ends_at?: string | null
          id?: string
          override_type: string
          plan_id: string
          reason: string
          salon_id: string
          starts_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string | null
          enabled?: boolean
          ends_at?: string | null
          id?: string
          override_type?: string
          plan_id?: string
          reason?: string
          salon_id?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_access_overrides_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_access_overrides_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_access_overrides_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: true
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_checkout_sessions: {
        Row: {
          actor_profile_id: string
          checkout_url_hash: string | null
          completed_at: string | null
          created_at: string
          environment: string
          error_code: string | null
          expires_at: string | null
          failed_at: string | null
          id: string
          idempotency_key: string
          provider: string
          provider_order_id: string | null
          provider_session_id: string | null
          requested_plan_id: string
          resulting_subscription_id: string | null
          salon_id: string
          status: string
          updated_at: string
        }
        Insert: {
          actor_profile_id: string
          checkout_url_hash?: string | null
          completed_at?: string | null
          created_at?: string
          environment: string
          error_code?: string | null
          expires_at?: string | null
          failed_at?: string | null
          id?: string
          idempotency_key: string
          provider: string
          provider_order_id?: string | null
          provider_session_id?: string | null
          requested_plan_id: string
          resulting_subscription_id?: string | null
          salon_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          actor_profile_id?: string
          checkout_url_hash?: string | null
          completed_at?: string | null
          created_at?: string
          environment?: string
          error_code?: string | null
          expires_at?: string | null
          failed_at?: string | null
          id?: string
          idempotency_key?: string
          provider?: string
          provider_order_id?: string | null
          provider_session_id?: string | null
          requested_plan_id?: string
          resulting_subscription_id?: string | null
          salon_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_checkout_sessions_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_checkout_sessions_requested_plan_id_fkey"
            columns: ["requested_plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_checkout_sessions_resulting_subscription_id_fkey"
            columns: ["resulting_subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_checkout_sessions_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_checkout_recovery_attempts: {
        Row: {
          attempt_number: number
          checkout_session_id: string
          claim_token: string
          claimed_at: string
          completed_at: string | null
          created_at: string
          environment: string
          id: string
          lease_expires_at: string
          outcome: string | null
          provider: string
          status: string
          updated_at: string
        }
        Insert: {
          attempt_number: number
          checkout_session_id: string
          claim_token: string
          claimed_at: string
          completed_at?: string | null
          created_at?: string
          environment: string
          id?: string
          lease_expires_at: string
          outcome?: string | null
          provider: string
          status: string
          updated_at?: string
        }
        Update: {
          attempt_number?: number
          checkout_session_id?: string
          claim_token?: string
          claimed_at?: string
          completed_at?: string | null
          created_at?: string
          environment?: string
          id?: string
          lease_expires_at?: string
          outcome?: string | null
          provider?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_checkout_recovery_attempts_checkout_session_id_fkey"
            columns: ["checkout_session_id"]
            isOneToOne: false
            referencedRelation: "billing_checkout_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_provider_prices: {
        Row: {
          amount: number
          billing_interval: string
          created_at: string
          currency: string
          environment: string
          id: string
          is_active: boolean
          plan_id: string
          provider: string
          provider_product_id: string | null
          provider_store_id: string | null
          provider_variant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          billing_interval: string
          created_at?: string
          currency: string
          environment: string
          id?: string
          is_active?: boolean
          plan_id: string
          provider: string
          provider_product_id?: string | null
          provider_store_id?: string | null
          provider_variant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          billing_interval?: string
          created_at?: string
          currency?: string
          environment?: string
          id?: string
          is_active?: boolean
          plan_id?: string
          provider?: string
          provider_product_id?: string | null
          provider_store_id?: string | null
          provider_variant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_provider_prices_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_subscription_reconciliation_checks: {
        Row: {
          attempt_count: number
          checked_at: string | null
          claim_token: string | null
          claimed_local_identity_fingerprint: string
          claimed_provider_state_updated_at: string | null
          created_at: string
          error_code: string | null
          id: string
          lease_until: string | null
          local_provider_state_updated_at: string | null
          next_attempt_at: string | null
          outcome: string | null
          remote_cancelled: boolean | null
          remote_ends_at: string | null
          remote_provider_updated_at: string | null
          remote_renews_at: string | null
          remote_state_fingerprint: string | null
          remote_status: string | null
          run_id: string
          started_at: string | null
          status: string
          subscription_id: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          checked_at?: string | null
          claim_token?: string | null
          claimed_local_identity_fingerprint: string
          claimed_provider_state_updated_at?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          lease_until?: string | null
          local_provider_state_updated_at?: string | null
          next_attempt_at?: string | null
          outcome?: string | null
          remote_cancelled?: boolean | null
          remote_ends_at?: string | null
          remote_provider_updated_at?: string | null
          remote_renews_at?: string | null
          remote_state_fingerprint?: string | null
          remote_status?: string | null
          run_id: string
          started_at?: string | null
          status: string
          subscription_id: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          checked_at?: string | null
          claim_token?: string | null
          claimed_local_identity_fingerprint?: string
          claimed_provider_state_updated_at?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          lease_until?: string | null
          local_provider_state_updated_at?: string | null
          next_attempt_at?: string | null
          outcome?: string | null
          remote_cancelled?: boolean | null
          remote_ends_at?: string | null
          remote_provider_updated_at?: string | null
          remote_renews_at?: string | null
          remote_state_fingerprint?: string | null
          remote_status?: string | null
          run_id?: string
          started_at?: string | null
          status?: string
          subscription_id?: string
          updated_at?: string
        }
        Relationships: [{
          foreignKeyName: "billing_subscription_reconciliation_checks_subscription_id_fkey"
          columns: ["subscription_id"]
          isOneToOne: false
          referencedRelation: "subscriptions"
          referencedColumns: ["id"]
        }]
      }
      billing_webhook_events: {
        Row: {
          created_at: string
          environment: string
          error_code: string | null
          event_name: string
          id: string
          last_processing_attempt_at: string | null
          last_processing_outcome: string | null
          next_processing_attempt_at: string | null
          payload_hash: string
          processed_at: string | null
          processing_status: string
          processing_attempt_count: number
          processing_claim_token: string | null
          processing_lease_until: string | null
          provider: string
          provider_object_id: string
          provider_object_type: string
          received_at: string
          salon_id: string | null
          semantic_fingerprint: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          environment: string
          error_code?: string | null
          event_name: string
          id?: string
          last_processing_attempt_at?: string | null
          last_processing_outcome?: string | null
          next_processing_attempt_at?: string | null
          payload_hash: string
          processed_at?: string | null
          processing_status: string
          processing_attempt_count?: number
          processing_claim_token?: string | null
          processing_lease_until?: string | null
          provider: string
          provider_object_id: string
          provider_object_type: string
          received_at?: string
          salon_id?: string | null
          semantic_fingerprint?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          environment?: string
          error_code?: string | null
          event_name?: string
          id?: string
          last_processing_attempt_at?: string | null
          last_processing_outcome?: string | null
          next_processing_attempt_at?: string | null
          payload_hash?: string
          processed_at?: string | null
          processing_status?: string
          processing_attempt_count?: number
          processing_claim_token?: string | null
          processing_lease_until?: string | null
          provider?: string
          provider_object_id?: string
          provider_object_type?: string
          received_at?: string
          salon_id?: string | null
          semantic_fingerprint?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_webhook_events_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_webhook_subscription_facts: {
        Row: {
          checkout_session_id: string | null
          correlation_error_code: string | null
          correlation_status: string
          created_at: string
          custom_idempotency_key: string | null
          custom_plan_code: string | null
          custom_salon_id: string | null
          facts_schema_version: number
          provider_created_at: string | null
          provider_cancelled: boolean | null
          provider_customer_id: string | null
          provider_ends_at: string | null
          provider_order_id: string | null
          provider_pause_mode: string | null
          provider_pause_resumes_at: string | null
          provider_product_id: string | null
          provider_renews_at: string | null
          provider_status: string | null
          provider_store_id: string | null
          provider_subscription_id: string
          provider_trial_ends_at: string | null
          provider_updated_at: string | null
          provider_variant_id: string | null
          test_mode: boolean
          webhook_event_id: string
        }
        Insert: {
          checkout_session_id?: string | null
          correlation_error_code?: string | null
          correlation_status: string
          created_at?: string
          custom_idempotency_key?: string | null
          custom_plan_code?: string | null
          custom_salon_id?: string | null
          facts_schema_version?: number
          provider_created_at?: string | null
          provider_cancelled?: boolean | null
          provider_customer_id?: string | null
          provider_ends_at?: string | null
          provider_order_id?: string | null
          provider_pause_mode?: string | null
          provider_pause_resumes_at?: string | null
          provider_product_id?: string | null
          provider_renews_at?: string | null
          provider_status?: string | null
          provider_store_id?: string | null
          provider_subscription_id: string
          provider_trial_ends_at?: string | null
          provider_updated_at?: string | null
          provider_variant_id?: string | null
          test_mode: boolean
          webhook_event_id: string
        }
        Update: {
          checkout_session_id?: string | null
          correlation_error_code?: string | null
          correlation_status?: string
          created_at?: string
          custom_idempotency_key?: string | null
          custom_plan_code?: string | null
          custom_salon_id?: string | null
          facts_schema_version?: number
          provider_created_at?: string | null
          provider_cancelled?: boolean | null
          provider_customer_id?: string | null
          provider_ends_at?: string | null
          provider_order_id?: string | null
          provider_pause_mode?: string | null
          provider_pause_resumes_at?: string | null
          provider_product_id?: string | null
          provider_renews_at?: string | null
          provider_status?: string | null
          provider_store_id?: string | null
          provider_subscription_id?: string
          provider_trial_ends_at?: string | null
          provider_updated_at?: string | null
          provider_variant_id?: string | null
          test_mode?: boolean
          webhook_event_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_webhook_subscription_facts_webhook_event_id_fkey"
            columns: ["webhook_event_id"]
            isOneToOne: true
            referencedRelation: "billing_webhook_events"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_webhook_subscription_invoice_facts: {
        Row: {
          billing_reason: string
          created_at: string
          environment: string
          evidence_status: string
          id: string
          invoice_status: string
          provider: string
          provider_customer_id: string
          provider_invoice_created_at: string
          provider_invoice_id: string
          provider_invoice_updated_at: string
          provider_store_id: string
          provider_subscription_id: string
          updated_at: string
          webhook_event_id: string
        }
        Insert: {
          billing_reason: string
          created_at?: string
          environment: string
          evidence_status?: string
          id?: string
          invoice_status: string
          provider: string
          provider_customer_id: string
          provider_invoice_created_at: string
          provider_invoice_id: string
          provider_invoice_updated_at: string
          provider_store_id: string
          provider_subscription_id: string
          updated_at?: string
          webhook_event_id: string
        }
        Update: {
          billing_reason?: string
          created_at?: string
          environment?: string
          evidence_status?: string
          id?: string
          invoice_status?: string
          provider?: string
          provider_customer_id?: string
          provider_invoice_created_at?: string
          provider_invoice_id?: string
          provider_invoice_updated_at?: string
          provider_store_id?: string
          provider_subscription_id?: string
          updated_at?: string
          webhook_event_id?: string
        }
        Relationships: [{
          foreignKeyName: "billing_webhook_subscription_invoice_facts_webhook_event_id_fkey"
          columns: ["webhook_event_id"]
          isOneToOne: true
          referencedRelation: "billing_webhook_events"
          referencedColumns: ["id"]
        }]
      }
      clients: {
        Row: {
          avatar_url: string | null
          cancelled_appointments: number
          completed_appointments: number
          created_at: string
          email: string | null
          full_name: string
          id: string
          last_visit_at: string | null
          marketing_consent: boolean
          marketing_consent_at: string | null
          next_appointment_at: string | null
          no_show_count: number
          notes: string | null
          phone: string | null
          preferred_employee_id: string | null
          preferred_service_id: string | null
          salon_id: string
          source: string | null
          status: Database["public"]["Enums"]["client_status"]
          total_appointments: number
          total_spent: number
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          cancelled_appointments?: number
          completed_appointments?: number
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          last_visit_at?: string | null
          marketing_consent?: boolean
          marketing_consent_at?: string | null
          next_appointment_at?: string | null
          no_show_count?: number
          notes?: string | null
          phone?: string | null
          preferred_employee_id?: string | null
          preferred_service_id?: string | null
          salon_id: string
          source?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          total_appointments?: number
          total_spent?: number
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          cancelled_appointments?: number
          completed_appointments?: number
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          last_visit_at?: string | null
          marketing_consent?: boolean
          marketing_consent_at?: string | null
          next_appointment_at?: string | null
          no_show_count?: number
          notes?: string | null
          phone?: string | null
          preferred_employee_id?: string | null
          preferred_service_id?: string | null
          salon_id?: string
          source?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          total_appointments?: number
          total_spent?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_preferred_employee_id_fkey"
            columns: ["preferred_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_preferred_service_id_fkey"
            columns: ["preferred_service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      closures: {
        Row: {
          created_at: string
          created_by: string | null
          employee_id: string | null
          ends_at: string
          id: string
          is_full_day: boolean
          reason: string | null
          salon_id: string
          starts_at: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          employee_id?: string | null
          ends_at: string
          id?: string
          is_full_day?: boolean
          reason?: string | null
          salon_id: string
          starts_at: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          employee_id?: string | null
          ends_at?: string
          id?: string
          is_full_day?: boolean
          reason?: string | null
          salon_id?: string
          starts_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "closures_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "closures_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "closures_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          ai_status: Database["public"]["Enums"]["ai_conversation_status"]
          assigned_member_id: string | null
          channel: string
          client_id: string | null
          created_at: string
          external_conversation_id: string | null
          id: string
          intent: string | null
          last_message_at: string | null
          last_message_preview: string | null
          salon_id: string
          status: Database["public"]["Enums"]["conversation_status"]
          updated_at: string
        }
        Insert: {
          ai_status?: Database["public"]["Enums"]["ai_conversation_status"]
          assigned_member_id?: string | null
          channel: string
          client_id?: string | null
          created_at?: string
          external_conversation_id?: string | null
          id?: string
          intent?: string | null
          last_message_at?: string | null
          last_message_preview?: string | null
          salon_id: string
          status?: Database["public"]["Enums"]["conversation_status"]
          updated_at?: string
        }
        Update: {
          ai_status?: Database["public"]["Enums"]["ai_conversation_status"]
          assigned_member_id?: string | null
          channel?: string
          client_id?: string | null
          created_at?: string
          external_conversation_id?: string | null
          id?: string
          intent?: string | null
          last_message_at?: string | null
          last_message_preview?: string | null
          salon_id?: string
          status?: Database["public"]["Enums"]["conversation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_assigned_member_id_fkey"
            columns: ["assigned_member_id"]
            isOneToOne: false
            referencedRelation: "salon_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_services: {
        Row: {
          created_at: string
          custom_duration_minutes: number | null
          custom_price: number | null
          employee_id: string
          id: string
          is_active: boolean
          salon_id: string
          service_id: string
        }
        Insert: {
          created_at?: string
          custom_duration_minutes?: number | null
          custom_price?: number | null
          employee_id: string
          id?: string
          is_active?: boolean
          salon_id: string
          service_id: string
        }
        Update: {
          created_at?: string
          custom_duration_minutes?: number | null
          custom_price?: number | null
          employee_id?: string
          id?: string
          is_active?: boolean
          salon_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_services_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_services_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          is_bookable: boolean
          is_public: boolean
          phone: string | null
          position: string | null
          profile_id: string | null
          public_slug: string | null
          salon_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          is_bookable?: boolean
          is_public?: boolean
          phone?: string | null
          position?: string | null
          profile_id?: string | null
          public_slug?: string | null
          salon_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          is_bookable?: boolean
          is_public?: boolean
          phone?: string | null
          position?: string | null
          profile_id?: string | null
          public_slug?: string | null
          salon_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          access_token_encrypted: string | null
          connected_at: string | null
          created_at: string
          disconnected_at: string | null
          error_message: string | null
          external_account_id: string | null
          external_account_name: string | null
          id: string
          last_synced_at: string | null
          provider: string
          refresh_token_encrypted: string | null
          salon_id: string
          settings: Json | null
          status: Database["public"]["Enums"]["integration_status"]
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          access_token_encrypted?: string | null
          connected_at?: string | null
          created_at?: string
          disconnected_at?: string | null
          error_message?: string | null
          external_account_id?: string | null
          external_account_name?: string | null
          id?: string
          last_synced_at?: string | null
          provider: string
          refresh_token_encrypted?: string | null
          salon_id: string
          settings?: Json | null
          status?: Database["public"]["Enums"]["integration_status"]
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token_encrypted?: string | null
          connected_at?: string | null
          created_at?: string
          disconnected_at?: string | null
          error_message?: string | null
          external_account_id?: string | null
          external_account_name?: string | null
          id?: string
          last_synced_at?: string | null
          provider?: string
          refresh_token_encrypted?: string | null
          salon_id?: string
          settings?: Json | null
          status?: Database["public"]["Enums"]["integration_status"]
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          ai_confidence: number | null
          ai_generated: boolean
          client_id: string | null
          content: string
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["message_direction"]
          external_message_id: string | null
          id: string
          message_type: string
          read_at: string | null
          related_appointment_id: string | null
          salon_id: string
          sender_profile_id: string | null
          sender_type: Database["public"]["Enums"]["message_sender_type"]
          sent_at: string | null
        }
        Insert: {
          ai_confidence?: number | null
          ai_generated?: boolean
          client_id?: string | null
          content: string
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["message_direction"]
          external_message_id?: string | null
          id?: string
          message_type?: string
          read_at?: string | null
          related_appointment_id?: string | null
          salon_id: string
          sender_profile_id?: string | null
          sender_type: Database["public"]["Enums"]["message_sender_type"]
          sent_at?: string | null
        }
        Update: {
          ai_confidence?: number | null
          ai_generated?: boolean
          client_id?: string | null
          content?: string
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          external_message_id?: string | null
          id?: string
          message_type?: string
          read_at?: string | null
          related_appointment_id?: string | null
          salon_id?: string
          sender_profile_id?: string | null
          sender_type?: Database["public"]["Enums"]["message_sender_type"]
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_related_appointment_id_fkey"
            columns: ["related_appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_profile_id_fkey"
            columns: ["sender_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_recipients: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          notification_id: string
          profile_id: string
          read_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          notification_id: string
          profile_id: string
          read_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          notification_id?: string
          profile_id?: string
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_recipients_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_recipients_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          is_read: boolean
          message: string
          salon_id: string
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_read?: boolean
          message: string
          salon_id: string
          title: string
          type: string
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_read?: boolean
          message?: string
          salon_id?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          appointment_id: string | null
          client_id: string | null
          created_at: string
          currency: string
          id: string
          paid_at: string | null
          provider: string | null
          provider_payment_id: string | null
          refunded_at: string | null
          salon_id: string
          status: Database["public"]["Enums"]["payment_record_status"]
          type: Database["public"]["Enums"]["payment_type"]
          updated_at: string
        }
        Insert: {
          amount: number
          appointment_id?: string | null
          client_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          paid_at?: string | null
          provider?: string | null
          provider_payment_id?: string | null
          refunded_at?: string | null
          salon_id: string
          status?: Database["public"]["Enums"]["payment_record_status"]
          type: Database["public"]["Enums"]["payment_type"]
          updated_at?: string
        }
        Update: {
          amount?: number
          appointment_id?: string | null
          client_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          paid_at?: string | null
          provider?: string | null
          provider_payment_id?: string | null
          refunded_at?: string | null
          salon_id?: string
          status?: Database["public"]["Enums"]["payment_record_status"]
          type?: Database["public"]["Enums"]["payment_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          ai_receptionist_enabled: boolean
          analytics_enabled: boolean
          created_at: string
          currency: string
          description: string | null
          id: string
          instagram_enabled: boolean
          is_active: boolean
          marketing_enabled: boolean
          max_ai_messages: number | null
          max_employees: number | null
          max_monthly_bookings: number | null
          max_monthly_reminders: number | null
          monthly_price: number
          name: string
          slug: string
          sms_reminders_enabled: boolean
          sort_order: number
          updated_at: string
          whatsapp_enabled: boolean
          yearly_price: number | null
        }
        Insert: {
          ai_receptionist_enabled?: boolean
          analytics_enabled?: boolean
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          instagram_enabled?: boolean
          is_active?: boolean
          marketing_enabled?: boolean
          max_ai_messages?: number | null
          max_employees?: number | null
          max_monthly_bookings?: number | null
          max_monthly_reminders?: number | null
          monthly_price: number
          name: string
          slug: string
          sms_reminders_enabled?: boolean
          sort_order?: number
          updated_at?: string
          whatsapp_enabled?: boolean
          yearly_price?: number | null
        }
        Update: {
          ai_receptionist_enabled?: boolean
          analytics_enabled?: boolean
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          instagram_enabled?: boolean
          is_active?: boolean
          marketing_enabled?: boolean
          max_ai_messages?: number | null
          max_employees?: number | null
          max_monthly_bookings?: number | null
          max_monthly_reminders?: number | null
          monthly_price?: number
          name?: string
          slug?: string
          sms_reminders_enabled?: boolean
          sort_order?: number
          updated_at?: string
          whatsapp_enabled?: boolean
          yearly_price?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          global_role: Database["public"]["Enums"]["global_role"]
          id: string
          last_active_at: string | null
          onboarding_completed: boolean
          phone: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string
          global_role?: Database["public"]["Enums"]["global_role"]
          id: string
          last_active_at?: string | null
          onboarding_completed?: boolean
          phone?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          global_role?: Database["public"]["Enums"]["global_role"]
          id?: string
          last_active_at?: string | null
          onboarding_completed?: boolean
          phone?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      resources: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          salon_id: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          salon_id: string
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          salon_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "resources_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_members: {
        Row: {
          created_at: string
          id: string
          invited_at: string | null
          invited_by: string | null
          joined_at: string | null
          profile_id: string
          role: Database["public"]["Enums"]["salon_member_role"]
          salon_id: string
          status: Database["public"]["Enums"]["member_status"]
        }
        Insert: {
          created_at?: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          joined_at?: string | null
          profile_id: string
          role?: Database["public"]["Enums"]["salon_member_role"]
          salon_id: string
          status?: Database["public"]["Enums"]["member_status"]
        }
        Update: {
          created_at?: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          joined_at?: string | null
          profile_id?: string
          role?: Database["public"]["Enums"]["salon_member_role"]
          salon_id?: string
          status?: Database["public"]["Enums"]["member_status"]
        }
        Relationships: [
          {
            foreignKeyName: "salon_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salon_members_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_reminder_settings: {
        Row: {
          channel: Database["public"]["Enums"]["reminder_channel"]
          created_at: string
          enabled: boolean
          hours_before: number
          id: string
          salon_id: string
          updated_at: string
        }
        Insert: {
          channel?: Database["public"]["Enums"]["reminder_channel"]
          created_at?: string
          enabled?: boolean
          hours_before?: number
          id?: string
          salon_id: string
          updated_at?: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["reminder_channel"]
          created_at?: string
          enabled?: boolean
          hours_before?: number
          id?: string
          salon_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salon_reminder_settings_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: true
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      salons: {
        Row: {
          address_line: string | null
          booking_enabled: boolean
          business_type: Database["public"]["Enums"]["business_type"]
          city: string | null
          country: string
          cover_image_url: string | null
          created_at: string
          default_currency: string
          description: string | null
          email: string | null
          facebook_url: string | null
          id: string
          instagram_url: string | null
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          name: string
          onboarding_completed: boolean
          onboarding_step: number
          online_booking_enabled: boolean
          owner_id: string
          phone: string | null
          postal_code: string | null
          public_booking_url: string | null
          short_description: string | null
          slug: string
          status: Database["public"]["Enums"]["salon_status"]
          tiktok_url: string | null
          timezone: string
          updated_at: string
          website_url: string | null
        }
        Insert: {
          address_line?: string | null
          booking_enabled?: boolean
          business_type?: Database["public"]["Enums"]["business_type"]
          city?: string | null
          country?: string
          cover_image_url?: string | null
          created_at?: string
          default_currency?: string
          description?: string | null
          email?: string | null
          facebook_url?: string | null
          id?: string
          instagram_url?: string | null
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          name: string
          onboarding_completed?: boolean
          onboarding_step?: number
          online_booking_enabled?: boolean
          owner_id: string
          phone?: string | null
          postal_code?: string | null
          public_booking_url?: string | null
          short_description?: string | null
          slug: string
          status?: Database["public"]["Enums"]["salon_status"]
          tiktok_url?: string | null
          timezone?: string
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          address_line?: string | null
          booking_enabled?: boolean
          business_type?: Database["public"]["Enums"]["business_type"]
          city?: string | null
          country?: string
          cover_image_url?: string | null
          created_at?: string
          default_currency?: string
          description?: string | null
          email?: string | null
          facebook_url?: string | null
          id?: string
          instagram_url?: string | null
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          name?: string
          onboarding_completed?: boolean
          onboarding_step?: number
          online_booking_enabled?: boolean
          owner_id?: string
          phone?: string | null
          postal_code?: string | null
          public_booking_url?: string | null
          short_description?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["salon_status"]
          tiktok_url?: string | null
          timezone?: string
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "salons_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      service_categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          salon_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          salon_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          salon_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_categories_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          buffer_minutes: number
          category_id: string | null
          category_name: string | null
          color: string | null
          created_at: string
          currency: string
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean
          is_public: boolean
          name: string
          price: number
          salon_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          buffer_minutes?: number
          category_id?: string | null
          category_name?: string | null
          color?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          duration_minutes: number
          id?: string
          is_active?: boolean
          is_public?: boolean
          name: string
          price: number
          salon_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          buffer_minutes?: number
          category_id?: string | null
          category_name?: string | null
          color?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          is_public?: boolean
          name?: string
          price?: number
          salon_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          billing_environment: string | null
          billing_provider: string | null
          cancel_at_period_end: boolean
          cancelled_at: string | null
          created_at: string
          current_period_ends_at: string | null
          current_period_starts_at: string | null
          id: string
          plan_id: string
          provider_customer_id: string | null
          provider_last_webhook_event_id: string | null
          provider_state_updated_at: string | null
          provider_subscription_id: string | null
          salon_id: string
          status: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at: string | null
          trial_starts_at: string | null
          updated_at: string
        }
        Insert: {
          billing_environment?: string | null
          billing_provider?: string | null
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          current_period_ends_at?: string | null
          current_period_starts_at?: string | null
          id?: string
          plan_id: string
          provider_customer_id?: string | null
          provider_last_webhook_event_id?: string | null
          provider_state_updated_at?: string | null
          provider_subscription_id?: string | null
          salon_id: string
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at?: string | null
          trial_starts_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_environment?: string | null
          billing_provider?: string | null
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          current_period_ends_at?: string | null
          current_period_starts_at?: string | null
          id?: string
          plan_id?: string
          provider_customer_id?: string | null
          provider_last_webhook_event_id?: string | null
          provider_state_updated_at?: string | null
          provider_subscription_id?: string | null
          salon_id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at?: string | null
          trial_starts_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_provider_last_webhook_event_id_fkey"
            columns: ["provider_last_webhook_event_id"]
            isOneToOne: false
            referencedRelation: "billing_webhook_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: true
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      team_invitations: {
        Row: {
          accepted_at: string | null
          auth_user_id: string | null
          created_at: string
          email: string
          employee_id: string
          expires_at: string
          id: string
          invited_by: string
          salon_id: string
          status: string
        }
        Insert: {
          accepted_at?: string | null
          auth_user_id?: string | null
          created_at?: string
          email: string
          employee_id: string
          expires_at?: string
          id?: string
          invited_by: string
          salon_id: string
          status?: string
        }
        Update: {
          accepted_at?: string | null
          auth_user_id?: string | null
          created_at?: string
          email?: string
          employee_id?: string
          expires_at?: string
          id?: string
          invited_by?: string
          salon_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_invitations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_invitations_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
      working_hours: {
        Row: {
          break_ends_at: string | null
          break_starts_at: string | null
          closes_at: string
          created_at: string
          day_of_week: number
          employee_id: string | null
          id: string
          is_working_day: boolean
          opens_at: string
          salon_id: string
          updated_at: string
        }
        Insert: {
          break_ends_at?: string | null
          break_starts_at?: string | null
          closes_at: string
          created_at?: string
          day_of_week: number
          employee_id?: string | null
          id?: string
          is_working_day?: boolean
          opens_at: string
          salon_id: string
          updated_at?: string
        }
        Update: {
          break_ends_at?: string | null
          break_starts_at?: string | null
          closes_at?: string
          created_at?: string
          day_of_week?: number
          employee_id?: string | null
          id?: string
          is_working_day?: boolean
          opens_at?: string
          salon_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "working_hours_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "working_hours_salon_id_fkey"
            columns: ["salon_id"]
            isOneToOne: false
            referencedRelation: "salons"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_billing_checkout_intent_v1: {
        Args: {
          p_actor_profile_id: string
          p_environment: string
          p_provider: string
          p_requested_plan_id: string
          p_salon_id: string
        }
        Returns: {
          acquisition_outcome: string
          actor_profile_id: string
          checkout_session_id: string
          environment: string
          expires_at: string | null
          idempotency_key: string
          provider: string
          provider_session_id: string | null
          requested_plan_id: string
          status: string
        }[]
      }
      acquire_billing_checkout_intent_v2: {
        Args: {
          p_actor_profile_id: string
          p_provider: string
          p_requested_plan_id: string
          p_salon_id: string
        }
        Returns: {
          acquisition_outcome: string
          actor_profile_id: string
          checkout_session_id: string
          environment: string
          expires_at: string | null
          idempotency_key: string
          provider: string
          provider_session_id: string | null
          requested_plan_id: string
          status: string
        }[]
      }
      claim_billing_checkout_recovery_v1: {
        Args: {
          p_checkout_session_id: string
          p_environment: string
          p_lease_duration?: string
          p_now?: string
        }
        Returns: {
          attempt_number: number | null
          checkout_session_id: string
          claim_outcome: string
          claim_token: string | null
          environment: string
          idempotency_key: string
          lease_expires_at: string | null
          ledger_created_at: string
          ledger_expires_at: string | null
          ledger_status: string
          provider: string
          provider_session_id: string | null
          recovery_attempt_id: string | null
          requested_plan_id: string
          salon_id: string
        }[]
      }
      complete_billing_checkout_recovery_attempt_v1: {
        Args: {
          p_claim_token: string
          p_environment: string
          p_now?: string
          p_outcome: string
          p_recovery_attempt_id: string
        }
        Returns: {
          completed_at: string | null
          completion_outcome: string
          outcome: string | null
          recovery_attempt_id: string
          status: string | null
        }[]
      }
      finalize_billing_checkout_recovery_v1: {
        Args: {
          p_checkout_url_hash: string
          p_claim_token: string
          p_environment: string
          p_provider_checkout_id: string
          p_provider_expires_at: string
          p_recovery_attempt_id: string
        }
        Returns: {
          attempt_completed_at: string | null
          attempt_status: string | null
          audit_outcome: string | null
          finalization_outcome: string
          ledger_status: string | null
          recovery_attempt_id: string
        }[]
      }
      claim_next_linked_billing_subscription_for_reconciliation_v1: {
        Args: { p_lease_duration?: string; p_min_freshness?: string; p_now?: string; p_run_id: string }
        Returns: { check_id: string; claim_token: string; local_cancel_at_period_end: boolean; local_cancelled_at: string | null; local_current_period_ends_at: string | null; local_plan_id: string; local_provider_state_updated_at: string | null; local_status: string; mapped_product_id: string | null; mapped_store_id: string; mapped_variant_id: string; provider_customer_id: string; provider_subscription_id: string; subscription_id: string }[]
      }
      evaluate_billing_subscription_snapshot_v1: {
        Args: { p_claimed_local_identity_fingerprint: string; p_now?: string; p_provider_cancelled: boolean; p_provider_created_at: string; p_provider_customer_id: string; p_provider_ends_at: string | null; p_provider_pause_mode: string | null; p_provider_pause_resumes_at: string | null; p_provider_product_id: string; p_provider_renews_at: string | null; p_provider_status: string; p_provider_store_id: string; p_provider_subscription_id: string; p_provider_trial_ends_at: string | null; p_provider_updated_at: string; p_provider_variant_id: string; p_subscription_id: string; p_test_mode: boolean }
        Returns: { error_code: string | null; local_provider_state_updated_at: string | null; outcome: string }[]
      }
      finalize_billing_subscription_reconciliation_v1: {
        Args: { p_check_id: string; p_claim_token: string; p_now?: string; p_provider_cancelled?: boolean | null; p_provider_created_at?: string | null; p_provider_customer_id?: string | null; p_provider_ends_at?: string | null; p_provider_error_code?: string | null; p_provider_pause_mode?: string | null; p_provider_pause_resumes_at?: string | null; p_provider_product_id?: string | null; p_provider_renews_at?: string | null; p_provider_status?: string | null; p_provider_store_id?: string | null; p_provider_subscription_id?: string | null; p_provider_trial_ends_at?: string | null; p_provider_updated_at?: string | null; p_provider_variant_id?: string | null; p_result_kind: string; p_test_mode?: boolean | null }
        Returns: { outcome: string }[]
      }
      claim_pending_billing_webhook_events_v1: {
        Args: {
          p_batch_size?: number
          p_lease_duration?: string
          p_now?: string
        }
        Returns: {
          claim_token: string
          event_name: string
          webhook_event_id: string
        }[]
      }
      finalize_billing_webhook_processing_attempt_v1: {
        Args: {
          p_claim_token: string
          p_now?: string
          p_webhook_event_id: string
          p_worker_outcome: string
        }
        Returns: {
          outcome: string
        }[]
      }
      ingest_billing_webhook_event_v1: {
        Args: {
          p_checkout_session_id: string | null
          p_correlation_error_code: string | null
          p_correlation_status: string | null
          p_custom_idempotency_key: string | null
          p_custom_plan_code: string | null
          p_custom_salon_id: string | null
          p_environment: string
          p_event_name: string
          p_has_subscription_facts: boolean
          p_payload_hash: string
          p_processed_at: string | null
          p_processing_status: string
          p_provider: string
          p_provider_created_at: string | null
          p_provider_customer_id: string | null
          p_provider_object_id: string
          p_provider_object_type: string
          p_provider_order_id: string | null
          p_provider_product_id: string | null
          p_provider_status: string | null
          p_provider_subscription_id: string | null
          p_provider_updated_at: string | null
          p_provider_variant_id: string | null
          p_semantic_fingerprint: string
          p_test_mode: boolean
        }
        Returns: {
          event_id: string
          outcome: string
          stored_status: string
        }[]
      }
      ingest_billing_webhook_event_v2: {
        Args: {
          p_checkout_session_id: string | null
          p_correlation_error_code: string | null
          p_correlation_status: string | null
          p_custom_idempotency_key: string | null
          p_custom_plan_code: string | null
          p_custom_salon_id: string | null
          p_environment: string
          p_event_name: string
          p_has_subscription_facts: boolean
          p_payload_hash: string
          p_processed_at: string | null
          p_processing_status: string
          p_provider: string
          p_provider_cancelled: boolean | null
          p_provider_created_at: string | null
          p_provider_customer_id: string | null
          p_provider_ends_at: string | null
          p_provider_object_id: string
          p_provider_object_type: string
          p_provider_order_id: string | null
          p_provider_pause_mode: string | null
          p_provider_pause_resumes_at: string | null
          p_provider_product_id: string | null
          p_provider_renews_at: string | null
          p_provider_status: string | null
          p_provider_store_id: string | null
          p_provider_subscription_id: string | null
          p_provider_trial_ends_at: string | null
          p_provider_updated_at: string | null
          p_provider_variant_id: string | null
          p_semantic_fingerprint: string
          p_test_mode: boolean
        }
        Returns: {
          event_id: string
          outcome: string
          stored_status: string
        }[]
      }
      ingest_billing_subscription_invoice_evidence_v1: {
        Args: {
          p_billing_reason: string
          p_environment: string
          p_event_name: string
          p_invoice_status: string
          p_now?: string
          p_payload_hash: string
          p_provider: string
          p_provider_customer_id: string
          p_provider_invoice_created_at: string
          p_provider_invoice_id: string
          p_provider_invoice_updated_at: string
          p_provider_object_id: string
          p_provider_object_type: string
          p_provider_store_id: string
          p_provider_subscription_id: string
          p_semantic_fingerprint: string
          p_test_mode: boolean
        }
        Returns: {
          event_id: string
          outcome: string
          stored_status: string
        }[]
      }
      process_billing_subscription_created_v1: {
        Args: { p_now?: string; p_webhook_event_id: string }
        Returns: { error_code: string; outcome: string }[]
      }
      claim_pending_billing_webhook_events_v2: {
        Args: {
          p_batch_size?: number
          p_environment: string
          p_lease_duration?: string
          p_now?: string
        }
        Returns: {
          claim_token: string
          environment: string
          event_name: string
          webhook_event_id: string
        }[]
      }
      process_billing_subscription_created_v2: {
        Args: { p_now?: string; p_webhook_event_id: string }
        Returns: { error_code: string | null; outcome: string }[]
      }
      process_billing_subscription_updated_v1: {
        Args: { p_now?: string; p_webhook_event_id: string }
        Returns: { error_code: string; outcome: string }[]
      }
      process_billing_subscription_updated_v2: {
        Args: { p_now?: string; p_webhook_event_id: string }
        Returns: { error_code: string | null; outcome: string }[]
      }
      accept_team_invitation: {
        Args: { p_invitation_id: string; p_profile_id: string }
        Returns: {
          already_accepted: boolean
          employee_id: string
          membership_id: string
          result_status: string
          salon_id: string
        }[]
      }
      apply_infobip_sms_delivery_report: {
        Args: {
          p_error_code?: string
          p_error_name?: string
          p_error_permanent?: boolean
          p_provider_done_at?: string
          p_provider_message_id: string
          p_received_at?: string
          p_status_group: string
          p_status_id: number
          p_status_name: string
        }
        Returns: string
      }
      assert_owner_manager_appointment_access_v1: {
        Args: { p_salon_id: string }
        Returns: undefined
      }
      assert_salon_admin_write_access_v1: {
        Args: { p_salon_id: string }
        Returns: undefined
      }
      claim_due_appointment_reminders: {
        Args: {
          p_batch_size?: number
          p_lease_minutes?: number
          p_now?: string
        }
        Returns: {
          appointment_id: string
          appointment_start: string
          attempt_count: number
          channel: Database["public"]["Enums"]["reminder_channel"]
          claim_token: string
          client_id: string
          delivery_id: string
          lease_expires_at: string
          recipient: string
          salon_id: string
          salon_timezone: string
          scheduled_for: string
        }[]
      }
      cleanup_simulation_run: {
        Args: {
          p_appointment_ids: string[]
          p_client_ids: string[]
          p_salon_id: string
        }
        Returns: {
          deleted_appointments: number
          deleted_clients: number
          deleted_notifications: number
          deleted_snapshots: number
          retained_clients: number
        }[]
      }
      create_closure_v1: {
        Args: {
          p_employee_id: string
          p_ends_at: string
          p_is_full_day: boolean
          p_reason: string
          p_salon_id: string
          p_starts_at: string
          p_title: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          employee_id: string | null
          ends_at: string
          id: string
          is_full_day: boolean
          reason: string | null
          salon_id: string
          starts_at: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "closures"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_employee_appointment_atomic: {
        Args: {
          p_customer_email: string
          p_customer_full_name: string
          p_customer_note: string
          p_customer_phone: string
          p_idempotency_key: string
          p_profile_id: string
          p_service_id: string
          p_start_time: string
        }
        Returns: {
          appointment_id: string
          appointment_start: string
          appointment_status: Database["public"]["Enums"]["appointment_status"]
          customer_name: string
          salon_id: string
          service_name: string
          was_created: boolean
        }[]
      }
      create_employee_appointment_atomic_scoped_v1: {
        Args: {
          p_customer_email: string
          p_customer_full_name: string
          p_customer_note: string
          p_customer_phone: string
          p_idempotency_key: string
          p_profile_id: string
          p_service_id: string
          p_start_time: string
        }
        Returns: {
          appointment_id: string
          appointment_start: string
          appointment_status: Database["public"]["Enums"]["appointment_status"]
          customer_name: string
          salon_id: string
          service_name: string
          was_created: boolean
        }[]
      }
      create_employee_with_entitlement: {
        Args: {
          p_bio?: string
          p_display_name?: string
          p_email?: string
          p_full_name: string
          p_phone?: string
          p_position?: string
          p_salon_id: string
        }
        Returns: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          is_bookable: boolean
          is_public: boolean
          phone: string | null
          position: string | null
          profile_id: string | null
          public_slug: string | null
          salon_id: string
          sort_order: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "employees"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_owner_appointment_atomic_v1: {
        Args: {
          p_customer_email: string
          p_customer_full_name: string
          p_customer_note: string
          p_customer_phone: string
          p_employee_id: string
          p_idempotency_key: string
          p_salon_id: string
          p_service_id: string
          p_start_time: string
        }
        Returns: {
          appointment_id: string
          appointment_start: string
          appointment_status: Database["public"]["Enums"]["appointment_status"]
          was_created: boolean
        }[]
      }
      create_owner_client_v1: {
        Args: {
          p_email?: string
          p_full_name: string
          p_phone?: string
          p_salon_id: string
          p_source?: string
        }
        Returns: {
          avatar_url: string | null
          cancelled_appointments: number
          completed_appointments: number
          created_at: string
          email: string | null
          full_name: string
          id: string
          last_visit_at: string | null
          marketing_consent: boolean
          marketing_consent_at: string | null
          next_appointment_at: string | null
          no_show_count: number
          notes: string | null
          phone: string | null
          preferred_employee_id: string | null
          preferred_service_id: string | null
          salon_id: string
          source: string | null
          status: Database["public"]["Enums"]["client_status"]
          total_appointments: number
          total_spent: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "clients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_primary_salon_once_v1: {
        Args: {
          p_address_line?: string
          p_business_type: Database["public"]["Enums"]["business_type"]
          p_description?: string
          p_email?: string
          p_instagram_url?: string
          p_name: string
          p_phone?: string
          p_slug_candidate: string
          p_website_url?: string
        }
        Returns: {
          onboarding_completed: boolean
          onboarding_step: number
          salon_id: string
          salon_name: string
          salon_slug: string
          trial_ends_at: string
          was_created: boolean
        }[]
      }
      create_public_booking_atomic: {
        Args: {
          p_customer_email: string
          p_customer_full_name: string
          p_customer_phone: string
          p_employee_id: string
          p_idempotency_key: string
          p_salon_slug: string
          p_service_id: string
          p_start_time: string
        }
        Returns: {
          appointment_id: string
          appointment_start: string
          booked_service_name: string
          was_created: boolean
        }[]
      }
      create_public_booking_atomic_unchecked_v1: {
        Args: {
          p_customer_email: string
          p_customer_full_name: string
          p_customer_phone: string
          p_employee_id: string
          p_idempotency_key: string
          p_salon_slug: string
          p_service_id: string
          p_start_time: string
        }
        Returns: {
          appointment_id: string
          appointment_start: string
          booked_service_name: string
          was_created: boolean
        }[]
      }
      create_service_category_v1: {
        Args: {
          p_description?: string
          p_name: string
          p_salon_id: string
          p_sort_order?: number
        }
        Returns: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          salon_id: string
          sort_order: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "service_categories"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_service_v1: {
        Args: {
          p_buffer_minutes?: number
          p_category_id?: string
          p_category_name: string
          p_color?: string
          p_currency?: string
          p_description: string
          p_duration_minutes: number
          p_is_active?: boolean
          p_is_public?: boolean
          p_name: string
          p_price: number
          p_salon_id: string
          p_sort_order?: number
        }
        Returns: {
          buffer_minutes: number
          category_id: string | null
          category_name: string | null
          color: string | null
          created_at: string
          currency: string
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean
          is_public: boolean
          name: string
          price: number
          salon_id: string
          sort_order: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "services"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_employee_id: {
        Args: { target_salon_id: string }
        Returns: string
      }
      delete_client_safely_v1: {
        Args: { p_client_id: string }
        Returns: {
          client_id: string
          mode: string
        }[]
      }
      delete_closure_v1: { Args: { p_closure_id: string }; Returns: string }
      delete_employee_safely_v1: {
        Args: { p_employee_id: string }
        Returns: string
      }
      delete_service_category_v1: {
        Args: { p_category_id: string }
        Returns: string
      }
      delete_service_safely_v1: {
        Args: { p_service_id: string }
        Returns: {
          mode: string
          service_id: string
        }[]
      }
      finalize_claimed_reminder_delivery: {
        Args: {
          p_claim_token: string
          p_delivery_id: string
          p_error_code?: string
          p_error_message?: string
          p_next_retry_at?: string
          p_now?: string
          p_outcome: string
          p_provider?: string
          p_provider_message_id?: string
        }
        Returns: boolean
      }
      get_employee_appointment_clients: {
        Args: { target_salon_id: string }
        Returns: {
          email: string
          full_name: string
          id: string
          phone: string
        }[]
      }
      get_owner_clients_page_v1: {
        Args: {
          p_month_end_utc: string
          p_month_start_utc: string
          p_page: number
          p_page_size: number
          p_salon_id: string
          p_search: string
          p_sort: string
          p_status: string
        }
        Returns: Json
      }
      get_owner_statistics_v1: {
        Args: {
          p_end_utc: string
          p_granularity: string
          p_salon_id: string
          p_start_utc: string
        }
        Returns: Json
      }
      get_salon_reminder_usage: {
        Args: { p_at?: string; p_salon_id: string }
        Returns: {
          accepted_count: number
          max_monthly_reminders: number
          period_end: string
          period_start: string
          remaining: number
          salon_id: string
        }[]
      }
      get_simulation_schema_contract: { Args: never; Returns: Json }
      insert_simulation_appointment_batch: {
        Args: { p_appointments: Json; p_salon_id: string }
        Returns: {
          existing_count: number
          inserted_count: number
        }[]
      }
      insert_simulation_client_batch: {
        Args: { p_clients: Json; p_salon_id: string }
        Returns: {
          existing_count: number
          inserted_count: number
        }[]
      }
      is_salon_member: { Args: { target_salon_id: string }; Returns: boolean }
      is_salon_owner_or_manager: {
        Args: { target_salon_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      link_current_owner_employee_v1: {
        Args: { p_employee_id: string }
        Returns: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          is_bookable: boolean
          is_public: boolean
          phone: string | null
          position: string | null
          profile_id: string | null
          public_slug: string | null
          salon_id: string
          sort_order: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "employees"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      owns_salon: { Args: { target_salon_id: string }; Returns: boolean }
      preview_due_appointment_reminders: {
        Args: { p_batch_size?: number; p_now?: string; p_salon_id?: string }
        Returns: {
          appointment_id: string
          eligible: boolean
          reason: string
          recipient_masked: string
          salon_id: string
          salon_timezone: string
          scheduled_for: string
        }[]
      }
      recover_accepted_reminder_delivery: {
        Args: {
          p_claim_token: string
          p_delivery_id: string
          p_provider: string
          p_provider_message_id: string
          p_sent_at?: string
        }
        Returns: boolean
      }
      reminder_usage_period: {
        Args: { p_at?: string; p_salon_id: string }
        Returns: {
          period_end: string
          period_start: string
        }[]
      }
      remove_employee_service_assignment_v1: {
        Args: { p_employee_id: string; p_service_id: string }
        Returns: string
      }
      reschedule_owner_appointment_v1: {
        Args: {
          p_appointment_id: string
          p_employee_id: string
          p_start_time: string
        }
        Returns: {
          appointment_id: string
          appointment_start: string
          salon_id: string
        }[]
      }
      resolve_employee_capacity_v1: {
        Args: { p_now?: string; p_salon_id: string }
        Returns: {
          access_reason: string
          access_source: string
          effective_plan_id: string
          effective_plan_slug: string
          has_full_access: boolean
          is_legacy_active: boolean
          max_employees: number
        }[]
      }
      resolve_salon_access_v1: {
        Args: { p_now?: string; p_salon_id: string }
        Returns: {
          access_ends_at: string
          access_mode: string
          access_reason: string
          access_source: string
          effective_plan_id: string
          effective_plan_slug: string
          has_full_access: boolean
          is_legacy_active: boolean
          subscription_status: string
        }[]
      }
      set_client_status_v1: {
        Args: {
          p_client_id: string
          p_status: Database["public"]["Enums"]["client_status"]
        }
        Returns: {
          avatar_url: string | null
          cancelled_appointments: number
          completed_appointments: number
          created_at: string
          email: string | null
          full_name: string
          id: string
          last_visit_at: string | null
          marketing_consent: boolean
          marketing_consent_at: string | null
          next_appointment_at: string | null
          no_show_count: number
          notes: string | null
          phone: string | null
          preferred_employee_id: string | null
          preferred_service_id: string | null
          salon_id: string
          source: string | null
          status: Database["public"]["Enums"]["client_status"]
          total_appointments: number
          total_spent: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "clients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_employee_active_state: {
        Args: { p_employee_id: string; p_is_active: boolean }
        Returns: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          is_bookable: boolean
          is_public: boolean
          phone: string | null
          position: string | null
          profile_id: string | null
          public_slug: string | null
          salon_id: string
          sort_order: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "employees"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_salon_onboarding_state_v1: {
        Args: { p_completed: boolean; p_salon_id: string; p_step: number }
        Returns: {
          address_line: string | null
          booking_enabled: boolean
          business_type: Database["public"]["Enums"]["business_type"]
          city: string | null
          country: string
          cover_image_url: string | null
          created_at: string
          default_currency: string
          description: string | null
          email: string | null
          facebook_url: string | null
          id: string
          instagram_url: string | null
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          name: string
          onboarding_completed: boolean
          onboarding_step: number
          online_booking_enabled: boolean
          owner_id: string
          phone: string | null
          postal_code: string | null
          public_booking_url: string | null
          short_description: string | null
          slug: string
          status: Database["public"]["Enums"]["salon_status"]
          tiktok_url: string | null
          timezone: string
          updated_at: string
          website_url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "salons"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_service_active_state_v1: {
        Args: { p_is_active: boolean; p_service_id: string }
        Returns: {
          buffer_minutes: number
          category_id: string | null
          category_name: string | null
          color: string | null
          created_at: string
          currency: string
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean
          is_public: boolean
          name: string
          price: number
          salon_id: string
          sort_order: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "services"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sync_employee_service_assignments_v1: {
        Args: {
          p_employee_id: string
          p_salon_id: string
          p_service_ids: string[]
        }
        Returns: number
      }
      sync_working_hours_v1: {
        Args: { p_employee_id: string; p_hours: Json; p_salon_id: string }
        Returns: {
          break_ends_at: string | null
          break_starts_at: string | null
          closes_at: string
          created_at: string
          day_of_week: number
          employee_id: string | null
          id: string
          is_working_day: boolean
          opens_at: string
          salon_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "working_hours"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      update_employee_appointment_status: {
        Args: {
          p_appointment_id: string
          p_next_status: Database["public"]["Enums"]["appointment_status"]
          p_profile_id: string
        }
        Returns: {
          appointment_id: string
          new_status: Database["public"]["Enums"]["appointment_status"]
          previous_status: Database["public"]["Enums"]["appointment_status"]
          salon_id: string
        }[]
      }
      update_employee_appointment_status_scoped_v1: {
        Args: {
          p_appointment_id: string
          p_next_status: Database["public"]["Enums"]["appointment_status"]
          p_profile_id: string
        }
        Returns: {
          appointment_id: string
          new_status: Database["public"]["Enums"]["appointment_status"]
          previous_status: Database["public"]["Enums"]["appointment_status"]
          salon_id: string
        }[]
      }
      update_employee_details_v1: {
        Args: {
          p_bio: string
          p_display_name: string
          p_email: string
          p_employee_id: string
          p_full_name: string
          p_is_bookable: boolean
          p_is_public: boolean
          p_phone: string
          p_position: string
        }
        Returns: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          is_bookable: boolean
          is_public: boolean
          phone: string | null
          position: string | null
          profile_id: string | null
          public_slug: string | null
          salon_id: string
          sort_order: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "employees"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_onboarding_salon_v1: {
        Args: {
          p_address_line?: string
          p_business_type: Database["public"]["Enums"]["business_type"]
          p_description?: string
          p_email?: string
          p_instagram_url?: string
          p_name: string
          p_phone?: string
          p_salon_id: string
          p_slug: string
          p_website_url?: string
        }
        Returns: {
          address_line: string | null
          booking_enabled: boolean
          business_type: Database["public"]["Enums"]["business_type"]
          city: string | null
          country: string
          cover_image_url: string | null
          created_at: string
          default_currency: string
          description: string | null
          email: string | null
          facebook_url: string | null
          id: string
          instagram_url: string | null
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          name: string
          onboarding_completed: boolean
          onboarding_step: number
          online_booking_enabled: boolean
          owner_id: string
          phone: string | null
          postal_code: string | null
          public_booking_url: string | null
          short_description: string | null
          slug: string
          status: Database["public"]["Enums"]["salon_status"]
          tiktok_url: string | null
          timezone: string
          updated_at: string
          website_url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "salons"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_owner_appointment_details_v1: {
        Args: {
          p_appointment_id: string
          p_client_id: string
          p_customer_note: string
          p_email: string
          p_full_name: string
          p_internal_note: string
          p_phone: string
        }
        Returns: string
      }
      update_owner_appointment_notes_v1: {
        Args: {
          p_appointment_id: string
          p_customer_note: string
          p_internal_note: string
        }
        Returns: string
      }
      update_owner_appointment_status_v1: {
        Args: {
          p_appointment_id: string
          p_cancellation_reason?: string
          p_next_status: Database["public"]["Enums"]["appointment_status"]
        }
        Returns: {
          appointment_id: string
          new_status: Database["public"]["Enums"]["appointment_status"]
          previous_status: Database["public"]["Enums"]["appointment_status"]
          salon_id: string
        }[]
      }
      update_owner_client_v1: {
        Args: {
          p_client_id: string
          p_email?: string
          p_full_name: string
          p_notes?: string
          p_phone?: string
          p_source?: string
        }
        Returns: {
          avatar_url: string | null
          cancelled_appointments: number
          completed_appointments: number
          created_at: string
          email: string | null
          full_name: string
          id: string
          last_visit_at: string | null
          marketing_consent: boolean
          marketing_consent_at: string | null
          next_appointment_at: string | null
          no_show_count: number
          notes: string | null
          phone: string | null
          preferred_employee_id: string | null
          preferred_service_id: string | null
          salon_id: string
          source: string | null
          status: Database["public"]["Enums"]["client_status"]
          total_appointments: number
          total_spent: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "clients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_salon_profile_v1: {
        Args: {
          p_address_line?: string
          p_city?: string
          p_description?: string
          p_email?: string
          p_instagram_url?: string
          p_name: string
          p_phone?: string
          p_salon_id: string
          p_website_url?: string
        }
        Returns: {
          address_line: string | null
          booking_enabled: boolean
          business_type: Database["public"]["Enums"]["business_type"]
          city: string | null
          country: string
          cover_image_url: string | null
          created_at: string
          default_currency: string
          description: string | null
          email: string | null
          facebook_url: string | null
          id: string
          instagram_url: string | null
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          name: string
          onboarding_completed: boolean
          onboarding_step: number
          online_booking_enabled: boolean
          owner_id: string
          phone: string | null
          postal_code: string | null
          public_booking_url: string | null
          short_description: string | null
          slug: string
          status: Database["public"]["Enums"]["salon_status"]
          tiktok_url: string | null
          timezone: string
          updated_at: string
          website_url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "salons"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_service_category_v1: {
        Args: {
          p_category_id: string
          p_description: string
          p_is_active: boolean
          p_name: string
          p_sort_order: number
        }
        Returns: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          salon_id: string
          sort_order: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "service_categories"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_service_v1: {
        Args: {
          p_buffer_minutes?: number
          p_category_id?: string
          p_category_name: string
          p_color?: string
          p_currency?: string
          p_description: string
          p_duration_minutes: number
          p_is_active: boolean
          p_is_public: boolean
          p_name: string
          p_price: number
          p_service_id: string
          p_sort_order?: number
        }
        Returns: {
          buffer_minutes: number
          category_id: string | null
          category_name: string | null
          color: string | null
          created_at: string
          currency: string
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean
          is_public: boolean
          name: string
          price: number
          salon_id: string
          sort_order: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "services"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_employee_service_assignment_v1: {
        Args: {
          p_custom_duration_minutes?: number
          p_custom_price?: number
          p_employee_id: string
          p_is_active?: boolean
          p_salon_id: string
          p_service_id: string
        }
        Returns: {
          created_at: string
          custom_duration_minutes: number | null
          custom_price: number | null
          employee_id: string
          id: string
          is_active: boolean
          salon_id: string
          service_id: string
        }
        SetofOptions: {
          from: "*"
          to: "employee_services"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_working_hour_v1: {
        Args: {
          p_break_ends_at?: string
          p_break_starts_at?: string
          p_closes_at: string
          p_day_of_week: number
          p_employee_id: string
          p_is_working_day?: boolean
          p_opens_at: string
          p_salon_id: string
        }
        Returns: {
          break_ends_at: string | null
          break_starts_at: string | null
          closes_at: string
          created_at: string
          day_of_week: number
          employee_id: string | null
          id: string
          is_working_day: boolean
          opens_at: string
          salon_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "working_hours"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      validate_claimed_reminder_for_send: {
        Args: { p_claim_token: string; p_delivery_id: string; p_now?: string }
        Returns: {
          appointment_id: string
          appointment_start: string
          attempt_count: number
          delivery_id: string
          is_valid: boolean
          max_attempts: number
          reason: string
          recipient: string
          salon_id: string
          salon_name: string
          salon_timezone: string
          service_name: string
        }[]
      }
    }
    Enums: {
      ai_conversation_status: "active" | "paused" | "human_takeover"
      appointment_status:
        | "pending"
        | "confirmed"
        | "completed"
        | "cancelled"
        | "no_show"
      audit_actor_type: "profile" | "client" | "system" | "ai"
      booking_source: "manual" | "public" | "ai" | "whatsapp" | "instagram"
      business_type:
        | "barbershop"
        | "hair_salon"
        | "beauty_salon"
        | "spa"
        | "other"
      client_status: "active" | "blocked" | "archived"
      conversation_status: "open" | "closed" | "archived"
      global_role: "user" | "admin" | "super_admin"
      integration_status: "connected" | "disconnected" | "error"
      member_status: "invited" | "active" | "inactive" | "removed"
      message_direction: "inbound" | "outbound"
      message_sender_type: "client" | "member" | "ai" | "system"
      payment_record_status: "pending" | "paid" | "failed" | "refunded"
      payment_status: "unpaid" | "paid" | "partially_paid" | "refunded"
      payment_type: "cash" | "card" | "online" | "refund"
      reminder_channel: "sms" | "viber"
      reminder_delivery_status:
        | "pending"
        | "processing"
        | "sent"
        | "delivered"
        | "retry_scheduled"
        | "failed"
        | "skipped"
        | "cancelled"
      salon_member_role: "owner" | "manager" | "employee"
      salon_status: "active" | "inactive" | "suspended"
      subscription_status:
        | "trialing"
        | "active"
        | "past_due"
        | "cancelled"
        | "expired"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      ai_conversation_status: ["active", "paused", "human_takeover"],
      appointment_status: [
        "pending",
        "confirmed",
        "completed",
        "cancelled",
        "no_show",
      ],
      audit_actor_type: ["profile", "client", "system", "ai"],
      booking_source: ["manual", "public", "ai", "whatsapp", "instagram"],
      business_type: [
        "barbershop",
        "hair_salon",
        "beauty_salon",
        "spa",
        "other",
      ],
      client_status: ["active", "blocked", "archived"],
      conversation_status: ["open", "closed", "archived"],
      global_role: ["user", "admin", "super_admin"],
      integration_status: ["connected", "disconnected", "error"],
      member_status: ["invited", "active", "inactive", "removed"],
      message_direction: ["inbound", "outbound"],
      message_sender_type: ["client", "member", "ai", "system"],
      payment_record_status: ["pending", "paid", "failed", "refunded"],
      payment_status: ["unpaid", "paid", "partially_paid", "refunded"],
      payment_type: ["cash", "card", "online", "refund"],
      reminder_channel: ["sms", "viber"],
      reminder_delivery_status: [
        "pending",
        "processing",
        "sent",
        "delivered",
        "retry_scheduled",
        "failed",
        "skipped",
        "cancelled",
      ],
      salon_member_role: ["owner", "manager", "employee"],
      salon_status: ["active", "inactive", "suspended"],
      subscription_status: [
        "trialing",
        "active",
        "past_due",
        "cancelled",
        "expired",
      ],
    },
  },
} as const
