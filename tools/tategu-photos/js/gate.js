const GATE_HASH =
  "336c500d225a423404217893e7e184978c473c4453ee70592739747d54ef3635";
const GATE_KEY = "tategu-gate";

export async function hashPhrase(text) {
  const data = new TextEncoder().encode(text.trim().normalize("NFKC").toLowerCase());
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function checkPhrase(text) {
  return (await hashPhrase(text)) === GATE_HASH;
}

export function isUnlocked() {
  return localStorage.getItem(GATE_KEY) === GATE_HASH;
}

export function unlock() {
  localStorage.setItem(GATE_KEY, GATE_HASH);
}

export function lock() {
  localStorage.removeItem(GATE_KEY);
}
