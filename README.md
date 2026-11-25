# Toxic Pairing XD

A small web service that pairs a WhatsApp number and hands back a **session ID** you can use to run [Toxic-MD](https://github.com/xhclintohn/Toxic-MD). Pair with a code or scan a QR — either way, the session ID is sent straight to your WhatsApp with a copy button.

It runs on [Toxic Baileys](https://github.com/xhclintohn/Baileys), a fork of the Baileys WhatsApp Web API.

---

## How it works

1. Open the pairing page and enter your WhatsApp number (with country code, no `+` or spaces).
2. You get a pairing code — or switch to the QR page and scan instead.
3. On your phone: **WhatsApp → Settings → Linked Devices → Link a Device**, then enter the code or scan the QR.
4. Once linked, your session ID is sent to your own WhatsApp chat. Copy it and use it as your bot's `SESSION`.

The session ID is just your `creds.json` encoded in base64, which is exactly what Toxic-MD expects.

---

## Run it yourself

You need Node.js 20 or newer.

```bash
git clone https://github.com/xdxhclinton3/Toxic-Pairing-XD
cd Toxic-Pairing-XD
npm install
npm start
```

The server listens on `http://localhost:8000` by default.

### Environment variables

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8000` | Port the server listens on |
| `MAX_PAIRING_SESSIONS` | `10` | How many pairings can run at the same time. Extra requests get a "busy, try again" reply instead of piling up |

### Pages and endpoints

| Route | What it is |
|---|---|
| `/` | Main page |
| `/pair` | Pairing-code page |
| `/qr` | QR page |
| `/code?number=<number>` | Returns a pairing code as JSON |
| `/qr/code` | Returns a QR code to scan |

Each pairing uses a temporary folder that is deleted as soon as the session ID is sent, and leftover folders are swept every 10 minutes. Nothing is kept on the server.

---

## How the connection is made

The socket is created the same way Toxic-MD creates it — Android Chrome fingerprint, silent logger, pairing code requested once the socket is ready.

<details>
<summary>Connection example</summary>

```js
const {
  default: makeWASocket,
  useMultiFileAuthState,
  Browsers,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const pino = require('pino');

const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

const sock = makeWASocket({
  auth: {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
  },
  logger: pino({ level: 'silent' }),
  browser: Browsers.android('Chrome'),
  syncFullHistory: false,
  markOnlineOnConnect: false,
});

sock.ev.on('creds.update', saveCreds);

sock.ev.on('connection.update', async ({ qr }) => {
  if (qr && !state.creds.registered) {
    const code = await sock.requestPairingCode(number);
    console.log('Pairing code:', code);
  }
});
```

</details>

---

## Notes

- The Android fingerprint describes the linked device, not your phone — iPhone users pair exactly the same way; the device just shows as "Android" in Linked Devices.
- If a pairing fails midway, the socket reconnects with backoff and re-uses the same code, so the code you already have stays valid.
- Use a number you are comfortable linking. Pairing links a new device to that WhatsApp account.

## License

GPL-3.0
