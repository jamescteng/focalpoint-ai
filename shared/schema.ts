import { pgTable, serial, text, timestamp, jsonb, varchar, integer, bigint, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export interface PersonaAlias {
  personaId: string;
  name: string;
  role: string;
}

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  synopsis: text("synopsis").notNull(),
  questions: jsonb("questions").$type<string[]>().notNull().default([]),
  language: varchar("language", { length: 10 }).notNull().default("en"),
  fileUri: text("file_uri"),
  fileMimeType: text("file_mime_type"),
  fileName: text("file_name"),
  fileSize: bigint("file_size", { mode: "number" }),
  fileLastModified: bigint("file_last_modified", { mode: "number" }),
  youtubeUrl: text("youtube_url"),
  youtubeEmbeddable: boolean("youtube_embeddable"),
  personaAliases: jsonb("persona_aliases").$type<PersonaAlias[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").references(() => sessions.id, { onDelete: "cascade" }).notNull(),
  personaId: varchar("persona_id", { length: 50 }).notNull(),
  executiveSummary: text("executive_summary").notNull(),
  highlights: jsonb("highlights").$type<any[]>().notNull().default([]),
  concerns: jsonb("concerns").$type<any[]>().notNull().default([]),
  answers: jsonb("answers").$type<any[]>().notNull().default([]),
  validationWarnings: jsonb("validation_warnings").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sessionsRelations = relations(sessions, ({ many }) => ({
  reports: many(reports),
}));

export const reportsRelations = relations(reports, ({ one }) => ({
  session: one(sessions, {
    fields: [reports.sessionId],
    references: [sessions.id],
  }),
}));

export const voiceScripts = pgTable("voice_scripts", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").references(() => sessions.id, { onDelete: "cascade" }).notNull(),
  personaId: varchar("persona_id", { length: 50 }).notNull(),
  reportHash: varchar("report_hash", { length: 64 }).notNull(),
  language: varchar("language", { length: 10 }).notNull(),
  scriptJson: jsonb("script_json").$type<VoiceReportScript>().notNull(),
  audioUrl: text("audio_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const voiceScriptsRelations = relations(voiceScripts, ({ one }) => ({
  session: one(sessions, {
    fields: [voiceScripts.sessionId],
    references: [sessions.id],
  }),
}));

export interface VoiceReportScript {
  version: "1.0";
  language: "en" | "zh-TW";
  persona: {
    personaId: string;
    name: string;
    role: string;
  };
  runtimeTargetSeconds: number;
  sections: Array<{
    sectionId: "OPEN" | "HIGHLIGHTS" | "CONCERNS" | "OBJECTIVES" | "CLOSE";
    lines: Array<{
      text: string;
      refs?: Array<{
        type: "highlight" | "concern" | "answer" | "summary";
        index?: number;
        timestamp?: string;
        seconds?: number;
      }>;
    }>;
  }>;
  coverage: {
    highlights: boolean[];
    concerns: boolean[];
    answers: boolean[];
    timestampsUsed: string[];
    wordCount: number;
  };
}

export interface DialogueScript {
  version: "1.0";
  sessionId: number;
  language: "en" | "zh-TW";
  participants: Array<{
    personaId: string;
    displayName: string;
    role: string;
    voiceId: string;
  }>;
  runtimeTargetSec: number;
  turns: Array<{
    speakerPersonaId: string;
    text: string;
    refs?: Array<{
      personaId: string;
      type: "highlight" | "concern" | "answer" | "summary";
      index?: number;
      timestamp?: string;
      seconds?: number;
    }>;
    audioTag?: string;
  }>;
  coverage: {
    byPersona: Record<string, { highlights: boolean[]; concerns: boolean[]; answers: boolean[] }>;
  };
}

export const analysisJobs = pgTable("analysis_jobs", {
  id: serial("id").primaryKey(),
  jobId: varchar("job_id", { length: 64 }).notNull().unique(),
  sessionId: integer("session_id").references(() => sessions.id, { onDelete: "cascade" }).notNull(),
  personaId: varchar("persona_id", { length: 50 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  result: jsonb("result").$type<any>(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const analysisJobsRelations = relations(analysisJobs, ({ one }) => ({
  session: one(sessions, {
    fields: [analysisJobs.sessionId],
    references: [sessions.id],
  }),
}));

export const dialogueJobs = pgTable("dialogue_jobs", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").references(() => sessions.id, { onDelete: "cascade" }).notNull(),
  personaA: varchar("persona_a", { length: 50 }).notNull(),
  personaB: varchar("persona_b", { length: 50 }).notNull(),
  language: varchar("language", { length: 10 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("queued"),
  scriptJson: jsonb("script_json").$type<DialogueScript>(),
  audioStorageKey: text("audio_storage_key"),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const dialogueJobsRelations = relations(dialogueJobs, ({ one }) => ({
  session: one(sessions, {
    fields: [dialogueJobs.sessionId],
    references: [sessions.id],
  }),
}));

// Upload tracking for direct-to-storage uploads
// Status flow: UPLOADING → STORED → COMPRESSING → COMPRESSED → TRANSFERRING_TO_GEMINI → ACTIVE (or FAILED)
export const uploads = pgTable("uploads", {
  id: serial("id").primaryKey(),
  uploadId: varchar("upload_id", { length: 64 }).notNull().unique(),
  sessionId: integer("session_id").references(() => sessions.id, { onDelete: "cascade" }),
  attemptId: varchar("attempt_id", { length: 64 }).notNull(),
  filename: text("filename").notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  storageKey: text("storage_key").notNull(),
  proxyStorageKey: text("proxy_storage_key"),
  proxySizeBytes: bigint("proxy_size_bytes", { mode: "number" }),
  status: varchar("status", { length: 30 }).notNull().default("UPLOADING"),
  geminiFileUri: text("gemini_file_uri"),
  cacheName: text("cache_name"),
  cacheModel: varchar("cache_model", { length: 50 }),
  cacheStatus: varchar("cache_status", { length: 20 }).default("NONE"),
  cacheExpiresAt: timestamp("cache_expires_at"),
  progress: jsonb("progress").$type<{ stage: string; pct: number; message?: string }>().default({ stage: "uploading", pct: 0 }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const uploadsRelations = relations(uploads, ({ one }) => ({
  session: one(sessions, {
    fields: [uploads.sessionId],
    references: [sessions.id],
  }),
}));

export type Upload = typeof uploads.$inferSelect;
export type InsertUpload = typeof uploads.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type InsertSession = typeof sessions.$inferInsert;
export type Report = typeof reports.$inferSelect;
export type InsertReport = typeof reports.$inferInsert;
export type VoiceScript = typeof voiceScripts.$inferSelect;
export type InsertVoiceScript = typeof voiceScripts.$inferInsert;
export type DialogueJob = typeof dialogueJobs.$inferSelect;
export type InsertDialogueJob = typeof dialogueJobs.$inferInsert;
export type AnalysisJob = typeof analysisJobs.$inferSelect;
export type InsertAnalysisJob = typeof analysisJobs.$inferInsert;
