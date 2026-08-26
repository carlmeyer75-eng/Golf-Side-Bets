import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, roundsTable } from "@workspace/db";
import app from "../app";

// Regression test: rounds saved before `handicap`/`snakeThreshold` existed on player JSON only
// have `{ id, name, initials }` per player. Since `players` is a single JSONB blob, adding new
// columns elsewhere never backfills those nested keys — the API must still normalize and serve
// these legacy rows instead of failing response validation.
describe("legacy round without handicap/snakeThreshold on players", () => {
  let legacyRoundId: number;

  it("creates a legacy-shaped round directly in the database", async () => {
    const [round] = await db
      .insert(roundsTable)
      .values({
        name: "Legacy Round",
        course: "Old Course",
        playedAt: "2024-01-01",
        status: "in_progress",
        gameTypes: ["nassau"],
        stake: "5.00",
        // Cast through unknown: intentionally omits handicap/snakeThreshold to mimic pre-migration data.
        players: [
          { id: "legacy-1", name: "Legacy One", initials: "LO" },
          { id: "legacy-2", name: "Legacy Two", initials: "LT" },
        ] as unknown as { id: string; name: string; initials: string; handicap: number; snakeThreshold: number | null }[],
      })
      .returning();
    legacyRoundId = round.id;
  });

  it("serves the legacy round in the list endpoint with normalized player fields", async () => {
    const res = await request(app).get("/api/rounds");
    expect(res.status).toBe(200);
    const found = res.body.find((r: { id: number }) => r.id === legacyRoundId);
    expect(found).toBeTruthy();
    expect(found.players[0].handicap).toBe(0);
    expect(found.players[0].snakeThreshold).toBeNull();
  });

  it("serves the legacy round detail endpoint", async () => {
    const res = await request(app).get(`/api/rounds/${legacyRoundId}`);
    expect(res.status).toBe(200);
    expect(res.body.players.every((p: { handicap: number }) => typeof p.handicap === "number")).toBe(true);
    expect(res.body.settlement.balances).toHaveLength(2);
  });

  it("includes the legacy round in the dashboard summary without failing validation", async () => {
    const res = await request(app).get("/api/dashboard/summary");
    expect(res.status).toBe(200);
    expect(res.body.totalRounds).toBeGreaterThanOrEqual(1);
  });

  afterAll(async () => {
    await db.delete(roundsTable).where(eq(roundsTable.id, legacyRoundId));
  });
});
