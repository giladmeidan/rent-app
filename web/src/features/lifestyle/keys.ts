// The room questionnaire (spec 0007a's contract): seven fixed questions on a 3-point scale, answered
// by the seeker ("אני…") and by the room's side ("בדירה…"). Shared by the profile (0007d), the
// listing wizard (0007e), the room card's reasons (0007f) and the inbox (0007c).

/** The contract's keys, in its order (the order every list of answers follows). */
export const LIFESTYLE_KEYS = [
  'cleanliness',
  'guests',
  'night',
  'social',
  'kosher',
  'shabbat',
  'work_from_home',
] as const;

export type LifestyleKey = (typeof LIFESTYLE_KEYS)[number];

/** 1 → 3 along the contract's scale (e.g. cleanliness relaxed / average / very tidy). */
export type LifestyleAnswer = 1 | 2 | 3;

/** Only answered keys are present; an unanswered question has no key. */
export type LifestyleAnswers = Partial<Record<LifestyleKey, LifestyleAnswer>>;

export type LifestyleComparison = {
  /** Keys answered by both sides. */
  shared: number;
  /** Of those, the ones with equal answers. */
  same: number;
  /** Of those, the ones with different answers, in `LIFESTYLE_KEYS` order. */
  differing: LifestyleKey[];
};

/** Compares two sets of answers over the keys both answered. Pure: neither input is changed. */
export function compareLifestyle(a: LifestyleAnswers, b: LifestyleAnswers): LifestyleComparison {
  let shared = 0;
  let same = 0;
  const differing: LifestyleKey[] = [];
  for (const key of LIFESTYLE_KEYS) {
    const left = a[key];
    const right = b[key];
    if (left === undefined || right === undefined) continue;
    shared += 1;
    if (left === right) same += 1;
    else differing.push(key);
  }
  return { shared, same, differing };
}
