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
import {
  db,
  holeResultsTable,
  roundsTable,
  DEFAULT_DOT_POINTS,
  DEFAULT_HOLE_PARS,
  DEFAULT_HOLE_STROKE_INDEX,
  type DotPoints,
  type PlayerRecord,
} from "@workspace/db";
import { computeRound, type HoleRow, type RoundSettings } from "../lib/golf-rules";

const router: IRouter = Router();

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

function toPlayerList(players: { name: string; handicap?: number; snakeThreshold?: number | null }[]): PlayerRecord[] {
  return players.map((player, index) => ({
    id: playerId(player.name, index),
    name: player.name.trim(),
    initials: initials(player.name),
    handicap: player.handicap ?? 0,
    snakeThreshold: player.snakeThreshold ?? null,
  }));
}

/**
 * Fills defaults for player fields that may be missing from JSONB rows saved before handicap/
 * snake-threshold existed. Postgres backfills new *columns* automatically, but `players` is a
 * single JSONB blob, so older nested objects never gain new keys on their own — this keeps
 * legacy rounds loadable instead of failing API response validation.
 */
function normalizePlayers(players: Partial<PlayerRecord>[] | null | undefined): PlayerRecord[] {
  return (players ?? []).map((player) => ({
    id: player.id ?? "",
    name: player.name ?? "",
    initials: player.initials ?? "",
    handicap: player.handicap ?? 0,
    snakeThreshold: player.snakeThreshold ?? null,
  }));
}

function toRoundSettings(round: typeof roundsTable.$inferSelect): RoundSettings {
  return {
    players: normalizePlayers(round.players as PlayerRecord[]),
    gameTypes: round.gameTypes as string[],
    stake: Number(round.stake),
    dollarPerPoint: Number(round.dollarPerPoint),
    wolfUnit: Number(round.wolfUnit),
    snakeStake: Number(round.snakeStake),
    dotPoints: round.dotPoints as DotPoints,
    holePars: round.holePars as number[],
    holeStrokeIndex: round.holeStrokeIndex as number[],
  };
}

function toHoleRow(hole: typeof holeResultsTable.$inferSelect): HoleRow {
  return {
    hole: hole.hole,
    scores: (hole.scores as HoleRow["scores"]) ?? [],
    putts: (hole.putts as HoleRow["putts"]) ?? [],
    wolfPartnerIds: (hole.wolfPartnerIds as string[]) ?? [],
    wolfOverridePlayerId: hole.wolfOverridePlayerId ?? null,
    wolfManualResult: (hole.wolfManualResult as HoleRow["wolfManualResult"]) ?? null,
    dots: (hole.dots as HoleRow["dots"]) ?? [],
    winnerPlayerId: hole.winnerPlayerId ?? null,
  };
}

function serializeHole(hole: typeof holeResultsTable.$inferSelect, computation: ReturnType<typeof computeRound>) {
  const computed = computation.perHole.get(hole.hole);
  return {
    hole: hole.hole,
    scores: hole.scores,
    putts: hole.putts,
    wolfPartnerIds: hole.wolfPartnerIds,
    wolfOverridePlayerId: hole.wolfOverridePlayerId,
    wolfManualResult: hole.wolfManualResult,
    dots: hole.dots,
    winnerPlayerId: hole.winnerPlayerId,
    id: hole.id,
    createdAt: hole.createdAt.toISOString(),
    effectiveWolfPlayerId: computed?.effectiveWolfPlayerId ?? null,
    wolfTeamPlayerIds: computed?.wolfTeamPlayerIds ?? [],
    wolfResult: computed?.wolfResult ?? null,
    wolfCarry: computed?.wolfCarry ?? 1,
    snakeHolderPlayerId: computed?.snakeHolderPlayerId ?? null,
    dotsEarned: computed?.dotsEarned ?? [],
  };
}

function normalizeRound(round: typeof roundsTable.$inferSelect, holes: typeof holeResultsTable.$inferSelect[]) {
  const settings = toRoundSettings(round);
  const players = settings.players;
  const computation = computeRound(settings, holes.map(toHoleRow));

  const settlement = {
    balances: computation.balances,
    payouts: computation.payouts,
    pointTotals: computation.pointTotals,
    snakeHolderPlayerId: computation.snakeHolderPlayerId,
    holesRecorded: holes.length,
    totalPot: Number((settings.stake * players.length).toFixed(2)),
  };

  return {
    id: round.id,
    name: round.name,
    course: round.course,
    playedAt: round.playedAt,
    status: round.status as "in_progress" | "completed",
    gameTypes: round.gameTypes as ("wolf" | "nassau" | "snake" | "dots")[],
    stake: settings.stake,
    dollarPerPoint: settings.dollarPerPoint,
    wolfUnit: settings.wolfUnit,
    snakeStake: settings.snakeStake,
    dotPoints: settings.dotPoints,
    holePars: settings.holePars,
    holeStrokeIndex: settings.holeStrokeIndex,
    currentHole: holes.reduce((max, hole) => Math.max(max, hole.hole), 0),
    players,
    holes: holes.map((hole) => serializeHole(hole, computation)),
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
      const { holes: _holes, settlement: _settlement, ...summary } = detail;
      return summary;
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
      dollarPerPoint: (body.dollarPerPoint ?? body.stake).toFixed(2),
      wolfUnit: (body.wolfUnit ?? 1).toFixed(2),
      snakeStake: (body.snakeStake ?? 1).toFixed(2),
      dotPoints: body.dotPoints ?? DEFAULT_DOT_POINTS,
      holePars: body.holePars ?? DEFAULT_HOLE_PARS,
      holeStrokeIndex: body.holeStrokeIndex ?? DEFAULT_HOLE_STROKE_INDEX,
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
  const updates: Partial<typeof roundsTable.$inferInsert> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.course !== undefined) updates.course = body.course;
  if (body.status !== undefined) updates.status = body.status;
  if (body.dollarPerPoint !== undefined) updates.dollarPerPoint = body.dollarPerPoint.toFixed(2);
  if (body.wolfUnit !== undefined) updates.wolfUnit = body.wolfUnit.toFixed(2);
  if (body.snakeStake !== undefined) updates.snakeStake = body.snakeStake.toFixed(2);
  if (body.dotPoints !== undefined) updates.dotPoints = body.dotPoints;
  if (body.holePars !== undefined) updates.holePars = body.holePars;
  if (body.holeStrokeIndex !== undefined) updates.holeStrokeIndex = body.holeStrokeIndex;
  const [round] = await db.update(roundsTable).set(updates).where(eq(roundsTable.id, roundId)).returning();
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
  const roundPlayers = found.round.players as PlayerRecord[];
  const validPlayerIds = new Set(roundPlayers.map((player) => player.id));
  if (body.scores.some((score) => !validPlayerIds.has(score.playerId))) {
    return res.status(400).json({ error: "Scores must belong to round players" });
  }
  const scorePlayerIds = body.scores.map((score) => score.playerId);
  if (new Set(scorePlayerIds).size !== scorePlayerIds.length) {
    return res.status(400).json({ error: "Each player may only have one score per hole" });
  }
  if (scorePlayerIds.length !== roundPlayers.length) {
    return res.status(400).json({ error: "Every round player must have a score for this hole" });
  }
  for (const list of [body.putts ?? [], body.dots ?? []]) {
    if (list.some((entry) => !validPlayerIds.has(entry.playerId))) {
      return res.status(400).json({ error: "Putts and dots must belong to round players" });
    }
    const ids = list.map((entry) => entry.playerId);
    if (new Set(ids).size !== ids.length) {
      return res.status(400).json({ error: "Each player may only have one putts/dots entry per hole" });
    }
  }
  if (body.wolfPartnerIds?.some((id) => !validPlayerIds.has(id))) {
    return res.status(400).json({ error: "Wolf partners must belong to round players" });
  }
  if (body.wolfPartnerIds && new Set(body.wolfPartnerIds).size !== body.wolfPartnerIds.length) {
    return res.status(400).json({ error: "Wolf partners must not contain duplicates" });
  }
  if (body.wolfPartnerIds?.includes(body.wolfOverridePlayerId ?? "")) {
    return res.status(400).json({ error: "The wolf cannot also be their own partner" });
  }
  if (body.wolfOverridePlayerId && !validPlayerIds.has(body.wolfOverridePlayerId)) {
    return res.status(400).json({ error: "Wolf override must belong to round players" });
  }
  if (body.winnerPlayerId && !validPlayerIds.has(body.winnerPlayerId)) {
    return res.status(400).json({ error: "Winner must belong to round players" });
  }
  const existing = found.holes.find((hole) => hole.hole === body.hole);
  const values = {
    roundId,
    hole: body.hole,
    scores: body.scores,
    putts: body.putts ?? [],
    wolfPartnerIds: body.wolfPartnerIds ?? [],
    wolfOverridePlayerId: body.wolfOverridePlayerId ?? null,
    wolfManualResult: body.wolfManualResult ?? null,
    dots: body.dots ?? [],
    winnerPlayerId: body.winnerPlayerId ?? null,
  };
  const [hole] = existing
    ? await db.update(holeResultsTable).set(values).where(eq(holeResultsTable.id, existing.id)).returning()
    : await db.insert(holeResultsTable).values(values).returning();

  const allHoles = existing
    ? found.holes.map((item) => (item.id === hole.id ? hole : item))
    : [...found.holes, hole];
  const computation = computeRound(toRoundSettings(found.round), allHoles.map(toHoleRow));
  return res.status(existing ? 200 : 201).json(RecordHoleResponse.parse(serializeHole(hole, computation)));
});

router.get("/rounds/:roundId/holes", async (req, res) => {
  const { roundId } = ListHoleResultsParams.parse(req.params);
  const found = await findRound(roundId);
  if (!found) return res.status(404).json({ error: "Round not found" });
  const computation = computeRound(toRoundSettings(found.round), found.holes.map(toHoleRow));
  const result = found.holes.map((hole) => serializeHole(hole, computation));
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
        const { holes: _holes, settlement: _settlement, ...summary } = normalizeRound(latest, holeCounts[0] ?? []);
        return summary;
      })()
    : null;
  res.json(
    GetDashboardSummaryResponse.parse({
      totalRounds: rounds.length,
      activeRounds: rounds.filter((round) => round.status === "in_progress").length,
      totalHolesRecorded: holeCounts.reduce((sum, holes) => sum + holes.length, 0),
      latestRound,
    }),
  );
});

export default router;
