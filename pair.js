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

            sock = makeWASocket({
                version,
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
                },
                browser: Browsers.macOS('Desktop'),
                syncFullHistory: true,
                markOnlineOnConnect: false,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 10000,
            });

            if (!state.creds.registered) {
                await delay(3000);
                try {
                    const code = await sock.requestPairingCode(num);
                    if (!responseSent && !res.headersSent) {
                        res.json({ code: code });
                        responseSent = true;
                    }
                } catch (pairError) {
                    if (!responseSent && !res.headersSent) {
                        res.status(400).json({ error: "Pairing failed. Try QR code instead." });
                        responseSent = true;
                        return;
                    }
                }
            }

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'open') {
                    console.log('✅ Connected to WhatsApp');

                    await delay(3000);

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

                    await delay(8000);

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
                                    break;
                                }
                            }
                            await delay(1000);
                            attempts++;
                        } catch (readError) {
                            await delay(1000);
                            attempts++;
                        }
                    }

                    if (!sessionData) {
                        try {
                            await sock.sendMessage(sock.user.id, {
                                text: "Failed to read session data. Please try again."
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

                        await delay(5000);
                        await cleanUpSession();

                    } catch (sendError) {
                        await cleanUpSession();
                    }

                } else if (connection === "close") {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode !== 401) {
                        await cleanUpSession();
                        if (!responseSent && !res.headersSent) {
                            res.status(500).json({ error: 'Connection failed. Try again.' });
                            responseSent = true;
                        }
                    }
                }
            });

        } catch (err) {
            await cleanUpSession();
            if (!responseSent && !res.headersSent) {
                res.status(500).json({ error: 'Service error. Please try again.' });
                responseSent = true;
            }
        }
    }

    try {
        await startPairing();
    } catch (finalError) {
        await cleanUpSession();
        if (!responseSent && !res.headersSent) {
            res.status(500).json({ error: "Timeout" });
        }
    }
});

module.exports = router;