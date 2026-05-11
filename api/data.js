// PressReachOut /api/data.js — with Pass 3 caching support
//
// Adds two new actions for the result-caching layer:
//   - getCachedResearch: retrieves a cached search result if it exists and is
//     less than 7 days old, keyed by (pathway, industry, secondary, countries,
//     filter)
//   - saveCachedResearch: stores a successful AI search result so subsequent
//     searches for the same combination return instantly from cache
//
// Requires a new Supabase table `cached_research` — see the SQL command
// provided alongside this file.

function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf-8');
    const claims = JSON.parse(decoded);
    if (claims.exp && Date.now() >= claims.exp * 1000) return null;
    return claims;
  } catch (e) {
    return null;
  }
}

async function verifyToken(token) {
  const claims = decodeJWT(token);
  return claims ? claims.sub : null;
}

function supabaseHeaders(key) {
  return {
    'Content-Type': 'application/json',
    'apikey': key,
    'Authorization': 'Bearer ' + key
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token' });
  }
  const token = authHeader.replace('Bearer ', '');
  const userId = await verifyToken(token);
  if (!userId) return res.status(401).json({ error: 'Invalid token' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const headers = supabaseHeaders(supabaseKey);
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { action, data } = body;

  try {
    if (action === 'getUser') {
      const r = await fetch(supabaseUrl + '/rest/v1/users?id=eq.' + userId + '&select=*', { headers });
      const rows = await r.json();
      return res.status(200).json(rows[0] || null);
    }

    if (action === 'saveUser') {
      const payload = Object.assign({ id: userId }, data);
      const r = await fetch(supabaseUrl + '/rest/v1/users', {
        method: 'POST',
        headers: Object.assign({}, headers, { 'Prefer': 'resolution=merge-duplicates' }),
        body: JSON.stringify(payload)
      });
      if (!r.ok) { const e = await r.text(); return res.status(500).json({ error: e }); }
      return res.status(200).json({ ok: true });
    }

    if (action === 'getCampaigns') {
      const r = await fetch(supabaseUrl + '/rest/v1/campaigns?user_id=eq.' + userId + '&order=created_at.desc&select=*', { headers });
      const rows = await r.json();
      return res.status(200).json(rows);
    }

    if (action === 'saveCampaign') {
      const payload = Object.assign({ user_id: userId }, data);
      const r = await fetch(supabaseUrl + '/rest/v1/campaigns', {
        method: 'POST',
        headers: Object.assign({}, headers, { 'Prefer': 'resolution=merge-duplicates' }),
        body: JSON.stringify(payload)
      });
      if (!r.ok) { const e = await r.text(); return res.status(500).json({ error: e }); }
      return res.status(200).json({ ok: true });
    }

    if (action === 'deleteCampaign') {
      const r = await fetch(supabaseUrl + '/rest/v1/campaigns?id=eq.' + data.id + '&user_id=eq.' + userId, {
        method: 'DELETE',
        headers
      });
      if (!r.ok) { const e = await r.text(); return res.status(500).json({ error: e }); }
      return res.status(200).json({ ok: true });
    }

    if (action === 'getUsage') {
      const today = new Date().toISOString().slice(0, 10);
      const r = await fetch(supabaseUrl + '/rest/v1/daily_usage?user_id=eq.' + userId + '&date=eq.' + today + '&select=count', { headers });
      const rows = await r.json();
      return res.status(200).json({ count: rows[0] ? rows[0].count : 0 });
    }

    if (action === 'incrementUsage') {
      const today = new Date().toISOString().slice(0, 10);
      const insertRes = await fetch(supabaseUrl + '/rest/v1/daily_usage', {
        method: 'POST',
        headers: Object.assign({}, headers, { 'Prefer': 'resolution=ignore-duplicates' }),
        body: JSON.stringify({ user_id: userId, date: today, count: 1 })
      });
      if (insertRes.status === 409 || insertRes.status === 201 || !insertRes.ok) {
        const rpcRes = await fetch(supabaseUrl + '/rest/v1/rpc/increment_usage', {
          method: 'POST',
          headers,
          body: JSON.stringify({ p_user_id: userId, p_date: today })
        });
        const updated = await fetch(supabaseUrl + '/rest/v1/daily_usage?user_id=eq.' + userId + '&date=eq.' + today + '&select=count', { headers });
        const rows = await updated.json();
        return res.status(200).json({ count: rows[0] ? rows[0].count : 1 });
      }
      return res.status(200).json({ count: 1 });
    }

    // ─────────────────────────────────────────────────────────────
    // PASS 3 — CACHED RESEARCH RESULTS (Item 7)
    // ─────────────────────────────────────────────────────────────
    if (action === 'getCachedResearch') {
      if (!data || !data.key) return res.status(400).json({ error: 'Missing cache key' });
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const r = await fetch(
        supabaseUrl + '/rest/v1/cached_research?cache_key=eq.' + encodeURIComponent(data.key) +
        '&created_at=gte.' + encodeURIComponent(cutoff) +
        '&order=created_at.desc&limit=1&select=*',
        { headers }
      );
      if (!r.ok) {
        return res.status(200).json(null);
      }
      const rows = await r.json();
      return res.status(200).json(rows[0] || null);
    }

    if (action === 'saveCachedResearch') {
      if (!data || !data.key || !data.results) return res.status(400).json({ error: 'Missing key or results' });
      const payload = {
        cache_key: data.key,
        pathway: data.pathway || 'A',
        industry: data.industry || '',
        countries: data.countries || '',
        results: data.results,
        count: data.count || 0,
        last_user_id: userId
      };
      const r = await fetch(supabaseUrl + '/rest/v1/cached_research', {
        method: 'POST',
        headers: Object.assign({}, headers, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(payload)
      });
      if (!r.ok) {
        const e = await r.text();
        return res.status(200).json({ ok: false, warn: e });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
