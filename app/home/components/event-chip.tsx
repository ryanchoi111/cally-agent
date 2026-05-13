"use client";

import { CalendarDays, Clock, ExternalLink, FileText, MapPin, Users } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import {
  eventCardStyle,
  eventDurationLabel,
  eventRangeLabel,
  eventTimeLabel
} from "@/app/home/utils/calendar";
import { stripHtml } from "@/app/home/components/agent-message";
import type { CalendarEvent } from "@/lib/types";

export function EventChip({
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
