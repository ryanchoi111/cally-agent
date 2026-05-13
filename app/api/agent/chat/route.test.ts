import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentActionIntent, CalendarEvent, ChatMessage } from "@/lib/types";

const completionCreate = vi.hoisted(() => vi.fn());
const verifyFirebaseIdToken = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: vi.fn(() => ({
    chat: {
      completions: {
        create: completionCreate
      }
    }
  }))
}));

vi.mock("@/lib/firebase-admin", () => ({
  verifyFirebaseIdToken
}));

import { POST } from "./route";

const clientContext = {
  localDate: "2026-05-12",
  localDateTime: "Tue May 12 2026 09:00:00 GMT-0400 (Eastern Daylight Time)",
  localWeekday: "Tuesday",
  timezone: "America/New_York",
  calendarView: "month",
  viewDate: "2026-05-12",
  visibleRange: {
    start: "2026-05-01T00:00:00.000Z",
    end: "2026-05-31T23:59:59.999Z"
  }
};

const baseIntent: AgentActionIntent = {
  action: "answer",
  intentKind: "answer",
  resolutionMode: "answer",
  pendingConfirmationAction: "none",
  scheduleIntent: "none",
  rawTitle: null,
  rawDateText: null,
  rawTimeText: null,
  rawDurationText: null,
  rawAttendees: null,
  selectedOptionText: null,
  scheduleTitle: null,
  scheduleDate: null,
  scheduleStart: null,
  scheduleEnd: null,
  scheduleDurationMinutes: null,
  scheduleAllDay: null,
  scheduleAttendees: null,
  schedulePrepBlocks: null,
  selectedOptionId: null,
  calendarScope: "none",
  eventId: null,
  date: null,
  eventReference: null,
  newTitle: null,
  newStart: null,
  newEnd: null
};

function message(content: string): ChatMessage[] {
  return [{ role: "user", content }];
}

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "primary:board-review",
    title: "Board review",
    start: "2026-05-12T11:00:00-04:00",
    end: "2026-05-12T12:00:00-04:00",
    allDay: false,
    calendarName: "Primary",
    color: "#56c2ff",
    attendees: [{ email: "alex@example.com", name: "Alex" }],
    organizer: "Ryan Choi",
    ...overrides
  };
}

function completion(content: unknown) {
  return {
    choices: [
      {
        message: {
          content: typeof content === "string" ? content : JSON.stringify(content)
        }
      }
    ]
  };
}

function mockCompletionQueue(...contents: unknown[]) {
  for (const content of contents) {
    completionCreate.mockResolvedValueOnce(completion(content));
  }
}

async function postAgent(body: unknown) {
  const response = await POST(
    new Request("http://localhost/api/agent/chat", {
      method: "POST",
      body: JSON.stringify(body)
    })
  );

  return {
    status: response.status,
    body: await response.json()
  };
}

describe("POST /api/agent/chat", () => {
  beforeEach(() => {
    completionCreate.mockReset();
    verifyFirebaseIdToken.mockReset();
    verifyFirebaseIdToken.mockResolvedValue({ uid: "user-1" });
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("returns a 400 when messages are missing", async () => {
    const response = await postAgent({ messages: [] });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "messages are required" });
    expect(completionCreate).not.toHaveBeenCalled();
  });

  it("turns a schedule intent into proposed calendar events without letting the model create them directly", async () => {
    mockCompletionQueue(
      {
        ...baseIntent,
        action: "schedule",
        intentKind: "schedule_event",
        resolutionMode: "propose_event",
        scheduleIntent: "new_schedule",
        scheduleTitle: "Investor prep",
        scheduleStart: "2026-05-12T14:00:00-04:00",
        scheduleEnd: "2026-05-12T15:00:00-04:00",
        scheduleAttendees: ["alex@example.com"]
      },
      {
        message: "I can hold Investor prep at 2:00 PM."
      }
    );

    const response = await postAgent({
      idToken: "firebase-token",
      messages: message("Schedule investor prep today at 2 PM for an hour with alex@example.com"),
      calendarContext: [],
      clientContext
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      message: "I can hold Investor prep at 2:00 PM.",
      proposedEvents: [
        {
          title: "Investor prep",
          start: "2026-05-12T14:00:00-04:00",
          end: "2026-05-12T15:00:00-04:00",
          allDay: false,
          attendees: ["alex@example.com"]
        }
      ]
    });
    expect(completionCreate).toHaveBeenCalledTimes(2);
    expect(completionCreate.mock.calls[1][0].messages[0].content).toContain(
      "Do not claim the event was created."
    );
  });

  it("asks for confirmation before deleting a matched calendar event", async () => {
    mockCompletionQueue({
      ...baseIntent,
      action: "delete",
      intentKind: "answer",
      resolutionMode: "propose_delete",
      calendarScope: "specific",
      eventId: "primary:board-review",
      date: "2026-05-12",
      eventReference: "Board review"
    });

    const response = await postAgent({
      idToken: "firebase-token",
      messages: message("Delete Board review today"),
      calendarContext: [event()],
      clientContext
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "Please confirm that you want to delete this event on Tuesday, 2026-05-12.",
      proposedDeletions: [
        {
          id: "primary:board-review",
          title: "Board review",
          start: "2026-05-12T11:00:00-04:00",
          end: "2026-05-12T12:00:00-04:00",
          allDay: false,
          calendarName: "Primary"
        }
      ]
    });
    expect(completionCreate).toHaveBeenCalledTimes(1);
  });

  it("asks for confirmation before editing a matched calendar event", async () => {
    mockCompletionQueue({
      ...baseIntent,
      action: "edit",
      intentKind: "reschedule_event",
      resolutionMode: "propose_edit",
      calendarScope: "specific",
      eventId: "primary:board-review",
      date: "2026-05-12",
      eventReference: "Board review",
      newStart: "2026-05-12T13:00:00-04:00",
      newEnd: "2026-05-12T14:00:00-04:00"
    });

    const response = await postAgent({
      idToken: "firebase-token",
      messages: message("Move Board review today to 1 PM"),
      calendarContext: [event()],
      clientContext
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "Please confirm that you want to edit this event.",
      proposedEdits: [
        {
          id: "primary:board-review",
          title: "Board review",
          start: "2026-05-12T11:00:00-04:00",
          end: "2026-05-12T12:00:00-04:00",
          allDay: false,
          calendarName: "Primary",
          updates: {
            start: "2026-05-12T13:00:00-04:00",
            end: "2026-05-12T14:00:00-04:00",
            allDay: false
          }
        }
      ]
    });
    expect(completionCreate).toHaveBeenCalledTimes(1);
  });

  it("confirms pending actions without asking the model to answer again", async () => {
    mockCompletionQueue({
      ...baseIntent,
      pendingConfirmationAction: "create_events"
    });

    const response = await postAgent({
      idToken: "firebase-token",
      messages: message("Yes, create it"),
      calendarContext: [],
      clientContext,
      conversationState: {
        pendingEvents: [
          {
            title: "Investor prep",
            start: "2026-05-12T14:00:00-04:00",
            end: "2026-05-12T15:00:00-04:00",
            allDay: false
          }
        ]
      }
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "Confirmed.",
      confirmedPendingAction: "create_events"
    });
    expect(completionCreate).toHaveBeenCalledTimes(1);
  });

  it("returns structured response blocks and filters invalid block shapes", async () => {
    mockCompletionQueue(
      {
        ...baseIntent,
        action: "answer",
        intentKind: "calendar_audit",
        resolutionMode: "audit"
      },
      {
        message: "Your afternoon is fragmented. I would batch internal meetings.",
        proposedEmails: null,
        responseBlocks: [
          {
            type: "summary",
            title: "Main risk",
            body: "The day has too many context switches."
          },
          {
            type: "recommendation_group",
            title: "Changes",
            items: ["Move status updates together.", "Protect one deep-work block."]
          },
          {
            type: "summary",
            title: "Invalid block without a body"
          }
        ]
      }
    );

    const response = await postAgent({
      idToken: "firebase-token",
      messages: message("Audit my calendar"),
      calendarContext: [event()],
      clientContext
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "Your afternoon is fragmented. I would batch internal meetings.",
      responseBlocks: [
        {
          type: "summary",
          title: "Main risk",
          body: "The day has too many context switches."
        },
        {
          type: "recommendation_group",
          title: "Changes",
          items: ["Move status updates together.", "Protect one deep-work block."]
        }
      ]
    });
    const finalCall = completionCreate.mock.calls[1][0];
    expect(finalCall.messages[0].content).toContain("Use only the calendar context supplied");
    expect(finalCall.messages[0].content).toContain("You cannot directly create, update, delete, or modify calendar events.");
    expect(finalCall.messages[1].content).toContain('"title": "Board review"');
  });

  it("returns normalized email drafts only for draft-message intents", async () => {
    mockCompletionQueue(
      {
        ...baseIntent,
        action: "draft_email",
        intentKind: "draft_scheduling_message",
        resolutionMode: "draft_message"
      },
      {
        message: "I drafted the email below. Would you like to open it in Gmail?",
        responseBlocks: [],
        proposedEmails: [
          {
            to: ["alex@example.com", ""],
            cc: [""],
            bcc: [],
            subject: "Board review follow-up",
            body: "Hi Alex, can we move the board review to 1 PM?"
          },
          {
            to: ["bad@example.com"],
            cc: [],
            bcc: [],
            subject: "Missing required fields",
            extra: "This should be filtered out."
          }
        ]
      }
    );

    const response = await postAgent({
      idToken: "firebase-token",
      messages: message("Draft an email to Alex to move the board review"),
      calendarContext: [event()],
      clientContext
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "I drafted the email below. Would you like to open it in Gmail?",
      proposedEmails: [
        {
          to: ["alex@example.com"],
          cc: [],
          bcc: [],
          subject: "Board review follow-up",
          body: "Hi Alex, can we move the board review to 1 PM?"
        }
      ]
    });
  });

  it("does not return model-supplied email drafts for non-draft intents", async () => {
    mockCompletionQueue(
      {
        ...baseIntent,
        action: "answer",
        intentKind: "answer",
        resolutionMode: "answer"
      },
      {
        message: "I can help you think through the meeting.",
        responseBlocks: [],
        proposedEmails: [
          {
            to: ["alex@example.com"],
            cc: [],
            bcc: [],
            subject: "Should not surface",
            body: "This draft is outside the requested intent."
          }
        ]
      }
    );

    const response = await postAgent({
      idToken: "firebase-token",
      messages: message("What should I do about the board review?"),
      calendarContext: [event()],
      clientContext
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "I can help you think through the meeting."
    });
  });
});
