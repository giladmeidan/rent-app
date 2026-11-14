import { useMutation } from '@tanstack/react-query';

import { postReport } from './api';

/** Sends one report. No cache changes: nothing the app shows depends on a report. Never paused
 * while offline: it fails at once (`common.offline`) and is not replayed on reconnect (0009f). */
export function useReport() {
  return useMutation({ mutationFn: postReport, networkMode: 'always' });
}
