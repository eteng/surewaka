npm warn Unknown project config "public-hoist-pattern". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
Initialising login role...
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
      carrier_members: {
        Row: {
          carrier_id: string
          id: string
          invited_by: string | null
          is_active: boolean
          joined_at: string
          left_at: string | null
          role: Database["public"]["Enums"]["carrier_member_role"]
          user_id: string
        }
        Insert: {
          carrier_id: string
          id?: string
          invited_by?: string | null
          is_active?: boolean
          joined_at?: string
          left_at?: string | null
          role: Database["public"]["Enums"]["carrier_member_role"]
          user_id: string
        }
        Update: {
          carrier_id?: string
          id?: string
          invited_by?: string | null
          is_active?: boolean
          joined_at?: string
          left_at?: string | null
          role?: Database["public"]["Enums"]["carrier_member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "carrier_members_carrier_id_carriers_id_fk"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carrier_members_invited_by_users_id_fk"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carrier_members_user_id_users_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      carriers: {
        Row: {
          contact_email: string
          created_at: string
          delivery_count: number | null
          id: string
          is_active: boolean
          is_verified: boolean
          logo_url: string | null
          name: string
          rating: number | null
          slug: string
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          contact_email: string
          created_at?: string
          delivery_count?: number | null
          id?: string
          is_active?: boolean
          is_verified?: boolean
          logo_url?: string | null
          name: string
          rating?: number | null
          slug: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          contact_email?: string
          created_at?: string
          delivery_count?: number | null
          id?: string
          is_active?: boolean
          is_verified?: boolean
          logo_url?: string | null
          name?: string
          rating?: number | null
          slug?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "carriers_verified_by_users_id_fk"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries: {
        Row: {
          carrier_id: string | null
          created_at: string
          customer_id: string
          driver_id: string | null
          dropoff_address: string
          dropoff_city: string
          dropoff_lat: number
          dropoff_lng: number
          id: string
          package_category: Database["public"]["Enums"]["package_category"]
          package_description: string
          package_weight: number
          pickup_address: string
          pickup_city: string
          pickup_lat: number
          pickup_lng: number
          price: number | null
          status: Database["public"]["Enums"]["delivery_status"]
          updated_at: string
        }
        Insert: {
          carrier_id?: string | null
          created_at?: string
          customer_id: string
          driver_id?: string | null
          dropoff_address: string
          dropoff_city: string
          dropoff_lat: number
          dropoff_lng: number
          id?: string
          package_category: Database["public"]["Enums"]["package_category"]
          package_description: string
          package_weight: number
          pickup_address: string
          pickup_city: string
          pickup_lat: number
          pickup_lng: number
          price?: number | null
          status?: Database["public"]["Enums"]["delivery_status"]
          updated_at?: string
        }
        Update: {
          carrier_id?: string | null
          created_at?: string
          customer_id?: string
          driver_id?: string | null
          dropoff_address?: string
          dropoff_city?: string
          dropoff_lat?: number
          dropoff_lng?: number
          id?: string
          package_category?: Database["public"]["Enums"]["package_category"]
          package_description?: string
          package_weight?: number
          pickup_address?: string
          pickup_city?: string
          pickup_lat?: number
          pickup_lng?: number
          price?: number | null
          status?: Database["public"]["Enums"]["delivery_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_carrier_id_carriers_id_fk"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_customer_id_users_id_fk"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_driver_id_drivers_id_fk"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          available: boolean
          created_at: string
          id: string
          lat: number | null
          license_plate: string
          lng: number | null
          rating: number | null
          user_id: string
          vehicle_model: string
          vehicle_type: Database["public"]["Enums"]["vehicle_type"]
          verified: boolean
        }
        Insert: {
          available?: boolean
          created_at?: string
          id?: string
          lat?: number | null
          license_plate: string
          lng?: number | null
          rating?: number | null
          user_id: string
          vehicle_model: string
          vehicle_type: Database["public"]["Enums"]["vehicle_type"]
          verified?: boolean
        }
        Update: {
          available?: boolean
          created_at?: string
          id?: string
          lat?: number | null
          license_plate?: string
          lng?: number | null
          rating?: number | null
          user_id?: string
          vehicle_model?: string
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"]
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "drivers_user_id_users_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      name_change_requests: {
        Row: {
          created_at: string
          current_name: string
          id: string
          reason: string
          requested_name: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["name_change_status"]
          user_id: string
        }
        Insert: {
          created_at?: string
          current_name: string
          id?: string
          reason: string
          requested_name: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["name_change_status"]
          user_id: string
        }
        Update: {
          created_at?: string
          current_name?: string
          id?: string
          reason?: string
          requested_name?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["name_change_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "name_change_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "name_change_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          resource_link: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          resource_link?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          resource_link?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      recent_locations: {
        Row: {
          address_text: string
          city: string
          id: string
          lat: number
          lng: number
          state: string
          used_at: string
          user_id: string
        }
        Insert: {
          address_text: string
          city: string
          id?: string
          lat: number
          lng: number
          state: string
          used_at?: string
          user_id: string
        }
        Update: {
          address_text?: string
          city?: string
          id?: string
          lat?: number
          lng?: number
          state?: string
          used_at?: string
          user_id?: string
        }
        Relationships: []
      }
      role_audit_log: {
        Row: {
          action: string
          created_at: string
          id: string
          performed_by: string | null
          reason: string | null
          role: Database["public"]["Enums"]["user_role"]
          scope_id: string | null
          scope_type: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          performed_by?: string | null
          reason?: string | null
          role: Database["public"]["Enums"]["user_role"]
          scope_id?: string | null
          scope_type?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          performed_by?: string | null
          reason?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          scope_id?: string | null
          scope_type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_audit_log_performed_by_users_id_fk"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_audit_log_user_id_users_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          is_active: boolean
          revoked_at: string | null
          role: Database["public"]["Enums"]["user_role"]
          scope_id: string | null
          scope_type: string | null
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          is_active?: boolean
          revoked_at?: string | null
          role: Database["public"]["Enums"]["user_role"]
          scope_id?: string | null
          scope_type?: string | null
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          is_active?: boolean
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          scope_id?: string | null
          scope_type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_assigned_by_users_id_fk"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_users_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_saved_addresses: {
        Row: {
          address_text: string
          city: string
          created_at: string
          id: string
          label: string
          lat: number
          lng: number
          state: string
          user_id: string
        }
        Insert: {
          address_text: string
          city: string
          created_at?: string
          id?: string
          label: string
          lat: number
          lng: number
          state: string
          user_id: string
        }
        Update: {
          address_text?: string
          city?: string
          created_at?: string
          id?: string
          label?: string
          lat?: number
          lng?: number
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          id: string
          name: string
          notification_email: boolean
          notification_sms: boolean
          phone: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          verified: boolean
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          id?: string
          name: string
          notification_email?: boolean
          notification_sms?: boolean
          phone: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          verified?: boolean
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          id?: string
          name?: string
          notification_email?: boolean
          notification_sms?: boolean
          phone?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          verified?: boolean
        }
        Relationships: []
      }
      waitlist_signups: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          source: string | null
          updated_at: string
          user_type: Database["public"]["Enums"]["waitlist_user_type"]
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id?: string
          source?: string | null
          updated_at?: string
          user_type: Database["public"]["Enums"]["waitlist_user_type"]
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          source?: string | null
          updated_at?: string
          user_type?: Database["public"]["Enums"]["waitlist_user_type"]
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_roles: { Args: never; Returns: string[] }
      has_role: { Args: { required_role: string }; Returns: boolean }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      carrier_member_role: "carrier_admin" | "carrier_driver"
      delivery_status:
        | "pending"
        | "matched"
        | "picked_up"
        | "in_transit"
        | "delivered"
        | "cancelled"
      name_change_status: "pending" | "approved" | "rejected"
      notification_type:
        | "new_user_signup"
        | "delivery_issue"
        | "carrier_verification_request"
        | "carrier_verified"
        | "dispute_opened"
        | "driver_verification_request"
        | "system_alert"
      package_category: "document" | "parcel" | "fragile" | "heavy" | "food"
      user_role:
        | "customer"
        | "driver"
        | "carrier_driver"
        | "carrier_admin"
        | "support_agent"
        | "surewaka_admin"
      vehicle_type: "motorcycle" | "car" | "van" | "truck"
      waitlist_user_type: "sender" | "business" | "driver"
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
      carrier_member_role: ["carrier_admin", "carrier_driver"],
      delivery_status: [
        "pending",
        "matched",
        "picked_up",
        "in_transit",
        "delivered",
        "cancelled",
      ],
      name_change_status: ["pending", "approved", "rejected"],
      notification_type: [
        "new_user_signup",
        "delivery_issue",
        "carrier_verification_request",
        "carrier_verified",
        "dispute_opened",
        "driver_verification_request",
        "system_alert",
      ],
      package_category: ["document", "parcel", "fragile", "heavy", "food"],
      user_role: [
        "customer",
        "driver",
        "carrier_driver",
        "carrier_admin",
        "support_agent",
        "surewaka_admin",
      ],
      vehicle_type: ["motorcycle", "car", "van", "truck"],
      waitlist_user_type: ["sender", "business", "driver"],
    },
  },
} as const
