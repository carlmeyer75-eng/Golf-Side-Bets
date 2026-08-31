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
        gameTypes: ["wolf", "snake", "dots"],
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

  it("persists a host-selected Snake holder and uses it in settlement", async () => {
    const selectedHolderId = playerIds[1];
    const res = await request(app)
      .post(`/api/rounds/${roundId}/holes`)
      .send({
        hole: 2,
        scores: playerIds.map((id) => ({ playerId: id, strokes: 4 })),
        putts: [
          { playerId: playerIds[0], putts: 3 },
          { playerId: playerIds[1], putts: 3 },
          { playerId: playerIds[2], putts: 2 },
        ],
        snakeHolderPlayerId: selectedHolderId,
      });

    expect(res.status).toBe(201);
    expect(res.body.snakeTiePlayerIds).toEqual([playerIds[0], playerIds[1]]);
    expect(res.body.snakeHolderPlayerId).toBe(selectedHolderId);

    const holesRes = await request(app).get(`/api/rounds/${roundId}/holes`);
    const tiedHole = holesRes.body.find((hole: { hole: number }) => hole.hole === 2);
    expect(tiedHole.snakeHolderPlayerId).toBe(selectedHolderId);

    const settlementRes = await request(app).get(`/api/rounds/${roundId}/settlement`);
    expect(settlementRes.body.snakeHolderPlayerId).toBe(selectedHolderId);
  });

  it("persists custom point values and pars and uses them in settlement", async () => {
    const holePars = Array.from({ length: 18 }, (_, index) => (index === 2 ? 5 : 4));
    const dotPoints = { greenie: 0, sandy: 0, birdie: 4, eagle: 8, poley: 0, threeputt: 0 };
    const updateRes = await request(app)
      .patch(`/api/rounds/${roundId}`)
      .send({
        dollarPerPoint: 1.5,
        wolfUnit: 2,
        snakeStake: 3,
        dotPoints,
        holePars,
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.wolfUnit).toBe(2);
    expect(updateRes.body.snakeStake).toBe(3);
    expect(updateRes.body.dotPoints).toEqual(dotPoints);
    expect(updateRes.body.holePars).toEqual(holePars);

    const holeRes = await request(app)
      .post(`/api/rounds/${roundId}/holes`)
      .send({
        hole: 3,
        scores: [
          { playerId: playerIds[0], strokes: 4 },
          { playerId: playerIds[1], strokes: 5 },
          { playerId: playerIds[2], strokes: 3 },
        ],
        putts: [
          { playerId: playerIds[0], putts: 3 },
          { playerId: playerIds[1], putts: 2 },
          { playerId: playerIds[2], putts: 2 },
        ],
      });

    expect(holeRes.status).toBe(201);
    const settlementRes = await request(app).get(`/api/rounds/${roundId}/settlement`);
    const pointTotals = new Map(
      settlementRes.body.pointTotals.map((row: { playerId: string; wolfPoints: number; dotsPoints: number; snakePoints: number }) => [
        row.playerId,
        row,
      ]),
    );
    expect(pointTotals.get(playerIds[0])).toMatchObject({ dotsPoints: 4, snakePoints: 0 });
    expect(pointTotals.get(playerIds[1])).toMatchObject({ dotsPoints: 0, snakePoints: 3 });
    expect(pointTotals.get(playerIds[2])).toMatchObject({ wolfPoints: 12, dotsPoints: 8, snakePoints: 3 });
    expect(settlementRes.body.payouts.some((payout: { amount: number }) => payout.amount > 0)).toBe(true);

    const getRes = await request(app).get(`/api/rounds/${roundId}`);
    expect(getRes.body.holePars[2]).toBe(5);
    expect(getRes.body.wolfUnit).toBe(2);
  });

  afterAll(async () => {
    await db.delete(roundsTable).where(eq(roundsTable.id, roundId));
  });
});
