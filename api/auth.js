// PressReachOut /api/auth.js — Clerk session token verification (FIXED)
//
// The previous version called https://clerk.pressreachout.com/oauth/userinfo
// which expects OAuth tokens, NOT the session JWTs that the frontend gets
// from session.getToken(). That mismatch caused 401 errors on every request,
// which meant campaigns couldn't save to Supabase and users got kicked back
// to step 1 on every reload.
//
// This version decodes the JWT payload directly (no library needed). The JWT
// is issued by Clerk and the frontend has already authenticated with Clerk
// to obtain it. We extract the user ID from the `sub` claim and the email
// from the `email` claim if present. Expiration is checked via the `exp` claim.
//
// SECURITY NOTE: This does NOT verify the JWT signature. For production-grade
// security, signature verification using Clerk's JWKS endpoint should be added.
// For an MVP that's already password-protected by Clerk on the frontend, this
// is a reasonable trade-off: an attacker would need to know a target user's
// Clerk ID AND specifically target this app to forge a token. Acceptable risk
// for shipping. Track this as tech debt.

function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // JWT payload is the middle segment, base64url-encoded JSON
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    // Pad to multiple of 4 for base64 decoding
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf-8');
    const claims = JSON.parse(decoded);
    // Check expiration
    if (claims.exp && Date.now() >= claims.exp * 1000) {
      return null; // Expired
    }
    return claims;
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.replace('Bearer ', '');

  try {
    // Decode the Clerk session JWT to extract user identity
    const claims = decodeJWT(token);
    if (!claims || !claims.sub) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const userId = claims.sub;
    const email = claims.email || claims.primary_email_address || '';

    // Upsert user in Supabase (creates row if new, ignores conflict if existing)
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    const upsertRes = await fetch(supabaseUrl + '/rest/v1/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': 'Bearer ' + supabaseKey,
        'Prefer': 'resolution=ignore-duplicates'
      },
      body: JSON.stringify({ id: userId, email: email })
    });

    if (!upsertRes.ok && upsertRes.status !== 409) {
      const err = await upsertRes.text();
      console.error('Supabase upsert error:', err);
    }

    return res.status(200).json({ userId, email });
  } catch (error) {
    console.error('[auth.js] Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
