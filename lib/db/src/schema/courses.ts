import { createInsertSchema } from "drizzle-zod";
import { jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export type CourseHole = {
  hole: number;
  par: number;
  strokeIndex: number;
};

export type CourseSource = "manual" | "upload" | "external";

export const coursesTable = pgTable("golf_courses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location").notNull().default(""),
  holes: jsonb("holes").$type<CourseHole[]>().notNull(),
  source: text("source").notNull().default("manual"),
  sourceDocumentName: text("source_document_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertCourseSchema = createInsertSchema(coursesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Course = typeof coursesTable.$inferSelect;
export type InsertCourse = z.infer<typeof insertCourseSchema>;