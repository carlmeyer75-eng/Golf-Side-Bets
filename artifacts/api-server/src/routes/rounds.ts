import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  CreateRoundBody,
  CreateRoundResponse,
  DeleteRoundParams,
  GetDashboardSummaryResponse,
  GetRoundParams,
  GetRoundResponse,
  GetRoundSettlementParams,
  GetRoundSettlementResponse,
  ListHoleResultsParams,
  ListHoleResultsResponse,
  ListRoundsResponse,
  RecordHoleBody,
  RecordHoleParams,
  RecordHoleResponse,
  UpdateRoundBody,
  UpdateRoundParams,
  UpdateRoundResponse,
} from "@workspace/api-zod";
import { db, holeResultsTable, roundsTable } from "@workspace/db";

const router: IRouter = Router();

type Player = { id: string; name: string; initials: string };
type Score = { playerId: string; strokes: number };

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function playerId(name: string, index: number) {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "player"}-${index + 1}`;
}

function toPlayerList(players: { name: string }[]): Player[] {
  return players.map((player, index) => ({
    id: playerId(player.name, index),
    name: player.name.trim(),
    initials: initials(player.name),
  }));
}

function normalizeRound(round: typeof roundsTable.$inferSelect, holes: typeof holeResultsTable.$inferSelect[]) {
  const players = round.players as Player[];
  const balances = new Map(players.map((player) => [player.id, 0]));
  const stake = Number(round.stake);

  for (const hole of holes) {
    const scores = hole.scores as Score[];
    const winnerId =
      hole.winnerPlayerId ??
      scores.slice().sort((a, b) => a.strokes - b.strokes)[0]?.playerId;
    if (!winnerId || !balances.has(winnerId)) continue;
    const perGame = stake * (players.length - 1);
    const gameCount = (round.gameTypes as string[]).length;
    const winAmount = perGame * gameCount;
    for (const player of players) {
      balances.set(
        player.id,
        (balances.get(player.id) ?? 0) + (player.id === winnerId ? winAmount : -stake * gameCount),
      );
    }
  }

  const settlement = {
    balances: players.map((player) => ({
      playerId: player.id,
      playerName: player.name,
      amount: Number((balances.get(player.id) ?? 0).toFixed(2)),
    })),
    holesRecorded: holes.length,
    totalPot: Number((stake * players.length * (round.gameTypes as string[]).length).toFixed(2)),
  };

  return {
    id: round.id,
    name: round.name,
    course: round.course,
    playedAt: round.playedAt,
    status: round.status as "in_progress" | "completed",
    gameTypes: round.gameTypes as ("wolf" | "nassau")[],
    stake,
    currentHole: holes.reduce((max, hole) => Math.max(max, hole.hole), 0),
    players,
    holes: holes.map((hole) => ({
      hole: hole.hole,
      scores: hole.scores as Score[],
      wolfPlayerId: hole.wolfPlayerId,
      winnerPlayerId: hole.winnerPlayerId,
      id: hole.id,
      createdAt: hole.createdAt.toISOString(),
    })),
    settlement,
  };
}

async function findRound(roundId: number) {
  const [round] = await db.select().from(roundsTable).where(eq(roundsTable.id, roundId));
  if (!round) return null;
  const holes = await db
    .select()
    .from(holeResultsTable)
    .where(eq(holeResultsTable.roundId, roundId))
    .orderBy(holeResultsTable.hole);
  return { round, holes };
}

router.get("/rounds", async (_req, res) => {
  const rounds = await db.select().from(roundsTable).orderBy(desc(roundsTable.createdAt));
  const result = await Promise.all(
    rounds.map(async (round) => {
      const holes = await db.select().from(holeResultsTable).where(eq(holeResultsTable.roundId, round.id));
      const detail = normalizeRound(round, holes);
      return {
        id: detail.id,
        name: detail.name,
        course: detail.course,
        playedAt: detail.playedAt,
        status: detail.status,
        gameTypes: detail.gameTypes,
        stake: detail.stake,
        currentHole: detail.currentHole,
        players: detail.players,
      };
    }),
  );
  res.json(ListRoundsResponse.parse(result));
});

router.post("/rounds", async (req, res) => {
  const body = CreateRoundBody.parse(req.body);
  const players = toPlayerList(body.players);
  const [round] = await db
    .insert(roundsTable)
    .values({
      name: body.name.trim(),
      course: body.course.trim(),
      playedAt: body.playedAt,
      status: "in_progress",
      gameTypes: body.gameTypes,
      stake: body.stake.toFixed(2),
      players,
    })
    .returning();
  const result = normalizeRound(round, []);
  res.status(201).json(CreateRoundResponse.parse(result));
});

router.get("/rounds/:roundId", async (req, res) => {
  const { roundId } = GetRoundParams.parse(req.params);
  const found = await findRound(roundId);
  if (!found) return res.status(404).json({ error: "Round not found" });
  return res.json(GetRoundResponse.parse(normalizeRound(found.round, found.holes)));
});

router.patch("/rounds/:roundId", async (req, res) => {
  const { roundId } = UpdateRoundParams.parse(req.params);
  const body = UpdateRoundBody.parse(req.body);
  const [round] = await db
    .update(roundsTable)
    .set(body)
    .where(eq(roundsTable.id, roundId))
    .returning();
  if (!round) return res.status(404).json({ error: "Round not found" });
  const found = await findRound(roundId);
  return res.json(UpdateRoundResponse.parse(normalizeRound(round, found?.holes ?? [])));
});

router.delete("/rounds/:roundId", async (req, res) => {
  const { roundId } = DeleteRoundParams.parse(req.params);
  const [deleted] = await db.delete(roundsTable).where(eq(roundsTable.id, roundId)).returning({ id: roundsTable.id });
  if (!deleted) return res.status(404).json({ error: "Round not found" });
  return res.status(204).send();
});

router.post("/rounds/:roundId/holes", async (req, res) => {
  const { roundId } = RecordHoleParams.parse(req.params);
  const body = RecordHoleBody.parse(req.body);
  const found = await findRound(roundId);
  if (!found) return res.status(404).json({ error: "Round not found" });
  const validPlayers = new Set((found.round.players as Player[]).map((player) => player.id));
  if (body.scores.some((score) => !validPlayers.has(score.playerId))) {
    return res.status(400).json({ error: "Scores must belong to round players" });
  }
  const [hole] = await db
    .insert(holeResultsTable)
    .values({
      roundId,
      hole: body.hole,
      scores: body.scores,
      wolfPlayerId: body.wolfPlayerId ?? null,
      winnerPlayerId: body.winnerPlayerId ?? null,
    })
    .returning();
  return res.status(201).json(RecordHoleResponse.parse({
    hole: hole.hole,
    scores: hole.scores,
    wolfPlayerId: hole.wolfPlayerId,
    winnerPlayerId: hole.winnerPlayerId,
    id: hole.id,
    createdAt: hole.createdAt.toISOString(),
  }));
});

router.get("/rounds/:roundId/holes", async (req, res) => {
  const { roundId } = ListHoleResultsParams.parse(req.params);
  const found = await findRound(roundId);
  if (!found) return res.status(404).json({ error: "Round not found" });
  const result = found.holes.map((hole) => ({
    hole: hole.hole,
    scores: hole.scores,
    wolfPlayerId: hole.wolfPlayerId,
    winnerPlayerId: hole.winnerPlayerId,
    id: hole.id,
    createdAt: hole.createdAt.toISOString(),
  }));
  return res.json(ListHoleResultsResponse.parse(result));
});

router.get("/rounds/:roundId/settlement", async (req, res) => {
  const { roundId } = GetRoundSettlementParams.parse(req.params);
  const found = await findRound(roundId);
  if (!found) return res.status(404).json({ error: "Round not found" });
  return res.json(GetRoundSettlementResponse.parse(normalizeRound(found.round, found.holes).settlement));
});

router.get("/dashboard/summary", async (_req, res) => {
  const rounds = await db.select().from(roundsTable).orderBy(desc(roundsTable.createdAt));
  const holeCounts = await Promise.all(
    rounds.map((round) => db.select().from(holeResultsTable).where(eq(holeResultsTable.roundId, round.id))),
  );
  const latest = rounds[0];
  const latestRound = latest
    ? (() => {
        const players = latest.players as Player[];
        return {
          id: latest.id,
          name: latest.name,
          course: latest.course,
          playedAt: latest.playedAt,
          status: latest.status as "in_progress" | "completed",
          gameTypes: latest.gameTypes as ("wolf" | "nassau")[],
          stake: Number(latest.stake),
          currentHole: holeCounts[0]?.reduce((max, hole) => Math.max(max, hole.hole), 0) ?? 0,
          players,
        };
      })()
    : null;
  res.json(GetDashboardSummaryResponse.parse({
    totalRounds: rounds.length,
    activeRounds: rounds.filter((round) => round.status === "in_progress").length,
    totalHolesRecorded: holeCounts.reduce((sum, holes) => sum + holes.length, 0),
    latestRound,
  }));
});

export default router;