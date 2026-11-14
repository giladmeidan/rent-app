import { usePageTitle } from '../../app/usePageTitle';
import { PageContainer } from '../../components/PageContainer';
import { todayInIsrael } from '../listings/format';
import { ClosingBand } from './ClosingBand';
import { Doors } from './Doors';
import { Faq } from './Faq';
import { Hero } from './Hero';
import { HowItWorks } from './HowItWorks';
import { LatestListings } from './LatestListings';

/**
 * The visitor's `/` (design/screens-v2/Main.html, spec 0009z): the hero, four doors into the site,
 * the newest listings (only with three or more), "איך זה עובד" for both sides, five questions and
 * the closing band. One column below `lg`. The one request it makes is the listings query.
 */
export function LandingPage() {
  usePageTitle(undefined);
  const today = todayInIsrael();

  return (
    <PageContainer width="wide">
      <Hero today={today} />
      <Doors />
      <LatestListings today={today} />
      <HowItWorks />
      <Faq />
      <ClosingBand />
    </PageContainer>
  );
}
