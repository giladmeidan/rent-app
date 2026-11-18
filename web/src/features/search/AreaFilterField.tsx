import { useTranslation } from 'react-i18next';

import { Tag } from '../../components/Tag';
import { TagRemoveButton } from '../../components/TagRemoveButton';
import { AreaSearch } from '../areas/AreaSearch';
import { AREA_IDS_MAX } from './filters';
import { useAreaName } from './useAreaName';

const KINDS = ['settlement', 'neighbourhood'] as const;

type Props = {
  /** The picker's id: a removed chip's focus goes there. */
  id: string;
  /** The chosen areas, in the order picked. */
  areaIds: readonly string[];
  /** A pick past `AREA_IDS_MAX` was refused; cleared by the next change. */
  overLimit: boolean;
  onChange: (areaIds: string[]) => void;
  onOverLimit: () => void;
};

/** The filter form's cities and neighbourhoods: removable chips above one picker. */
export function AreaFilterField({ id, areaIds, overLimit, onChange, onOverLimit }: Props) {
  const { t } = useTranslation();
  const areaName = useAreaName(true);
  const remove = (areaId: string) => onChange(areaIds.filter((other) => other !== areaId));

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {areaIds.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {areaIds.map((areaId) => {
            const name = areaName(areaId);
            return (
              <Tag key={areaId} as="li" tone="accent">
                {name}
                <TagRemoveButton
                  aria-label={t('search.tags.remove', { name })}
                  onClick={() => {
                    remove(areaId);
                    // The focused button unmounts: keep focus in the picker.
                    document.getElementById(id)?.focus();
                  }}
                />
              </Tag>
            );
          })}
        </ul>
      )}
      <AreaSearch
        id={id}
        label={t('search.area')}
        kinds={KINDS}
        error={overLimit ? t('profile.errors.areasMax') : undefined}
        onPick={(area) => {
          if (area === null || areaIds.includes(area.id)) return;
          if (areaIds.length >= AREA_IDS_MAX) onOverLimit();
          else onChange([...areaIds, area.id]);
        }}
        onBackspace={() => {
          const last = areaIds.at(-1);
          if (last !== undefined) remove(last);
        }}
      />
    </div>
  );
}
