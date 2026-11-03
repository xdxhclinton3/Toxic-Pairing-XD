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
  return zlib.gzipSync(payload, { level: 9 }).toString('base64');
}

const vaultDir = path.join(__dirname, 'vault');
const VAULT_TTL_MS = 24 * 60 * 60 * 1000;

function vaultPath(code) {
  return path.join(vaultDir, code + '.json');
}

function sweepVault() {
  try {
    if (!fs.existsSync(vaultDir)) return;
    for (const name of fs.readdirSync(vaultDir)) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(vaultDir, name), 'utf8'));
        if (!data || !data.exp || data.exp <= Date.now() || typeof data.bundle !== 'string') {
          fs.rmSync(path.join(vaultDir, name), { force: true });
        }
      } catch {
        try { fs.rmSync(path.join(vaultDir, name), { force: true }); } catch {}
      }
    }
  } catch {}
}

function saveRetrievalBundle(code, bundle) {
  sweepVault();
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(vaultPath(code), JSON.stringify({ exp: Date.now() + VAULT_TTL_MS, bundle }));
}

function loadRetrievalBundle(code) {
  if (typeof code !== 'string' || !/^[0-9a-f]{24}$/i.test(code)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(vaultPath(code), 'utf8'));
    if (!data || typeof data.bundle !== 'string' || !data.exp || data.exp <= Date.now()) {
      try { fs.rmSync(vaultPath(code), { force: true }); } catch {}
      return null;
    }
    return data.bundle;
  } catch {
    return null;
  }
}

module.exports = { buildSessionId, saveRetrievalBundle, loadRetrievalBundle, VAULT_TTL_MS };
