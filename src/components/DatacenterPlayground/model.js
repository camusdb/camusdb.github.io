// Synthetic demand selects a desired size; the engine performs every membership change.
export const TARGET = 4000;
export const MIN = 4;
export const MAX = 9;
export const nodeName = (id) => `camusdb-${id}`;
export function recommendation(count, traffic) {
  const ratio = traffic / count / TARGET;
  return Math.abs(ratio - 1) <= 0.1
    ? count
    : Math.max(MIN, Math.min(MAX, Math.ceil(count * ratio)));
}
