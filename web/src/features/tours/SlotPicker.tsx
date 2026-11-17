import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import { ChoiceGroup } from '../../components/ChoiceGroup';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Loading } from '../../components/Loading';
import { Skeleton } from '../../components/Skeleton';
import { useOnline } from '../../components/useOnline';
import { ApiError } from '../listings/api';
import { addDays, todayInIsrael } from '../listings/format';
import type { SlotOut } from './api';
import { tourErrorText } from './errors';
import { formatTourDay, formatTourTime, tourDay } from './format';
import { MonthCalendar } from './MonthCalendar';
import { useBookTour, useRescheduleTour } from './useTourActions';
import { useTourSlots } from './useTourSlots';

/** The free slots by Israeli day, in order. */
function byDay(slots: SlotOut[]): [string, SlotOut[]][] {
  const days = new Map<string, SlotOut[]>();
  for (const slot of slots) {
    const day = tourDay(slot.starts_at);
    days.set(day, [...(days.get(day) ?? []), slot]);
  }
  return [...days];
}

/**
 * The seeker's slot picker: a dialog with a month calendar of the days with free slots and one radio group for the chosen day. `tourId` set = reschedule that
 * tour, else book. `conversationId` is the chat's (= the application's) id. `onDone` runs after a
 * success (the card moves focus); a 409 that makes the tour stale closes it.
 */
export function SlotPicker({
  open,
  onClose,
  onDone,
  conversationId,
  tourId,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  conversationId: string;
  tourId: string | null;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const slots = useTourSlots(conversationId, open);
  const book = useBookTour(conversationId);
  const move = useRescheduleTour(conversationId);
  const [selected, setSelected] = useState<string | null>(null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const action = tourId === null ? book : move;

  function close() {
    setSelected(null);
    setPickedDay(null);
    setFailure(null);
    onClose();
  }

  function submit() {
    if (selected === null) return;
    setFailure(null);
    const callbacks = {
      onSuccess: () => {
        close();
        onDone();
      },
      onError: (error: unknown) => {
        setSelected(null);
        if (
          error instanceof ApiError &&
          (error.detail === 'tour_exists' || error.detail === 'tour_not_cancellable')
        ) {
          close();
          return;
        }
        setFailure(error);
      },
    };
    if (tourId === null) book.mutate(selected, callbacks);
    else move.mutate({ tourId, startsAt: selected }, callbacks);
  }

  const today = todayInIsrael();
  let body;
  if (slots.data === undefined) {
    body = slots.isError ? (
      <ErrorState onRetry={() => slots.refetch()} />
    ) : (
      <Loading>
        <Skeleton />
      </Loading>
    );
  } else if (slots.data.slots.length === 0) {
    body = <EmptyState message={t('tours.picker.empty')} />;
  } else {
    const days = new Map(byDay(slots.data.slots));
    const [firstDay = today] = days.keys();
    // A day a refetch dropped moves to the first one after it, else the first.
    const day =
      pickedDay !== null && days.has(pickedDay)
        ? pickedDay
        : ([...days.keys()].find((d) => pickedDay !== null && d > pickedDay) ?? firstDay);
    const list = days.get(day) ?? [];
    body = (
      <div className="flex flex-col gap-4">
        <MonthCalendar
          label={t('tours.calendar.seekerLabel')}
          today={today}
          lastDay={addDays(today, 30)}
          selected={day}
          onSelect={(d) => {
            setPickedDay(d);
            setSelected(null);
            setFailure(null);
          }}
          isEnabled={(d) => days.has(d)}
          mark={(d) => (days.has(d) ? 'has' : 'none')}
        />
        <ChoiceGroup
          legend={formatTourDay(day, today)}
          name="tour-slot"
          wrap
          options={list.map((slot) => ({
            value: slot.starts_at,
            label: formatTourTime(slot.starts_at),
          }))}
          value={list.some((slot) => slot.starts_at === selected) ? selected : null}
          onChange={(value) => {
            setSelected(value);
            setFailure(null);
          }}
        />
      </div>
    );
  }

  return (
    <Dialog
      size="wide"
      open={open}
      onClose={close}
      title={t('tours.picker.title')}
      actions={
        <>
          <Button variant="secondary" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            busy={action.isPending}
            disabled={selected === null}
            onClick={submit}
          >
            {tourId === null ? t('tours.picker.confirm') : t('tours.picker.move')}
          </Button>
        </>
      }
    >
      {body}
      {failure !== null && (
        <p role="alert" className="text-body-sm font-semibold text-danger">
          {tourErrorText(t, failure, online)}
        </p>
      )}
    </Dialog>
  );
}
