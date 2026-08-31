import { createInsertSchema } from "drizzle-zod";
import { integer, jsonb, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export type PlayerRecord = {
  id: string;
  name: string;
  initials: string;
  handicap: number;
  snakeThreshold: number | null;
};

export type Score = { playerId: string; strokes: number };
export type Putt = { playerId: string; putts: number };
export type DotFlags = { playerId: string; greenie?: boolean; sandy?: boolean; poley?: boolean };
export type DotPoints = {
  greenie: number;
  sandy: number;
  birdie: number;
  eagle: number;
  poley: number;
  threeputt: number;
};

export const DEFAULT_DOT_POINTS: DotPoints = {
  greenie: 1,
  sandy: 1,
  birdie: 1,
  eagle: 2,
  poley: 1,
  threeputt: 1,
};

export const DEFAULT_HOLE_PARS: number[] = Array.from({ length: 18 }, () => 4);
export const DEFAULT_HOLE_STROKE_INDEX: number[] = Array.from({ length: 18 }, (_, index) => index + 1);

export const roundsTable = pgTable("golf_rounds", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  course: text("course").notNull(),
  playedAt: text("played_at").notNull(),
  status: text("status").notNull().default("in_progress"),
  gameTypes: jsonb("game_types").$type<string[]>().notNull(),
  stake: numeric("stake", { precision: 10, scale: 2 }).notNull(),
  dollarPerPoint: numeric("dollar_per_point", { precision: 10, scale: 2 }).notNull().default("0"),
  wolfUnit: numeric("wolf_unit", { precision: 10, scale: 2 }).notNull().default("1"),
  snakeStake: numeric("snake_stake", { precision: 10, scale: 2 }).notNull().default("1"),
  dotPoints: jsonb("dot_points").$type<DotPoints>().notNull().default(DEFAULT_DOT_POINTS),
  holePars: jsonb("hole_pars").$type<number[]>().notNull().default(DEFAULT_HOLE_PARS),
  holeStrokeIndex: jsonb("hole_stroke_index").$type<number[]>().notNull().default(DEFAULT_HOLE_STROKE_INDEX),
  players: jsonb("players").$type<PlayerRecord[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const holeResultsTable = pgTable("golf_hole_results", {
  id: serial("id").primaryKey(),
  roundId: integer("round_id").notNull().references(() => roundsTable.id, { onDelete: "cascade" }),
  hole: integer("hole").notNull(),
  scores: jsonb("scores").$type<Score[]>().notNull(),
  putts: jsonb("putts").$type<Putt[]>().notNull().default([]),
  wolfPartnerIds: jsonb("wolf_partner_ids").$type<string[]>().notNull().default([]),
  wolfOverridePlayerId: text("wolf_override_player_id"),
  wolfManualResult: text("wolf_manual_result"),
  dots: jsonb("dots").$type<DotFlags[]>().notNull().default([]),
  winnerPlayerId: text("winner_player_id"),
  snakeHolderPlayerId: text("snake_holder_player_id"),
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
