import { useState, type FormEvent } from "react";
import { Link } from "wasp/client/router";
import { addGame, getArcade, removeGame, setNickname, useQuery } from "wasp/client/operations";
import type { GameCard } from "./operations";
import { GAME_CLIENTS } from "./games/client";
import { formatScore } from "./format";
import "./arcade.css";

export function ArcadeHomePage() {
  return (
    <div className="ar">
      <ArcadeHome />
    </div>
  );
}

function ArcadeHome() {
  const { data, isLoading, error } = useQuery(getArcade);
  if (isLoading) return <p className="ar-muted">Loading your arcade…</p>;
  if (error || !data) return <p className="ar-error">Couldn't load your arcade: {error?.message}</p>;

  const shelf = data.games.filter((g) => g.added);
  const more = data.games.filter((g) => !g.added);

  return (
    <>
      <header className="ar-head">
        <div>
          <p className="ar-eyebrow">Arcade</p>
          <h1>Your arcade</h1>
          <p className="ar-lead">
            Games that run right in your browser. Every score is replayed on the server before it reaches a leaderboard.
          </p>
        </div>
        <NicknameCard nickname={data.nickname} />
      </header>

      <h2 className="ar-section">Your games</h2>
      {shelf.length === 0 ? (
        <div className="ar-empty">
          <p>Your shelf is empty. Add a game below to start playing.</p>
        </div>
      ) : (
        <div className="ar-grid">
          {shelf.map((g) => <ShelfCard key={g.id} game={g} />)}
        </div>
      )}

      <h2 className="ar-section">Add games</h2>
      {more.length === 0 ? (
        <p className="ar-muted">You have every game in the arcade. More are on the way.</p>
      ) : (
        <div className="ar-grid">
          {more.map((g) => <AddCard key={g.id} game={g} />)}
        </div>
      )}
    </>
  );
}

function ShelfCard({ game }: { game: GameCard }) {
  const Cover = GAME_CLIENTS[game.id]?.Cover;
  const [confirming, setConfirming] = useState(false);
  return (
    <article className="ar-card">
      <Link to="/arcade/:gameId" params={{ gameId: game.id }} className="ar-card-cover" tabIndex={-1} aria-hidden="true">
        {Cover && <Cover id={`cover-${game.id}`} />}
      </Link>
      <div className="ar-card-body">
        <h3>{game.name}</h3>
        <p className="ar-muted">{game.tagline}</p>
        <dl className="ar-card-stats">
          <div><dt>Your best</dt><dd>{game.best === null ? "–" : formatScore(game.best)}</dd></div>
          <div><dt>Rank</dt><dd>{game.rank === null ? "–" : `#${game.rank}`}</dd></div>
          <div><dt>Runs</dt><dd>{formatScore(game.runs)}</dd></div>
        </dl>
      </div>
      <div className="ar-card-foot">
        <Link to="/arcade/:gameId" params={{ gameId: game.id }} className="btn btn--primary">
          Play {game.name}
        </Link>
        {confirming ? (
          <span className="ar-confirm">
            Remove? Your scores are kept.
            <button className="ar-textbtn ar-textbtn--danger" onClick={() => removeGame({ gameId: game.id })}>Remove</button>
            <button className="ar-textbtn" onClick={() => setConfirming(false)}>Cancel</button>
          </span>
        ) : (
          <button className="ar-textbtn" onClick={() => setConfirming(true)}>Remove from shelf</button>
        )}
      </div>
    </article>
  );
}

function AddCard({ game }: { game: GameCard }) {
  const Cover = GAME_CLIENTS[game.id]?.Cover;
  const [busy, setBusy] = useState(false);
  const live = game.status === "live";
  return (
    <article className="ar-card ar-card--add">
      <div className="ar-card-cover">{Cover && <Cover id={`add-${game.id}`} />}</div>
      <div className="ar-card-body">
        <h3>{game.name}</h3>
        <p className="ar-muted">{game.tagline}</p>
        {game.best !== null && <p className="ar-small">Your best so far: {formatScore(game.best)}</p>}
      </div>
      <div className="ar-card-foot">
        {live ? (
          <button
            className="btn btn--primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await addGame({ gameId: game.id }); } finally { setBusy(false); }
            }}
          >
            {busy ? "Adding…" : `Add ${game.name}`}
          </button>
        ) : (
          <span className="ar-pill">Coming soon</span>
        )}
      </div>
    </article>
  );
}

export function NicknameCard({ nickname }: { nickname: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(nickname);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await setNickname({ nickname: value });
      setEditing(false);
    } catch (err: any) {
      setError(err?.message ?? "Couldn't save the nickname.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="ar-player">
        <span className="ar-player-label">Playing as</span>
        <span className="ar-player-name" data-testid="nickname">{nickname}</span>
        <button className="ar-textbtn" onClick={() => { setValue(nickname); setEditing(true); }}>Change</button>
      </div>
    );
  }
  return (
    <form className="ar-player ar-player--form" onSubmit={save}>
      <label htmlFor="ar-nickname" className="ar-player-label">Your nickname on leaderboards</label>
      <input
        id="ar-nickname"
        name="nickname"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={20}
        autoFocus
        autoComplete="off"
        spellCheck={false}
      />
      <span className="ar-small">3–20 letters, numbers, - or _. Shown instead of your login.</span>
      {error && <p className="ar-error" role="alert">{error}</p>}
      <div className="ar-form-actions">
        <button type="button" className="btn btn--ghost" onClick={() => setEditing(false)}>Cancel</button>
        <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}
