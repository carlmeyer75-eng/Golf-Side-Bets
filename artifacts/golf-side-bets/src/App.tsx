import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Flag,
  LayoutDashboard,
  LoaderCircle,
  Map,
  Plus,
  RefreshCw,
  Trash2,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import {
  useListCourses,
  getListCoursesQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetRoundQueryKey,
  getGetRoundSettlementQueryKey,
  getListHoleResultsQueryKey,
  getListRoundsQueryKey,
  useCreateRound,
  useDeleteRound,
  useGetDashboardSummary,
  useGetRound,
  useGetRoundSettlement,
  useListHoleResults,
  useListRounds,
  useRecordHole,
  useUpdateRound,
} from '@workspace/api-client-react';
import type {
  GameType,
  HoleResult,
  HoleResultWolfResult,
  Player,
  DotPoints,
  Round,
  RoundDetail,
  RoundUpdate,
  Settlement,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Courses from '@/pages/Courses';
import { Link, Route, Switch, Router as WouterRouter, useLocation, useParams } from 'wouter';

const queryClient = new QueryClient();

const ALL_GAME_TYPES: { value: GameType; label: string; blurb: string }[] = [
  { value: 'wolf', label: 'Wolf', blurb: 'Rotating captain picks a partner or goes it alone' },
  { value: 'snake', label: 'Snake', blurb: 'Whoever 3-putts holds it until someone worse comes along' },
  { value: 'dots', label: 'Dots', blurb: 'Greenies, sandies, birdies and more, worth points' },
  { value: 'nassau', label: 'Nassau', blurb: 'Match play with separate front, back, and overall bets' },
];

const formatDate = (value?: string) =>
  value
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
        new Date(value),
      )
    : 'Date not set';

const formatMoney = (value: number) => `${value < 0 ? '−' : ''}$${Math.abs(value).toFixed(2)}`;
const formatPoints = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

const getInitials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

const gameLabel = (game: GameType) => ALL_GAME_TYPES.find((item) => item.value === game)?.label ?? game;

const DEFAULT_DOT_POINTS: DotPoints = {
  greenie: 1,
  sandy: 1,
  birdie: 1,
  eagle: 2,
  poley: 1,
  threeputt: 1,
};
const DOT_POINT_FIELDS: { key: keyof DotPoints; label: string }[] = [
  { key: 'greenie', label: 'Greenie' },
  { key: 'sandy', label: 'Sandy' },
  { key: 'birdie', label: 'Birdie' },
  { key: 'eagle', label: 'Eagle' },
  { key: 'poley', label: 'Poley' },
  { key: 'threeputt', label: '3-putt' },
];
const DEFAULT_HOLE_PARS = Array.from({ length: 18 }, () => 4);
const DEFAULT_HOLE_STROKE_INDEX = Array.from({ length: 18 }, (_, i) => i + 1);

function Brand() {
  return (
    <Link href="/" className="brand-mark" data-testid="link-brand">
      <span className="brand-icon">G</span>
      <span>
        <span className="brand-word">Golf Side Bets</span>
        <span className="brand-sub">The honest scorecard</span>
      </span>
    </Link>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const isRound = location.startsWith('/rounds/');
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="nav-label">Clubhouse</div>
        <nav aria-label="Main navigation">
          <Link
            href="/"
            className={`nav-link ${location === '/' ? 'active' : ''}`}
            data-testid="link-dashboard"
          >
            <LayoutDashboard size={17} /> Dashboard
          </Link>
          <Link
            href="/courses"
            className={`nav-link ${location.startsWith('/courses') ? 'active' : ''}`}
            data-testid="link-courses"
          >
            <Map size={17} /> Course library
          </Link>
          <Link
            href="/rounds/new"
            className={`nav-link ${location === '/rounds/new' ? 'active' : ''}`}
            data-testid="link-new-round"
          >
            <Plus size={17} /> New round
          </Link>
          {isRound && location !== '/rounds/new' ? (
            <>
              <div className="nav-label" style={{ marginTop: 30 }}>On the course</div>
              <span className="nav-link active" aria-current="page" data-testid="status-current-round">
                <Flag size={17} /> Live scorecard
              </span>
            </>
          ) : null}
        </nav>
        <div className="sidebar-foot">
          Keep the round moving.<br />
          Settle it when the last putt drops.
        </div>
      </aside>
      <div className="main-shell">
        <header className="mobile-top">
          <Brand />
          <nav className="mobile-menu" aria-label="Mobile navigation">
            <Link href="/" className={location === '/' ? 'active' : ''} data-testid="link-mobile-dashboard">
              <LayoutDashboard size={18} />
            </Link>
            <Link href="/courses" className={location.startsWith('/courses') ? 'active' : ''} data-testid="link-mobile-courses">
              <Map size={18} />
            </Link>
            <Link href="/rounds/new" className={location === '/rounds/new' ? 'active' : ''} data-testid="link-mobile-new-round">
              <Plus size={19} />
            </Link>
          </nav>
        </header>
        {children}
      </div>
    </div>
  );
}

function LoadingState({ label = 'Loading the clubhouse' }: { label?: string }) {
  return (
    <div className="card" style={{ padding: 24 }} aria-label={label} data-testid="state-loading">
      <div className="skeleton" style={{ width: '32%', height: 13, marginBottom: 17 }} />
      <div className="skeleton" style={{ width: '67%', height: 29, marginBottom: 12 }} />
      <div className="skeleton" style={{ width: '48%', height: 13 }} />
    </div>
  );
}

function ErrorState({ onRetry, message = 'We could not reach the scorecard.' }: { onRetry: () => void; message?: string }) {
  return (
    <div className="error-state" data-testid="state-error">
      <strong>{message}</strong>
      <p style={{ margin: '7px 0 15px', color: 'inherit', opacity: 0.78, fontSize: 13 }}>
        Try again before the next tee shot.
      </p>
      <button className="button button-danger" onClick={onRetry} data-testid="button-retry">
        <RefreshCw size={14} /> Try again
      </button>
    </div>
  );
}

function AvatarStack({ players }: { players: Player[] }) {
  return (
    <div className="player-stack" aria-label={`${players.length} players`}>
      {players.map((player) => (
        <span className="avatar" key={player.id} title={player.name} data-testid={`avatar-player-${player.id}`}>
          {player.initials || getInitials(player.name)}
        </span>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: Round['status'] }) {
  return (
    <span className={`status-pill ${status === 'in_progress' ? 'live' : ''}`} data-testid={`status-round-${status}`}>
      {status === 'in_progress' ? <span className="status-dot" /> : <Check size={11} />}
      {status === 'in_progress' ? 'In play' : 'Completed'}
    </span>
  );
}

function Dashboard() {
  const roundsQuery = useListRounds({ query: { queryKey: getListRoundsQueryKey() } });
  const summaryQuery = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() } });
  const rounds = roundsQuery.data ?? [];
  const summary = summaryQuery.data;
  const activeRound = useMemo(
    () => rounds.find((round) => round.status === 'in_progress') ?? summary?.latestRound ?? null,
    [rounds, summary?.latestRound],
  );
  const isLoading = roundsQuery.isLoading || summaryQuery.isLoading;
  const isError = roundsQuery.isError || summaryQuery.isError;

  return (
    <main className="content-wrap">
      <div className="topbar">
        <div>
          <div className="eyebrow">Good morning, captain</div>
          <h1 className="display page-title" data-testid="text-dashboard-title">Keep the math off the course.</h1>
        </div>
        <Link href="/rounds/new" className="button button-accent" data-testid="button-start-round">
          <Plus size={16} /> Start a round
        </Link>
      </div>

      {isError ? (
        <ErrorState
          onRetry={() => {
            void roundsQuery.refetch();
            void summaryQuery.refetch();
          }}
        />
      ) : isLoading ? (
        <LoadingState />
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat-card featured" data-testid="card-stat-total-rounds">
              <div className="stat-label">Rounds tracked</div>
              <div className="stat-value" data-testid="text-total-rounds">{summary?.totalRounds ?? rounds.length}</div>
            </div>
            <div className="stat-card" data-testid="card-stat-active-rounds">
              <div className="stat-label">On the course</div>
              <div className="stat-value" data-testid="text-active-rounds">{summary?.activeRounds ?? 0}</div>
            </div>
            <div className="stat-card" data-testid="card-stat-holes">
              <div className="stat-label">Holes recorded</div>
              <div className="stat-value" data-testid="text-total-holes">{summary?.totalHolesRecorded ?? 0}</div>
            </div>
          </div>

          {activeRound && activeRound.status === 'in_progress' ? (
            <section aria-labelledby="active-round-heading">
              <div className="section-head">
                <h2 className="section-title" id="active-round-heading">Back on the fairway</h2>
                <span className="eyebrow">Active round</span>
              </div>
              <div className="card active-card" data-testid={`card-active-round-${activeRound.id}`}>
                <div className="active-intro">
                  <div className="eyebrow" style={{ color: 'hsl(var(--primary-foreground) / .55)' }}>{activeRound.course}</div>
                  <div className="active-name">{activeRound.name}</div>
                  <div className="hole-number" data-testid="text-active-hole">
                    {Math.min(activeRound.currentHole || 1, 18)} <span>of 18 · hole</span>
                  </div>
                </div>
                <div className="active-detail">
                  <div className="meta-row">
                    <span className="body-copy">Players in the book</span>
                    <AvatarStack players={activeRound.players} />
                  </div>
                  <div>
                    <div className="meta-row" style={{ marginBottom: 8 }}>
                      <span className="body-copy">Round progress</span>
                      <strong>{Math.min(activeRound.currentHole || 1, 18) - 1}/18</strong>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${Math.max(5, (((activeRound.currentHole || 1) - 1) / 18) * 100)}%` }} />
                    </div>
                  </div>
                  <Link href={`/rounds/${activeRound.id}`} className="button button-primary" data-testid="button-continue-round">
                    Continue scorecard <ArrowRight size={15} />
                  </Link>
                </div>
              </div>
            </section>
          ) : (
            <section className="card empty-state" data-testid="state-empty-active-round">
              <div className="empty-mark"><Flag size={25} /></div>
              <div className="display">No round on the books.</div>
              <p className="body-copy" style={{ maxWidth: 350, margin: '0 auto 18px' }}>
                Grab your group, pick your games, and let the scorecard handle the side bets.
              </p>
              <Link href="/rounds/new" className="button button-primary" data-testid="button-create-empty-round">
                <Plus size={15} /> Set up a round
              </Link>
            </section>
          )}

          <div className="section-head">
            <h2 className="section-title">Recent rounds</h2>
            <span className="eyebrow">{rounds.length} in the ledger</span>
          </div>
          <section className="card rounds-list" aria-label="Recent rounds" data-testid="list-rounds">
            {rounds.length === 0 ? (
              <div className="empty-state" style={{ padding: '42px 20px' }} data-testid="state-empty-rounds">
                <ClipboardList size={27} style={{ color: 'hsl(var(--muted-foreground))', marginBottom: 12 }} />
                <div className="display" style={{ fontSize: 22 }}>The ledger is still clean.</div>
                <p className="body-copy">Your finished rounds will live here.</p>
              </div>
            ) : (
              rounds.map((round) => <RoundRow key={round.id} round={round} />)
            )}
          </section>
        </>
      )}
    </main>
  );
}

function RoundRow({ round }: { round: Round }) {
  return (
    <Link href={`/rounds/${round.id}`} className="round-row" data-testid={`link-round-${round.id}`}>
      <div>
        <div className="round-name">{round.name}</div>
        <div className="round-course">{round.course} · {round.players.length} players</div>
        <div className="game-chip-row">
          {round.gameTypes.map((game) => <span className="game-chip" key={game}>{gameLabel(game)}</span>)}
        </div>
      </div>
      <div className="round-date">{formatDate(round.playedAt)}</div>
      <div className="round-stake">{formatMoney(round.stake)} / bet</div>
      <StatusPill status={round.status} />
      <ChevronRight size={16} style={{ color: 'hsl(var(--muted-foreground))' }} />
    </Link>
  );
}

type DraftPlayer = { name: string; handicap: string };

function NewRound() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createRound = useCreateRound();
  const [name, setName] = useState('Saturday skins');
  const [course, setCourse] = useState('');
  const [playedAt, setPlayedAt] = useState(new Date().toISOString().slice(0, 10));
  const [stake, setStake] = useState('1');
  const [wolfUnit, setWolfUnit] = useState('1');
  const [snakeStake, setSnakeStake] = useState('1');
  const [dotPoints, setDotPoints] = useState<Record<keyof DotPoints, string>>(
    Object.fromEntries(DOT_POINT_FIELDS.map(({ key }) => [key, String(DEFAULT_DOT_POINTS[key])])) as Record<keyof DotPoints, string>,
  );
  const [holePars, setHolePars] = useState<string[]>(DEFAULT_HOLE_PARS.map(String));
  const [holeStrokeIndexes, setHoleStrokeIndexes] = useState<string[]>(DEFAULT_HOLE_STROKE_INDEX.map(String));
  const [gameTypes, setGameTypes] = useState<GameType[]>(['wolf', 'snake', 'dots']);
  const [players, setPlayers] = useState<DraftPlayer[]>([
    { name: '', handicap: '' },
    { name: '', handicap: '' },
  ]);
  const [formError, setFormError] = useState('');
  
  const coursesQuery = useListCourses({}, { query: { queryKey: getListCoursesQueryKey({}) } });

  const changePlayer = (index: number, field: keyof DraftPlayer, value: string) => {
    setPlayers((current) => current.map((player, playerIndex) => (playerIndex === index ? { ...player, [field]: value } : player)));
  };
  const addPlayer = () => {
    if (players.length < 6) setPlayers((current) => [...current, { name: '', handicap: '' }]);
  };
  const removePlayer = (index: number) => {
    if (players.length > 2) setPlayers((current) => current.filter((_, playerIndex) => playerIndex !== index));
  };
  const toggleGame = (game: GameType) => {
    setGameTypes((current) =>
      current.includes(game) ? current.filter((item) => item !== game) : [...current, game],
    );
  };
  const changeDotPoint = (key: keyof DotPoints, value: string) => {
    setDotPoints((current) => ({ ...current, [key]: value }));
  };
  const changeHolePar = (hole: number, value: string) => {
    setHolePars((current) => current.map((par, index) => (index === hole - 1 ? value : par)));
  };
  const changeHoleStrokeIndex = (hole: number, value: string) => {
    setHoleStrokeIndexes((current) => current.map((si, index) => (index === hole - 1 ? value : si)));
  };
  
  const applySavedCourse = (courseId: number) => {
    const saved = coursesQuery.data?.find(c => c.id === courseId);
    if (saved) {
      setCourse(saved.name);
      setHolePars(saved.holes.map(h => String(h.par)));
      setHoleStrokeIndexes(saved.holes.map(h => String(h.strokeIndex)));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cleanPlayers = players.filter((player) => player.name.trim());
    const parsAreValid = holePars.length === 18 && holePars.every((par) => Number(par) >= 3 && Number(par) <= 6);
    const strokeIndexesAreValid = holeStrokeIndexes.length === 18 && holeStrokeIndexes.every((si) => Number(si) >= 1 && Number(si) <= 18);
    const pointValuesAreValid =
      Number(stake) > 0 &&
      Number(wolfUnit) > 0 &&
      Number(snakeStake) >= 0 &&
      DOT_POINT_FIELDS.every(({ key }) => Number(dotPoints[key]) >= 0);
    if (!name.trim() || !course.trim() || cleanPlayers.length < 2 || gameTypes.length === 0 || !parsAreValid || !strokeIndexesAreValid || !pointValuesAreValid) {
      setFormError('Add all round details, valid points, pars (3-6), and stroke indexes (1-18).');
      return;
    }
    setFormError('');
    createRound.mutate(
      {
        data: {
          name: name.trim(),
          course: course.trim(),
          playedAt,
          gameTypes,
          stake: Number(stake),
          dollarPerPoint: Number(stake),
          wolfUnit: Number(wolfUnit),
          snakeStake: Number(snakeStake),
          dotPoints: {
            greenie: Number(dotPoints.greenie),
            sandy: Number(dotPoints.sandy),
            birdie: Number(dotPoints.birdie),
            eagle: Number(dotPoints.eagle),
            poley: Number(dotPoints.poley),
            threeputt: Number(dotPoints.threeputt),
          },
          holePars: holePars.map(Number),
          holeStrokeIndex: holeStrokeIndexes.map(Number),
          players: cleanPlayers.map((player) => ({
            name: player.name.trim(),
            handicap: player.handicap.trim() ? Number(player.handicap) : 0,
          })),
        },
      },
      {
        onSuccess: (round: RoundDetail) => {
          void queryClient.invalidateQueries({ queryKey: getListRoundsQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          setLocation(`/rounds/${round.id}`);
        },
        onError: () => setFormError('That round could not be created. Check the details and try again.'),
      },
    );
  };

  return (
    <main className="content-wrap">
      <div className="topbar">
        <div>
          <div className="eyebrow">New scorecard</div>
          <h1 className="display page-title">Set the terms.</h1>
          <p className="body-copy" style={{ margin: '11px 0 0', maxWidth: 460 }}>A few details now means zero debate on the 18th green.</p>
        </div>
        <Link href="/" className="button button-quiet" data-testid="button-cancel-new-round"><ArrowLeft size={15} /> Dashboard</Link>
      </div>
      <form className="card form-card" onSubmit={submit} data-testid="form-new-round">
        <div className="form-grid">
          <div className="field full">
            <label htmlFor="round-name">Round name</label>
            <input id="round-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Saturday skins" data-testid="input-round-name" />
            <span className="field-hint">Give it a name your group will recognize later.</span>
          </div>
          <div className="field">
            <label htmlFor="course-name">Course</label>
            {coursesQuery.data && coursesQuery.data.length > 0 ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <input id="course-name" style={{ flex: 1 }} value={course} onChange={(event) => setCourse(event.target.value)} placeholder="e.g. Presidio Golf Course" data-testid="input-course" />
                <select 
                  onChange={(e) => { if(e.target.value) applySavedCourse(Number(e.target.value)) }}
                  style={{ width: '130px', flexShrink: 0, padding: '12px 13px', borderRadius: 9, border: '1px solid hsl(var(--input))', background: 'hsl(var(--card))' }}
                  data-testid="select-saved-course"
                  title="Load saved course"
                >
                  <option value="">Load saved...</option>
                  {coursesQuery.data.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            ) : (
              <input id="course-name" value={course} onChange={(event) => setCourse(event.target.value)} placeholder="e.g. Presidio Golf Course" data-testid="input-course" />
            )}
          </div>
          <div className="field">
            <label htmlFor="played-at">Date</label>
            <input id="played-at" type="date" value={playedAt} onChange={(event) => setPlayedAt(event.target.value)} data-testid="input-played-at" />
          </div>
          <div className="field full">
            <label>Games in play</label>
            <div className="game-toggle">
              {ALL_GAME_TYPES.map((game) => (
                <label className="check-label" key={game.value} htmlFor={`game-${game.value}`} title={game.blurb}>
                  <input id={`game-${game.value}`} type="checkbox" checked={gameTypes.includes(game.value)} onChange={() => toggleGame(game.value)} data-testid={`checkbox-game-${game.value}`} />
                  {game.label}
                </label>
              ))}
            </div>
            <span className="field-hint">Mix and match — run any combination at once.</span>
          </div>
          <div className="field">
            <label htmlFor="stake">Base value per point / bet ($)</label>
            <input id="stake" type="number" min="0.01" step="0.01" value={stake} onChange={(event) => setStake(event.target.value)} data-testid="input-stake" />
            <span className="field-hint">Nassau uses this value per bet. Wolf, Snake, and Dots use the point values below.</span>
          </div>
          <div className="field">
            <label>Players <span style={{ color: 'hsl(var(--muted-foreground))', fontWeight: 400 }}>(2–6)</span></label>
            <span className="field-hint">Add a handicap for accurate net Wolf scoring — 0 if you don't know it.</span>
          </div>
          <div className="field full">
            <div className="setup-section">
              <div className="setup-section-heading">
                <div>
                  <div className="eyebrow">Side bet values</div>
                  <strong>Set each game’s points independently</strong>
                </div>
                <span className="field-hint">1 point = {formatMoney(Number(stake) || 0)}</span>
              </div>
              <div className="point-settings-grid">
                <div className="field">
                  <label htmlFor="wolf-unit">Wolf points</label>
                  <input id="wolf-unit" type="number" min="0.01" step="0.01" value={wolfUnit} onChange={(event) => setWolfUnit(event.target.value)} data-testid="input-wolf-points" />
                  <span className="field-hint">Points paid for a standard Wolf win.</span>
                </div>
                <div className="field">
                  <label htmlFor="snake-stake">Snake points</label>
                  <input id="snake-stake" type="number" min="0" step="0.5" value={snakeStake} onChange={(event) => setSnakeStake(event.target.value)} data-testid="input-snake-points" />
                  <span className="field-hint">Points each player pays the Snake holder.</span>
                </div>
                <div className="field full">
                  <label>Dots points</label>
                  <div className="dot-point-settings">
                    {DOT_POINT_FIELDS.map(({ key, label }) => (
                      <label className="compact-number" key={key} htmlFor={`dot-point-${key}`}>
                        <span>{label}</span>
                        <input id={`dot-point-${key}`} type="number" min="0" step="0.5" value={dotPoints[key]} onChange={(event) => changeDotPoint(key, event.target.value)} data-testid={`input-dots-points-${key}`} />
                      </label>
                    ))}
                  </div>
                  <span className="field-hint">Choose how many points each Dots event is worth.</span>
                </div>
              </div>
            </div>
          </div>
          <div className="field full">
            <div className="setup-section">
              <div className="setup-section-heading">
                <div>
                  <div className="eyebrow">Course setup</div>
                  <strong>Confirm par and stroke index</strong>
                </div>
                <span className="field-hint">Used for dots and net scoring.</span>
              </div>
              <div style={{ overflowX: 'auto', paddingBottom: 10 }}>
                <div style={{ display: 'flex', gap: 8, minWidth: 'max-content' }} data-testid="grid-hole-pars">
                  {holePars.map((par, index) => (
                    <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 50 }}>
                      <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'hsl(var(--muted-foreground))' }}>{index + 1}</div>
                      <input 
                        id={`hole-par-${index + 1}`}
                        type="number" 
                        min="3" max="6" step="1" 
                        value={par} 
                        onChange={(event) => changeHolePar(index + 1, event.target.value)} 
                        title={`Hole ${index + 1} Par`} 
                        data-testid={`input-hole-par-${index + 1}`}
                        style={{ width: '100%', padding: '6px 4px', textAlign: 'center', fontSize: 13, fontWeight: 700, fontFamily: 'var(--app-font-mono)', borderRadius: 6, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))' }} 
                      />
                      <input 
                        id={`hole-si-${index + 1}`}
                        type="number" 
                        min="1" max="18" step="1" 
                        value={holeStrokeIndexes[index]} 
                        onChange={(event) => changeHoleStrokeIndex(index + 1, event.target.value)} 
                        title={`Hole ${index + 1} Stroke Index`} 
                        data-testid={`input-hole-si-${index + 1}`}
                        style={{ width: '100%', padding: '6px 4px', textAlign: 'center', fontSize: 11, color: 'hsl(var(--muted-foreground))', fontFamily: 'var(--app-font-mono)', borderRadius: 6, border: '1px solid hsl(var(--border))', background: 'transparent' }} 
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div className="field-hint" style={{ marginTop: 4 }}>Top: Par. Bottom: Stroke Index.</div>
            </div>
          </div>
          <div className="field full">
            <div className="players-list">
              {players.map((player, index) => (
                <div className="player-input" key={`player-${index}`}>
                  <span className="avatar" style={{ marginLeft: 0, flex: '0 0 33px' }}>{getInitials(player.name || `Player ${index + 1}`)}</span>
                  <input value={player.name} onChange={(event) => changePlayer(index, 'name', event.target.value)} placeholder={`Player ${index + 1}`} aria-label={`Player ${index + 1} name`} data-testid={`input-player-${index + 1}`} />
                  <div>
                    <input
                      className="field-hcp"
                      type="number"
                      min="0"
                      max="54"
                      value={player.handicap}
                      onChange={(event) => changePlayer(index, 'handicap', event.target.value)}
                      placeholder="Hcp"
                      aria-label={`Player ${index + 1} handicap`}
                      data-testid={`input-player-handicap-${index + 1}`}
                    />
                    <div className="player-input-hcp-label">Hcp</div>
                  </div>
                  {players.length > 2 ? <button type="button" className="button button-ghost" onClick={() => removePlayer(index)} aria-label={`Remove player ${index + 1}`} data-testid={`button-remove-player-${index + 1}`}><X size={15} /></button> : null}
                </div>
              ))}
            </div>
            {players.length < 6 ? <button type="button" className="button button-ghost" onClick={addPlayer} style={{ marginTop: 10 }} data-testid="button-add-player"><Plus size={14} /> Add player</button> : null}
          </div>
        </div>
        {formError ? <div className="error-state" style={{ marginTop: 20, padding: 13, textAlign: 'left', fontSize: 13 }} data-testid="text-form-error">{formError}</div> : null}
        <div className="form-footer">
          <Link href="/" className="button button-ghost" data-testid="link-cancel-round">Cancel</Link>
          <button type="submit" className="button button-primary" disabled={createRound.isPending} data-testid="button-submit-round">
            {createRound.isPending ? <LoaderCircle size={15} className="spin" /> : <Flag size={15} />}
            {createRound.isPending ? 'Creating…' : 'Tee off'}
          </button>
        </div>
      </form>
    </main>
  );
}

function RoundSetupEditor({ round, onClose, onSaved }: { round: Round; onClose: () => void; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const updateRound = useUpdateRound();
  const [wolfUnit, setWolfUnit] = useState(String(round.wolfUnit));
  const [snakeStake, setSnakeStake] = useState(String(round.snakeStake));
  const [dotPoints, setDotPoints] = useState<DotPoints>(round.dotPoints);
  const [holePars, setHolePars] = useState<string[]>(round.holePars.map(String));
  const [holeStrokeIndexes, setHoleStrokeIndexes] = useState<string[]>((round.holeStrokeIndex || DEFAULT_HOLE_STROKE_INDEX).map(String));
  const [error, setError] = useState('');

  useEffect(() => {
    setWolfUnit(String(round.wolfUnit));
    setSnakeStake(String(round.snakeStake));
    setDotPoints(round.dotPoints);
    setHolePars(round.holePars.map(String));
    setHoleStrokeIndexes((round.holeStrokeIndex || DEFAULT_HOLE_STROKE_INDEX).map(String));
  }, [round]);

  const changeHolePar = (hole: number, value: string) => {
    setHolePars((current) => current.map((par, index) => (index === hole - 1 ? value : par)));
  };
  const changeHoleStrokeIndex = (hole: number, value: string) => {
    setHoleStrokeIndexes((current) => current.map((si, index) => (index === hole - 1 ? value : si)));
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsAreValid = holePars.length === 18 && holePars.every((par) => Number(par) >= 3 && Number(par) <= 6);
    const strokeIndexesAreValid = holeStrokeIndexes.length === 18 && holeStrokeIndexes.every((si) => Number(si) >= 1 && Number(si) <= 18);
    const valuesAreValid = Number(wolfUnit) > 0 && Number(snakeStake) >= 0 && DOT_POINT_FIELDS.every(({ key }) => Number(dotPoints[key]) >= 0);
    if (!parsAreValid || !strokeIndexesAreValid || !valuesAreValid) {
      setError('Use a Wolf value > 0, Snake value >= 0, pars 3-6, and stroke indexes 1-18.');
      return;
    }
    setError('');
    const data: RoundUpdate = {
      wolfUnit: Number(wolfUnit),
      snakeStake: Number(snakeStake),
      dotPoints,
      holePars: holePars.map(Number),
      holeStrokeIndex: holeStrokeIndexes.map(Number),
    };
    updateRound.mutate(
      { roundId: round.id, data },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetRoundQueryKey(round.id) });
          void queryClient.invalidateQueries({ queryKey: getGetRoundSettlementQueryKey(round.id) });
          void queryClient.invalidateQueries({ queryKey: getListRoundsQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          onSaved();
        },
        onError: () => setError('The setup could not be saved. Check your connection and try again.'),
      },
    );
  };

  return (
    <form className="card setup-editor" onSubmit={submit} data-testid="form-edit-round-settings">
      <div className="setup-section-heading">
        <div>
          <div className="eyebrow">Round setup</div>
          <strong>Update values before the next score</strong>
        </div>
        <span className="field-hint">Changes recalculate the ledger immediately.</span>
      </div>
      <div className="point-settings-grid">
        <div className="field">
          <label htmlFor="edit-wolf-points">Wolf points</label>
          <input id="edit-wolf-points" type="number" min="0.01" step="0.01" value={wolfUnit} onChange={(event) => setWolfUnit(event.target.value)} data-testid="input-edit-wolf-points" />
        </div>
        <div className="field">
          <label htmlFor="edit-snake-points">Snake points</label>
          <input id="edit-snake-points" type="number" min="0" step="0.5" value={snakeStake} onChange={(event) => setSnakeStake(event.target.value)} data-testid="input-edit-snake-points" />
        </div>
        <div className="field full">
          <label>Dots points</label>
          <div className="dot-point-settings">
            {DOT_POINT_FIELDS.map(({ key, label }) => (
              <label className="compact-number" key={key} htmlFor={`edit-dot-point-${key}`}>
                <span>{label}</span>
                <input id={`edit-dot-point-${key}`} type="number" min="0" step="0.5" value={dotPoints[key]} onChange={(event) => setDotPoints((current) => ({ ...current, [key]: Number(event.target.value) }))} data-testid={`input-edit-dots-points-${key}`} />
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="field">
        <label>Course setup</label>
        <div style={{ overflowX: 'auto', paddingBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8, minWidth: 'max-content' }} data-testid="grid-edit-hole-pars">
            {holePars.map((par, index) => (
              <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 50 }}>
                <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'hsl(var(--muted-foreground))' }}>{index + 1}</div>
                <input 
                  id={`edit-hole-par-${index + 1}`}
                  type="number" min="3" max="6" step="1" 
                  value={par} 
                  onChange={(event) => changeHolePar(index + 1, event.target.value)} 
                  title={`Hole ${index + 1} Par`}
                  data-testid={`input-edit-hole-par-${index + 1}`}
                  style={{ width: '100%', padding: '6px 4px', textAlign: 'center', fontSize: 13, fontWeight: 700, fontFamily: 'var(--app-font-mono)', borderRadius: 6, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))' }} 
                />
                <input 
                  id={`edit-hole-si-${index + 1}`}
                  type="number" min="1" max="18" step="1" 
                  value={holeStrokeIndexes[index]} 
                  onChange={(event) => changeHoleStrokeIndex(index + 1, event.target.value)} 
                  title={`Hole ${index + 1} Stroke Index`}
                  data-testid={`input-edit-hole-si-${index + 1}`}
                  style={{ width: '100%', padding: '6px 4px', textAlign: 'center', fontSize: 11, color: 'hsl(var(--muted-foreground))', fontFamily: 'var(--app-font-mono)', borderRadius: 6, border: '1px solid hsl(var(--border))', background: 'transparent' }} 
                />
              </div>
            ))}
          </div>
        </div>
        <div className="field-hint">Top: Par. Bottom: Stroke Index.</div>
      </div>
      {error ? <div className="error-state" style={{ padding: 11, textAlign: 'left', fontSize: 12 }} data-testid="text-settings-error">{error}</div> : null}
      <div className="form-footer">
        <span className="field-hint">Par changes affect future scoring and any Dots already recorded.</span>
        <button type="button" className="button button-ghost" onClick={onClose} data-testid="button-cancel-round-settings">Cancel</button>
        <button type="submit" className="button button-primary" disabled={updateRound.isPending} data-testid="button-save-round-settings">
          {updateRound.isPending ? <LoaderCircle size={15} /> : <Check size={15} />} {updateRound.isPending ? 'Saving…' : 'Save setup'}
        </button>
      </div>
    </form>
  );
}

type SubTab = 'score' | 'wolf' | 'snake' | 'dots';
type DotState = { greenie: boolean; sandy: boolean; poley: boolean };

function Scorecard() {
  const params = useParams<{ id?: string }>();
  const roundId = Number(params.id);
  const validId = Number.isFinite(roundId);
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const roundQuery = useGetRound(roundId, { query: { enabled: validId, queryKey: getGetRoundQueryKey(roundId) } });
  const holesQuery = useListHoleResults(roundId, { query: { enabled: validId, queryKey: getListHoleResultsQueryKey(roundId) } });
  const settlementQuery = useGetRoundSettlement(roundId, { query: { enabled: validId, queryKey: getGetRoundSettlementQueryKey(roundId) } });
  const updateRound = useUpdateRound();
  const deleteRound = useDeleteRound();
  const recordHole = useRecordHole();
  const round = roundQuery.data;
  const holes = holesQuery.data ?? round?.holes ?? [];
  const settlement = settlementQuery.data ?? round?.settlement;
  const [selectedHole, setSelectedHole] = useState(1);
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('score');
  const [scores, setScores] = useState<Record<string, string>>({});
  const [putts, setPutts] = useState<Record<string, string>>({});
  const [wolfPartnerIds, setWolfPartnerIds] = useState<string[]>([]);
  const [wolfOverridePlayerId, setWolfOverridePlayerId] = useState('');
  const [wolfManualResult, setWolfManualResult] = useState<'' | 'wolfwin' | 'oppwin' | 'push'>('');
  const [snakeHolderPlayerId, setSnakeHolderPlayerId] = useState('');
  const [dotFlags, setDotFlags] = useState<Record<string, DotState>>({});
  const [winnerPlayerId, setWinnerPlayerId] = useState('');
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  const isBusy = recordHole.isPending || updateRound.isPending || deleteRound.isPending;

  const players = round?.players ?? [];
  const gameTypes = round?.gameTypes ?? [];
  const hasWolf = gameTypes.includes('wolf');
  const hasSnake = gameTypes.includes('snake');
  const hasDots = gameTypes.includes('dots');
  const hasNassau = gameTypes.includes('nassau');
  const wantsPutts = hasSnake || hasDots;

  const selectedResult = useMemo(
    () => holes.find((hole) => hole.hole === selectedHole),
    [holes, selectedHole],
  );

  useEffect(() => {
    const nextScores: Record<string, string> = {};
    selectedResult?.scores.forEach((score) => { nextScores[score.playerId] = String(score.strokes); });
    setScores(nextScores);
    const nextPutts: Record<string, string> = {};
    selectedResult?.putts?.forEach((putt) => { nextPutts[putt.playerId] = String(putt.putts); });
    setPutts(nextPutts);
    setWolfPartnerIds(selectedResult?.wolfPartnerIds ?? []);
    setWolfOverridePlayerId(selectedResult?.wolfOverridePlayerId ?? '');
    setWolfManualResult(selectedResult?.wolfManualResult ?? '');
    setSnakeHolderPlayerId(selectedResult?.snakeHolderPlayerId ?? '');
    const nextDots: Record<string, DotState> = {};
    selectedResult?.dots?.forEach((dot) => { nextDots[dot.playerId] = { greenie: !!dot.greenie, sandy: !!dot.sandy, poley: !!dot.poley }; });
    setDotFlags(nextDots);
    setWinnerPlayerId(selectedResult?.winnerPlayerId ?? '');
  }, [selectedHole, selectedResult]);

  const autoWolfPlayerId = players.length > 0 ? players[(selectedHole - 1) % players.length]?.id ?? '' : '';
  const effectiveWolfPlayerId = wolfOverridePlayerId || autoWolfPlayerId;

  const chooseHole = (hole: number) => {
    setSelectedHole(hole);
    setActiveSubTab('score');
  };

  const toggleWolfPartner = (playerId: string) => {
    setWolfPartnerIds((current) => (current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId]));
  };
  const toggleDot = (playerId: string, key: keyof DotState) => {
    setDotFlags((current) => ({
      ...current,
      [playerId]: { ...(current[playerId] ?? { greenie: false, sandy: false, poley: false }), [key]: !current[playerId]?.[key] },
    }));
  };

  const saveHole = (event: FormEvent) => {
    event.preventDefault();
    if (!round || players.some((player) => Number(scores[player.id]) < 1)) {
      setNotice('Add a valid stroke count for every player.');
      return;
    }
    recordHole.mutate(
      {
        roundId,
        data: {
          hole: selectedHole,
          scores: players.map((player) => ({ playerId: player.id, strokes: Number(scores[player.id]) })),
          putts: wantsPutts
            ? players.filter((player) => putts[player.id]?.trim()).map((player) => ({ playerId: player.id, putts: Number(putts[player.id]) }))
            : [],
          wolfPartnerIds: hasWolf ? wolfPartnerIds.filter((id) => id !== effectiveWolfPlayerId) : [],
          wolfOverridePlayerId: hasWolf ? (wolfOverridePlayerId || null) : null,
          wolfManualResult: hasWolf && wolfManualResult ? wolfManualResult : null,
          snakeHolderPlayerId: hasSnake ? (snakeHolderPlayerId || null) : null,
          dots: hasDots
            ? players.map((player) => ({ playerId: player.id, ...(dotFlags[player.id] ?? { greenie: false, sandy: false, poley: false }) }))
            : [],
          winnerPlayerId: hasNassau ? (winnerPlayerId || null) : null,
        },
      },
      {
        onSuccess: () => {
          setNotice(`Hole ${selectedHole} is in the books.`);
          void queryClient.invalidateQueries({ queryKey: getGetRoundQueryKey(roundId) });
          void queryClient.invalidateQueries({ queryKey: getListHoleResultsQueryKey(roundId) });
          void queryClient.invalidateQueries({ queryKey: getGetRoundSettlementQueryKey(roundId) });
          void queryClient.invalidateQueries({ queryKey: getListRoundsQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          if (selectedHole < 18) chooseHole(selectedHole + 1);
        },
        onError: () => setNotice('The hole did not save. Check your connection and try again.'),
      },
    );
  };

  const changeStatus = () => {
    if (!round) return;
    updateRound.mutate(
      { roundId, data: { status: round.status === 'completed' ? 'in_progress' : 'completed' } },
      {
        onSuccess: () => {
          setEditing(false);
          setNotice(round.status === 'completed' ? 'Round reopened for edits.' : 'Round complete. The ledger is ready.');
          void queryClient.invalidateQueries({ queryKey: getGetRoundQueryKey(roundId) });
          void queryClient.invalidateQueries({ queryKey: getListRoundsQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        },
      },
    );
  };

  const saveEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('edit-name') ?? '').trim();
    const course = String(form.get('edit-course') ?? '').trim();
    if (!name || !course) return;
    updateRound.mutate({ roundId, data: { name, course } }, {
      onSuccess: () => {
        setEditing(false);
        setNotice('Round details updated.');
        void queryClient.invalidateQueries({ queryKey: getGetRoundQueryKey(roundId) });
        void queryClient.invalidateQueries({ queryKey: getListRoundsQueryKey() });
      },
    });
  };

  const removeRound = () => {
    if (!round || !window.confirm(`Delete "${round.name}" from the ledger?`)) return;
    deleteRound.mutate({ roundId }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListRoundsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        setLocation('/');
      },
    });
  };

  if (!validId) return <main className="content-wrap"><ErrorState onRetry={() => setLocation('/')} message="That round number is not on the books." /></main>;
  if (roundQuery.isLoading) return <main className="content-wrap"><LoadingState label="Loading round scorecard" /></main>;
  if (roundQuery.isError || !round) return <main className="content-wrap"><ErrorState onRetry={() => void roundQuery.refetch()} message="This round could not be found." /></main>;

  const subTabs: { key: SubTab; label: string }[] = [
    { key: 'score', label: wantsPutts ? 'Score & putts' : 'Score' },
    ...(hasWolf ? [{ key: 'wolf' as const, label: 'Wolf' }] : []),
    ...(hasSnake ? [{ key: 'snake' as const, label: 'Snake' }] : []),
    ...(hasDots ? [{ key: 'dots' as const, label: 'Dots' }] : []),
  ];

  const wolfResultLabel: Record<string, string> = { wolfwin: 'Wolf team won', oppwin: 'Opponents won', push: 'Push' };
  const autoWolfName = players.find((p) => p.id === autoWolfPlayerId)?.name ?? '—';
  const snakeHolderName = players.find((p) => p.id === settlement?.snakeHolderPlayerId)?.name ?? null;
  const snakeHoleHolderName = players.find((p) => p.id === selectedResult?.snakeHolderPlayerId)?.name ?? null;
  const snakeTiePlayers = (selectedResult?.snakeTiePlayerIds ?? [])
    .map((id) => players.find((player) => player.id === id))
    .filter((player): player is Player => !!player);

  return (
    <main className="content-wrap">
      <div className="topbar" style={{ marginBottom: 23 }}>
        <div>
          <div className="eyebrow">{round.course} · {formatDate(round.playedAt)}</div>
          {!editing ? (
            <>
              <h1 className="display page-title" style={{ fontSize: 'clamp(33px, 4vw, 47px)' }} data-testid="text-round-title">{round.name}</h1>
              <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <StatusPill status={round.status} />
                <div className="game-chip-row" style={{ marginTop: 0 }}>
                  {round.gameTypes.map((game) => <span className="game-chip" key={game}>{gameLabel(game)}</span>)}
                </div>
              </div>
            </>
          ) : (
            <form onSubmit={saveEdit} style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }} data-testid="form-edit-round">
              <input name="edit-name" defaultValue={round.name} aria-label="Round name" data-testid="input-edit-round-name" style={{ padding: '9px 11px', borderRadius: 8, border: '1px solid hsl(var(--input))', background: 'hsl(var(--card))' }} />
              <input name="edit-course" defaultValue={round.course} aria-label="Course" data-testid="input-edit-course" style={{ padding: '9px 11px', borderRadius: 8, border: '1px solid hsl(var(--input))', background: 'hsl(var(--card))' }} />
              <button className="button button-primary" type="submit" disabled={updateRound.isPending} data-testid="button-save-round-edit"><Check size={14} /> Save</button>
              <button className="button button-ghost" type="button" onClick={() => setEditing(false)} data-testid="button-cancel-round-edit">Cancel</button>
            </form>
          )}
        </div>
        <div className="score-actions">
          <button className="button button-quiet" onClick={() => setEditing((value) => !value)} data-testid="button-edit-round"><ClipboardList size={14} /> Edit</button>
          <button className="button button-danger" onClick={removeRound} disabled={isBusy} data-testid="button-delete-round"><Trash2 size={14} /></button>
        </div>
      </div>

      {editing ? (
        <RoundSetupEditor
          round={round}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setNotice('Round setup updated. The ledger has been recalculated.');
          }}
        />
      ) : (
        <section className="card round-settings-summary" aria-label="Active round setup" data-testid="panel-round-settings">
          <div>
            <div className="eyebrow">Active setup</div>
            <strong>Stakes &amp; course</strong>
          </div>
          <div className="settings-summary-values">
            {hasWolf ? <span><b>Wolf</b> {formatPoints(round.wolfUnit)} pt</span> : null}
            {hasSnake ? <span><b>Snake</b> {formatPoints(round.snakeStake)} pt</span> : null}
            {hasDots ? <span><b>Dots</b> {formatPoints(round.dotPoints.birdie)} pt birdie</span> : null}
            <span><b>Base</b> {formatMoney(round.dollarPerPoint)} / pt</span>
          </div>
          <div className="par-summary">
            <span className="eyebrow">Hole pars</span>
            {round.holePars.map((par, index) => <span key={index} className={selectedHole === index + 1 ? 'active' : ''}>{index + 1} <b>{par}</b></span>)}
          </div>
        </section>
      )}

      <div className="score-layout">
        <section className="card scorecard" aria-label="Round scorecard">
          <div className="score-head">
            <div>
              <div className="eyebrow">Hole by hole</div>
              <h1 className="display">Keep it honest.</h1>
              <div style={{ fontSize: 12, color: 'hsl(var(--primary-foreground) / .58)' }}>
                {holes.length} of 18 holes recorded · Hole {selectedHole} par {round.holePars[selectedHole - 1] ?? 4}
              </div>
            </div>
            <button className="button button-accent" onClick={changeStatus} disabled={isBusy} data-testid="button-toggle-round-status">
              {round.status === 'completed' ? <RefreshCw size={14} /> : <Trophy size={14} />}
              {round.status === 'completed' ? 'Re-open round' : 'Complete round'}
            </button>
          </div>
          <div className="hole-tabs" role="tablist" aria-label="Select hole">
            {Array.from({ length: 18 }, (_, index) => index + 1).map((hole) => (
              <button
                key={hole}
                className={`hole-tab ${holes.some((result) => result.hole === hole) ? 'recorded' : ''} ${selectedHole === hole ? 'current' : ''}`}
                onClick={() => chooseHole(hole)}
                role="tab"
                aria-selected={selectedHole === hole}
                data-testid={`button-hole-${hole}`}
              >{hole}</button>
            ))}
          </div>
          {subTabs.length > 1 ? (
            <div className="sub-tabs" role="tablist" aria-label="Hole detail view">
              {subTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`sub-tab ${activeSubTab === tab.key ? 'active' : ''}`}
                  onClick={() => setActiveSubTab(tab.key)}
                  role="tab"
                  aria-selected={activeSubTab === tab.key}
                  data-testid={`button-subtab-${tab.key}`}
                >{tab.label}</button>
              ))}
            </div>
          ) : null}
          <form className="hole-editor" onSubmit={saveHole} data-testid="form-record-hole">
            <div className="hole-editor-head">
              <div>
                <div className="eyebrow">Now recording</div>
                <h2>Hole {selectedHole}</h2>
              </div>
              {selectedResult ? <span className="status-pill live"><Check size={11} /> Recorded</span> : <span className="eyebrow">Not recorded</span>}
            </div>

            {activeSubTab === 'score' ? (
              <>
                <div className="score-fields">
                  {players.map((player) => (
                    <div className="score-player" key={player.id}>
                      <div className="score-player-name"><span className="avatar" style={{ width: 25, height: 25, marginLeft: 0, border: 0 }}>{player.initials}</span>{player.name}<span>strokes</span></div>
                      <input type="number" min="1" max="30" value={scores[player.id] ?? ''} onChange={(event) => setScores((current) => ({ ...current, [player.id]: event.target.value }))} aria-label={`${player.name} strokes`} data-testid={`input-strokes-${player.id}`} />
                      {wantsPutts ? (
                        <>
                          <span className="score-player-putt-label">Putts</span>
                          <input className="score-player-putt" type="number" min="0" max="12" value={putts[player.id] ?? ''} onChange={(event) => setPutts((current) => ({ ...current, [player.id]: event.target.value }))} aria-label={`${player.name} putts`} data-testid={`input-putts-${player.id}`} />
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
                {hasNassau ? (
                  <div className="select-row">
                    <div className="field">
                      <label htmlFor="winner-player">Nassau hole winner (optional)</label>
                      <select id="winner-player" value={winnerPlayerId} onChange={(event) => setWinnerPlayerId(event.target.value)} data-testid="select-winner-player">
                        <option value="">Lowest score wins</option>
                        {players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
                      </select>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            {activeSubTab === 'wolf' && hasWolf ? (
              <div className="wolf-panel">
                <div className="wolf-summary" data-testid="text-wolf-current">
                  Wolf this hole: <strong>{players.find((p) => p.id === effectiveWolfPlayerId)?.name ?? '—'}</strong> (rotation: {autoWolfName})
                </div>
                <div className="field">
                  <label htmlFor="wolf-override">Override wolf (optional)</label>
                  <select id="wolf-override" value={wolfOverridePlayerId} onChange={(event) => { setWolfOverridePlayerId(event.target.value); setWolfPartnerIds([]); }} data-testid="select-wolf-override">
                    <option value="">Use rotation ({autoWolfName})</option>
                    {players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Partners (leave empty to go it alone)</label>
                  <div className="game-toggle">
                    {players.filter((player) => player.id !== effectiveWolfPlayerId).map((player) => (
                      <label className="check-label small" key={player.id}>
                        <input type="checkbox" checked={wolfPartnerIds.includes(player.id)} onChange={() => toggleWolfPartner(player.id)} data-testid={`checkbox-wolf-partner-${player.id}`} />
                        {player.name}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="wolf-result">Result</label>
                  <select id="wolf-result" value={wolfManualResult} onChange={(event) => setWolfManualResult(event.target.value as typeof wolfManualResult)} data-testid="select-wolf-result">
                    <option value="">Auto — best net ball</option>
                    <option value="wolfwin">Wolf team wins</option>
                    <option value="oppwin">Opponents win</option>
                    <option value="push">Push (carries to next hole)</option>
                  </select>
                </div>
                {selectedResult ? (
                  <div className="wolf-result-readout" data-testid="text-wolf-readout">
                    Recorded: {selectedResult.wolfResult ? wolfResultLabel[selectedResult.wolfResult] : 'Not yet decided'}
                    {selectedResult.wolfCarry > 1 ? ` · ${selectedResult.wolfCarry}× stake carried in` : ''}
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeSubTab === 'snake' && hasSnake ? (
              <div className="snake-panel">
                <p className="body-copy">Snake passes automatically to the qualifying player with the most putts. When that count is tied, the host chooses the holder.</p>
                {snakeTiePlayers.length > 1 ? (
                  <div className="snake-tie" data-testid="panel-snake-tie">
                    <div>
                      <strong>Snake tie on hole {selectedHole}</strong>
                      <p>{snakeTiePlayers.map((player) => player.name).join(' and ')} tied with the highest qualifying putt count.</p>
                    </div>
                    <div className="field">
                      <label htmlFor="snake-holder">Choose the holder</label>
                      <select
                        id="snake-holder"
                        value={snakeHolderPlayerId}
                        onChange={(event) => setSnakeHolderPlayerId(event.target.value)}
                        data-testid="select-snake-holder"
                      >
                        {snakeTiePlayers.map((player) => (
                          <option key={player.id} value={player.id}>{player.name}</option>
                        ))}
                      </select>
                      <span className="field-hint">Save the hole again to update the ledger and settlement.</span>
                    </div>
                  </div>
                ) : selectedResult ? (
                  <div className="snake-auto" data-testid="text-snake-auto">
                    No tie on this hole. {snakeHoleHolderName ? `${snakeHoleHolderName} holds the Snake after hole ${selectedHole}.` : 'Nobody qualified for the Snake.'}
                  </div>
                ) : (
                  <div className="snake-auto">Record putts for this hole to check for a Snake tie.</div>
                )}
                <div className="snake-holder" data-testid="text-snake-holder">
                  Current holder: <strong>{snakeHolderName ?? 'Nobody yet'}</strong>
                </div>
              </div>
            ) : null}

            {activeSubTab === 'dots' && hasDots ? (
              <div className="dot-grid">
                {players.map((player) => {
                  const earned = selectedResult?.dotsEarned?.find((dot) => dot.playerId === player.id);
                  return (
                    <div className="dot-row" key={player.id}>
                      <span className="dot-row-name">{player.name}</span>
                      <label className="check-label small">
                        <input type="checkbox" checked={!!dotFlags[player.id]?.greenie} onChange={() => toggleDot(player.id, 'greenie')} data-testid={`checkbox-greenie-${player.id}`} /> Greenie
                      </label>
                      <label className="check-label small">
                        <input type="checkbox" checked={!!dotFlags[player.id]?.sandy} onChange={() => toggleDot(player.id, 'sandy')} data-testid={`checkbox-sandy-${player.id}`} /> Sandy
                      </label>
                      <label className="check-label small">
                        <input type="checkbox" checked={!!dotFlags[player.id]?.poley} onChange={() => toggleDot(player.id, 'poley')} data-testid={`checkbox-poley-${player.id}`} /> Poley
                      </label>
                      <span className="dot-auto-badges">
                        {earned?.eagle ? <span className="badge-chip">Eagle</span> : earned?.birdie ? <span className="badge-chip">Birdie</span> : null}
                        {earned?.threeputt ? <span className="badge-chip warn">3-putt</span> : null}
                      </span>
                    </div>
                  );
                })}
                <span className="field-hint">Birdies, eagles, and 3-putts are derived automatically from strokes and putts.</span>
              </div>
            ) : null}

            <div className="form-footer" style={{ marginTop: 22, paddingTop: 17 }}>
              <span className="body-copy" style={{ fontSize: 12, marginRight: 'auto' }}>{selectedResult ? 'Change the numbers and save again.' : 'Record this hole when the group agrees.'}</span>
              <button type="submit" className="button button-primary" disabled={isBusy} data-testid="button-save-hole">
                {recordHole.isPending ? <LoaderCircle size={15} /> : <Check size={15} />}
                {recordHole.isPending ? 'Saving…' : selectedResult ? 'Update hole' : 'Save hole'}
              </button>
            </div>
          </form>
        </section>

        <LedgerPanel settlement={settlement} players={players} gameTypes={gameTypes} loading={settlementQuery.isLoading} />
      </div>
      {notice ? <div className="toast-note" role="status" data-testid="status-action-notice">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notice" data-testid="button-dismiss-notice" style={{ background: 'none', border: 0, color: 'inherit', marginLeft: 12, padding: 0 }}><X size={14} /></button></div> : null}
    </main>
  );
}

function LedgerPanel({ settlement, players, gameTypes, loading }: { settlement?: Settlement; players: Player[]; gameTypes: GameType[]; loading: boolean }) {
  const hasWolf = gameTypes.includes('wolf');
  const hasSnake = gameTypes.includes('snake');
  const hasDots = gameTypes.includes('dots');
  const hasNassau = gameTypes.includes('nassau');
  const snakeHolderName = players.find((p) => p.id === settlement?.snakeHolderPlayerId)?.name;

  return (
    <aside className="card side-panel" aria-label="Current settlement" data-testid="panel-settlement">
      <h3>The ledger</h3>
      <p className="body-copy" style={{ fontSize: 12, margin: '-10px 0 10px' }}>Updates after every saved hole.</p>
      {loading ? (
        <><div className="skeleton" style={{ height: 44, marginBottom: 8 }} /><div className="skeleton" style={{ height: 44 }} /></>
      ) : settlement?.balances?.length ? (
        <>
          {settlement.balances.map((balance) => (
            <div className="settlement-row" key={balance.playerId} data-testid={`row-settlement-${balance.playerId}`}>
              <div className="settlement-person"><span className="avatar" style={{ marginLeft: 0, width: 29, height: 29 }}>{getInitials(balance.playerName)}</span>{balance.playerName}</div>
              <span className={`balance ${balance.amount >= 0 ? 'up' : 'down'}`}>{balance.amount >= 0 ? '+' : ''}{formatMoney(balance.amount)}</span>
            </div>
          ))}

          {settlement.payouts.length > 0 ? (
            <>
              <div className="ledger-section-title">Who pays whom</div>
              {settlement.payouts.map((payout, index) => (
                <div className="payout-row" key={`${payout.fromPlayerId}-${payout.toPlayerId}-${index}`} data-testid={`row-payout-${payout.fromPlayerId}-${payout.toPlayerId}`}>
                  {payout.fromPlayerName} <ArrowRight size={12} /> {payout.toPlayerName}
                  <strong>{formatMoney(payout.amount)}</strong>
                </div>
              ))}
            </>
          ) : null}

          {hasWolf || hasSnake || hasDots || hasNassau ? (
            <>
              <div className="ledger-section-title">Point breakdown</div>
              <table className="points-table" data-testid="table-point-breakdown">
                <thead>
                  <tr>
                    <th>Player</th>
                    {hasWolf ? <th>Wolf</th> : null}
                    {hasDots ? <th>Dots</th> : null}
                    {hasSnake ? <th>Snake</th> : null}
                    {hasNassau ? <th>Nassau F</th> : null}
                    {hasNassau ? <th>Nassau B</th> : null}
                    {hasNassau ? <th>Nassau O</th> : null}
                    {hasNassau ? <th>Nassau total</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {settlement.pointTotals.map((row) => (
                    <tr key={row.playerId}>
                      <td>{row.playerName}</td>
                      {hasWolf ? <td>{formatPoints(row.wolfPoints)}</td> : null}
                      {hasDots ? <td>{formatPoints(row.dotsPoints)}</td> : null}
                      {hasSnake ? <td>{formatPoints(row.snakePoints)}</td> : null}
                      {hasNassau ? <td>{formatMoney(row.nassauFrontAmount)}</td> : null}
                      {hasNassau ? <td>{formatMoney(row.nassauBackAmount)}</td> : null}
                      {hasNassau ? <td>{formatMoney(row.nassauOverallAmount)}</td> : null}
                      {hasNassau ? <td>{formatMoney(row.nassauAmount)}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          {hasSnake ? (
            <div className="side-stat"><span>Snake holder</span><strong data-testid="text-ledger-snake-holder">{snakeHolderName ?? '—'}</strong></div>
          ) : null}
        </>
      ) : (
        <div className="empty-state" style={{ padding: '27px 6px' }} data-testid="state-empty-settlement">
          <CircleDollarSign size={25} style={{ color: 'hsl(var(--muted-foreground))', marginBottom: 9 }} />
          <div style={{ fontWeight: 700, fontSize: 13 }}>No money moved yet.</div>
          <div className="body-copy" style={{ fontSize: 12, marginTop: 4 }}>Record a hole to open the ledger.</div>
        </div>
      )}
      <div className="side-stat"><span>Holes recorded</span><strong data-testid="text-settlement-holes">{settlement?.holesRecorded ?? 0} / 18</strong></div>
      <div className="side-stat"><span>Total pot tracked</span><strong data-testid="text-total-pot">{formatMoney(settlement?.totalPot ?? 0)}</strong></div>
      {players.length > 0 ? <div style={{ display: 'flex', gap: 7, marginTop: 19, alignItems: 'center', color: 'hsl(var(--muted-foreground))', fontSize: 11 }}><Users size={14} /> {players.length} players · {players.map((player) => player.name).join(', ')}</div> : null}
    </aside>
  );
}

function Router() {
  const [location] = useLocation();
  return (
    <Shell>
      <ErrorBoundary resetKey={location}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/courses" component={Courses} />
          <Route path="/rounds/new" component={NewRound} />
          <Route path="/rounds/:id" component={Scorecard} />
          <Route component={NotFound} />
        </Switch>
      </ErrorBoundary>
    </Shell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
