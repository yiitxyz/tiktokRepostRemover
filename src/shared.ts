export const STATE_KEY = 'repost-remover-state-v2';

export type RunStatus =
  | 'idle'
  | 'scanning'
  | 'scan_stopped'
  | 'scan_complete'
  | 'scan_interrupted'
  | 'deleting'
  | 'delete_paused'
  | 'delete_stopped'
  | 'delete_interrupted'
  | 'verifying'
  | 'completed';

export type ItemStatus = 'pending' | 'removing' | 'removed' | 'failed' | 'remaining';

export interface RepostRecord {
  id: string;
  creator: string;
  description: string;
  thumbnail: string;
  url: string;
  selected: boolean;
  status: ItemStatus;
  error: string;
  updatedAt: number;
  scanPage?: number;
}

export interface RunState {
  status: RunStatus;
  message: string;
  collected: number;
  selected: number;
  removed: number;
  failed: number;
  remaining: number;
  pagesScanned: number;
  cursor: string;
  actualPageSize: number;
  scanComplete: boolean;
  scanStartedAt: number | null;
  deleteStartedAt: number | null;
  finishedAt: number | null;
  lastError: string;
  workerTabId: number | null;
  verificationPages: number;
}

export const initialState = (): RunState => ({
  status: 'idle',
  message: 'Ready to scan',
  collected: 0,
  selected: 0,
  removed: 0,
  failed: 0,
  remaining: 0,
  pagesScanned: 0,
  cursor: '0',
  actualPageSize: 0,
  scanComplete: false,
  scanStartedAt: null,
  deleteStartedAt: null,
  finishedAt: null,
  lastError: '',
  workerTabId: null,
  verificationPages: 0
});

export async function readState(): Promise<RunState> {
  const value = await chrome.storage.local.get(STATE_KEY);
  return { ...initialState(), ...(value[STATE_KEY] as Partial<RunState> | undefined) };
}

export async function writeState(state: RunState): Promise<void> {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type Message =
  | { type: 'START_SCAN' }
  | { type: 'STOP_SCAN' }
  | { type: 'START_DELETE' }
  | { type: 'PAUSE_DELETE' }
  | { type: 'RESUME_DELETE' }
  | { type: 'STOP_DELETE' }
  | { type: 'RETRY_DELETE' }
  | { type: 'RUN' }
  | { type: 'READY' }
  | { type: 'GET_SEC_UID' }
  | { type: 'SAVE_ITEMS'; items: Omit<RepostRecord, 'selected' | 'status' | 'error' | 'updatedAt'>[]; cursor: string; hasMore: boolean; returned: number }
  | { type: 'NEXT_DELETE_ITEM' }
  | { type: 'GET_VERIFY_LIMIT' }
  | { type: 'VERIFY_PROGRESS'; page: number; limit: number; present: number }
  | { type: 'DELETE_RESULT'; id: string; ok: boolean; error: string }
  | { type: 'VERIFY_RESULT'; presentIds: string[] }
  | { type: 'RUN_FAILED'; operation: 'scan' | 'delete'; reason: string }
  | { type: 'SET_SELECTED'; id: string; selected: boolean }
  | { type: 'SELECT_ITEMS'; mode: 'all' | 'none' | 'invert'; ids?: string[] }
  | { type: 'ITEM_CHANGED'; item: RepostRecord };
