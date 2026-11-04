// Player preferences, kept in localStorage. Small and flat on purpose; add
// fields with defaults and old saves keep working.

/** How boxes are drawn on touch screens.
 *  - "drag": one finger drags corner to corner; two fingers pan and pinch.
 *  - "tap":  tap one corner, then the opposite one; one finger pans. */
export type InputMode = "drag" | "tap";

export interface Settings {
  input: InputMode;
}

const DEFAULTS: Settings = { input: "drag" };
const KEY = "shikaku:settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* unavailable — the choice still applies for this session */
  }
}
