export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      banners: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          is_active: boolean
          link_url: string | null
          sort_order: number
          text: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          link_url?: string | null
          sort_order?: number
          text?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          link_url?: string | null
          sort_order?: number
          text?: string
          updated_at?: string
        }
        Relationships: []
      }
      brands: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      catalog_categories: {
        Row: {
          commercial_text: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          price: number | null
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          commercial_text?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          price?: number | null
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          commercial_text?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          price?: number | null
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      cleanup_execution_locks: {
        Row: {
          actor: string | null
          locked_at: string
          locked_until: string
          scope: string
        }
        Insert: {
          actor?: string | null
          locked_at?: string
          locked_until: string
          scope: string
        }
        Update: {
          actor?: string | null
          locked_at?: string
          locked_until?: string
          scope?: string
        }
        Relationships: []
      }
      custom_orders: {
        Row: {
          cart_fingerprint: string | null
          cart_version: number
          brand: string | null
          brand_id: string | null
          case_design_url: string | null
          case_file_path: string | null
          catalog_snapshot: Json | null
          created_at: string
          currency: string
          customer_email: string
          customer_name: string | null
          customer_phone: string | null
          design_status: string
          discount_amount: number
          fulfillment_status: string
          garment_color: string | null
          garment_design_url: string | null
          garment_file_path: string | null
          garment_id: string | null
          garment_size: string | null
          id: string
          is_live_mode: boolean
          last_mercado_pago_sync_at: string | null
          legal_acceptance_hash: string | null
          legal_acceptance_snapshot: Json | null
          legal_accepted_at: string | null
          low_resolution_warning: boolean
          manual_review_required: boolean
          mercadopago_checkout_url: string | null
          mercadopago_preference_claim_token: string | null
          mercadopago_preference_claimed_at: string | null
          mercadopago_preference_created_at: string | null
          mercadopago_preference_environment: string | null
          mercadopago_preference_expires_at: string | null
          mercadopago_preference_id: string | null
          mp_idempotency_key: string | null
          mp_payment_id: string | null
          mp_preference_id: string | null
          notes: string | null
          order_number: string | null
          pack_id: string | null
          pack_type: string
          payment_environment: string
          payment_cart_fingerprint: string | null
          payment_cart_version: number | null
          payment_provider: string | null
          payment_reference: string | null
          payment_status: string
          payment_status_updated_at: string | null
          phone_model: string | null
          phone_model_id: string | null
          public_access_token_hash: string | null
          secondary_garment_color: string | null
          secondary_garment_design_url: string | null
          secondary_garment_file_path: string | null
          secondary_garment_id: string | null
          secondary_garment_size: string | null
          shipping_address: Json | null
          shipping_amount: number
          shopify_order_id: string | null
          status: string
          subtotal_amount: number
          total_amount: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          cart_fingerprint?: string | null
          cart_version?: number
          brand?: string | null
          brand_id?: string | null
          case_design_url?: string | null
          case_file_path?: string | null
          catalog_snapshot?: Json | null
          created_at?: string
          currency?: string
          customer_email: string
          customer_name?: string | null
          customer_phone?: string | null
          design_status?: string
          discount_amount?: number
          fulfillment_status?: string
          garment_color?: string | null
          garment_design_url?: string | null
          garment_file_path?: string | null
          garment_id?: string | null
          garment_size?: string | null
          id?: string
          is_live_mode?: boolean
          last_mercado_pago_sync_at?: string | null
          legal_acceptance_hash?: string | null
          legal_acceptance_snapshot?: Json | null
          legal_accepted_at?: string | null
          low_resolution_warning?: boolean
          manual_review_required?: boolean
          mercadopago_checkout_url?: string | null
          mercadopago_preference_claim_token?: string | null
          mercadopago_preference_claimed_at?: string | null
          mercadopago_preference_created_at?: string | null
          mercadopago_preference_environment?: string | null
          mercadopago_preference_expires_at?: string | null
          mercadopago_preference_id?: string | null
          mp_idempotency_key?: string | null
          mp_payment_id?: string | null
          mp_preference_id?: string | null
          notes?: string | null
          order_number?: string | null
          pack_id?: string | null
          pack_type: string
          payment_environment?: string
          payment_cart_fingerprint?: string | null
          payment_cart_version?: number | null
          payment_provider?: string | null
          payment_reference?: string | null
          payment_status?: string
          payment_status_updated_at?: string | null
          phone_model?: string | null
          phone_model_id?: string | null
          public_access_token_hash?: string | null
          secondary_garment_color?: string | null
          secondary_garment_design_url?: string | null
          secondary_garment_file_path?: string | null
          secondary_garment_id?: string | null
          secondary_garment_size?: string | null
          shipping_address?: Json | null
          shipping_amount?: number
          shopify_order_id?: string | null
          status?: string
          subtotal_amount?: number
          total_amount?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          cart_fingerprint?: string | null
          cart_version?: number
          brand?: string | null
          brand_id?: string | null
          case_design_url?: string | null
          case_file_path?: string | null
          catalog_snapshot?: Json | null
          created_at?: string
          currency?: string
          customer_email?: string
          customer_name?: string | null
          customer_phone?: string | null
          design_status?: string
          discount_amount?: number
          fulfillment_status?: string
          garment_color?: string | null
          garment_design_url?: string | null
          garment_file_path?: string | null
          garment_id?: string | null
          garment_size?: string | null
          id?: string
          is_live_mode?: boolean
          last_mercado_pago_sync_at?: string | null
          legal_acceptance_hash?: string | null
          legal_acceptance_snapshot?: Json | null
          legal_accepted_at?: string | null
          low_resolution_warning?: boolean
          manual_review_required?: boolean
          mercadopago_checkout_url?: string | null
          mercadopago_preference_claim_token?: string | null
          mercadopago_preference_claimed_at?: string | null
          mercadopago_preference_created_at?: string | null
          mercadopago_preference_environment?: string | null
          mercadopago_preference_expires_at?: string | null
          mercadopago_preference_id?: string | null
          mp_idempotency_key?: string | null
          mp_payment_id?: string | null
          mp_preference_id?: string | null
          notes?: string | null
          order_number?: string | null
          pack_id?: string | null
          pack_type?: string
          payment_environment?: string
          payment_cart_fingerprint?: string | null
          payment_cart_version?: number | null
          payment_provider?: string | null
          payment_reference?: string | null
          payment_status?: string
          payment_status_updated_at?: string | null
          phone_model?: string | null
          phone_model_id?: string | null
          public_access_token_hash?: string | null
          secondary_garment_color?: string | null
          secondary_garment_design_url?: string | null
          secondary_garment_file_path?: string | null
          secondary_garment_id?: string | null
          secondary_garment_size?: string | null
          shipping_address?: Json | null
          shipping_amount?: number
          shopify_order_id?: string | null
          status?: string
          subtotal_amount?: number
          total_amount?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_orders_garment_id_fkey"
            columns: ["garment_id"]
            isOneToOne: false
            referencedRelation: "garments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_orders_phone_model_id_fkey"
            columns: ["phone_model_id"]
            isOneToOne: false
            referencedRelation: "phone_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_orders_secondary_garment_id_fkey"
            columns: ["secondary_garment_id"]
            isOneToOne: false
            referencedRelation: "garments"
            referencedColumns: ["id"]
          },
        ]
      }
      design_assets: {
        Row: {
          created_at: string
          detected_format: string | null
          file_path: string | null
          file_size_bytes: number | null
          file_type: string | null
          file_url: string | null
          height: number | null
          id: string
          kind: string | null
          metadata: Json
          order_id: string | null
          order_item_id: string | null
          width: number | null
        }
        Insert: {
          created_at?: string
          detected_format?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          file_type?: string | null
          file_url?: string | null
          height?: number | null
          id?: string
          kind?: string | null
          metadata?: Json
          order_id?: string | null
          order_item_id?: string | null
          width?: number | null
        }
        Update: {
          created_at?: string
          detected_format?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          file_type?: string | null
          file_url?: string | null
          height?: number | null
          id?: string
          kind?: string | null
          metadata?: Json
          order_id?: string | null
          order_item_id?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "design_assets_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "design_assets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "custom_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      faqs: {
        Row: {
          answer: string
          created_at: string
          id: string
          is_active: boolean
          question: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          answer?: string
          created_at?: string
          id?: string
          is_active?: boolean
          question: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          answer?: string
          created_at?: string
          id?: string
          is_active?: boolean
          question?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      final_designs: {
        Row: {
          case_design: Json | null
          case_preview_url: string | null
          created_at: string
          editor_schema_version: string | null
          final_file_url: string | null
          garment_design: Json | null
          garment_id: string | null
          garment_preview_url: string | null
          garment_size: string | null
          id: string
          low_resolution_warning: boolean
          mold_version: string | null
          order_id: string
          order_item_id: string | null
          phone_model_id: string | null
          secondary_garment_design: Json | null
          secondary_garment_id: string | null
          secondary_garment_preview_url: string | null
          secondary_garment_size: string | null
          template_version: string | null
          updated_at: string
          validated_at: string | null
        }
        Insert: {
          case_design?: Json | null
          case_preview_url?: string | null
          created_at?: string
          editor_schema_version?: string | null
          final_file_url?: string | null
          garment_design?: Json | null
          garment_id?: string | null
          garment_preview_url?: string | null
          garment_size?: string | null
          id?: string
          low_resolution_warning?: boolean
          mold_version?: string | null
          order_id: string
          order_item_id?: string | null
          phone_model_id?: string | null
          secondary_garment_design?: Json | null
          secondary_garment_id?: string | null
          secondary_garment_preview_url?: string | null
          secondary_garment_size?: string | null
          template_version?: string | null
          updated_at?: string
          validated_at?: string | null
        }
        Update: {
          case_design?: Json | null
          case_preview_url?: string | null
          created_at?: string
          editor_schema_version?: string | null
          final_file_url?: string | null
          garment_design?: Json | null
          garment_id?: string | null
          garment_preview_url?: string | null
          garment_size?: string | null
          id?: string
          low_resolution_warning?: boolean
          mold_version?: string | null
          order_id?: string
          order_item_id?: string | null
          phone_model_id?: string | null
          secondary_garment_design?: Json | null
          secondary_garment_id?: string | null
          secondary_garment_preview_url?: string | null
          secondary_garment_size?: string | null
          template_version?: string | null
          updated_at?: string
          validated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "final_designs_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: true
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "final_designs_garment_id_fkey"
            columns: ["garment_id"]
            isOneToOne: false
            referencedRelation: "garments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "final_designs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "custom_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "final_designs_phone_model_id_fkey"
            columns: ["phone_model_id"]
            isOneToOne: false
            referencedRelation: "phone_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "final_designs_secondary_garment_id_fkey"
            columns: ["secondary_garment_id"]
            isOneToOne: false
            referencedRelation: "garments"
            referencedColumns: ["id"]
          },
        ]
      }
      garments: {
        Row: {
          base_url: string | null
          color: string
          created_at: string
          id: string
          is_active: boolean
          mockup_url: string | null
          mold_status: string
          name: string
          overlay_url: string | null
          preview_url: string | null
          price: number
          print_area: Json | null
          processing_error: string | null
          sizes: string[]
          slug: string | null
          sort_order: number
          source_height: number | null
          source_psd_url: string | null
          source_width: number | null
          type: string
          updated_at: string
          view: string
        }
        Insert: {
          base_url?: string | null
          color?: string
          created_at?: string
          id?: string
          is_active?: boolean
          mockup_url?: string | null
          mold_status?: string
          name: string
          overlay_url?: string | null
          preview_url?: string | null
          price?: number
          print_area?: Json | null
          processing_error?: string | null
          sizes?: string[]
          slug?: string | null
          sort_order?: number
          source_height?: number | null
          source_psd_url?: string | null
          source_width?: number | null
          type: string
          updated_at?: string
          view?: string
        }
        Update: {
          base_url?: string | null
          color?: string
          created_at?: string
          id?: string
          is_active?: boolean
          mockup_url?: string | null
          mold_status?: string
          name?: string
          overlay_url?: string | null
          preview_url?: string | null
          price?: number
          print_area?: Json | null
          processing_error?: string | null
          sizes?: string[]
          slug?: string | null
          sort_order?: number
          source_height?: number | null
          source_psd_url?: string | null
          source_width?: number | null
          type?: string
          updated_at?: string
          view?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          base_price: number
          brand: string | null
          brand_id: string | null
          catalog_snapshot: Json
          client_item_key: string
          created_at: string
          design_status: string
          discount_amount: number
          garment_color: string | null
          garment_id: string | null
          garment_size: string | null
          id: string
          is_active: boolean
          line_total: number
          low_resolution_warning: boolean
          order_id: string
          pack_id: string | null
          pack_type: string
          phone_model: string | null
          phone_model_id: string | null
          position: number
          quantity: number
          request_fingerprint: string
          secondary_garment_color: string | null
          secondary_garment_id: string | null
          secondary_garment_size: string | null
          unit_price: number
          updated_at: string
        }
        Insert: {
          base_price: number
          brand?: string | null
          brand_id?: string | null
          catalog_snapshot?: Json
          client_item_key: string
          created_at?: string
          design_status?: string
          discount_amount?: number
          garment_color?: string | null
          garment_id?: string | null
          garment_size?: string | null
          id?: string
          is_active?: boolean
          line_total: number
          low_resolution_warning?: boolean
          order_id: string
          pack_id?: string | null
          pack_type: string
          phone_model?: string | null
          phone_model_id?: string | null
          position: number
          quantity?: number
          request_fingerprint: string
          secondary_garment_color?: string | null
          secondary_garment_id?: string | null
          secondary_garment_size?: string | null
          unit_price: number
          updated_at?: string
        }
        Update: {
          base_price?: number
          brand?: string | null
          brand_id?: string | null
          catalog_snapshot?: Json
          client_item_key?: string
          created_at?: string
          design_status?: string
          discount_amount?: number
          garment_color?: string | null
          garment_id?: string | null
          garment_size?: string | null
          id?: string
          is_active?: boolean
          line_total?: number
          low_resolution_warning?: boolean
          order_id?: string
          pack_id?: string | null
          pack_type?: string
          phone_model?: string | null
          phone_model_id?: string | null
          position?: number
          quantity?: number
          request_fingerprint?: string
          secondary_garment_color?: string | null
          secondary_garment_id?: string | null
          secondary_garment_size?: string | null
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_garment_id_fkey"
            columns: ["garment_id"]
            isOneToOne: false
            referencedRelation: "garments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "custom_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "promo_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_phone_model_id_fkey"
            columns: ["phone_model_id"]
            isOneToOne: false
            referencedRelation: "phone_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_secondary_garment_id_fkey"
            columns: ["secondary_garment_id"]
            isOneToOne: false
            referencedRelation: "garments"
            referencedColumns: ["id"]
          },
        ]
      }
      order_recovery_tokens: {
        Row: {
          created_at: string
          customer_email_normalized: string
          expires_at: string
          id: string
          order_id: string
          requested_ip_hash: string | null
          revoked_at: string | null
          token_hash: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          customer_email_normalized: string
          expires_at: string
          id?: string
          order_id: string
          requested_ip_hash?: string | null
          revoked_at?: string | null
          token_hash: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          customer_email_normalized?: string
          expires_at?: string
          id?: string
          order_id?: string
          requested_ip_hash?: string | null
          revoked_at?: string | null
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_recovery_tokens_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "custom_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_upload_authorizations: {
        Row: {
          created_at: string
          declared_mime: string
          declared_size: number
          detected_format: string | null
          detected_height: number | null
          detected_pixels: number | null
          detected_width: number | null
          expires_at: string
          finalized_at: string | null
          id: string
          kind: string
          order_id: string
          order_item_id: string | null
          rejection_reason: string | null
          session_id: string | null
          status: string
          storage_path: string
          uploaded_at: string | null
        }
        Insert: {
          created_at?: string
          declared_mime: string
          declared_size: number
          detected_format?: string | null
          detected_height?: number | null
          detected_pixels?: number | null
          detected_width?: number | null
          expires_at: string
          finalized_at?: string | null
          id?: string
          kind: string
          order_id: string
          order_item_id?: string | null
          rejection_reason?: string | null
          session_id?: string | null
          status?: string
          storage_path: string
          uploaded_at?: string | null
        }
        Update: {
          created_at?: string
          declared_mime?: string
          declared_size?: number
          detected_format?: string | null
          detected_height?: number | null
          detected_pixels?: number | null
          detected_width?: number | null
          expires_at?: string
          finalized_at?: string | null
          id?: string
          kind?: string
          order_id?: string
          order_item_id?: string | null
          rejection_reason?: string | null
          session_id?: string | null
          status?: string
          storage_path?: string
          uploaded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_upload_authorizations_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_upload_authorizations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "custom_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_upload_authorizations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "payment_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_checkout_snapshots: {
        Row: {
          canonical_cart: Json
          cart_fingerprint: string
          cart_version: number
          checkout_url: string | null
          claim_token: string | null
          created_at: string
          currency: string
          environment: string
          expires_at: string | null
          id: string
          line_items: Json
          order_id: string
          preference_id: string | null
          provider: string
          shipping_amount: number
          status: string
          stored_at: string | null
          subtotal_amount: number
          total_amount: number
        }
        Insert: {
          canonical_cart: Json
          cart_fingerprint: string
          cart_version: number
          checkout_url?: string | null
          claim_token?: string | null
          created_at?: string
          currency?: string
          environment: string
          expires_at?: string | null
          id?: string
          line_items: Json
          order_id: string
          preference_id?: string | null
          provider?: string
          shipping_amount: number
          status?: string
          stored_at?: string | null
          subtotal_amount: number
          total_amount: number
        }
        Update: {
          canonical_cart?: Json
          cart_fingerprint?: string
          cart_version?: number
          checkout_url?: string | null
          claim_token?: string | null
          created_at?: string
          currency?: string
          environment?: string
          expires_at?: string | null
          id?: string
          line_items?: Json
          order_id?: string
          preference_id?: string | null
          provider?: string
          shipping_amount?: number
          status?: string
          stored_at?: string | null
          subtotal_amount?: number
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_checkout_snapshots_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "custom_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_attempts: {
        Row: {
          cart_fingerprint: string | null
          cart_version: number | null
          checkout_snapshot_id: string | null
          attempt_number: number
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string
          is_live_mode: boolean
          last_synced_at: string | null
          mercado_pago_payment_id: string | null
          mercadopago_preference_id: string | null
          metadata: Json
          order_id: string
          expected_currency: string | null
          expected_total: number | null
          payment_flow: string
          payment_environment: string
          previous_order_status: string | null
          request_fingerprint: string
          status: string
          status_detail: string | null
          updated_at: string
        }
        Insert: {
          cart_fingerprint?: string | null
          cart_version?: number | null
          checkout_snapshot_id?: string | null
          attempt_number: number
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          is_live_mode?: boolean
          last_synced_at?: string | null
          mercado_pago_payment_id?: string | null
          mercadopago_preference_id?: string | null
          metadata?: Json
          order_id: string
          expected_currency?: string | null
          expected_total?: number | null
          payment_flow?: string
          payment_environment?: string
          previous_order_status?: string | null
          request_fingerprint: string
          status?: string
          status_detail?: string | null
          updated_at?: string
        }
        Update: {
          cart_fingerprint?: string | null
          cart_version?: number | null
          checkout_snapshot_id?: string | null
          attempt_number?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          is_live_mode?: boolean
          last_synced_at?: string | null
          mercado_pago_payment_id?: string | null
          mercadopago_preference_id?: string | null
          metadata?: Json
          order_id?: string
          expected_currency?: string | null
          expected_total?: number | null
          payment_flow?: string
          payment_environment?: string
          previous_order_status?: string | null
          request_fingerprint?: string
          status?: string
          status_detail?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_attempts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "custom_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          attempt_count: number
          created_at: string
          delivery_id: string | null
          event_action: string | null
          event_type: string
          id: string
          last_error: string | null
          order_id: string | null
          payload: Json | null
          processed_at: string | null
          processing_result: string | null
          provider: string
          provider_event_id: string | null
          provider_payment_id: string | null
          received_at: string
          request_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          delivery_id?: string | null
          event_action?: string | null
          event_type: string
          id?: string
          last_error?: string | null
          order_id?: string | null
          payload?: Json | null
          processed_at?: string | null
          processing_result?: string | null
          provider: string
          provider_event_id?: string | null
          provider_payment_id?: string | null
          received_at?: string
          request_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          delivery_id?: string | null
          event_action?: string | null
          event_type?: string
          id?: string
          last_error?: string | null
          order_id?: string | null
          payload?: Json | null
          processed_at?: string | null
          processing_result?: string | null
          provider?: string
          provider_event_id?: string | null
          provider_payment_id?: string | null
          received_at?: string
          request_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "custom_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_gateways: {
        Row: {
          config: Json
          created_at: string
          display_name: string
          enabled: boolean
          id: string
          mode: string
          notes: string | null
          provider: string
          public_key: string | null
          updated_at: string
          webhook_path: string | null
        }
        Insert: {
          config?: Json
          created_at?: string
          display_name: string
          enabled?: boolean
          id?: string
          mode?: string
          notes?: string | null
          provider: string
          public_key?: string | null
          updated_at?: string
          webhook_path?: string | null
        }
        Update: {
          config?: Json
          created_at?: string
          display_name?: string
          enabled?: boolean
          id?: string
          mode?: string
          notes?: string | null
          provider?: string
          public_key?: string | null
          updated_at?: string
          webhook_path?: string | null
        }
        Relationships: []
      }
      payment_sessions: {
        Row: {
          absolute_expires_at: string
          created_at: string
          csrf_token_hash: string | null
          expires_at: string
          id: string
          last_seen_at: string
          order_id: string
          revoked_at: string | null
          session_token_hash: string
        }
        Insert: {
          absolute_expires_at?: string
          created_at?: string
          csrf_token_hash?: string | null
          expires_at: string
          id?: string
          last_seen_at?: string
          order_id: string
          revoked_at?: string | null
          session_token_hash: string
        }
        Update: {
          absolute_expires_at?: string
          created_at?: string
          csrf_token_hash?: string | null
          expires_at?: string
          id?: string
          last_seen_at?: string
          order_id?: string
          revoked_at?: string | null
          session_token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_sessions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "custom_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_models: {
        Row: {
          brand_id: string
          created_at: string
          height_mm: number | null
          holes_url: string | null
          id: string
          is_active: boolean
          mask_url: string | null
          mockup_url: string | null
          mold_status: string
          name: string
          overlay_url: string | null
          preview_url: string | null
          print_area: Json | null
          slug: string
          sort_order: number
          source_psd_url: string | null
          updated_at: string
          width_mm: number | null
        }
        Insert: {
          brand_id: string
          created_at?: string
          height_mm?: number | null
          holes_url?: string | null
          id?: string
          is_active?: boolean
          mask_url?: string | null
          mockup_url?: string | null
          mold_status?: string
          name: string
          overlay_url?: string | null
          preview_url?: string | null
          print_area?: Json | null
          slug: string
          sort_order?: number
          source_psd_url?: string | null
          updated_at?: string
          width_mm?: number | null
        }
        Update: {
          brand_id?: string
          created_at?: string
          height_mm?: number | null
          holes_url?: string | null
          id?: string
          is_active?: boolean
          mask_url?: string | null
          mockup_url?: string | null
          mold_status?: string
          name?: string
          overlay_url?: string | null
          preview_url?: string | null
          print_area?: Json | null
          slug?: string
          sort_order?: number
          source_psd_url?: string | null
          updated_at?: string
          width_mm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "phone_models_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_packs: {
        Row: {
          button_label: string | null
          button_url: string | null
          created_at: string
          description: string | null
          features: string[]
          gradient: string | null
          id: string
          image_url: string | null
          includes: string[]
          is_active: boolean
          name: string
          pack_type: string
          price: number
          sale_price: number | null
          sort_order: number
          tag: string | null
          updated_at: string
        }
        Insert: {
          button_label?: string | null
          button_url?: string | null
          created_at?: string
          description?: string | null
          features?: string[]
          gradient?: string | null
          id?: string
          image_url?: string | null
          includes?: string[]
          is_active?: boolean
          name: string
          pack_type?: string
          price?: number
          sale_price?: number | null
          sort_order?: number
          tag?: string | null
          updated_at?: string
        }
        Update: {
          button_label?: string | null
          button_url?: string | null
          created_at?: string
          description?: string | null
          features?: string[]
          gradient?: string | null
          id?: string
          image_url?: string | null
          includes?: string[]
          is_active?: boolean
          name?: string
          pack_type?: string
          price?: number
          sale_price?: number | null
          sort_order?: number
          tag?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          bucket_key: string
          created_at: string
          hits: number
          id: string
          scope: string
          updated_at: string
          window_expires_at: string
          window_started_at: string
        }
        Insert: {
          bucket_key: string
          created_at?: string
          hits?: number
          id?: string
          scope: string
          updated_at?: string
          window_expires_at: string
          window_started_at?: string
        }
        Update: {
          bucket_key?: string
          created_at?: string
          hits?: number
          id?: string
          scope?: string
          updated_at?: string
          window_expires_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      site_content: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      template_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      templates: {
        Row: {
          category_id: string | null
          created_at: string
          file_url: string | null
          id: string
          is_active: boolean
          name: string
          preview_url: string | null
          psd_url: string | null
          sort_order: number
          tags: string[]
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          file_url?: string | null
          id?: string
          is_active?: boolean
          name: string
          preview_url?: string | null
          psd_url?: string | null
          sort_order?: number
          tags?: string[]
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          file_url?: string | null
          id?: string
          is_active?: boolean
          name?: string
          preview_url?: string | null
          psd_url?: string | null
          sort_order?: number
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "templates_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "template_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      admin_users: {
        Row: {
          created_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_order_item_v1: {
        Args: {
          p_client_item_key: string
          p_item: Json
          p_order_id: string
          p_request_fingerprint: string
        }
        Returns: Json
      }
      create_order_with_first_item_v1: {
        Args: {
          p_client_item_key: string
          p_csrf_token_hash: string
          p_item: Json
          p_order: Json
          p_request_fingerprint: string
          p_session_absolute_expires_at: string
          p_session_expires_at: string
          p_session_token_hash: string
        }
        Returns: Json
      }
      acquire_cleanup_lock: {
        Args: { p_actor: string; p_scope: string; p_ttl_seconds: number }
        Returns: boolean
      }
      apply_mercado_pago_payment_response: {
        Args: {
          p_attempt_id: string
          p_collector_id: string
          p_currency_id: string
          p_expected_collector_id: string
          p_external_reference: string
          p_live_mode: boolean
          p_metadata_attempt_id: string
          p_metadata_order_id: string
          p_order_id: string
          p_payment_id: string
          p_payment_status: string
          p_payment_type_id: string
          p_status_detail: string
          p_transaction_amount: number
        }
        Returns: Json
      }
      apply_mercado_pago_webhook: {
        Args: {
          p_attempt_id: string
          p_event_id: string
          p_mp_payment_id: string
          p_new_status: string
          p_order_id: string
          p_payload: Json
          p_processing_result: string
          p_status_detail: string
        }
        Returns: Json
      }
      begin_payment_attempt: {
        Args: {
          p_idempotency_key: string
          p_order_id: string
          p_request_fingerprint: string
        }
        Returns: Json
      }
      cleanup_abandoned_orders: { Args: never; Returns: number }
      cleanup_expired_payment_sessions: { Args: never; Returns: number }
      consume_rate_limit: {
        Args: {
          p_bucket_key: string
          p_limit: number
          p_scope: string
          p_window_seconds: number
        }
        Returns: Json
      }
      consume_order_item_upload_authorization_v1: {
        Args: {
          p_detected_format: string
          p_detected_height: number
          p_detected_width: number
          p_kind: string
          p_order_id: string
          p_order_item_id: string
          p_session_id: string
          p_storage_path: string
        }
        Returns: Json
      }
      consume_recovery_token: { Args: { p_token_hash: string }; Returns: Json }
      consume_upload_authorization: {
        Args: {
          p_detected_format: string
          p_detected_height: number
          p_detected_width: number
          p_kind: string
          p_order_id: string
          p_storage_path: string
        }
        Returns: Json
      }
      finalize_order_designs: {
        Args: {
          p_bucket: string
          p_case_design: Json
          p_case_path: string
          p_garment_design: Json
          p_garment_path: string
          p_metadata?: Json
          p_order_id: string
        }
        Returns: Json
      }
      finalize_order_designs_v3: {
        Args: {
          p_bucket: string
          p_case_design: Json
          p_case_path: string
          p_garment_design: Json
          p_garment_path: string
          p_metadata?: Json
          p_order_id: string
          p_secondary_garment_design: Json
          p_secondary_garment_path: string
        }
        Returns: Json
      }
      finalize_order_item_designs_v1: {
        Args: {
          p_bucket: string
          p_case_design: Json
          p_case_path: string
          p_garment_design: Json
          p_garment_path: string
          p_metadata?: Json
          p_order_id: string
          p_order_item_id: string
          p_session_id: string
          p_secondary_garment_design: Json
          p_secondary_garment_path: string
        }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      mark_order_item_design_failed_v1: {
        Args: { p_order_id: string; p_order_item_id: string }
        Returns: Json
      }
      issue_recovery_token: {
        Args: {
          p_email_normalized: string
          p_ip_hash: string
          p_order_id: string
          p_token_hash: string
          p_ttl_seconds: number
        }
        Returns: string
      }
      issue_upload_authorization: {
        Args: {
          p_declared_mime: string
          p_declared_size: number
          p_kind: string
          p_order_id: string
          p_session_id: string
          p_storage_path: string
          p_ttl_seconds: number
        }
        Returns: string
      }
      issue_order_item_upload_authorization_v1: {
        Args: {
          p_declared_mime: string
          p_declared_size: number
          p_kind: string
          p_order_id: string
          p_order_item_id: string
          p_session_id: string
          p_storage_path: string
          p_ttl_seconds: number
        }
        Returns: string
      }
      recalculate_order_from_items_v1: {
        Args: { p_order_id: string }
        Returns: Json
      }
      remove_order_item_v1: {
        Args: { p_order_id: string; p_order_item_id: string }
        Returns: Json
      }
      update_order_item_v1: {
        Args: {
          p_item: Json
          p_order_id: string
          p_order_item_id: string
          p_request_fingerprint: string
        }
        Returns: Json
      }
      list_abandoned_orders: {
        Args: { p_limit: number }
        Returns: {
          id: string
        }[]
      }
      next_order_number: { Args: never; Returns: string }
      reject_upload_authorization: {
        Args: { p_reason: string; p_storage_path: string }
        Returns: undefined
      }
      release_cleanup_lock: { Args: { p_scope: string }; Returns: undefined }
      reserve_webhook_delivery: {
        Args: {
          p_action: string
          p_delivery_id: string
          p_payment_id: string
          p_provider: string
          p_request_id: string
          p_type: string
        }
        Returns: Json
      }
      revoke_session: { Args: { p_session_id: string }; Returns: undefined }
      rotate_session_csrf: {
        Args: { p_new_csrf_hash: string; p_session_id: string }
        Returns: undefined
      }
      unlock_order_design: { Args: { p_order_id: string }; Returns: Json }
    }
    Enums: {
      app_role: "admin" | "user"
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
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
