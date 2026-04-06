const { makeid } = require('./id');
const QRCode = require('qrcode');
const express = require('express');
const path = require('path');
const fs = require('fs');
const pino = require('pino');

const {
    default: Toxic_Tech,
    useMultiFileAuthState,
    Browsers,
    delay,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const router = express.Router();
const tempRoot = path.join(__dirname, 'temp');

if (!fs.existsSync(tempRoot)) {
    fs.mkdirSync(tempRoot, { recursive: true });
}

function removeFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.rmSync(filePath, {
                recursive: true,
                force: true
            });
        }
    } catch (err) {
        console.error('❌ Cleanup error:', err.message);
    }
}

router.get('/', async (req, res) => {
    const id = makeid();
    const sessionDir = path.join(tempRoot, id);

    let responseSent = false;
    let finished = false;
    let reconnecting = false;
    let sock = null;

    async function cleanup() {
        try {
            if (sock?.ev) {
                try {
                    sock.ev.removeAllListeners('connection.update');
                    sock.ev.removeAllListeners('creds.update');
                } catch {}
            }
            if (sock?.ws) {
                try {
                    sock.ws.close();
                } catch {}
            }
        } catch {}

        removeFile(sessionDir);
    }

    async function fail(message, status = 500) {
        if (finished) return;
        finished = true;
        await cleanup();

        if (!responseSent && !res.headersSent) {
            res.status(status).json({
                code: message
            });
            responseSent = true;
        }
    }

    async function startSocket() {
        try {
            if (finished) return;

            if (!fs.existsSync(sessionDir)) {
                fs.mkdirSync(sessionDir, { recursive: true });
            }

            const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
            const { version } = await fetchLatestBaileysVersion();

            sock = Toxic_Tech({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: 'silent' })
                    ),
                },
                printQRInTerminal: false,
                logger: pino({ level: 'silent' }),
                browser: Browsers.ubuntu("Chrome"),
                syncFullHistory: false,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                generateHighQualityLinkPreview: true,
                markOnlineOnConnect: false
            });

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (update) => {
                try {
                    const { connection, lastDisconnect, qr } = update;

                    if (finished) return;

                    if (qr && !responseSent && !res.headersSent) {
                        const qrBuffer = await QRCode.toBuffer(qr);
                        res.setHeader('Content-Type', 'image/png');
                        res.setHeader('Cache-Control', 'no-store');
                        res.end(qrBuffer);
                        responseSent = true;
                    }

                    if (connection === 'open') {
                        console.log(`✅ QR Code connected for session ${id}`);

                        try {
                            await sock.sendMessage(sock.user.id, {
                                text: `
◈━━━━━━━━━━━◈
│❒ Hello! 👋 You're now connected to Toxic-MD.
│❒ Please wait a moment while we generate your session ID. It will be sent shortly... 🙂
◈━━━━━━━━━━━◈
`
                            });
                        } catch {
                            console.log('⚠️ Welcome message skipped');
                        }

                        await delay(5000);
                        await saveCreds();
                        await delay(2000);

                        const credsPath = path.join(sessionDir, 'creds.json');

                        if (!fs.existsSync(credsPath)) {
                            return await fail('Failed to generate creds.json');
                        }

                        const data = fs.readFileSync(credsPath);
                        const b64data = Buffer.from(data).toString('base64');

                        const session = await sock.sendMessage(sock.user.id, {
                            text: b64data
                        });

                        const Toxic_MD_TEXT = `
◈━━━━━━━━━━━◈
SESSION CONNECTED

│❒ The long code above is your Session ID. Please copy and store it safely, as you'll need it to deploy your Toxic-MD bot! 🔐

│❒ Need help? Reach out to us:

『••• Visit For Help •••』
> Owner/Developer:
_https://wa.me/254114885159_

> WaGroup:
_https://chat.whatsapp.com/GoXKLVJgTAAC3556FXkfFI_

> WaChannel:
_https://whatsapp.com/channel/0029VagJlnG6xCSU2tS1Vz19_

> Instagram:
https://www.instagram.com/xh_clinton

> Bot Repo:
_https://github.com/xhclintohn/Toxic-MD_

│❒ Don't forget to give a ⭐ to our repo and fork it to stay updated! :)
◈━━━━━━━━━━━◈`;

                        await sock.sendMessage(
                            sock.user.id,
                            { text: Toxic_MD_TEXT },
                            { quoted: session }
                        );

                        finished = true;
                        await delay(1000);
                        await cleanup();
                        return;
                    }

                    if (connection === 'close') {
                        const statusCode =
                            lastDisconnect?.error?.output?.statusCode ||
                            lastDisconnect?.error?.statusCode;

                        if (finished) return;

                        if (statusCode === 401) {
                            console.log(`⚠️ Logged out for session ${id}`);
                            return await fail('Logged out');
                        }

                        if (statusCode === 515 && !reconnecting) {
                            reconnecting = true;
                            console.log(`🔄 Restart required for session ${id}...`);
                            try {
                                if (sock?.ws) sock.ws.close();
                            } catch {}
                            await delay(1500);
                            reconnecting = false;
                            return startSocket();
                        }

                        if (!reconnecting) {
                            reconnecting = true;
                            console.log(`🔄 Reconnecting session ${id}...`);
                            try {
                                if (sock?.ws) sock.ws.close();
                            } catch {}
                            await delay(3000);
                            reconnecting = false;
                            return startSocket();
                        }
                    }
                } catch (err) {
                    console.log(`❌ Connection update error: ${err.message}`);
                    await fail('Service is Currently Unavailable. Please try again.');
                }
            });
        } catch (err) {
            console.log('❌ Service error:', err.message);
            await fail('Service is Currently Unavailable. Please try again.');
        }
    }

    return startSocket();
});

module.exports = router;