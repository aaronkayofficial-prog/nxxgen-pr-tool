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
    // Verify Clerk token
    const clerkRes = await fetch('https://regular-pup-97.clerk.accounts.dev/oauth/userinfo', {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!clerkRes.ok) return res.status(401).json({ error: 'Invalid token' });
    const clerkUser = await clerkRes.json();
    const userId = clerkUser.sub;
    const email = clerkUser.email;

    // Upsert user in Supabase
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
    return res.status(500).json({ error: error.message });
  }
}
