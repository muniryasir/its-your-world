import { useState } from "react";
import { useParams } from "react-router";
import { Link } from "wasp/client/router";
import { addGame, getGame, useQuery } from "wasp/client/operations";
import type { GameDetail, LeaderboardEntry, RunView } from "./operations";
import { GAME_CLIENTS } from "./games/client";
import { formatDate, formatDuration, formatScore, plural } from "./format";
import "./arcade.css";

export function GamePage() {
  const { gameId = "" } = useParams();
  return (
    <div className="ar">
      <Link to="/arcade" className="ar-backlink">← Your arcade</Link>
      <GamePageContent gameId={gameId} />
    </div>
  );
}

function GamePageContent({ gameId }: { gameId: string }) {
  const { data, isLoading, error } = useQuery(getGame, { gameId });
  const client = GAME_CLIENTS[gameId];

  if (isLoading) return <p className="ar-muted">Loading…</p>;
  if ((error as any)?.statusCode === 404 || !client) {
    return (
      <div className="ar-empty">
        <h1>Game not found</h1>
        <p>There's no game called “{gameId}” in the arcade.</p>
        <Link to="/arcade" className="btn btn--primary">Back to your arcade</Link>
      </div>
    );
  }
  if (error || !data) return <p className="ar-error">Couldn't load the game: {error?.message}</p>;

  const { game } = data;
  const Play = client.Play;

  return (
    <>
      <header className="ar-head ar-head--game">
        <div>
          <p className="ar-eyebrow">Arcade</p>
          <h1>{game.name}</h1>
          <p className="ar-lead">{game.tagline}</p>
        </div>
        <div className="ar-player">
          <span className="ar-player-label">Playing as</span>
          <span className="ar-player-name">{data.nickname}</span>
          <Link to="/arcade" className="ar-textbtn">Change</Link>
        </div>
      </header>

      {!data.added && <AddBanner gameId={game.id} name={game.name} />}

      <div className="ar-play">
        <section className="ar-stage" aria-label={`${game.name} game`}>
          <Play gameId={game.id} canPlay={data.added} />
        </section>

        <aside className="ar-side">
          <YourBest data={data} />
          <Leaderboard entries={data.leaderboard} players={data.players} you={data.best ? { rank: data.rank!, score: data.best.score, nickname: data.nickname } : null} />
        </aside>

        <section className="ar-panel ar-howto">
          <div className="ar-panel-head"><h2>How to play</h2></div>
          <div className="ar-howto-body">
            <p>{game.description}</p>
            <dl className="ar-keys">
              {game.controls.map(([keys, action]) => (
                <div key={action}><dt><kbd>{keys}</kbd></dt><dd>{action}</dd></div>
              ))}
            </dl>
            <p className="ar-small">
              Scoring: 100 / 300 / 500 / 800 points × level for 1 / 2 / 3 / 4 rows, 50 × combo × level for clearing rows on
              consecutive pieces, ×1.5 for back-to-back supernovas, 1 per row soft-dropped and 2 per row hard-dropped.
            </p>
            <p className="ar-small ar-verified-note">
              <strong>Fair play:</strong> the server picks each run's piece order, records nothing but your key presses,
              and replays them to work out your score.
            </p>
            <p className="ar-small">{game.credits}</p>
          </div>
        </section>
      </div>
    </>
  );
}

function AddBanner({ gameId, name }: { gameId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="ar-banner">
      <p>{name} isn't on your shelf yet. Add it to play and get on the leaderboard.</p>
      <button
        className="btn btn--primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try { await addGame({ gameId }); } finally { setBusy(false); }
        }}
      >
        {busy ? "Adding…" : `Add ${name}`}
      </button>
    </div>
  );
}

function YourBest({ data }: { data: GameDetail }) {
  return (
    <section className="ar-panel ar-best">
      <div className="ar-panel-head"><h2>Your best</h2></div>
      {data.best ? (
        <div className="ar-best-body">
          <p className="ar-best-score" data-testid="best-score">{formatScore(data.best.score)}</p>
          <p className="ar-muted">
            Rank #{data.rank} of {plural(data.players, "player", "players")} · {runLine(data.best)}
          </p>
          {data.recent.length > 0 && (
            <>
              <h3 className="ar-subhead">Recent runs</h3>
              <ol className="ar-runs">
                {data.recent.map((r) => (
                  <li key={r.id}>
                    <span className="ar-runs-score">{formatScore(r.score)}</span>
                    <span className="ar-muted">{runLine(r)}</span>
                    <span className="ar-muted ar-runs-date">{formatDate(r.finishedAt)}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      ) : (
        <p className="ar-best-body ar-muted">No runs yet. Your first finished run shows up here.</p>
      )}
    </section>
  );
}

function runLine(r: RunView): string {
  const rows = Number(r.stats.lines ?? 0);
  return `${plural(rows, "row", "rows")} · ${formatDuration(r.durationMs)}`;
}

function Leaderboard({
  entries,
  players,
  you,
}: {
  entries: LeaderboardEntry[];
  players: number;
  you: { rank: number; score: number; nickname: string } | null;
}) {
  const youListed = entries.some((e) => e.you);
  return (
    <section className="ar-panel">
      <div className="ar-panel-head">
        <h2>Leaderboard</h2>
        <span className="ar-muted ar-small">{plural(players, "player", "players")} · best run each</span>
      </div>
      {entries.length === 0 ? (
        <p className="ar-best-body ar-muted">No scores yet. Be the first.</p>
      ) : (
        <table className="ar-table">
          <thead>
            <tr><th className="ar-rank">#</th><th>Player</th><th className="r">Score</th><th className="r ar-hide-sm">Rows</th></tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i} className={e.you ? "ar-you" : undefined}>
                <td className="ar-rank"><RankBadge rank={e.rank} /></td>
                <td>
                  <span className="ar-nick">{e.nickname}</span>
                  {e.you && <span className="ar-you-tag">you</span>}
                </td>
                <td className="r ar-num">{formatScore(e.score)}</td>
                <td className="r ar-num ar-hide-sm">{String(e.stats.lines ?? "–")}</td>
              </tr>
            ))}
            {you && !youListed && (
              <tr className="ar-you ar-you--outside">
                <td className="ar-rank">{you.rank}</td>
                <td><span className="ar-nick">{you.nickname}</span><span className="ar-you-tag">you</span></td>
                <td className="r ar-num">{formatScore(you.score)}</td>
                <td className="r ar-hide-sm" />
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank > 3) return <>{rank}</>;
  return <span className={`ar-medal ar-medal--${rank}`} aria-label={`Rank ${rank}`}>{rank}</span>;
}
