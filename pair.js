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
    fetchLatestBaileysVersion,
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
    let sock = null;

    async function cleanUpSession() {
        if (!sessionCleanedUp) {
            try {
                if (sock && sock.ws) {
                    sock.ws.close();
                }
                removeFile(tempDir);
            } catch (cleanupError) {}
            sessionCleanedUp = true;
        }
    }

    async function startPairing() {
        try {
            const { version } = await fetchLatestBaileysVersion();
            const { state, saveCreds } = await useMultiFileAuthState(tempDir);

            sock = Toxic_Tech({
                version,
                logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
                printQRInTerminal: false,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })),
                },
                browser: Browsers.macOS('Desktop'),
                syncFullHistory: true,
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

            if (!state.creds.registered) {
                await delay(2000);
                try {
                    const code = await sock.requestPairingCode(num);
                    if (!responseSent && !res.headersSent) {
                        res.json({ code: code });
                        responseSent = true;
                    }
                } catch (pairError) {
                    if (!responseSent && !res.headersSent) {
                        res.status(400).json({ error: "Cannot generate pairing code" });
                        responseSent = true;
                        return;
                    }
                }
            }

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    console.log("QR received, but using pairing code");
                }

                if (connection === 'open') {
                    console.log('✅ Connected to WhatsApp');

                    try {
                        await sock.sendMessage(sock.user.id, {
                            text: `

◈━━━━━━━━━━━◈
│❒ Hello! 👋 You're now connected to Toxic-MD.

│❒ Please wait a moment while we generate your session ID. It will be sent shortly... 🙂
◈━━━━━━━━━━━◈
`,
                        });
                    } catch (msgError) {}

                    await delay(5000);

                    const credsPath = path.join(tempDir, "creds.json");

                    let sessionData = null;
                    let attempts = 0;
                    const maxAttempts = 20;

                    while (attempts < maxAttempts && !sessionData) {
                        try {
                            if (fs.existsSync(credsPath)) {
                                const data = fs.readFileSync(credsPath);
                                if (data && data.length > 100) {
                                    sessionData = data;
                                    break;
                                }
                            }
                            await delay(2000);
                            attempts++;
                        } catch (readError) {
                            await delay(2000);
                            attempts++;
                        }
                    }

                    if (!sessionData) {
                        try {
                            await sock.sendMessage(sock.user.id, {
                                text: "Failed to generate session. Please try again."
                            });
                        } catch (e) {}
                        await cleanUpSession();
                        return;
                    }

                    const base64 = Buffer.from(sessionData).toString('base64');

                    try {
                        const sentSession = await sock.sendMessage(sock.user.id, {
                            text: base64
                        });

                        const infoMessage = `  
◈━━━━━━━━━━━◈  
SESSION CONNECTED

│❒ The long code above is your Session ID. Please copy and store it safely, as you'll need it to deploy your Toxic-MD bot! 🔐

│❒ Need help? Reach out to us:

『••• Visit For Help •••』

> Owner:
https://wa.me/254735342808

> WaGroup:
https://chat.whatsapp.com/GoXKLVJgTAAC3556FXkfFI

> WaChannel:
https://whatsapp.com/channel/0029VagJlnG6xCSU2tS1Vz19

> Instagram:
https://www.instagram.com/xh_clinton

> BotRepo:
https://github.com/xhclintohn/Toxic-MD

│❒ Don't forget to give a ⭐ to our repo and fork it to stay updated! :)
◈━━━━━━━━━━━◈`;

                        await sock.sendMessage(sock.user.id, { text: infoMessage }, { quoted: sentSession });

                        await delay(3000);
                        await cleanUpSession();

                    } catch (sendError) {
                        await cleanUpSession();
                    }

                } else if (connection === "close") {
                    const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401 && 
                                          lastDisconnect?.error?.message !== 'Connection Closed';
                    
                    if (shouldReconnect) {
                        console.log('⚠️ Reconnecting...');
                        await delay(5000);
                        await cleanUpSession();
                        startPairing();
                    } else {
                        console.log('❌ Permanent connection close');
                        await cleanUpSession();
                    }
                }
            });

        } catch (err) {
            console.error('❌ Error:', err.message);
            await cleanUpSession();
            if (!responseSent && !res.headersSent) {
                res.status(500).json({ error: 'Service Unavailable. Please try again.' });
                responseSent = true;
            }
        }
    }

    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error("Pairing process timeout"));
        }, 180000);
    });

    try {
        await Promise.race([startPairing(), timeoutPromise]);
    } catch (finalError) {
        console.error('❌ Timeout:', finalError.message);
        await cleanUpSession();
        if (!responseSent && !res.headersSent) {
            res.status(500).json({ error: "Service Error - Timeout" });
        }
    }
});

module.exports = router;