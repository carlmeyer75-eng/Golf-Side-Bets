// Pure scoring/settlement functions for Wolf, Snake, Dots, and Nassau side bets, ported from
// the reference "Clubhouse Ledger" rules (handicap-aware net scoring, gross-wins Wolf payouts,
// putts-derived Snake, manual/derived Dots, and pairwise Nassau match play).

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
  nassauFrontAmount: number;
  nassauBackAmount: number;
  nassauOverallAmount: number;
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

  // ---- Nassau: standard pairwise match play ----
  // Each Nassau is three independent bets: front nine, back nine, and overall. For every
  // segment, each player is matched against every other player, with one stake changing hands
  // only when the match is decided. A hole is won by the lower net score; tied holes are halved
  // and do not affect the segment result. We keep the segment totals separately for the ledger,
  // while nassauAmount remains the backward-compatible sum of all three bets.
  const nassauFrontTotals = new Map(playerIds.map((id) => [id, 0]));
  const nassauBackTotals = new Map(playerIds.map((id) => [id, 0]));
  const nassauOverallTotals = new Map(playerIds.map((id) => [id, 0]));
  const nassauPairCents = new Map<string, number>();

  if (nassauEnabled) {
    settleNassauSegment(nassauFrontTotals, nassauPairCents, players, sortedHoles, 1, 9, byId, settings);
    settleNassauSegment(nassauBackTotals, nassauPairCents, players, sortedHoles, 10, 18, byId, settings);
    settleNassauSegment(nassauOverallTotals, nassauPairCents, players, sortedHoles, 1, 18, byId, settings);
  }

  // ---- Pairwise settlement ----
  // Wolf/Snake/Dots are gross point totals, so each pair settles the gap between their totals.
  // Nassau is already calculated head-to-head and is added directly to that same pair's gap;
  // putting its signed player balances through the gross-gap model would double the stake.
  const totalCents = new Map(
    playerIds.map((id) => {
      const pointsDollars =
        ((wolfTotals.get(id) ?? 0) + (dotsTotals.get(id) ?? 0) + (snakeTotals.get(id) ?? 0)) *
        settings.dollarPerPoint;
      return [id, Math.round(pointsDollars * 100)];
    }),
  );

  const payouts = pairwisePayouts(players, totalCents, nassauPairCents);

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
    nassauFrontAmount: round2(nassauFrontTotals.get(player.id) ?? 0),
    nassauBackAmount: round2(nassauBackTotals.get(player.id) ?? 0),
    nassauOverallAmount: round2(nassauOverallTotals.get(player.id) ?? 0),
    nassauAmount: round2(
      (nassauFrontTotals.get(player.id) ?? 0) +
        (nassauBackTotals.get(player.id) ?? 0) +
        (nassauOverallTotals.get(player.id) ?? 0),
    ),
  }));

  return { perHole, balances, payouts, pointTotals, snakeHolderPlayerId: snakeHolder };
}

function settleNassauSegment(
  totals: Map<string, number>,
  pairCents: Map<string, number>,
  players: Player[],
  holes: HoleRow[],
  firstHole: number,
  lastHole: number,
  byId: Map<string, Player>,
  settings: RoundSettings,
): void {
  const segmentHoles = holes.filter((hole) => hole.hole >= firstHole && hole.hole <= lastHole);

  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      const playerA = players[i];
      const playerB = players[j];
      let aHolesWon = 0;
      let bHolesWon = 0;

      for (const hole of segmentHoles) {
        const scoreA = hole.scores.find((score) => score.playerId === playerA.id);
        const scoreB = hole.scores.find((score) => score.playerId === playerB.id);
        if (!scoreA || !scoreB) continue;

        // Keep the existing optional hole winner as a manual override for recorded rounds. When
        // it is absent, Nassau uses handicap-aware net match-play scoring.
        if (hole.winnerPlayerId === playerA.id) {
          aHolesWon += 1;
          continue;
        }
        if (hole.winnerPlayerId === playerB.id) {
          bHolesWon += 1;
          continue;
        }

        const strokeIndex = settings.holeStrokeIndex[hole.hole - 1] ?? hole.hole;
        const aNet = netScore(byId.get(playerA.id)!, scoreA.strokes, strokeIndex);
        const bNet = netScore(byId.get(playerB.id)!, scoreB.strokes, strokeIndex);
        if (aNet < bNet) aHolesWon += 1;
        else if (bNet < aNet) bHolesWon += 1;
      }

      if (aHolesWon === bHolesWon) continue;
      const winnerId = aHolesWon > bHolesWon ? playerA.id : playerB.id;
      const loserId = winnerId === playerA.id ? playerB.id : playerA.id;
      totals.set(winnerId, (totals.get(winnerId) ?? 0) + settings.stake);
      totals.set(loserId, (totals.get(loserId) ?? 0) - settings.stake);
      const key = `${playerA.id}:${playerB.id}`;
      const signedStakeCents = Math.round(settings.stake * 100) * (winnerId === playerA.id ? 1 : -1);
      pairCents.set(key, (pairCents.get(key) ?? 0) + signedStakeCents);
    }
  }
}

/**
 * Settles every unique pair head-to-head using their gross points gap plus that pair's direct
 * Nassau result. Unlike a minimal-transaction debt simplification, this produces a payout for
 * every pair with a nonzero combined gap, matching the reference app's pairwise model.
 */
function pairwisePayouts(
  players: Player[],
  totalCents: Map<string, number>,
  nassauPairCents: Map<string, number>,
): Payout[] {
  const payouts: Payout[] = [];
  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      const a = players[i];
      const b = players[j];
      const gap =
        (totalCents.get(a.id) ?? 0) -
        (totalCents.get(b.id) ?? 0) +
        (nassauPairCents.get(`${a.id}:${b.id}`) ?? 0);
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
