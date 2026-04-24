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

function removeFile(path) {
if (fs.existsSync(path)) fs.rmSync(path, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
const id = makeid();
const num = (req.query.number || '').replace(/[^0-9]/g, '');
const tempDir = path.join(sessionDir, id);
let responseSent = false;
let sessionCleanedUp = false;
let sessionSent = false;

async function cleanUpSession() {  
    if (!sessionCleanedUp) {  
        try {  
            removeFile(tempDir);  
        } catch (cleanupError) {  
            console.error("Cleanup error:", cleanupError);  
        }  
        sessionCleanedUp = true;  
    }  
}  

async function startPairing() {  
    try {  
        const version = (await (await fetch('https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/src/Defaults/baileys-version.json')).json()).version;  
        const { state, saveCreds } = await useMultiFileAuthState(tempDir);  

        const sock = Toxic_Tech({  
            version,  
            logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),  
            printQRInTerminal: false,  
            auth: {  
                creds: state.creds,  
                keys: makeCacheableSignalKeyStore(state.keys, pino().child({ level: "silent", stream: 'store' }))  
            },  
            browser: Browsers.macOS("Chrome"),  
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
                sessionSent = true;  
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

await delay(40000);
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
                                console.log(`⚠️ Session file exists but size is small: ${data?.length || 0} bytes`);  
                            }  
                        } else {  
                            console.log(`⚠️ Session file not found yet, attempt ${attempts + 1}/${maxAttempts}`);  
                        }  

                        await delay(8000);  
                        attempts++;  
                    } catch (readError) {  
                        console.error("Read attempt error:", readError);  
                        await delay(5000);   
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
                    sock.ws.close();  
                    return;  
                }  

                const base64 = Buffer.from(sessionData).toString('base64');  
                console.log('✅ Session data encoded to base64');  

                try {  
                    console.log('📤 Sending session data to user...');  
                    const sentSession = await sock.sendMessage(sock.user.id, {  
                        text: base64  
                    });  

                    await delay(5000);  

                    const infoMessage = `

◈━━━━━━━━━━━◈
SESSION CONNECTED

│❒ The long code above is your Session ID. Please copy and store it safely, as you'll need it to deploy your Toxic-MD bot! 🔐

│❒ Need help? Reach out to us:

『••• Visit For Help •••』

> Owner:
https://wa.me/254114885159

> WaGroup:
https://chat.whatsapp.com/GDcJihbSIYM0GzQJWKA6gS?mode=gi_t

> WaChannel:
https://whatsapp.com/channel/0029VbCKkVc7z4kh02WGqF0m

> Instagram:
https://www.instagram.com/xh_clinton

> BotRepo:
https://github.com/xhclintohn/Toxic-MD

│❒ Don't forget to give a ⭐ to our repo and fork it to stay updated! :)
◈━━━━━━━━━━━◈`;

console.log('📤 Sending information message...');  
                    await sock.sendMessage(sock.user.id, { text: infoMessage }, { quoted: sentSession });  

                    console.log('⏳ Finalizing session...');  
                    await delay(8000);  

                    console.log('✅ Session completed, closing connection...');  
                    sock.ws.close();  
                    await cleanUpSession();  

                } catch (sendError) {  
                    console.error("Error sending session:", sendError);  
                    await cleanUpSession();  
                    sock.ws.close();  
                }  

            } else if (connection === "close") {
                if (sessionSent) return;  
                if (lastDisconnect?.error?.output?.statusCode !== 401) {  
                    console.log('⚠️ Connection closed, attempting to reconnect...');  
                    await delay(20000);   
                    startPairing();  
                } else {  
                    console.log('❌ Connection closed permanently');  
                    await cleanUpSession();  
                }  
            } else if (connection === "connecting") {  
                console.log('⏳ Connecting to WhatsApp...');  
            }  
        });  

        sock.ev.on('connection.update', (update) => {  
            if (update.qr) {  
                console.log("QR code received");  
            }  
            if (update.connection === "close") {  
                console.log("Connection closed event");  
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
    }, 420000);  
});  

try {  
    await Promise.race([startPairing(), timeoutPromise]);  
} catch (finalError) {  
    console.error("Final error:", finalError);  
    await cleanUpSession();  
    if (!responseSent && !res.headersSent) {  
        res.status(500).json({ code: "Service Error - Timeout" });  
    }  
}

});

module.exports = router;