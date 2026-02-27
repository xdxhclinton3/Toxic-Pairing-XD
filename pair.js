const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeid } = require('./id');

// Changed from @whiskeysockets/baileys to @itsukichan/baileys
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

    // Validate phone number
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

            // Simplified version - @itsukichan/baileys handles versioning internally
            const sock = Toxic_Tech({
                auth: state,
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false,
                browser: Browsers.windows('Desktop'),
                syncFullHistory: false,
                markOnlineOnConnect: true,
                // @itsukichan/baileys specific features available
                shouldIgnoreJid: jid => !!jid?.endsWith('@g.us'),
            });

            sock.ev.on('creds.update', saveCreds);

            // Wait for connection to be ready before requesting pairing code
            await delay(2000);

            // Request pairing code
            if (!sock.authState.creds.registered) {
                try {
                    const code = await sock.requestPairingCode(num);
                    if (!responseSent && !res.headersSent) {
                        res.json({ code });
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
                const { connection, lastDisconnect } = update;

                if (connection === 'open') {
                    console.log('✅ Toxic-MD connected to WhatsApp.');

                    try {
                        // Send welcome message
                        await sock.sendMessage(sock.user.id, {
                            text: `◈━━━━━━━━━━━◈\n│❒ Hello! 👋 You're now connected to Toxic-MD.\n\n│❒ Please wait a moment while we generate your session ID. It will be sent shortly... 🙂\n◈━━━━━━━━━━━◈`
                        });
                    } catch (e) {
                        console.log("Welcome message skipped, continuing...");
                    }

                    // Wait for session file to be written
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
                                } else {
                                    console.log(`⚠️ Session file small: ${data?.length || 0} bytes`);
                                }
                            } else {
                                console.log(`⚠️ Session file not found, attempt ${attempts + 1}/${maxAttempts}`);
                            }
                            await delay(3000);
                            attempts++;
                        } catch (readError) {
                            console.error("Read attempt error:", readError);
                            await delay(2000);
                            attempts++;
                        }
                    }

                    if (!sessionData) {
                        console.error("Failed to read session data after all attempts");
                        try {
                            await sock.sendMessage(sock.user.id, {
                                text: "❌ Failed to generate session. Please try again."
                            });
                        } catch (e) {}
                        await cleanUpSession();
                        sock.end();
                        return;
                    }

                    // Convert to base64 and send
                    const base64 = Buffer.from(sessionData).toString('base64');
                    console.log('✅ Session encoded to base64');

                    try {
                        console.log('📤 Sending session to user...');
                        
                        // Split long session into chunks if needed
                        const maxChunkSize = 65536; // WhatsApp message limit
                        if (base64.length > maxChunkSize) {
                            const chunks = base64.match(new RegExp(`.{1,${maxChunkSize}}`, 'g'));
                            for (const chunk of chunks) {
                                await sock.sendMessage(sock.user.id, { text: chunk });
                                await delay(1000);
                            }
                        } else {
                            await sock.sendMessage(sock.user.id, { text: base64 });
                        }
                        
                        await delay(2000);

                        const infoMessage = `◈━━━━━━━━━━━◈\n✅ *SESSION CONNECTED*\n\n│❒ The long code above is your Session ID. Please copy and store it safely, as you'll need it to deploy your Toxic-MD bot! 🔐\n\n│❒ Need help? Reach out to us:\n\n*『••• Visit For Help •••』*\n\n> Owner: https://wa.me/254735342808\n> WaGroup: https://chat.whatsapp.com/GoXKLVJgTAAC3556FXkfFI\n> WaChannel: https://whatsapp.com/channel/0029VagJlnG6xCSU2tS1Vz19\n> Instagram: https://www.instagram.com/xh_clinton\n> BotRepo: https://github.com/xhclintohn/Toxic-MD\n\n│❒ Don't forget to give a ⭐ to our repo and fork it to stay updated! :)\n◈━━━━━━━━━━━◈`;

                        console.log('📤 Sending info message...');
                        await sock.sendMessage(sock.user.id, { text: infoMessage });

                        console.log('⏳ Finalizing session...');
                        await delay(5000);
                        console.log('✅ Session complete, closing connection...');
                        
                        sock.end();
                        await cleanUpSession();

                    } catch (sendError) {
                        console.error("Error sending session:", sendError);
                        await cleanUpSession();
                        sock.end();
                    }

                } else if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode !== 401) {
                        console.log('⚠️ Connection closed, but not logged out');
                    } else {
                        console.log('❌ Connection closed permanently (logged out)');
                    }
                    await cleanUpSession();
                }
            });

        } catch (err) {
            console.error('❌ Error during pairing:', err);
            await cleanUpSession();
            if (!responseSent && !res.headersSent) {
                res.status(500).json({ error: 'Service Unavailable. Please try again.' });
                responseSent = true;
            }
        }
    }

    // Set timeout (5 minutes)
    const timeoutId = setTimeout(async () => {
        if (!responseSent && !res.headersSent) {
            res.status(408).json({ error: "Request timeout - please try again" });
            responseSent = true;
        }
        await cleanUpSession();
    }, 300000);

    try {
        await startPairing();
    } catch (finalError) {
        console.error("Final error:", finalError);
        await cleanUpSession();
        if (!responseSent && !res.headersSent) {
            res.status(500).json({ error: "Service Error" });
        }
    } finally {
        clearTimeout(timeoutId);
    }
});

module.exports = router;