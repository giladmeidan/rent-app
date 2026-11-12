import type { ReactNode } from 'react';

// The facts grid's icons: 24 px outline, `currentColor`, stroke 1.75, round caps and joins, no
// fill (design/brand "Iconography"). Six are Listing.dc.html's; the person and the people are for
// a room's facts. Decorative: the cell's label names the fact.

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

export const ElevatorIcon = () => (
  <Icon>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M9 9l3-3 3 3M9 15l3 3 3-3" />
  </Icon>
);

export const ParkingIcon = () => (
  <Icon>
    <path d="M5 17h14l-1.5-6h-11z" />
    <circle cx="8" cy="19" r="1.5" />
    <circle cx="16" cy="19" r="1.5" />
    <path d="M7 11l1.5-4h7L17 11" />
  </Icon>
);

export const FurnishedIcon = () => (
  <Icon>
    <path d="M4 12v6h16v-6" />
    <path d="M6 12V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4" />
    <path d="M4 12h16" />
  </Icon>
);

export const PetsIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="2" />
    <circle cx="16" cy="8" r="2" />
    <circle cx="5" cy="13" r="2" />
    <circle cx="19" cy="13" r="2" />
    <path d="M12 13c-3 0-5 2.5-5 5s2 3 5 3 5-1 5-3-2-5-5-5z" />
  </Icon>
);

export const ArnonaIcon = () => (
  <Icon>
    <path d="M4 21h16M6 21V9l6-5 6 5v12" />
    <path d="M10 21v-5h4v5" />
  </Icon>
);

export const VaadIcon = () => (
  <Icon>
    <circle cx="9" cy="8" r="3" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M3 20a6 6 0 0 1 12 0" />
    <path d="M15 20a4.5 4.5 0 0 1 6-4" />
  </Icon>
);

/** A room's "העדפת מגדר": Search.dc.html's profile icon. */
export const PersonIcon = () => (
  <Icon>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Icon>
);

/** A room's "שותפים בדירה": the vaad people icon. */
export const FlatmatesIcon = VaadIcon;
