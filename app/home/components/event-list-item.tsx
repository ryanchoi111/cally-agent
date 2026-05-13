"use client";

import { format, parseISO } from "date-fns";
import { eventCardStyle } from "@/app/home/utils/calendar";
import type { CalendarEvent } from "@/lib/types";

export function EventListItem({ event }: { event: CalendarEvent }) {
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
