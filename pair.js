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

if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
}

function removeFile(p) {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    const id = makeid();
    const num = (req.query.number || '').replace(/[^0-9]/g, '');
    const tempDir = path.join(sessionDir, id);

    if (!num) return res.status(400).json({ error: "Invalid number" });

    let responseSent = false;
    let sessionCleanedUp = false;
    let pairingCodeRequested = false;
    let sessionSent = false;

    async function cleanUpSession() {
        if (!sessionCleanedUp) {
            sessionCleanedUp = true;
            try { removeFile(tempDir); } catch {}
        }
    }

    try {
        const version = (await (await fetch('https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/src/Defaults/baileys-version.json')).json()).version;
        const { state, saveCreds } = await useMultiFileAuthState(tempDir);

        const sock = Toxic_Tech({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
            },
            browser: Browsers.ubuntu('Chrome'),
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
            transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
            retryRequestDelayMs: 10000
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'connecting' && !state.creds.registered && !pairingCodeRequested) {
                pairingCodeRequested = true;
                await delay(3000);
                try {
                    const code = await sock.requestPairingCode(num);
                    if (!responseSent && !res.headersSent) {
                        res.json({ code });
                        responseSent = true;
                    }
                } catch (err) {
                    console.error('❌ Failed to get pairing code:', err);
                    if (!responseSent && !res.headersSent) {
                        res.status(500).json({ error: 'Failed to get pairing code' });
                        responseSent = true;
                    }
                    await cleanUpSession();
                }
            }

            if (connection === 'open' && !sessionSent) {
                sessionSent = true;
                console.log('✅ Connected to WhatsApp');

                try {
                    await sock.sendMessage(sock.user.id, {
                        text: `◈━━━━━━━━━━━◈\n│❒ Hello! 👋 You're now connected to Toxic-MD.\n\n│❒ Please wait a moment while we generate your session ID. It will be sent shortly... 🙂\n◈━━━━━━━━━━━◈`
                    });
                } catch {}

                const credsPath = path.join(tempDir, 'creds.json');
                let sessionData = null;
                let attempts = 0;

                while (attempts < 10 && !sessionData) {
                    await delay(3000);
                    try {
                        if (fs.existsSync(credsPath)) {
                            const data = fs.readFileSync(credsPath);
                            if (data && data.length > 100) {
                                sessionData = data;
                                break;
                            }
                        }
                    } catch {}
                    attempts++;
                }

                if (!sessionData) {
                    console.error('❌ Failed to read session data');
                    try { await sock.sendMessage(sock.user.id, { text: 'Failed to generate session. Please try again.' }); } catch {}
                    sock.ws.close();
                    await cleanUpSession();
                    return;
                }

                const base64 = Buffer.from(sessionData).toString('base64');

                try {
                    const sentSession = await sock.sendMessage(sock.user.id, { text: base64 });

                    await delay(2000);

                    const infoMessage = `◈━━━━━━━━━━━◈\nSESSION CONNECTED\n\n│❒ The long code above is your Session ID. Please copy and store it safely, as you'll need it to deploy your Toxic-MD bot! 🔐\n\n│❒ Need help? Reach out to us:\n\n『••• Visit For Help •••』\n\n> Owner:\nhttps://wa.me/254735342808\n\n> WaGroup:\nhttps://chat.whatsapp.com/GoXKLVJgTAAC3556FXkfFI\n\n> WaChannel:\nhttps://whatsapp.com/channel/0029VagJlnG6xCSU2tS1Vz19\n\n> Instagram:\nhttps://www.instagram.com/xh_clinton\n\n> BotRepo:\nhttps://github.com/xhclintohn/Toxic-MD\n\n│❒ Don't forget to give a ⭐ to our repo and fork it to stay updated! :)\n◈━━━━━━━━━━━◈`;

                    await sock.sendMessage(sock.user.id, { text: infoMessage }, { quoted: sentSession });

                    await delay(3000);
                } catch (err) {
                    console.error('❌ Error sending session:', err);
                }

                sock.ws.close();
                await cleanUpSession();
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode === 401) {
                    console.log('❌ Logged out');
                    await cleanUpSession();
                } else {
                    console.log('⚠️ Connection closed, code:', statusCode);
                    if (!sessionSent) await cleanUpSession();
                }
            }
        });

    } catch (err) {
        console.error('❌ Error during pairing:', err);
        await cleanUpSession();
        if (!responseSent && !res.headersSent) {
            res.status(500).json({ error: 'Service Unavailable. Please try again.' });
        }
    }
});

module.exports = router;
