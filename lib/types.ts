export type CalendarView = "day" | "week" | "month" | "year";

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  calendarName: string;
  color: string;
  description?: string;
  location?: string;
  attendees?: CalendarEventAttendee[];
  creator?: string;
  organizer?: string;
  htmlLink?: string;
};

export type CalendarEventAttendee = {
  email: string;
  name?: string;
  responseStatus?: string;
  optional?: boolean;
};

export type CalendarEventDraft = {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description?: string;
  location?: string;
  attendees?: string[];
};

export type ScheduleOption = CalendarEventDraft & {
  id: string;
  kind: "alternative" | "override_original";
};

export type CalendarEventDeletion = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  calendarName: string;
};

export type CalendarEventEdit = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  calendarName: string;
  updates: Partial<CalendarEventDraft>;
};

export type PendingConfirmationAction =
  | "create_events"
  | "delete_events"
  | "edit_events"
  | "open_email_drafts"
  | "none";

export type ConversationState = {
  scheduleOptions?: ScheduleOption[];
  pendingEvents?: CalendarEventDraft[];
  pendingDeletions?: CalendarEventDeletion[];
  pendingEdits?: CalendarEventEdit[];
  pendingEmailDraftCount?: number;
};

export type AgentActionKind = "schedule" | "delete" | "edit" | "draft_email" | "answer";

export type CallyIntentKind =
  | "schedule_event"
  | "find_time"
  | "draft_scheduling_message"
  | "calendar_audit"
  | "reduce_meetings"
  | "resolve_conflict"
  | "design_calendar_rhythm"
  | "protect_focus_time"
  | "create_agenda"
  | "prepare_for_meeting"
  | "convert_to_async"
  | "delegate_meeting"
  | "reschedule_event"
  | "all_day_block"
  | "preference_update"
  | "answer";

export type CallyResolutionMode =
  | "clarify"
  | "answer"
  | "audit"
  | "recommend"
  | "draft_message"
  | "propose_event"
  | "propose_edit"
  | "propose_delete"
  | "find_slots"
  | "update_preference";

export type ScheduleActionIntentKind =
  | "new_schedule"
  | "select_alternative"
  | "confirm_pending_event"
  | "override_conflict"
  | "modify_details"
  | "none";

export type CalendarActionScope = "specific" | "all_on_date" | "ambiguous" | "none";

export type SchedulePrepBlock = {
  titlePrefix: string;
  durationMinutes: number;
};

export type AgentActionIntent = {
  action: AgentActionKind;
  intentKind: CallyIntentKind;
  resolutionMode: CallyResolutionMode;
  pendingConfirmationAction: PendingConfirmationAction;
  scheduleIntent: ScheduleActionIntentKind;
  rawTitle: string | null;
  rawDateText: string | null;
  rawTimeText: string | null;
  rawDurationText: string | null;
  rawAttendees: string[] | null;
  selectedOptionText: string | null;
  scheduleTitle: string | null;
  scheduleDate: string | null;
  scheduleStart: string | null;
  scheduleEnd: string | null;
  scheduleDurationMinutes: number | null;
  scheduleAllDay: boolean | null;
  scheduleAttendees: string[] | null;
  schedulePrepBlocks: SchedulePrepBlock[] | null;
  selectedOptionId: string | null;
  calendarScope: CalendarActionScope;
  eventId: string | null;
  date: string | null;
  eventReference: string | null;
  newTitle: string | null;
  newStart: string | null;
  newEnd: string | null;
};

export type EmailDraft = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  responseBlocks?: AgentResponseBlock[];
};

export type AgentResponseBlock =
  | {
      type: "summary";
      title: string;
      body: string;
    }
  | {
      type: "recommendation_group";
      title: string;
      items: string[];
    }
  | {
      type: "meeting_plan";
      title: string;
      groups: Array<{
        label: string;
        recommendation: string;
        rationale: string;
      }>;
    }
  | {
      type: "draft_message";
      title: string;
      audience: string;
      body: string;
    }
  | {
      type: "action_checklist";
      title: string;
      items: string[];
    };

export type AgentChatResponse = {
  message: string;
  responseBlocks?: AgentResponseBlock[];
  confirmedPendingAction?: Exclude<PendingConfirmationAction, "none">;
  proposedEvents?: CalendarEventDraft[];
  proposedEmails?: EmailDraft[];
  proposedDeletions?: CalendarEventDeletion[];
  proposedEdits?: CalendarEventEdit[];
  scheduleOptions?: ScheduleOption[];
  conversationState?: ConversationState;
};

export type UserProfilePreferences = {
  defaultView: CalendarView;
};

export type UserProfile = {
  uid: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
  timezone?: string;
  locale?: string;
  calendarConnected: boolean;
  defaultCalendarId?: string;
  preferences: UserProfilePreferences;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
  calendarConnectedAt?: string;
};
