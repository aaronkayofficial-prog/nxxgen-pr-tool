// PressReachOut /api/search-test.js
//
// Test harness for comparing AI search architectures.
// Call this endpoint with { candidate: 'A' | 'C', query: { industry, country, pathway } }
// Returns: { candidate, timeMs, contactsFound, contacts: [...], debug: { ... } }
//
// Candidate A — Exa Search + Claude extraction
//   1. POST to Exa /search with contents=true
//   2. Exa returns ranked URLs + extracted page text
//   3. Pass that text to Claude, ask to extract structured contacts
//   4. Return as JSON
//
// Candidate C — Chained Claude calls (no web_search tool, no Exa)
//   1. Claude call: "List N podcasts about X in country Y" — returns names+URLs
//   2. Backend fetch each URL (with timeout, follow redirects)
//   3. Claude call: "Extract emails from these pages" — returns structured contacts
//
// Both candidates return contacts in the same schema so we can compare apples-to-apples.

export const config = {
  maxDuration: 300  // Allow up to 5 minutes for the slower candidates
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const startMs = Date.now();
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { candidate, query } = body;
  if (!candidate || !query) {
    return res.status(400).json({ error: 'Missing candidate or query' });
  }
  if (!query.industry || !query.country || !query.pathway) {
    return res.status(400).json({ error: 'query must include industry, country, pathway' });
  }

  try {
    let result;
    if (candidate === 'A') {
      result = await runCandidateA(query);
    } else if (candidate === 'C') {
      result = await runCandidateC(query);
    } else {
      return res.status(400).json({ error: 'Unknown candidate. Use A or C.' });
    }
    const timeMs = Date.now() - startMs;
    return res.status(200).json({
      candidate,
      query,
      timeMs,
      contactsFound: result.contacts ? result.contacts.length : 0,
      contacts: result.contacts || [],
      debug: result.debug || {}
    });
  } catch (err) {
    const timeMs = Date.now() - startMs;
    return res.status(500).json({
      candidate,
      query,
      timeMs,
      error: err.message,
      stack: err.stack
    });
  }
}

// ────────────────────────────────────────────────────────────────────
// CANDIDATE A — Exa Search + Claude extraction
// ────────────────────────────────────────────────────────────────────
async function runCandidateA(query) {
  const exaKey = process.env.EXA_API_KEY;
  if (!exaKey) throw new Error('EXA_API_KEY not configured in Vercel');

  // Step 1: Build a smart search query for Exa.
  // Exa is best at finding pages with specific content, so we describe the page we want.
  const searchQuery = buildExaQuery(query);

  // Step 2: Call Exa /search with contents=true so we get page text in one call.
  const exaStart = Date.now();
  const exaRes = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': exaKey
    },
    body: JSON.stringify({
      query: searchQuery,
      type: 'neural',
      numResults: 25,
      contents: {
        text: { maxCharacters: 3000 }
      }
    })
  });

  if (!exaRes.ok) {
    const txt = await exaRes.text();
    throw new Error('Exa API error ' + exaRes.status + ': ' + txt.substring(0, 500));
  }
  const exaJson = await exaRes.json();
  const exaTimeMs = Date.now() - exaStart;
  const results = exaJson.results || [];

  if (results.length === 0) {
    return {
      contacts: [],
      debug: { exaTimeMs, exaQuery: searchQuery, exaResultCount: 0, note: 'Exa returned no results' }
    };
  }

  // Step 3: Format Exa results as input to Claude.
  // We give Claude one "page" per result with its URL and text content.
  const pagesText = results.map(function(r, i) {
    return '═══ PAGE ' + (i + 1) + ' ═══\n' +
      'URL: ' + r.url + '\n' +
      'TITLE: ' + (r.title || '') + '\n' +
      'CONTENT:\n' + (r.text || '').substring(0, 3000);
  }).join('\n\n');

  // Step 4: Ask Claude to extract structured contact info from the pages.
  const extractPrompt = buildExtractPrompt(query, pagesText);
  const claudeStart = Date.now();
  const claudeRes = await callClaude(extractPrompt, 4000);
  const claudeTimeMs = Date.now() - claudeStart;

  // Step 5: Parse JSON from Claude's response.
  const contacts = parseJsonArrayFromText(claudeRes.text);

  return {
    contacts: contacts,
    debug: {
      exaTimeMs,
      claudeTimeMs,
      exaQuery: searchQuery,
      exaResultCount: results.length,
      claudeResponseLength: claudeRes.text.length,
      claudeResponseFirst500: claudeRes.text.substring(0, 500),
      claudeUsage: claudeRes.usage,
      parseSucceeded: contacts.length > 0
    }
  };
}

function buildExaQuery(query) {
  const { industry, country, pathway } = query;
  if (pathway === 'podcast') {
    return industry + ' podcast contact page booking email host ' + country;
  } else if (pathway === 'press-release' || pathway === 'A') {
    return industry + ' news editor email contact page ' + country + ' publication';
  } else if (pathway === 'story-pitch' || pathway === 'B') {
    return industry + ' journalist features writer email ' + country;
  } else if (pathway === 'local') {
    return 'local news ' + country + ' contact email tips editor';
  }
  return industry + ' ' + country + ' contact email';
}

function buildExtractPrompt(query, pagesText) {
  const { industry, country, pathway } = query;
  return [
    'You are extracting structured contact data from web pages.',
    'You are NOT searching the web — all the data you need is in the pages below.',
    '',
    'TASK: Extract every podcast or publication contact you can find. For each contact, return:',
    '  - n: Name of the podcast/publication',
    '  - u: Website URL',
    '  - e: Contact email (must literally appear in the page text)',
    '  - contact: Person name (host, editor) if mentioned, else "Editorial Team"',
    '  - role: Their role (e.g. "Host", "Booking Manager", "Editor")',
    '  - source: The URL of the page where you found the email (from the PAGE blocks below)',
    '  - confidence: 95 if email is clearly on official contact/about page, 80 if on bio/profile, 60 if pattern-matched',
    '  - confLabel: "Verified", "Strong", or "Moderate"',
    '  - desc: One sentence what they cover',
    '',
    'RULES:',
    '- If a page has no email visible, SKIP IT. Do not invent.',
    '- If an email is in the page text, the source URL is the URL of that page.',
    '- Multiple contacts from one page = multiple entries.',
    '',
    'CONTEXT: Looking for ' + industry + ' ' + pathway + ' contacts in ' + country + '.',
    '',
    'OUTPUT: JSON array only. No prose. Start with [. End with ].',
    '',
    '═══ PAGES TO EXTRACT FROM ═══',
    pagesText
  ].join('\n');
}

// ────────────────────────────────────────────────────────────────────
// CANDIDATE C — Chained Claude calls (no web_search, no Exa)
// ────────────────────────────────────────────────────────────────────
async function runCandidateC(query) {
  const { industry, country, pathway } = query;

  // Step 1: Ask Claude to list podcasts/publications + likely URLs.
  const listPrompt = buildListPrompt(query);
  const listStart = Date.now();
  const listRes = await callClaude(listPrompt, 2000);
  const listTimeMs = Date.now() - listStart;
  const listed = parseJsonArrayFromText(listRes.text);

  if (listed.length === 0) {
    return {
      contacts: [],
      debug: { listTimeMs, listFailed: true, listRaw: listRes.text.substring(0, 500) }
    };
  }

  // Step 2: For each listed item, fetch the contact page (best effort).
  const fetchStart = Date.now();
  const fetched = await Promise.all(listed.slice(0, 15).map(async function(item) {
    try {
      const url = item.contactUrl || item.url;
      if (!url) return { ...item, fetchedText: '', fetchError: 'no url' };
      const r = await fetchWithTimeout(url, 10000);
      if (!r.ok) return { ...item, fetchedText: '', fetchError: 'http ' + r.status };
      const text = await r.text();
      return { ...item, fetchedText: stripHtml(text).substring(0, 3000), fetchError: null };
    } catch (e) {
      return { ...item, fetchedText: '', fetchError: e.message };
    }
  }));
  const fetchTimeMs = Date.now() - fetchStart;
  const successfulFetches = fetched.filter(function(f) { return !f.fetchError && f.fetchedText; });

  if (successfulFetches.length === 0) {
    return {
      contacts: [],
      debug: {
        listTimeMs,
        fetchTimeMs,
        listed: listed.length,
        fetched: fetched.length,
        successful: 0,
        fetchErrors: fetched.map(function(f) { return f.fetchError; })
      }
    };
  }

  // Step 3: Ask Claude to extract emails from the fetched pages.
  const pagesText = successfulFetches.map(function(f, i) {
    return '═══ PAGE ' + (i + 1) + ' ═══\n' +
      'NAME: ' + f.name + '\n' +
      'URL: ' + (f.contactUrl || f.url) + '\n' +
      'CONTENT:\n' + f.fetchedText;
  }).join('\n\n');

  const extractPrompt = buildExtractPrompt(query, pagesText);
  const extractStart = Date.now();
  const extractRes = await callClaude(extractPrompt, 4000);
  const extractTimeMs = Date.now() - extractStart;
  const contacts = parseJsonArrayFromText(extractRes.text);

  return {
    contacts: contacts,
    debug: {
      listTimeMs,
      fetchTimeMs,
      extractTimeMs,
      listed: listed.length,
      fetched: fetched.length,
      successful: successfulFetches.length,
      claudeUsage: {
        list: listRes.usage,
        extract: extractRes.usage
      }
    }
  };
}

function buildListPrompt(query) {
  const { industry, country, pathway } = query;
  let what = 'podcasts';
  if (pathway === 'press-release' || pathway === 'A') what = 'news publications';
  else if (pathway === 'story-pitch' || pathway === 'B') what = 'publications with feature writers';
  else if (pathway === 'local') what = 'local news outlets';

  return [
    'List 20 real, currently active ' + what + ' covering ' + industry + ' in ' + country + '.',
    'For each, provide:',
    '  - name: Their actual name',
    '  - url: Their main website URL',
    '  - contactUrl: Their likely contact/about page URL (e.g. "https://podcast.com/contact")',
    '',
    'OUTPUT: JSON array only. No prose. Start with [.',
    'Example: [{"name":"Podcast Name","url":"https://podcast.com","contactUrl":"https://podcast.com/contact"}]'
  ].join('\n');
}

// ────────────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────────────
async function callClaude(prompt, maxTokens) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: maxTokens || 2000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error('Claude API ' + res.status + ': ' + errText.substring(0, 300));
  }
  const data = await res.json();
  const text = (data.content || []).map(function(b) { return b.text || ''; }).join('');
  return { text, usage: data.usage };
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(function() { controller.abort(); }, timeoutMs);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PressReachOut/1.0)' }
    });
    return r;
  } finally {
    clearTimeout(timeoutId);
  }
}

function stripHtml(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseJsonArrayFromText(text) {
  if (!text) return [];
  let clean = text.trim();
  clean = clean.replace(/```json/gi, '').replace(/```/g, '');
  const start = clean.indexOf('[');
  const end = clean.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  clean = clean.substring(start, end + 1);
  clean = clean.replace(/,\s*([}\]])/g, '$1');
  clean = clean.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
  try {
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}
