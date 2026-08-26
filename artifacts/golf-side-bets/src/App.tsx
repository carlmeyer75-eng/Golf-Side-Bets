import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Flag,
  LayoutDashboard,
  LoaderCircle,
  Plus,
  RefreshCw,
  Trash2,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import {
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
  Player,
  Round,
  RoundDetail,
  Settlement,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Link, Route, Switch, Router as WouterRouter, useLocation, useParams } from 'wouter';

const queryClient = new QueryClient();

const formatDate = (value?: string) =>
  value
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
        new Date(value),
      )
    : 'Date not set';

const formatMoney = (value: number) => `${value < 0 ? '−' : ''}$${Math.abs(value).toFixed(2)}`;

const getInitials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

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
                Grab your group, pick a stake, and let the scorecard handle the side bets.
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
      </div>
      <div className="round-date">{formatDate(round.playedAt)}</div>
      <div className="round-stake">{formatMoney(round.stake)} / bet</div>
      <StatusPill status={round.status} />
      <ChevronRight size={16} style={{ color: 'hsl(var(--muted-foreground))' }} />
    </Link>
  );
}

function NewRound() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createRound = useCreateRound();
  const [name, setName] = useState('Saturday skins');
  const [course, setCourse] = useState('');
  const [playedAt, setPlayedAt] = useState(new Date().toISOString().slice(0, 10));
  const [stake, setStake] = useState('5');
  const [gameTypes, setGameTypes] = useState<('wolf' | 'nassau')[]>(['wolf', 'nassau']);
  const [players, setPlayers] = useState(['', '']);
  const [formError, setFormError] = useState('');

  const changePlayer = (index: number, value: string) => {
    setPlayers((current) => current.map((player, playerIndex) => (playerIndex === index ? value : player)));
  };
  const addPlayer = () => {
    if (players.length < 4) setPlayers((current) => [...current, '']);
  };
  const removePlayer = (index: number) => {
    if (players.length > 2) setPlayers((current) => current.filter((_, playerIndex) => playerIndex !== index));
  };
  const toggleGame = (game: 'wolf' | 'nassau') => {
    setGameTypes((current) =>
      current.includes(game) ? current.filter((item) => item !== game) : [...current, game],
    );
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cleanPlayers = players.map((player) => player.trim()).filter(Boolean);
    if (!name.trim() || !course.trim() || cleanPlayers.length < 2 || gameTypes.length === 0 || Number(stake) <= 0) {
      setFormError('Add a course, two or more players, a game, and a stake to tee off.');
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
          players: cleanPlayers.map((player) => ({ name: player })),
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
            <input id="course-name" value={course} onChange={(event) => setCourse(event.target.value)} placeholder="e.g. Presidio Golf Course" data-testid="input-course" />
          </div>
          <div className="field">
            <label htmlFor="played-at">Date</label>
            <input id="played-at" type="date" value={playedAt} onChange={(event) => setPlayedAt(event.target.value)} data-testid="input-played-at" />
          </div>
          <div className="field full">
            <label>Games in play</label>
            <div className="game-toggle">
              {(['wolf', 'nassau'] as const).map((game) => (
                <label className="check-label" key={game} htmlFor={`game-${game}`}>
                  <input id={`game-${game}`} type="checkbox" checked={gameTypes.includes(game)} onChange={() => toggleGame(game)} data-testid={`checkbox-game-${game}`} />
                  {game === 'wolf' ? 'Wolf' : 'Nassau'}
                </label>
              ))}
            </div>
            <span className="field-hint">You can run one game or keep both books open.</span>
          </div>
          <div className="field">
            <label htmlFor="stake">Stake per bet</label>
            <input id="stake" type="number" min="0.01" step="0.01" value={stake} onChange={(event) => setStake(event.target.value)} data-testid="input-stake" />
          </div>
          <div className="field">
            <label>Players <span style={{ color: 'hsl(var(--muted-foreground))', fontWeight: 400 }}>(2–4)</span></label>
            <span className="field-hint">First names are perfect.</span>
          </div>
          <div className="field full">
            <div className="players-list">
              {players.map((player, index) => (
                <div className="player-input" key={`player-${index}`}>
                  <span className="avatar" style={{ marginLeft: 0, flex: '0 0 33px' }}>{getInitials(player || `Player ${index + 1}`)}</span>
                  <input value={player} onChange={(event) => changePlayer(index, event.target.value)} placeholder={`Player ${index + 1}`} aria-label={`Player ${index + 1} name`} data-testid={`input-player-${index + 1}`} />
                  {players.length > 2 ? <button type="button" className="button button-ghost" onClick={() => removePlayer(index)} aria-label={`Remove player ${index + 1}`} data-testid={`button-remove-player-${index + 1}`}><X size={15} /></button> : null}
                </div>
              ))}
            </div>
            {players.length < 4 ? <button type="button" className="button button-ghost" onClick={addPlayer} style={{ marginTop: 10 }} data-testid="button-add-player"><Plus size={14} /> Add player</button> : null}
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
  const [scores, setScores] = useState<Record<string, string>>({});
  const [wolfPlayerId, setWolfPlayerId] = useState('');
  const [winnerPlayerId, setWinnerPlayerId] = useState('');
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  const isBusy = recordHole.isPending || updateRound.isPending || deleteRound.isPending;

  const selectedResult = useMemo(
    () => holes.find((hole) => hole.hole === selectedHole),
    [holes, selectedHole],
  );
  const players = round?.players ?? [];

  const chooseHole = (hole: number) => {
    setSelectedHole(hole);
    const result = holes.find((item) => item.hole === hole);
    const nextScores: Record<string, string> = {};
    result?.scores.forEach((score) => { nextScores[score.playerId] = String(score.strokes); });
    setScores(nextScores);
    setWolfPlayerId(result?.wolfPlayerId ?? '');
    setWinnerPlayerId(result?.winnerPlayerId ?? '');
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
          wolfPlayerId: wolfPlayerId || null,
          winnerPlayerId: winnerPlayerId || null,
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
    if (!round || !window.confirm(`Delete “${round.name}” from the ledger?`)) return;
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

  return (
    <main className="content-wrap">
      <div className="topbar" style={{ marginBottom: 23 }}>
        <div>
          <div className="eyebrow">{round.course} · {formatDate(round.playedAt)}</div>
          {!editing ? (
            <>
              <h1 className="display page-title" style={{ fontSize: 'clamp(33px, 4vw, 47px)' }} data-testid="text-round-title">{round.name}</h1>
              <div style={{ marginTop: 10 }}><StatusPill status={round.status} /></div>
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

      <div className="score-layout">
        <section className="card scorecard" aria-label="Round scorecard">
          <div className="score-head">
            <div>
              <div className="eyebrow">Hole by hole</div>
              <h1 className="display">Keep it honest.</h1>
              <div style={{ fontSize: 12, color: 'hsl(var(--primary-foreground) / .58)' }}>{holes.length} of 18 holes recorded</div>
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
          <form className="hole-editor" onSubmit={saveHole} data-testid="form-record-hole">
            <div className="hole-editor-head">
              <div>
                <div className="eyebrow">Now recording</div>
                <h2>Hole {selectedHole}</h2>
              </div>
              {selectedResult ? <span className="status-pill live"><Check size={11} /> Recorded</span> : <span className="eyebrow">Not recorded</span>}
            </div>
            <div className="score-fields">
              {players.map((player) => (
                <div className="score-player" key={player.id}>
                  <div className="score-player-name"><span className="avatar" style={{ width: 25, height: 25, marginLeft: 0, border: 0 }}>{player.initials}</span>{player.name}<span>strokes</span></div>
                  <input type="number" min="1" max="30" value={scores[player.id] ?? ''} onChange={(event) => setScores((current) => ({ ...current, [player.id]: event.target.value }))} aria-label={`${player.name} strokes`} data-testid={`input-strokes-${player.id}`} />
                </div>
              ))}
            </div>
            <div className="select-row">
              <div className="field">
                <label htmlFor="wolf-player">Wolf (optional)</label>
                <select id="wolf-player" value={wolfPlayerId} onChange={(event) => setWolfPlayerId(event.target.value)} data-testid="select-wolf-player">
                  <option value="">No wolf selected</option>
                  {players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="winner-player">Hole winner</label>
                <select id="winner-player" value={winnerPlayerId} onChange={(event) => setWinnerPlayerId(event.target.value)} data-testid="select-winner-player">
                  <option value="">No winner selected</option>
                  {players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-footer" style={{ marginTop: 22, paddingTop: 17 }}>
              <span className="body-copy" style={{ fontSize: 12, marginRight: 'auto' }}>{selectedResult ? 'Change the numbers and save again.' : 'Record this hole when the group agrees.'}</span>
              <button type="submit" className="button button-primary" disabled={isBusy} data-testid="button-save-hole">
                {recordHole.isPending ? <LoaderCircle size={15} /> : <Check size={15} />}
                {recordHole.isPending ? 'Saving…' : selectedResult ? 'Update hole' : 'Save hole'}
              </button>
            </div>
          </form>
        </section>

        <SettlementPanel settlement={settlement} players={players} loading={settlementQuery.isLoading} />
      </div>
      {notice ? <div className="toast-note" role="status" data-testid="status-action-notice">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notice" data-testid="button-dismiss-notice" style={{ background: 'none', border: 0, color: 'inherit', marginLeft: 12, padding: 0 }}><X size={14} /></button></div> : null}
    </main>
  );
}

function SettlementPanel({ settlement, players, loading }: { settlement?: Settlement; players: Player[]; loading: boolean }) {
  return (
    <aside className="card side-panel" aria-label="Current settlement" data-testid="panel-settlement">
      <h3>Who owes who?</h3>
      <p className="body-copy" style={{ fontSize: 12, margin: '-10px 0 10px' }}>Updates after every saved hole.</p>
      {loading ? (
        <><div className="skeleton" style={{ height: 44, marginBottom: 8 }} /><div className="skeleton" style={{ height: 44 }} /></>
      ) : settlement?.balances?.length ? (
        settlement.balances.map((balance) => (
          <div className="settlement-row" key={balance.playerId} data-testid={`row-settlement-${balance.playerId}`}>
            <div className="settlement-person"><span className="avatar" style={{ marginLeft: 0, width: 29, height: 29 }}>{getInitials(balance.playerName)}</span>{balance.playerName}</div>
            <span className={`balance ${balance.amount >= 0 ? 'up' : 'down'}`}>{balance.amount >= 0 ? '+' : ''}{formatMoney(balance.amount)}</span>
          </div>
        ))
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