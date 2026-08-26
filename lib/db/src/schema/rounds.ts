import { createInsertSchema } from "drizzle-zod";
import { integer, jsonb, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const roundsTable = pgTable("golf_rounds", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  course: text("course").notNull(),
  playedAt: text("played_at").notNull(),
  status: text("status").notNull().default("in_progress"),
  gameTypes: jsonb("game_types").$type<string[]>().notNull(),
  stake: numeric("stake", { precision: 10, scale: 2 }).notNull(),
  players: jsonb("players").$type<{ id: string; name: string; initials: string }[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const holeResultsTable = pgTable("golf_hole_results", {
  id: serial("id").primaryKey(),
  roundId: integer("round_id").notNull().references(() => roundsTable.id, { onDelete: "cascade" }),
  hole: integer("hole").notNull(),
  scores: jsonb("scores").$type<{ playerId: string; strokes: number }[]>().notNull(),
  wolfPlayerId: text("wolf_player_id"),
  winnerPlayerId: text("winner_player_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertRoundSchema = createInsertSchema(roundsTable).omit({
  id: true,
  createdAt: true,
});

export const insertHoleResultSchema = createInsertSchema(holeResultsTable).omit({
  id: true,
  createdAt: true,
});

export type Round = typeof roundsTable.$inferSelect;
export type InsertRound = z.infer<typeof insertRoundSchema>;
export type HoleResult = typeof holeResultsTable.$inferSelect;
export type InsertHoleResult = z.infer<typeof insertHoleResultSchema>;