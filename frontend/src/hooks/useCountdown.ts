import { useEffect, useMemo, useState } from "react";

export function formatCountdownMs(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms));
  const totalSec = Math.floor(clamped / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Returns milliseconds remaining until `targetEpochMs`.
 * Re-renders at 1Hz (good for UI countdown labels).
 */
export function useCountdownMs(targetEpochMs: number | null | undefined): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!targetEpochMs) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [targetEpochMs]);

  return useMemo(() => {
    if (!targetEpochMs) return 0;
    return Math.max(0, targetEpochMs - now);
  }, [targetEpochMs, now]);
}

