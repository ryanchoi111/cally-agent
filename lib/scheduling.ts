import type {
  AgentChatResponse,
  CalendarEvent,
  CalendarEventDraft,
  ChatMessage,
  ConversationState,
  SchedulePrepBlock,
  ScheduleOption
} from "./types";

export type ClientContext = {
  calendarView?: string;
  localDate?: string;
  localDateTime?: string;
  localWeekday?: string;
  timezone?: string;
  viewDate?: string;
  visibleRange?: {
    start?: string;
    end?: string;
  };
};

export type SchedulingIntent = {
  intent:
    | "new_schedule"
    | "select_alternative"
    | "confirm_pending_event"
    | "override_conflict"
    | "modify_details"
    | "email_draft"
    | "normal_answer";
  rawTitle?: string | null;
  rawDateText?: string | null;
  rawTimeText?: string | null;
  rawDurationText?: string | null;
  rawAttendees?: string[] | null;
  selectedOptionText?: string | null;
  scheduleTitle?: string | null;
  scheduleDate?: string | null;
  scheduleStart?: string | null;
  scheduleEnd?: string | null;
  scheduleDurationMinutes?: number | null;
  scheduleAllDay?: boolean | null;
  scheduleAttendees?: string[] | null;
  schedulePrepBlocks?: SchedulePrepBlock[] | null;
  selectedOptionId?: string | null;
  normalizedTitle?: string | null;
  normalizedDate?: string | null;
  normalizedStartTime?: string | null;
  normalizedEndTime?: string | null;
  normalizedStart?: string | null;
  normalizedEnd?: string | null;
};

type ResolvedDateContext = {
  today: string | null;
  todayWeekday: string | null;
  timezone: string | null;
  requestedDate: string | null;
  requestedWeekday: string | null;
  requestedTitle: string | null;
  requestedStartTimeMinutes: number | null;
  requestedDurationMinutes: number | null;
  preEventBlocks: SchedulePrepBlock[];
  requestedAttendeeNames: string[];
  requestedAttendeeEmails: string[];
  sourceText: string | null;
  timeSourceText: string | null;
  shouldCreateEvent: boolean;
  needsExplicitDate: boolean;
  needsExplicitTitle: boolean;
  needsExplicitTime: boolean;
  needsExplicitDuration: boolean;
  dateError: string | null;
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

const monthNames = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december"
] as const;

export function latestUserMessage(messages: ChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
}

export function isSchedulingRequest(text: string) {
  return /\b(add|create|schedule|book|put|block|reserve|propose)\b/i.test(text);
}

export function isEmailDraftRequest(text: string) {
  return /\b(draft|write|compose|send|email|gmail|message|note)\b/i.test(text);
}

function emailAddresses(text: string) {
  return Array.from(
    new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])
  );
}

function isEventDetailReply(text: string) {
  return (
    emailAddresses(text).length > 0 ||
    requestedTimeRangeMinutes(text) !== null ||
    requestedStartTimeMinutes(text) !== null ||
    requestedDurationMinutes(text) !== null ||
    /\b(location|meet|zoom|teams|room|office|address)\b/i.test(text)
  );
}

function wantsToCreateWithoutMoreDetails(text: string) {
  return /\b(?:just\s+)?(?:create|schedule|add|book)\b.*\b(?:for now|anyway|without|no emails?|don'?t have|do not have)\b/i.test(
    text
  );
}

function timePartsToMinutes(hourText: string, minuteText: string | undefined, meridiemText: string) {
  let hour = Number(hourText);
  const minutes = minuteText ? Number(minuteText) : 0;
  const meridiem = meridiemText.toLowerCase();

  if (hour < 1 || hour > 12 || minutes < 0 || minutes > 59) {
    return null;
  }

  if (meridiem.startsWith("p") && hour !== 12) {
    hour += 12;
  }

  if (meridiem.startsWith("a") && hour === 12) {
    hour = 0;
  }

  return hour * 60 + minutes;
}

export function requestedStartTimeMinutes(text: string) {
  const match = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i.exec(text);
  if (!match) {
    return null;
  }

  return timePartsToMinutes(match[1], match[2], match[3]);
}

export function requestedTimeRangeMinutes(text: string) {
  const match =
    /\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|to|until|through)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i.exec(
      text
    );

  if (!match) {
    return null;
  }

  const endMeridiem = match[6];
  const startMeridiem = match[3] ?? endMeridiem;
  let startMinutes = timePartsToMinutes(match[1], match[2], startMeridiem);
  let endMinutes = timePartsToMinutes(match[4], match[5], endMeridiem);

  if (startMinutes === null || endMinutes === null) {
    return null;
  }

  if (!match[3] && startMinutes >= endMinutes) {
    const alternateMeridiem = endMeridiem.toLowerCase().startsWith("p") ? "am" : "pm";
    const alternateStartMinutes = timePartsToMinutes(match[1], match[2], alternateMeridiem);
    if (alternateStartMinutes !== null && alternateStartMinutes < endMinutes) {
      startMinutes = alternateStartMinutes;
    }
  }

  if (endMinutes <= startMinutes) {
    endMinutes += 1440;
  }

  return {
    startMinutes,
    endMinutes,
    durationMinutes: endMinutes - startMinutes
  };
}

export function requestedDurationMinutes(text: string) {
  const timeRange = requestedTimeRangeMinutes(text);
  if (timeRange) {
    return timeRange.durationMinutes;
  }

  const match = /\b(\d+)\s*(?:-| )?(minute|minutes|min|mins|hour|hours|hr|hrs)\b/i.exec(text);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return unit.startsWith("hour") || unit.startsWith("hr") ? value * 60 : value;
}

function parsePreEventBlocks(text: string) {
  const beforePrep = /\b(\d+)\s*(?:-| )?(minute|minutes|min|mins|hour|hours|hr|hrs)\s+prep\b/i.exec(
    text
  );
  const afterPrep = /\bprep\s+block\s+(?:for\s+)?(\d+)\s*(?:-| )?(minute|minutes|min|mins|hour|hours|hr|hrs)\b/i.exec(
    text
  );
  const match = beforePrep ?? afterPrep;

  if (!match) {
    return [];
  }

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (!Number.isFinite(value) || value <= 0) {
    return [];
  }

  return [
    {
      titlePrefix: "Prep",
      durationMinutes: unit.startsWith("hour") || unit.startsWith("hr") ? value * 60 : value
    }
  ] satisfies SchedulePrepBlock[];
}

function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseDateParts(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) {
    return null;
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function formatDateParts(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function weekdayForDate(date: string) {
  const parts = parseDateParts(date);
  if (!parts) {
    return null;
  }

  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function addDays(date: string, days: number) {
  const parts = parseDateParts(date);
  if (!parts) {
    return null;
  }

  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return formatDateParts(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

function dateFromEventStart(start: string) {
  return start.slice(0, 10);
}

function timeStringFromMinutes(totalMinutes: number) {
  const normalizedMinutes = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalizedMinutes / 60);
  const minutes = normalizedMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
}

function offsetFromClientContext(clientContext: ClientContext) {
  const offsetMatch = /\bGMT([+-]\d{4})\b/.exec(clientContext.localDateTime ?? "");
  if (!offsetMatch) {
    return "";
  }

  const offset = offsetMatch[1];
  return `${offset.slice(0, 3)}:${offset.slice(3)}`;
}

function dateForMinuteOffset(date: string, totalMinutes: number) {
  const dayOffset = Math.floor(totalMinutes / 1440);
  return addDays(date, dayOffset) ?? date;
}

function hasNormalizedScheduleFields(intent?: SchedulingIntent | null) {
  return Boolean(
    intent &&
      (intent.scheduleTitle !== undefined ||
        intent.scheduleDate !== undefined ||
        intent.scheduleStart !== undefined ||
        intent.scheduleEnd !== undefined ||
        intent.scheduleAllDay !== undefined ||
        intent.scheduleAttendees !== undefined ||
        intent.schedulePrepBlocks !== undefined ||
        intent.scheduleDurationMinutes !== undefined ||
        intent.selectedOptionId !== undefined ||
        intent.normalizedTitle !== undefined ||
        intent.normalizedDate !== undefined ||
        intent.normalizedStart !== undefined ||
        intent.normalizedEnd !== undefined ||
        intent.normalizedStartTime !== undefined ||
        intent.normalizedEndTime !== undefined)
  );
}

function isValidDateTime(value: string) {
  return !isDateOnly(value) && Number.isFinite(Date.parse(value));
}

function minutesBetween(start: string, end: string) {
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    return null;
  }

  return Math.round((endTime - startTime) / 60000);
}

function cleanPrepBlocks(blocks: SchedulePrepBlock[] | null | undefined) {
  return (blocks ?? [])
    .map((block) => ({
      titlePrefix: block.titlePrefix.trim() || "Prep",
      durationMinutes: block.durationMinutes
    }))
    .filter((block) => Number.isFinite(block.durationMinutes) && block.durationMinutes > 0);
}

function normalizedTitle(intent: SchedulingIntent) {
  return (intent.scheduleTitle ?? intent.normalizedTitle)?.trim() || null;
}

function dateFromRawIntentText(intent: SchedulingIntent, clientContext: ClientContext) {
  return intent.rawDateText ? resolveRequestedDate(intent.rawDateText, clientContext) : null;
}

function normalizedDate(intent: SchedulingIntent, clientContext: ClientContext) {
  return (
    dateFromRawIntentText(intent, clientContext) ??
    intent.scheduleDate ??
    intent.normalizedDate ??
    intent.scheduleStart?.slice(0, 10) ??
    intent.normalizedStart?.slice(0, 10) ??
    null
  );
}

function normalizeScheduleDateTime(value: string | null | undefined, date: string | null, clientContext: ClientContext) {
  if (!value) {
    return null;
  }

  if (/^\d{1,2}:\d{2}$/.test(value) && date) {
    const [hour, minute] = value.split(":");
    return `${date}T${String(Number(hour)).padStart(2, "0")}:${minute}:00${offsetFromClientContext(clientContext)}`;
  }

  if (date && /^\d{4}-\d{2}-\d{2}T/.test(value) && value.slice(0, 10) !== date) {
    return `${date}${value.slice(10)}`;
  }

  return value;
}

function normalizedStart(intent: SchedulingIntent, date: string | null, clientContext: ClientContext) {
  return normalizeScheduleDateTime(
    intent.scheduleStart ?? intent.normalizedStart ?? intent.normalizedStartTime,
    date,
    clientContext
  );
}

function normalizedEnd(intent: SchedulingIntent, date: string | null, clientContext: ClientContext) {
  const explicitEnd = normalizeScheduleDateTime(
    intent.scheduleEnd ?? intent.normalizedEnd ?? intent.normalizedEndTime,
    date,
    clientContext
  );
  if (explicitEnd) {
    return explicitEnd;
  }

  const start = normalizedStart(intent, date, clientContext);
  const duration = intent.scheduleDurationMinutes;
  if (!start || !Number.isFinite(duration) || !duration || duration <= 0) {
    return null;
  }

  const startMinutes = localMinutesFromEventDateTime(start);
  const startDate = start.slice(0, 10);
  if (startMinutes === null) {
    return null;
  }

  const endMinutes = startMinutes + duration;
  const endDate = dateForMinuteOffset(startDate, endMinutes);
  return `${endDate}T${timeStringFromMinutes(endMinutes)}${start.replace(/^.*T\d{2}:\d{2}:\d{2}/, "")}`;
}

function buildNormalizedDraft(intent: SchedulingIntent, clientContext: ClientContext): CalendarEventDraft | null {
  const title = normalizedTitle(intent);
  const date = normalizedDate(intent, clientContext);
  const allDay = intent.scheduleAllDay === true;

  if (!title || !date || !isDateOnly(date)) {
    return null;
  }

  const attendees = intent.scheduleAttendees?.filter(Boolean) ?? [];
  if (allDay) {
    return {
      title,
      start: date,
      end: addDays(date, 1) ?? date,
      allDay: true,
      attendees
    };
  }

  const start = normalizedStart(intent, date, clientContext);
  const end = normalizedEnd(intent, date, clientContext);
  if (!start || !end) {
    return null;
  }

  if (!isValidDateTime(start) || !isValidDateTime(end)) {
    return null;
  }

  if (minutesBetween(start, end) === null) {
    return null;
  }

  return {
    title,
    start,
    end,
    allDay: false,
    attendees
  };
}

function buildNormalizedDateContext(
  intent: SchedulingIntent,
  clientContext: ClientContext
): ResolvedDateContext {
  const date = normalizedDate(intent, clientContext);
  const start = normalizedStart(intent, date, clientContext);
  const end = normalizedEnd(intent, date, clientContext);
  const startMinutes = start ? localMinutesFromEventDateTime(start) : null;
  const durationMinutes = start && end ? minutesBetween(start, end) : intent.scheduleDurationMinutes ?? null;
  const allDay = intent.scheduleAllDay === true;
  const title = normalizedTitle(intent);
  const dateWeekday = date && isDateOnly(date) ? weekdayForDate(date) : null;
  const startDate = start?.slice(0, 10) ?? null;
  const dateError =
    date && !isDateOnly(date)
      ? "That date is not a valid YYYY-MM-DD calendar date."
      : start && !isValidDateTime(start)
        ? "That start time is not a valid date-time."
        : end && !isValidDateTime(end)
          ? "That end time is not a valid date-time."
          : start && end && durationMinutes === null
            ? "That end time must be after the start time."
            : date && startDate && isDateOnly(date) && date !== startDate
              ? `The requested date ${date} does not match the start time date ${startDate}.`
              : null;

  return {
    today: clientContext.localDate ?? null,
    todayWeekday: clientContext.localWeekday ?? null,
    timezone: clientContext.timezone ?? null,
    requestedDate: date,
    requestedWeekday: dateWeekday === null ? null : weekdayNames[dateWeekday],
    requestedTitle: title,
    requestedStartTimeMinutes: allDay ? 0 : startMinutes,
    requestedDurationMinutes: allDay ? 1440 : durationMinutes,
    preEventBlocks: cleanPrepBlocks(intent.schedulePrepBlocks),
    requestedAttendeeNames: [],
    requestedAttendeeEmails: intent.scheduleAttendees?.filter(Boolean) ?? [],
    sourceText: null,
    timeSourceText: null,
    shouldCreateEvent:
      intent.intent === "new_schedule" ||
      intent.intent === "modify_details" ||
      intent.intent === "confirm_pending_event",
    needsExplicitDate: !date || !isDateOnly(date),
    needsExplicitTitle: !title,
    needsExplicitTime: !allDay && !start,
    needsExplicitDuration: !allDay && (!end || durationMinutes === null),
    dateError
  };
}

function findTimeSourceMessage(messages: ChatMessage[]) {
  const userMessages = messages.filter((message) => message.role === "user").map((message) => message.content);

  return (
    [...userMessages]
      .reverse()
      .find(
        (message) =>
          requestedTimeRangeMinutes(message) !== null ||
          requestedStartTimeMinutes(message) !== null ||
          requestedDurationMinutes(message) !== null
      ) ??
    [...userMessages].reverse().find(isSchedulingRequest) ??
    userMessages.at(-1) ??
    ""
  );
}

function findDurationSourceMessage(messages: ChatMessage[]) {
  const userMessages = messages.filter((message) => message.role === "user").map((message) => message.content);

  return (
    [...userMessages].reverse().find((message) => requestedDurationMinutes(message) !== null) ??
    [...userMessages].reverse().find(isSchedulingRequest) ??
    userMessages.at(-1) ??
    ""
  );
}

function findPrepSourceMessage(messages: ChatMessage[]) {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .reverse()
    .find((message) => parsePreEventBlocks(message).length > 0);
}

function requestedEventTitle(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match =
    /\b(?:schedule|add|create|book|put|block|reserve)\b\s+(?:(?:a|an|the)\s+)?(?:(?:\d+)\s*(?:-| )?(?:minute|minutes|min|mins|hour|hours|hr|hrs)\s+)?(.+?)(?=\s+(?:today|tomorrow|this|next|on|at|with|for|from)\b|$)/i.exec(
      normalized
    );

  let title = match?.[1]
    ?.replace(/\b(?:event|meeting|appointment)\b$/i, "")
    .replace(/[.?!,;:]+$/g, "")
    .trim();

  const companyMatch = /\bwith\s+(.+?)(?=\s+(?:today|tomorrow|this|next|on|at|for|from)\b|[.?!]|$)/i.exec(
    normalized
  );
  const companyName = companyMatch?.[1]?.trim();
  const looksLikeCompany = companyName
    ? /\b(inc|llc|ltd|corp|corporation|company|co\.|group|partners|capital|ventures|labs|systems|solutions)\b/i.test(
        companyName
      )
    : false;

  if (title && companyName && looksLikeCompany && !title.toLowerCase().includes(companyName.toLowerCase())) {
    title = `${title} with ${companyName}`;
  }

  return title || null;
}

function requestedAttendeeNames(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = /\bwith\s+(.+?)(?=\s+(?:at|on|for|next|this|today|tomorrow|add|include)\b|[.?!]|$)/i.exec(
    normalized
  );

  if (!match) {
    return [];
  }

  return match[1]
    .split(/\s*,\s*|\s+and\s+/i)
    .map((name) => name.trim())
    .filter((name) => name && !emailAddresses(name).length);
}

function requestedWeekday(text: string) {
  const lower = text.toLowerCase();
  const index = weekdayNames.findIndex((weekday) => new RegExp(`\\b${weekday}\\b`).test(lower));
  return index === -1 ? null : index;
}

function requestedMonthDate(text: string, clientContext: ClientContext) {
  const lower = text.toLowerCase();
  const localParts = clientContext.localDate ? parseDateParts(clientContext.localDate) : null;

  for (const [monthIndex, monthName] of monthNames.entries()) {
    const match = new RegExp(`\\b${monthName}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`).exec(
      lower
    );

    if (!match) {
      continue;
    }

    const day = Number(match[1]);
    const year = match[2] ? Number(match[2]) : localParts?.year;
    if (!year || day < 1 || day > 31) {
      return null;
    }

    return formatDateParts(year, monthIndex + 1, day);
  }

  return null;
}

function resolveRequestedDate(text: string, clientContext: ClientContext) {
  const lower = text.toLowerCase();
  const localDate = clientContext.localDate;

  if (!localDate || !parseDateParts(localDate)) {
    return null;
  }

  const explicitMonthDate = requestedMonthDate(text, clientContext);
  if (explicitMonthDate) {
    return explicitMonthDate;
  }

  if (/\btoday\b/.test(lower)) {
    return localDate;
  }

  if (/\btomorrow\b/.test(lower)) {
    return addDays(localDate, 1);
  }

  const weekday = requestedWeekday(text);
  if (weekday === null) {
    return null;
  }

  const currentWeekday = weekdayForDate(localDate);
  if (currentWeekday === null) {
    return null;
  }

  let delta = (weekday - currentWeekday + 7) % 7;
  const weekdayName = weekdayNames[weekday];
  const saysNextWeekday = new RegExp(`\\bnext\\s+${weekdayName}\\b`).test(lower);
  const saysNextWeek = /\bnext\s+week\b/.test(lower);

  if (saysNextWeekday) {
    delta += 7;
  } else if (saysNextWeek && delta < 7) {
    delta += 7;
  }

  return addDays(localDate, delta);
}

function findDateSourceMessage(messages: ChatMessage[], clientContext: ClientContext) {
  const userMessages = messages.filter((message) => message.role === "user").map((message) => message.content);

  const explicitLatest = [...userMessages]
    .reverse()
    .find((message) => Boolean(resolveRequestedDate(message, clientContext)));
  if (explicitLatest) {
    return explicitLatest;
  }

  return [...userMessages].reverse().find(isSchedulingRequest) ?? userMessages.at(-1) ?? "";
}

export function buildResolvedDateContext(
  messages: ChatMessage[],
  clientContext: ClientContext,
  intent?: SchedulingIntent | null
): ResolvedDateContext {
  const latestMessage = latestUserMessage(messages);
  const userMessages = messages.filter((message) => message.role === "user").map((message) => message.content);
  const intentTexts = [
    intent?.rawTitle,
    intent?.rawDateText,
    intent?.rawTimeText,
    intent?.rawDurationText,
    ...(intent?.rawAttendees ?? [])
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  const augmentedMessages = intentTexts
    ? [...messages, { role: "user" as const, content: intentTexts }]
    : messages;
  const sourceText = findDateSourceMessage(augmentedMessages, clientContext);
  const timeSourceText = findTimeSourceMessage(augmentedMessages);
  const durationSourceText = findDurationSourceMessage(augmentedMessages);
  const prepSourceText = findPrepSourceMessage(augmentedMessages);
  const titleSourceText =
    intent?.rawTitle ??
    [...augmentedMessages]
      .reverse()
      .find((message) => message.role === "user" && requestedEventTitle(message.content))
      ?.content;
  const requestedDate = sourceText ? resolveRequestedDate(sourceText, clientContext) : null;
  const weekday = sourceText ? requestedWeekday(sourceText) : null;
  const requestedTitle = titleSourceText ? requestedEventTitle(titleSourceText) ?? titleSourceText.trim() : null;
  const timeRange = timeSourceText ? requestedTimeRangeMinutes(timeSourceText) : null;
  const startTimeMinutes = timeRange?.startMinutes ?? (timeSourceText ? requestedStartTimeMinutes(timeSourceText) : null);
  const durationMinutes = durationSourceText ? requestedDurationMinutes(durationSourceText) : null;
  const preEventBlocks = prepSourceText ? parsePreEventBlocks(prepSourceText) : [];
  const attendeeEmails = Array.from(
    new Set([...userMessages, intentTexts].flatMap(emailAddresses))
  );
  const attendeeNames = Array.from(new Set(userMessages.flatMap(requestedAttendeeNames)));
  const latestNeedsScheduling =
    isSchedulingRequest(latestMessage) ||
    intent?.intent === "new_schedule" ||
    intent?.intent === "modify_details";
  const hasSchedulingContext = userMessages.some(isSchedulingRequest);
  const isSupplyingEventDetails =
    isEventDetailReply(latestMessage) || wantsToCreateWithoutMoreDetails(latestMessage);
  const requestedDateWeekday = requestedDate ? weekdayForDate(requestedDate) : null;
  const dateError =
    requestedDate && weekday !== null && requestedDateWeekday !== null && requestedDateWeekday !== weekday
      ? `${requestedDate} is ${weekdayNames[requestedDateWeekday]}, not ${weekdayNames[weekday]}.`
      : null;

  return {
    today: clientContext.localDate ?? null,
    todayWeekday: clientContext.localWeekday ?? null,
    timezone: clientContext.timezone ?? null,
    requestedDate,
    requestedWeekday: weekday === null ? null : weekdayNames[weekday],
    requestedTitle,
    requestedStartTimeMinutes: startTimeMinutes,
    requestedDurationMinutes: durationMinutes,
    preEventBlocks,
    requestedAttendeeNames: attendeeNames,
    requestedAttendeeEmails: attendeeEmails,
    sourceText: sourceText || null,
    timeSourceText: timeSourceText || null,
    shouldCreateEvent: latestNeedsScheduling || (hasSchedulingContext && isSupplyingEventDetails),
    needsExplicitDate: latestNeedsScheduling && !requestedDate,
    needsExplicitTitle: latestNeedsScheduling && !requestedTitle,
    needsExplicitTime: latestNeedsScheduling && startTimeMinutes === null,
    needsExplicitDuration: latestNeedsScheduling && durationMinutes === null,
    dateError
  };
}

function parseTimedEventRange(start: string, end: string) {
  if (isDateOnly(start) || isDateOnly(end)) {
    return null;
  }

  const startTime = Date.parse(start);
  const endTime = Date.parse(end);

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return null;
  }

  return { startTime, endTime };
}

function eventCanOverlapDraftDate(draft: CalendarEventDraft, event: CalendarEvent) {
  const draftStartDate = dateFromEventStart(draft.start);
  const eventStartDate = dateFromEventStart(event.start);
  const eventEndDate = dateFromEventStart(event.end);

  return eventStartDate === draftStartDate || eventEndDate === draftStartDate;
}

export function overlappingEvents(draft: CalendarEventDraft, events: CalendarEvent[]) {
  if (draft.allDay) {
    return [];
  }

  const draftRange = parseTimedEventRange(draft.start, draft.end);
  if (!draftRange) {
    return [];
  }

  return events.filter((event) => {
    if (event.allDay || !eventCanOverlapDraftDate(draft, event)) {
      return false;
    }

    const eventRange = parseTimedEventRange(event.start, event.end);
    if (!eventRange) {
      return false;
    }

    return draftRange.startTime < eventRange.endTime && draftRange.endTime > eventRange.startTime;
  });
}

function localMinutesFromEventDateTime(value: string) {
  const match = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(value);
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function formatTimeLabel(totalMinutes: number) {
  const normalizedMinutes = ((totalMinutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalizedMinutes / 60);
  const minutes = normalizedMinutes % 60;
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${meridiem}`;
}

function mergeBusyRanges(ranges: Array<{ start: number; end: number }>) {
  return ranges
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start)
    .reduce<Array<{ start: number; end: number }>>((merged, range) => {
      const previous = merged.at(-1);
      if (!previous || range.start > previous.end) {
        merged.push({ ...range });
        return merged;
      }

      previous.end = Math.max(previous.end, range.end);
      return merged;
    }, []);
}

function availableSlotsForDate(
  date: string,
  durationMinutes: number,
  events: CalendarEvent[],
  limit = 3
) {
  const workingStart = 9 * 60;
  const workingEnd = 17 * 60;
  const busyRanges = mergeBusyRanges(
    events.flatMap((event) => {
      if (
        event.allDay ||
        !eventCanOverlapDraftDate(
          { start: `${date}T00:00:00`, end: `${date}T23:59:00`, title: "", allDay: false },
          event
        )
      ) {
        return [];
      }

      const start = localMinutesFromEventDateTime(event.start);
      const end = localMinutesFromEventDateTime(event.end);
      if (start === null || end === null) {
        return [];
      }

      return [
        {
          start: Math.max(workingStart, start),
          end: Math.min(workingEnd, end)
        }
      ];
    })
  );

  const slots: Array<{ start: number; end: number }> = [];
  let cursor = workingStart;

  for (const busyRange of busyRanges) {
    if (busyRange.start - cursor >= durationMinutes) {
      slots.push({ start: cursor, end: cursor + durationMinutes });
    }

    cursor = Math.max(cursor, busyRange.end);
    if (slots.length >= limit) {
      return slots;
    }
  }

  if (workingEnd - cursor >= durationMinutes) {
    slots.push({ start: cursor, end: cursor + durationMinutes });
  }

  return slots.slice(0, limit);
}

function buildServerProposedEvent(resolvedDateContext: ResolvedDateContext, clientContext: ClientContext) {
  if (
    !resolvedDateContext.requestedTitle ||
    !resolvedDateContext.requestedDate ||
    resolvedDateContext.requestedStartTimeMinutes === null ||
    resolvedDateContext.requestedDurationMinutes === null
  ) {
    return null;
  }

  const endMinutes =
    resolvedDateContext.requestedStartTimeMinutes + resolvedDateContext.requestedDurationMinutes;
  const endDate = dateForMinuteOffset(resolvedDateContext.requestedDate, endMinutes);
  const offset = offsetFromClientContext(clientContext);

  return {
    title: resolvedDateContext.requestedTitle,
    start: `${resolvedDateContext.requestedDate}T${timeStringFromMinutes(
      resolvedDateContext.requestedStartTimeMinutes
    )}${offset}`,
    end: `${endDate}T${timeStringFromMinutes(endMinutes)}${offset}`,
    allDay: false,
    description: undefined,
    location: undefined,
    attendees: resolvedDateContext.requestedAttendeeEmails
  } satisfies CalendarEventDraft;
}

export function buildServerProposedEvents(
  resolvedDateContext: ResolvedDateContext,
  clientContext: ClientContext,
  overrideMainEvent?: CalendarEventDraft
) {
  const mainEvent = overrideMainEvent ?? buildServerProposedEvent(resolvedDateContext, clientContext);
  if (!mainEvent) {
    return [];
  }

  const proposedEvents: CalendarEventDraft[] = [];

  if (resolvedDateContext.requestedDate && resolvedDateContext.requestedStartTimeMinutes !== null) {
    const offset = offsetFromClientContext(clientContext);
    let cursorMinutes = localMinutesFromEventDateTime(mainEvent.start) ?? resolvedDateContext.requestedStartTimeMinutes;

    for (const block of [...resolvedDateContext.preEventBlocks].reverse()) {
      const blockStartMinutes = cursorMinutes - block.durationMinutes;
      const blockStartDate = dateForMinuteOffset(dateFromEventStart(mainEvent.start), blockStartMinutes);
      const blockEndDate = dateForMinuteOffset(dateFromEventStart(mainEvent.start), cursorMinutes);
      proposedEvents.push({
        title: `${block.titlePrefix}: ${mainEvent.title}`,
        start: `${blockStartDate}T${timeStringFromMinutes(blockStartMinutes)}${offset}`,
        end: `${blockEndDate}T${timeStringFromMinutes(cursorMinutes)}${offset}`,
        allDay: false,
        description: `${block.titlePrefix} block before ${mainEvent.title}.`,
        location: undefined
      });
      cursorMinutes = blockStartMinutes;
    }
  }

  proposedEvents.push(mainEvent);
  return proposedEvents;
}

function missingEventDetailMessage(resolvedDateContext: ResolvedDateContext) {
  if (resolvedDateContext.needsExplicitTitle) {
    return "I need an event title before I can propose that calendar event.";
  }

  if (resolvedDateContext.needsExplicitDate) {
    return "I need a specific day or date before I can propose that calendar event.";
  }

  if (resolvedDateContext.needsExplicitTime) {
    return "I need a start time before I can propose that calendar event.";
  }

  if (resolvedDateContext.needsExplicitDuration) {
    return "I need a duration or end time before I can propose that calendar event.";
  }

  return null;
}

function formatResolvedDateLabel(date: string) {
  const weekday = weekdayForDate(date);
  const weekdayLabel = weekday === null ? "" : `${weekdayNames[weekday][0].toUpperCase()}${weekdayNames[weekday].slice(1)}, `;
  return `${weekdayLabel}${date}`;
}

function optionId(kind: ScheduleOption["kind"], draft: CalendarEventDraft, index: number) {
  return `${kind}:${draft.start}:${draft.end}:${index}`;
}

function optionFromDraft(
  draft: CalendarEventDraft,
  kind: ScheduleOption["kind"],
  index: number
): ScheduleOption {
  return {
    ...draft,
    id: optionId(kind, draft, index),
    kind
  };
}

function buildOptions(
  originalEvent: CalendarEventDraft,
  date: string,
  durationMinutes: number,
  events: CalendarEvent[]
) {
  const slots = availableSlotsForDate(date, durationMinutes, events);
  const alternatives = slots.map((slot, index) => {
    const endDate = dateForMinuteOffset(date, slot.end);
    return optionFromDraft(
      {
        ...originalEvent,
        start: `${date}T${timeStringFromMinutes(slot.start)}${originalEvent.start.replace(/^.*T\d{2}:\d{2}:\d{2}/, "")}`,
        end: `${endDate}T${timeStringFromMinutes(slot.end)}${originalEvent.end.replace(/^.*T\d{2}:\d{2}:\d{2}/, "")}`
      },
      "alternative",
      index
    );
  });

  return [...alternatives, optionFromDraft(originalEvent, "override_original", alternatives.length)];
}

function ordinalSelection(text: string) {
  const lower = text.toLowerCase();
  if (/\b(first|1st)\b/.test(lower)) return 0;
  if (/\b(second|2nd)\b/.test(lower)) return 1;
  if (/\b(third|3rd)\b/.test(lower)) return 2;
  if (/\b(fourth|4th|fifth|5th|sixth|6th|seventh|7th|eighth|8th|ninth|9th)\b/.test(lower)) {
    return 999;
  }
  return null;
}

function optionStartMinutes(option: ScheduleOption) {
  return localMinutesFromEventDateTime(option.start);
}

function draftFromOption(option: ScheduleOption): CalendarEventDraft {
  return {
    title: option.title,
    start: option.start,
    end: option.end,
    allDay: option.allDay,
    description: option.description,
    location: option.location,
    attendees: option.attendees
  };
}

function selectPendingOption(text: string, options: ScheduleOption[]) {
  const lower = text.toLowerCase();
  if (/\b(original|anyway|override|conflict)\b/.test(lower)) {
    return options.find((option) => option.kind === "override_original") ?? null;
  }

  const ordinal = ordinalSelection(text);
  const alternatives = options.filter((option) => option.kind === "alternative");
  if (ordinal !== null) {
    return alternatives[ordinal] ?? null;
  }

  const requestedTime = requestedStartTimeMinutes(text);
  if (requestedTime !== null) {
    return (
      options.find((option) => optionStartMinutes(option) === requestedTime) ??
      options.find((option) => Math.abs((optionStartMinutes(option) ?? -9999) - requestedTime) <= 15) ??
      null
    );
  }

  return null;
}

export function resolveSchedulingTurn({
  messages,
  clientContext,
  calendarContext,
  conversationState,
  intent
}: {
  messages: ChatMessage[];
  clientContext: ClientContext;
  calendarContext: CalendarEvent[];
  conversationState?: ConversationState;
  intent?: SchedulingIntent | null;
}): AgentChatResponse | null {
  const latestText = latestUserMessage(messages);
  const pendingOptions = conversationState?.scheduleOptions ?? [];
  const selectedOption =
    pendingOptions.length && intent?.selectedOptionId
      ? pendingOptions.find((option) => option.id === intent.selectedOptionId) ?? null
      : pendingOptions.length && (intent?.intent === "select_alternative" || intent?.intent === "override_conflict" || !isSchedulingRequest(latestText))
        ? selectPendingOption(intent?.selectedOptionText ?? latestText, pendingOptions)
      : null;

  if (pendingOptions.length && !selectedOption && (intent?.intent === "select_alternative" || requestedStartTimeMinutes(latestText) !== null || ordinalSelection(latestText) !== null)) {
    return {
      message: "Which option should I use? You can pick one by time, like 1:30 PM, or by position, like the second one.",
      scheduleOptions: pendingOptions,
      conversationState: { scheduleOptions: pendingOptions }
    };
  }

  if (selectedOption) {
    const conflicts = selectedOption.kind === "override_original" ? [] : overlappingEvents(selectedOption, calendarContext);
    if (conflicts.length) {
      return {
        message: `That option now overlaps with ${conflicts.map((event) => `"${event.title}"`).join(", ")}. Pick a different option or ask me to override the original time.`,
        scheduleOptions: pendingOptions,
        conversationState: { scheduleOptions: pendingOptions }
      };
    }

    return {
      message: `I can use ${formatTimeLabel(optionStartMinutes(selectedOption) ?? 0)}. Please confirm before I create it.`,
      proposedEvents: [draftFromOption(selectedOption)],
      scheduleOptions: [],
      conversationState: { scheduleOptions: [] }
    };
  }

  const resolvedDateContext = hasNormalizedScheduleFields(intent)
    ? buildNormalizedDateContext(intent!, clientContext)
    : buildResolvedDateContext(messages, clientContext, intent);
  if (!resolvedDateContext.shouldCreateEvent) {
    return null;
  }

  if (resolvedDateContext.dateError) {
    return {
      message: `${resolvedDateContext.dateError} Please confirm the correct date before I propose this event.`
    };
  }

  const missingDetailMessage = missingEventDetailMessage(resolvedDateContext);
  const normalizedMainEvent = hasNormalizedScheduleFields(intent)
    ? buildNormalizedDraft(intent!, clientContext)
    : undefined;
  const proposedEvents = buildServerProposedEvents(
    resolvedDateContext,
    clientContext,
    normalizedMainEvent ?? undefined
  );

  if (missingDetailMessage || !proposedEvents.length) {
    return {
      message: missingDetailMessage ?? "I need more event details before I can propose that calendar event."
    };
  }

  const overlaps = proposedEvents.flatMap((eventDraft) => overlappingEvents(eventDraft, calendarContext));
  if (overlaps.length) {
    const mainEvent = proposedEvents.at(-1);
    const durationMinutes =
      mainEvent && parseTimedEventRange(mainEvent.start, mainEvent.end)
        ? Math.round((parseTimedEventRange(mainEvent.start, mainEvent.end)!.endTime - parseTimedEventRange(mainEvent.start, mainEvent.end)!.startTime) / 60000)
        : resolvedDateContext.requestedDurationMinutes;
    const options =
      mainEvent && resolvedDateContext.requestedDate && durationMinutes
        ? buildOptions(mainEvent, resolvedDateContext.requestedDate, durationMinutes, calendarContext)
        : [];
    const alternatives = options.filter((option) => option.kind === "alternative");
    const suggestion =
      alternatives.length > 0
        ? `I found ${alternatives.map((option) => `${formatTimeLabel(optionStartMinutes(option) ?? 0)}-${formatTimeLabel(localMinutesFromEventDateTime(option.end) ?? 0)}`).join(", ")}.`
        : "I do not see another open slot of that length in the 9:00 AM-5:00 PM window from the calendar context I have.";

    return {
      message: `That time overlaps with ${overlaps
        .map((event) => `"${event.title}"`)
        .join(", ")}. ${suggestion} I can use one of those, or create the original time if you want to override the conflict.`,
      scheduleOptions: options,
      conversationState: { scheduleOptions: options }
    };
  }

  return {
    message:
      proposedEvents.length > 1
        ? `I can do that. I found room for ${proposedEvents.length} events on ${formatResolvedDateLabel(
            dateFromEventStart(proposedEvents.at(-1)!.start)
          )}.`
        : `I can do that. I found room for this event on ${formatResolvedDateLabel(
            dateFromEventStart(proposedEvents[0].start)
          )}.`,
    proposedEvents,
    scheduleOptions: [],
    conversationState: { scheduleOptions: [] }
  };
}
