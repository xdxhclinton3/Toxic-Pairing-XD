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

            const sock = Toxic_Tech({
                version: [2, 3000, 1033105955],
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
                },
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false,
                browser: Browsers.windows('Desktop'),
                syncFullHistory: false,
                markOnlineOnConnect: true,
                shouldIgnoreJid: jid => !!jid?.endsWith('@g.us'),
                patchMessageBeforeSending: true,
            });

            sock.ev.on('creds.update', saveCreds);

            await delay(2000);

            if (!sock.authState?.creds?.registered) {
                try {
                    console.log(`Requesting code for: ${num}`);
                    const code = await sock.requestPairingCode(num);
                    
                    if (!responseSent && !res.headersSent) {
                        res.json({ code });
                        responseSent = true;
                    }
                } catch (codeErr) {
                    console.error('Failed:', codeErr);
                    if (!responseSent && !res.headersSent) {
                        res.status(500).json({ error: 'Failed to generate code' });
                        responseSent = true;
                    }
                    await cleanUpSession();
                    return;
                }
            }

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'open') {
                    console.log('Connected to WhatsApp!');
                    
                    await delay(15000);
                    
                    const credsPath = path.join(tempDir, "creds.json");
                    if (fs.existsSync(credsPath)) {
                        const sessionData = fs.readFileSync(credsPath);
                        const base64 = Buffer.from(sessionData).toString('base64');
                        
                        try {
                            await sock.sendMessage(sock.user.id, { text: base64 });
                            await delay(2000);
                            
                            await sock.sendMessage(sock.user.id, {
                                text: `◈━━━━━━━━━━━◈\n✅ SESSION CONNECTED\n\nSupport: wa.me/254735342808\n◈━━━━━━━━━━━◈`
                            });
                            
                        } catch (e) {
                            console.error("Send error:", e);
                        }
                    }
                    
                    await delay(5000);
                    sock.end();
                    await cleanUpSession();
                } else if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode !== 401) {
                        console.log('Connection closed, reconnecting...');
                    } else {
                        await cleanUpSession();
                    }
                }
            });

        } catch (err) {
            console.error('Error:', err);
            await cleanUpSession();
            if (!responseSent && !res.headersSent) {
                res.status(500).json({ error: 'Service Error' });
                responseSent = true;
            }
        }
    }

    startPairing();
    
    setTimeout(async () => {
        if (!responseSent && !res.headersSent) {
            res.status(408).json({ error: "Timeout" });
            responseSent = true;
        }
        await cleanUpSession();
    }, 60000);
});

module.exports = router;