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
if (!fs.existsSync(FilePath)) return false;
fs.rmSync(FilePath, {
recursive: true,
force: true
});
}

const { readFile } = require('node:fs/promises');

router.get('/', async (req, res) => {
const id = makeid();
let responseSent = false;

async function Toxic_MD_QR_CODE() {  
    try {  
        const { state, saveCreds } = await useMultiFileAuthState('./temp/' + id);  

        let Qr_Code_By_Toxic_Tech = Toxic_Tech({  
            version: (await (await fetch('https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/src/Defaults/baileys-version.json')).json()).version,  
            auth: {  
                creds: state.creds,  
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }).child({ level: 'silent' })),  
            },  
            printQRInTerminal: false,  
            logger: pino({ level: 'silent' }).child({ level: 'silent' }),  
            browser: Browsers.macOS("Chrome"),  
            syncFullHistory: false,  
            connectTimeoutMs: 60000,  
            keepAliveIntervalMs: 30000,  
            generateHighQualityLinkPreview: true,  
            markOnlineOnConnect: false  
        });  

        Qr_Code_By_Toxic_Tech.ev.on('creds.update', saveCreds);  

        Qr_Code_By_Toxic_Tech.ev.on('connection.update', async (s) => {  
            try {  
                const { connection, lastDisconnect, qr } = s;  

                if (qr && !responseSent && !res.headersSent) {  
                    await res.end(await QRCode.toBuffer(qr));  
                    responseSent = true;  
                }  

                if (connection === 'open') {  
                    console.log(`✅ QR Code connected for session ${id}`);  

                    await Qr_Code_By_Toxic_Tech.sendMessage(Qr_Code_By_Toxic_Tech.user.id, {   
                        text: `

◈━━━━━━━━━━━◈
│❒ Hello! 👋 You're now connected to Toxic-MD.

│❒ Please wait a moment while we generate your session ID. It will be sent shortly... 🙂
◈━━━━━━━━━━━◈
`
});

await delay(5000);  

                    let data = fs.readFileSync(__dirname + `/temp/${id}/creds.json`);  

                    await delay(8000);  

                    let b64data = Buffer.from(data).toString('base64');  
                    let session = await Qr_Code_By_Toxic_Tech.sendMessage(Qr_Code_By_Toxic_Tech.user.id, {   
                        text: '' + b64data   
                    });  

                    let Toxic_MD_TEXT = `  
       ◈━━━━━━◈  
  SESSION CONNECTED

│❒ The long code above is your Session ID. Please copy and store it safely, as you'll need it to deploy your Toxic-MD bot! 🔐

│❒ Need help? Reach out to us:

『••• Visit For Help •••』

> Owner/Developer:
https://wa.me/254735342808



> WaGroup:
https://chat.whatsapp.com/GoXKLVJgTAAC3556FXkfFI



> WaChannel:
https://whatsapp.com/channel/0029VagJlnG6xCSU2tS1Vz19



> Instagram:
https://www.instagram.com/xh_clinton



> Bot Repo
https://github.com/xhclintohn/Toxic-MD



│❒ Don't forget to give a ⭐ to our repo and fork it to stay updated! :)
◈━━━━━━━━━━━◈`;

await Qr_Code_By_Toxic_Tech.sendMessage(Qr_Code_By_Toxic_Tech.user.id, {   
                        text: Toxic_MD_TEXT   
                    }, {   
                        quoted: session   
                    });  

                    await delay(1000);  
                    await Qr_Code_By_Toxic_Tech.ws.close();  
                    await removeFile('./temp/' + id);  

                } else if (connection === 'close') {  
                    const statusCode = lastDisconnect?.error?.output?.statusCode;  

                    if (statusCode === 401) {  
                        console.log(`⚠️ Logged out for session ${id}`);  
                        await removeFile('./temp/' + id);  
                    } else if (statusCode !== 401) {  
                        console.log(`🔄 Reconnecting session ${id}...`);  
                        await delay(5000);  
                        Toxic_MD_QR_CODE();  
                    }  
                }  
            } catch (err) {  
                console.log(`❌ Connection update error: ${err.message}`);  
            }  
        });  
    } catch (err) {  
        console.log('❌ Service error:', err.message);  
        await removeFile('./temp/' + id);  
        if (!res.headersSent) {  
            await res.status(500).json({   
                code: 'Service is Currently Unavailable. Please try again.'   
            });  
        }  
    }  
}  

return await Toxic_MD_QR_CODE();

});

module.exports = router;