"use client";

import { addDays, startOfWeek } from "date-fns";
import { useCallback, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { CalendarEvent, CalendarView } from "@/lib/types";
import { fetchCalendarEvents } from "@/app/home/api/client";
import {
  calendarRangeForView,
  calendarTitleForView,
  calendarYearRange,
  eventIntersectsRange,
  filterEventsForRange,
  monthDays,
  sortEvents,
  yearMonths,
  type CalendarRange
} from "@/app/home/utils/calendar";

type CachedEventRange = {
  start: number;
  end: number;
};

export type PendingNavigation = {
  date: Date;
  error?: string;
  title: string;
  view: CalendarView;
};

export function useCalendarData({
  user,
  isCalendarConnected,
  onError
}: {
  user: User | null;
  isCalendarConnected: boolean;
  onError: (message: string) => void;
}) {
  const [viewDate, setViewDate] = useState(() => new Date());
  const [calendarView, setCalendarView] = useState<CalendarView>("month");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [agentCalendarContext, setAgentCalendarContext] = useState<CalendarEvent[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [hasLoadedInitialEvents, setHasLoadedInitialEvents] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const eventCacheRef = useRef<Map<string, CalendarEvent>>(new Map());
  const cachedRangesRef = useRef<CachedEventRange[]>([]);
  const calendarSessionRef = useRef(0);

  const clearCalendarData = useCallback(() => {
    calendarSessionRef.current += 1;
    setEvents([]);
    setAgentCalendarContext([]);
    setHasLoadedInitialEvents(false);
    setIsLoadingEvents(false);
    setPendingNavigation(null);
    eventCacheRef.current.clear();
    cachedRangesRef.current = [];
  }, []);

  const updateAgentCalendarContext = useCallback(() => {
    setAgentCalendarContext(sortEvents(Array.from(eventCacheRef.current.values())));
  }, []);

  const getAgentCalendarContext = useCallback(() => {
    return sortEvents(Array.from(eventCacheRef.current.values()));
  }, []);

  const getCachedEventsForRange = useCallback((rangeStart: string, rangeEnd: string) => {
    const start = new Date(rangeStart).getTime();
    const end = new Date(rangeEnd).getTime();
    const hasCoveringRange = cachedRangesRef.current.some((range) => {
      return range.start <= start && range.end >= end;
    });

    if (!hasCoveringRange) {
      return null;
    }

    return filterEventsForRange(
      Array.from(eventCacheRef.current.values()),
      rangeStart,
      rangeEnd
    );
  }, []);

  const cacheEventsForRange = useCallback((range: CalendarRange, rangeEvents: CalendarEvent[]) => {
    const rangeStart = new Date(range.start).getTime();
    const rangeEnd = new Date(range.end).getTime();

    Array.from(eventCacheRef.current.values()).forEach((event) => {
      if (eventIntersectsRange(event, rangeStart, rangeEnd)) {
        eventCacheRef.current.delete(event.id);
      }
    });

    rangeEvents.forEach((event) => {
      eventCacheRef.current.set(event.id, event);
    });

    cachedRangesRef.current.push({
      start: rangeStart,
      end: rangeEnd
    });
  }, []);

  const upsertCachedEvent = useCallback((event: CalendarEvent) => {
    eventCacheRef.current.set(event.id, event);
    updateAgentCalendarContext();
  }, [updateAgentCalendarContext]);

  const removeCachedEvent = useCallback((eventId: string) => {
    eventCacheRef.current.delete(eventId);
    updateAgentCalendarContext();
  }, [updateAgentCalendarContext]);

  const loadEvents = useCallback(async (options: {
    force?: boolean;
    targetDate: Date;
    targetView: CalendarView;
  }) => {
    if (!user || !isCalendarConnected) {
      return;
    }

    const targetView = options.targetView;
    const targetDate = options.targetDate;
    const targetRange = calendarRangeForView(targetView, targetDate);
    const loadRange = calendarYearRange(targetDate);
    const targetTitle = calendarTitleForView(targetView, targetDate);
    const cachedYearEvents = getCachedEventsForRange(loadRange.start, loadRange.end);
    const calendarSession = calendarSessionRef.current;

    if (cachedYearEvents && !options.force) {
      setViewDate(targetDate);
      setCalendarView(targetView);
      setEvents(
        getCachedEventsForRange(targetRange.start, targetRange.end) ??
          filterEventsForRange(cachedYearEvents, targetRange.start, targetRange.end)
      );
      setPendingNavigation(null);
      setHasLoadedInitialEvents(true);
      updateAgentCalendarContext();
      return;
    }

    const nextPendingNavigation: PendingNavigation = {
      date: targetDate,
      title: targetTitle,
      view: targetView
    };

    setPendingNavigation(nextPendingNavigation);
    setIsLoadingEvents(true);

    try {
      const idToken = await user.getIdToken();
      const loadedEvents = await fetchCalendarEvents({
        idToken,
        timeMin: loadRange.start,
        timeMax: loadRange.end
      });
      if (calendarSession !== calendarSessionRef.current) {
        return;
      }

      cacheEventsForRange(loadRange, loadedEvents);
      updateAgentCalendarContext();
      setViewDate(targetDate);
      setCalendarView(targetView);
      setEvents(
        getCachedEventsForRange(targetRange.start, targetRange.end) ??
          filterEventsForRange(loadedEvents, targetRange.start, targetRange.end)
      );
      setHasLoadedInitialEvents(true);
      setPendingNavigation(null);
    } catch (loadError) {
      if (calendarSession !== calendarSessionRef.current) {
        return;
      }

      const message =
        loadError instanceof Error ? loadError.message : "Unable to load events.";
      onError(message);
      setPendingNavigation({
        ...nextPendingNavigation,
        error: message
      });
    } finally {
      if (calendarSession === calendarSessionRef.current) {
        setIsLoadingEvents(false);
      }
    }
  }, [
    cacheEventsForRange,
    getCachedEventsForRange,
    isCalendarConnected,
    onError,
    updateAgentCalendarContext,
    user
  ]);

  const navigateToRange = useCallback((targetView: CalendarView, targetDate: Date) => {
    if (isLoadingEvents || pendingNavigation) {
      return;
    }

    void loadEvents({ targetDate, targetView });
  }, [isLoadingEvents, loadEvents, pendingNavigation]);

  const days = useMemo(() => monthDays(viewDate), [viewDate]);
  const visibleDays = useMemo(() => {
    if (calendarView === "day") {
      return [viewDate];
    }

    if (calendarView === "week") {
      const weekStart = startOfWeek(viewDate);
      return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
    }

    return days;
  }, [calendarView, days, viewDate]);
  const months = useMemo(() => yearMonths(viewDate), [viewDate]);
  const viewRange = useMemo(
    () => calendarRangeForView(calendarView, viewDate),
    [calendarView, viewDate]
  );
  const viewTitle = useMemo(
    () => calendarTitleForView(calendarView, viewDate),
    [calendarView, viewDate]
  );

  return {
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
  };
}
