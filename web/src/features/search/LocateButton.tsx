import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import { inLaunchArea } from '../../components/map/config';

/** What the status line says after a locate press that did not move the map. */
export type LocateMessage = 'locateOutside' | 'locateDenied' | 'locateFailed';

type Props = {
  /** A fix inside the launch area, `[lng, lat]`: the raw position, for the caller to snap. */
  onLocated: (position: [lng: number, lat: number]) => void;
  onMessage: (key: LocateMessage) => void;
  /** Called on every press, before the browser answers. */
  onPress?: () => void;
  /** Layout only: where the button sits over the map. */
  className?: string;
};

// A coarse fix is enough for a ~200 m snapped centre; a recent one is reused.
const OPTIONS: PositionOptions = { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 };

/**
 * "Show my location" (spec 0009y): asks the browser for one position and hands it on only when it
 * lies inside the launch area. Absent when the browser has no geolocation. While waiting, the
 * button is busy (`aria-busy` + `aria-disabled`) and keeps focus. The position is never stored.
 */
export function LocateButton({ onLocated, onMessage, onPress, className }: Props) {
  const { t } = useTranslation();
  const [waiting, setWaiting] = useState(false);
  // The browser may answer after the map was closed.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (!('geolocation' in navigator)) return null;

  const locate = () => {
    onPress?.();
    setWaiting(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!mounted.current) return;
        setWaiting(false);
        if (inLaunchArea(coords.longitude, coords.latitude)) {
          onLocated([coords.longitude, coords.latitude]);
        } else {
          onMessage('locateOutside');
        }
      },
      (error) => {
        if (!mounted.current) return;
        setWaiting(false);
        // The codes as literals: jsdom (and some browsers' polyfills) lack the global constants.
        // 1 PERMISSION_DENIED; 2 POSITION_UNAVAILABLE and 3 TIMEOUT are a failure to find it.
        onMessage(error.code === 1 ? 'locateDenied' : 'locateFailed');
      },
      OPTIONS,
    );
  };

  return (
    <Button
      variant="secondary"
      aria-label={t('search.map.locate')}
      busy={waiting}
      onClick={locate}
      className={className}
      icon={
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
      }
    />
  );
}
