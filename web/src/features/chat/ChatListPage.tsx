import { useId } from 'react';

import { ConversationsPane } from './ConversationsPane';

/** `/chat` on a phone, for an owner or a seeker (`RequireUser`): the list is the page, inside
 * `ChatLayout`'s column. On a desktop `ChatLayout` renders the list pane itself (spec 0009s). */
export function ChatListPage() {
  const id = useId();
  return <ConversationsPane headingId={id} headingLevel={1} />;
}
