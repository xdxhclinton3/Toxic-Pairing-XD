const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeid } = require('./id');

// Using the GitHub fork - keep as @whiskeysockets/baileys in require
const {
    default: Toxic_Tech,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
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
    let pairingCodeSent = false;

    if (!num) {
        return res.status(400).json({ error: 'Phone number is required' });
    }

    async function cleanUpSession() {
        if (!sessionCleanedUp) {
            try { removeFile(tempDir); } catch (e) { console.error("Cleanup error:", e); }
            sessionCleanedUp = true;
        }
    }

    async function startPairing() {
        try {
            const { state, saveCreds } = await useMultiFileAuthState(tempDir);

            // FIXED: According to itsukichann/baileys docs
            const sock = Toxic_Tech({
                auth: state,  // itsukichann fork uses direct state, not {creds, keys}
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false,
                browser: Browsers.windows('Desktop'), 
                syncFullHistory: false,
                markOnlineOnConnect: true,
                // Itsukichann specific features
                shouldIgnoreJid: jid => !!jid?.endsWith('@g.us'),
                patchMessageBeforeSending: true, // Itsukichann feature
                version: [2, 2413, 1], // Fixed version for stability
            });

            sock.ev.on('creds.update', saveCreds);

            // Wait for socket to be ready
            await delay(3000);

            // Request pairing code - itsukichann style
            if (!sock.authState?.creds?.registered) {
                try {
                    // Itsukichann fork expects just the number
                    const code = await sock.requestPairingCode(num);
                    
                    if (!responseSent && !res.headersSent) {
                        res.json({ code: code });
                        responseSent = true;
                        pairingCodeSent = true;
                    }
                } catch (codeErr) {
                    console.error('❌ Failed to get pairing code:', codeErr);
                    if (!responseSent && !res.headersSent) {
                        res.status(500).json({ error: 'Failed to generate code. Please try again.' });
                        responseSent = true;
                    }
                    await cleanUpSession();
                    return;
                }
            }

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (connection === 'open') {
                    console.log('✅ Toxic-MD connected to WhatsApp.');

                    try {
                        // Itsukichann fork supports enhanced messages
                        await sock.sendMessage(sock.user.id, {
                            text: `◈━━━━━━━━━━━◈\n│❒ Hello! 👋 You're now connected to Toxic-MD.\n\n│❒ Please wait a moment while we generate your session ID. It will be sent shortly... 🙂\n◈━━━━━━━━━━━◈`
                        });
                    } catch (e) {
                        console.log("Welcome message skipped, continuing...");
                    }

                    // Wait for session
                    await delay(15000);

                    console.log('⏳ Reading session data...');

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
                                    console.log(`✅ Session data found (${data.length} bytes) on attempt ${attempts + 1}`);
                                    break;
                                }
                            }
                            await delay(3000);
                            attempts++;
                        } catch (readError) {
                            await delay(2000);
                            attempts++;
                        }
                    }

                    if (!sessionData) {
                        console.error("Failed to read session data");
                        await sock.sendMessage(sock.user.id, {
                            text: "❌ Failed to generate session. Please try again."
                        }).catch(() => {});
                        await cleanUpSession();
                        sock.end();
                        return;
                    }

                    const base64 = Buffer.from(sessionData).toString('base64');
                    console.log('✅ Session encoded');

                    try {
                        // Send session
                        await sock.sendMessage(sock.user.id, { text: base64 });
                        await delay(2000);

                        const infoMessage = `◈━━━━━━━━━━━◈\n✅ *SESSION CONNECTED*\n\n│❒ Copy the session ID above 🔐\n\n│❒ Support:\n> Owner: https://wa.me/254735342808\n> Group: https://chat.whatsapp.com/GoXKLVJgTAAC3556FXkfFI\n> Channel: https://whatsapp.com/channel/0029VagJlnG6xCSU2tS1Vz19\n> Repo: https://github.com/xhclintohn/Toxic-MD\n◈━━━━━━━━━━━◈`;

                        await sock.sendMessage(sock.user.id, { text: infoMessage });
                        
                        await delay(5000);
                        sock.end();
                        await cleanUpSession();

                    } catch (sendError) {
                        console.error("Send error:", sendError);
                        await cleanUpSession();
                        sock.end();
                    }

                } else if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode !== 401) {
                        console.log('Reconnecting...');
                        startPairing();
                    } else {
                        await cleanUpSession();
                    }
                }
            });

        } catch (err) {
            console.error('❌ Error:', err);
            await cleanUpSession();
            if (!responseSent && !res.headersSent) {
                res.status(500).json({ error: 'Service Error' });
                responseSent = true;
            }
        }
    }

    const timeoutId = setTimeout(async () => {
        if (!responseSent && !res.headersSent) {
            res.status(408).json({ error: "Timeout" });
            responseSent = true;
        }
        await cleanUpSession();
    }, 300000);

    try {
        await startPairing();
    } catch (error) {
        console.error(error);
        if (!responseSent && !res.headersSent) {
            res.status(500).json({ error: "Service Error" });
        }
    } finally {
        clearTimeout(timeoutId);
    }
});

module.exports = router;