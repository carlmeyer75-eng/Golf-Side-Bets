// Pure scoring/settlement functions for Wolf, Snake, and Dots side bets, ported from the
// reference "Clubhouse Ledger" rules (handicap-aware net scoring, gross-wins Wolf payouts,
// putts-derived Snake, and manual/derived Dots) plus the project's existing simplified Nassau.

export type Player = {
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
export type WolfManualResult = "wolfwin" | "oppwin" | "push";

export type HoleRow = {
  hole: number;
  scores: Score[];
  putts: Putt[];
  wolfPartnerIds: string[];
  wolfOverridePlayerId: string | null;
  wolfManualResult: WolfManualResult | null;
  dots: DotFlags[];
  winnerPlayerId: string | null;
  snakeHolderPlayerId: string | null;
};

export type RoundSettings = {
  players: Player[];
  gameTypes: string[];
  stake: number;
  dollarPerPoint: number;
  wolfUnit: number;
  snakeStake: number;
  dotPoints: DotPoints;
  holePars: number[];
  holeStrokeIndex: number[];
};

export type PlayerDotsResult = {
  playerId: string;
  greenie: boolean;
  sandy: boolean;
  poley: boolean;
  birdie: boolean;
  eagle: boolean;
  threeputt: boolean;
};

export type HoleComputed = {
  hole: number;
  effectiveWolfPlayerId: string | null;
  wolfTeamPlayerIds: string[];
  wolfResult: WolfManualResult | null;
  wolfCarry: number;
  snakeHolderPlayerId: string | null;
  snakeTiePlayerIds: string[];
  dotsEarned: PlayerDotsResult[];
};

export type Balance = { playerId: string; playerName: string; amount: number };
export type Payout = { fromPlayerId: string; fromPlayerName: string; toPlayerId: string; toPlayerName: string; amount: number };
export type PlayerPoints = {
  playerId: string;
  playerName: string;
  wolfPoints: number;
  dotsPoints: number;
  snakePoints: number;
  nassauAmount: number;
};

export type RoundComputation = {
  perHole: Map<number, HoleComputed>;
  balances: Balance[];
  payouts: Payout[];
  pointTotals: PlayerPoints[];
  snakeHolderPlayerId: string | null;
};

/** Handicap strokes a player receives on a hole of the given stroke index (1 = hardest). */
export function strokesFor(handicap: number, strokeIndex: number): number {
  if (!handicap || handicap <= 0) return 0;
  const base = Math.floor(handicap / 18);
  const extra = strokeIndex <= handicap % 18 ? 1 : 0;
  return base + extra;
}

function netScore(player: Player, gross: number, strokeIndex: number): number {
  return gross - strokesFor(player.handicap, strokeIndex);
}

function wolfRotationPlayerId(players: Player[], hole: number): string | null {
  if (players.length === 0) return null;
  return players[(hole - 1) % players.length]?.id ?? null;
}

function snakeThresholdFor(player: Player): number {
  return player.snakeThreshold ?? (player.handicap > 18 ? 4 : 3);
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computeRound(settings: RoundSettings, holes: HoleRow[]): RoundComputation {
  const players = settings.players;
  const playerIds = players.map((p) => p.id);
  const byId = new Map(players.map((p) => [p.id, p]));

  const wolfEnabled = settings.gameTypes.includes("wolf");
  const snakeEnabled = settings.gameTypes.includes("snake");
  const dotsEnabled = settings.gameTypes.includes("dots");
  const nassauEnabled = settings.gameTypes.includes("nassau");

  let carry = 1;
  let snakeHolder: string | null = null;

  const wolfTotals = new Map(playerIds.map((id) => [id, 0]));
  const dotsTotals = new Map(playerIds.map((id) => [id, 0]));
  const snakeTotals = new Map(playerIds.map((id) => [id, 0]));
  const perHole = new Map<number, HoleComputed>();

  const sortedHoles = [...holes].sort((a, b) => a.hole - b.hole);

  for (const holeRow of sortedHoles) {
    const par = settings.holePars[holeRow.hole - 1] ?? 4;
    const strokeIndex = settings.holeStrokeIndex[holeRow.hole - 1] ?? holeRow.hole;
    const grossByPlayer = new Map(holeRow.scores.map((s) => [s.playerId, s.strokes]));
    const puttsByPlayer = new Map(holeRow.putts.map((p) => [p.playerId, p.putts]));

    // ---- Wolf ----
    let effectiveWolfPlayerId: string | null = null;
    let wolfTeamPlayerIds: string[] = [];
    let wolfResult: WolfManualResult | null = null;
    const wolfCarryThisHole = carry;

    if (wolfEnabled && playerIds.length > 0) {
      effectiveWolfPlayerId = holeRow.wolfOverridePlayerId ?? wolfRotationPlayerId(players, holeRow.hole);
      const partnerIds = holeRow.wolfPartnerIds.filter((id) => id !== effectiveWolfPlayerId && byId.has(id));
      wolfTeamPlayerIds = effectiveWolfPlayerId ? [effectiveWolfPlayerId, ...partnerIds] : [];
      const othersTeam = playerIds.filter((id) => !wolfTeamPlayerIds.includes(id));
      const teamComplete = (ids: string[]) => ids.length > 0 && ids.every((id) => grossByPlayer.has(id));

      if (holeRow.wolfManualResult) {
        wolfResult = holeRow.wolfManualResult;
      } else if (teamComplete(wolfTeamPlayerIds) && teamComplete(othersTeam)) {
        const bestNet = (ids: string[]) =>
          Math.min(
            ...ids.map((id) => netScore(byId.get(id)!, grossByPlayer.get(id)!, strokeIndex)),
          );
        const wolfBest = bestNet(wolfTeamPlayerIds);
        const otherBest = bestNet(othersTeam);
        wolfResult = wolfBest < otherBest ? "wolfwin" : wolfBest > otherBest ? "oppwin" : "push";
      }

      if (wolfResult === "push") {
        carry += 1;
      } else if (wolfResult) {
        const winningTeam = wolfResult === "wolfwin" ? wolfTeamPlayerIds : othersTeam;
        const losingTeamSize = wolfResult === "wolfwin" ? othersTeam.length : wolfTeamPlayerIds.length;
        const winPerPlayer = settings.wolfUnit * losingTeamSize * wolfCarryThisHole;
        for (const id of winningTeam) {
          wolfTotals.set(id, (wolfTotals.get(id) ?? 0) + winPerPlayer);
        }
        carry = 1;
      }
    }

    // ---- Snake ----
    let snakeTiePlayerIds: string[] = [];
    if (snakeEnabled) {
      const hitters: string[] = [];
      let maxPutts = 0;
      for (const player of players) {
        const putts = puttsByPlayer.get(player.id);
        if (putts === undefined) continue;
        if (putts >= snakeThresholdFor(player)) {
          hitters.push(player.id);
          if (putts > maxPutts) maxPutts = putts;
        }
      }
      const topHitters = hitters.filter((id) => (puttsByPlayer.get(id) ?? 0) === maxPutts);
      if (topHitters.length === 1) {
        snakeHolder = topHitters[0];
      } else if (topHitters.length > 1) {
        snakeTiePlayerIds = topHitters.slice().sort((a, b) => playerIds.indexOf(a) - playerIds.indexOf(b));
        if (holeRow.snakeHolderPlayerId && topHitters.includes(holeRow.snakeHolderPlayerId)) {
          snakeHolder = holeRow.snakeHolderPlayerId;
        } else if (!(snakeHolder && topHitters.includes(snakeHolder))) {
          snakeHolder = snakeTiePlayerIds[0] ?? snakeHolder;
        }
      }
    }

    // ---- Dots ----
    const dotsEarned: PlayerDotsResult[] = [];
    if (dotsEnabled) {
      for (const player of players) {
        const manual = holeRow.dots.find((d) => d.playerId === player.id);
        const gross = grossByPlayer.get(player.id);
        const birdie = gross !== undefined && gross === par - 1;
        const eagle = gross !== undefined && gross <= par - 2;
        const putts = puttsByPlayer.get(player.id);
        const threeputt = putts !== undefined && putts >= snakeThresholdFor(player);
        const greenie = !!manual?.greenie && par === 3;
        dotsEarned.push({
          playerId: player.id,
          greenie,
          sandy: !!manual?.sandy,
          poley: !!manual?.poley,
          birdie,
          eagle,
          threeputt,
        });
      }
      for (const entry of dotsEarned) {
        let points = 0;
        if (entry.greenie) points += settings.dotPoints.greenie;
        if (entry.sandy) points += settings.dotPoints.sandy;
        if (entry.poley) points += settings.dotPoints.poley;
        if (entry.eagle) points += settings.dotPoints.eagle;
        else if (entry.birdie) points += settings.dotPoints.birdie;
        if (points) dotsTotals.set(entry.playerId, (dotsTotals.get(entry.playerId) ?? 0) + points);
        if (entry.threeputt) {
          for (const other of players) {
            if (other.id === entry.playerId) continue;
            dotsTotals.set(other.id, (dotsTotals.get(other.id) ?? 0) + settings.dotPoints.threeputt);
          }
        }
      }
    }

    perHole.set(holeRow.hole, {
      hole: holeRow.hole,
      effectiveWolfPlayerId,
      wolfTeamPlayerIds,
      wolfResult,
      wolfCarry: wolfCarryThisHole,
      snakeHolderPlayerId: snakeHolder,
      snakeTiePlayerIds,
      dotsEarned,
    });
  }

  if (snakeEnabled && snakeHolder) {
    for (const id of playerIds) {
      if (id === snakeHolder) continue;
      snakeTotals.set(id, (snakeTotals.get(id) ?? 0) + settings.snakeStake);
    }
  }

  // ---- Nassau: existing simplified per-hole winner-take-all, unchanged algorithm ----
  const nassauTotals = new Map(playerIds.map((id) => [id, 0]));
  if (nassauEnabled) {
    for (const holeRow of sortedHoles) {
      const winnerId =
        holeRow.winnerPlayerId ?? holeRow.scores.slice().sort((a, b) => a.strokes - b.strokes)[0]?.playerId;
      if (!winnerId || !byId.has(winnerId)) continue;
      const perGame = settings.stake * (players.length - 1);
      for (const player of players) {
        nassauTotals.set(
          player.id,
          (nassauTotals.get(player.id) ?? 0) + (player.id === winnerId ? perGame : -settings.stake),
        );
      }
    }
  }

  // ---- Gross pairwise settlement ----
  // Each player's raw total (Wolf + Snake + Dots points converted to dollars, plus Nassau
  // dollars) is a "gross" figure: Wolf/Snake/Dots only ever add points (winners bank, losers
  // bank zero — never negative), so nothing here is pre-netted or mean-centered. Every unique
  // pair of players then settles head-to-head: whoever has the smaller total owes the other the
  // exact gap. This mirrors the reference app's pairwise gap model rather than simplifying into
  // a minimal set of transactions.
  const totalCents = new Map(
    playerIds.map((id) => {
      const pointsDollars =
        ((wolfTotals.get(id) ?? 0) + (dotsTotals.get(id) ?? 0) + (snakeTotals.get(id) ?? 0)) *
        settings.dollarPerPoint;
      const total = pointsDollars + (nassauTotals.get(id) ?? 0);
      return [id, Math.round(total * 100)];
    }),
  );

  const payouts = pairwisePayouts(players, totalCents);

  // A player's displayed balance is simply their net position across every pairwise
  // settlement (received minus paid) — since it's summed from the same integer cents used to
  // build the payouts, it reconciles with them exactly and is always zero-sum by construction.
  const netCents = new Map(playerIds.map((id) => [id, 0]));
  for (const payout of payouts) {
    const cents = Math.round(payout.amount * 100);
    netCents.set(payout.fromPlayerId, (netCents.get(payout.fromPlayerId) ?? 0) - cents);
    netCents.set(payout.toPlayerId, (netCents.get(payout.toPlayerId) ?? 0) + cents);
  }

  const balances: Balance[] = players.map((player) => ({
    playerId: player.id,
    playerName: player.name,
    amount: (netCents.get(player.id) ?? 0) / 100,
  }));

  const pointTotals: PlayerPoints[] = players.map((player) => ({
    playerId: player.id,
    playerName: player.name,
    wolfPoints: round2(wolfTotals.get(player.id) ?? 0),
    dotsPoints: round2(dotsTotals.get(player.id) ?? 0),
    snakePoints: round2(snakeTotals.get(player.id) ?? 0),
    nassauAmount: round2(nassauTotals.get(player.id) ?? 0),
  }));

  return { perHole, balances, payouts, pointTotals, snakeHolderPlayerId: snakeHolder };
}

/**
 * Settles every unique pair of players head-to-head: whoever has the smaller total (in integer
 * cents) owes the other the exact gap. Unlike a minimal-transaction debt simplification, this
 * produces a payout for every pair with a nonzero gap, matching the reference app's model.
 */
function pairwisePayouts(players: Player[], totalCents: Map<string, number>): Payout[] {
  const payouts: Payout[] = [];
  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      const a = players[i];
      const b = players[j];
      const gap = (totalCents.get(a.id) ?? 0) - (totalCents.get(b.id) ?? 0);
      if (gap === 0) continue;
      const [winner, loser] = gap > 0 ? [a, b] : [b, a];
      payouts.push({
        fromPlayerId: loser.id,
        fromPlayerName: loser.name,
        toPlayerId: winner.id,
        toPlayerName: winner.name,
        amount: Math.abs(gap) / 100,
      });
    }
  }
  return payouts;
}
