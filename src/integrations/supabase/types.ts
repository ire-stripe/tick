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
      article_email_copy_events: {
        Row: {
          article_id: string
          created_at: string
          draft_id: string | null
          id: string
        }
        Insert: {
          article_id: string
          created_at?: string
          draft_id?: string | null
          id?: string
        }
        Update: {
          article_id?: string
          created_at?: string
          draft_id?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_email_copy_events_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_email_copy_events_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "article_email_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      article_email_drafts: {
        Row: {
          article_id: string
          body: string
          created_at: string
          id: string
          prompt_version: string
          subject: string
        }
        Insert: {
          article_id: string
          body: string
          created_at?: string
          id?: string
          prompt_version?: string
          subject: string
        }
        Update: {
          article_id?: string
          body?: string
          created_at?: string
          id?: string
          prompt_version?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_email_drafts_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      articles: {
        Row: {
          article_audio_url: string | null
          created_at: string
          full_text: string | null
          global_ticker: boolean
          id: string
          is_breaking: boolean
          is_in_brief: boolean
          language: string
          proof_point_text: string | null
          published_at: string
          region: string
          source: string
          spoken_summary: string | null
          stripe_play: string | null
          stripe_products: string[] | null
          success_story_id: string | null
          summary: string | null
          target_industries: string[]
          ticker_source: boolean
          title: string
          url: string
        }
        Insert: {
          article_audio_url?: string | null
          created_at?: string
          full_text?: string | null
          global_ticker?: boolean
          id?: string
          is_breaking?: boolean
          is_in_brief?: boolean
          language?: string
          proof_point_text?: string | null
          published_at?: string
          region: string
          source: string
          spoken_summary?: string | null
          stripe_play?: string | null
          stripe_products?: string[] | null
          success_story_id?: string | null
          summary?: string | null
          target_industries?: string[]
          ticker_source?: boolean
          title: string
          url: string
        }
        Update: {
          article_audio_url?: string | null
          created_at?: string
          full_text?: string | null
          global_ticker?: boolean
          id?: string
          is_breaking?: boolean
          is_in_brief?: boolean
          language?: string
          proof_point_text?: string | null
          published_at?: string
          region?: string
          source?: string
          spoken_summary?: string | null
          stripe_play?: string | null
          stripe_products?: string[] | null
          success_story_id?: string | null
          summary?: string | null
          target_industries?: string[]
          ticker_source?: boolean
          title?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "articles_success_story_id_fkey"
            columns: ["success_story_id"]
            isOneToOne: false
            referencedRelation: "success_stories"
            referencedColumns: ["id"]
          },
        ]
      }
      episodes: {
        Row: {
          audio_url: string | null
          created_at: string
          date: string
          duration_seconds: number | null
          id: string
          language_code: string
          male_audio_url: string | null
          region: string
          script: string | null
        }
        Insert: {
          audio_url?: string | null
          created_at?: string
          date?: string
          duration_seconds?: number | null
          id?: string
          language_code?: string
          male_audio_url?: string | null
          region: string
          script?: string | null
        }
        Update: {
          audio_url?: string | null
          created_at?: string
          date?: string
          duration_seconds?: number | null
          id?: string
          language_code?: string
          male_audio_url?: string | null
          region?: string
          script?: string | null
        }
        Relationships: []
      }
      feedback: {
        Row: {
          created_at: string
          id: string
          suggestion: string
        }
        Insert: {
          created_at?: string
          id?: string
          suggestion: string
        }
        Update: {
          created_at?: string
          id?: string
          suggestion?: string
        }
        Relationships: []
      }
      stripe_products: {
        Row: {
          availability_phase: string
          category: string
          created_at: string
          description: string
          id: string
          is_roadmap: boolean
          name: string
          pitch_angle: string
          region_relevance: string[]
          target_personas: string[]
          use_cases: string[]
        }
        Insert: {
          availability_phase?: string
          category: string
          created_at?: string
          description: string
          id: string
          is_roadmap?: boolean
          name: string
          pitch_angle?: string
          region_relevance?: string[]
          target_personas?: string[]
          use_cases?: string[]
        }
        Update: {
          availability_phase?: string
          category?: string
          created_at?: string
          description?: string
          id?: string
          is_roadmap?: boolean
          name?: string
          pitch_angle?: string
          region_relevance?: string[]
          target_personas?: string[]
          use_cases?: string[]
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          active: boolean
          created_at: string
          id: string
          region: string
          slack_user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          region: string
          slack_user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          region?: string
          slack_user_id?: string
        }
        Relationships: []
      }
      success_stories: {
        Row: {
          company: string
          created_at: string
          id: string
          industry: string
          metric: string
          products: string[]
          region: string
          summary: string
          url: string
        }
        Insert: {
          company: string
          created_at?: string
          id?: string
          industry: string
          metric?: string
          products?: string[]
          region: string
          summary: string
          url: string
        }
        Update: {
          company?: string
          created_at?: string
          id?: string
          industry?: string
          metric?: string
          products?: string[]
          region?: string
          summary?: string
          url?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
