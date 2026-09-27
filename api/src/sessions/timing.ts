/**
 * v1.1: when a started, timed section runs out = startedAt + (timeMinutes + extensionMinutes).
 * Null before start or when the section has no time limit.
 */
export function sectionEndsAt(
  startedAt: Date | null | undefined,
  timeMinutes: number | null | undefined,
  extensionMinutes: number,
): Date | null {
  if (!startedAt || timeMinutes === null || timeMinutes === undefined || timeMinutes <= 0) return null;
  return new Date(startedAt.getTime() + (timeMinutes + extensionMinutes) * 60_000);
}
