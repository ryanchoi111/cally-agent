import OpenAI from "openai";
import type {
  AgentActionIntent,
  CalendarEvent,
  ChatMessage,
  ConversationState
} from "./types";
import type { ClientContext } from "./scheduling";

const actionIntentSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: ["schedule", "delete", "edit", "draft_email", "answer"]
    },
    intentKind: {
      type: "string",
      enum: [
        "schedule_event",
        "find_time",
        "draft_scheduling_message",
        "calendar_audit",
        "reduce_meetings",
        "resolve_conflict",
        "design_calendar_rhythm",
        "protect_focus_time",
        "create_agenda",
        "prepare_for_meeting",
        "convert_to_async",
        "delegate_meeting",
        "reschedule_event",
        "all_day_block",
        "preference_update",
        "answer"
      ]
    },
    resolutionMode: {
      type: "string",
      enum: [
        "clarify",
        "answer",
        "audit",
        "recommend",
        "draft_message",
        "propose_event",
        "propose_edit",
        "propose_delete",
        "find_slots",
        "update_preference"
      ]
    },
    pendingConfirmationAction: {
      type: "string",
      enum: ["create_events", "delete_events", "edit_events", "open_email_drafts", "none"]
    },
    scheduleIntent: {
      type: "string",
      enum: [
        "new_schedule",
        "select_alternative",
        "confirm_pending_event",
        "override_conflict",
        "modify_details",
        "none"
      ]
    },
    rawTitle: { anyOf: [{ type: "string" }, { type: "null" }] },
    rawDateText: { anyOf: [{ type: "string" }, { type: "null" }] },
    rawTimeText: { anyOf: [{ type: "string" }, { type: "null" }] },
    rawDurationText: { anyOf: [{ type: "string" }, { type: "null" }] },
    rawAttendees: {
      anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }]
    },
    selectedOptionText: { anyOf: [{ type: "string" }, { type: "null" }] },
    scheduleTitle: { anyOf: [{ type: "string" }, { type: "null" }] },
    scheduleDate: { anyOf: [{ type: "string" }, { type: "null" }] },
    scheduleStart: { anyOf: [{ type: "string" }, { type: "null" }] },
    scheduleEnd: { anyOf: [{ type: "string" }, { type: "null" }] },
    scheduleDurationMinutes: { anyOf: [{ type: "number" }, { type: "null" }] },
    scheduleAllDay: { anyOf: [{ type: "boolean" }, { type: "null" }] },
    scheduleAttendees: {
      anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }]
    },
    schedulePrepBlocks: {
      anyOf: [
        {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              titlePrefix: { type: "string" },
              durationMinutes: { type: "number" }
            },
            required: ["titlePrefix", "durationMinutes"]
          }
        },
        { type: "null" }
      ]
    },
    selectedOptionId: { anyOf: [{ type: "string" }, { type: "null" }] },
    calendarScope: {
      type: "string",
      enum: ["specific", "all_on_date", "ambiguous", "none"]
    },
    eventId: { anyOf: [{ type: "string" }, { type: "null" }] },
    date: { anyOf: [{ type: "string" }, { type: "null" }] },
    eventReference: { anyOf: [{ type: "string" }, { type: "null" }] },
    newTitle: { anyOf: [{ type: "string" }, { type: "null" }] },
    newStart: { anyOf: [{ type: "string" }, { type: "null" }] },
    newEnd: { anyOf: [{ type: "string" }, { type: "null" }] }
  },
  required: [
    "action",
    "intentKind",
    "resolutionMode",
    "pendingConfirmationAction",
    "scheduleIntent",
    "rawTitle",
    "rawDateText",
    "rawTimeText",
    "rawDurationText",
    "rawAttendees",
    "selectedOptionText",
    "scheduleTitle",
    "scheduleDate",
    "scheduleStart",
    "scheduleEnd",
    "scheduleDurationMinutes",
    "scheduleAllDay",
    "scheduleAttendees",
    "schedulePrepBlocks",
    "selectedOptionId",
    "calendarScope",
    "eventId",
    "date",
    "eventReference",
    "newTitle",
    "newStart",
    "newEnd"
  ]
} as const;

export async function extractActionIntent({
  openai,
  model,
  messages,
  calendarContext,
  clientContext,
  conversationState
}: {
  openai: OpenAI;
  model: string;
  messages: ChatMessage[];
  calendarContext: CalendarEvent[];
  clientContext: ClientContext;
  conversationState?: ConversationState;
}) {
  const completion = await openai.chat.completions.create({
    model,
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "calendar_agent_action_intent",
        strict: true,
        schema: actionIntentSchema
      }
    },
    messages: [
      {
        role: "system",
        content:
          "Classify the latest user request into one executable action, one Cally intent kind, one resolution mode, and any pending-confirmation action. The executable action is the server routing lane: schedule, delete, edit, draft_email, or answer. The intentKind is the product meaning: schedule_event, find_time, draft_scheduling_message, calendar_audit, reduce_meetings, resolve_conflict, design_calendar_rhythm, protect_focus_time, create_agenda, prepare_for_meeting, convert_to_async, delegate_meeting, reschedule_event, all_day_block, preference_update, or answer. The resolutionMode is what Cally should do next: clarify, answer, audit, recommend, draft_message, propose_event, propose_edit, propose_delete, find_slots, or update_preference. If Pending conversation state includes pendingEvents, pendingDeletions, pendingEdits, or pendingEmailDraftCount and the latest user message confirms one of those pending proposals, set pendingConfirmationAction to create_events, delete_events, edit_events, or open_email_drafts. If the user is not confirming a pending proposal, set pendingConfirmationAction='none'. Interpret conversational meaning, but do not decide whether an action is valid or executable. Use action='schedule' only when the user asks to create/block/propose a concrete calendar event or all-day block, or to select/override a pending schedule option. Use action='answer' with resolutionMode='recommend' for planning requests that ask how to arrange meetings, protect mornings, shorten meetings, batch groups, or recommend a schedule without asking Cally to create specific calendar events. Use action='edit' for reschedule_event. Use action='draft_email' for draft_scheduling_message. Use action='answer' for calendar_audit, reduce_meetings, resolve_conflict, design_calendar_rhythm, protect_focus_time, create_agenda, prepare_for_meeting, convert_to_async, delegate_meeting, preference_update, find_time, and general answers unless the user explicitly asks to create, edit, or delete calendar objects. For scheduling, return normalized scheduleTitle, scheduleDate as YYYY-MM-DD, and timed scheduleStart/scheduleEnd as ISO-like local datetimes with timezone offset when the user supplied enough information. If the user says 'this <weekday>', use the upcoming weekday in the current calendar week when possible. If the user says 'next <weekday>', use the weekday in the following calendar week, not the upcoming weekday in the current week. For example, if today is Tuesday 2026-05-12, 'next Saturday' is 2026-05-23 and 'this Saturday' is 2026-05-16. If the user gives start plus duration, return scheduleDurationMinutes and scheduleEnd when it can be calculated. Use client context for relative dates. If title, date, start, or duration/end is missing, leave that normalized field null instead of guessing. Put email addresses for scheduling attendees in scheduleAttendees. Put prep blocks in schedulePrepBlocks with titlePrefix and durationMinutes. For all_day_block, set scheduleAllDay=true and use scheduleDate. Keep raw scheduling fields as a fallback summary of the user's words. For delete/edit, resolve relative dates using client context and return date as YYYY-MM-DD when possible. When the user refers to an existing event by title, time, or prior conversational reference like 'that event', set eventId to the matching calendar event id from the provided Calendar events JSON whenever one clear event matches. The server will validate the id. Also set eventReference to the human-readable title or reference. For edits that move an event, return concrete ISO-like newStart and newEnd strings preserving timezone offset when available from the matching calendar event. If the user refers to a pending schedule option, set action='schedule', choose scheduleIntent='select_alternative' or 'override_conflict', set selectedOptionId when the referenced pending option id is clear, and put the verbal reference in selectedOptionText. Set unused fields to null, scheduleIntent='none' when not scheduling, and calendarScope='none' when not deleting or editing. Return JSON only."
      },
      {
        role: "user",
        content: `Client context JSON:\n${JSON.stringify(clientContext, null, 2)}`
      },
      {
        role: "user",
        content: `Pending conversation state JSON:\n${JSON.stringify(conversationState ?? {}, null, 2)}`
      },
      {
        role: "user",
        content: `Calendar events JSON:\n${JSON.stringify(
          calendarContext.map((event) => ({
            id: event.id,
            title: event.title,
            start: event.start,
            end: event.end,
            allDay: event.allDay,
            calendarName: event.calendarName
          })),
          null,
          2
        )}`
      },
      ...messages.map((message) => ({
        role: message.role,
        content: message.content
      }))
    ]
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    return null;
  }

  return JSON.parse(content) as AgentActionIntent;
}
