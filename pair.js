const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeid } = require('./id');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    DisconnectReason
} = require('@whiskeysockets/baileys');

const router = express.Router();
const sessionDir = path.join(__dirname, "temp");

function removeFile(path) {
    if (fs.existsSync(path)) fs.rmSync(path, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    const id = makeid();
    const num = (req.query.number || '').replace(/[^0-9]/g, '');
    const tempDir = path.join(sessionDir, id);
    let responseSent = false;
    let sessionCleanedUp = false;
    let sessionSent = false;
    let sockRef = null;

    async function cleanUpSession() {
        if (!sessionCleanedUp) {
            try {
                if (sockRef) {
                    sockRef.ws?.close();
                }
                removeFile(tempDir);
            } catch (cleanupError) {
                console.error("Cleanup error:", cleanupError);
            }
            sessionCleanedUp = true;
        }
    }

    async function startPairing() {
        try {
            const version = await (await fetch('https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/src/Defaults/baileys-version.json')).json();
            const { state, saveCreds } = await useMultiFileAuthState(tempDir);

            const sock = makeWASocket({
                version: version.version,
                logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
                printQRInTerminal: false,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino().child({ level: "silent", stream: 'store' }))
                },
                browser: Browsers.macOS("Safari"),
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

            sockRef = sock;

            if (!sock.authState.creds.registered) {
                await delay(3000);
                const code = await sock.requestPairingCode(num);
                if (!responseSent && !res.headersSent) {
                    res.json({ code: code });
                    responseSent = true;
                }
            }

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'open') {
                    sessionSent = true;
                    console.log('✅ Connected to WhatsApp.');
                    
                    await delay(5000);
                    
                    const userId = sock.user.id;
                    const userJid = userId.includes('@') ? userId : `${userId}@s.whatsapp.net`;
                    
                    console.log('Sending welcome message to:', userJid);
                    
                    const welcomeMsg = `◈━━━━━━━━━━━◈
│❒ Hello! 👋 You're now connected to Toxic-MD.
│❒ Generating your session ID...
◈━━━━━━━━━━━◈`;
                    
                    await sock.sendMessage(userJid, { text: welcomeMsg });
                    
                    await delay(15000);
                    
                    console.log('Reading session data...');
                    
                    const credsPath = path.join(tempDir, "creds.json");
                    let sessionData = null;
                    let attempts = 0;
                    const maxAttempts = 30;
                    
                    while (attempts < maxAttempts && !sessionData) {
                        try {
                            if (fs.existsSync(credsPath)) {
                                const data = fs.readFileSync(credsPath);
                                if (data && data.length > 100) {
                                    sessionData = data;
                                    console.log(`Session data found (${data.length} bytes)`);
                                    break;
                                }
                            }
                            await delay(3000);
                            attempts++;
                        } catch (readError) {
                            console.error("Read error:", readError.message);
                            await delay(3000);
                            attempts++;
                        }
                    }
                    
                    if (!sessionData) {
                        console.error("Failed to read session data");
                        await sock.sendMessage(userJid, { text: "Failed to generate session. Please try again." });
                        await cleanUpSession();
                        return;
                    }
                    
                    const base64 = Buffer.from(sessionData).toString('base64');
                    console.log('Session encoded, length:', base64.length);
                    
                    await sock.sendMessage(userJid, { text: base64 });
                    
                    await delay(3000);
                    
                    const infoMsg = `◈━━━━━━━━━━━◈
SESSION CONNECTED

✅ The code above is your Session ID.
🔐 Store it safely in your environment variables.

Need help? Contact owner on WhatsApp
◈━━━━━━━━━━━◈`;
                    
                    await sock.sendMessage(userJid, { text: infoMsg });
                    
                    console.log('Session sent successfully!');
                    
                    await delay(5000);
                    
                    await cleanUpSession();
                    
                } else if (connection === "close") {
                    if (sessionSent) return;
                    if (lastDisconnect?.error?.output?.statusCode !== 401) {
                        console.log('Connection closed, reconnecting...');
                        await delay(5000);
                        startPairing();
                    } else {
                        console.log('Connection closed permanently');
                        await cleanUpSession();
                    }
                }
            });

        } catch (err) {
            console.error('Error during pairing:', err.message);
            await cleanUpSession();
            if (!responseSent && !res.headersSent) {
                res.status(500).json({ code: 'Service Unavailable. Please try again.' });
                responseSent = true;
            }
        }
    }

    try {
        await startPairing();
    } catch (finalError) {
        console.error("Final error:", finalError.message);
        await cleanUpSession();
        if (!responseSent && !res.headersSent) {
            res.status(500).json({ code: "Service Error" });
        }
    }
});

module.exports = router;