import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  endOfDay,
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  isSameDay,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subMonths,
  subWeeks,
  subYears
} from "date-fns";
import type {
  CalendarEvent,
  CalendarEventDeletion,
  CalendarView,
  EmailDraft
} from "@/lib/types";

export type CalendarRange = {
  start: string;
  end: string;
};

export type PositionedTimedEvent = {
  column: number;
  columnCount: number;
  event: CalendarEvent;
};

const hourHeight = 64;

function startOfDayLocal(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function minutesFromStartOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");

  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    return `rgba(86, 194, 255, ${alpha})`;
  }

  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function monthDays(viewDate: Date) {
  const start = startOfWeek(startOfMonth(viewDate));
  const end = endOfWeek(endOfMonth(viewDate));
  const days: Date[] = [];

  for (let day = start; day <= end; day = addDays(day, 1)) {
    days.push(day);
  }

  while (days.length < 42) {
    days.push(addDays(days[days.length - 1], 1));
  }

  return days.slice(0, 42);
}

export function yearMonths(viewDate: Date) {
  return Array.from({ length: 12 }, (_, index) => {
    return new Date(viewDate.getFullYear(), index, 1);
  });
}

export function calendarRangeForView(view: CalendarView, date: Date): CalendarRange {
  if (view === "day") {
    return {
      start: startOfDay(date).toISOString(),
      end: endOfDay(date).toISOString()
    };
  }

  if (view === "week") {
    return {
      start: startOfWeek(date).toISOString(),
      end: endOfWeek(date).toISOString()
    };
  }

  if (view === "year") {
    return {
      start: startOfYear(date).toISOString(),
      end: endOfYear(date).toISOString()
    };
  }

  return {
    start: startOfWeek(startOfMonth(date)).toISOString(),
    end: endOfWeek(endOfMonth(date)).toISOString()
  };
}

export function calendarYearRange(date: Date): CalendarRange {
  return {
    start: startOfYear(date).toISOString(),
    end: endOfYear(date).toISOString()
  };
}

export function calendarTitleForView(view: CalendarView, date: Date) {
  if (view === "day") {
    return format(date, "EEEE, MMMM d, yyyy");
  }

  if (view === "week") {
    return `${format(startOfWeek(date), "MMM d")} - ${format(
      endOfWeek(date),
      "MMM d, yyyy"
    )}`;
  }

  if (view === "year") {
    return format(date, "yyyy");
  }

  return format(date, "MMMM yyyy");
}

export function previousDateForView(view: CalendarView, date: Date) {
  if (view === "day") {
    return addDays(date, -1);
  }

  if (view === "week") {
    return subWeeks(date, 1);
  }

  if (view === "year") {
    return subYears(date, 1);
  }

  return subMonths(date, 1);
}

export function nextDateForView(view: CalendarView, date: Date) {
  if (view === "day") {
    return addDays(date, 1);
  }

  if (view === "week") {
    return addWeeks(date, 1);
  }

  if (view === "year") {
    return addYears(date, 1);
  }

  return addMonths(date, 1);
}

export function sortEvents(events: CalendarEvent[]) {
  return [...events].sort((a, b) => {
    return new Date(a.start).getTime() - new Date(b.start).getTime();
  });
}

export function eventOccursOnDay(event: CalendarEvent, day: Date) {
  const start = parseISO(event.start);
  const end = parseISO(event.end);

  if (event.allDay) {
    return day >= startOfDayLocal(start) && day < startOfDayLocal(end);
  }

  return isSameDay(start, day);
}

export function eventTimeLabel(event: CalendarEvent) {
  if (event.allDay) {
    return "All day";
  }

  return format(parseISO(event.start), "h:mm a");
}

export function eventRangeLabel(event: CalendarEvent) {
  if (event.allDay) {
    return `${format(parseISO(event.start), "MMM d")} all day`;
  }

  const start = parseISO(event.start);
  const end = parseISO(event.end);

  if (isSameDay(start, end)) {
    return `${format(start, "MMM d, h:mm a")} - ${format(end, "h:mm a")}`;
  }

  return `${format(start, "MMM d, h:mm a")} - ${format(end, "MMM d, h:mm a")}`;
}

export function deletionRangeLabel(event: CalendarEventDeletion) {
  if (event.allDay) {
    return `${format(parseISO(event.start), "MMM d")} all day`;
  }

  const start = parseISO(event.start);
  const end = parseISO(event.end);

  if (isSameDay(start, end)) {
    return `${format(start, "MMM d, h:mm a")} - ${format(end, "h:mm a")}`;
  }

  return `${format(start, "MMM d, h:mm a")} - ${format(end, "MMM d, h:mm a")}`;
}

export function eventDurationLabel(event: CalendarEvent) {
  if (event.allDay) {
    return "All-day event";
  }

  const minutes = Math.max(
    0,
    Math.round((parseISO(event.end).getTime() - parseISO(event.start).getTime()) / 60000)
  );
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours && remainingMinutes) {
    return `${hours} hr ${remainingMinutes} min`;
  }

  if (hours) {
    return `${hours} hr`;
  }

  return `${remainingMinutes} min`;
}

export function eventCardStyle(event: CalendarEvent) {
  return {
    "--event-color": event.color,
    "--event-fill": hexToRgba(event.color, 0.13),
    "--event-fill-strong": hexToRgba(event.color, 0.2)
  } as React.CSSProperties;
}

export function timedEventStyle(positionedEvent: PositionedTimedEvent) {
  const { column, columnCount, event } = positionedEvent;
  const start = parseISO(event.start);
  const end = parseISO(event.end);
  const startMinutes = minutesFromStartOfDay(start);
  const durationMinutes = Math.max(
    30,
    Math.round((end.getTime() - start.getTime()) / 60000)
  );

  return {
    left: `calc(10px + ((100% - 20px) / ${columnCount}) * ${column})`,
    top: `${(startMinutes / 60) * hourHeight}px`,
    width: `calc(((100% - 20px) / ${columnCount}) - 6px)`,
    height: `${(durationMinutes / 60) * hourHeight}px`,
    ...eventCardStyle(event)
  };
}

export function layoutTimedEvents(events: CalendarEvent[]): PositionedTimedEvent[] {
  const sortedEvents = sortEvents(events);
  const groups: CalendarEvent[][] = [];
  let currentGroup: CalendarEvent[] = [];
  let currentGroupEnd = 0;

  sortedEvents.forEach((event) => {
    const start = parseISO(event.start).getTime();
    const end = parseISO(event.end).getTime();

    if (!currentGroup.length || start < currentGroupEnd) {
      currentGroup.push(event);
      currentGroupEnd = Math.max(currentGroupEnd, end);
      return;
    }

    groups.push(currentGroup);
    currentGroup = [event];
    currentGroupEnd = end;
  });

  if (currentGroup.length) {
    groups.push(currentGroup);
  }

  return groups.flatMap((group) => {
    const columnEnds: number[] = [];
    const positioned = group.map((event) => {
      const start = parseISO(event.start).getTime();
      const end = parseISO(event.end).getTime();
      const reusableColumn = columnEnds.findIndex((columnEnd) => columnEnd <= start);
      const column = reusableColumn === -1 ? columnEnds.length : reusableColumn;

      columnEnds[column] = end;

      return {
        column,
        columnCount: 1,
        event
      };
    });
    const columnCount = Math.max(1, columnEnds.length);

    return positioned.map((positionedEvent) => ({
      ...positionedEvent,
      columnCount
    }));
  });
}

export function gmailComposeUrl(draft: EmailDraft) {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    su: draft.subject,
    body: draft.body
  });

  if (draft.to.length) {
    params.set("to", draft.to.join(","));
  }

  if (draft.cc?.length) {
    params.set("cc", draft.cc.join(","));
  }

  if (draft.bcc?.length) {
    params.set("bcc", draft.bcc.join(","));
  }

  return `https://mail.google.com/mail/?${params.toString()}`;
}

export function eventIntersectsRange(event: CalendarEvent, rangeStart: number, rangeEnd: number) {
  const eventStart = parseISO(event.start).getTime();
  const eventEnd = parseISO(event.end).getTime();

  return eventStart < rangeEnd && eventEnd > rangeStart;
}

export function filterEventsForRange(
  sourceEvents: CalendarEvent[],
  rangeStart: string,
  rangeEnd: string
) {
  const start = new Date(rangeStart).getTime();
  const end = new Date(rangeEnd).getTime();

  return sortEvents(
    sourceEvents.filter((event) => eventIntersectsRange(event, start, end))
  );
}
