// Side-by-side layout for appointments of one employee column. A cancelled or no-show appointment keeps its time slot
// in history, and the same time can be booked again, so two cards can cover the same minutes. Overlapping cards are
// split into lanes instead of being stacked on top of each other; active appointments come first (leftmost lane,
// drawn above), so a new confirmed booking is never hidden behind the cancelled one it replaced.
export type CalendarLayoutItem = { id: string; start_time: string; end_time: string; status: string };
export type CalendarLane = { lane: number; lanes: number };

const INACTIVE_STATUSES = new Set(["cancelled", "no_show"]);

export function isInactiveCalendarStatus(status: string) {
  return INACTIVE_STATUSES.has(status?.toLowerCase().trim());
}

// Start time first; at the same start active before inactive; id last so the order never depends on the database.
export function sortCalendarAppointments<T extends CalendarLayoutItem>(items: readonly T[]) {
  return [...items].sort((a, b) =>
    new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    || Number(isInactiveCalendarStatus(a.status)) - Number(isInactiveCalendarStatus(b.status))
    || new Date(a.end_time).getTime() - new Date(b.end_time).getTime()
    || a.id.localeCompare(b.id));
}

export function layoutCalendarColumn<T extends CalendarLayoutItem>(items: readonly T[]) {
  const layout = new Map<string, CalendarLane>();
  const sorted = sortCalendarAppointments(items);
  let cluster: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const closeCluster = () => {
    for (const { id, lane } of cluster) layout.set(id, { lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    const start = new Date(item.start_time).getTime();
    const end = Math.max(start, new Date(item.end_time).getTime());
    if (start >= clusterEnd) closeCluster();
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(end); } else laneEnds[lane] = end;
    cluster.push({ id: item.id, lane });
    clusterEnd = Math.max(clusterEnd === -Infinity ? end : clusterEnd, end);
  }
  closeCluster();
  return { sorted, layout };
}
