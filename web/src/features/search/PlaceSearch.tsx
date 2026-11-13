import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Field } from '../../components/Field';
import { TextInput } from '../../components/TextInput';
import { PLACES, type Place } from './places';

type Props = {
  /** A place was chosen: the map goes there. */
  onJump: (place: Place) => void;
  /** Enter on a name that is not in the list. */
  onNotFound: () => void;
  /** Layout only. */
  className?: string;
};

/** A Hebrew keyboard types ASCII quotes for geresh and gershayim: compare with the real marks. */
const GERESH = String.fromCodePoint(0x5f3);
const GERSHAYIM = String.fromCodePoint(0x5f4);
const normalise = (text: string) =>
  text
    .replace(/['\u2019]/g, GERESH)
    .replace(/["\u201D]/g, GERSHAYIM)
    .trim();

/**
 * The place box over the full map (spec 0009y): a search input with a native list of the cities
 * and neighbourhoods in `PLACES`. It jumps on Enter with a name from the list, or as soon as the
 * value is a name that no other name starts with (a pick from the list, or a full unambiguous
 * name), so typing "רמת אביב" on the way to "רמת אביב ג׳" waits for Enter.
 */
export function PlaceSearch({ onJump, onNotFound, className }: Props) {
  const { t } = useTranslation();
  const listId = useId();
  const [value, setValue] = useState('');
  const named = useMemo(
    () => PLACES.map((place) => ({ place, name: t(`places.${place.id}`) })),
    [t],
  );
  const find = (text: string) => named.find(({ name }) => name === normalise(text));
  const isPrefix = (name: string) =>
    named.some((other) => other.name !== name && normalise(other.name).startsWith(normalise(name)));

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || value.trim() === '') return;
    event.preventDefault();
    const match = find(value);
    if (match === undefined) onNotFound();
    else onJump(match.place);
  };

  return (
    <Field label={t('search.map.placeLabel')} className={className}>
      <TextInput
        type="search"
        list={listId}
        autoComplete="off"
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          const match = find(next);
          if (match !== undefined && !isPrefix(match.name)) onJump(match.place);
        }}
        onKeyDown={onKeyDown}
      />
      <datalist id={listId}>
        {named.map(({ place, name }) => (
          <option key={place.id} value={name} />
        ))}
      </datalist>
    </Field>
  );
}
