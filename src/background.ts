import { errorMessage, initialState, readState, writeState, type Message, type RunState } from './shared';
import { addItems, clearItems, counts, nextPendingItem, updateItem, updateItems, verificationPageLimit } from './storage';

const TIKTOK_URL = 'https://www.tiktok.com/';
const ACTIVE_DELETE = new Set<RunState['status']>(['deleting', 'delete_paused', 'verifying']);

function getSecUidFromPage(): string | null {
  try {
    const page = window as unknown as {
      __$UNIVERSAL_DATA$__?: { __DEFAULT_SCOPE__?: Record<string, { user?: { secUid?: string } }> };
    };
    return page.__$UNIVERSAL_DATA$__?.__DEFAULT_SCOPE__?.['webapp.app-context']?.user?.secUid ?? null;
  } catch {
    return null;
  }
}

async function patchState(patch: Partial<RunState>): Promise<RunState> {
  const state = { ...await readState(), ...patch };
  await writeState(state);
  return state;
}

async function findTikTokTab(): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({ url: 'https://www.tiktok.com/*' });
  return tabs.find(({ id }) => id !== undefined) ?? chrome.tabs.create({ url: TIKTOK_URL, active: true });
}

async function sendWhenReady(): Promise<void> {
  const tab = await findTikTokTab();
  if (tab.id === undefined) throw new Error('Chrome did not create a usable TikTok tab.');
  await patchState({ workerTabId: tab.id });
  await chrome.tabs.update(tab.id, { active: true });
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'RUN' } satisfies Message);
  } catch {
    // A newly created or navigating tab resumes from persisted state when its content script loads.
  }
}

async function tellTikTok(message: Message): Promise<void> {
  const tabs = await chrome.tabs.query({ url: 'https://www.tiktok.com/*' });
  await Promise.allSettled(tabs.flatMap(({ id }) => id === undefined ? [] : [chrome.tabs.sendMessage(id, message)]));
}

async function prepareDeletion(resetFailures: boolean): Promise<void> {
  await updateItems(undefined, (item) => item.selected && item.status !== 'removed' && (resetFailures || item.status === 'removing')
    ? { status: 'pending', error: '' }
    : {});
  const totals = await counts();
  if (totals.remaining === 0) throw new Error('Select at least one repost that has not been removed.');
  await patchState({
    ...totals,
    status: 'deleting',
    message: `Deleting ${totals.remaining} selected reposts…`,
    deleteStartedAt: Date.now(),
    finishedAt: null,
    lastError: ''
  });
  await sendWhenReady();
}

async function handle(message: Message, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (message.type === 'READY') {
    const state = await readState();
    return { run: state.workerTabId === sender.tab?.id && ['scanning', 'deleting', 'verifying'].includes(state.status) };
  }

  if (message.type === 'GET_SEC_UID') {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return { secUid: null };
    const results = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: getSecUidFromPage });
    return { secUid: results[0]?.result ?? null };
  }

  if (message.type === 'START_SCAN') {
    await clearItems();
    await writeState({ ...initialState(), status: 'scanning', message: 'Starting repost scan…', scanStartedAt: Date.now() });
    await sendWhenReady();
    return { ok: true };
  }

  if (message.type === 'STOP_SCAN') {
    const state = await readState();
    if (state.status === 'scanning') await patchState({ status: 'scan_stopped', message: 'Scan stopped; collected reposts are ready to review.', finishedAt: Date.now() });
    await tellTikTok(message);
    return { ok: true };
  }

  if (message.type === 'START_DELETE' || message.type === 'RETRY_DELETE') {
    await prepareDeletion(true);
    return { ok: true };
  }

  if (message.type === 'PAUSE_DELETE') {
    const state = await readState();
    if (state.status === 'deleting') await patchState({ status: 'delete_paused', message: 'Deletion paused' });
    await tellTikTok(message);
    return { ok: true };
  }

  if (message.type === 'RESUME_DELETE') {
    const state = await readState();
    if (state.status !== 'delete_paused' && state.status !== 'delete_stopped') throw new Error('There is no paused deletion to resume.');
    await updateItems(undefined, (item) => item.status === 'removing' ? { status: 'pending' } : {});
    await patchState({ ...await counts(), status: 'deleting', message: 'Resuming deletion…', finishedAt: null });
    await sendWhenReady();
    return { ok: true };
  }

  if (message.type === 'STOP_DELETE') {
    const state = await readState();
    if (ACTIVE_DELETE.has(state.status)) await patchState({ status: 'delete_stopped', message: 'Deletion stopped; progress is saved.', finishedAt: Date.now() });
    await tellTikTok(message);
    return { ok: true };
  }

  if (message.type === 'SAVE_ITEMS') {
    const state = await readState();
    const added = await addItems(message.items, state.pagesScanned + 1);
    const scanning = state.status === 'scanning';
    const nextState = await patchState({
      collected: state.collected + added,
      selected: state.selected + added,
      remaining: state.remaining + added,
      pagesScanned: state.pagesScanned + 1,
      cursor: message.cursor,
      actualPageSize: Math.max(state.actualPageSize, message.returned),
      scanComplete: scanning && !message.hasMore,
      status: scanning ? (message.hasMore ? 'scanning' : 'scan_complete') : state.status,
      message: !scanning ? state.message : message.hasMore
        ? `Collected ${state.collected + added} reposts from ${state.pagesScanned + 1} pages.`
        : `Scan complete: ${state.collected + added} reposts collected.`,
      finishedAt: !scanning ? state.finishedAt : message.hasMore ? null : Date.now()
    });
    return { ok: true, added, state: nextState };
  }

  if (message.type === 'NEXT_DELETE_ITEM') {
    const state = await readState();
    if (state.status !== 'deleting') return { item: null, active: false };
    const item = await nextPendingItem();
    if (item) await patchState({ message: `Removing ${state.removed + state.failed + 1}…` });
    else await patchState({ status: 'verifying', message: 'Preparing server verification…', verificationPages: 0 });
    return { item, active: true };
  }

  if (message.type === 'GET_VERIFY_LIMIT') {
    const state = await readState();
    return { pageLimit: await verificationPageLimit(state.pagesScanned) };
  }

  if (message.type === 'VERIFY_PROGRESS') {
    const state = await readState();
    if (state.status === 'verifying') await patchState({
      verificationPages: message.page,
      message: `Verifying page ${message.page} of at most ${message.limit}… ${message.present} reposts checked`
    });
    return { ok: true };
  }

  if (message.type === 'DELETE_RESULT') {
    const item = await updateItem(message.id, { status: message.ok ? 'removed' : 'failed', error: message.error });
    const totals = await counts();
    await patchState({ ...totals, message: message.ok ? 'Repost removed' : 'Item failed; continuing…' });
    if (item) void chrome.runtime.sendMessage({ type: 'ITEM_CHANGED', item } satisfies Message).catch(() => undefined);
    return { ok: true };
  }

  if (message.type === 'VERIFY_RESULT') {
    if ((await readState()).status !== 'verifying') return { ok: true };
    const present = new Set(message.presentIds);
    await updateItems(undefined, (item) => {
      if (!item.selected) return {};
      if (!present.has(item.id)) return { status: 'removed', error: '' };
      return item.status === 'failed' ? {} : { status: 'remaining', error: 'Still present after server verification.' };
    });
    const totals = await counts();
    await patchState({
      ...totals,
      status: 'completed',
      message: totals.remaining === 0 ? 'Deletion complete and verified.' : 'Deletion finished with items still remaining.',
      finishedAt: Date.now()
    });
    return { ok: true };
  }

  if (message.type === 'RUN_FAILED') {
    const current = await readState();
    if (['scan_stopped', 'delete_paused', 'delete_stopped'].includes(current.status)) return { ok: true };
    await patchState({
      status: message.operation === 'scan' ? 'scan_interrupted' : 'delete_interrupted',
      message: message.reason,
      lastError: message.reason,
      finishedAt: Date.now()
    });
    return { ok: true };
  }

  if (message.type === 'SET_SELECTED') {
    const state = await readState();
    if (ACTIVE_DELETE.has(state.status)) throw new Error('Selection is locked while deletion is active.');
    const item = await updateItem(message.id, { selected: message.selected });
    await patchState(await counts());
    if (item) void chrome.runtime.sendMessage({ type: 'ITEM_CHANGED', item } satisfies Message).catch(() => undefined);
    return { ok: true };
  }

  if (message.type === 'SELECT_ITEMS') {
    const state = await readState();
    if (ACTIVE_DELETE.has(state.status)) throw new Error('Selection is locked while deletion is active.');
    await updateItems(message.ids, (item) => item.status === 'removed' ? { selected: false } : {
      selected: message.mode === 'all' ? true : message.mode === 'none' ? false : !item.selected
    });
    await patchState(await counts());
    return { ok: true };
  }

  return { ok: true };
}

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  if (message.type === 'RUN' || message.type === 'ITEM_CHANGED') return false;
  void handle(message, sender).then(sendResponse, (error: unknown) => sendResponse({ ok: false, error: errorMessage(error) }));
  return true;
});
