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

    async function cleanUpSession() {
        if (!sessionCleanedUp) {
            try {
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
                    
                    const userJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                    console.log('Sending to:', userJid);
                    
                    await delay(3000);
                    
                    try {
                        await sock.sendMessage(userJid, { text: 'Hello! Generating your session ID...' });
                        
                        await delay(10000);
                        
                        const credsPath = path.join(tempDir, "creds.json");
                        let sessionData = null;
                        let attempts = 0;
                        
                        while (attempts < 20 && !sessionData) {
                            if (fs.existsSync(credsPath)) {
                                const data = fs.readFileSync(credsPath);
                                if (data && data.length > 100) {
                                    sessionData = data;
                                    break;
                                }
                            }
                            await delay(3000);
                            attempts++;
                        }
                        
                        if (sessionData) {
                            const base64 = Buffer.from(sessionData).toString('base64');
                            await sock.sendMessage(userJid, { text: base64 });
                            await delay(2000);
                            await sock.sendMessage(userJid, { text: '✅ Session ID sent! Store it in your SESSION environment variable.' });
                        } else {
                            await sock.sendMessage(userJid, { text: '❌ Failed to generate session. Try again.' });
                        }
                        
                        await delay(3000);
                        await cleanUpSession();
                        sock.ws.close();
                        
                    } catch (err) {
                        console.error('Send error:', err.message);
                        await cleanUpSession();
                        sock.ws.close();
                    }
                    
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
            console.error('Error:', err.message);
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