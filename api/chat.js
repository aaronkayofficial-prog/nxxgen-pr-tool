// PressReachOut /api/chat.js — STREAMING-AWARE VERSION
//
// Streams the response back to the browser ONLY when the frontend sets
// `stream: true` in the request body. For every other call (Write for me,
// press release generation, email drafting, etc.) it behaves like the
// original non-streaming proxy and returns one JSON response.
//
// This means:
//   - callAPIWithSearch (which reads streams) gets the streaming response
//     it needs to bypass Vercel's 60s timeout on deep web searches.
//   - All the other /api/chat callers keep getting the JSON shape they expect.

export const config = {
  maxDuration: 300
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY environment variable is not set' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // KEY DECISION: stream only if the frontend explicitly asked for it.
    // Default = non-streaming (preserves existing behaviour for Write-for-me etc).
    const wantsStream = body.stream === true;

    const upstreamHeaders = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    };

    // ─────────────────────────────────────────────────────────────
    // PATH A — Non-streaming (the default, original behaviour)
    // ─────────────────────────────────────────────────────────────
    if (!wantsStream) {
      delete body.stream;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: upstreamHeaders,
        body: JSON.stringify(body)
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    }

    // ─────────────────────────────────────────────────────────────
    // PATH B — Streaming (used only by callAPIWithSearch for deep search)
    // ─────────────────────────────────────────────────────────────
    body.stream = true;

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify(body)
    });

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text();
      let errJson;
      try { errJson = JSON.parse(errText); } catch (_) { errJson = { error: errText }; }
      return res.status(upstream.status).json(errJson);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders && res.flushHeaders();

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
        if (typeof res.flush === 'function') res.flush();
      }
    } catch (streamErr) {
      try {
        res.write('event: error\ndata: ' + JSON.stringify({ error: streamErr.message }) + '\n\n');
      } catch (_) {}
    } finally {
      res.end();
    }

  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message });
    } else {
      try {
        res.write('event: error\ndata: ' + JSON.stringify({ error: error.message }) + '\n\n');
      } catch (_) {}
      res.end();
    }
  }
}
