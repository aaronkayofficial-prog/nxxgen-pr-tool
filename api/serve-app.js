import { readFileSync } from 'fs';
import { join } from 'path';

export default async function handler(req, res) {
  try {
    // Read index.html and inject auth-patch.js before </body>
    const htmlPath = join(process.cwd(), 'index.html');
    let html = readFileSync(htmlPath, 'utf8');
    html = html.replace('</body>', '<script src="/auth-patch.js"></script>\n</body>');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(html);
  } catch (e) {
    // Fallback: redirect to index.html directly
    res.setHeader('Location', '/index.html');
    res.status(302).end();
  }
}
