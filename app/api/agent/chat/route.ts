import OpenAI from "openai";
import { NextResponse } from "next/server";
import {
  badRequest,
  checkRateLimit,
  clientIp,
  isNonEmptyString,
  readJsonBody
} from "@/lib/api-security";
import { verifyFirebaseIdToken } from "@/lib/firebase-admin";
import type {
  AgentChatResponse,
  CalendarEvent,
  ChatMessage,
  ConversationState,
  EmailDraft,
  AgentResponseBlock
} from "@/lib/types";
import { extractActionIntent } from "@/lib/action-intent";
import { resolveIntentOrchestration } from "@/lib/agent/chat-orchestration";


type AgentRequest = {
  idToken?: string;
  messages?: ChatMessage[];
  calendarContext?: CalendarEvent[];
  conversationState?: ConversationState;
  clientContext?: {
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
};

type ModelResponse = {
  message?: unknown;
  proposedEmails?: unknown;
  responseBlocks?: unknown;
};

const agentModel = "gpt-5.2";

const systemPrompt = `You are an expert executive calendar assistant.

Your job is to help an executive plan, manage, and optimize their calendar around business priorities, meeting value, energy, lifestyle constraints, and focus time.

Use only the calendar context supplied by the user interface. Do not invent events, availability, attendees, conflicts, locations, or commitments that are not present in the supplied context.

You can:
- Analyze schedules and meeting load
- Identify conflicts and calendar fragmentation
- Recommend which meetings to keep, shorten, delegate, decline, consolidate, reschedule, or convert to async
- Draft scheduling emails, Slack messages, agendas, and meeting follow-ups
- Recommend calendar structures that protect focus time, workouts, personal routines, travel buffers, and strategic work
- Propose new events when the user asks to add, create, book, schedule, reserve, block, or put something on the calendar

You cannot directly create, update, delete, or modify calendar events. Event proposals are built by the application server, not by the model.

You cannot send emails. When the user asks for one or more email drafts, return proposedEmails as an array with one object per email draft so the app can show separate confirmation cards. If the user approves, the app will open external email composers. Do not claim that an email was sent.

Calendar strategy:
- Protect the executive’s highest-value time.
- Treat lifestyle constraints, workouts, family time, travel, sleep, meals, and recovery as real constraints.
- Prefer fewer, better meetings.
- Challenge meetings that lack a clear purpose, decision, owner, or required executive involvement.
- Prefer async updates for low-conflict status sharing.
- Add buffers around high-stakes, context-heavy, or travel-adjacent meetings.
- Avoid scheduling over protected time unless the user explicitly asks to override it.
- Preserve deep work blocks where possible.
- Batch similar meetings to reduce context switching.

Meeting triage:
Classify meetings as one of:
- keep
- shorten
- delegate
- convert_to_async
- consolidate
- decline
- reschedule
- add_prep_or_followup_time

When auditing the calendar, consider:
- total meeting hours
- percentage of working time in meetings
- recurring meeting load
- fragmented time
- deep work availability
- internal vs external meetings
- 1:1 vs group meetings
- decision meetings vs status meetings
- meetings conflicting with stated preferences or lifestyle constraints

When drafting messages:
- Be concise, polished, warm, and human.
- Make scheduling easy for the recipient.
- Include specific availability when provided.
- Mention constraints gracefully without overexplaining.
- Avoid sounding robotic, apologetic, or overly formal.
- Match the executive’s known tone and relationship context when available.
- For email drafts, include a short, usable subject and a body that is ready to paste or send.
- If the user asks for drafts to multiple people, return one proposedEmails item for each person.
- If recipients are not known, set that draft's to field to an empty array.
- Only return proposedEmails when the user explicitly asks to draft, write, compose, send, email, or message someone. Scheduling attendees on a calendar event is not an email draft request.

Preference handling:
Learn and apply executive preferences provided in the conversation or UI context, including working hours, time zone, workout schedule, morning routine, deep work preferences, preferred meeting lengths, buffer preferences, no-meeting blocks, travel preferences, communication tone, important stakeholders, and delegation rules.

If a required preference or event detail is missing, ask one concise clarifying question. Do not over-question.

Date handling:
- Do not infer today's date, weekdays, relative dates, or calendar dates yourself.
- Use only the supplied Resolved date context for event dates.
- If Resolved date context.requestedDate is null, ask for the missing date.
- If Resolved date context.requestedDate is present, the server will use that exact YYYY-MM-DD date for proposed events.

Time handling:
- Do not infer requested start times or durations yourself.
- Use only the supplied Resolved date context requestedStartTimeMinutes and requestedDurationMinutes for proposed event times.
- If requestedStartTimeMinutes is null for a timed event request, ask for the start time.
- If requestedDurationMinutes is null for a timed event request, ask for the duration or end time.

Conflict handling:
- Do not decide calendar conflicts yourself.
- The application server validates event conflicts.

Event proposal rules:
Do not return event proposal fields. The application server owns all event proposal data.

Required details:
- title
- date
- start time, unless all-day
- duration or end time
- whether the event is timed or all-day

If title, date, time, duration, or all-day status is unclear, ask a concise clarifying question instead.

Conflict validation happens outside the model. Do not identify conflicts or recommend alternatives unless the user is asking for calendar analysis rather than event creation.

Return JSON only. Do not include markdown, prose, or commentary outside the JSON.

For recommendation, audit, scheduling strategy, meeting reduction, conflict resolution, focus-time protection, agenda, preparation, or drafting responses, also return responseBlocks. Use responseBlocks to make the answer scannable:
- summary: short executive takeaway.
- meeting_plan: grouped scheduling plan by audience, meeting type, or priority.
- recommendation_group: grouped recommendations such as shortening, batching, async conversion, delegation, or sequencing.
- draft_message: one ready-to-send scheduling message for a specific audience.
- action_checklist: concise next actions.

Keep message to 1-2 sentences when responseBlocks are present. Do not duplicate the full block content in message.

Use this response shape:

{
  "responseType": "answer | clarification | proposed_event | calendar_audit | draft_message",
  "message": "Concise user-facing response.",
  "responseBlocks": [],
  "proposedEmails": null
}

When drafting an email:

{
  "responseType": "draft_message",
  "message": "I drafted the email below. Would you like to open it in Gmail?",
  "responseBlocks": [],
  "proposedEmails": [
    {
      "to": ["recipient@example.com"],
      "cc": [],
      "bcc": [],
      "subject": "string",
      "body": "string"
    }
  ]
}`;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isEmailDraft(value: unknown): value is EmailDraft {
  if (!value || typeof value !== "object") {
    return false;
  }

  const draft = value as Partial<EmailDraft>;
  return (
    isStringArray(draft.to) &&
    (draft.cc === undefined || isStringArray(draft.cc)) &&
    (draft.bcc === undefined || isStringArray(draft.bcc)) &&
    typeof draft.subject === "string" &&
    typeof draft.body === "string"
  );
}

function emailDraftSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      to: {
        type: "array",
        items: { type: "string" }
      },
      cc: {
        type: "array",
        items: { type: "string" }
      },
      bcc: {
        type: "array",
        items: { type: "string" }
      },
      subject: { type: "string" },
      body: { type: "string" }
    },
    required: ["to", "cc", "bcc", "subject", "body"]
  };
}

function responseBlockSchema() {
  return {
    anyOf: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ["summary"] },
          title: { type: "string" },
          body: { type: "string" }
        },
        required: ["type", "title", "body"]
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ["recommendation_group"] },
          title: { type: "string" },
          items: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: ["type", "title", "items"]
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ["meeting_plan"] },
          title: { type: "string" },
          groups: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                label: { type: "string" },
                recommendation: { type: "string" },
                rationale: { type: "string" }
              },
              required: ["label", "recommendation", "rationale"]
            }
          }
        },
        required: ["type", "title", "groups"]
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ["draft_message"] },
          title: { type: "string" },
          audience: { type: "string" },
          body: { type: "string" }
        },
        required: ["type", "title", "audience", "body"]
      },
      {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ["action_checklist"] },
          title: { type: "string" },
          items: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: ["type", "title", "items"]
      }
    ]
  };
}

function isResponseBlock(value: unknown): value is AgentResponseBlock {
  if (!value || typeof value !== "object") {
    return false;
  }

  const block = value as Partial<AgentResponseBlock>;
  if (block.type === "summary") {
    return typeof block.title === "string" && typeof block.body === "string";
  }

  if (block.type === "recommendation_group" || block.type === "action_checklist") {
    return typeof block.title === "string" && isStringArray(block.items);
  }

  if (block.type === "draft_message") {
    return (
      typeof block.title === "string" &&
      typeof block.audience === "string" &&
      typeof block.body === "string"
    );
  }

  if (block.type === "meeting_plan") {
    return (
      typeof block.title === "string" &&
      Array.isArray(block.groups) &&
      block.groups.every(
        (group) =>
          group &&
          typeof group === "object" &&
          typeof (group as { label?: unknown }).label === "string" &&
          typeof (group as { recommendation?: unknown }).recommendation === "string" &&
          typeof (group as { rationale?: unknown }).rationale === "string"
      )
    );
  }

  return false;
}

function normalizeEmailDraft(draft: EmailDraft) {
  return {
    ...draft,
    cc: draft.cc?.filter(Boolean),
    bcc: draft.bcc?.filter(Boolean),
    to: draft.to.filter(Boolean)
  };
}

export async function POST(request: Request) {
  let body: AgentRequest;

  try {
    body = await readJsonBody<AgentRequest>(request, 256_000);
  } catch {
    return badRequest("A valid JSON request body is required.");
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured" },
      { status: 500 }
    );
  }

  if (!Array.isArray(body.messages) || !body.messages.length) {
    return NextResponse.json({ error: "messages are required" }, { status: 400 });
  }

  if (
    !isNonEmptyString(body.idToken, 4_096) ||
    body.messages.length > 50 ||
    (body.calendarContext !== undefined && !Array.isArray(body.calendarContext)) ||
    !body.messages.every(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        isNonEmptyString(message.content, 20_000)
    ) ||
    (body.calendarContext?.length ?? 0) > 5_000
  ) {
    return badRequest("Invalid agent request.");
  }

  const ipLimit = checkRateLimit({
    key: `agent:ip:${clientIp(request)}`,
    limit: 30,
    windowMs: 60_000
  });
  if (ipLimit) {
    return ipLimit;
  }

  const decoded = await verifyFirebaseIdToken(body.idToken);
  const userLimit = checkRateLimit({
    key: `agent:user:${decoded.uid}`,
    limit: 60,
    windowMs: 60_000
  });
  if (userLimit) {
    return userLimit;
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
  const actionIntent = await extractActionIntent({
    openai,
    model: agentModel,
    messages: body.messages,
    calendarContext: body.calendarContext ?? [],
    clientContext: body.clientContext ?? {},
    conversationState: body.conversationState
  });
  const { immediateResponse, canReturnEmailDrafts, resolvedDateContext, schedulingResponse } =
    await resolveIntentOrchestration({
      actionIntent,
      openai,
      model: agentModel,
      body: {
        ...body,
        messages: body.messages
      }
    });

  if (immediateResponse) {
    return NextResponse.json(immediateResponse);
  }

  const calendarSummary = (body.calendarContext ?? []).map((event) => ({
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    calendarName: event.calendarName,
    location: event.location,
    description: event.description,
    attendees: event.attendees,
    organizer: event.organizer
  }));
  const uiContext = {
    serverDateTime: new Date().toISOString(),
    calendarView: body.clientContext?.calendarView ?? null,
    viewDate: body.clientContext?.viewDate ?? null,
    visibleRange: body.clientContext?.visibleRange ?? null
  };

  const completion = await openai.chat.completions.create({
    model: agentModel,
    temperature: 0.2,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "calendar_agent_response",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            message: {
              type: "string"
            },
            proposedEmails: {
              anyOf: [
                {
                  type: "array",
                  items: emailDraftSchema()
                },
                { type: "null" }
              ]
            },
            responseBlocks: {
              anyOf: [
                {
                  type: "array",
                  items: responseBlockSchema()
                },
                { type: "null" }
              ]
            }
          },
          required: ["message", "proposedEmails", "responseBlocks"]
        }
      }
    },
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Action intent JSON:\n${JSON.stringify(actionIntent, null, 2)}\nResolved date context JSON:\n${JSON.stringify(resolvedDateContext, null, 2)}\nUI context JSON:\n${JSON.stringify(uiContext, null, 2)}\nCalendar context JSON:\n${JSON.stringify(calendarSummary, null, 2)}`
      },
      ...body.messages.map((message) => ({
        role: message.role,
        content: message.content
      }))
    ]
  });

  const content = completion.choices[0]?.message?.content;

  if (!content) {
    return NextResponse.json<AgentChatResponse>({
      message: "I could not generate a response from the current calendar context."
    });
  }

  const parsed = JSON.parse(content) as ModelResponse;
  const response: AgentChatResponse = {
    message:
      typeof parsed.message === "string"
        ? parsed.message
        : "I could not generate a response from the current calendar context."
  };
  if (Array.isArray(parsed.responseBlocks)) {
    const responseBlocks = parsed.responseBlocks.filter(isResponseBlock);
    if (responseBlocks.length) {
      response.responseBlocks = responseBlocks;
    }
  }

  if (schedulingResponse) {
    response.message = schedulingResponse.message;
    response.proposedEvents = schedulingResponse.proposedEvents;
  }

  if (canReturnEmailDrafts && Array.isArray(parsed.proposedEmails)) {
    const drafts = parsed.proposedEmails.filter(isEmailDraft).map(normalizeEmailDraft);
    if (drafts.length) {
      response.proposedEmails = drafts;
    }
  }

  return NextResponse.json(response);
}
