import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, roundsTable } from "@workspace/db";
import app from "../app";

describe("hole payload validation", () => {
  let roundId: number;
  let playerIds: string[];

  it("creates a round to record holes against", async () => {
    const res = await request(app)
      .post("/api/rounds")
      .send({
        name: "Validation Round",
        course: "Test Course",
        playedAt: "2026-08-26",
        gameTypes: ["wolf"],
        stake: 1,
        players: [{ name: "Ann" }, { name: "Ben" }, { name: "Cal" }],
      });
    expect(res.status).toBe(201);
    roundId = res.body.id;
    playerIds = res.body.players.map((p: { id: string }) => p.id);
  });

  it("rejects duplicate wolf partner ids", async () => {
    const res = await request(app)
      .post(`/api/rounds/${roundId}/holes`)
      .send({
        hole: 1,
        scores: playerIds.map((id) => ({ playerId: id, strokes: 4 })),
        wolfPartnerIds: [playerIds[1], playerIds[1]],
      });
    expect(res.status).toBe(400);
  });

  it("rejects the wolf listing themselves as their own partner", async () => {
    const res = await request(app)
      .post(`/api/rounds/${roundId}/holes`)
      .send({
        hole: 1,
        scores: playerIds.map((id) => ({ playerId: id, strokes: 4 })),
        wolfOverridePlayerId: playerIds[0],
        wolfPartnerIds: [playerIds[0]],
      });
    expect(res.status).toBe(400);
  });

  it("rejects an incomplete score list", async () => {
    const res = await request(app)
      .post(`/api/rounds/${roundId}/holes`)
      .send({
        hole: 1,
        scores: [{ playerId: playerIds[0], strokes: 4 }],
      });
    expect(res.status).toBe(400);
  });

  it("rejects duplicate scores for the same player", async () => {
    const res = await request(app)
      .post(`/api/rounds/${roundId}/holes`)
      .send({
        hole: 1,
        scores: [
          { playerId: playerIds[0], strokes: 4 },
          { playerId: playerIds[0], strokes: 5 },
          { playerId: playerIds[1], strokes: 4 },
        ],
      });
    expect(res.status).toBe(400);
  });

  it("returns a clean 400 JSON error for a schema-invalid payload instead of a 500 HTML page", async () => {
    const res = await request(app)
      .post(`/api/rounds/${roundId}/holes`)
      .send({ hole: 1, scores: [{ playerId: playerIds[0], strokes: 4 }] });
    expect(res.status).toBe(400);
    expect(res.type).toContain("json");
  });

  it("accepts a valid, complete hole payload", async () => {
    const res = await request(app)
      .post(`/api/rounds/${roundId}/holes`)
      .send({
        hole: 1,
        scores: playerIds.map((id) => ({ playerId: id, strokes: 4 })),
        wolfPartnerIds: [playerIds[1]],
      });
    expect(res.status).toBe(201);
  });

  afterAll(async () => {
    await db.delete(roundsTable).where(eq(roundsTable.id, roundId));
  });
});
