import { STATE_KEY, initialState, readState, type Message, type RepostRecord, type RunState } from './shared';
import { getItems } from './storage';

const PAGE_SIZE = 60;
const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing review element: ${id}`);
  return element as T;
};

let state = initialState();
let items: RepostRecord[] = [];
let visible: RepostRecord[] = [];
let page = 0;

function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function itemStatus(item: RepostRecord): string {
  return item.status === 'pending' && item.selected ? 'selected' : item.status;
}

function renderItems(): void {
  const start = page * PAGE_SIZE;
  const pageItems = visible.slice(start, start + PAGE_SIZE);
  const container = byId('items');
  container.replaceChildren(...pageItems.map((item) => {
    const card = document.createElement('article');
    card.className = 'card';
    const image = item.thumbnail ? document.createElement('img') : document.createElement('div');
    if (image instanceof HTMLImageElement) {
      image.src = item.thumbnail;
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () => image.replaceWith(Object.assign(document.createElement('div'), { className: 'placeholder' })));
    } else image.className = 'placeholder';
    const body = document.createElement('div');
    body.className = 'body';
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item.selected;
    checkbox.disabled = item.status === 'removed' || ['deleting', 'delete_paused', 'verifying'].includes(state.status);
    const creator = document.createElement('span');
    creator.className = 'creator';
    creator.textContent = `@${item.creator}`;
    checkbox.addEventListener('change', () => void command({ type: 'SET_SELECTED', id: item.id, selected: checkbox.checked }));
    label.append(checkbox, creator);
    const caption = document.createElement('p');
    caption.className = 'caption';
    caption.textContent = item.description || 'No caption';
    const meta = document.createElement('div');
    meta.className = 'meta';
    const status = document.createElement('span');
    status.className = item.status;
    status.textContent = itemStatus(item);
    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = item.id;
    meta.append(status, link);
    body.append(label, caption, meta);
    card.append(image, body);
    return card;
  }));
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  byId('page').textContent = `Page ${page + 1} of ${pages} · ${visible.length} items`;
  byId<HTMLButtonElement>('previous').disabled = page === 0;
  byId<HTMLButtonElement>('next').disabled = page + 1 >= pages;
}

function filterItems(): void {
  const query = byId<HTMLInputElement>('search').value.trim().toLowerCase();
  visible = query ? items.filter((item) => `${item.creator}\n${item.description}\n${item.id}`.toLowerCase().includes(query)) : items;
  page = 0;
  renderItems();
}

function renderState(next: RunState): void {
  const previous = state;
  state = next;
  for (const key of ['collected', 'selected', 'removed', 'failed', 'remaining'] as const) byId(key).textContent = String(state[key]);
  byId('status').textContent = state.message;
  const elapsed = state.deleteStartedAt ? (state.finishedAt ?? Date.now()) - state.deleteStartedAt : 0;
  byId('elapsed').textContent = duration(elapsed);
  const completed = state.removed + state.failed;
  byId('eta').textContent = state.status === 'delete_paused' ? 'Paused' : completed && state.remaining
    ? `~${duration((elapsed / completed) * state.remaining)}` : state.remaining ? 'Calculating' : '—';
  const locked = ['deleting', 'delete_paused', 'verifying'].includes(state.status);
  for (const id of ['all', 'none', 'invert'] as const) byId<HTMLButtonElement>(id).disabled = locked || items.length === 0;
  byId<HTMLButtonElement>('delete').disabled = locked || state.remaining === 0;
  byId<HTMLButtonElement>('pause').disabled = state.status !== 'deleting';
  byId<HTMLButtonElement>('resume').disabled = state.status !== 'delete_paused' && state.status !== 'delete_stopped';
  byId<HTMLButtonElement>('stop').disabled = state.status !== 'deleting' && state.status !== 'verifying' && state.status !== 'delete_paused';
  byId<HTMLButtonElement>('retry').disabled = locked || state.remaining === 0;
  const error = byId('error');
  error.hidden = !state.lastError;
  error.textContent = state.lastError;
  if (state.collected !== previous.collected || (previous.status === 'verifying' && state.status === 'completed')) void refreshItems();
  else renderItems();
}

async function refreshItems(): Promise<void> {
  items = await getItems();
  filterItems();
}

async function command(message: Message): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage(message) as { ok: boolean; error?: string };
    if (!response.ok) throw new Error(response.error ?? 'Extension command failed.');
    return true;
  } catch (error) {
    const banner = byId('error');
    banner.hidden = false;
    banner.textContent = error instanceof Error ? error.message : 'Extension command failed.';
    return false;
  }
}

async function select(mode: 'all' | 'none' | 'invert'): Promise<void> {
  if (await command({ type: 'SELECT_ITEMS', mode })) await refreshItems();
}

function exportFile(format: 'json' | 'csv'): void {
  const data = format === 'json'
    ? JSON.stringify(items, null, 2)
    : ['id,creator,description,url,selected,status,error', ...items.map((item) => [item.id, item.creator, item.description, item.url, item.selected, item.status, item.error]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([data], { type: format === 'json' ? 'application/json' : 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `tiktok-reposts-${new Date().toISOString().slice(0, 10)}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}

byId('search').addEventListener('input', filterItems);
byId('all').addEventListener('click', () => void select('all'));
byId('none').addEventListener('click', () => void select('none'));
byId('invert').addEventListener('click', () => void select('invert'));
byId('previous').addEventListener('click', () => { page -= 1; renderItems(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
byId('next').addEventListener('click', () => { page += 1; renderItems(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
byId('delete').addEventListener('click', () => {
  if (confirm(`Delete exactly ${state.remaining} checked repost${state.remaining === 1 ? '' : 's'}? Only checked items will be removed.`)) void command({ type: 'START_DELETE' });
});
byId('pause').addEventListener('click', () => void command({ type: 'PAUSE_DELETE' }));
byId('resume').addEventListener('click', () => void command({ type: 'RESUME_DELETE' }));
byId('stop').addEventListener('click', () => void command({ type: 'STOP_DELETE' }));
byId('retry').addEventListener('click', () => {
  if (confirm(`Retry ${state.remaining} selected failed or remaining repost${state.remaining === 1 ? '' : 's'}?`)) void command({ type: 'RETRY_DELETE' });
});
byId('json').addEventListener('click', () => exportFile('json'));
byId('csv').addEventListener('click', () => exportFile('csv'));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STATE_KEY]?.newValue) renderState(changes[STATE_KEY].newValue as RunState);
});
chrome.runtime.onMessage.addListener((message: Message) => {
  if (message.type !== 'ITEM_CHANGED') return;
  const index = items.findIndex(({ id }) => id === message.item.id);
  if (index >= 0) items[index] = message.item;
  filterItems();
});
void Promise.all([readState(), refreshItems()]).then(([savedState]) => renderState(savedState));
window.setInterval(() => renderState(state), 1_000);
