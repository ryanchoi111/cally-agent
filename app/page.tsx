"use client";

import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  endOfDay,
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subMonths,
  subWeeks,
  subYears
} from "date-fns";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Send,
  Users,
  X
} from "lucide-react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User
} from "firebase/auth";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createCalendarProvider, getFirebaseAuth } from "@/lib/firebase";
import type {
  AgentChatResponse,
  AgentResponseBlock,
  CalendarEvent,
  CalendarEventDeletion,
  CalendarEventEdit,
  CalendarEventDraft,
  CalendarView,
  ChatMessage,
  EmailDraft,
  ScheduleOption
} from "@/lib/types";
import { MarkdownMessage, ResponseBlocks, stripHtml } from "@/app/home/components/agent-message";
import { DaySchedule } from "@/app/home/components/day-schedule";
import { EventChip } from "@/app/home/components/event-chip";
import { EventListItem } from "@/app/home/components/event-list-item";
import {
  askCalendarAgent,
  checkGoogleCalendarConnection,
  createCalendarEvent,
  deleteCalendarEvent,
  editCalendarEvent,
  fetchCalendarEvents,
  startGoogleCalendarConnection,
  syncUserProfile as syncUserProfileRequest
} from "@/app/home/api/client";
import {
  deletionRangeLabel,
  eventOccursOnDay,
  gmailComposeUrl,
  monthDays,
  nextDateForView,
  previousDateForView,
  sortEvents
} from "@/app/home/utils/calendar";
import { useCalendarData } from "@/app/home/hooks/use-calendar-data";

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const chatStorageKey = "cally-agent-calendar-chat";
const calendarViews: CalendarView[] = ["day", "week", "month", "year"];
type PendingEmailDraft = {
  draft: EmailDraft;
  status: "pending" | "opened" | "cancelled";
};

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [hasSyncedUserProfile, setHasSyncedUserProfile] = useState(false);
  const [isCalendarConnected, setIsCalendarConnected] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingEvents, setPendingEvents] = useState<CalendarEventDraft[]>([]);
  const [pendingScheduleOptions, setPendingScheduleOptions] = useState<ScheduleOption[]>([]);
  const [pendingDeletions, setPendingDeletions] = useState<CalendarEventDeletion[]>([]);
  const [pendingEdits, setPendingEdits] = useState<CalendarEventEdit[]>([]);
  const [pendingEmails, setPendingEmails] = useState<PendingEmailDraft[]>([]);
  const [input, setInput] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [activeEventPopoverId, setActiveEventPopoverId] = useState<string | null>(null);
  const [chatWidth, setChatWidth] = useState(380);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isConnectingCalendar, setIsConnectingCalendar] = useState(false);
  const [isCheckingCalendarConnection, setIsCheckingCalendarConnection] = useState(false);
  const [isAskingAgent, setIsAskingAgent] = useState(false);
  const [isStreamingAgent, setIsStreamingAgent] = useState(false);
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);
  const [isDeletingEvent, setIsDeletingEvent] = useState(false);
  const [isEditingEvent, setIsEditingEvent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const calendarPaneRef = useRef<HTMLElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const calendarSessionRef = useRef(0);
  const {
    agentCalendarContext,
    calendarView,
    clearCalendarData,
    events,
    getAgentCalendarContext,
    hasLoadedInitialEvents,
    isLoadingEvents,
    loadEvents,
    months,
    navigateToRange,
    pendingNavigation,
    removeCachedEvent,
    setCalendarView,
    setEvents,
    setHasLoadedInitialEvents,
    setPendingNavigation,
    upsertCachedEvent,
    viewDate,
    viewRange,
    viewTitle,
    visibleDays
  } = useCalendarData({
    user,
    isCalendarConnected,
    onError: setError
  });
  const resetCalendarData = useCallback(() => {
    calendarSessionRef.current += 1;
    clearCalendarData();
  }, [clearCalendarData]);

  function handleResizeChat(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = chatWidth;
    const viewportWidth = window.innerWidth;
    const minWidth = 320;
    const maxWidth = Math.floor(viewportWidth * 0.5);
    const target = event.currentTarget;

    target.setPointerCapture(pointerId);

    function handlePointerMove(moveEvent: PointerEvent) {
      const nextWidth = Math.min(
        maxWidth,
        Math.max(minWidth, startWidth + startX - moveEvent.clientX)
      );
      setChatWidth(nextWidth);
    }

    function handlePointerUp() {
      target.releasePointerCapture(pointerId);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }

  function goToPreviousRange() {
    navigateToRange(calendarView, previousDateForView(calendarView, viewDate));
  }

  function goToNextRange() {
    navigateToRange(calendarView, nextDateForView(calendarView, viewDate));
  }

  const syncUserProfile = useCallback(async (currentUser: User) => {
    const idToken = await currentUser.getIdToken();
    await syncUserProfileRequest({
      idToken,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: navigator.language
    });
  }, []);

  const startCalendarConnection = useCallback(async (currentUser: User) => {
    setIsConnectingCalendar(true);
    setError(null);

    try {
      const idToken = await currentUser.getIdToken();
      const authUrl = await startGoogleCalendarConnection(idToken);
      window.location.assign(authUrl);
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Unable to start Google Calendar connection."
      );
      setIsConnectingCalendar(false);
    }
  }, []);

  const checkCalendarConnection = useCallback(async (currentUser: User | null = user) => {
    if (!currentUser) {
      return;
    }

    setIsCheckingCalendarConnection(true);
    const calendarSession = calendarSessionRef.current;
    try {
      const idToken = await currentUser.getIdToken();
      const isConnected = await checkGoogleCalendarConnection(idToken);
      if (calendarSession !== calendarSessionRef.current) {
        return;
      }
      setIsCalendarConnected(isConnected);
      if (!isConnected) {
        await startCalendarConnection(currentUser);
      }
    } catch {
      if (calendarSession === calendarSessionRef.current) {
        setIsCalendarConnected(false);
      }
    } finally {
      if (calendarSession === calendarSessionRef.current) {
        setIsCheckingCalendarConnection(false);
      }
    }
  }, [startCalendarConnection, user]);

  useEffect(() => {
    try {
      return onAuthStateChanged(getFirebaseAuth(), (currentUser) => {
        setUser(currentUser);
        setHasSyncedUserProfile(false);
        setIsCalendarConnected(false);
        resetCalendarData();
        const calendarSession = calendarSessionRef.current;
        if (!currentUser) {
          setPendingScheduleOptions([]);
          setPendingDeletions([]);
          setPendingEdits([]);
          return;
        }

        void syncUserProfile(currentUser)
          .then(() => {
            if (calendarSession !== calendarSessionRef.current) {
              return;
            }

            setCalendarView("month");
            setHasSyncedUserProfile(true);
          })
          .catch((profileError) => {
            if (calendarSession !== calendarSessionRef.current) {
              return;
            }

            setError(
              profileError instanceof Error
                ? profileError.message
                : "Unable to sync user profile."
            );
            setHasSyncedUserProfile(true);
          })
          .finally(() => {
            if (calendarSession !== calendarSessionRef.current) {
              return;
            }

            void checkCalendarConnection(currentUser);
          });
      });
    } catch (authError) {
      setError(
        authError instanceof Error
          ? authError.message
          : "Firebase authentication is not configured."
      );
      return undefined;
    }
  }, [checkCalendarConnection, resetCalendarData, syncUserProfile]);

  useEffect(() => {
    const stored = sessionStorage.getItem(chatStorageKey);
    if (stored) {
      setMessages(JSON.parse(stored) as ChatMessage[]);
    }
  }, []);

  useEffect(() => {
    sessionStorage.setItem(chatStorageKey, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    const messageList = messageListRef.current;

    if (!messageList) {
      return;
    }

    messageList.scrollTo({
      top: messageList.scrollHeight,
      behavior: "smooth"
    });
  }, [
    isAskingAgent,
    messages,
    pendingDeletions,
    pendingEdits,
    pendingEmails,
    pendingEvents,
    pendingScheduleOptions
  ]);

  async function handleSignIn() {
    setIsSigningIn(true);
    setError(null);

    try {
      const result = await signInWithPopup(getFirebaseAuth(), createCalendarProvider());
      setUser(result.user);
      setHasSyncedUserProfile(false);
      resetCalendarData();
      setPendingEvents([]);
      setPendingScheduleOptions([]);
      setPendingDeletions([]);
      setPendingEdits([]);
      await syncUserProfile(result.user);
      setCalendarView("month");
      setHasSyncedUserProfile(true);
      await checkCalendarConnection(result.user);
    } catch (signInError) {
      setError(
        signInError instanceof Error ? signInError.message : "Unable to sign in."
      );
    } finally {
      setIsSigningIn(false);
    }
  }

  async function handleSignOut() {
    await signOut(getFirebaseAuth());
    setMessages([]);
    setPendingEvents([]);
    setPendingScheduleOptions([]);
    setPendingDeletions([]);
    setPendingEdits([]);
    setPendingEmails([]);
    setIsCalendarConnected(false);
    setHasSyncedUserProfile(false);
    resetCalendarData();
    sessionStorage.removeItem(chatStorageKey);
  }

  async function handleConnectCalendar() {
    if (!user || isConnectingCalendar) {
      return;
    }

    await startCalendarConnection(user);
  }

  useEffect(() => {
    if (!isCalendarConnected || hasLoadedInitialEvents) {
      return;
    }

    void loadEvents({ targetDate: viewDate, targetView: calendarView });
  }, [calendarView, hasLoadedInitialEvents, isCalendarConnected, loadEvents, viewDate]);

  async function streamAssistantMessage(
    baseMessages: ChatMessage[],
    content: string,
    responseBlocks?: AgentResponseBlock[]
  ) {
    const assistantIndex = baseMessages.length;
    const nextMessages: ChatMessage[] = [
      ...baseMessages,
      { role: "assistant", content: "" }
    ];
    const chunkSize = content.length > 1200 ? 5 : content.length > 600 ? 4 : 3;
    const delayMs = 14;

    setMessages(nextMessages);
    setIsAskingAgent(false);
    setIsStreamingAgent(true);

    try {
      for (let visibleLength = chunkSize; visibleLength < content.length; visibleLength += chunkSize) {
        await new Promise((resolve) => {
          window.setTimeout(resolve, delayMs);
        });

        setMessages((currentMessages) => {
          const updatedMessages = [...currentMessages];
          updatedMessages[assistantIndex] = {
            role: "assistant",
            content: content.slice(0, visibleLength)
          };
          return updatedMessages;
        });
      }

      setMessages((currentMessages) => {
        const updatedMessages = [...currentMessages];
        updatedMessages[assistantIndex] = {
          role: "assistant",
          content,
          responseBlocks
        };
        return updatedMessages;
      });
    } finally {
      setIsStreamingAgent(false);
    }
  }

  async function openPendingEmailDrafts(baseMessages: ChatMessage[], drafts: PendingEmailDraft[]) {
    const openedDrafts: PendingEmailDraft[] = [];
    const openedCount = drafts.reduce((count, pendingDraft, draftIndex) => {
      const openedWindow = window.open(gmailComposeUrl(pendingDraft.draft), "_blank");
      if (openedWindow) {
        openedWindow.opener = null;
        openedDrafts.push(drafts[draftIndex]);
        return count + 1;
      }

      return count;
    }, 0);
    const message =
      openedCount === drafts.length
        ? `Opened ${openedCount} email draft${openedCount === 1 ? "" : "s"} in Gmail. Review each one there before sending.`
        : `Opened ${openedCount} of ${drafts.length} email drafts in Gmail. Use the draft cards below for any that did not open.`;

    await streamAssistantMessage(baseMessages, message);

    setPendingEmails((currentDrafts) =>
      currentDrafts.map((pendingDraft) =>
        openedDrafts.includes(pendingDraft) ? { ...pendingDraft, status: "opened" } : pendingDraft
      )
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = input.trim();
    if (!content || isAskingAgent || isStreamingAgent) {
      return;
    }

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setInput("");
    setIsAskingAgent(true);
    setError(null);

    const activeEmailDrafts = pendingEmails.filter(
      (pendingDraft) => pendingDraft.status === "pending"
    );

    try {
      const idToken = await user?.getIdToken();
      if (!idToken) {
        throw new Error("Sign in again to use Cally.");
      }

      const currentAgentContext = getAgentCalendarContext();
      const body = await askCalendarAgent({
        idToken,
        messages: nextMessages,
        calendarContext: currentAgentContext.length
          ? currentAgentContext
          : agentCalendarContext,
        clientContext: {
          calendarView,
          localDate: format(new Date(), "yyyy-MM-dd"),
          localDateTime: new Date().toString(),
          localWeekday: format(new Date(), "EEEE"),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          viewDate: format(viewDate, "yyyy-MM-dd"),
          visibleRange: viewRange
        },
        conversationState: {
          scheduleOptions: pendingScheduleOptions,
          pendingEvents,
          pendingDeletions,
          pendingEdits,
          pendingEmailDraftCount: activeEmailDrafts.length
        }
      });
      if (body.confirmedPendingAction) {
        if (body.confirmedPendingAction === "create_events") {
          await handleCreateEvent();
          return;
        }

        if (body.confirmedPendingAction === "delete_events") {
          await handleDeleteEvents();
          return;
        }

        if (body.confirmedPendingAction === "edit_events") {
          await handleEditEvents();
          return;
        }

        if (body.confirmedPendingAction === "open_email_drafts") {
          await openPendingEmailDrafts(nextMessages, activeEmailDrafts);
          return;
        }
      }

      await streamAssistantMessage(nextMessages, body.message, body.responseBlocks);
      setPendingEvents(body.proposedEvents ?? []);
      setPendingDeletions(body.proposedDeletions ?? []);
      setPendingEdits(body.proposedEdits ?? []);
      setPendingScheduleOptions(
        body.conversationState?.scheduleOptions ?? body.scheduleOptions ?? []
      );
      setPendingEmails(
        (body.proposedEmails ?? []).map((draft) => ({ draft, status: "pending" }))
      );
    } catch (agentError) {
      setError(
        agentError instanceof Error
          ? agentError.message
          : "Unable to contact the calendar agent."
      );
      setMessages(nextMessages);
      setIsAskingAgent(false);
    } finally {
      setIsAskingAgent(false);
    }
  }

  function handleChatInputKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  async function handleCreateEvent() {
    if (!user || !pendingEvents.length || isCreatingEvent) {
      return;
    }

    setIsCreatingEvent(true);
    setError(null);

    try {
      const idToken = await user.getIdToken();
      const createdEvents: CalendarEvent[] = [];

      for (const eventDraft of pendingEvents) {
        const event = await createCalendarEvent({ idToken, event: eventDraft });
        createdEvents.push(event);
        upsertCachedEvent(event);
      }

      setEvents((currentEvents) =>
        [...currentEvents, ...createdEvents].sort(
          (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
        )
      );
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "assistant",
          content:
            createdEvents.length === 1
              ? `Created "${createdEvents[0].title}" on your primary Google Calendar.`
              : `Created ${createdEvents.length} events on your primary Google Calendar.`
        }
      ]);
      setPendingEvents([]);
      setPendingScheduleOptions([]);
      void loadEvents({ targetDate: viewDate, targetView: calendarView });
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Unable to create calendar event."
      );
    } finally {
      setIsCreatingEvent(false);
    }
  }

  async function handleDeleteEvents() {
    if (!user || !pendingDeletions.length || isDeletingEvent) {
      return;
    }

    setIsDeletingEvent(true);
    setError(null);

    try {
      const idToken = await user.getIdToken();
      const deletedIds: string[] = [];

      for (const pendingDeletion of pendingDeletions) {
        await deleteCalendarEvent({
          idToken,
          eventId: pendingDeletion.id
        });
        deletedIds.push(pendingDeletion.id);
        removeCachedEvent(pendingDeletion.id);
      }

      setEvents((currentEvents) =>
        currentEvents.filter((calendarEvent) => !deletedIds.includes(calendarEvent.id))
      );
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "assistant",
          content:
            deletedIds.length === 1
              ? `Deleted "${pendingDeletions[0].title}" from your calendar.`
              : `Deleted ${deletedIds.length} events from your calendar.`
        }
      ]);
      setPendingDeletions([]);
      void loadEvents({ force: true, targetDate: viewDate, targetView: calendarView });
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Unable to delete calendar event."
      );
    } finally {
      setIsDeletingEvent(false);
    }
  }

  async function handleEditEvents() {
    if (!user || !pendingEdits.length || isEditingEvent) {
      return;
    }

    setIsEditingEvent(true);
    setError(null);

    try {
      const idToken = await user.getIdToken();
      const editedEvents: CalendarEvent[] = [];

      for (const pendingEdit of pendingEdits) {
        const event = await editCalendarEvent({
          idToken,
          eventId: pendingEdit.id,
          updates: pendingEdit.updates
        });
        editedEvents.push(event);
        upsertCachedEvent(event);
      }

      setEvents((currentEvents) => {
        const editedById = new Map(editedEvents.map((calendarEvent) => [calendarEvent.id, calendarEvent]));
        return currentEvents
          .map((calendarEvent) => editedById.get(calendarEvent.id) ?? calendarEvent)
          .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
      });
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "assistant",
          content:
            editedEvents.length === 1
              ? `Updated "${editedEvents[0].title}" on your calendar.`
              : `Updated ${editedEvents.length} events on your calendar.`
        }
      ]);
      setPendingEdits([]);
      void loadEvents({ force: true, targetDate: viewDate, targetView: calendarView });
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : "Unable to edit calendar event.");
    } finally {
      setIsEditingEvent(false);
    }
  }

  function createEventButtonLabel() {
    if (isCreatingEvent) {
      return "Creating...";
    }

    return pendingEvents.length > 1 ? "Create all" : "Create";
  }

  function deleteEventButtonLabel() {
    if (isDeletingEvent) {
      return "Deleting...";
    }

    return pendingDeletions.length > 1 ? "Delete all" : "Delete";
  }

  function editEventButtonLabel() {
    if (isEditingEvent) {
      return "Updating...";
    }

    return pendingEdits.length > 1 ? "Update all" : "Update";
  }

  function handleOpenEmailDraft(draft: EmailDraft, index: number) {
    const openedWindow = window.open(gmailComposeUrl(draft), "_blank");
    if (openedWindow) {
      openedWindow.opener = null;
    }
    setPendingEmails((currentDrafts) =>
      currentDrafts.map((pendingDraft, draftIndex) =>
        draftIndex === index ? { ...pendingDraft, status: "opened" } : pendingDraft
      )
    );
  }

  const calendars = Array.from(
    new Map(
      (agentCalendarContext.length ? agentCalendarContext : events).map((event) => [
        event.calendarName,
        event
      ])
    ).values()
  );
  const days = monthDays(viewDate);
  const isCalendarNavigationBlocked = isLoadingEvents || Boolean(pendingNavigation);
  const showCalendarBootScreen =
    Boolean(user) &&
    !hasLoadedInitialEvents &&
    (!hasSyncedUserProfile ||
      isCheckingCalendarConnection ||
      isCalendarConnected ||
      isLoadingEvents ||
      Boolean(pendingNavigation));
  const showCalendarOverlay = !showCalendarBootScreen && Boolean(pendingNavigation);
  const calendarOverlayTitle = pendingNavigation?.error
    ? hasLoadedInitialEvents
      ? "Couldn't sync events"
      : "Could not load your calendar"
    : pendingNavigation
      ? `Syncing ${pendingNavigation.title}`
      : "Syncing your calendar";
  const calendarOverlayDetail = pendingNavigation?.error
    ? hasLoadedInitialEvents
      ? `${pendingNavigation.title} didn't load.`
      : pendingNavigation.error
    : "Getting your Google Calendar events...";

  function handleRetryCalendarLoad() {
    void loadEvents({
      force: true,
      targetDate: pendingNavigation?.date ?? viewDate,
      targetView: pendingNavigation?.view ?? calendarView
    });
  }

  function handleStayOnCurrentCalendar() {
    setPendingNavigation(null);
    setError(null);
  }

  if (!user) {
    return (
      <main className="sign-in-screen">
        <div className="signin-aurora" aria-hidden="true" />
        <div className="signin-month-backdrop" aria-hidden="true">
          <div className="signin-month-header">
            <span>Sun</span>
            <span>Mon</span>
            <span>Tue</span>
            <span>Wed</span>
            <span>Thu</span>
            <span>Fri</span>
            <span>Sat</span>
          </div>
          <div className="signin-month-grid">
            {Array.from({ length: 42 }, (_, index) => (
              <div className="signin-month-day" key={index}>
                <span className="signin-month-date">{index + 1 <= 31 ? index + 1 : index - 30}</span>
                {[5, 10, 15, 24, 32].includes(index) ? (
                  <span className="signin-month-event" />
                ) : null}
                {[12, 20].includes(index) ? (
                  <span className="signin-month-event secondary" />
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <section className="sign-in-box">
          <div className="signin-title-lockup">
            <div className="signin-calendar-stage" aria-hidden="true">
              <div className="floating-calendar">
                <div className="floating-calendar-header">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="floating-calendar-grid">
                  {Array.from({ length: 35 }, (_, index) => (
                    <span
                      className={[
                        index === 8 || index === 16 || index === 23 ? "has-event" : "",
                        index === 11 ? "is-today" : ""
                      ].join(" ")}
                      key={index}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="signin-title">Cally</div>
          </div>

          <div className="signin-glass-card">
            <div className="signin-prompt">Sign in with Google below</div>
            <button
              className="primary-button glass-button"
              onClick={handleSignIn}
              disabled={isSigningIn}
            >
              <CalendarDays size={18} />
              {isSigningIn ? "Opening Google..." : "Sign in with Google"}
            </button>
            {error ? <div className="error glass-error">{error}</div> : null}
          </div>
        </section>
      </main>
    );
  }

  if (showCalendarBootScreen) {
    return (
      <main className="calendar-boot-screen">
        <div
          aria-busy={!pendingNavigation?.error}
          aria-live="polite"
          className="calendar-loading-panel"
          role="status"
        >
          {!pendingNavigation?.error ? (
            <RefreshCw className="calendar-loading-spinner" size={22} />
          ) : null}
          <div className="calendar-loading-title">{calendarOverlayTitle}</div>
          <div className="calendar-loading-detail">{calendarOverlayDetail}</div>
          {pendingNavigation?.error ? (
            <div className="calendar-loading-actions">
              <button
                className="primary-button"
                disabled={isLoadingEvents}
                onClick={handleRetryCalendarLoad}
                type="button"
              >
                <RefreshCw size={16} />
                Retry
              </button>
            </div>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main
      className={[
        "app-shell",
        isSidebarOpen ? "" : "sidebar-closed",
        isChatOpen ? "" : "chat-closed"
      ].join(" ")}
      style={{ "--chat-width": `${chatWidth}px` } as React.CSSProperties}
    >
      {isSidebarOpen ? (
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand">Cally</div>
        </div>

        <div className="user-strip">
          <div
            aria-hidden="true"
            className="avatar"
            style={user.photoURL ? { backgroundImage: `url(${user.photoURL})` } : undefined}
          />
          <div>
            <div className="user-name">{user.displayName ?? "Google user"}</div>
            <div className="user-email">{user.email}</div>
          </div>
        </div>

        <div className="section-title">{format(viewDate, "MMMM yyyy")}</div>
        <div className="mini-calendar">
          {weekdayLabels.map((label) => (
            <div className="mini-day-name" key={label}>
              {label[0]}
            </div>
          ))}
          {days.map((day) => (
            <div
              className={[
                "mini-day",
                !isSameMonth(day, viewDate) ? "is-outside" : "",
                isToday(day) ? "is-current" : ""
              ].join(" ")}
              key={day.toISOString()}
            >
              {format(day, "d")}
            </div>
          ))}
        </div>

        <div className="section-title">Calendars</div>
        <div className="calendar-list">
          {calendars.length ? (
            calendars.map((calendar) => (
              <div className="calendar-list-item" key={calendar.calendarName}>
                <span className="color-dot" style={{ backgroundColor: calendar.color }} />
                <span>{calendar.calendarName}</span>
              </div>
            ))
          ) : user && !isCalendarConnected ? (
            <div className="calendar-reconnect">
              <div className="muted">
                {isConnectingCalendar
                  ? "Opening Google Calendar authorization..."
                  : "Calendar authorization is required."}
              </div>
              <button
                className="text-button"
                disabled={isConnectingCalendar}
                onClick={handleConnectCalendar}
                type="button"
              >
                <CalendarDays size={16} />
                {isConnectingCalendar ? "Opening..." : "Authorize now"}
              </button>
            </div>
          ) : (
            <div className="muted">No visible calendars loaded.</div>
          )}
        </div>
        <button className="text-button logout-button" onClick={handleSignOut} type="button">
          Logout
        </button>
      </aside>
      ) : null}

      <section className="main" ref={calendarPaneRef}>
        <header className="calendar-header">
          <div className="calendar-title-row">
            <button
              aria-label={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
              className="icon-button"
              onClick={() => setIsSidebarOpen((open) => !open)}
              type="button"
            >
              {isSidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
            </button>
            <div>
              <div className="month-title">{viewTitle}</div>
            </div>
          </div>
          <div className="header-actions">
            <div className="view-switcher" aria-label="Calendar view">
              {calendarViews.map((view) => (
                <button
                  className={calendarView === view ? "is-active" : ""}
                  disabled={isCalendarNavigationBlocked}
                  key={view}
                  onClick={() => navigateToRange(view, viewDate)}
                  type="button"
                >
                  {view}
                </button>
              ))}
            </div>
            <button
              className="text-button"
              disabled={isCalendarNavigationBlocked}
              onClick={() => navigateToRange(calendarView, new Date())}
              type="button"
            >
              Today
            </button>
            <button
              aria-label="Previous range"
              className="icon-button"
              disabled={isCalendarNavigationBlocked}
              onClick={goToPreviousRange}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              aria-label="Next range"
              className="icon-button"
              disabled={isCalendarNavigationBlocked}
              onClick={goToNextRange}
            >
              <ChevronRight size={18} />
            </button>
            <button
              aria-label="Refresh events"
              className="icon-button"
              onClick={() =>
                loadEvents({ force: true, targetDate: viewDate, targetView: calendarView })
              }
              disabled={isCalendarNavigationBlocked}
            >
              <RefreshCw size={17} />
            </button>
            <button
              aria-label={isChatOpen ? "Hide calendar agent" : "Show calendar agent"}
              className="icon-button"
              onClick={() => setIsChatOpen((open) => !open)}
              type="button"
            >
              {isChatOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
            </button>
          </div>
        </header>

        <div className="calendar-content">
        {calendarView === "month" ? (
          <div className="calendar-grid">
            {weekdayLabels.map((label) => (
              <div className="day-name" key={label}>
                {label}
              </div>
            ))}
            {days.map((day) => {
              const dayEvents = events.filter((calendarEvent) =>
                eventOccursOnDay(calendarEvent, day)
              );

              return (
                <div
                  className={[
                    "day-cell",
                    !isSameMonth(day, viewDate) ? "is-outside" : "",
                    isToday(day) ? "is-today" : ""
                  ].join(" ")}
                  key={day.toISOString()}
                >
                  <div className="day-number">{format(day, "d")}</div>
                  <div className="event-stack">
                    {dayEvents.slice(0, 4).map((calendarEvent) => (
                      <EventChip
                        boundaryRef={calendarPaneRef}
                        event={calendarEvent}
                        isActive={activeEventPopoverId === calendarEvent.id}
                        key={`${calendarEvent.id}-${day.toISOString()}`}
                        onActivate={() => setActiveEventPopoverId(calendarEvent.id)}
                        onDeactivate={() =>
                          setActiveEventPopoverId((currentId) =>
                            currentId === calendarEvent.id ? null : currentId
                          )
                        }
                      />
                    ))}
                    {dayEvents.length > 4 ? (
                      <div className="event-time">+{dayEvents.length - 4} more</div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {calendarView === "day" ? (
          <DaySchedule date={viewDate} events={events} />
        ) : null}

        {calendarView === "week" ? (
          <div className="agenda-view week">
            {visibleDays.map((day) => {
              const dayEvents = events.filter((calendarEvent) =>
                eventOccursOnDay(calendarEvent, day)
              );

              return (
                <section
                  className={`agenda-day ${isToday(day) ? "is-today" : ""}`}
                  key={day.toISOString()}
                >
                  <header className="agenda-day-header">
                    <div>
                      <div className="agenda-day-name">{format(day, "EEEE")}</div>
                      <div className="agenda-day-date">{format(day, "MMM d")}</div>
                    </div>
                    <div className="agenda-count">{dayEvents.length}</div>
                  </header>
                  <div className="agenda-events">
                    {dayEvents.length ? (
                      dayEvents.map((calendarEvent) => (
                        <EventListItem event={calendarEvent} key={calendarEvent.id} />
                      ))
                    ) : (
                      <div className="empty-day">No events</div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}

        {calendarView === "year" ? (
          <div className="year-view">
            {months.map((month) => {
              const monthEvents = events.filter((calendarEvent) =>
                isSameMonth(parseISO(calendarEvent.start), month)
              );
              const monthGridDays = monthDays(month);

              return (
                <section className="year-month" key={month.toISOString()}>
                  <header className="year-month-header">
                    <span>{format(month, "MMMM")}</span>
                    <span>
                      {monthEvents.length} events ·{" "}
                      {
                        monthGridDays.filter((day) => {
                          return (
                            isSameMonth(day, month) &&
                            events.some((calendarEvent) => eventOccursOnDay(calendarEvent, day))
                          );
                        }).length
                      }{" "}
                      busy days
                    </span>
                  </header>
                  <div className="year-month-grid">
                    {weekdayLabels.map((label) => (
                      <div className="year-weekday" key={label}>
                        {label[0]}
                      </div>
                    ))}
                    {monthGridDays.map((day) => {
                      const dayEventCount = events.filter((calendarEvent) =>
                        eventOccursOnDay(calendarEvent, day)
                      ).length;
                      const busyLevel = Math.min(4, dayEventCount);
                      const isOutsideMonth = !isSameMonth(day, month);

                      const label = `${format(day, "MMMM d")}${
                        dayEventCount
                          ? `, ${dayEventCount} event${dayEventCount === 1 ? "" : "s"}`
                          : ", no events"
                      }`;

                      return (
                        <button
                          aria-label={label}
                          disabled={isCalendarNavigationBlocked}
                          className={[
                            "year-day",
                            isOutsideMonth ? "is-outside" : "",
                            isToday(day) ? "is-today" : "",
                            dayEventCount ? "has-events" : "",
                            `busy-${busyLevel}`
                          ].join(" ")}
                          key={day.toISOString()}
                          onClick={() => {
                            navigateToRange("day", day);
                          }}
                          title={label}
                          type="button"
                        >
                          {format(day, "d")}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}

        {showCalendarOverlay ? (
          <div
            aria-busy={!pendingNavigation?.error}
            aria-live="polite"
            className="calendar-loading-overlay"
            role="status"
          >
            <div className="calendar-loading-panel">
              {!pendingNavigation?.error ? (
                <RefreshCw className="calendar-loading-spinner" size={22} />
              ) : null}
              <div className="calendar-loading-title">{calendarOverlayTitle}</div>
              <div className="calendar-loading-detail">{calendarOverlayDetail}</div>
              {pendingNavigation?.error ? (
                <div className="calendar-loading-actions">
                  <button
                    className="primary-button"
                    disabled={isLoadingEvents}
                    onClick={handleRetryCalendarLoad}
                    type="button"
                  >
                    <RefreshCw size={16} />
                    Retry
                  </button>
                  {hasLoadedInitialEvents ? (
                    <button
                      className="text-button"
                      disabled={isLoadingEvents}
                      onClick={handleStayOnCurrentCalendar}
                      type="button"
                    >
                      Stay on current calendar
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        </div>
      </section>

      {isChatOpen ? (
      <aside className="chat-panel">
        <button
          aria-label="Resize calendar agent"
          className="chat-resize-handle"
          onPointerDown={handleResizeChat}
          type="button"
        />
        <header className="chat-header">
          <div>
            <div className="chat-title">Cally</div>
            <div className="muted">Your Calendar Assistant</div>
          </div>
          {/* <button
            aria-label="Hide calendar agent"
            className="icon-button"
            onClick={() => setIsChatOpen(false)}
            type="button"
          >
            <PanelRightClose size={18} />
          </button> */}
        </header>

        <div className="message-list" ref={messageListRef}>
          {messages.length ? (
            messages.map((message, index) => (
              <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
                {message.role === "assistant" ? (
                  <>
                    <MarkdownMessage content={message.content} />
                    {message.responseBlocks?.length ? (
                      <ResponseBlocks blocks={message.responseBlocks} />
                    ) : null}
                  </>
                ) : (
                  message.content
                )}
              </div>
            ))
          ) : (
            <div className="message assistant">
              Hi, I&apos;m Cally, your calendar assistant who can optimize your calendar!
              Ask me about conflicts, meeting load, open focus time, or say something
              like &quot;schedule a planning block tomorrow at 2 PM for 45 minutes.&quot;
            </div>
          )}
          {pendingEvents.map((pendingEvent, eventIndex) => (
            <div className="proposal-card" key={`${pendingEvent.title}-${pendingEvent.start}`}>
              <div className="proposal-kicker">
                Proposed event{" "}
                {pendingEvents.length > 1 ? `${eventIndex + 1} of ${pendingEvents.length}` : ""}
              </div>
              <div className="proposal-title">{pendingEvent.title}</div>
              <div className="proposal-detail">
                {pendingEvent.allDay
                  ? `${pendingEvent.start} - ${pendingEvent.end}`
                  : `${format(parseISO(pendingEvent.start), "MMM d, h:mm a")} - ${format(
                      parseISO(pendingEvent.end),
                      "h:mm a"
                    )}`}
              </div>
              {pendingEvent.attendees?.length ? (
                <div className="proposal-detail">
                  Invite: {pendingEvent.attendees.join(", ")}
                </div>
              ) : null}
              {pendingEvent.location ? (
                <div className="proposal-detail">{pendingEvent.location}</div>
              ) : null}
              {pendingEvent.description ? (
                <div className="proposal-description">{pendingEvent.description}</div>
              ) : null}
              <div className="proposal-actions">
                <button
                  className="primary-button"
                  disabled={isCreatingEvent}
                  onClick={handleCreateEvent}
                  type="button"
                >
                  <Check size={16} />
                  {createEventButtonLabel()}
                </button>
                <button
                  className="text-button"
                  disabled={isCreatingEvent}
                  onClick={() => {
                    setPendingEvents([]);
                    setPendingScheduleOptions([]);
                  }}
                  type="button"
                >
                  <X size={16} />
                  Cancel
                </button>
              </div>
            </div>
          ))}
          {pendingDeletions.map((pendingDeletion, deletionIndex) => (
            <div className="proposal-card" key={`${pendingDeletion.id}-${deletionIndex}`}>
              <div className="proposal-kicker">
                Delete event{" "}
                {pendingDeletions.length > 1 ? `${deletionIndex + 1} of ${pendingDeletions.length}` : ""}
              </div>
              <div className="proposal-title">{pendingDeletion.title}</div>
              <div className="proposal-detail">{deletionRangeLabel(pendingDeletion)}</div>
              <div className="proposal-detail">{pendingDeletion.calendarName}</div>
              <div className="proposal-actions">
                <button
                  className="primary-button"
                  disabled={isDeletingEvent}
                  onClick={handleDeleteEvents}
                  type="button"
                >
                  <X size={16} />
                  {deleteEventButtonLabel()}
                </button>
                <button
                  className="text-button"
                  disabled={isDeletingEvent}
                  onClick={() => setPendingDeletions([])}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          ))}
          {pendingEdits.map((pendingEdit, editIndex) => (
            <div className="proposal-card" key={`${pendingEdit.id}-${editIndex}`}>
              <div className="proposal-kicker">
                Edit event{" "}
                {pendingEdits.length > 1 ? `${editIndex + 1} of ${pendingEdits.length}` : ""}
              </div>
              <div className="proposal-title">{pendingEdit.title}</div>
              <div className="proposal-detail">Current: {deletionRangeLabel(pendingEdit)}</div>
              {pendingEdit.updates.title ? (
                <div className="proposal-detail">New title: {pendingEdit.updates.title}</div>
              ) : null}
              {pendingEdit.updates.start && pendingEdit.updates.end ? (
                <div className="proposal-detail">
                  New time:{" "}
                  {deletionRangeLabel({
                    ...pendingEdit,
                    start: pendingEdit.updates.start,
                    end: pendingEdit.updates.end,
                    allDay: Boolean(pendingEdit.updates.allDay)
                  })}
                </div>
              ) : null}
              <div className="proposal-actions">
                <button
                  className="primary-button"
                  disabled={isEditingEvent}
                  onClick={handleEditEvents}
                  type="button"
                >
                  <Check size={16} />
                  {editEventButtonLabel()}
                </button>
                <button
                  className="text-button"
                  disabled={isEditingEvent}
                  onClick={() => setPendingEdits([])}
                  type="button"
                >
                  <X size={16} />
                  Cancel
                </button>
              </div>
            </div>
          ))}
          {pendingEmails.map((pendingEmailDraft, draftIndex) => (
            <div
              className={`proposal-card ${pendingEmailDraft.status !== "pending" ? "is-resolved" : ""}`}
              key={`${pendingEmailDraft.draft.subject}-${draftIndex}`}
            >
              <div className="proposal-kicker">
                Email draft{" "}
                {pendingEmails.length > 1
                  ? `${draftIndex + 1} of ${pendingEmails.length}`
                  : ""}
                {pendingEmailDraft.status !== "pending"
                  ? ` · ${pendingEmailDraft.status}`
                  : ""}
              </div>
              <div className="proposal-title">{pendingEmailDraft.draft.subject}</div>
              {pendingEmailDraft.draft.to.length ? (
                <div className="proposal-detail">
                  To: {pendingEmailDraft.draft.to.join(", ")}
                </div>
              ) : (
                <div className="proposal-detail">Add recipients in Gmail before sending.</div>
              )}
              {pendingEmailDraft.draft.cc?.length ? (
                <div className="proposal-detail">
                  Cc: {pendingEmailDraft.draft.cc.join(", ")}
                </div>
              ) : null}
              <div className="proposal-description">{pendingEmailDraft.draft.body}</div>
              <div className="proposal-actions">
                <button
                  className="primary-button"
                  disabled={pendingEmailDraft.status !== "pending"}
                  onClick={() => handleOpenEmailDraft(pendingEmailDraft.draft, draftIndex)}
                  type="button"
                >
                  <ExternalLink size={16} />
                  {pendingEmailDraft.status === "opened" ? "Opened" : "Open draft"}
                </button>
                <button
                  className="text-button"
                  disabled={pendingEmailDraft.status !== "pending"}
                  onClick={() =>
                    setPendingEmails((currentDrafts) =>
                      currentDrafts.map((currentDraft, currentIndex) =>
                        currentIndex === draftIndex
                          ? { ...currentDraft, status: "cancelled" }
                          : currentDraft
                      )
                    )
                  }
                  type="button"
                >
                  <X size={16} />
                  Cancel
                </button>
              </div>
            </div>
          ))}
          {isAskingAgent ? (
            <div className="message assistant thinking-message">Thinking</div>
          ) : null}
        </div>

        <form className="chat-form" onSubmit={handleSubmit}>
          <textarea
            className="chat-input"
            onKeyDown={handleChatInputKeyDown}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask about your calendar..."
            value={input}
          />
          <div className="status-row">
            <span>{error}</span>
            <button
              className="primary-button"
              disabled={isAskingAgent || isStreamingAgent || !input.trim()}
            >
              <Send size={16} />
              Send
            </button>
          </div>
        </form>
      </aside>
      ) : null}
    </main>
  );
}
