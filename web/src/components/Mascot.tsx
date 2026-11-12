import celebrate from '../assets/brand/mascot/homie-turtle-celebrate.svg';
import hello from '../assets/brand/mascot/homie-turtle-hello.svg';
import search from '../assets/brand/mascot/homie-turtle-search.svg';
import sleep from '../assets/brand/mascot/homie-turtle-sleep.svg';
import turtle from '../assets/brand/mascot/homie-turtle.svg';

/**
 * `default`: onboarding, about; `hello`: welcome, sign-up; `search`: no results, a search loading;
 * `celebrate`: listing published, application sent; `sleep`: empty lists.
 */
export type MascotPose = 'default' | 'hello' | 'search' | 'celebrate' | 'sleep';

const POSES: Record<MascotPose, string> = {
  default: turtle,
  hello,
  search,
  celebrate,
  sleep,
};

/** The brand minimum; below it, use the app icon. */
const MIN_WIDTH = 96;

export type MascotProps = {
  pose?: MascotPose;
  /** In px; raised to 96. The height follows the files' 4:3. */
  width?: number;
  /** Empty (decorative, beside its text) unless the caller gives it a meaning from he.json. */
  alt?: string;
  /** Layout only. */
  className?: string;
};

/**
 * The homie turtle (a 400×300 file), as an `<img>`. One per screen, on surface or accent-soft,
 * never on accent; it has no prop to flip, recolour or crop it.
 */
export function Mascot({ pose = 'default', width = 160, alt = '', className }: MascotProps) {
  const w = Math.max(MIN_WIDTH, width);
  return (
    <img
      src={POSES[pose]}
      width={w}
      height={w * 0.75}
      alt={alt}
      draggable={false}
      className={className}
    />
  );
}
