// Display helpers for the Arcade.

const scoreFmt = new Intl.NumberFormat("en-US");

export function formatScore(n: number): string {
  return scoreFmt.format(n);
}

/** 83_000 ms -> "1:23" */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

export function plural(n: number, one: string, many: string): string {
  return `${formatScore(n)} ${n === 1 ? one : many}`;
}
