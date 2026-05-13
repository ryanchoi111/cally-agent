import { describe, expect, it } from "vitest";
import type { CalendarEvent, ChatMessage, ConversationState } from "./types";
import { resolveSchedulingTurn } from "./scheduling";

const clientContext = {
  localDate: "2026-05-11",
  localDateTime: "Mon May 11 2026 09:00:00 GMT-0400 (Eastern Daylight Time)",
  localWeekday: "Monday",
  timezone: "America/New_York"
};

const tuesdayClientContext = {
  localDate: "2026-05-12",
  localDateTime: "Tue May 12 2026 09:00:00 GMT-0400 (Eastern Daylight Time)",
  localWeekday: "Tuesday",
  timezone: "America/New_York"
};

function messages(content: string): ChatMessage[] {
  return [{ role: "user", content }];
}

function event(title: string, start: string, end: string): CalendarEvent {
  return {
    id: title,
    title,
    start,
    end,
    allDay: false,
    calendarName: "Primary",
    color: "#56c2ff"
  };
}

describe("resolveSchedulingTurn", () => {
  it("resolves a new request with a time range into a 90-minute draft", () => {
    const response = resolveSchedulingTurn({
      messages: messages("Schedule Acme tomorrow from 11:00 AM to 12:30 PM"),
      clientContext,
      calendarContext: []
    });

    expect(response?.proposedEvents).toHaveLength(1);
    expect(response?.proposedEvents?.[0]).toMatchObject({
      title: "Acme",
      start: "2026-05-12T11:00:00-04:00",
      end: "2026-05-12T12:30:00-04:00",
      allDay: false
    });
  });

  it("returns structured alternatives and an override when the requested time conflicts", () => {
    const response = resolveSchedulingTurn({
      messages: messages("Schedule Acme tomorrow from 11:00 AM to 12:30 PM"),
      clientContext,
      calendarContext: [
        event("Busy", "2026-05-12T11:30:00-04:00", "2026-05-12T12:00:00-04:00"),
        event("Lunch", "2026-05-12T12:30:00-04:00", "2026-05-12T13:30:00-04:00")
      ]
    });

    expect(response?.proposedEvents).toBeUndefined();
    expect(response?.scheduleOptions?.map((option) => option.kind)).toContain("override_original");
    expect(response?.scheduleOptions?.filter((option) => option.kind === "alternative")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringContaining("alternative:"),
          start: "2026-05-12T09:00:00-04:00",
          end: "2026-05-12T10:30:00-04:00"
        }),
        expect.objectContaining({
          start: "2026-05-12T13:30:00-04:00",
          end: "2026-05-12T15:00:00-04:00"
        })
      ])
    );
  });

  it("selects a pending option by exact time", () => {
    const conflicted = resolveSchedulingTurn({
      messages: messages("Schedule Acme tomorrow from 11:00 AM to 12:30 PM"),
      clientContext,
      calendarContext: [
        event("Busy", "2026-05-12T11:00:00-04:00", "2026-05-12T12:30:00-04:00"),
        event("Lunch", "2026-05-12T12:30:00-04:00", "2026-05-12T13:30:00-04:00")
      ]
    });
    const conversationState: ConversationState = {
      scheduleOptions: conflicted?.scheduleOptions
    };

    const response = resolveSchedulingTurn({
      messages: messages("let's do the 1:30PM one"),
      clientContext,
      calendarContext: [],
      conversationState,
      intent: {
        intent: "select_alternative",
        selectedOptionText: "1:30PM"
      }
    });

    expect(response?.proposedEvents?.[0].start).toBe("2026-05-12T13:30:00-04:00");
    expect(response?.conversationState?.scheduleOptions).toEqual([]);
  });

  it("selects a pending option by ordinal", () => {
    const conflicted = resolveSchedulingTurn({
      messages: messages("Schedule Acme tomorrow from 11:00 AM to 12:30 PM"),
      clientContext,
      calendarContext: [
        event("Busy", "2026-05-12T11:00:00-04:00", "2026-05-12T12:30:00-04:00"),
        event("Lunch", "2026-05-12T12:30:00-04:00", "2026-05-12T13:30:00-04:00")
      ]
    });

    const response = resolveSchedulingTurn({
      messages: messages("the second one"),
      clientContext,
      calendarContext: [],
      conversationState: { scheduleOptions: conflicted?.scheduleOptions }
    });

    expect(response?.proposedEvents?.[0].start).toBe("2026-05-12T13:30:00-04:00");
  });

  it("asks for clarification on unknown option selection", () => {
    const conflicted = resolveSchedulingTurn({
      messages: messages("Schedule Acme tomorrow from 11:00 AM to 12:30 PM"),
      clientContext,
      calendarContext: [event("Busy", "2026-05-12T11:00:00-04:00", "2026-05-12T12:30:00-04:00")]
    });

    const response = resolveSchedulingTurn({
      messages: messages("the fifth one"),
      clientContext,
      calendarContext: [],
      conversationState: { scheduleOptions: conflicted?.scheduleOptions },
      intent: { intent: "select_alternative", selectedOptionText: "the fifth one" }
    });

    expect(response?.message).toMatch(/Which option/i);
    expect(response?.proposedEvents).toBeUndefined();
  });

  it("selects the original conflicted time when the user asks to override", () => {
    const conflicted = resolveSchedulingTurn({
      messages: messages("Schedule Acme tomorrow from 11:00 AM to 12:30 PM"),
      clientContext,
      calendarContext: [event("Busy", "2026-05-12T11:00:00-04:00", "2026-05-12T12:30:00-04:00")]
    });

    const response = resolveSchedulingTurn({
      messages: messages("create the original time anyway"),
      clientContext,
      calendarContext: [event("Busy", "2026-05-12T11:00:00-04:00", "2026-05-12T12:30:00-04:00")],
      conversationState: { scheduleOptions: conflicted?.scheduleOptions },
      intent: { intent: "override_conflict", selectedOptionText: "original time" }
    });

    expect(response?.proposedEvents?.[0].start).toBe("2026-05-12T11:00:00-04:00");
  });

  it("keeps prep block behavior", () => {
    const response = resolveSchedulingTurn({
      messages: messages("Schedule Acme tomorrow from 11:00 AM to 12:30 PM with 30 minute prep"),
      clientContext,
      calendarContext: []
    });

    expect(response?.proposedEvents).toHaveLength(2);
    expect(response?.proposedEvents?.[0]).toMatchObject({
      title: "Prep: Acme",
      start: "2026-05-12T10:30:00-04:00",
      end: "2026-05-12T11:00:00-04:00"
    });
  });

  it("keeps attendee email handling", () => {
    const response = resolveSchedulingTurn({
      messages: messages("Schedule Acme tomorrow from 11:00 AM to 12:30 PM with alex@example.com"),
      clientContext,
      calendarContext: []
    });

    expect(response?.proposedEvents?.[0].attendees).toEqual(["alex@example.com"]);
  });

  it("ignores non-scheduling chat", () => {
    const response = resolveSchedulingTurn({
      messages: messages("How busy is my day?"),
      clientContext,
      calendarContext: []
    });

    expect(response).toBeNull();
  });

  describe("phase 2 normalized scheduling intent fields", () => {
    it("creates an event from exact normalized ISO start and end without natural-language date or time text", () => {
      const intent = {
        intent: "new_schedule",
        scheduleTitle: "Acme planning",
        scheduleStart: "2026-05-12T11:00:00-04:00",
        scheduleEnd: "2026-05-12T12:30:00-04:00"
      } as const;

      const response = resolveSchedulingTurn({
        messages: messages("Please add the calendar hold we discussed"),
        clientContext,
        calendarContext: [],
        intent
      });

      expect(response?.proposedEvents).toEqual([
        {
          title: "Acme planning",
          start: "2026-05-12T11:00:00-04:00",
          end: "2026-05-12T12:30:00-04:00",
          allDay: false,
          description: undefined,
          location: undefined,
          attendees: []
        }
      ]);
    });

    it("asks for clarification when normalized title, date, or time is missing", () => {
      const cases: Array<{
        name: string;
        intent: Parameters<typeof resolveSchedulingTurn>[0]["intent"];
        messagePattern: RegExp;
      }> = [
        {
          name: "title",
          intent: {
            intent: "new_schedule",
            scheduleStart: "2026-05-12T11:00:00-04:00",
            scheduleEnd: "2026-05-12T12:30:00-04:00"
          },
          messagePattern: /title/i
        },
        {
          name: "date",
          intent: {
            intent: "new_schedule",
            scheduleTitle: "Acme planning",
            scheduleStart: "11:00",
            scheduleEnd: "12:30"
          },
          messagePattern: /day|date/i
        },
        {
          name: "time",
          intent: {
            intent: "new_schedule",
            scheduleTitle: "Acme planning",
            scheduleDate: "2026-05-12"
          },
          messagePattern: /start time|time/i
        }
      ];

      for (const testCase of cases) {
        const response = resolveSchedulingTurn({
          messages: messages(`Please schedule ${testCase.name}`),
          clientContext,
          calendarContext: [],
          intent: testCase.intent
        });

        expect(response?.message).toMatch(testCase.messagePattern);
        expect(response?.proposedEvents).toBeUndefined();
      }
    });

    it("returns conflict alternatives from a normalized exact event request", () => {
      const intent = {
        intent: "new_schedule",
        scheduleTitle: "Acme planning",
        scheduleStart: "2026-05-12T11:00:00-04:00",
        scheduleEnd: "2026-05-12T12:30:00-04:00"
      } as const;

      const response = resolveSchedulingTurn({
        messages: messages("Please schedule this"),
        clientContext,
        calendarContext: [
          event("Busy", "2026-05-12T11:30:00-04:00", "2026-05-12T12:00:00-04:00"),
          event("Lunch", "2026-05-12T12:30:00-04:00", "2026-05-12T13:30:00-04:00")
        ],
        intent
      });

      expect(response?.proposedEvents).toBeUndefined();
      expect(response?.scheduleOptions ?? []).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: "override_original" })])
      );
      expect(response?.scheduleOptions?.filter((option) => option.kind === "alternative") ?? []).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            start: "2026-05-12T09:00:00-04:00",
            end: "2026-05-12T10:30:00-04:00"
          }),
          expect.objectContaining({
            start: "2026-05-12T13:30:00-04:00",
            end: "2026-05-12T15:00:00-04:00"
          })
        ])
      );
    });

    it("creates duration, prep, and attendee details from normalized fields", () => {
      const response = resolveSchedulingTurn({
        messages: messages("Please add the calendar hold"),
        clientContext,
        calendarContext: [],
        intent: {
          intent: "new_schedule",
          scheduleTitle: "Planning with Acme for launch",
          scheduleStart: "2026-05-12T11:00:00-04:00",
          scheduleDurationMinutes: 90,
          scheduleAttendees: ["alex@example.com"],
          schedulePrepBlocks: [{ titlePrefix: "Prep", durationMinutes: 30 }]
        }
      });

      expect(response?.proposedEvents).toHaveLength(2);
      expect(response?.proposedEvents?.[0]).toMatchObject({
        title: "Prep: Planning with Acme for launch",
        start: "2026-05-12T10:30:00-04:00",
        end: "2026-05-12T11:00:00-04:00"
      });
      expect(response?.proposedEvents?.[1]).toMatchObject({
        title: "Planning with Acme for launch",
        start: "2026-05-12T11:00:00-04:00",
        end: "2026-05-12T12:30:00-04:00",
        attendees: ["alex@example.com"]
      });
    });

    it("treats next weekday as the following calendar week when validating normalized dates", () => {
      const response = resolveSchedulingTurn({
        messages: messages("Block next Saturday as an all-day offsite prep day."),
        clientContext: tuesdayClientContext,
        calendarContext: [],
        intent: {
          intent: "new_schedule",
          rawDateText: "next Saturday",
          scheduleTitle: "Offsite prep day",
          scheduleDate: "2026-05-16",
          scheduleAllDay: true
        }
      });

      expect(response?.proposedEvents?.[0]).toMatchObject({
        title: "Offsite prep day",
        start: "2026-05-23",
        end: "2026-05-24",
        allDay: true
      });
    });

    it("selects a pending option created from a normalized exact event request", () => {
      const intent = {
        intent: "new_schedule",
        scheduleTitle: "Acme planning",
        scheduleStart: "2026-05-12T11:00:00-04:00",
        scheduleEnd: "2026-05-12T12:30:00-04:00"
      } as const;
      const conflicted = resolveSchedulingTurn({
        messages: messages("Please schedule this"),
        clientContext,
        calendarContext: [
          event("Busy", "2026-05-12T11:00:00-04:00", "2026-05-12T12:30:00-04:00"),
          event("Lunch", "2026-05-12T12:30:00-04:00", "2026-05-12T13:30:00-04:00")
        ],
        intent
      });

      const response = resolveSchedulingTurn({
        messages: messages("the second one"),
        clientContext,
        calendarContext: [],
        conversationState: { scheduleOptions: conflicted?.scheduleOptions },
        intent: { intent: "select_alternative", selectedOptionText: "the second one" }
      });

      expect(response?.proposedEvents?.[0]).toMatchObject({
        title: "Acme planning",
        start: "2026-05-12T13:30:00-04:00",
        end: "2026-05-12T15:00:00-04:00",
        allDay: false
      });
      expect(response?.conversationState?.scheduleOptions).toEqual([]);
    });

    it("selects a pending option by exact option id", () => {
      const conflicted = resolveSchedulingTurn({
        messages: messages("Please schedule this"),
        clientContext,
        calendarContext: [
          event("Busy", "2026-05-12T11:00:00-04:00", "2026-05-12T12:30:00-04:00"),
          event("Lunch", "2026-05-12T12:30:00-04:00", "2026-05-12T13:30:00-04:00")
        ],
        intent: {
          intent: "new_schedule",
          scheduleTitle: "Acme planning",
          scheduleStart: "2026-05-12T11:00:00-04:00",
          scheduleEnd: "2026-05-12T12:30:00-04:00"
        }
      });
      const option = conflicted?.scheduleOptions?.find((item) => item.kind === "alternative");

      const response = resolveSchedulingTurn({
        messages: messages("that one"),
        clientContext,
        calendarContext: [],
        conversationState: { scheduleOptions: conflicted?.scheduleOptions },
        intent: { intent: "select_alternative", selectedOptionId: option?.id }
      });

      expect(response?.proposedEvents?.[0].start).toBe(option?.start);
      expect(response?.conversationState?.scheduleOptions).toEqual([]);
    });
  });
});
