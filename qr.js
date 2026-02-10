const PastebinAPI = require('pastebin-js');
const pastebin = new PastebinAPI('EMWTMkQAVfJa9kM-MRUrxd5Oku1U7pgL');
const { makeid } = require('./id');
const QRCode = require('qrcode');
const express = require('express');
const path = require('path');
const fs = require('fs');
let router = express.Router();
const pino = require('pino');
const {
    default: Toxic_Tech,
    useMultiFileAuthState,
    jidNormalizedUser,
    Browsers,
    delay,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, {
            recursive: true,
            force: true
        });
    } catch (e) {
        console.error("removeFile error:", e.message);
    }
}

const { readFile } = require('node:fs/promises');

router.get('/', async (req, res) => {
    const id = makeid();
    let qrSock = null;
    let qrSent = false;

    async function Toxic_MD_QR_CODE() {
        const { state, saveCreds } = await useMultiFileAuthState('./temp/' + id);
        try {
            qrSock = Toxic_Tech({
                version: (await (await fetch('https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/src/Defaults/baileys-version.json')).json()).version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }).child({ level: 'silent' })),
                },
                printQRInTerminal: false,
                logger: pino({ level: 'silent' }).child({ level: 'silent' }),
                browser: ['Ubuntu', 'Chrome', '20.0.04'],
                syncFullHistory: false,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000
            });

            qrSock.ev.on('creds.update', saveCreds);
            qrSock.ev.on('connection.update', async (s) => {
                const { connection, lastDisconnect, qr } = s;
                if (qr && !qrSent && !res.headersSent) {
                    try {
                        qrSent = true;
                        res.end(await QRCode.toBuffer(qr));
                    } catch (e) {
                        console.error("QR send error:", e.message);
                    }
                }
                if (connection === 'open') {
                    try {
                        await qrSock.sendMessage(qrSock.user.id, { text: `
◈━━━━━━━━━━━◈
│❒ Hello! 👋 You're now connected to Toxic-MD.

│❒ Please wait a moment while we generate your session ID. It will be sent shortly... 🙂
◈━━━━━━━━━━━◈
` });
                    } catch (e) {}

                    await delay(5000);
                    let data = fs.readFileSync(__dirname + `/temp/${id}/creds.json`);
                    await delay(8000);
                    let b64data = Buffer.from(data).toString('base64');
                    let session = await qrSock.sendMessage(qrSock.user.id, { text: '' + b64data });

                    let Toxic_MD_TEXT = `
           ◈━━━━━━◈
      SESSION CONNECTED
      
│❒ The long code above is your **Session ID**. Please copy and store it safely, as you'll need it to deploy your Toxic-MD bot! 🔐

│❒ Need help? Reach out to us:

『••• Visit For Help •••』
> Owner/Developer:
 _https://wa.me/254735342808_

> WaGroup:
 _https://chat.whatsapp.com/GoXKLVJgTAAC3556FXkfFI_

> WaChannel:
 _https://whatsapp.com/channel/0029VagJlnG6xCSU2tS1Vz19_

> Instagram:
 https://www.instagram.com/xh_clinton
 
 > Bot Repo
 _https://github.com/xhclintohn/Toxic-MD_

│❒ Don't forget to give a ⭐ to our repo and fork it to stay updated! :)
◈━━━━━━━━━━━◈`;

                    await qrSock.sendMessage(qrSock.user.id, { text: Toxic_MD_TEXT }, { quoted: session });

                    await delay(100);
                    await qrSock.ws.close();
                    return await removeFile('./temp/' + id);
                } else if (connection === 'close') {
                    console.log('QR pairing connection closed');
                    removeFile('./temp/' + id);
                }
            });
        } catch (err) {
            console.log('Service restarted due to error:', err);
            await removeFile('./temp/' + id);
            if (!res.headersSent) {
                await res.json({ code: 'Service is Currently Unavailable' });
            }
        }
    }
    return await Toxic_MD_QR_CODE();
});

module.exports = router;
