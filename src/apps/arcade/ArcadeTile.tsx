import { getArcade, useQuery } from "wasp/client/operations";
import { formatScore } from "./format";

/**
 * Summary shown on the user's hub. Keep it small: a few numbers, no actions.
 * Rendered inside the shell's dark tile, so it uses the shell's tile-* classes.
 */
export function ArcadeTile() {
  const { data, isLoading, error } = useQuery(getArcade);
  if (isLoading) return <p className="tile-muted">Loading…</p>;
  if (error || !data) return <p className="tile-muted">Couldn't load your arcade.</p>;

  const onShelf = data.games.filter((g) => g.added);
  const played = data.games.filter((g) => g.best !== null).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const top = played[0];

  if (!top) {
    return (
      <p className="tile-muted">
        Playing as {data.nickname}. No scores yet: open the Arcade and play {onShelf[0]?.name ?? "a game"}.
      </p>
    );
  }

  return (
    <div className="tile-stats">
      <div>
        <span className="tile-label">{top.name} best</span>
        <span className="tile-value">{formatScore(top.best!)}</span>
      </div>
      <div>
        <span className="tile-label">Rank</span>
        <span className="tile-value tile-value--sm">#{top.rank}</span>
      </div>
      <div>
        <span className="tile-label">Games</span>
        <span className="tile-value tile-value--sm">{onShelf.length}</span>
      </div>
    </div>
  );
}
