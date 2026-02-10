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
    try {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { recursive: true, force: true });
    } catch (e) {
        console.error("removeFile error:", e.message);
    }
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
            sessionCleanedUp = true;
            try {
                removeFile(tempDir);
            } catch (cleanupError) {
                console.error("Cleanup error:", cleanupError.message);
            }
        }
    }

    async function startPairing() {
        try {
            const { state, saveCreds } = await useMultiFileAuthState(tempDir);

            sock = Toxic_Tech({
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

                
                    await delay(10000);
                    console.log('⏳ Reading session data...');

                    const credsPath = path.join(tempDir, "creds.json");

                    let sessionData = null;
                    let attempts = 0;
                    const maxAttempts = 10;

                    while (attempts < maxAttempts && !sessionData) {
                        try {
                            if (fs.existsSync(credsPath)) {
                                const data = fs.readFileSync(credsPath);
                             
                                if (data && data.length > 100) { 
                                    sessionData = data;
                                    console.log(`✅ Session data found (${data.length} bytes) on attempt ${attempts + 1}`);
                                    break;
                                } else {
                                    console.log(`⚠️ Session file exists but size is small: ${data?.length || 0} bytes`);
                                }
                            } else {
                                console.log(`⚠️ Session file not found yet, attempt ${attempts + 1}/${maxAttempts}`);
                            }
                          
                            await delay(5000);
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
                        try { sock.ws.close(); } catch (e) {}
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
                        try { sock.ws.close(); } catch (e) {}
                        await cleanUpSession();

                    } catch (sendError) {
                        console.error("Error sending session:", sendError);
                        await cleanUpSession();
                        try { sock.ws.close(); } catch (e) {}
                    }

                } else if (connection === "close") {
                    console.log('❌ Connection closed during pairing');
                    await cleanUpSession();
                } else if (connection === "connecting") {
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
        setTimeout(() => {
            reject(new Error("Pairing process timeout"));
        }, 300000);
    });

    try {
        await Promise.race([startPairing(), timeoutPromise]);
    } catch (finalError) {
        console.error("Final error:", finalError);
        await cleanUpSession();
        if (sock) {
            try { sock.ws.close(); } catch (e) {}
        }
        if (!responseSent && !res.headersSent) {
            res.status(500).json({ code: "Service Error - Timeout" });
        }
    }
});

module.exports = router;
