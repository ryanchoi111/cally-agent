import OpenAI from "openai";
import { parse, isValid } from "date-fns";
import {
  buildResolvedDateContext,
  resolveSchedulingTurn,
  type SchedulingIntent
} from "@/lib/scheduling";
import type {
  AgentActionIntent,
  AgentChatResponse,
  CalendarEvent,
  CalendarEventDeletion,
  CalendarEventEdit,
  ConversationState,
  PendingConfirmationAction
} from "@/lib/types";

type CalendarActionIntent = {
  action: "delete" | "edit" | "none";
  scope: "specific" | "all_on_date" | "ambiguous";
  eventId: string | null;
  date: string | null;
  eventReference: string | null;
  newTitle: string | null;
  newStart: string | null;
  newEnd: string | null;
};

const weekdayNames = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
] as const;

function calendarIntentFromAction(actionIntent: AgentActionIntent | null): CalendarActionIntent | null {
  if (!actionIntent || (actionIntent.action !== "delete" && actionIntent.action !== "edit")) {
    return null;
  }

  return {
    action: actionIntent.action,
    scope: actionIntent.calendarScope === "none" ? "ambiguous" : actionIntent.calendarScope,
    eventId: actionIntent.eventId,
    date: actionIntent.date,
    eventReference: actionIntent.eventReference,
    newTitle: actionIntent.newTitle,
    newStart: actionIntent.newStart,
    newEnd: actionIntent.newEnd
  };
}

function schedulingIntentFromAction(actionIntent: AgentActionIntent | null): SchedulingIntent | null {
  if (!actionIntent || actionIntent.action !== "schedule" || actionIntent.scheduleIntent === "none") {
    return null;
  }

  return {
    intent: actionIntent.scheduleIntent,
    rawTitle: actionIntent.rawTitle,
    rawDateText: actionIntent.rawDateText,
    rawTimeText: actionIntent.rawTimeText,
    rawDurationText: actionIntent.rawDurationText,
    rawAttendees: actionIntent.rawAttendees,
    selectedOptionText: actionIntent.selectedOptionText,
    scheduleTitle: actionIntent.scheduleTitle,
    scheduleDate: actionIntent.scheduleDate,
    scheduleStart: actionIntent.scheduleStart,
    scheduleEnd: actionIntent.scheduleEnd,
    scheduleDurationMinutes: actionIntent.scheduleDurationMinutes,
    scheduleAllDay: actionIntent.scheduleAllDay,
    scheduleAttendees: actionIntent.scheduleAttendees,
    schedulePrepBlocks: actionIntent.schedulePrepBlocks,
    selectedOptionId: actionIntent.selectedOptionId
  };
}

function shouldReturnEmailDrafts(actionIntent: AgentActionIntent | null) {
  return (
    actionIntent?.action === "draft_email" ||
    actionIntent?.intentKind === "draft_scheduling_message" ||
    actionIntent?.resolutionMode === "draft_message"
  );
}

function shouldResolveScheduling(actionIntent: AgentActionIntent | null) {
  if (!actionIntent || actionIntent.action !== "schedule") {
    return false;
  }

  return (
    actionIntent.resolutionMode === "propose_event" ||
    (actionIntent.resolutionMode === "clarify" &&
      (actionIntent.intentKind === "schedule_event" || actionIntent.intentKind === "all_day_block")) ||
    actionIntent.scheduleIntent === "select_alternative" ||
    actionIntent.scheduleIntent === "override_conflict"
  );
}

function parseDateParts(date: string) {
  const parsed = parse(date, "yyyy-MM-dd", new Date());
  if (!isValid(parsed)) {
    return null;
  }

  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
    day: parsed.getUTCDate()
  };
}

function weekdayForDate(date: string) {
  const parts = parseDateParts(date);
  if (!parts) {
    return null;
  }

  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function formatResolvedDateLabel(date: string) {
  const weekday = weekdayForDate(date);
  const weekdayLabel =
    weekday === null ? "" : `${weekdayNames[weekday][0].toUpperCase()}${weekdayNames[weekday].slice(1)}`;
  return `${weekdayLabel}, ${date}`;
}

function dateFromEventStart(start: string) {
  return start.slice(0, 10);
}

function eventOccursOnResolvedDate(event: CalendarEvent, date: string) {
  const eventStartDate = dateFromEventStart(event.start);
  const eventEndDate = dateFromEventStart(event.end);
  return eventStartDate === date || eventEndDate === date;
}

function findEventByValidatedId(events: CalendarEvent[], eventId: string | null, date?: string | null) {
  if (!eventId) {
    return null;
  }
  const event = events.find((candidate) => candidate.id === eventId);
  if (!event) {
    return null;
  }
  if (date && !eventOccursOnResolvedDate(event, date)) {
    return null;
  }
  return event;
}

function pendingConfirmationResponse(
  actionIntent: AgentActionIntent | null,
  conversationState: ConversationState | undefined
) {
  const action = actionIntent?.pendingConfirmationAction;
  if (!action || action === "none") {
    return null;
  }
  const hasPending: Record<Exclude<PendingConfirmationAction, "none">, boolean> = {
    create_events: Boolean(conversationState?.pendingEvents?.length),
    delete_events: Boolean(conversationState?.pendingDeletions?.length),
    edit_events: Boolean(conversationState?.pendingEdits?.length),
    open_email_drafts: Boolean(conversationState?.pendingEmailDraftCount)
  };
  if (!hasPending[action]) {
    return null;
  }
  return {
    message: "Confirmed.",
    confirmedPendingAction: action
  } satisfies AgentChatResponse;
}

function buildDeletionResponse(events: CalendarEvent[], actionIntent: CalendarActionIntent | null) {
  if (actionIntent?.action !== "delete") {
    return null;
  }

  const requestedDate = actionIntent.date;
  const eventById = findEventByValidatedId(events, actionIntent.eventId, requestedDate);
  if (!requestedDate && !eventById) {
    return { message: "Which day should I look at for the events you want deleted?" } satisfies AgentChatResponse;
  }

  if (actionIntent.scope === "ambiguous") {
    return { message: "Which event should I delete?" } satisfies AgentChatResponse;
  }

  const candidates =
    eventById
      ? [eventById]
      : actionIntent.scope === "all_on_date" && requestedDate
        ? events.filter((event) => eventOccursOnResolvedDate(event, requestedDate))
        : [];

  if (!candidates.length) {
    const eventsOnDate = requestedDate
      ? events.filter((event) => eventOccursOnResolvedDate(event, requestedDate))
      : [];
    if (eventsOnDate.length) {
      return {
        message: `I see ${eventsOnDate.map((event) => `"${event.title}"`).join(", ")} on ${formatResolvedDateLabel(requestedDate!)}. Which one should I delete?`
      } satisfies AgentChatResponse;
    }
    const dateLabel = requestedDate ? formatResolvedDateLabel(requestedDate) : "that date";
    return { message: `I do not see matching events on ${dateLabel} in the calendar context I have.` } satisfies AgentChatResponse;
  }

  const proposedDeletions: CalendarEventDeletion[] = candidates.map((event) => ({
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    calendarName: event.calendarName
  }));

  const deletionDateLabel = formatResolvedDateLabel(requestedDate ?? dateFromEventStart(proposedDeletions[0].start));
  return {
    message: `Please confirm that you want to delete ${proposedDeletions.length === 1 ? "this event" : `these ${proposedDeletions.length} events`} on ${deletionDateLabel}.`,
    proposedDeletions
  } satisfies AgentChatResponse;
}

function buildEditResponse(events: CalendarEvent[], actionIntent: CalendarActionIntent | null) {
  if (actionIntent?.action !== "edit") {
    return null;
  }
  const requestedDate = actionIntent.date;
  const eventById = findEventByValidatedId(events, actionIntent.eventId, requestedDate);
  if (actionIntent.scope === "ambiguous") {
    return { message: "Which event should I edit?" } satisfies AgentChatResponse;
  }
  const candidates = eventById ? [eventById] : [];
  if (!candidates.length) {
    const eventsOnDate = requestedDate ? events.filter((event) => eventOccursOnResolvedDate(event, requestedDate)) : [];
    if (eventsOnDate.length) {
      return {
        message: `I see ${eventsOnDate.map((event) => `"${event.title}"`).join(", ")} on ${formatResolvedDateLabel(requestedDate!)}. Which one should I edit?`
      } satisfies AgentChatResponse;
    }
    return {
      message: "I do not see a matching event in the calendar context I have. Tell me the event title and day, and I can prepare the edit."
    } satisfies AgentChatResponse;
  }
  if (candidates.length > 1 && !requestedDate) {
    return { message: "I found multiple matching events. Which day should I edit?" } satisfies AgentChatResponse;
  }
  const proposedEdits = candidates.map<CalendarEventEdit>((event) => {
    const updates: CalendarEventEdit["updates"] = {};
    if (actionIntent.newTitle) {
      updates.title = actionIntent.newTitle;
    }
    if (actionIntent.newStart && actionIntent.newEnd) {
      updates.start = actionIntent.newStart;
      updates.end = actionIntent.newEnd;
      updates.allDay = false;
    }
    return {
      id: event.id,
      title: event.title,
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      calendarName: event.calendarName,
      updates
    };
  });
  if (proposedEdits.every((edit) => Object.keys(edit.updates).length === 0)) {
    return { message: "What should I change about the matching event?" } satisfies AgentChatResponse;
  }
  return {
    message: `Please confirm that you want to edit ${proposedEdits.length === 1 ? "this event" : `these ${proposedEdits.length} events`}.`,
    proposedEdits
  } satisfies AgentChatResponse;
}

async function composeSchedulingMessage(openai: OpenAI, model: string, response: AgentChatResponse) {
  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "scheduling_message",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { message: { type: "string" } },
          required: ["message"]
        }
      }
    },
    messages: [
      {
        role: "system",
        content:
          "Rewrite the scheduling result into one concise, natural user-facing message. Do not add, remove, or change any dates, times, conflicts, options, attendees, or event details. Do not claim the event was created."
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            deterministicMessage: response.message,
            proposedEvents: response.proposedEvents ?? [],
            scheduleOptions: response.scheduleOptions ?? []
          },
          null,
          2
        )
      }
    ]
  });
  const content = completion.choices[0]?.message?.content;
  if (!content) {
    return response.message;
  }
  const parsed = JSON.parse(content) as { message?: unknown };
  return typeof parsed.message === "string" ? parsed.message : response.message;
}

type ResolveIntentParams = {
  actionIntent: AgentActionIntent | null;
  openai: OpenAI;
  model: string;
  body: {
    messages: { role: "user" | "assistant"; content: string }[];
    calendarContext?: CalendarEvent[];
    conversationState?: ConversationState;
    clientContext?: {
      calendarView?: string;
      localDate?: string;
      localDateTime?: string;
      localWeekday?: string;
      timezone?: string;
      viewDate?: string;
      visibleRange?: { start?: string; end?: string };
    };
  };
};

export async function resolveIntentOrchestration({
  actionIntent,
  openai,
  model,
  body
}: ResolveIntentParams) {
  const canReturnEmailDrafts = shouldReturnEmailDrafts(actionIntent);

  const pendingConfirmation = pendingConfirmationResponse(actionIntent, body.conversationState);
  if (pendingConfirmation) {
    return { immediateResponse: pendingConfirmation, canReturnEmailDrafts, resolvedDateContext: null, schedulingResponse: null };
  }

  const events = body.calendarContext ?? [];
  const calendarActionIntent = calendarIntentFromAction(actionIntent);
  const deletionResponse = buildDeletionResponse(events, calendarActionIntent);
  if (deletionResponse) {
    return { immediateResponse: deletionResponse, canReturnEmailDrafts, resolvedDateContext: null, schedulingResponse: null };
  }

  const editResponse = buildEditResponse(events, calendarActionIntent);
  if (editResponse) {
    return { immediateResponse: editResponse, canReturnEmailDrafts, resolvedDateContext: null, schedulingResponse: null };
  }

  const shouldUseSchedulingResolver = shouldResolveScheduling(actionIntent);
  const schedulingIntent = shouldUseSchedulingResolver ? schedulingIntentFromAction(actionIntent) : null;
  const resolvedDateContext = shouldUseSchedulingResolver
    ? buildResolvedDateContext(body.messages, body.clientContext ?? {}, schedulingIntent)
    : null;
  const schedulingResponse = shouldUseSchedulingResolver
    ? resolveSchedulingTurn({
        messages: body.messages,
        clientContext: body.clientContext ?? {},
        calendarContext: events,
        conversationState: body.conversationState,
        intent: schedulingIntent
      })
    : null;

  if (schedulingResponse && !canReturnEmailDrafts) {
    return {
      immediateResponse: {
        ...schedulingResponse,
        message: await composeSchedulingMessage(openai, model, schedulingResponse)
      },
      canReturnEmailDrafts,
      resolvedDateContext,
      schedulingResponse
    };
  }

  return {
    immediateResponse: null,
    canReturnEmailDrafts,
    resolvedDateContext,
    schedulingResponse
  };
}
