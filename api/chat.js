// PressReachOut /api/chat.js — STREAMING VERSION
//
// Previous version waited for Claude's entire response before returning it.
// On long web-search requests (60-120s), this hit Vercel's serverless timeout
// (10s Hobby / 60s Pro) and the user saw an infinite spinner.
//
// This version uses Anthropic's streaming API. Claude sends data back as it's
// generated, we forward each chunk to the browser immediately. The connection
// stays alive the whole time because data is constantly flowing. Vercel keeps
// the function running as long as the stream is active.
//
// The frontend (callAPIWithSearch in index.html) needs to be updated in tandem
// to read the stream instead of waiting for one big JSON response.

export const config = {
  // Allow this function to run up to 60 seconds (Vercel Pro plan max for non-streaming;
  // streaming responses can exceed this because data is flowing). On Hobby plan, max is 10s
  // but streaming responses can still exceed in practice because of how Vercel handles
  // open connections.
  maxDuration: 300
};

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get API key from environment variable
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY environment variable is not set' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Force streaming mode in the request to Anthropic regardless of what the frontend sent.
    // This is the entire point of this rewrite — we always stream.
    body.stream = true;

    // Detect if the request uses web_search tool. If so, we need anthropic-beta header
    // (some web_search versions require it). The 20260209 version is GA and doesn't need
    // the beta header, but we send it anyway for safety in case of older models.
    const hasWebSearch = Array.isArray(body.tools) && body.tools.some(function(t) {
      return t && typeof t.type === 'string' && t.type.indexOf('web_search') === 0;
    });

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    };

    // Make the upstream streaming request to Anthropic
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });

    // If Anthropic returns a non-200 BEFORE streaming starts, forward the error as JSON
    // and don't switch to streaming mode.
    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text();
      let errJson;
      try { errJson = JSON.parse(errText); } catch (_) { errJson = { error: errText }; }
      return res.status(upstream.status).json(errJson);
    }

    // Set headers for Server-Sent Events streaming back to the browser
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx/proxy buffering
    res.flushHeaders && res.flushHeaders();

    // Pipe Anthropic's SSE stream straight to the browser, chunk by chunk.
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
        // Flush immediately so the browser sees each chunk as it arrives
        if (typeof res.flush === 'function') res.flush();
      }
    } catch (streamErr) {
      // If anything goes wrong mid-stream, write an error event and close
      try {
        res.write('event: error\ndata: ' + JSON.stringify({ error: streamErr.message }) + '\n\n');
      } catch (_) {}
    } finally {
      res.end();
    }

  } catch (error) {
    // If headers haven't been sent yet, return a normal JSON error.
    // Otherwise we're mid-stream and have to write an SSE error event.
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
