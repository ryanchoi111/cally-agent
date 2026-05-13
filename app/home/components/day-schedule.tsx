"use client";

import { addHours, format } from "date-fns";
import {
  eventDurationLabel,
  eventOccursOnDay,
  eventTimeLabel,
  layoutTimedEvents,
  timedEventStyle
} from "@/app/home/utils/calendar";
import type { CalendarEvent } from "@/lib/types";
import { EventListItem } from "@/app/home/components/event-list-item";

const dayHours = Array.from({ length: 24 }, (_, hour) => hour);

export function DaySchedule({ date, events }: { date: Date; events: CalendarEvent[] }) {
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
              {format(addHours(new Date(date.getFullYear(), date.getMonth(), date.getDate()), hour), "ha")}
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
