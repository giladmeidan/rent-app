import { useQuery } from '@tanstack/react-query';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { AreaOut } from '../../api/client';
import { ErrorState } from '../../components/ErrorState';
import { Field } from '../../components/Field';
import { TextInput } from '../../components/TextInput';
import { areasQuery } from './api';
import { areaLabel } from './areaLabel';

/** A Hebrew keyboard types ASCII quotes for geresh and gershayim: compare with the real marks. */
const GERESH = String.fromCodePoint(0x5f3);
const GERSHAYIM = String.fromCodePoint(0x5f4);
/** How a typed name is compared with a label: real geresh / gershayim, no spaces around `-`, one
 * space between words ("תל אביב -יפו" is "תל אביב-יפו"). */
export const normalise = (text: string) =>
  text
    .replace(/['’]/g, GERESH)
    .replace(/["”]/g, GERSHAYIM)
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

type Props = {
  label: string;
  /** The kinds of area it offers. */
  kinds: readonly AreaOut['kind'][];
  /** One choice (the wizard): the chosen area's id (`''` none), shown as its label; text that stops
   * naming it calls `onPick(null)`. Absent: each pick clears the input (the profile's chips). */
  value?: string;
  onPick: (area: AreaOut | null) => void;
  /** Backspace in the empty input. */
  onBackspace?: () => void;
  id?: string;
  /** The input's `name` (the profile focuses a field by name). */
  name?: string;
  error?: string;
};

/**
 * One area picker (spec 0021b): a text input with a native list of every offered area; the browser
 * filters it. It picks as soon as the value names an area that no other label starts with (a pick
 * from the list, or a full unambiguous name), else on Enter; Enter on a name that matches nothing
 * says so under the field (Firefox for Android shows no list, so typing the name + Enter must work).
 */
export function AreaSearch(props: Props) {
  const { t } = useTranslation();
  const areas = useQuery(areasQuery);
  if (areas.data !== undefined) return <AreaInput {...props} areas={areas.data} />;
  if (areas.isError) {
    // No control to wire: the label, the state, and the field's alert.
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-label">{props.label}</p>
        <ErrorState onRetry={() => areas.refetch()} />
        {props.error !== undefined && (
          <p role="alert" className="text-body-sm font-medium text-danger">
            {props.error}
          </p>
        )}
      </div>
    );
  }
  return (
    <Field id={props.id} label={props.label} error={props.error}>
      <TextInput type="text" disabled placeholder={t('common.loading')} />
    </Field>
  );
}

function AreaInput({
  areas,
  label,
  kinds,
  value,
  onPick,
  onBackspace,
  id,
  name,
  error,
}: Props & { areas: AreaOut[] }) {
  const { t } = useTranslation();
  const listId = useId();
  const kindsKey = kinds.join();
  const options = useMemo(() => {
    const byId = new Map(areas.map((area) => [area.id, area]));
    return areas
      .filter((area) => kindsKey.split(',').includes(area.kind))
      .map((area) => {
        const text = areaLabel(t, area, byId);
        return { area, label: text, key: normalise(text) };
      });
  }, [areas, kindsKey, t]);
  const labelOf = (areaId: string | undefined) =>
    options.find((option) => option.area.id === areaId)?.label ?? '';

  const [text, setText] = useState(() => labelOf(value));
  // The value the text shows; a change from outside (the wizard drops an inactive area) resets it.
  const [shown, setShown] = useState(value);
  const [notFound, setNotFound] = useState(false);
  if (value !== shown) {
    setShown(value);
    setText(labelOf(value));
  }

  const find = (typed: string) => {
    const key = normalise(typed);
    return options.find((option) => option.key === key);
  };
  const isPrefix = (key: string) =>
    options.some((other) => other.key !== key && other.key.startsWith(key));

  function choose(option: { area: AreaOut; label: string }) {
    if (value === undefined) {
      setText('');
    } else {
      setText(option.label);
      setShown(option.area.id);
    }
    onPick(option.area);
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && text === '') {
      onBackspace?.();
      return;
    }
    if (event.key !== 'Enter' || text.trim() === '') return;
    event.preventDefault();
    const match = find(text);
    if (match === undefined) setNotFound(true);
    else choose(match);
  };

  return (
    <Field id={id} label={label} error={notFound ? t('areas.notFound') : error}>
      <TextInput
        type="text"
        list={listId}
        name={name}
        autoComplete="off"
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          setNotFound(false);
          const match = find(next);
          if (match !== undefined && !isPrefix(match.key)) choose(match);
          else if (value !== undefined && value !== '') {
            setShown('');
            onPick(null);
          }
        }}
        onKeyDown={onKeyDown}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.area.id} value={option.label} />
        ))}
      </datalist>
    </Field>
  );
}
