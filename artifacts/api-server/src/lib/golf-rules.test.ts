import { describe, expect, it } from "vitest";
import { computeRound, strokesFor, type HoleRow, type Player, type RoundSettings } from "./golf-rules";

const DEFAULT_PARS = Array.from({ length: 18 }, () => 4);
const DEFAULT_STROKE_INDEX = Array.from({ length: 18 }, (_, i) => i + 1);
const DEFAULT_DOT_POINTS = { greenie: 1, sandy: 1, birdie: 1, eagle: 2, poley: 1, threeputt: 1 };

function makePlayers(count: number, handicaps: number[] = []): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    initials: `P${i + 1}`,
    handicap: handicaps[i] ?? 0,
    snakeThreshold: null,
  }));
}

function settingsFor(players: Player[], gameTypes: string[], overrides: Partial<RoundSettings> = {}): RoundSettings {
  return {
    players,
    gameTypes,
    stake: 1,
    dollarPerPoint: 1,
    wolfUnit: 1,
    snakeStake: 1,
    dotPoints: DEFAULT_DOT_POINTS,
    holePars: DEFAULT_PARS,
    holeStrokeIndex: DEFAULT_STROKE_INDEX,
    ...overrides,
  };
}

function assertZeroSum(computation: ReturnType<typeof computeRound>, players: Player[]) {
  const balanceTotal = computation.balances.reduce((sum, b) => sum + b.amount, 0);
  expect(Math.round(balanceTotal * 100)).toBe(0);

  const netFromPayouts = new Map(players.map((p) => [p.id, 0]));
  for (const payout of computation.payouts) {
    netFromPayouts.set(payout.fromPlayerId, (netFromPayouts.get(payout.fromPlayerId) ?? 0) - payout.amount);
    netFromPayouts.set(payout.toPlayerId, (netFromPayouts.get(payout.toPlayerId) ?? 0) + payout.amount);
  }
  for (const balance of computation.balances) {
    const fromPayouts = Math.round((netFromPayouts.get(balance.playerId) ?? 0) * 100);
    expect(fromPayouts).toBe(Math.round(balance.amount * 100));
  }
  for (const payout of computation.payouts) {
    expect(payout.amount).toBeGreaterThan(0);
  }
}

describe("strokesFor", () => {
  it("gives one extra stroke on the hardest holes up to the handicap", () => {
    expect(strokesFor(10, 1)).toBe(1);
    expect(strokesFor(10, 10)).toBe(1);
    expect(strokesFor(10, 11)).toBe(0);
  });

  it("gives a base stroke everywhere plus extra on the hardest holes above 18", () => {
    expect(strokesFor(20, 1)).toBe(2);
    expect(strokesFor(20, 2)).toBe(2);
    expect(strokesFor(20, 3)).toBe(1);
  });

  it("gives no strokes for a zero or negative handicap", () => {
    expect(strokesFor(0, 1)).toBe(0);
    expect(strokesFor(-2, 1)).toBe(0);
  });
});

describe("computeRound — Wolf", () => {
  it("pays the winning side gross-wins style and keeps the round zero-sum (3 players)", () => {
    const players = makePlayers(3, [10, 5, 20]);
    const settings = settingsFor(players, ["wolf"]);
    // Hole 1: par 4, stroke index 1. Handicap strokes: p1(10)->1, p2(5)->1, p3(20)->2.
    // p1 is wolf alone (rotation). p1 net = 5-1=4. p2 net=4-1=3, p3 net=6-2=4 -> other best=3. Wolf loses.
    const holes: HoleRow[] = [
      {
        hole: 1,
        scores: [
          { playerId: "p1", strokes: 5 },
          { playerId: "p2", strokes: 4 },
          { playerId: "p3", strokes: 6 },
        ],
        putts: [],
        wolfPartnerIds: [],
        wolfOverridePlayerId: null,
        wolfManualResult: null,
        dots: [],
        winnerPlayerId: null,
      },
    ];
    const computation = computeRound(settings, holes);
    const hole1 = computation.perHole.get(1)!;
    expect(hole1.wolfResult).toBe("oppwin");
    expect(hole1.wolfCarry).toBe(1);
    const p1Balance = computation.balances.find((b) => b.playerId === "p1")!;
    expect(p1Balance.amount).toBeLessThan(0);
    assertZeroSum(computation, players);
  });

  it("carries a push forward and applies the multiplier on the next decisive hole (6 players)", () => {
    const players = makePlayers(6);
    const settings = settingsFor(players, ["wolf"]);
    const pushHole: HoleRow = {
      hole: 1,
      // All equal net scores (no handicaps) -> push between wolf (p1) and the rest.
      scores: players.map((p) => ({ playerId: p.id, strokes: 4 })),
      putts: [],
      wolfPartnerIds: [],
      wolfOverridePlayerId: null,
      wolfManualResult: null,
      dots: [],
      winnerPlayerId: null,
    };
    // Hole 2: rotation wolf is p2. p2 shoots best net by far -> wolf wins with carried multiplier.
    const decisiveHole: HoleRow = {
      hole: 2,
      scores: players.map((p) => ({ playerId: p.id, strokes: p.id === "p2" ? 2 : 6 })),
      putts: [],
      wolfPartnerIds: [],
      wolfOverridePlayerId: null,
      wolfManualResult: null,
      dots: [],
      winnerPlayerId: null,
    };
    const computation = computeRound(settings, [pushHole, decisiveHole]);
    expect(computation.perHole.get(1)!.wolfResult).toBe("push");
    expect(computation.perHole.get(2)!.wolfCarry).toBe(2);
    expect(computation.perHole.get(2)!.wolfResult).toBe("wolfwin");
    const p2Points = computation.pointTotals.find((p) => p.playerId === "p2")!;
    // wolfUnit(1) * losingTeamSize(5) * carry(2) = 10 points for the lone wolf winner.
    expect(p2Points.wolfPoints).toBe(10);
    assertZeroSum(computation, players);
  });
});

describe("computeRound — Snake and Dots", () => {
  it("passes the snake to the biggest putt-threshold hitter and penalizes 3-putts in Dots", () => {
    const players = makePlayers(4, [10, 5, 20, 0]);
    const settings = settingsFor(players, ["snake", "dots"]);
    const holes: HoleRow[] = [
      {
        hole: 1,
        scores: [
          { playerId: "p1", strokes: 5 },
          { playerId: "p2", strokes: 4 },
          { playerId: "p3", strokes: 6 },
          { playerId: "p4", strokes: 4 },
        ],
        putts: [
          { playerId: "p1", putts: 2 },
          { playerId: "p2", putts: 3 },
          { playerId: "p3", putts: 1 },
          { playerId: "p4", putts: 2 },
        ],
        wolfPartnerIds: [],
        wolfOverridePlayerId: null,
        wolfManualResult: null,
        dots: [],
        winnerPlayerId: null,
      },
    ];
    const computation = computeRound(settings, holes);
    expect(computation.snakeHolderPlayerId).toBe("p2");
    const hole1 = computation.perHole.get(1)!;
    expect(hole1.dotsEarned.find((d) => d.playerId === "p2")!.threeputt).toBe(true);
    const p2Points = computation.pointTotals.find((p) => p.playerId === "p2")!;
    expect(p2Points.snakePoints).toBe(0);
    expect(p2Points.dotsPoints).toBe(0);
    const p1Points = computation.pointTotals.find((p) => p.playerId === "p1")!;
    expect(p1Points.snakePoints).toBe(1);
    expect(p1Points.dotsPoints).toBe(1);
    assertZeroSum(computation, players);
  });

  it("stays zero-sum across a mixed Wolf + Snake + Dots + Nassau round with 6 players", () => {
    const handicaps = [10, 5, 20, 0, 14, 27];
    const players = makePlayers(6, handicaps);
    const settings = settingsFor(players, ["wolf", "snake", "dots", "nassau"]);
    const holes: HoleRow[] = Array.from({ length: 5 }, (_, i) => ({
      hole: i + 1,
      scores: players.map((p, idx) => ({ playerId: p.id, strokes: 3 + ((idx + i) % 4) })),
      putts: players.map((p, idx) => ({ playerId: p.id, putts: (idx + i) % 4 })),
      wolfPartnerIds: i % 2 === 0 ? [players[(i + 2) % 6].id] : [],
      wolfOverridePlayerId: null,
      wolfManualResult: null,
      dots: players.map((p, idx) => ({ playerId: p.id, greenie: false, sandy: idx === i % 6, poley: false })),
      winnerPlayerId: null,
    }));
    const computation = computeRound(settings, holes);
    assertZeroSum(computation, players);
  });
});
