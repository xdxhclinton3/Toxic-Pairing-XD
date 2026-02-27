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

            // FIXED: According to official Itsukichan docs
            const sock = Toxic_Tech({
                auth: state,
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false, // MUST be false for pairing code
                browser: Browsers.macOS('Desktop'), // Better for session
                syncFullHistory: true, // Get full history
                markOnlineOnConnect: true,
                patchMessageBeforeSending: true,
                shouldIgnoreJid: jid => !!jid?.endsWith('@g.us'),
            });

            sock.ev.on('creds.update', saveCreds);

            // Wait for socket to initialize
            await delay(2000);

            // Check if already registered
            if (!sock.authState.creds.registered) {
                try {
                    console.log(`📱 Requesting pairing code for: ${num}`);
                    
                    // FIXED: Exactly as docs show - just the number
                    const code = await sock.requestPairingCode(num);
                    
                    console.log(`✅ Pairing code generated: ${code}`);
                    
                    if (!responseSent && !res.headersSent) {
                        res.json({ code: code });
                        responseSent = true;
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

            // Handle connection updates
            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'open') {
                    console.log('✅ Successfully connected to WhatsApp!');
                    
                    // Wait for session to be fully saved
                    await delay(10000);

                    // Read session file
                    const credsPath = path.join(tempDir, "creds.json");
                    
                    if (fs.existsSync(credsPath)) {
                        const sessionData = fs.readFileSync(credsPath);
                        const base64 = Buffer.from(sessionData).toString('base64');
                        
                        try {
                            // Send session to user
                            await sock.sendMessage(sock.user.id, { 
                                text: `✅ *Your Session ID:*\n\n${base64}` 
                            });
                            
                            await delay(2000);
                            
                            // Send info message
                            await sock.sendMessage(sock.user.id, {
                                text: `◈━━━━━━━━━━━◈\n✅ *SESSION CONNECTED*\n\n│❒ Copy the session ID above 🔐\n\n│❒ Support:\n> Owner: wa.me/254735342808\n> Repo: github.com/xhclintohn/Toxic-MD\n◈━━━━━━━━━━━◈`
                            });
                            
                        } catch (e) {
                            console.error("Error sending messages:", e);
                        }
                    }
                    
                    // Close connection after sending
                    await delay(5000);
                    sock.end();
                    await cleanUpSession();
                    
                } else if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode !== 401) {
                        console.log('Connection closed, reconnecting...');
                    } else {
                        console.log('Logged out');
                        await cleanUpSession();
                    }
                }
            });

        } catch (err) {
            console.error('❌ Error:', err);
            await cleanUpSession();
            if (!responseSent && !res.headersSent) {
                res.status(500).json({ error: 'Service Unavailable' });
                responseSent = true;
            }
        }
    }

    // Start the process
    startPairing();

    // Timeout
    setTimeout(async () => {
        if (!responseSent && !res.headersSent) {
            res.status(408).json({ error: "Timeout" });
            responseSent = true;
        }
        await cleanUpSession();
    }, 60000);

});

module.exports = router;