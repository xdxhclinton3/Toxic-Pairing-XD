const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function buildSessionId(sessionDir) {
  const credsPath = path.join(sessionDir, 'creds.json');
  if (!fs.existsSync(credsPath)) return null;
  const creds = fs.readFileSync(credsPath);
  if (!creds || creds.length <= 100) return null;
  const files = {};
  for (const name of fs.readdirSync(sessionDir)) {
    const filePath = path.join(sessionDir, name);
    try {
      if (!fs.statSync(filePath).isFile()) continue;
      files[name] = fs.readFileSync(filePath).toString('base64');
    } catch {}
  }
  if (!files['creds.json']) return null;
  const payload = Buffer.from(JSON.stringify({ v: 1, files }), 'utf8');
  return zlib.gzipSync(payload).toString('base64');
}

module.exports = { buildSessionId };
