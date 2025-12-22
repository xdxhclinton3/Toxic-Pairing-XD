const {
    default: Toxic_Tech,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

module.exports = async (context) => {
    const { client, m, text, prefix } = context;

    try {
        if (!text) {
            return await client.sendMessage(m.chat, {
                text: `📱 *Please provide a number to pair!*\n\nExample:\n*${prefix}pair 254712345678*`
            }, { quoted: m });
        }

        const number = text.replace(/[^0-9]/g, '');
        if (number.length < 6 || number.length > 20) {
            return await client.sendMessage(m.chat, {
                text: `❌ *Invalid number!* Please enter a valid WhatsApp number (6–20 digits).`
            }, { quoted: m });
        }

        await client.sendMessage(m.chat, { react: { text: '⌛', key: m.key } });

        const tempPath = path.join(__dirname, 'temps', number);
        if (!fs.existsSync(tempPath)) fs.mkdirSync(tempPath, { recursive: true });

        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState(tempPath);

        const Toxic_MD_Client = Toxic_Tech({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
            },
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: ["Ubuntu", "Chrome", "125"],
            syncFullHistory: false,
            generateHighQualityLinkPreview: true,
            markOnlineOnConnect: true,
            connectTimeoutMs: 120000,
            keepAliveIntervalMs: 30000,
            defaultQueryTimeoutMs: 60000,
            transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
            retryRequestDelayMs: 10000
        });

        Toxic_MD_Client.ev.on('creds.update', saveCreds);

        await delay(2000);
        const code = await Toxic_MD_Client.requestPairingCode(number);

        if (!code) throw new Error("Failed to generate pairing code.");

        await client.sendMessage(m.chat, { react: { text: '✅', key: m.key } });

        await client.sendMessage(m.chat, {
            text: `✅ *Pairing Code Generated!*\n\n📱 *For Number:* ${number}\n\n🔐 *Your Pairing Code:*`,
            templateButtons: [{
                index: 1,
                urlButton: {
                    displayText: `📋 Copy Code: ${code}`,
                    url: `https://api.whatsapp.com/send/?phone=${number}&text=${encodeURIComponent(code)}&type=phone_number&app_absent=0`
                }
            }, {
                index: 2,
                urlButton: {
                    displayText: "📖 How to Use",
                    url: "https://github.com/xhclintohn/Toxic-MD#pairing-instructions"
                }
            }, {
                index: 3,
                quickReplyButton: {
                    displayText: "🔄 Generate Again",
                    id: `${prefix}pair ${number}`
                }
            }],
            footer: "Toxic-MD Pairing System",
            viewOnce: true
        }, { quoted: m });

        await client.sendMessage(m.chat, {
            text: `📝 *Instructions:*\n\n1. The code above is your *pairing code*\n2. Use it within *3 minutes* on WhatsApp\n3. Open WhatsApp → Settings → Linked Devices → Link a Device\n4. Enter the code: *${code}*\n\n⚠️ *Important:*\n• Code expires in 3 minutes\n• Keep this code private\n• Don't share with anyone\n\n📞 *Need Help?*\n• Owner: https://wa.me/254735342808\n• Group: https://chat.whatsapp.com/GoXKLVJgTAAC3556FXkfFI\n• Channel: https://whatsapp.com/channel/0029VagJlnG6xCSU2tS1Vz19\n• Repo: https://github.com/xhclintohn/Toxic-MD\n\nDon't forget to ⭐ the repo!`
        }, { quoted: m });

        await Toxic_MD_Client.ws.close();

        setTimeout(() => {
            if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { recursive: true, force: true });
        }, 5000);

    } catch (error) {
        console.error("Error in pair command:", error);
        await client.sendMessage(m.chat, { react: { text: '❌', key: m.key } });
        await client.sendMessage(m.chat, {
            text: `⚠️ *Failed to generate pairing code.*\n\nError: ${error.message || "Unknown error"}\n\nTry again later or check your number.\n\n*Possible Issues:*\n1. Number not registered on WhatsApp\n2. Network timeout\n3. WhatsApp server busy\n\n📞 *Support:* https://wa.me/254735342808\n📚 *Docs:* https://github.com/xhclintohn/Toxic-MD`
        }, { quoted: m });
    }
};