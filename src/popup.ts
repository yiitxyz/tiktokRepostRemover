import { STATE_KEY, initialState, readState, type Message, type RunState } from './shared';

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing popup element: ${id}`);
  return element as T;
};

const scan = byId<HTMLButtonElement>('scan');
const stopScan = byId<HTMLButtonElement>('stop-scan');
const review = byId<HTMLButtonElement>('review');
let currentState = initialState();

function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function render(state: RunState): void {
  currentState = state;
  for (const key of ['collected', 'selected', 'removed', 'failed', 'remaining'] as const) byId(key).textContent = String(state[key]);
  byId('status').textContent = state.message;
  byId('pages').textContent = `${state.pagesScanned}${state.cursor ? ` · cursor ${state.cursor}` : ''}`;
  byId('page-size').textContent = state.actualPageSize ? `${state.actualPageSize} returned` : '—';
  const startedAt = state.status === 'scanning' ? state.scanStartedAt : state.deleteStartedAt ?? state.scanStartedAt;
  byId('elapsed').textContent = startedAt ? duration((state.finishedAt ?? Date.now()) - startedAt) : '0s';
  byId('estimate').textContent = state.status === 'scanning'
    ? 'Next page in 4–8s; TikTok does not provide a reliable total-page estimate.'
    : state.scanComplete ? 'Scan complete' : state.collected > 0 ? 'Partial scan saved' : 'Scan not started';
  const active = state.status === 'scanning' || state.status === 'deleting' || state.status === 'verifying' || state.status === 'delete_paused';
  scan.disabled = active;
  stopScan.disabled = state.status !== 'scanning';
  review.disabled = state.collected === 0;
  const error = byId('error');
  error.hidden = !state.lastError;
  error.textContent = state.lastError;
}

async function command(message: Message): Promise<void> {
  const response = await chrome.runtime.sendMessage(message) as { ok: boolean; error?: string };
  if (!response.ok) {
    const error = byId('error');
    error.hidden = false;
    error.textContent = response.error ?? 'Extension command failed.';
  }
}

scan.addEventListener('click', () => {
  if (currentState.collected === 0 || confirm('Start a new scan and replace the current collected list?')) void command({ type: 'START_SCAN' });
});
stopScan.addEventListener('click', () => void command({ type: 'STOP_SCAN' }));
review.addEventListener('click', () => void chrome.tabs.create({ url: chrome.runtime.getURL('review.html') }));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STATE_KEY]?.newValue) render(changes[STATE_KEY].newValue as RunState);
});
void readState().then(render);
window.setInterval(() => render(currentState), 1_000);
