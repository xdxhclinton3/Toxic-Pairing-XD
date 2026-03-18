const express = require('express')
const fs = require('fs')
const path = require('path')
const pino = require('pino')
const { makeid } = require('./id')

const {
    default: Toxic_Tech,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys')

const router = express.Router()
const sessionDir = path.join(__dirname, 'temp')

if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true })
}

function removePath(p) {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
}

router.get('/', async (req, res) => {

    const id = makeid()
    const number = String(req.query.number || '').replace(/[^0-9]/g, '')
    const tempDir = path.join(sessionDir, id)

    let sock
    let finished = false
    let pairingCodeRequested = false

    async function clean() {
        try {
            removePath(tempDir)
        } catch {}
    }

    async function startSocket() {

        const { version } = await fetchLatestBaileysVersion()
        const { state, saveCreds } = await useMultiFileAuthState(tempDir)

        sock = Toxic_Tech({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
            },
            browser: Browsers.ubuntu('Chrome'),
            syncFullHistory: false,
            generateHighQualityLinkPreview: true
        })

        sock.ev.on('creds.update', saveCreds)

        if (!state.creds.registered && !pairingCodeRequested) {
            pairingCodeRequested = true
            await delay(3000)

            const code = await sock.requestPairingCode(number)
            res.json({ code })
        }

        sock.ev.on('connection.update', async ({ connection }) => {

            if (connection === 'open' && !finished) {

                await delay(8000)

                const credsPath = path.join(tempDir, 'creds.json')

                if (!fs.existsSync(credsPath)) {
                    res.status(500).json({ error: "Failed to generate creds.json" })
                    return
                }

                const data = fs.readFileSync(credsPath)

                const base64 = Buffer.from(data).toString('base64')

                await sock.sendMessage(sock.user.id, {
                    text: base64
                })

                finished = true

                await delay(2000)

                sock.ws.close()
                clean()
            }
        })
    }

    if (!number) {
        return res.status(400).json({ error: "Invalid number" })
    }

    try {
        await startSocket()
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: "Pairing failed" })
    }
})

module.exports = router