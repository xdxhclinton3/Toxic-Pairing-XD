const express = require('express');
const fs = require('fs');
const pino = require('pino');
const { makeid } = require('./id');
const PastebinAPI = require('pastebin-js');
const pastebin = new PastebinAPI('EMWTMkQAVfJa9kM-MRUrxd5Oku1U7pgL');

const {
  default: Toxic_Tech,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const router = express.Router();

function removeFile(path) {
  if (fs.existsSync(path)) fs.rmSync(path, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
  const id = makeid();
  const phone = (req.query.number || '').replace(/[^0-9]/g, '');
  const tempDir = `./temp/${id}`;

  async function startPairing() {
    try {
      const { version } = await fetchLatestBaileysVersion();
      const { state, saveCreds } = await useMultiFileAuthState(tempDir);

      const sock = Toxic_Tech({
        version,
        logger: pino({ level: 'fatal' }),
        printQRInTerminal: false,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
        },
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
      });

      // === FIXED: Correct registered check ===
      if (!state.creds.registered) {
        await delay(1200);
        const code = await sock.requestPairingCode(phone);
        if (!res.headersSent) res.send({ code });
      }

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
          console.log('✅ Toxic-MD successfully connected to WhatsApp.');

          await sock.sendMessage(sock.user.id, {
            text: `
◈━━━━━━━━━━━◈
│❒ Hello! 👋 You're now connected to Toxic-MD.

│❒ Please wait a moment while we generate your session ID. It will be sent shortly... 🙂
◈━━━━━━━━━━━◈
`,
          });

          await delay(8000);

          const credsPath = `${tempDir}/creds.json`;
          if (!fs.existsSync(credsPath)) return;

          const data = fs.readFileSync(credsPath);
          const base64 = Buffer.from(data).toString('base64');

          const sentSession = await sock.sendMessage(sock.user.id, { text: base64 });

          const infoMessage = `
          ◈━━━━━━━◈
      SESSION CONNECTED
│❒ The long code above is your **Session ID**. Please copy and store it safely, as you'll need it to deploy your Toxic-MD bot! 🔐

│❒ Need help? Reach out to us:

『••• Visit For Help •••』
> Owner:
 _https://wa.me/254735342808_
 
> WaGroup:
 _https://chat.whatsapp.com/GoXKLVJgTAAC3556FXkfFI_
 
> WaChannel:
 _https://whatsapp.com/channel/0029VagJlnG6xCSU2tS1Vz19_

> Instagram:
 _https://www.instagram.com/xh_clinton_
 
 > BotRepo: _https://github.com/xhclintohn/Toxic-MD_
 
│❒ Don't forget to give a ⭐ to our repo and fork it to stay updated! :)
◈━━━━━━━━━━━◈`;

          await sock.sendMessage(sock.user.id, { text: infoMessage }, { quoted: sentSession });

          // === FIXED: Allow messages to finish sending ===
          await delay(3000);
          sock.ws.close();

          // === FIXED: Prevent early deletion ===
          await delay(1500);
          removeFile(tempDir);
        }

        // === Handle Disconnection / Retry ===
        if (
          connection === 'close' &&
          lastDisconnect?.error?.output?.statusCode !== 401
        ) {
          console.log('⚠️ Connection lost. Retrying...');
          await delay(5000);
          startPairing();
        }
      });
    } catch (err) {
      console.error('❌ Error during pairing:', err);
      removeFile(tempDir);
      if (!res.headersSent) res.send({ code: 'Service Unavailable. Please try again.' });
    }
  }

  await startPairing();
});

module.exports = router;