"use client";

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
  isSameMonth,
  isToday,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subMonths,
  subWeeks,
  subYears
} from "date-fns";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Send,
  Users,
  X
} from "lucide-react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User
} from "firebase/auth";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createCalendarProvider, getFirebaseAuth } from "@/lib/firebase";
import type {
  AgentChatResponse,
  AgentResponseBlock,
  CalendarEvent,
  CalendarEventDeletion,
  CalendarEventEdit,
  CalendarEventDraft,
  CalendarView,
  ChatMessage,
  EmailDraft,
  ScheduleOption
} from "@/lib/types";

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const chatStorageKey = "cally-agent-calendar-chat";
const calendarViews: CalendarView[] = ["day", "week", "month", "year"];
type CachedEventRange = {
  start: number;
  end: number;
};
type CalendarRange = {
  start: string;
  end: string;
};
type PendingNavigation = {
  date: Date;
  error?: string;
  title: string;
  view: CalendarView;
};
type PendingEmailDraft = {
  draft: EmailDraft;
  status: "pending" | "opened" | "cancelled";
};
type PositionedTimedEvent = {
  column: number;
  columnCount: number;
  event: CalendarEvent;
};
const dayHours = Array.from({ length: 24 }, (_, hour) => hour);
const hourHeight = 64;

function monthDays(viewDate: Date) {
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

function yearMonths(viewDate: Date) {
  return Array.from({ length: 12 }, (_, index) => {
    return new Date(viewDate.getFullYear(), index, 1);
  });
}

function calendarRangeForView(view: CalendarView, date: Date): CalendarRange {
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

function calendarYearRange(date: Date): CalendarRange {
  return {
    start: startOfYear(date).toISOString(),
    end: endOfYear(date).toISOString()
  };
}

function calendarTitleForView(view: CalendarView, date: Date) {
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

function previousDateForView(view: CalendarView, date: Date) {
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

function nextDateForView(view: CalendarView, date: Date) {
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

function eventOccursOnDay(event: CalendarEvent, day: Date) {
  const start = parseISO(event.start);
  const end = parseISO(event.end);

  if (event.allDay) {
    return day >= startOfDayLocal(start) && day < startOfDayLocal(end);
  }

  return isSameDay(start, day);
}

function startOfDayLocal(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function eventTimeLabel(event: CalendarEvent) {
  if (event.allDay) {
    return "All day";
  }

  return format(parseISO(event.start), "h:mm a");
}

function eventRangeLabel(event: CalendarEvent) {
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

function deletionRangeLabel(event: CalendarEventDeletion) {
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

function eventDurationLabel(event: CalendarEvent) {
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

function eventCardStyle(event: CalendarEvent) {
  return {
    "--event-color": event.color,
    "--event-fill": hexToRgba(event.color, 0.13),
    "--event-fill-strong": hexToRgba(event.color, 0.2)
  } as React.CSSProperties;
}

function timedEventStyle(positionedEvent: PositionedTimedEvent) {
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

function layoutTimedEvents(events: CalendarEvent[]): PositionedTimedEvent[] {
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

function gmailComposeUrl(draft: EmailDraft) {
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

function sortEvents(events: CalendarEvent[]) {
  return [...events].sort((a, b) => {
    return new Date(a.start).getTime() - new Date(b.start).getTime();
  });
}

function eventIntersectsRange(event: CalendarEvent, rangeStart: number, rangeEnd: number) {
  const eventStart = parseISO(event.start).getTime();
  const eventEnd = parseISO(event.end).getTime();

  return eventStart < rangeEnd && eventEnd > rangeStart;
}

function filterEventsForRange(
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

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function renderInlineMarkdown(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }

    return part;
  });
}

function MarkdownMessage({ content }: { content: string }) {
  const blocks = content.trim().split(/\n\s*\n/g);

  return (
    <div className="markdown-message">
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n").filter((line) => line.trim());
        const isUnorderedList = lines.every((line) => /^[-*]\s+/.test(line.trim()));
        const isNumberedList = lines.every((line) => /^\d+\.\s+/.test(line.trim()));

        if (isUnorderedList) {
          return (
            <ul key={blockIndex}>
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>
                  {renderInlineMarkdown(line.trim().replace(/^[-*]\s+/, ""))}
                </li>
              ))}
            </ul>
          );
        }

        if (isNumberedList) {
          return (
            <ol key={blockIndex}>
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>
                  {renderInlineMarkdown(line.trim().replace(/^\d+\.\s+/, ""))}
                </li>
              ))}
            </ol>
          );
        }

        if (lines.length === 1 && /^#{1,3}\s+/.test(lines[0].trim())) {
          return (
            <div className="markdown-heading" key={blockIndex}>
              {renderInlineMarkdown(lines[0].trim().replace(/^#{1,3}\s+/, ""))}
            </div>
          );
        }

        return (
          <p key={blockIndex}>
            {lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {renderInlineMarkdown(line)}
                {lineIndex < lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function ResponseBlocks({ blocks }: { blocks: AgentResponseBlock[] }) {
  if (!blocks.length) {
    return null;
  }

  return (
    <div className="response-blocks">
      {blocks.map((block, index) => {
        if (block.type === "summary") {
          return (
            <section className="response-block" key={`${block.type}-${index}`}>
              <div className="response-block-kicker">Summary</div>
              <div className="response-block-title">{block.title}</div>
              <p>{block.body}</p>
            </section>
          );
        }

        if (block.type === "recommendation_group" || block.type === "action_checklist") {
          return (
            <section className="response-block" key={`${block.type}-${index}`}>
              <div className="response-block-kicker">
                {block.type === "action_checklist" ? "Next steps" : "Recommendations"}
              </div>
              <div className="response-block-title">{block.title}</div>
              <ul>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{item}</li>
                ))}
              </ul>
            </section>
          );
        }

        if (block.type === "meeting_plan") {
          return (
            <section className="response-block" key={`${block.type}-${index}`}>
              <div className="response-block-kicker">Meeting plan</div>
              <div className="response-block-title">{block.title}</div>
              <div className="meeting-plan-grid">
                {block.groups.map((group, groupIndex) => (
                  <div className="meeting-plan-item" key={groupIndex}>
                    <div className="meeting-plan-label">{group.label}</div>
                    <div className="meeting-plan-recommendation">{group.recommendation}</div>
                    <div className="meeting-plan-rationale">{group.rationale}</div>
                  </div>
                ))}
              </div>
            </section>
          );
        }

        return (
          <section className="response-block" key={`${block.type}-${index}`}>
            <div className="response-block-kicker">Draft</div>
            <div className="response-block-title">{block.title}</div>
            <div className="response-block-audience">{block.audience}</div>
            <p className="response-block-draft">{block.body}</p>
          </section>
        );
      })}
    </div>
  );
}

function EventChip({
  event,
  isActive,
  boundaryRef,
  onActivate,
  onDeactivate
}: {
  event: CalendarEvent;
  isActive: boolean;
  boundaryRef: React.RefObject<HTMLElement | null>;
  onActivate: () => void;
  onDeactivate: () => void;
}) {
  const attendees = event.attendees ?? [];
  const chipRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const hasExtraDetails = Boolean(
    event.description ||
      event.location ||
      attendees.length ||
      event.creator ||
      event.organizer ||
      event.htmlLink
  );

  useLayoutEffect(() => {
    if (!isActive) {
      return;
    }

    function updatePopoverPosition() {
      const chipElement = chipRef.current;
      const popoverElement = popoverRef.current;

      if (!chipElement || !popoverElement) {
        return;
      }

      const chipRect = chipElement.getBoundingClientRect();
      const popoverRect = popoverElement.getBoundingClientRect();
      const boundaryRect =
        boundaryRef.current?.getBoundingClientRect() ??
        new DOMRect(0, 0, window.innerWidth, window.innerHeight);
      const boundaryPadding = 12;
      const popoverGap = 8;
      const maxPopoverWidth = Math.max(220, boundaryRect.width - boundaryPadding * 2);
      const popoverWidth = Math.min(popoverRect.width, maxPopoverWidth);

      let left = chipRect.left;
      let top = chipRect.bottom + popoverGap;

      if (left + popoverWidth > boundaryRect.right - boundaryPadding) {
        left = chipRect.right - popoverWidth;
      }
      if (left < boundaryRect.left + boundaryPadding) {
        left = boundaryRect.left + boundaryPadding;
      }

      if (top + popoverRect.height > boundaryRect.bottom - boundaryPadding) {
        top = chipRect.top - popoverRect.height - popoverGap;
      }
      if (top < boundaryRect.top + boundaryPadding) {
        top = boundaryRect.top + boundaryPadding;
      }

      setPopoverStyle({
        left: `${left}px`,
        top: `${top}px`,
        maxHeight: `${Math.max(160, boundaryRect.height - boundaryPadding * 2)}px`,
        position: "fixed",
        width: `${popoverWidth}px`
      });
    }

    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);

    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [boundaryRef, isActive]);

  return (
    <div
      className={`event-popover-anchor ${isActive ? "is-active" : ""}`}
      onMouseEnter={onActivate}
      onMouseLeave={onDeactivate}
    >
      <button
        className={`event-chip ${event.allDay ? "" : "timed"}`}
        onClick={onActivate}
        onFocus={onActivate}
        ref={chipRef}
        style={eventCardStyle(event)}
        type="button"
      >
        {event.allDay ? event.title : `${eventTimeLabel(event)} ${event.title}`}
      </button>
      <div className="event-popover" ref={popoverRef} role="tooltip" style={popoverStyle}>
        <div className="event-popover-title">{event.title}</div>
        <div className="event-popover-row">
          <Clock size={14} />
          <span>
            {eventRangeLabel(event)}
            <span className="event-popover-muted"> ({eventDurationLabel(event)})</span>
          </span>
        </div>
        <div className="event-popover-row">
          <CalendarDays size={14} />
          <span>{event.calendarName}</span>
        </div>
        {event.location ? (
          <div className="event-popover-row">
            <MapPin size={14} />
            <span>{event.location}</span>
          </div>
        ) : null}
        {event.description ? (
          <div className="event-popover-row event-popover-notes">
            <FileText size={14} />
            <span>{stripHtml(event.description)}</span>
          </div>
        ) : null}
        {attendees.length ? (
          <div className="event-popover-row event-popover-notes">
            <Users size={14} />
            <span>
              {attendees
                .map((attendee) => attendee.name ?? attendee.email)
                .slice(0, 6)
                .join(", ")}
              {attendees.length > 6 ? `, +${attendees.length - 6} more` : ""}
            </span>
          </div>
        ) : null}
        {event.organizer ? (
          <div className="event-popover-meta">Organizer: {event.organizer}</div>
        ) : null}
        {event.creator && event.creator !== event.organizer ? (
          <div className="event-popover-meta">Created by: {event.creator}</div>
        ) : null}
        {event.htmlLink ? (
          <a
            className="event-popover-link"
            href={event.htmlLink}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink size={13} />
            Open in Google Calendar
          </a>
        ) : null}
        {!hasExtraDetails ? (
          <div className="event-popover-meta">No notes, location, or guests.</div>
        ) : null}
      </div>
    </div>
  );
}

function EventListItem({ event }: { event: CalendarEvent }) {
  const start = parseISO(event.start);
  const end = parseISO(event.end);

  return (
    <div className="event-list-item" style={eventCardStyle(event)}>
      <span className="color-dot" style={{ backgroundColor: event.color }} />
      <div>
        <div className="event-list-title">{event.title}</div>
        <div className="event-list-meta">
          <span>
            <strong>Date</strong>
            {format(start, "MMM d, yyyy")}
          </span>
          {!event.allDay ? (
            <span>
              <strong>Time</strong>
              {`${format(start, "h:mm a")} - ${format(end, "h:mm a")}`}
            </span>
          ) : null}
          <span>
            <strong>Calendar</strong>
            {event.calendarName}
          </span>
        </div>
      </div>
    </div>
  );
}

function DaySchedule({ date, events }: { date: Date; events: CalendarEvent[] }) {
  const dayEvents = events.filter((calendarEvent) => eventOccursOnDay(calendarEvent, date));
  const allDayEvents = dayEvents.filter((event) => event.allDay);
  const timedEvents = dayEvents.filter((event) => !event.allDay);
  const positionedTimedEvents = layoutTimedEvents(timedEvents);

  return (
    <div className="day-schedule">
      <div className="day-schedule-header">
        <div>
          <div className="agenda-day-name">{format(date, "EEEE")}</div>
          <div className="agenda-day-date">{format(date, "MMMM d, yyyy")}</div>
        </div>
        <div className="agenda-count">{dayEvents.length}</div>
      </div>

      {allDayEvents.length ? (
        <div className="all-day-row">
          <div className="time-label">All day</div>
          <div className="all-day-events">
            {allDayEvents.map((event) => (
              <EventListItem event={event} key={event.id} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="time-grid">
        <div className="time-labels">
          {dayHours.map((hour) => (
            <div className="time-label-slot" key={hour}>
              {format(new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour), "ha")}
            </div>
          ))}
        </div>
        <div className="time-lanes">
          {dayHours.map((hour) => (
            <div className="time-row" key={hour} />
          ))}
          {positionedTimedEvents.map((positionedEvent) => (
            <div
              className="timed-event-card"
              key={positionedEvent.event.id}
              style={timedEventStyle(positionedEvent)}
            >
              <div className="timed-event-title">{positionedEvent.event.title}</div>
              <div className="timed-event-time">
                {eventTimeLabel(positionedEvent.event)} · {eventDurationLabel(positionedEvent.event)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [hasSyncedUserProfile, setHasSyncedUserProfile] = useState(false);
  const [isCalendarConnected, setIsCalendarConnected] = useState(false);
  const [viewDate, setViewDate] = useState(() => new Date());
  const [calendarView, setCalendarView] = useState<CalendarView>("month");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [agentCalendarContext, setAgentCalendarContext] = useState<CalendarEvent[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingEvents, setPendingEvents] = useState<CalendarEventDraft[]>([]);
  const [pendingScheduleOptions, setPendingScheduleOptions] = useState<ScheduleOption[]>([]);
  const [pendingDeletions, setPendingDeletions] = useState<CalendarEventDeletion[]>([]);
  const [pendingEdits, setPendingEdits] = useState<CalendarEventEdit[]>([]);
  const [pendingEmails, setPendingEmails] = useState<PendingEmailDraft[]>([]);
  const [input, setInput] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [activeEventPopoverId, setActiveEventPopoverId] = useState<string | null>(null);
  const [chatWidth, setChatWidth] = useState(380);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isConnectingCalendar, setIsConnectingCalendar] = useState(false);
  const [isCheckingCalendarConnection, setIsCheckingCalendarConnection] = useState(false);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [hasLoadedInitialEvents, setHasLoadedInitialEvents] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [isAskingAgent, setIsAskingAgent] = useState(false);
  const [isStreamingAgent, setIsStreamingAgent] = useState(false);
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);
  const [isDeletingEvent, setIsDeletingEvent] = useState(false);
  const [isEditingEvent, setIsEditingEvent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const calendarPaneRef = useRef<HTMLElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const eventCacheRef = useRef<Map<string, CalendarEvent>>(new Map());
  const cachedRangesRef = useRef<CachedEventRange[]>([]);
  const calendarSessionRef = useRef(0);

  const clearCalendarData = useCallback(() => {
    calendarSessionRef.current += 1;
    setEvents([]);
    setAgentCalendarContext([]);
    setHasLoadedInitialEvents(false);
    setIsLoadingEvents(false);
    setIsCheckingCalendarConnection(false);
    setPendingNavigation(null);
    eventCacheRef.current.clear();
    cachedRangesRef.current = [];
  }, []);

  const updateAgentCalendarContext = useCallback(() => {
    setAgentCalendarContext(sortEvents(Array.from(eventCacheRef.current.values())));
  }, []);

  const getAgentCalendarContext = useCallback(() => {
    return sortEvents(Array.from(eventCacheRef.current.values()));
  }, []);

  const days = useMemo(() => monthDays(viewDate), [viewDate]);
  const visibleDays = useMemo(() => {
    if (calendarView === "day") {
      return [viewDate];
    }

    if (calendarView === "week") {
      const weekStart = startOfWeek(viewDate);
      return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
    }

    return days;
  }, [calendarView, days, viewDate]);
  const months = useMemo(() => yearMonths(viewDate), [viewDate]);
  const viewRange = useMemo(
    () => calendarRangeForView(calendarView, viewDate),
    [calendarView, viewDate]
  );
  const viewTitle = useMemo(
    () => calendarTitleForView(calendarView, viewDate),
    [calendarView, viewDate]
  );

  const getCachedEventsForRange = useCallback((rangeStart: string, rangeEnd: string) => {
    const start = new Date(rangeStart).getTime();
    const end = new Date(rangeEnd).getTime();
    const hasCoveringRange = cachedRangesRef.current.some((range) => {
      return range.start <= start && range.end >= end;
    });

    if (!hasCoveringRange) {
      return null;
    }

    return filterEventsForRange(
      Array.from(eventCacheRef.current.values()),
      rangeStart,
      rangeEnd
    );
  }, []);

  const cacheEventsForRange = useCallback((range: CalendarRange, rangeEvents: CalendarEvent[]) => {
    const rangeStart = new Date(range.start).getTime();
    const rangeEnd = new Date(range.end).getTime();

    Array.from(eventCacheRef.current.values()).forEach((event) => {
      if (eventIntersectsRange(event, rangeStart, rangeEnd)) {
        eventCacheRef.current.delete(event.id);
      }
    });

    rangeEvents.forEach((event) => {
      eventCacheRef.current.set(event.id, event);
    });

    cachedRangesRef.current.push({
      start: rangeStart,
      end: rangeEnd
    });
  }, []);

  const fetchEventsForRange = useCallback(async (range: CalendarRange) => {
    if (!user) {
      return [];
    }

    const idToken = await user.getIdToken();
    const response = await fetch("/api/calendar/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idToken,
        timeMin: range.start,
        timeMax: range.end
      })
    });

    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      throw new Error(body.error ?? "Unable to load calendar events.");
    }

    const body = (await response.json()) as { events: CalendarEvent[] };
    return body.events;
  }, [user]);

  function handleResizeChat(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = chatWidth;
    const viewportWidth = window.innerWidth;
    const minWidth = 320;
    const maxWidth = Math.floor(viewportWidth * 0.5);
    const target = event.currentTarget;

    target.setPointerCapture(pointerId);

    function handlePointerMove(moveEvent: PointerEvent) {
      const nextWidth = Math.min(
        maxWidth,
        Math.max(minWidth, startWidth + startX - moveEvent.clientX)
      );
      setChatWidth(nextWidth);
    }

    function handlePointerUp() {
      target.releasePointerCapture(pointerId);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }

  function goToPreviousRange() {
    navigateToRange(calendarView, previousDateForView(calendarView, viewDate));
  }

  function goToNextRange() {
    navigateToRange(calendarView, nextDateForView(calendarView, viewDate));
  }

  const syncUserProfile = useCallback(async (currentUser: User) => {
    const idToken = await currentUser.getIdToken();
    const response = await fetch("/api/users/me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idToken,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: navigator.language
      })
    });

    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      throw new Error(body.error ?? "Unable to sync user profile.");
    }

  }, []);

  const startCalendarConnection = useCallback(async (currentUser: User) => {
    setIsConnectingCalendar(true);
    setError(null);

    try {
      const idToken = await currentUser.getIdToken();
      const response = await fetch("/api/google/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken })
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Unable to start Google Calendar connection.");
      }

      const body = (await response.json()) as { authUrl: string };
      window.location.assign(body.authUrl);
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Unable to start Google Calendar connection."
      );
      setIsConnectingCalendar(false);
    }
  }, []);

  const checkCalendarConnection = useCallback(async (currentUser: User | null = user) => {
    if (!currentUser) {
      return;
    }

    setIsCheckingCalendarConnection(true);
    const calendarSession = calendarSessionRef.current;
    try {
      const idToken = await currentUser.getIdToken();
      const response = await fetch("/api/google/oauth/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken })
      });

      if (!response.ok) {
        if (calendarSession === calendarSessionRef.current) {
          setIsCalendarConnected(false);
        }
        return;
      }

      const body = (await response.json()) as { connected: boolean };
      if (calendarSession !== calendarSessionRef.current) {
        return;
      }

      setIsCalendarConnected(body.connected);
      if (!body.connected) {
        await startCalendarConnection(currentUser);
      }
    } catch {
      if (calendarSession === calendarSessionRef.current) {
        setIsCalendarConnected(false);
      }
    } finally {
      if (calendarSession === calendarSessionRef.current) {
        setIsCheckingCalendarConnection(false);
      }
    }
  }, [startCalendarConnection, user]);

  useEffect(() => {
    try {
      return onAuthStateChanged(getFirebaseAuth(), (currentUser) => {
        setUser(currentUser);
        setHasSyncedUserProfile(false);
        setIsCalendarConnected(false);
        clearCalendarData();
        const calendarSession = calendarSessionRef.current;
        if (!currentUser) {
          setPendingScheduleOptions([]);
          setPendingDeletions([]);
          setPendingEdits([]);
          return;
        }

        void syncUserProfile(currentUser)
          .then(() => {
            if (calendarSession !== calendarSessionRef.current) {
              return;
            }

            setCalendarView("month");
            setHasSyncedUserProfile(true);
          })
          .catch((profileError) => {
            if (calendarSession !== calendarSessionRef.current) {
              return;
            }

            setError(
              profileError instanceof Error
                ? profileError.message
                : "Unable to sync user profile."
            );
            setHasSyncedUserProfile(true);
          })
          .finally(() => {
            if (calendarSession !== calendarSessionRef.current) {
              return;
            }

            void checkCalendarConnection(currentUser);
          });
      });
    } catch (authError) {
      setError(
        authError instanceof Error
          ? authError.message
          : "Firebase authentication is not configured."
      );
      return undefined;
    }
  }, [checkCalendarConnection, clearCalendarData, syncUserProfile]);

  useEffect(() => {
    const stored = sessionStorage.getItem(chatStorageKey);
    if (stored) {
      setMessages(JSON.parse(stored) as ChatMessage[]);
    }
  }, []);

  useEffect(() => {
    sessionStorage.setItem(chatStorageKey, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    const messageList = messageListRef.current;

    if (!messageList) {
      return;
    }

    messageList.scrollTo({
      top: messageList.scrollHeight,
      behavior: "smooth"
    });
  }, [
    isAskingAgent,
    messages,
    pendingDeletions,
    pendingEdits,
    pendingEmails,
    pendingEvents,
    pendingScheduleOptions
  ]);

  async function handleSignIn() {
    setIsSigningIn(true);
    setError(null);

    try {
      const result = await signInWithPopup(getFirebaseAuth(), createCalendarProvider());
      setUser(result.user);
      setHasSyncedUserProfile(false);
      clearCalendarData();
      setPendingEvents([]);
      setPendingScheduleOptions([]);
      setPendingDeletions([]);
      setPendingEdits([]);
      await syncUserProfile(result.user);
      setCalendarView("month");
      setHasSyncedUserProfile(true);
      await checkCalendarConnection(result.user);
    } catch (signInError) {
      setError(
        signInError instanceof Error ? signInError.message : "Unable to sign in."
      );
    } finally {
      setIsSigningIn(false);
    }
  }

  async function handleSignOut() {
    await signOut(getFirebaseAuth());
    setMessages([]);
    setPendingEvents([]);
    setPendingScheduleOptions([]);
    setPendingDeletions([]);
    setPendingEdits([]);
    setPendingEmails([]);
    setIsCalendarConnected(false);
    setHasSyncedUserProfile(false);
    clearCalendarData();
    sessionStorage.removeItem(chatStorageKey);
  }

  async function handleConnectCalendar() {
    if (!user || isConnectingCalendar) {
      return;
    }

    await startCalendarConnection(user);
  }

  const loadEvents = useCallback(async (options: {
    force?: boolean;
    targetDate: Date;
    targetView: CalendarView;
  }) => {
    if (!user || !isCalendarConnected) {
      return;
    }

    const targetView = options.targetView;
    const targetDate = options.targetDate;
    const targetRange = calendarRangeForView(targetView, targetDate);
    const loadRange = calendarYearRange(targetDate);
    const targetTitle = calendarTitleForView(targetView, targetDate);
    const cachedYearEvents = getCachedEventsForRange(loadRange.start, loadRange.end);
    const calendarSession = calendarSessionRef.current;

    if (cachedYearEvents && !options?.force) {
      setViewDate(targetDate);
      setCalendarView(targetView);
      setEvents(
        getCachedEventsForRange(targetRange.start, targetRange.end) ??
          filterEventsForRange(cachedYearEvents, targetRange.start, targetRange.end)
      );
      setPendingNavigation(null);
      setHasLoadedInitialEvents(true);
      updateAgentCalendarContext();
      return;
    }

    const nextPendingNavigation: PendingNavigation = {
      date: targetDate,
      title: targetTitle,
      view: targetView
    };

    setPendingNavigation(nextPendingNavigation);
    setIsLoadingEvents(true);
    setError(null);

    try {
      const loadedEvents = await fetchEventsForRange(loadRange);
      if (calendarSession !== calendarSessionRef.current) {
        return;
      }

      cacheEventsForRange(loadRange, loadedEvents);
      updateAgentCalendarContext();
      setViewDate(targetDate);
      setCalendarView(targetView);
      setEvents(
        getCachedEventsForRange(targetRange.start, targetRange.end) ??
          filterEventsForRange(loadedEvents, targetRange.start, targetRange.end)
      );
      setHasLoadedInitialEvents(true);
      setPendingNavigation(null);
    } catch (loadError) {
      if (calendarSession !== calendarSessionRef.current) {
        return;
      }

      const message =
        loadError instanceof Error ? loadError.message : "Unable to load events.";
      setError(message);
      setPendingNavigation({
        ...nextPendingNavigation,
        error: message
      });
    } finally {
      if (calendarSession === calendarSessionRef.current) {
        setIsLoadingEvents(false);
      }
    }
  }, [
    cacheEventsForRange,
    fetchEventsForRange,
    getCachedEventsForRange,
    isCalendarConnected,
    updateAgentCalendarContext,
    user
  ]);

  const navigateToRange = useCallback((targetView: CalendarView, targetDate: Date) => {
    if (isLoadingEvents || pendingNavigation) {
      return;
    }

    void loadEvents({ targetDate, targetView });
  }, [isLoadingEvents, loadEvents, pendingNavigation]);

  useEffect(() => {
    if (!isCalendarConnected || hasLoadedInitialEvents) {
      return;
    }

    void loadEvents({ targetDate: viewDate, targetView: calendarView });
  }, [calendarView, hasLoadedInitialEvents, isCalendarConnected, loadEvents, viewDate]);

  async function streamAssistantMessage(
    baseMessages: ChatMessage[],
    content: string,
    responseBlocks?: AgentResponseBlock[]
  ) {
    const assistantIndex = baseMessages.length;
    const nextMessages: ChatMessage[] = [
      ...baseMessages,
      { role: "assistant", content: "" }
    ];
    const chunkSize = content.length > 1200 ? 5 : content.length > 600 ? 4 : 3;
    const delayMs = 14;

    setMessages(nextMessages);
    setIsAskingAgent(false);
    setIsStreamingAgent(true);

    try {
      for (let visibleLength = chunkSize; visibleLength < content.length; visibleLength += chunkSize) {
        await new Promise((resolve) => {
          window.setTimeout(resolve, delayMs);
        });

        setMessages((currentMessages) => {
          const updatedMessages = [...currentMessages];
          updatedMessages[assistantIndex] = {
            role: "assistant",
            content: content.slice(0, visibleLength)
          };
          return updatedMessages;
        });
      }

      setMessages((currentMessages) => {
        const updatedMessages = [...currentMessages];
        updatedMessages[assistantIndex] = {
          role: "assistant",
          content,
          responseBlocks
        };
        return updatedMessages;
      });
    } finally {
      setIsStreamingAgent(false);
    }
  }

  async function openPendingEmailDrafts(baseMessages: ChatMessage[], drafts: PendingEmailDraft[]) {
    const openedDrafts: PendingEmailDraft[] = [];
    const openedCount = drafts.reduce((count, pendingDraft, draftIndex) => {
      const openedWindow = window.open(gmailComposeUrl(pendingDraft.draft), "_blank");
      if (openedWindow) {
        openedWindow.opener = null;
        openedDrafts.push(drafts[draftIndex]);
        return count + 1;
      }

      return count;
    }, 0);
    const message =
      openedCount === drafts.length
        ? `Opened ${openedCount} email draft${openedCount === 1 ? "" : "s"} in Gmail. Review each one there before sending.`
        : `Opened ${openedCount} of ${drafts.length} email drafts in Gmail. Use the draft cards below for any that did not open.`;

    await streamAssistantMessage(baseMessages, message);

    setPendingEmails((currentDrafts) =>
      currentDrafts.map((pendingDraft) =>
        openedDrafts.includes(pendingDraft) ? { ...pendingDraft, status: "opened" } : pendingDraft
      )
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = input.trim();
    if (!content || isAskingAgent || isStreamingAgent) {
      return;
    }

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setInput("");
    setIsAskingAgent(true);
    setError(null);

    const activeEmailDrafts = pendingEmails.filter(
      (pendingDraft) => pendingDraft.status === "pending"
    );

    try {
      const idToken = await user?.getIdToken();
      if (!idToken) {
        throw new Error("Sign in again to use Cally.");
      }

      const currentAgentContext = getAgentCalendarContext();
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken,
          messages: nextMessages,
          calendarContext: currentAgentContext.length
            ? currentAgentContext
            : agentCalendarContext,
          clientContext: {
            calendarView,
            localDate: format(new Date(), "yyyy-MM-dd"),
            localDateTime: new Date().toString(),
            localWeekday: format(new Date(), "EEEE"),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            viewDate: format(viewDate, "yyyy-MM-dd"),
            visibleRange: viewRange
          },
          conversationState: {
            scheduleOptions: pendingScheduleOptions,
            pendingEvents,
            pendingDeletions,
            pendingEdits,
            pendingEmailDraftCount: activeEmailDrafts.length
          }
        })
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Unable to contact the calendar agent.");
      }

      const body = (await response.json()) as AgentChatResponse;
      if (body.confirmedPendingAction) {
        if (body.confirmedPendingAction === "create_events") {
          await handleCreateEvent();
          return;
        }

        if (body.confirmedPendingAction === "delete_events") {
          await handleDeleteEvents();
          return;
        }

        if (body.confirmedPendingAction === "edit_events") {
          await handleEditEvents();
          return;
        }

        if (body.confirmedPendingAction === "open_email_drafts") {
          await openPendingEmailDrafts(nextMessages, activeEmailDrafts);
          return;
        }
      }

      await streamAssistantMessage(nextMessages, body.message, body.responseBlocks);
      setPendingEvents(body.proposedEvents ?? []);
      setPendingDeletions(body.proposedDeletions ?? []);
      setPendingEdits(body.proposedEdits ?? []);
      setPendingScheduleOptions(
        body.conversationState?.scheduleOptions ?? body.scheduleOptions ?? []
      );
      setPendingEmails(
        (body.proposedEmails ?? []).map((draft) => ({ draft, status: "pending" }))
      );
    } catch (agentError) {
      setError(
        agentError instanceof Error
          ? agentError.message
          : "Unable to contact the calendar agent."
      );
      setMessages(nextMessages);
      setIsAskingAgent(false);
    } finally {
      setIsAskingAgent(false);
    }
  }

  function handleChatInputKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  async function handleCreateEvent() {
    if (!user || !pendingEvents.length || isCreatingEvent) {
      return;
    }

    setIsCreatingEvent(true);
    setError(null);

    try {
      const idToken = await user.getIdToken();
      const createdEvents: CalendarEvent[] = [];

      for (const eventDraft of pendingEvents) {
        const response = await fetch("/api/calendar/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idToken,
            event: eventDraft
          })
        });

        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error ?? "Unable to create calendar event.");
        }

        const body = (await response.json()) as { event: CalendarEvent };
        createdEvents.push(body.event);
        eventCacheRef.current.set(body.event.id, body.event);
      }
      updateAgentCalendarContext();

      setEvents((currentEvents) =>
        [...currentEvents, ...createdEvents].sort(
          (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
        )
      );
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "assistant",
          content:
            createdEvents.length === 1
              ? `Created "${createdEvents[0].title}" on your primary Google Calendar.`
              : `Created ${createdEvents.length} events on your primary Google Calendar.`
        }
      ]);
      setPendingEvents([]);
      setPendingScheduleOptions([]);
      void loadEvents({ targetDate: viewDate, targetView: calendarView });
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Unable to create calendar event."
      );
    } finally {
      setIsCreatingEvent(false);
    }
  }

  async function handleDeleteEvents() {
    if (!user || !pendingDeletions.length || isDeletingEvent) {
      return;
    }

    setIsDeletingEvent(true);
    setError(null);

    try {
      const idToken = await user.getIdToken();
      const deletedIds: string[] = [];

      for (const pendingDeletion of pendingDeletions) {
        const response = await fetch("/api/calendar/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idToken,
            eventId: pendingDeletion.id
          })
        });

        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error ?? "Unable to delete calendar event.");
        }

        deletedIds.push(pendingDeletion.id);
        eventCacheRef.current.delete(pendingDeletion.id);
      }

      updateAgentCalendarContext();
      setEvents((currentEvents) =>
        currentEvents.filter((calendarEvent) => !deletedIds.includes(calendarEvent.id))
      );
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "assistant",
          content:
            deletedIds.length === 1
              ? `Deleted "${pendingDeletions[0].title}" from your calendar.`
              : `Deleted ${deletedIds.length} events from your calendar.`
        }
      ]);
      setPendingDeletions([]);
      void loadEvents({ force: true, targetDate: viewDate, targetView: calendarView });
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Unable to delete calendar event."
      );
    } finally {
      setIsDeletingEvent(false);
    }
  }

  async function handleEditEvents() {
    if (!user || !pendingEdits.length || isEditingEvent) {
      return;
    }

    setIsEditingEvent(true);
    setError(null);

    try {
      const idToken = await user.getIdToken();
      const editedEvents: CalendarEvent[] = [];

      for (const pendingEdit of pendingEdits) {
        const response = await fetch("/api/calendar/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idToken,
            eventId: pendingEdit.id,
            updates: pendingEdit.updates
          })
        });

        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error ?? "Unable to edit calendar event.");
        }

        const body = (await response.json()) as { event: CalendarEvent };
        editedEvents.push(body.event);
        eventCacheRef.current.set(body.event.id, body.event);
      }

      updateAgentCalendarContext();
      setEvents((currentEvents) => {
        const editedById = new Map(editedEvents.map((calendarEvent) => [calendarEvent.id, calendarEvent]));
        return currentEvents
          .map((calendarEvent) => editedById.get(calendarEvent.id) ?? calendarEvent)
          .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
      });
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "assistant",
          content:
            editedEvents.length === 1
              ? `Updated "${editedEvents[0].title}" on your calendar.`
              : `Updated ${editedEvents.length} events on your calendar.`
        }
      ]);
      setPendingEdits([]);
      void loadEvents({ force: true, targetDate: viewDate, targetView: calendarView });
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : "Unable to edit calendar event.");
    } finally {
      setIsEditingEvent(false);
    }
  }

  function createEventButtonLabel() {
    if (isCreatingEvent) {
      return "Creating...";
    }

    return pendingEvents.length > 1 ? "Create all" : "Create";
  }

  function deleteEventButtonLabel() {
    if (isDeletingEvent) {
      return "Deleting...";
    }

    return pendingDeletions.length > 1 ? "Delete all" : "Delete";
  }

  function editEventButtonLabel() {
    if (isEditingEvent) {
      return "Updating...";
    }

    return pendingEdits.length > 1 ? "Update all" : "Update";
  }

  function handleOpenEmailDraft(draft: EmailDraft, index: number) {
    const openedWindow = window.open(gmailComposeUrl(draft), "_blank");
    if (openedWindow) {
      openedWindow.opener = null;
    }
    setPendingEmails((currentDrafts) =>
      currentDrafts.map((pendingDraft, draftIndex) =>
        draftIndex === index ? { ...pendingDraft, status: "opened" } : pendingDraft
      )
    );
  }

  const calendars = Array.from(
    new Map(
      (agentCalendarContext.length ? agentCalendarContext : events).map((event) => [
        event.calendarName,
        event
      ])
    ).values()
  );
  const isCalendarNavigationBlocked = isLoadingEvents || Boolean(pendingNavigation);
  const showCalendarBootScreen =
    Boolean(user) &&
    !hasLoadedInitialEvents &&
    (!hasSyncedUserProfile ||
      isCheckingCalendarConnection ||
      isCalendarConnected ||
      isLoadingEvents ||
      Boolean(pendingNavigation));
  const showCalendarOverlay = !showCalendarBootScreen && Boolean(pendingNavigation);
  const calendarOverlayTitle = pendingNavigation?.error
    ? hasLoadedInitialEvents
      ? "Couldn't sync events"
      : "Could not load your calendar"
    : pendingNavigation
      ? `Syncing ${pendingNavigation.title}`
      : "Syncing your calendar";
  const calendarOverlayDetail = pendingNavigation?.error
    ? hasLoadedInitialEvents
      ? `${pendingNavigation.title} didn't load.`
      : pendingNavigation.error
    : "Getting your Google Calendar events...";

  function handleRetryCalendarLoad() {
    void loadEvents({
      force: true,
      targetDate: pendingNavigation?.date ?? viewDate,
      targetView: pendingNavigation?.view ?? calendarView
    });
  }

  function handleStayOnCurrentCalendar() {
    setPendingNavigation(null);
    setError(null);
  }

  if (!user) {
    return (
      <main className="sign-in-screen">
        <div className="signin-aurora" aria-hidden="true" />
        <div className="signin-month-backdrop" aria-hidden="true">
          <div className="signin-month-header">
            <span>Sun</span>
            <span>Mon</span>
            <span>Tue</span>
            <span>Wed</span>
            <span>Thu</span>
            <span>Fri</span>
            <span>Sat</span>
          </div>
          <div className="signin-month-grid">
            {Array.from({ length: 42 }, (_, index) => (
              <div className="signin-month-day" key={index}>
                <span className="signin-month-date">{index + 1 <= 31 ? index + 1 : index - 30}</span>
                {[5, 10, 15, 24, 32].includes(index) ? (
                  <span className="signin-month-event" />
                ) : null}
                {[12, 20].includes(index) ? (
                  <span className="signin-month-event secondary" />
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <section className="sign-in-box">
          <div className="signin-title-lockup">
            <div className="signin-calendar-stage" aria-hidden="true">
              <div className="floating-calendar">
                <div className="floating-calendar-header">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="floating-calendar-grid">
                  {Array.from({ length: 35 }, (_, index) => (
                    <span
                      className={[
                        index === 8 || index === 16 || index === 23 ? "has-event" : "",
                        index === 11 ? "is-today" : ""
                      ].join(" ")}
                      key={index}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="signin-title">Cally</div>
          </div>

          <div className="signin-glass-card">
            <div className="signin-prompt">Sign in with Google below.</div>
            <button
              className="primary-button glass-button"
              onClick={handleSignIn}
              disabled={isSigningIn}
            >
              <CalendarDays size={18} />
              {isSigningIn ? "Opening Google..." : "Sign in with Google"}
            </button>
            {error ? <div className="error glass-error">{error}</div> : null}
          </div>
        </section>
      </main>
    );
  }

  if (showCalendarBootScreen) {
    return (
      <main className="calendar-boot-screen">
        <div
          aria-busy={!pendingNavigation?.error}
          aria-live="polite"
          className="calendar-loading-panel"
          role="status"
        >
          {!pendingNavigation?.error ? (
            <RefreshCw className="calendar-loading-spinner" size={22} />
          ) : null}
          <div className="calendar-loading-title">{calendarOverlayTitle}</div>
          <div className="calendar-loading-detail">{calendarOverlayDetail}</div>
          {pendingNavigation?.error ? (
            <div className="calendar-loading-actions">
              <button
                className="primary-button"
                disabled={isLoadingEvents}
                onClick={handleRetryCalendarLoad}
                type="button"
              >
                <RefreshCw size={16} />
                Retry
              </button>
            </div>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main
      className={[
        "app-shell",
        isSidebarOpen ? "" : "sidebar-closed",
        isChatOpen ? "" : "chat-closed"
      ].join(" ")}
      style={{ "--chat-width": `${chatWidth}px` } as React.CSSProperties}
    >
      {isSidebarOpen ? (
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand">Cally</div>
        </div>

        <div className="user-strip">
          <div
            aria-hidden="true"
            className="avatar"
            style={user.photoURL ? { backgroundImage: `url(${user.photoURL})` } : undefined}
          />
          <div>
            <div className="user-name">{user.displayName ?? "Google user"}</div>
            <div className="user-email">{user.email}</div>
          </div>
        </div>

        <div className="section-title">{format(viewDate, "MMMM yyyy")}</div>
        <div className="mini-calendar">
          {weekdayLabels.map((label) => (
            <div className="mini-day-name" key={label}>
              {label[0]}
            </div>
          ))}
          {days.map((day) => (
            <div
              className={[
                "mini-day",
                !isSameMonth(day, viewDate) ? "is-outside" : "",
                isToday(day) ? "is-current" : ""
              ].join(" ")}
              key={day.toISOString()}
            >
              {format(day, "d")}
            </div>
          ))}
        </div>

        <div className="section-title">Calendars</div>
        <div className="calendar-list">
          {calendars.length ? (
            calendars.map((calendar) => (
              <div className="calendar-list-item" key={calendar.calendarName}>
                <span className="color-dot" style={{ backgroundColor: calendar.color }} />
                <span>{calendar.calendarName}</span>
              </div>
            ))
          ) : user && !isCalendarConnected ? (
            <div className="calendar-reconnect">
              <div className="muted">
                {isConnectingCalendar
                  ? "Opening Google Calendar authorization..."
                  : "Calendar authorization is required."}
              </div>
              <button
                className="text-button"
                disabled={isConnectingCalendar}
                onClick={handleConnectCalendar}
                type="button"
              >
                <CalendarDays size={16} />
                {isConnectingCalendar ? "Opening..." : "Authorize now"}
              </button>
            </div>
          ) : (
            <div className="muted">No visible calendars loaded.</div>
          )}
        </div>
        <button className="text-button logout-button" onClick={handleSignOut} type="button">
          Logout
        </button>
      </aside>
      ) : null}

      <section className="main" ref={calendarPaneRef}>
        <header className="calendar-header">
          <div className="calendar-title-row">
            <button
              aria-label={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
              className="icon-button"
              onClick={() => setIsSidebarOpen((open) => !open)}
              type="button"
            >
              {isSidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
            </button>
            <div>
              <div className="month-title">{viewTitle}</div>
            </div>
          </div>
          <div className="header-actions">
            <div className="view-switcher" aria-label="Calendar view">
              {calendarViews.map((view) => (
                <button
                  className={calendarView === view ? "is-active" : ""}
                  disabled={isCalendarNavigationBlocked}
                  key={view}
                  onClick={() => navigateToRange(view, viewDate)}
                  type="button"
                >
                  {view}
                </button>
              ))}
            </div>
            <button
              className="text-button"
              disabled={isCalendarNavigationBlocked}
              onClick={() => navigateToRange(calendarView, new Date())}
              type="button"
            >
              Today
            </button>
            <button
              aria-label="Previous range"
              className="icon-button"
              disabled={isCalendarNavigationBlocked}
              onClick={goToPreviousRange}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              aria-label="Next range"
              className="icon-button"
              disabled={isCalendarNavigationBlocked}
              onClick={goToNextRange}
            >
              <ChevronRight size={18} />
            </button>
            <button
              aria-label="Refresh events"
              className="icon-button"
              onClick={() =>
                loadEvents({ force: true, targetDate: viewDate, targetView: calendarView })
              }
              disabled={isCalendarNavigationBlocked}
            >
              <RefreshCw size={17} />
            </button>
            <button
              aria-label={isChatOpen ? "Hide calendar agent" : "Show calendar agent"}
              className="icon-button"
              onClick={() => setIsChatOpen((open) => !open)}
              type="button"
            >
              {isChatOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
            </button>
          </div>
        </header>

        <div className="calendar-content">
        {calendarView === "month" ? (
          <div className="calendar-grid">
            {weekdayLabels.map((label) => (
              <div className="day-name" key={label}>
                {label}
              </div>
            ))}
            {days.map((day) => {
              const dayEvents = events.filter((calendarEvent) =>
                eventOccursOnDay(calendarEvent, day)
              );

              return (
                <div
                  className={[
                    "day-cell",
                    !isSameMonth(day, viewDate) ? "is-outside" : "",
                    isToday(day) ? "is-today" : ""
                  ].join(" ")}
                  key={day.toISOString()}
                >
                  <div className="day-number">{format(day, "d")}</div>
                  <div className="event-stack">
                    {dayEvents.slice(0, 4).map((calendarEvent) => (
                      <EventChip
                        boundaryRef={calendarPaneRef}
                        event={calendarEvent}
                        isActive={activeEventPopoverId === calendarEvent.id}
                        key={`${calendarEvent.id}-${day.toISOString()}`}
                        onActivate={() => setActiveEventPopoverId(calendarEvent.id)}
                        onDeactivate={() =>
                          setActiveEventPopoverId((currentId) =>
                            currentId === calendarEvent.id ? null : currentId
                          )
                        }
                      />
                    ))}
                    {dayEvents.length > 4 ? (
                      <div className="event-time">+{dayEvents.length - 4} more</div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {calendarView === "day" ? (
          <DaySchedule date={viewDate} events={events} />
        ) : null}

        {calendarView === "week" ? (
          <div className="agenda-view week">
            {visibleDays.map((day) => {
              const dayEvents = events.filter((calendarEvent) =>
                eventOccursOnDay(calendarEvent, day)
              );

              return (
                <section
                  className={`agenda-day ${isToday(day) ? "is-today" : ""}`}
                  key={day.toISOString()}
                >
                  <header className="agenda-day-header">
                    <div>
                      <div className="agenda-day-name">{format(day, "EEEE")}</div>
                      <div className="agenda-day-date">{format(day, "MMM d")}</div>
                    </div>
                    <div className="agenda-count">{dayEvents.length}</div>
                  </header>
                  <div className="agenda-events">
                    {dayEvents.length ? (
                      dayEvents.map((calendarEvent) => (
                        <EventListItem event={calendarEvent} key={calendarEvent.id} />
                      ))
                    ) : (
                      <div className="empty-day">No events</div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}

        {calendarView === "year" ? (
          <div className="year-view">
            {months.map((month) => {
              const monthEvents = events.filter((calendarEvent) =>
                isSameMonth(parseISO(calendarEvent.start), month)
              );
              const monthGridDays = monthDays(month);

              return (
                <section className="year-month" key={month.toISOString()}>
                  <header className="year-month-header">
                    <span>{format(month, "MMMM")}</span>
                    <span>
                      {monthEvents.length} events ·{" "}
                      {
                        monthGridDays.filter((day) => {
                          return (
                            isSameMonth(day, month) &&
                            events.some((calendarEvent) => eventOccursOnDay(calendarEvent, day))
                          );
                        }).length
                      }{" "}
                      busy days
                    </span>
                  </header>
                  <div className="year-month-grid">
                    {weekdayLabels.map((label) => (
                      <div className="year-weekday" key={label}>
                        {label[0]}
                      </div>
                    ))}
                    {monthGridDays.map((day) => {
                      const dayEventCount = events.filter((calendarEvent) =>
                        eventOccursOnDay(calendarEvent, day)
                      ).length;
                      const busyLevel = Math.min(4, dayEventCount);
                      const isOutsideMonth = !isSameMonth(day, month);

                      const label = `${format(day, "MMMM d")}${
                        dayEventCount
                          ? `, ${dayEventCount} event${dayEventCount === 1 ? "" : "s"}`
                          : ", no events"
                      }`;

                      return (
                        <button
                          aria-label={label}
                          disabled={isCalendarNavigationBlocked}
                          className={[
                            "year-day",
                            isOutsideMonth ? "is-outside" : "",
                            isToday(day) ? "is-today" : "",
                            dayEventCount ? "has-events" : "",
                            `busy-${busyLevel}`
                          ].join(" ")}
                          key={day.toISOString()}
                          onClick={() => {
                            navigateToRange("day", day);
                          }}
                          title={label}
                          type="button"
                        >
                          {format(day, "d")}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}

        {showCalendarOverlay ? (
          <div
            aria-busy={!pendingNavigation?.error}
            aria-live="polite"
            className="calendar-loading-overlay"
            role="status"
          >
            <div className="calendar-loading-panel">
              {!pendingNavigation?.error ? (
                <RefreshCw className="calendar-loading-spinner" size={22} />
              ) : null}
              <div className="calendar-loading-title">{calendarOverlayTitle}</div>
              <div className="calendar-loading-detail">{calendarOverlayDetail}</div>
              {pendingNavigation?.error ? (
                <div className="calendar-loading-actions">
                  <button
                    className="primary-button"
                    disabled={isLoadingEvents}
                    onClick={handleRetryCalendarLoad}
                    type="button"
                  >
                    <RefreshCw size={16} />
                    Retry
                  </button>
                  {hasLoadedInitialEvents ? (
                    <button
                      className="text-button"
                      disabled={isLoadingEvents}
                      onClick={handleStayOnCurrentCalendar}
                      type="button"
                    >
                      Stay on current calendar
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        </div>
      </section>

      {isChatOpen ? (
      <aside className="chat-panel">
        <button
          aria-label="Resize calendar agent"
          className="chat-resize-handle"
          onPointerDown={handleResizeChat}
          type="button"
        />
        <header className="chat-header">
          <div>
            <div className="chat-title">Cally</div>
            <div className="muted">Your Calendar Assistant</div>
          </div>
          <button
            aria-label="Hide calendar agent"
            className="icon-button"
            onClick={() => setIsChatOpen(false)}
            type="button"
          >
            <PanelRightClose size={18} />
          </button>
        </header>

        <div className="message-list" ref={messageListRef}>
          {messages.length ? (
            messages.map((message, index) => (
              <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
                {message.role === "assistant" ? (
                  <>
                    <MarkdownMessage content={message.content} />
                    {message.responseBlocks?.length ? (
                      <ResponseBlocks blocks={message.responseBlocks} />
                    ) : null}
                  </>
                ) : (
                  message.content
                )}
              </div>
            ))
          ) : (
            <div className="message assistant">
              Ask about conflicts, meeting load, open focus time, or say something
              like &quot;schedule a planning block tomorrow at 2 PM for 45 minutes.&quot;
            </div>
          )}
          {pendingEvents.map((pendingEvent, eventIndex) => (
            <div className="proposal-card" key={`${pendingEvent.title}-${pendingEvent.start}`}>
              <div className="proposal-kicker">
                Proposed event{" "}
                {pendingEvents.length > 1 ? `${eventIndex + 1} of ${pendingEvents.length}` : ""}
              </div>
              <div className="proposal-title">{pendingEvent.title}</div>
              <div className="proposal-detail">
                {pendingEvent.allDay
                  ? `${pendingEvent.start} - ${pendingEvent.end}`
                  : `${format(parseISO(pendingEvent.start), "MMM d, h:mm a")} - ${format(
                      parseISO(pendingEvent.end),
                      "h:mm a"
                    )}`}
              </div>
              {pendingEvent.attendees?.length ? (
                <div className="proposal-detail">
                  Invite: {pendingEvent.attendees.join(", ")}
                </div>
              ) : null}
              {pendingEvent.location ? (
                <div className="proposal-detail">{pendingEvent.location}</div>
              ) : null}
              {pendingEvent.description ? (
                <div className="proposal-description">{pendingEvent.description}</div>
              ) : null}
              <div className="proposal-actions">
                <button
                  className="primary-button"
                  disabled={isCreatingEvent}
                  onClick={handleCreateEvent}
                  type="button"
                >
                  <Check size={16} />
                  {createEventButtonLabel()}
                </button>
                <button
                  className="text-button"
                  disabled={isCreatingEvent}
                  onClick={() => {
                    setPendingEvents([]);
                    setPendingScheduleOptions([]);
                  }}
                  type="button"
                >
                  <X size={16} />
                  Cancel
                </button>
              </div>
            </div>
          ))}
          {pendingDeletions.map((pendingDeletion, deletionIndex) => (
            <div className="proposal-card" key={`${pendingDeletion.id}-${deletionIndex}`}>
              <div className="proposal-kicker">
                Delete event{" "}
                {pendingDeletions.length > 1 ? `${deletionIndex + 1} of ${pendingDeletions.length}` : ""}
              </div>
              <div className="proposal-title">{pendingDeletion.title}</div>
              <div className="proposal-detail">{deletionRangeLabel(pendingDeletion)}</div>
              <div className="proposal-detail">{pendingDeletion.calendarName}</div>
              <div className="proposal-actions">
                <button
                  className="primary-button"
                  disabled={isDeletingEvent}
                  onClick={handleDeleteEvents}
                  type="button"
                >
                  <X size={16} />
                  {deleteEventButtonLabel()}
                </button>
                <button
                  className="text-button"
                  disabled={isDeletingEvent}
                  onClick={() => setPendingDeletions([])}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          ))}
          {pendingEdits.map((pendingEdit, editIndex) => (
            <div className="proposal-card" key={`${pendingEdit.id}-${editIndex}`}>
              <div className="proposal-kicker">
                Edit event{" "}
                {pendingEdits.length > 1 ? `${editIndex + 1} of ${pendingEdits.length}` : ""}
              </div>
              <div className="proposal-title">{pendingEdit.title}</div>
              <div className="proposal-detail">Current: {deletionRangeLabel(pendingEdit)}</div>
              {pendingEdit.updates.title ? (
                <div className="proposal-detail">New title: {pendingEdit.updates.title}</div>
              ) : null}
              {pendingEdit.updates.start && pendingEdit.updates.end ? (
                <div className="proposal-detail">
                  New time:{" "}
                  {deletionRangeLabel({
                    ...pendingEdit,
                    start: pendingEdit.updates.start,
                    end: pendingEdit.updates.end,
                    allDay: Boolean(pendingEdit.updates.allDay)
                  })}
                </div>
              ) : null}
              <div className="proposal-actions">
                <button
                  className="primary-button"
                  disabled={isEditingEvent}
                  onClick={handleEditEvents}
                  type="button"
                >
                  <Check size={16} />
                  {editEventButtonLabel()}
                </button>
                <button
                  className="text-button"
                  disabled={isEditingEvent}
                  onClick={() => setPendingEdits([])}
                  type="button"
                >
                  <X size={16} />
                  Cancel
                </button>
              </div>
            </div>
          ))}
          {pendingEmails.map((pendingEmailDraft, draftIndex) => (
            <div
              className={`proposal-card ${pendingEmailDraft.status !== "pending" ? "is-resolved" : ""}`}
              key={`${pendingEmailDraft.draft.subject}-${draftIndex}`}
            >
              <div className="proposal-kicker">
                Email draft{" "}
                {pendingEmails.length > 1
                  ? `${draftIndex + 1} of ${pendingEmails.length}`
                  : ""}
                {pendingEmailDraft.status !== "pending"
                  ? ` · ${pendingEmailDraft.status}`
                  : ""}
              </div>
              <div className="proposal-title">{pendingEmailDraft.draft.subject}</div>
              {pendingEmailDraft.draft.to.length ? (
                <div className="proposal-detail">
                  To: {pendingEmailDraft.draft.to.join(", ")}
                </div>
              ) : (
                <div className="proposal-detail">Add recipients in Gmail before sending.</div>
              )}
              {pendingEmailDraft.draft.cc?.length ? (
                <div className="proposal-detail">
                  Cc: {pendingEmailDraft.draft.cc.join(", ")}
                </div>
              ) : null}
              <div className="proposal-description">{pendingEmailDraft.draft.body}</div>
              <div className="proposal-actions">
                <button
                  className="primary-button"
                  disabled={pendingEmailDraft.status !== "pending"}
                  onClick={() => handleOpenEmailDraft(pendingEmailDraft.draft, draftIndex)}
                  type="button"
                >
                  <ExternalLink size={16} />
                  {pendingEmailDraft.status === "opened" ? "Opened" : "Open draft"}
                </button>
                <button
                  className="text-button"
                  disabled={pendingEmailDraft.status !== "pending"}
                  onClick={() =>
                    setPendingEmails((currentDrafts) =>
                      currentDrafts.map((currentDraft, currentIndex) =>
                        currentIndex === draftIndex
                          ? { ...currentDraft, status: "cancelled" }
                          : currentDraft
                      )
                    )
                  }
                  type="button"
                >
                  <X size={16} />
                  Cancel
                </button>
              </div>
            </div>
          ))}
          {isAskingAgent ? (
            <div className="message assistant thinking-message">Thinking</div>
          ) : null}
        </div>

        <form className="chat-form" onSubmit={handleSubmit}>
          <textarea
            className="chat-input"
            onKeyDown={handleChatInputKeyDown}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask about your calendar..."
            value={input}
          />
          <div className="status-row">
            <span>{error}</span>
            <button
              className="primary-button"
              disabled={isAskingAgent || isStreamingAgent || !input.trim()}
            >
              <Send size={16} />
              Send
            </button>
          </div>
        </form>
      </aside>
      ) : null}
    </main>
  );
}
