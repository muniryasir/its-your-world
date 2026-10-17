// Arcade nicknames: the public name on leaderboards (never the login username).

const WORDS = [
  "Nova", "Comet", "Quasar", "Pulsar", "Nebula", "Orbit", "Meteor", "Zenith",
  "Aurora", "Vega", "Lyra", "Orion", "Rigel", "Photon", "Cosmo", "Eclipse",
];

export const NICKNAME_RULES = "3–20 characters: letters, numbers, - and _, starting with a letter or number.";
const PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$/;

export function isValidNickname(name: string): boolean {
  return PATTERN.test(name);
}

/** Lower-case key used for uniqueness. */
export function nicknameKey(name: string): string {
  return name.toLowerCase();
}

/** A random nickname like "Quasar-42". Longer numbers after a few collisions. */
export function randomNickname(attempt = 0): string {
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];
  const digits = attempt < 5 ? 10 + Math.floor(Math.random() * 90) : 1000 + Math.floor(Math.random() * 9000);
  return `${word}-${digits}`;
}
