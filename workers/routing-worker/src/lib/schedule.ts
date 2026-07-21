export type DepartureSlot = {
  hour: number;         // WAT 0–23
  minute: number;       // 0–59
  daysOfWeek: number[]; // ISO 1–7; empty = every day
};

/**
 * Returns the next departure datetime >= notBefore, computed in WAT (UTC+1).
 * Returns null if slots is empty.
 */
export function nextDeparture(slots: DepartureSlot[], notBefore: Date): Date | null {
  if (slots.length === 0) return null;

  // WAT offset: UTC+1 (no DST in Nigeria)
  const WAT_OFFSET_MS = 60 * 60 * 1000;

  // Convert notBefore to WAT
  const watMs = notBefore.getTime() + WAT_OFFSET_MS;
  const watDate = new Date(watMs);

  // Extract WAT date components
  const watYear = watDate.getUTCFullYear();
  const watMonth = watDate.getUTCMonth();
  const watDay = watDate.getUTCDate();
  const watHour = watDate.getUTCHours();
  const watMinute = watDate.getUTCMinutes();

  // ISO weekday 1 = Monday ... 7 = Sunday
  function isoWeekday(year: number, month: number, day: number): number {
    const d = new Date(Date.UTC(year, month, day));
    const dow = d.getUTCDay(); // 0=Sun
    return dow === 0 ? 7 : dow;
  }

  // Try today and up to 7 more days until we find a slot
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const candidateDate = new Date(Date.UTC(watYear, watMonth, watDay + dayOffset));
    const candidateYear = candidateDate.getUTCFullYear();
    const candidateMonth = candidateDate.getUTCMonth();
    const candidateDay = candidateDate.getUTCDate();
    const candidateWeekday = isoWeekday(candidateYear, candidateMonth, candidateDay);

    // Collect all slots valid for this candidate day, then pick the earliest
    const validSlots = slots.filter((slot) => {
      if (slot.daysOfWeek.length > 0 && !slot.daysOfWeek.includes(candidateWeekday)) return false;
      if (dayOffset === 0) {
        if (slot.hour < watHour) return false;
        if (slot.hour === watHour && slot.minute <= watMinute) return false;
      }
      return true;
    });

    if (validSlots.length === 0) continue;

    const earliest = validSlots.reduce((a, b) =>
      a.hour * 60 + a.minute < b.hour * 60 + b.minute ? a : b,
    );

    const departureWatMs =
      Date.UTC(candidateYear, candidateMonth, candidateDay, earliest.hour, earliest.minute, 0, 0) -
      WAT_OFFSET_MS;
    return new Date(departureWatMs);
  }

  return null; // No slot found in 7 days (shouldn't happen with valid schedules)
}
