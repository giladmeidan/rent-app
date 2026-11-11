import type { components } from '../../api/schema';

/** A listing's match against the caller's housing profile (`0006b`): only a score and criterion
 * codes; the web turns the codes into copy (`reasons.ts`). */
export type MatchOut = components['schemas']['MatchOut'];
export type Criterion = MatchOut['agrees'][number];
/** Which side of the explanation a criterion is on. */
export type ReasonKind = 'agree' | 'differ';
