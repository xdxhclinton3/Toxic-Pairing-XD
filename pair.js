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

function removeFile(filePath) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    const id = makeid();
    const num = (req.query.number || '').replace(/[^0-9]/g, '');
    const tempDir = path.join(sessionDir, id);
    let responseSent = false;
    let sessionCleanedUp = false;

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
            const { version } = await fetchLatestBaileysVersion();
            const { state, saveCreds } = await useMultiFileAuthState(tempDir);

            const sock = Toxic_Tech({
                version,
                logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
                printQRInTerminal: false,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino().child({ level: "silent", stream: 'store' }))
                },
                browser: Browsers.macOS("Chrome"),
                syncFullHistory: false,
                generateHighQualityLinkPreview: true,
                shouldIgnoreJid: jid => !!jid?.endsWith('@g.us'),
                getMessage: async () => undefined,
                markOnlineOnConnect: true,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 20000,
                emitOwnEvents: true,
                fireInitQueries: true,
                defaultQueryTimeoutMs: 60000,
                transactionOpts: {
                    maxCommitRetries: 10,
                    delayBetweenTriesMs: 3000
                },
                retryRequestDelayMs: 250
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
                    console.log('✅ Toxic-MD successfully connected to WhatsApp.');

                    try {
                        await sock.sendMessage(sock.user.id, {
                            text: `
◈━━━━━━━━━━━◈
│❒ Hello! 👋 You're now connected to Toxic-MD.

│❒ Please wait a moment while we generate your session ID. It will be sent shortly... 🙂
◈━━━━━━━━━━━◈
`,
                        });
                    } catch (msgError) {
                        console.log("Welcome message skipped, continuing...");
                    }

                    const credsPath = path.join(tempDir, "creds.json");
                    let sessionData = null;
                    let attempts = 0;
                    const maxAttempts = 15;

                    while (attempts < maxAttempts && !sessionData) {
                        try {
                            if (fs.existsSync(credsPath)) {
                                const data = fs.readFileSync(credsPath);
                                if (data && data.length > 100) {
                                    sessionData = data;
                                    console.log(`✅ Session data found (${data.length} bytes) on attempt ${attempts + 1}`);
                                    break;
                                } else {
                                    console.log(`⚠️ Session file too small: ${data?.length || 0} bytes`);
                                }
                            } else {
                                console.log(`⚠️ Session file not found yet, attempt ${attempts + 1}/${maxAttempts}`);
                            }
                            await delay(6000);
                            attempts++;
                        } catch (readError) {
                            console.error("Read attempt error:", readError);
                            await delay(3000);
                            attempts++;
                        }
                    }

                    if (!sessionData) {
                        console.error("Failed to read session data after all attempts");
                        try {
                            await sock.sendMessage(sock.user.id, {
                                text: "Failed to generate session. Please try again."
                            });
                        } catch (e) {}
                        await cleanUpSession();
                        sock.end(undefined);
                        return;
                    }

                    const base64 = Buffer.from(sessionData).toString('base64');
                    console.log('✅ Session data encoded to base64');

                    try {
                        console.log('📤 Sending session data to user...');
                        const sentSession = await sock.sendMessage(sock.user.id, {
                            text: base64
                        });

                        await delay(3000);

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

                        console.log('📤 Sending information message...');
                        await sock.sendMessage(sock.user.id, { text: infoMessage }, { quoted: sentSession });

                        console.log('⏳ Finalizing session...');
                        await delay(5000);

                        console.log('✅ Session completed, closing connection...');
                        sock.end(undefined);
                        await cleanUpSession();

                    } catch (sendError) {
                        console.error("Error sending session:", sendError);
                        await cleanUpSession();
                        sock.end(undefined);
                    }

                } else if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode !== 401) {
                        console.log('⚠️ Connection closed, attempting to reconnect...');
                        await delay(5000);
                        startPairing();
                    } else {
                        console.log('❌ Connection closed permanently (logged out)');
                        await cleanUpSession();
                    }
                } else if (connection === 'connecting') {
                    console.log('⏳ Connecting to WhatsApp...');
                }
            });

        } catch (err) {
            console.error('❌ Error during pairing:', err);
            await cleanUpSession();
            if (!responseSent && !res.headersSent) {
                res.status(500).json({ code: 'Service Unavailable. Please try again.' });
                responseSent = true;
            }
        }
    }

    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Pairing process timeout")), 300000);
    });

    try {
        await Promise.race([startPairing(), timeoutPromise]);
    } catch (finalError) {
        console.error("Final error:", finalError);
        await cleanUpSession();
        if (!responseSent && !res.headersSent) {
            res.status(500).json({ code: "Service Error - Timeout" });
        }
    }
});

module.exports = router;
