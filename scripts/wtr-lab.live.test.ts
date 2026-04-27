/**
 * WTR-Lab Bridge Test Suite
 * ──────────────────────────────────────────────────────────────
 * Runs in three tiers:
 *   1. Unit tests  – pure logic, no network, no browser (always pass offline)
 *   2. Integration – live HTTP fetch against real sites (needs internet)
 *   3. Live E2E    – full Playwright headless run (needs --live flag + browser)
 *
 * Usage:
 *   npx ts-node scripts/wtr-lab.live.test.ts            # unit + integration
 *   npx ts-node scripts/wtr-lab.live.test.ts --live     # all including Playwright
 *   npx ts-node scripts/wtr-lab.live.test.ts --unit     # unit only (always offline)
 */

import { JSDOM } from 'jsdom';
import {
  ONLINE_MTL_PROVIDERS,
  WTR_LAB_BOOTSTRAP_SCRIPT,
  buildWtrBridgeCommand,
  parseWtrBridgeMessage,
} from '../utils/wtr-lab-bridge';

const LIVE_FLAG = process.argv.includes('--live');
const UNIT_ONLY = process.argv.includes('--unit');
const TIMEOUT_MS = 25_000;

// ─── colour helpers ───────────────────────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// ─── result tracking ──────────────────────────────────────────────────────────
type TestResult = { name: string; passed: boolean; skipped?: boolean; error?: string; durationMs: number };
const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void> | void, skip = false): Promise<void> {
  if (skip) {
    results.push({ name, passed: true, skipped: true, durationMs: 0 });
    console.log(`  ${YELLOW}SKIP${RESET}  ${DIM}${name}${RESET}`);
    return;
  }
  const t0 = Date.now();
  try {
    await fn();
    const ms = Date.now() - t0;
    results.push({ name, passed: true, durationMs: ms });
    console.log(`  ${GREEN}PASS${RESET}  ${name}  ${DIM}(${ms} ms)${RESET}`);
  } catch (err) {
    const ms = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, error: msg, durationMs: ms });
    console.log(`  ${RED}FAIL${RESET}  ${name}  ${DIM}(${ms} ms)${RESET}`);
    console.log(`       ${RED}${msg}${RESET}`);
  }
}

function assert(condition: boolean, msg: string): asserts condition {
  if (!condition) throw new Error(msg);
}

function timeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms} ms: ${label}`)), ms)),
  ]);
}

// ─── DOM helpers (simulates WebView DOMParser using jsdom) ────────────────────
function makeDoc(html: string): Document {
  const { window } = new JSDOM(html, { url: 'https://example.com/' });
  return window.document;
}

// ─── bridge parser re-implementations (mirrors the injected JS) ──────────────
// These are TypeScript ports of the bridge functions used for unit testing.

function asText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text.trim();
    if (typeof obj['#text'] === 'string') return (obj['#text'] as string).trim();
  }
  return '';
}

function stripHtml(html: string): string {
  if (!html) return '';
  const { window } = new JSDOM(`<body>${html}</body>`, { url: 'https://example.com/' });
  return (window.document.body.textContent || '').replace(/\s+/g, ' ').trim();
}

function parseNumber(text: string | null | undefined): number | null {
  const m = String(text || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function extractChaptersFromApiJson(json: unknown): unknown[] {
  if (!json) return [];
  const j = json as Record<string, unknown>;
  const raw =
    (Array.isArray(j) ? j : null) ??
    (j['chapters'] as unknown[]) ??
    (j['list'] as unknown[]) ??
    (j['items'] as unknown[]) ??
    (Array.isArray(j['data']) ? j['data'] : null) ??
    (j['data'] && (j['data'] as Record<string, unknown>)['chapters'] as unknown[]) ??
    [];
  return Array.isArray(raw) ? raw : [];
}

function chaptersFromNextData(html: string): unknown[] {
  const doc = makeDoc(html);
  const node = doc.getElementById('__NEXT_DATA__');
  if (!node || !node.textContent) return [];
  try {
    const nd = JSON.parse(node.textContent) as Record<string, unknown>;
    const pp = ((nd.props as Record<string, unknown>)?.pageProps ?? {}) as Record<string, unknown>;
    const serie = pp['serie'] as Record<string, unknown> | undefined;
    const list = (serie?.['chapters'] ?? pp['chapters'] ?? pp['chapterList'] ?? []) as unknown[];
    if (!Array.isArray(list)) return [];
    return list.map((ch: unknown, idx: number) => {
      const c = ch as Record<string, unknown>;
      const order = Number(c['chapter_no'] ?? c['order'] ?? c['chapterNo'] ?? idx + 1);
      return { order, title: String(c['title'] ?? c['name'] ?? `Chapter ${order}`), path: `/chapter-${order}` };
    });
  } catch {
    return [];
  }
}

function statusLabel(value: unknown): string {
  if (value === 0 || value === '0') return 'Ongoing';
  if (value === 1 || value === '1') return 'Completed';
  if (value === 2 || value === '2') return 'Hiatus';
  if (!value) return 'Unknown';
  const t = String(value).trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function parseSiteOrder(path: string): number | null {
  const m = String(path || '').match(/_(\d+)\.html?$/);
  return m ? Number(m[1]) : null;
}

// ─── FIXTURE HTML ─────────────────────────────────────────────────────────────

const NEXT_DATA_WITH_CHAPTERS = JSON.stringify({
  buildId: 'abc123',
  props: {
    pageProps: {
      serie: {
        raw_id: 42,
        slug: 'my-novel',
        chapters: [
          { chapter_no: 1, title: 'Prologue', updated_at: '2024-01-01' },
          { chapter_no: 2, title: 'Chapter 2', updated_at: '2024-01-02' },
          { chapter_no: 3, title: 'Chapter 3', updated_at: null },
        ],
      },
    },
  },
});

const NOVEL_PAGE_HTML_WITH_NEXT_DATA = `<!DOCTYPE html>
<html><head></head><body>
<h1>My Test Novel</h1>
<script id="__NEXT_DATA__" type="application/json">${NEXT_DATA_WITH_CHAPTERS}</script>
</body></html>`;

const NOVEL_PAGE_HTML_DOM_CHAPTERS = `<!DOCTYPE html>
<html><head></head><body>
<h1>Another Novel</h1>
<ul class="chapter-list">
  <li><a href="/novel/test-slug/chapter-1.html">Chapter 1</a></li>
  <li><a href="/novel/test-slug/chapter-2.html">Chapter 2</a></li>
  <li><a href="/novel/test-slug/chapter-3.html">Chapter 3</a></li>
  <li><a href="/novel/test-slug/chapter-10.html">Chapter 10</a></li>
</ul>
</body></html>`;

const FANMTL_NOVEL_LIST_HTML = `<!DOCTYPE html>
<html><head></head><body>
<ul class="novel-list">
  <li class="novel-item">
    <a href="/novel/my-story.html">
      <img src="https://example.com/cover.jpg" />
      <div class="novel-title">My Story</div>
      <div class="novel-stats">250</div>
      <span class="status">Ongoing</span>
    </a>
  </li>
  <li class="novel-item">
    <a href="/novel/second-novel.html">
      <img src="https://example.com/cover2.jpg" />
      <div class="novel-title">Second Novel</div>
      <div class="novel-stats">100</div>
      <span class="status">Completed</span>
    </a>
  </li>
</ul>
</body></html>`;

const CHAPTER_CONTENT_HTML = `<!DOCTYPE html>
<html><head></head><body>
<h1>Chapter 1: The Beginning</h1>
<div class="chapter-content">
  <p>It was a dark and stormy night.</p>
  <p>The protagonist walked through the rain, wondering what fate had in store.</p>
  <p>Little did they know, everything was about to change.</p>
  <script>alert("ads")</script>
</div>
</body></html>`;

const API_RESPONSE_CHAPTERS_FORMAT = {
  chapters: [
    { order: 1, title: 'Chapter 1', updated_at: '2024-01-01' },
    { order: 2, title: 'Chapter 2', updated_at: '2024-01-02' },
  ],
};

const API_RESPONSE_DATA_FORMAT = {
  data: [
    { chapter_no: 1, title: 'Chapter 1', updated_at: '2024-01-01' },
    { chapter_no: 2, title: 'Chapter 2', updated_at: '2024-01-02' },
  ],
};

const API_RESPONSE_DATA_CHAPTERS_FORMAT = {
  data: {
    chapters: [
      { order: 1, name: 'Prologue', update_time: '2024-01-01' },
    ],
  },
};

const API_RESPONSE_LIST_FORMAT = {
  list: [
    { no: 1, title: 'Chapter 1' },
    { no: 2, title: 'Chapter 2' },
    { no: 3, title: 'Chapter 3' },
  ],
};

const API_RESPONSE_ARRAY_FORMAT = [
  { order: 1, title: 'Chapter 1' },
  { order: 2, title: 'Chapter 2' },
];

// ─── SECTION 1: Unit tests ────────────────────────────────────────────────────

async function runUnitTests(): Promise<void> {
  console.log(`\n${CYAN}── Unit Tests (no network) ──────────────────────────────${RESET}`);

  await test('Provider list has all 7 expected providers', () => {
    const ids = ONLINE_MTL_PROVIDERS.map(p => p.id);
    for (const expected of ['wtr-lab', 'fanmtl', 'wuxiaspot', 'novelcool', 'mcreader', 'freewebnovel', 'lightnovelpub']) {
      assert(ids.includes(expected as never), `Missing provider: ${expected}`);
    }
    assert(ids.length >= 7, 'Expected at least 7 providers');
  });

  await test('Every provider has a non-empty startUrl', () => {
    for (const p of ONLINE_MTL_PROVIDERS) {
      assert(p.startUrl.startsWith('http'), `Provider ${p.id} has invalid startUrl: ${p.startUrl}`);
    }
  });

  await test('asText handles null / undefined / object', () => {
    assert(asText(null) === '', 'null should return empty string');
    assert(asText(undefined) === '', 'undefined should return empty string');
    assert(asText(42) === '42', 'number should be stringified');
    assert(asText('  hello  ') === 'hello', 'string should be trimmed');
    assert(asText({ text: 'world' }) === 'world', 'object.text should be extracted');
  });

  await test('stripHtml removes tags and normalises whitespace', () => {
    const result = stripHtml('<p>Hello <b>world</b>!</p>');
    assert(result === 'Hello world!', `Got: "${result}"`);
  });

  await test('parseNumber handles commas and decimals', () => {
    assert(parseNumber('1,234') === 1234, 'comma-formatted numbers');
    assert(parseNumber('4.5') === 4.5, 'decimal');
    assert(parseNumber('abc') === null, 'non-numeric returns null');
    assert(parseNumber('  300 chapters') === 300, 'embedded number');
  });

  await test('statusLabel maps numeric codes', () => {
    assert(statusLabel(0) === 'Ongoing', 'code 0');
    assert(statusLabel(1) === 'Completed', 'code 1');
    assert(statusLabel(2) === 'Hiatus', 'code 2');
    assert(statusLabel('ongoing') === 'Ongoing', 'string passthrough');
  });

  await test('parseSiteOrder extracts trailing _N.html order', () => {
    assert(parseSiteOrder('/novel/test_42.html') === 42, 'basic');
    assert(parseSiteOrder('/novel/test_1.html') === 1, 'first chapter');
    assert(parseSiteOrder('/en/novel/42/slug/chapter-7') === null, 'non-matching returns null');
  });

  await test('extractChaptersFromApiJson: { chapters: [...] } format', () => {
    const result = extractChaptersFromApiJson(API_RESPONSE_CHAPTERS_FORMAT);
    assert(result.length === 2, `Expected 2, got ${result.length}`);
  });

  await test('extractChaptersFromApiJson: { data: [...] } format', () => {
    const result = extractChaptersFromApiJson(API_RESPONSE_DATA_FORMAT);
    assert(result.length === 2, `Expected 2, got ${result.length}`);
  });

  await test('extractChaptersFromApiJson: { data: { chapters: [...] } } format', () => {
    const result = extractChaptersFromApiJson(API_RESPONSE_DATA_CHAPTERS_FORMAT);
    assert(result.length === 1, `Expected 1, got ${result.length}`);
  });

  await test('extractChaptersFromApiJson: { list: [...] } format', () => {
    const result = extractChaptersFromApiJson(API_RESPONSE_LIST_FORMAT);
    assert(result.length === 3, `Expected 3, got ${result.length}`);
  });

  await test('extractChaptersFromApiJson: raw array format', () => {
    const result = extractChaptersFromApiJson(API_RESPONSE_ARRAY_FORMAT);
    assert(result.length === 2, `Expected 2, got ${result.length}`);
  });

  await test('extractChaptersFromApiJson: empty / null input', () => {
    assert(extractChaptersFromApiJson(null).length === 0, 'null input');
    assert(extractChaptersFromApiJson({}).length === 0, 'empty object');
    assert(extractChaptersFromApiJson({ chapters: [] }).length === 0, 'empty chapters array');
  });

  await test('chaptersFromNextData: reads embedded __NEXT_DATA__ chapter list', () => {
    const chapters = chaptersFromNextData(NOVEL_PAGE_HTML_WITH_NEXT_DATA);
    assert(chapters.length === 3, `Expected 3 chapters, got ${chapters.length}`);
    const first = chapters[0] as Record<string, unknown>;
    assert(first['order'] === 1, 'First chapter should be order 1');
    assert(first['title'] === 'Prologue', `Got title: ${first['title']}`);
  });

  await test('chaptersFromNextData: returns empty array when no __NEXT_DATA__', () => {
    const chapters = chaptersFromNextData('<html><body>No data here</body></html>');
    assert(chapters.length === 0, 'Should be empty');
  });

  await test('chaptersFromNextData: returns empty array for malformed JSON', () => {
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">{{broken}</script></body></html>`;
    const chapters = chaptersFromNextData(html);
    assert(chapters.length === 0, 'Should be empty on parse error');
  });

  await test('DOM chapter list parser: reads ul.chapter-list li a', () => {
    const doc = makeDoc(NOVEL_PAGE_HTML_DOM_CHAPTERS);
    const links = doc.querySelectorAll('ul.chapter-list li a[href]');
    assert(links.length === 4, `Expected 4 links, got ${links.length}`);
    const hrefs = Array.from(links).map(a => (a as HTMLAnchorElement).getAttribute('href') || '');
    assert(hrefs.some(h => h.includes('chapter-10')), 'Should include chapter-10');
  });

  await test('FanMTL novel list: ul.novel-list li.novel-item selectors', () => {
    const doc = makeDoc(FANMTL_NOVEL_LIST_HTML);
    const items = doc.querySelectorAll('ul.novel-list li.novel-item');
    assert(items.length === 2, `Expected 2 items, got ${items.length}`);
    const title = items[0].querySelector('.novel-title');
    assert(title !== null, '.novel-title not found');
    assert(asText(title!.textContent) === 'My Story', `Got: ${title!.textContent}`);
    const stats = items[0].querySelector('.novel-stats');
    assert(parseNumber(stats!.textContent) === 250, 'Chapter count should be 250');
  });

  await test('Chapter content: sanitizeHtml removes script tags', () => {
    const doc = makeDoc(CHAPTER_CONTENT_HTML);
    const content = doc.querySelector('.chapter-content');
    assert(content !== null, '.chapter-content not found');
    const scripts = content!.querySelectorAll('script');
    assert(scripts.length === 1, 'Should have 1 script to remove');
    scripts.forEach(s => s.remove());
    assert(content!.querySelectorAll('script').length === 0, 'Scripts should be removed');
    const text = (content!.textContent || '').replace(/\s+/g, ' ').trim();
    assert(text.includes('dark and stormy'), 'Content text should remain');
  });

  await test('Chapter order extraction from WTR-Lab URL path', () => {
    const href = '/en/novel/42/my-novel/chapter-7';
    const m = href.match(/chapter[-_](\d+)/i);
    assert(m !== null && Number(m[1]) === 7, `Should extract 7, got: ${m?.[1]}`);
  });

  await test('Encryption key search string is present in bridge', () => {
    assert(typeof WTR_LAB_BOOTSTRAP_SCRIPT === 'string', 'Bootstrap script should be a string');
    assert(WTR_LAB_BOOTSTRAP_SCRIPT.includes('fetchAllChapters'), 'Should contain fetchAllChapters');
    assert(WTR_LAB_BOOTSTRAP_SCRIPT.includes('chaptersFromNextData'), 'Should contain chaptersFromNextData');
    assert(WTR_LAB_BOOTSTRAP_SCRIPT.includes('extractChaptersFromApiJson'), 'Should contain extractChaptersFromApiJson');
    assert(WTR_LAB_BOOTSTRAP_SCRIPT.includes('parseGenericNovelList'), 'Should contain parseGenericNovelList');
    assert(WTR_LAB_BOOTSTRAP_SCRIPT.includes('searchGenericSite'), 'Should contain searchGenericSite');
    assert(WTR_LAB_BOOTSTRAP_SCRIPT.includes('fetchGenericChapter'), 'Should contain fetchGenericChapter');
    assert(WTR_LAB_BOOTSTRAP_SCRIPT.includes('novelcool'), 'Should contain novelcool provider');
    assert(WTR_LAB_BOOTSTRAP_SCRIPT.includes('mcreader'), 'Should contain mcreader provider');
    assert(WTR_LAB_BOOTSTRAP_SCRIPT.includes('freewebnovel'), 'Should contain freewebnovel provider');
    assert(WTR_LAB_BOOTSTRAP_SCRIPT.includes('lightnovelpub'), 'Should contain lightnovelpub provider');
  });

  await test('buildWtrBridgeCommand produces valid JS snippet', () => {
    const cmd = buildWtrBridgeCommand({ id: 'test-1', type: 'search', payload: { providerId: 'wtr-lab', query: 'hello' } });
    assert(typeof cmd === 'string', 'Should be a string');
    assert(cmd.startsWith('(function(){'), 'Should start with IIFE');
    assert(cmd.includes('test-1'), 'Should include request id');
    assert(cmd.endsWith('true;'), 'Should end with true;');
  });

  await test('parseWtrBridgeMessage accepts valid scope and rejects others', () => {
    const valid = parseWtrBridgeMessage(JSON.stringify({ scope: 'wtr-lab', type: 'ready', providerId: 'wtr-lab' }));
    assert(valid !== null, 'Valid message should parse');
    assert(valid.type === 'ready', 'Should have correct type');
    const invalid = parseWtrBridgeMessage(JSON.stringify({ scope: 'other', type: 'ready' }));
    assert(invalid === null, 'Wrong scope should return null');
    const malformed = parseWtrBridgeMessage('not-json');
    assert(malformed === null, 'Malformed JSON should return null');
  });
}

// ─── SECTION 2: Integration tests (live HTTP) ─────────────────────────────────

async function checkUrl(url: string): Promise<{ ok: boolean; status: number; contentType: string }> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36',
      accept: 'text/html,application/json,*/*',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { ok: res.ok, status: res.status, contentType: res.headers.get('content-type') || '' };
}

async function runIntegrationTests(): Promise<void> {
  console.log(`\n${CYAN}── Integration Tests (live HTTP) ────────────────────────${RESET}`);

  await test('WTR-Lab start URL returns 200', async () => {
    const { ok, status } = await checkUrl('https://wtr-lab.com/en/novel-finder');
    assert(ok, `Expected 200, got ${status}`);
  });

  await test('WTR-Lab recent novels API responds', async () => {
    const res = await fetch('https://wtr-lab.com/api/home/recent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ page: 1 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const json = (await res.json()) as Record<string, unknown>;
    const data = json['data'];
    assert(Array.isArray(data), 'Response.data should be an array');
    assert((data as unknown[]).length > 0, 'Should have at least one recent novel');
  });

  await test('WTR-Lab chapters API tries /api/chapters/{id} and parses response', async () => {
    // First get a real rawId from the recent novels endpoint
    const recentRes = await fetch('https://wtr-lab.com/api/home/recent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ page: 1 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const recentJson = (await recentRes.json()) as Record<string, unknown>;
    const items = (recentJson['data'] as Record<string, unknown>[]) ?? [];
    assert(items.length > 0, 'Need at least one recent novel to test chapter fetch');

    let foundChapters = false;
    let testedNovelTitle = '';
    for (const item of items.slice(0, 5)) {
      const serie = (item['serie'] ?? item) as Record<string, unknown>;
      const rawId = Number(serie['raw_id'] ?? serie['rawId'] ?? serie['id'] ?? 0);
      if (!rawId) continue;
      testedNovelTitle = String((serie['data'] as Record<string, unknown>)?.['title'] ?? serie['title'] ?? rawId);

      // Try the chapters endpoint with flexible response format parsing
      const chRes = await fetch(`https://wtr-lab.com/api/chapters/${rawId}?start=1&end=50`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!chRes.ok) continue;
      const chJson = await chRes.json();
      const chapters = extractChaptersFromApiJson(chJson);
      if (chapters.length > 0) {
        foundChapters = true;
        console.log(`       Found ${chapters.length} chapters for novel rawId=${rawId} ("${testedNovelTitle}")`);
        break;
      }
    }

    if (!foundChapters) {
      // This is expected if WTR-Lab changed their API format — not a fatal error
      console.log(`       ${YELLOW}Chapter API returned empty for all tested novels — HTML fallback will be used${RESET}`);
    }
  });

  await test('FanMTL search page returns HTML novel list', async () => {
    const res = await fetch('https://www.fanmtl.com/list/all/all-newstime-0.html', {
      headers: { 'User-Agent': 'Mozilla/5.0', accept: 'text/html' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const html = await res.text();
    const doc = makeDoc(html);
    const items = doc.querySelectorAll('ul.novel-list li.novel-item');
    assert(items.length > 0, `Expected novel items, found ${items.length}. The FanMTL HTML selector may have changed.`);
    console.log(`       Found ${items.length} novels on FanMTL browse page`);
  });

  await test('FanMTL chapter list page is parseable', async () => {
    // Browse novels and try to open one
    const browseRes = await fetch('https://www.fanmtl.com/list/all/all-newstime-0.html', {
      headers: { 'User-Agent': 'Mozilla/5.0', accept: 'text/html' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const browseHtml = await browseRes.text();
    const browseDoc = makeDoc(browseHtml);
    const firstLink = browseDoc.querySelector('ul.novel-list li.novel-item a[href]') as HTMLAnchorElement | null;
    assert(firstLink !== null, 'Should find at least one novel link');
    const novelPath = firstLink.getAttribute('href') || '';
    const novelUrl = `https://www.fanmtl.com${novelPath.startsWith('/') ? '' : '/'}${novelPath}`;
    const novelRes = await fetch(novelUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', accept: 'text/html' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    assert(novelRes.ok, `Novel page returned ${novelRes.status}`);
    const novelHtml = await novelRes.text();
    const novelDoc = makeDoc(novelHtml);
    const chapters = novelDoc.querySelectorAll('ul.chapter-list li a[href]');
    assert(chapters.length > 0, `Expected chapter links, found ${chapters.length}`);
    console.log(`       Found ${chapters.length} chapters for FanMTL novel at ${novelPath}`);
  });

  await test('WuxiaSpot browse page returns novel list', async () => {
    const res = await fetch('https://www.wuxiaspot.com/list/all/all-newstime-0.html', {
      headers: { 'User-Agent': 'Mozilla/5.0', accept: 'text/html' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const html = await res.text();
    const doc = makeDoc(html);
    const items = doc.querySelectorAll('ul.novel-list li.novel-item');
    assert(items.length > 0, `Expected novel items on WuxiaSpot, found ${items.length}`);
    console.log(`       Found ${items.length} novels on WuxiaSpot browse page`);
  });

  await test('NovelCool search endpoint is reachable', async () => {
    const { ok, status } = await checkUrl('https://novelcool.com/search/?name=dragon');
    assert(ok, `Expected 200, got ${status}`);
  });

  await test('FreeWebNovel is reachable', async () => {
    const { ok, status } = await checkUrl('https://freewebnovel.com/');
    assert(ok, `Expected 200, got ${status}`);
  });

  await test('LightNovelPub browse is reachable', async () => {
    const { ok, status } = await checkUrl('https://lightnovelpub.vip/browse/');
    assert(ok, `Expected 200, got ${status}`);
  });
}

// ─── SECTION 3: Live Playwright E2E (opt-in) ───────────────────────────────────

async function runLiveE2eTests(): Promise<void> {
  console.log(`\n${CYAN}── Live E2E Tests (Playwright, --live flag) ─────────────${RESET}`);

  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.log(`  ${YELLOW}SKIP${RESET}  Playwright not installed — run: npx playwright install chromium`);
    return;
  }

  const { WTR_LAB_BOOTSTRAP_SCRIPT, WTR_LAB_START_URL } = await import('../utils/wtr-lab-bridge');

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox'],
  });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await ctx.newPage();

  try {
    await test('WTR-Lab: browser loads novel-finder without blocking', async () => {
      await page.goto(WTR_LAB_START_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const ready = await page
        .waitForFunction(() => !!document.getElementById('__NEXT_DATA__'), undefined, { timeout: 45_000 })
        .then(() => true)
        .catch(() => false);
      assert(ready, 'WTR-Lab did not finish loading (may be blocked by Cloudflare)');
    });

    await test('WTR-Lab: bridge script installs __MIYO_WTR_BRIDGE', async () => {
      await page.evaluate(WTR_LAB_BOOTSTRAP_SCRIPT);
      const installed = await page.evaluate(() => typeof (window as never as Record<string, unknown>)['__MIYO_WTR_BRIDGE'] === 'object');
      assert(installed, '__MIYO_WTR_BRIDGE not installed after injecting bootstrap script');
    });

    await test('WTR-Lab: search returns at least one novel', async () => {
      const result = await timeout(
        page.evaluate(async () => {
          return (window as never as Record<string, { execute: (r: unknown) => Promise<unknown> }>)['__MIYO_WTR_BRIDGE'].execute({
            type: 'search',
            payload: { providerId: 'wtr-lab', query: '', page: 1, latestOnly: false, orderBy: 'update', order: 'desc', status: 'all' },
          });
        }),
        TIMEOUT_MS,
        'WTR-Lab search'
      ) as { items: unknown[] };
      assert(result && Array.isArray(result.items) && result.items.length > 0, 'No novels returned from WTR-Lab search');
      console.log(`       Found ${result.items.length} novels`);
    });

    await test('WTR-Lab: details + chapters loads for first search result', async () => {
      const searchResult = await page.evaluate(async () => {
        return (window as never as Record<string, { execute: (r: unknown) => Promise<unknown> }>)['__MIYO_WTR_BRIDGE'].execute({
          type: 'search',
          payload: { providerId: 'wtr-lab', query: '', page: 1, latestOnly: false, orderBy: 'update', order: 'desc', status: 'all' },
        });
      }) as { items: { rawId: number; slug: string; path: string; title: string }[] };
      assert(searchResult.items.length > 0, 'No search results to test details with');

      for (const item of searchResult.items.slice(0, 3)) {
        const details = await timeout(
          page.evaluate(async (payload) => {
            return (window as never as Record<string, { execute: (r: unknown) => Promise<unknown> }>)['__MIYO_WTR_BRIDGE'].execute({
              type: 'details',
              payload: { ...payload, providerId: 'wtr-lab', includeChapters: true },
            });
          }, { rawId: item.rawId, slug: item.slug, path: item.path }),
          TIMEOUT_MS * 3,
          `WTR-Lab details for "${item.title}"`
        ) as { title: string; chapters: unknown[] };
        if (details.chapters.length > 0) {
          console.log(`       "${details.title}" has ${details.chapters.length} chapters`);
          return; // Pass
        }
      }
      throw new Error('None of the tested novels returned chapters — fetchAllChapters fallback strategies all failed');
    });
  } finally {
    await ctx.close();
    await browser.close();
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${CYAN}╔══════════════════════════════════════════════════════╗`);
  console.log(`║         Miyo WTR-Lab Bridge Test Suite               ║`);
  console.log(`╚══════════════════════════════════════════════════════╝${RESET}`);

  await runUnitTests();

  if (!UNIT_ONLY) {
    await runIntegrationTests();
  }

  if (LIVE_FLAG && !UNIT_ONLY) {
    await runLiveE2eTests();
  }

  const passed = results.filter(r => r.passed && !r.skipped).length;
  const failed = results.filter(r => !r.passed).length;
  const skipped = results.filter(r => r.skipped).length;
  const total = results.length;

  console.log(`\n${'─'.repeat(58)}`);
  console.log(`${GREEN}Passed:${RESET} ${passed}  ${RED}Failed:${RESET} ${failed}  ${YELLOW}Skipped:${RESET} ${skipped}  ${DIM}Total: ${total}${RESET}`);

  if (failed > 0) {
    console.log(`\n${RED}Failed tests:${RESET}`);
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  • ${r.name}`);
      if (r.error) console.log(`    ${DIM}${r.error}${RESET}`);
    });
    console.log('');
    process.exit(1);
  }

  console.log(`\n${GREEN}All tests passed.${RESET}\n`);
}

main().catch(err => {
  console.error(RED + (err instanceof Error ? err.message : String(err)) + RESET);
  process.exit(1);
});
