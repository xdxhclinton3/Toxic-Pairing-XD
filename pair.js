const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeid } = require('./id');

const {
default: Toxic_Tech,
useMultiFileAuthState,
delay,
makeCacheableSignalKeyStore,
Browsers,
fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const router = express.Router();
const sessionDir = path.join(__dirname, "temp");

function removeFile(p) {
if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
const id = makeid();
const num = (req.query.number || '').replace(/[^0-9]/g, '');
const tempDir = path.join(sessionDir, id);

let responseSent = false;
let sessionCleanedUp = false;
let sessionSent = false;

async function cleanUpSession() {
if (!sessionCleanedUp) {
try {
removeFile(tempDir);
} catch {}
sessionCleanedUp = true;
}
}

try {
const { version } = await fetchLatestBaileysVersion();
const { state, saveCreds } = await useMultiFileAuthState(tempDir);

const sock = Toxic_Tech({
version,
logger: pino({ level: 'fatal' }),
printQRInTerminal: false,
auth: {
creds: state.creds,
keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
},
browser: Browsers.macOS("Chrome"),
syncFullHistory: false,
generateHighQualityLinkPreview: true,
shouldIgnoreJid: jid => !!jid?.endsWith('@g.us'),
getMessage: async () => undefined,
markOnlineOnConnect: true,
connectTimeoutMs: 120000,
keepAliveIntervalMs: 30000,
emitOwnEvents: true,
fireInitQueries: true,
defaultQueryTimeoutMs: 60000,
transactionOpts: {
maxCommitRetries: 10,
delayBetweenTriesMs: 3000
},
retryRequestDelayMs: 10000
});

if (!sock.authState.creds.registered) {
await delay(3000);
const code = await sock.requestPairingCode(num);
if (!responseSent && !res.headersSent) {
res.json({ code });
responseSent = true;
}
}

sock.ev.on('creds.update', saveCreds);

sock.ev.on('connection.update', async (update) => {
const { connection, lastDisconnect } = update;

if (connection === 'open') {
sessionSent = true;

const userJid = sock.user.id.includes(':') ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : sock.user.id;

try {
await sock.sendMessage(userJid, {
text: `
◈━━━━━━━━━━━◈
│❒ Hello! 👋 You're now connected to Toxic-MD.

│❒ Please wait a moment while we generate your session ID. It will be sent shortly... 🙂
◈━━━━━━━━━━━◈
`
});
} catch {}

try {
await sock.newsletterFollow('120363427340708111@newsletter');
} catch {}

let sessionData = null;

try {
const credsPath = path.join(tempDir, "creds.json");
for (let i = 0; i < 15; i++) {
if (fs.existsSync(credsPath)) {
const data = fs.readFileSync(credsPath);
if (data && data.length > 100) {
sessionData = data;
break;
}
}
await delay(2000);
}
} catch {}

if (!sessionData) {
try {
await sock.sendMessage(userJid, { text: "Failed to generate session. Please try again." });
} catch {}
await cleanUpSession();
try { await sock.logout(); } catch {}
return;
}

const base64 = Buffer.from(sessionData).toString('base64');

try {
const sentSession = await sock.sendMessage(userJid, { text: base64 });

await delay(2000);

const infoMessage = `
◈━━━━━━━━━━━◈
SESSION CONNECTED

│❒ The long code above is your Session ID. Please copy and store it safely, as you'll need it to deploy your Toxic-MD bot! 🔐

│❒ Need help? Reach out to us:

『••• Visit For Help •••』

> Owner:
https://wa.me/254114885159

> WaGroup:
https://chat.whatsapp.com/GDcJihbSIYM0GzQJWKA6gS?mode=gi_t

> WaChannel:
https://whatsapp.com/channel/0029VbCKkVc7z4kh02WGqF0m

> Instagram:
https://www.instagram.com/xh_clinton

> BotRepo:
https://github.com/xhclintohn/Toxic-MD

│❒ Don't forget to give a ⭐ to our repo and fork it to stay updated! :)
◈━━━━━━━━━━━◈`;

await sock.sendMessage(userJid, { text: infoMessage }, { quoted: sentSession });

await delay(3000);

try { await sock.logout(); } catch {}
await cleanUpSession();

} catch {
await cleanUpSession();
try { await sock.logout(); } catch {}
}

} else if (connection === "close") {
if (sessionSent) return;
if (lastDisconnect?.error?.output?.statusCode === 401) {
await cleanUpSession();
} else {
await cleanUpSession();
}
} else if (connection === "connecting") {
}
});

setTimeout(async () => {
if (!sessionSent) {
await cleanUpSession();
try { await sock.logout(); } catch {}
if (!responseSent && !res.headersSent) {
res.status(500).json({ code: "Service Error - Timeout" });
}
}
}, 420000);

} catch (err) {
await cleanUpSession();
if (!responseSent && !res.headersSent) {
res.status(500).json({ code: 'Service Unavailable. Please try again.' });
}
}
});

module.exports = router;