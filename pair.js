const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const zlib = require('zlib');
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

function removeFile(pathToRemove) {
    if (fs.existsSync(pathToRemove)) fs.rmSync(pathToRemove, { recursive: true, force: true });
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
                version: (await (await fetch('https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/src/Defaults/baileys-version.json')).json()).version,
                logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
                printQRInTerminal: false,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino().child({ level: "silent", stream: 'store' }))
                },
                browser: ["Ubuntu", 'Chrome', "20.0.04"],
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
                    console.log('✅ Toxic-MD successfully connected to WhatsApp.');
                    console.log('⏳ Waiting for session to sync and stabilize...');

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

                    await delay(25000);
                    console.log('⏳ Reading session data...');

                    let sessionFiles = null;
                    let attempts = 0;
                    const maxAttempts = 15;

                    while (attempts < maxAttempts && !sessionFiles) {
                        try {
                            if (fs.existsSync(tempDir)) {
                                const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.json'));

                                if (files.length > 0) {
                                    const collected = {};

                                    for (const file of files) {
                                        const fullPath = path.join(tempDir, file);
                                        const data = fs.readFileSync(fullPath, 'utf-8');

                                        if (!data || data.length < 10) {
                                            console.log(`⚠️ Auth file ${file} is small (${data?.length || 0} bytes), retrying...`);
                                            sessionFiles = null;
                                            break;
                                        }

                                        collected[file] = data;
                                    }

                                    if (Object.keys(collected).length === files.length) {
                                        sessionFiles = collected;
                                        console.log(`✅ Auth files collected: ${files.join(', ')} on attempt ${attempts + 1}`);
                                        break;
                                    }
                                } else {
                                    console.log(`⚠️ No auth .json files found yet, attempt ${attempts + 1}/${maxAttempts}`);
                                }
                            } else {
                                console.log(`⚠️ Temp dir not found yet, attempt ${attempts + 1}/${maxAttempts}`);
                            }

                            await delay(6000);
                            attempts++;
                        } catch (readError) {
                            console.error("Read attempt error:", readError);
                            await delay(3000);
                            attempts++;
                        }
                    }

                    if (!sessionFiles) {
                        console.error("Failed to read full auth data after all attempts");
                        try {
                            await sock.sendMessage(sock.user.id, {
                                text: "Failed to generate session. Please try again."
                            });
                        } catch (e) {}
                        await cleanUpSession();
                        sock.ws.close();
                        return;
                    }

                    const sessionPayload = {
                        v: 1,
                        files: sessionFiles
                    };

                    const jsonString = JSON.stringify(sessionPayload);
                    const compressed = zlib.deflateSync(jsonString);
                    const base64 = compressed.toString('base64');

                    console.log(`✅ Full auth data encoded to base64 (compressed). Length: ${base64.length} characters`);

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
                        sock.ws.close();
                        await cleanUpSession();

                    } catch (sendError) {
                        console.error("Error sending session:", sendError);
                        await cleanUpSession();
                        sock.ws.close();
                    }

                } else if (connection === "close") {
                    if (lastDisconnect?.error?.output?.statusCode !== 401) {
                        console.log('⚠️ Connection closed, attempting to reconnect...');
                        await delay(15000);
                        startPairing();
                    } else {
                        console.log('❌ Connection closed permanently');
                        await cleanUpSession();
                    }
                } else if (connection === "connecting") {
                    console.log('⏳ Connecting to WhatsApp...');
                }
            });

            sock.ev.on('connection.update', (update) => {
                if (update.qr) {
                    console.log("QR code received");
                }
                if (update.connection === "close") {
                    console.log("Connection closed event");
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
        setTimeout(() => {
            reject(new Error("Pairing process timeout"));
        }, 300000);
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
```0