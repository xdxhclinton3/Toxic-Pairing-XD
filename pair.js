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

const { version } = require('@whiskeysockets/baileys/lib/Defaults/baileys-version.json');

const router = express.Router();
const sessionDir = path.join(__dirname, 'temp');

if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
}

function removePath(targetPath) {
    if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
    }
}

router.get('/', async (req, res) => {
    const id = makeid();
    const num = String(req.query.number || '').replace(/[^0-9]/g, '');
    const tempDir = path.join(sessionDir, id);

    let responseSent = false;
    let finished = false;
    let sessionCleanedUp = false;
    let sock = null;
    let reconnecting = false;
    let pairingCodeRequested = false;
    let openHandled = false;
    let pairingTimeout = null;

    async function cleanUpSession() {
        if (sessionCleanedUp) return;
        sessionCleanedUp = true;
        try {
            removePath(tempDir);
        } catch (err) {
            console.error('Cleanup error:', err);
        }
    }

    async function closeSocket() {
        try {
            if (sock?.ev) {
                try {
                    sock.ev.removeAllListeners('connection.update');
                    sock.ev.removeAllListeners('creds.update');
                } catch {}
            }
            if (sock?.ws) {
                sock.ws.close();
            }
        } catch (err) {
            console.error('Socket close error:', err);
        }
    }

    async function fail(status, message) {
        if (finished) return;
        finished = true;
        if (pairingTimeout) clearTimeout(pairingTimeout);
        await closeSocket();
        await cleanUpSession();
        if (!responseSent && !res.headersSent) {
            res.status(status).json({ code: message });
            responseSent = true;
        }
    }

    async function sendSessionToUser() {
        if (finished || openHandled) return;
        openHandled = true;

        console.log('✅ Toxic-MD successfully connected to WhatsApp.');
        console.log('⏳ Waiting for session to sync and stabilize...');

        try {
            await sock.sendMessage(sock.user.id, {
                text: `
◈━━━━━━━━━━━◈
│❒ Hello! 👋 You're now connected to Toxic-MD.
│❒ Please wait a moment while we generate your session ID. It will be sent shortly... 🙂
◈━━━━━━━━━━━◈
`
            });
        } catch (err) {
            console.log('Welcome message skipped, continuing...');
        }

        await delay(25000);
        console.log('⏳ Reading session data...');

        const credsPath = path.join(tempDir, 'creds.json');
        let sessionData = null;
        let attempts = 0;
        const maxAttempts = 15;

        while (attempts < maxAttempts && !sessionData && !finished) {
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
            } catch (readError) {
                console.error('Read attempt error:', readError);
            }

            attempts++;
            if (!sessionData) {
                await delay(6000);
            }
        }

        if (!sessionData) {
            try {
                await sock.sendMessage(sock.user.id, {
                    text: 'Failed to generate session. Please try again.'
                });
            } catch {}
            await fail(500, 'Failed to generate session');
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
◈━━━━━━━━━━━◈
`;

            console.log('📤 Sending information message...');
            await sock.sendMessage(
                sock.user.id,
                { text: infoMessage },
                { quoted: sentSession }
            );

            console.log('⏳ Finalizing session...');
            await delay(5000);

            finished = true;
            if (pairingTimeout) clearTimeout(pairingTimeout);
            await closeSocket();
            await cleanUpSession();
        } catch (sendError) {
            console.error('Error sending session:', sendError);
            await fail(500, 'Failed to send session');
        }
    }

    async function startSocket() {
        if (finished) return;

        const { state, saveCreds } = await useMultiFileAuthState(tempDir);

        sock = Toxic_Tech({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    pino({ level: 'silent' })
                )
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
            transactionOpts: {
                maxCommitRetries: 10,
                delayBetweenTriesMs: 3000
            },
            retryRequestDelayMs: 10000
        });

        sock.ev.on('creds.update', saveCreds);

        if (!state.creds.registered && !pairingCodeRequested) {
            pairingCodeRequested = true;
            await delay(3000);
            const code = await sock.requestPairingCode(num);
            if (!responseSent && !res.headersSent) {
                res.json({ code });
                responseSent = true;
            }
        } else if (state.creds.registered && !responseSent && !res.headersSent) {
            res.json({ code: 'Already registered' });
            responseSent = true;
        }

        sock.ev.on('connection.update', async update => {
            const { connection, lastDisconnect, qr } = update;

            if (finished) return;

            if (qr) {
                console.log('QR code received');
            }

            if (connection === 'connecting') {
                console.log('⏳ Connecting to WhatsApp...');
                return;
            }

            if (connection === 'open') {
                reconnecting = false;
                await sendSessionToUser();
                return;
            }

            if (connection === 'close') {
                const statusCode =
                    lastDisconnect?.error?.output?.statusCode ||
                    lastDisconnect?.error?.statusCode ||
                    lastDisconnect?.output?.statusCode;

                console.log('❌ Connection closed:', statusCode || 'unknown');

                if (statusCode === 515 && !reconnecting && !finished) {
                    reconnecting = true;
                    console.log('🔁 Restart required, recreating socket...');
                    await closeSocket();
                    await delay(1500);
                    return startSocket();
                }

                if (!finished) {
                    await fail(
                        500,
                        statusCode === 401
                            ? 'Connection closed permanently'
                            : `Connection closed before completion (${statusCode || 'unknown'})`
                    );
                }
            }
        });
    }

    if (!num) {
        return res.status(400).json({ code: 'Invalid or missing number' });
    }

    pairingTimeout = setTimeout(async () => {
        await fail(500, 'Service Error - Timeout');
    }, 300000);

    try {
        await startSocket();
    } catch (err) {
        console.error('❌ Error during pairing:', err);
        await fail(500, 'Service Unavailable. Please try again.');
    }
});

module.exports = router;