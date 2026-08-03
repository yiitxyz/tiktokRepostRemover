import { errorMessage, readState, type Message, type RepostRecord, type RunStatus } from './shared';

interface RepostItem {
  id?: string;
  desc?: string;
  author?: { uniqueId?: string };
  video?: { cover?: string; originCover?: string };
}

interface RepostListResponse {
  status_code?: number;
  status_msg?: string;
  itemList?: RepostItem[];
  hasMore?: boolean;
  cursor?: string | number;
}

interface TikTokResponse {
  status_code?: number;
  status_msg?: string;
}

class SafetyStopError extends Error {}
class TransientError extends Error {}
class HttpError extends Error {
  constructor(readonly status: number) {
    super(`TikTok request failed (${status}).`);
  }
}

const LOG = '[TikTok Repost Remover]';
const SAFETY_MESSAGE = /captcha|verify|verification|too many|too frequent|rate.?limit|risk|restricted|unusual|slow down/i;
const REQUEST_TIMEOUT = 20_000;
const REQUESTED_PAGE_SIZE = 50;
const FALLBACK_PAGE_SIZE = 30;
let listingPageSize = REQUESTED_PAGE_SIZE;
let runner: Promise<void> | null = null;
let stopRequested = false;
let restartRequested = false;

function randomBetween(minimum: number, maximum: number): number {
  return Math.floor(minimum + Math.random() * (maximum - minimum + 1));
}

async function waitWhile(ms: number, expected: RunStatus): Promise<boolean> {
  const end = Date.now() + ms;
  while (!stopRequested && Date.now() < end) {
    await new Promise((resolve) => window.setTimeout(resolve, Math.min(500, end - Date.now())));
    if ((await readState()).status !== expected) return false;
  }
  return !stopRequested;
}

async function requestJson<T>(url: string, init?: RequestInit, retries = 0): Promise<T> {
  const endpoint = new URL(url).pathname;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    console.info(LOG, init?.method ?? 'GET', endpoint, 'started');
    try {
      const response = await fetch(url, { ...init, credentials: 'include', signal: controller.signal });
      console.info(LOG, init?.method ?? 'GET', endpoint, 'completed', response.status);
      if ([401, 403, 429].includes(response.status)) {
        throw new SafetyStopError(`TikTok returned ${response.status}. Stopped for account safety; complete any verification and wait before retrying.`);
      }
      if (response.status >= 500) throw new TransientError(`TikTok server error (${response.status}).`);
      if (!response.ok) throw new HttpError(response.status);
      return await response.json() as T;
    } catch (error) {
      const transient = error instanceof TransientError || (error instanceof DOMException && error.name === 'AbortError') || error instanceof TypeError;
      lastError = error instanceof DOMException && error.name === 'AbortError'
        ? new TransientError('TikTok request timed out after 20 seconds.')
        : error;
      if (error instanceof SafetyStopError || !transient || attempt === retries) throw lastError;
      const delay = 500 * 2 ** attempt;
      console.warn(LOG, 'retry', { endpoint, attempt: attempt + 2, delayMs: delay });
      await new Promise((resolve) => window.setTimeout(resolve, delay));
    } finally {
      window.clearTimeout(timer);
    }
  }
  throw lastError;
}

function assertTikTokSuccess(result: TikTokResponse, action: string): void {
  if (result.status_code === 0) return;
  const message = result.status_msg || `TikTok could not ${action} (${result.status_code ?? 'unknown error'}).`;
  if (SAFETY_MESSAGE.test(message)) throw new SafetyStopError(`${message} Stopped for account safety.`);
  throw new Error(message);
}

async function getSecUid(): Promise<string> {
  const response = await chrome.runtime.sendMessage({ type: 'GET_SEC_UID' } satisfies Message) as { secUid?: string | null };
  if (!response?.secUid) throw new SafetyStopError('Could not identify the signed-in TikTok account. Refresh TikTok, confirm you are signed in, and try again.');
  return response.secUid;
}

function toRecord(item: RepostItem): Omit<RepostRecord, 'selected' | 'status' | 'error' | 'updatedAt' | 'scanPage'> | null {
  if (!item.id || !item.author?.uniqueId) return null;
  return {
    id: item.id,
    creator: item.author.uniqueId,
    description: item.desc ?? '',
    thumbnail: item.video?.cover ?? item.video?.originCover ?? '',
    url: `https://www.tiktok.com/@${item.author.uniqueId}/video/${item.id}`
  };
}

async function listPage(secUid: string, cursor: string): Promise<{ items: Omit<RepostRecord, 'selected' | 'status' | 'error' | 'updatedAt' | 'scanPage'>[]; returned: number; hasMore: boolean; cursor: string }> {
  const requestPage = (count: number): Promise<RepostListResponse> => {
    const params = new URLSearchParams({
      aid: '1988',
      count: String(count),
      coverFormat: '2',
      cursor,
      needPinnedItemIds: 'true',
      post_item_list_request_type: '0',
      secUid
    });
    return requestJson<RepostListResponse>(`https://www.tiktok.com/api/repost/item_list/?${params}`, undefined, 2);
  };
  let result: RepostListResponse;
  try {
    result = await requestPage(listingPageSize);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 400 || listingPageSize !== REQUESTED_PAGE_SIZE) throw error;
    listingPageSize = FALLBACK_PAGE_SIZE;
    console.warn(LOG, 'listing page size 50 rejected; using 30');
    result = await requestPage(listingPageSize);
  }
  assertTikTokSuccess(result, 'list reposts');
  const rawItems = result.itemList ?? [];
  const items = rawItems.map(toRecord).filter((item): item is NonNullable<typeof item> => item !== null);
  const nextCursor = result.cursor == null ? cursor : String(result.cursor);
  console.info(LOG, 'scan page', { cursor, returned: rawItems.length, valid: items.length, hasMore: Boolean(result.hasMore) });
  return { items, returned: rawItems.length, hasMore: Boolean(result.hasMore), cursor: nextCursor };
}

async function scan(): Promise<void> {
  const secUid = await getSecUid();
  let state = await readState();
  let cursor = state.cursor || '0';
  const visited = new Set<string>();
  console.info(LOG, 'scan start');
  while (!stopRequested && state.status === 'scanning') {
    if (visited.has(cursor)) throw new Error('TikTok returned a repeated pagination cursor. The partial scan was preserved.');
    visited.add(cursor);
    const page = await listPage(secUid, cursor);
    const response = await chrome.runtime.sendMessage({
      type: 'SAVE_ITEMS',
      items: page.items,
      cursor: page.cursor,
      hasMore: page.hasMore,
      returned: page.returned
    } satisfies Message) as { ok: boolean; added?: number; error?: string };
    if (!response.ok) throw new Error(response.error ?? 'Could not save the scanned page.');
    console.info(LOG, 'scan page saved', { added: response.added ?? 0 });
    if (!page.hasMore) {
      console.info(LOG, 'scan complete');
      return;
    }
    if (page.cursor === cursor) throw new Error('TikTok omitted the next pagination cursor. The partial scan was preserved.');
    cursor = page.cursor;
    const cooldown = randomBetween(4_000, 8_000);
    console.info(LOG, 'scan cooldown start', { seconds: Math.ceil(cooldown / 1_000) });
    if (!await waitWhile(cooldown, 'scanning')) return;
    console.info(LOG, 'scan cooldown end');
    state = await readState();
  }
  console.info(LOG, 'scan stop');
}

async function removeRepost(id: string): Promise<void> {
  const params = new URLSearchParams({ aid: '1988', item_id: id });
  const result = await requestJson<TikTokResponse>(`https://www.tiktok.com/tiktok/v1/upvote/delete?${params}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: ''
  });
  assertTikTokSuccess(result, 'remove the repost');
}

async function verificationScan(secUid: string): Promise<void> {
  const { pageLimit } = await chrome.runtime.sendMessage({ type: 'GET_VERIFY_LIMIT' } satisfies Message) as { pageLimit: number };
  const presentIds: string[] = [];
  const visited = new Set<string>();
  let cursor = '0';
  let page = 0;
  console.info(LOG, 'verification start', { pageLimit });
  while (!stopRequested && (await readState()).status === 'verifying') {
    if (visited.has(cursor)) throw new Error('TikTok returned a repeated cursor during verification.');
    visited.add(cursor);
    const result = await listPage(secUid, cursor);
    page += 1;
    presentIds.push(...result.items.map(({ id }) => id));
    await chrome.runtime.sendMessage({ type: 'VERIFY_PROGRESS', page, limit: pageLimit, present: presentIds.length } satisfies Message);
    if (!result.hasMore || page >= pageLimit) {
      await chrome.runtime.sendMessage({ type: 'VERIFY_RESULT', presentIds } satisfies Message);
      console.info(LOG, 'completion summary', { present: presentIds.length });
      return;
    }
    if (result.cursor === cursor) throw new Error('TikTok omitted the next cursor during verification.');
    cursor = result.cursor;
    if (!await waitWhile(randomBetween(4_000, 8_000), 'verifying')) return;
  }
}

async function removeSelected(): Promise<void> {
  const secUid = await getSecUid();
  let attemptsInGroup = 0;
  let groupSize = randomBetween(35, 45);
  console.info(LOG, 'delete start', { groupSize });
  while (!stopRequested && (await readState()).status === 'deleting') {
    const next = await chrome.runtime.sendMessage({ type: 'NEXT_DELETE_ITEM' } satisfies Message) as { item: RepostRecord | null; active: boolean };
    if (!next.active) return;
    if (!next.item) {
      await verificationScan(secUid);
      return;
    }

    let failure = '';
    console.info(LOG, 'delete item start', { id: next.item.id });
    try {
      await removeRepost(next.item.id);
    } catch (error) {
      if (error instanceof SafetyStopError) throw error;
      failure = errorMessage(error);
    }
    await chrome.runtime.sendMessage({ type: 'DELETE_RESULT', id: next.item.id, ok: failure === '', error: failure } satisfies Message);
    console.info(LOG, 'delete item result', { id: next.item.id, ok: failure === '' });
    attemptsInGroup += 1;

    if (attemptsInGroup >= groupSize) {
      const cooldown = randomBetween(4_000, 7_000);
      console.info(LOG, 'delete cooldown start', { seconds: Math.ceil(cooldown / 1_000) });
      if (!await waitWhile(cooldown, 'deleting')) return;
      console.info(LOG, 'delete cooldown end');
      attemptsInGroup = 0;
      groupSize = randomBetween(35, 45);
    } else if (!await waitWhile(randomBetween(300, 600), 'deleting')) return;
  }
}

async function run(): Promise<void> {
  const state = await readState();
  if (state.status === 'scanning') return scan();
  if (state.status === 'deleting') return removeSelected();
  if (state.status === 'verifying') return verificationScan(await getSecUid());
}

function startRunner(): void {
  if (runner) {
    restartRequested = true;
    return;
  }
  stopRequested = false;
  runner = run()
    .catch(async (error: unknown) => {
      const state = await readState();
      const operation = state.status === 'scanning' ? 'scan' : 'delete';
      const reason = errorMessage(error);
      console.error(LOG, error instanceof SafetyStopError ? 'safety shutdown' : 'run failed', reason);
      await chrome.runtime.sendMessage({ type: 'RUN_FAILED', operation, reason } satisfies Message);
    })
    .finally(() => {
      runner = null;
      if (restartRequested) {
        restartRequested = false;
        startRunner();
      }
    });
}

chrome.runtime.onMessage.addListener((message: Message) => {
  if (message.type === 'RUN') startRunner();
  if (message.type === 'STOP_SCAN' || message.type === 'PAUSE_DELETE' || message.type === 'STOP_DELETE') stopRequested = true;
});

void chrome.runtime.sendMessage({ type: 'READY' } satisfies Message)
  .then((response: { run?: boolean }) => { if (response.run) startRunner(); })
  .catch(() => undefined);
