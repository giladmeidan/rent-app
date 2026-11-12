import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import he from '../../../locales/he.json';
import { match } from '../../applicants/__tests__/fixtures';
import { person } from '../../people/__tests__/fixtures';
import { MatchChips } from '../MatchChips';

describe('MatchChips', () => {
  it('ac4_person_voice', () => {
    // An agreeing budget and a differing pets: the neutral people copy, never an amount.
    render(
      <MatchChips voice="person" match={match(88, ['budget', 'area'], 'pets')} person={person()} />,
    );
    const chips = screen.getByTestId('match-chips');
    expect(chips).toHaveTextContent(he.match.owner.short.budget.agree);
    expect(chips).toHaveTextContent(he.people.short.pets.differ);
    expect(chips.querySelectorAll('li')).toHaveLength(2);
  });
});
