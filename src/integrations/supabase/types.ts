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
      app_ratings: {
        Row: {
          comment: string | null
          created_at: string
          stars: number
          updated_at: string
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          stars: number
          updated_at?: string
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          stars?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      call_signals: {
        Row: {
          call_id: string
          created_at: string
          from_user: string
          id: string
          kind: string
          payload: Json | null
          to_user: string
        }
        Insert: {
          call_id: string
          created_at?: string
          from_user: string
          id?: string
          kind: string
          payload?: Json | null
          to_user: string
        }
        Update: {
          call_id?: string
          created_at?: string
          from_user?: string
          id?: string
          kind?: string
          payload?: Json | null
          to_user?: string
        }
        Relationships: []
      }
      group_members: {
        Row: {
          group_id: string
          joined_at: string
          role: string
          user_id: string
        }
        Insert: {
          group_id: string
          joined_at?: string
          role?: string
          user_id: string
        }
        Update: {
          group_id?: string
          joined_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          avatar_url: string | null
          created_at: string
          id: string
          invite_token: string
          lock_members_send: boolean
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          id?: string
          invite_token?: string
          lock_members_send?: boolean
          name: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          id?: string
          invite_token?: string
          lock_members_send?: boolean
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachment_type: string | null
          attachment_url: string | null
          content: string | null
          created_at: string
          deleted_for: string[]
          deleted_for_everyone: boolean
          edited_at: string | null
          forwarded_from_id: string | null
          group_id: string | null
          id: string
          is_announcement: boolean
          is_pinned: boolean
          read_at: string | null
          receiver_id: string | null
          reply_to_id: string | null
          sender_id: string
        }
        Insert: {
          attachment_type?: string | null
          attachment_url?: string | null
          content?: string | null
          created_at?: string
          deleted_for?: string[]
          deleted_for_everyone?: boolean
          edited_at?: string | null
          forwarded_from_id?: string | null
          group_id?: string | null
          id?: string
          is_announcement?: boolean
          is_pinned?: boolean
          read_at?: string | null
          receiver_id?: string | null
          reply_to_id?: string | null
          sender_id: string
        }
        Update: {
          attachment_type?: string | null
          attachment_url?: string | null
          content?: string | null
          created_at?: string
          deleted_for?: string[]
          deleted_for_everyone?: boolean
          edited_at?: string | null
          forwarded_from_id?: string | null
          group_id?: string | null
          id?: string
          is_announcement?: boolean
          is_pinned?: boolean
          read_at?: string | null
          receiver_id?: string | null
          reply_to_id?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_forwarded_from_id_fkey"
            columns: ["forwarded_from_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          id: string
          is_scammer: boolean
          is_verified: boolean
          last_seen_at: string
          lock_file: boolean
          lock_image: boolean
          lock_text: boolean
          lock_video: boolean
          lock_voice: boolean
          suspended_until: string | null
          updated_at: string
          username: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          is_scammer?: boolean
          is_verified?: boolean
          last_seen_at?: string
          lock_file?: boolean
          lock_image?: boolean
          lock_text?: boolean
          lock_video?: boolean
          lock_voice?: boolean
          suspended_until?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_scammer?: boolean
          is_verified?: boolean
          last_seen_at?: string
          lock_file?: boolean
          lock_image?: boolean
          lock_text?: boolean
          lock_video?: boolean
          lock_voice?: boolean
          suspended_until?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          created_at: string
          id: string
          reason: string
          reported_user_id: string
          reporter_id: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          subject: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason: string
          reported_user_id: string
          reporter_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string
          reported_user_id?: string
          reporter_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject?: string
        }
        Relationships: []
      }
      user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: []
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
          role: Database["public"]["Enums"]["app_role"]
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
      [_ in never]: never
    }
    Functions: {
      admin_broadcast: { Args: { message: string }; Returns: number }
      admin_delete_message: { Args: { msg_id: string }; Returns: undefined }
      admin_delete_user: { Args: { target: string }; Returns: undefined }
      admin_list_reports: {
        Args: { only_open?: boolean }
        Returns: {
          created_at: string
          id: string
          reason: string
          reported_user_id: string
          reported_username: string
          reporter_id: string
          reporter_username: string
          status: string
          subject: string
        }[]
      }
      admin_list_users: {
        Args: { search_query?: string }
        Returns: {
          avatar_url: string
          created_at: string
          display_name: string
          id: string
          is_scammer: boolean
          is_verified: boolean
          lock_file: boolean
          lock_image: boolean
          lock_text: boolean
          lock_video: boolean
          lock_voice: boolean
          suspended_until: string
          username: string
        }[]
      }
      admin_ratings_chart: { Args: never; Returns: Json }
      admin_recent_messages: {
        Args: { limit_n?: number }
        Returns: {
          attachment_type: string
          content: string
          created_at: string
          deleted_for_everyone: boolean
          id: string
          receiver_id: string
          receiver_username: string
          sender_id: string
          sender_username: string
        }[]
      }
      admin_resolve_report: {
        Args: { new_status?: string; report_id: string }
        Returns: undefined
      }
      admin_set_global_locks: { Args: { locks: Json }; Returns: undefined }
      admin_set_user_flags: {
        Args: {
          p_is_scammer?: boolean
          p_lock_file?: boolean
          p_lock_image?: boolean
          p_lock_text?: boolean
          p_lock_video?: boolean
          p_lock_voice?: boolean
          target: string
        }
        Returns: undefined
      }
      admin_stats: { Args: never; Returns: Json }
      admin_update_user: {
        Args: {
          clear_suspension?: boolean
          new_is_verified?: boolean
          new_suspended_until?: string
          target_user: string
        }
        Returns: undefined
      }
      create_group: {
        Args: { p_avatar?: string; p_members?: string[]; p_name: string }
        Returns: string
      }
      group_join_by_token: { Args: { p_token: string }; Returns: string }
      group_members_list: {
        Args: { p_gid: string }
        Returns: {
          avatar_url: string
          display_name: string
          is_verified: boolean
          role: string
          user_id: string
          username: string
        }[]
      }
      group_regen_invite: { Args: { p_gid: string }; Returns: string }
      group_remove_member: {
        Args: { p_gid: string; p_user: string }
        Returns: undefined
      }
      group_role: { Args: { _gid: string; _uid: string }; Returns: string }
      group_set_role: {
        Args: { p_gid: string; p_role: string; p_user: string }
        Returns: undefined
      }
      group_update_settings: {
        Args: {
          p_avatar?: string
          p_gid: string
          p_lock_members?: boolean
          p_name?: string
        }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_group_member: {
        Args: { _gid: string; _uid: string }
        Returns: boolean
      }
      lookup_profile_by_username: {
        Args: { p_username: string }
        Returns: {
          avatar_url: string
          bio: string
          display_name: string
          id: string
          is_scammer: boolean
          is_verified: boolean
          last_seen_at: string
          username: string
        }[]
      }
      my_groups: {
        Args: never
        Returns: {
          avatar_url: string
          id: string
          last_msg_at: string
          member_count: number
          my_role: string
          name: string
          owner_id: string
        }[]
      }
      rate_app: {
        Args: { p_comment?: string; p_stars: number }
        Returns: undefined
      }
      report_user: {
        Args: { p_reason: string; p_subject: string; reported: string }
        Returns: string
      }
      touch_last_seen: { Args: never; Returns: undefined }
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
