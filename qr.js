const { makeid } = require('./id');
const QRCode = require('qrcode');
const express = require('express');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const { acquire, release } = require('./guard');

const {
    default: Toxic_Tech,
    useMultiFileAuthState,
    Browsers,
    delay,
    makeCacheableSignalKeyStore,
    generateWAMessageFromContent,
    proto
} = require('@whiskeysockets/baileys');

const router = express.Router();
const tempRoot = path.join(__dirname, 'temp');

if (!fs.existsSync(tempRoot)) {
    fs.mkdirSync(tempRoot, { recursive: true });
}

function removeFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.rmSync(filePath, { recursive: true, force: true });
        }
    } catch {}
}

function buildCredsSessionId(sessionDir) {
    try {
        const credsPath = path.join(sessionDir, 'creds.json');
        if (!fs.existsSync(credsPath)) return null;
        const data = fs.readFileSync(credsPath);
        if (!data || data.length <= 100) return null;
        const parsed = JSON.parse(data.toString('utf8'));
        if (!parsed || !(parsed.me || parsed.signedIdentityKey || parsed.noiseKey || parsed.signedPreKey)) return null;
        return Buffer.from(data).toString('base64');
    } catch {
        return null;
    }
}

router.get('/', async (req, res) => {
    let id = makeid();
    let sessionDir = path.join(tempRoot, id);
    while (fs.existsSync(sessionDir)) {
        id = makeid();
        sessionDir = path.join(tempRoot, id);
    }

    let responseSent = false;
    let finished     = false;
    let sock         = null;
    let reconnectAttempts = 0;
    let guardHeld = false;

    if (!acquire()) {
        return res.status(429).json({ code: 'Server is busy right now. Please try again in a moment.' });
    }
    guardHeld = true;

    function releaseGuard() {
        if (guardHeld) {
            guardHeld = false;
            release();
        }
    }

    function cleanupSync() {
        try { clearTimeout(globalTimeout); } catch {}
        try {
            if (sock?.ev) {
                try { sock.ev.removeAllListeners(); } catch {}
            }
            if (sock?.ws) {
                try { sock.ws.close(); } catch {}
            }
        } catch {}
        removeFile(sessionDir);
        releaseGuard();
    }

    async function fail(message, status) {
        if (finished) return;
        finished = true;
        cleanupSync();
        if (!responseSent && !res.headersSent) {
            res.status(status || 500).json({ code: message });
            responseSent = true;
        }
    }

    async function startSocket() {
        if (finished) return;
        try {
            if (!fs.existsSync(sessionDir)) {
                fs.mkdirSync(sessionDir, { recursive: true });
            }

            const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

            if (sock?.ev) {
                try { sock.ev.removeAllListeners('connection.update'); } catch {}
                try { sock.ev.removeAllListeners('creds.update'); } catch {}
            }
            if (sock?.ws) {
                try { sock.ws.close(); } catch {}
            }

            sock = Toxic_Tech({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: 'silent' })
                    ),
                },
                logger:                         pino({ level: 'silent' }),
                browser:                        Browsers.android('Chrome'),
                syncFullHistory:                false,
                connectTimeoutMs:               120000,
                keepAliveIntervalMs:            10000,
                retryRequestDelayMs:            2000,
                generateHighQualityLinkPreview: true,
                markOnlineOnConnect:            false,
            });

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (update) => {
                try {
                    const { connection, lastDisconnect, qr } = update;

                    if (finished) return;

                    if (qr && !responseSent && !res.headersSent) {
                        try {
                            const buf = await QRCode.toBuffer(qr, {
                                type: 'png', width: 300, margin: 2,
                                color: { dark: '#000000', light: '#ffffff' },
                                errorCorrectionLevel: 'M',
                            });
                            res.setHeader('Content-Type', 'image/png');
                            res.setHeader('Cache-Control', 'no-store');
                            res.end(buf);
                        } catch {
                            if (!res.headersSent) res.json({ qr });
                        }
                        responseSent = true;
                    }

                    if (connection === 'open') {
                        finished = true;

                        try { await sock.newsletterFollow('120363425667150709@newsletter'); } catch (e) { console.error('[qr]', id, 'newsletterFollow:', e?.message || e); }

                        const rawUserId = sock.user?.id;
                        if (!rawUserId) {
                            console.error('[qr]', id, 'connected but sock.user.id is missing');
                            cleanupSync();
                            return;
                        }
                        const userJid = rawUserId.includes(':')
                            ? rawUserId.split(':')[0] + '@s.whatsapp.net'
                            : rawUserId;

                        try {
                            await sock.sendMessage(userJid, {
                                text: `◈━━━━━━━━━━━◈
│❒ Hello! 👋 You're now connected to Toxic-MD

│❒ Please wait a moment while we generate your session ID. It will be sent shortly here... 🙂
◈━━━━━━━━━━━◈`
                            });
                        } catch {}

                        await delay(5000);
                        await saveCreds();
                        await delay(2000);

                        let b64data = null;
                        let attempts = 0;
                        const maxAttempts = 10;

                        while (attempts < maxAttempts && !b64data) {
                            try {
                                b64data = buildCredsSessionId(sessionDir);
                                if (b64data) {
                                    console.log(`✅ Session ID ready (${b64data.length} chars) on attempt ${attempts + 1}`);
                                    break;
                                }
                                console.log(`⚠️ Session not ready yet, attempt ${attempts + 1}/${maxAttempts}`);
                                await delay(3000);
                                attempts++;
                            } catch (readError) {
                                console.error("Read attempt error:", readError);
                                await delay(3000);
                                attempts++;
                            }
                        }

                        if (!b64data) {
                            console.error("Failed to read session data after all attempts");
                            try { await sock.sendMessage(userJid, { text: "Failed to generate session. Please try again." }); } catch {}
                            cleanupSync();
                            return;
                        }

                        let sentSession = null;
                        try {
                            console.log(' Sending session data to user...');
                            const sessionMsg = await generateWAMessageFromContent(userJid, proto.Message.fromObject({
                                interactiveMessage: {
                                    body: { text: b64data },
                                    footer: { text: '' },
                                    nativeFlowMessage: {
                                        messageVersion: 1,
                                        buttons: [{
                                            name: 'cta_copy',
                                            buttonParamsJson: JSON.stringify({ display_text: 'Copy Session id', copy_code: b64data })
                                        }],
                                        messageParamsJson: ''
                                    }
                                }
                            }), { userJid: sock.user.id });

                            await sock.relayMessage(userJid, sessionMsg.message, { messageId: sessionMsg.key.id });
                            sentSession = sessionMsg;
                        } catch (sendError) {
                            console.error('[qr]', id, 'copy-button session send failed, falling back to plain text:', sendError?.message || sendError);
                            try { sentSession = await sock.sendMessage(userJid, { text: b64data }); } catch (e) { console.error('[qr]', id, 'plain session send failed:', e?.message || e); }
                        }

                        try {
                            await delay(3000);
                            await sock.sendMessage(
                                userJid,
                                {
                                    text: `◈━━━━━━━━━━━◈
SESSION CONNECTED ✅️

│❒ The long code above is your Session ID. Please copy and store it safely, as you'll need it to deploy your Toxic-MD bot! This ID does not expire.

│❒ Repo:
github.com/xhclintohn/Toxic-MD

│❒ Wanna Deploy/Run your bot¿
https://hosting.nyxtechs.net`
                                },
                                sentSession ? { quoted: sentSession } : {}
                            );
                        } catch (e) {
                            console.error('[qr]', id, 'follow-up send failed:', e?.message || e);
                        }

                        await delay(1000);
                        cleanupSync();
                        return;
                    }

                    if (connection === 'close') {
                        if (finished) return;

                        const statusCode =
                            lastDisconnect?.error?.output?.statusCode ||
                            lastDisconnect?.error?.statusCode;

                        if (statusCode === 401) {
                            return await fail('Logged out. Please try again.');
                        }

                        reconnectAttempts++;
                        if (reconnectAttempts > 6) {
                            return await fail('Connection lost. Please try again.');
                        }
                        const wait = statusCode === 515 ? 1000 : Math.min(3000 * Math.pow(1.5, reconnectAttempts - 1), 15000);
                        await delay(wait);
                        if (finished) return;
                        return startSocket();
                    }

                } catch (err) {
                    if (!finished) await fail('Service is Currently Unavailable. Please try again.');
                }
            });

        } catch (err) {
            if (!finished) await fail('Service is Currently Unavailable. Please try again.');
        }
    }

    const globalTimeout = setTimeout(function () {
        if (!finished) fail('Request timed out. Please try again.');
    }, 420000);

    try {
        await startSocket();
    } catch {}

    return;
});

module.exports = router;