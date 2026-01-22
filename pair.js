const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const { MongoClient } = require('mongodb');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  getContentType,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
  downloadContentFromMessage,
  DisconnectReason
} = require('@whiskeysockets/baileys');

const BOT_NAME_FREE = '𝐓𝐨𝐱𝐢𝐜-𝐌𝐢𝐧𝐢';

const config = {
  AUTO_VIEW_STATUS: 'true',
  AUTO_LIKE_STATUS: 'true',
  AUTO_RECORDING: 'false',
  AUTO_LIKE_EMOJI: ['❤️', '🔥', '🌟', '💯'],
  PREFIX: '.',
  MAX_RETRIES: 5,
  GROUP_INVITE_LINK: 'https://chat.whatsapp.com/GoXKLVJgTAAC3556FXkfFI',
  FREE_IMAGE: 'https://raw.githubusercontent.com/xhclintohn/Music-Clips-Collection/main/cici.jpg',
  NEWSLETTER_JID: '120363322461279856@newsletter',

  OTP_EXPIRY: 300000,
  OWNER_NUMBER: process.env.OWNER_NUMBER || '254735342808',
  BOT_NAME: '𝐓𝐨𝐱𝐢𝐜-𝐌𝐢𝐧𝐢',
  BOT_VERSION: '3.0.power',
  OWNER_NAME: '𝐱𝐡_𝐜𝐥𝐢𝐧𝐭𝐨𝐧',
  BOT_FOOTER: '> ᴘᴏᴡᴇʀᴇᴅ ʙʏ 𝐓𝐨𝐱𝐢𝐜-𝐌𝐢𝐧𝐢'
};

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://xh_clinton:xhclinton1@toxic-mini.n7kv9oh.mongodb.net/?appName=Toxic-Mini';
const MONGO_DB = process.env.MONGO_DB || 'Toxic-Mini';

let mongoClient, mongoDB;
let sessionsCol, numbersCol, adminCol;

const allowCors = (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
};

router.use(allowCors);
router.use(express.json());

async function initMongo() {
  try {
    if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected()) return;
  } catch(e){}
  mongoClient = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  await mongoClient.connect();
  mongoDB = mongoClient.db(MONGO_DB);

  sessionsCol = mongoDB.collection('sessions');
  numbersCol = mongoDB.collection('numbers');
  adminCol = mongoDB.collection('admins');

  await sessionsCol.createIndex({ number: 1 }, { unique: true });
  await numbersCol.createIndex({ number: 1 }, { unique: true });
  await adminCol.createIndex({ username: 1 }, { unique: true });

  try {
    const adminExists = await adminCol.findOne({ username: 'admin' });
    if (!adminExists) {
      await adminCol.insertOne({
        username: 'admin',
        password: 'admin123',
        role: 'superadmin',
        createdAt: new Date()
      });
      console.log('✅ Default admin created (username: admin, password: admin123)');
    }
  } catch(e) {}

  console.log('✅ Mongo initialized');
}

async function saveCredsToMongo(number, creds, keys = null) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = { number: sanitized, creds, keys, updatedAt: new Date() };
    await sessionsCol.updateOne({ number: sanitized }, { $set: doc }, { upsert: true });
  } catch (e) { console.error('saveCredsToMongo error:', e); }
}

async function loadCredsFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = await sessionsCol.findOne({ number: sanitized });
    return doc || null;
  } catch (e) { return null; }
}

async function removeSessionFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await sessionsCol.deleteOne({ number: sanitized });
  } catch (e) {}
}

async function addNumberToMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await numbersCol.updateOne({ number: sanitized }, { $set: { number: sanitized } }, { upsert: true });
  } catch (e) {}
}

async function removeNumberFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await numbersCol.deleteOne({ number: sanitized });
  } catch (e) {}
}

async function getAllNumbersFromMongo() {
  try {
    await initMongo();
    const docs = await numbersCol.find({}).toArray();
    return docs.map(d => d.number);
  } catch (e) { return []; }
}

async function getAllSessionsFromMongo() {
  try {
    await initMongo();
    const docs = await sessionsCol.find({}).toArray();
    return docs.map(d => ({
      number: d.number,
      updatedAt: d.updatedAt,
      isActive: activeSockets.has(d.number)
    }));
  } catch (e) { return []; }
}

async function authenticateAdmin(username, password) {
  try {
    await initMongo();
    const admin = await adminCol.findOne({ username, password });
    return admin;
  } catch (e) { return null; }
}

function formatMessage(title, content, footer) {
  return `*${title}*\n\n${content}\n\n> *${footer}*`;
}

function generateOTP(){ return Math.floor(100000 + Math.random() * 900000).toString(); }
function getZimbabweanTimestamp(){ return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss'); }

const activeSockets = new Map();
const socketCreationTime = new Map();

async function joinGroup(socket) {
  let retries = config.MAX_RETRIES;
  const inviteCodeMatch = config.GROUP_INVITE_LINK.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
  if (!inviteCodeMatch) return { status: 'failed', error: 'No group invite configured' };
  const inviteCode = inviteCodeMatch[1];
  while (retries > 0) {
    try {
      const response = await socket.groupAcceptInvite(inviteCode);
      if (response?.gid) return { status: 'success', gid: response.gid };
      throw new Error('No group ID in response');
    } catch (error) {
      retries--;
      let errorMessage = error.message || 'Unknown error';
      if (error.message && error.message.includes('not-authorized')) errorMessage = 'Bot not authorized';
      else if (error.message && error.message.includes('conflict')) errorMessage = 'Already a member';
      else if (error.message && error.message.includes('gone')) errorMessage = 'Invite invalid/expired';
      if (retries === 0) return { status: 'failed', error: errorMessage };
      await delay(2000 * (config.MAX_RETRIES - retries));
    }
  }
  return { status: 'failed', error: 'Max retries reached' };
}

async function setupStatusHandlers(socket) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages[0];
    if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant) return;
    try {
      if (config.AUTO_RECORDING === 'true') await socket.sendPresenceUpdate("recording", message.key.remoteJid);
      if (config.AUTO_VIEW_STATUS === 'true') {
        let retries = config.MAX_RETRIES;
        while (retries > 0) {
          try { await socket.readMessages([message.key]); break; }
          catch (error) { retries--; await delay(1000 * (config.MAX_RETRIES - retries)); if (retries===0) throw error; }
        }
      }
      if (config.AUTO_LIKE_STATUS === 'true') {
        const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
        let retries = config.MAX_RETRIES;
        while (retries > 0) {
          try {
            await socket.sendMessage(message.key.remoteJid, { react: { text: randomEmoji, key: message.key } }, { statusJidList: [message.key.participant] });
            break;
          } catch (error) { retries--; await delay(1000 * (config.MAX_RETRIES - retries)); if (retries===0) throw error; }
        }
      }
    } catch (error) { console.error('Status handler error:', error); }
  });
}

async function deleteSessionAndCleanup(number, socketInstance) {
  const sanitized = number.replace(/[^0-9]/g, '');
  try {
    const sessionPath = path.join(os.tmpdir(), `session_${sanitized}`);
    try { if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath); } catch(e){}
    activeSockets.delete(sanitized); 
    socketCreationTime.delete(sanitized);
    await removeSessionFromMongo(sanitized);
    await removeNumberFromMongo(sanitized);
    console.log(`Cleanup completed for ${sanitized}`);
  } catch (err) { console.error('deleteSessionAndCleanup error:', err); }
}

// NEW: Simple reconnection function without response object
async function reconnectSocket(number) {
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  console.log(`🔄 Attempting to reconnect socket for ${sanitizedNumber}...`);
  
  // Clean up old socket if exists
  if (activeSockets.has(sanitizedNumber)) {
    const oldSocket = activeSockets.get(sanitizedNumber);
    try {
      oldSocket.ws.close();
    } catch(e) {}
    activeSockets.delete(sanitizedNumber);
    socketCreationTime.delete(sanitizedNumber);
  }
  
  await delay(5000);
  
  // Start new connection
  try {
    await createWhatsAppConnection(sanitizedNumber);
    console.log(`✅ Reconnection successful for ${sanitizedNumber}`);
  } catch (error) {
    console.error(`❌ Reconnection failed for ${sanitizedNumber}:`, error);
  }
}

// NEW: Separate function for creating WhatsApp connection (used by both initial pairing and reconnection)
async function createWhatsAppConnection(sanitizedNumber, res = null) {
  const sessionPath = path.join(os.tmpdir(), `session_${sanitizedNumber}`);
  
  try {
    await initMongo();
  } catch(e) {
    console.warn('Mongo init warning:', e);
  }

  // Prefill from Mongo if available
  try {
    const mongoDoc = await loadCredsFromMongo(sanitizedNumber);
    if (mongoDoc && mongoDoc.creds) {
      fs.ensureDirSync(sessionPath);
      fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(mongoDoc.creds, null, 2));
      if (mongoDoc.keys) fs.writeFileSync(path.join(sessionPath, 'keys.json'), JSON.stringify(mongoDoc.keys, null, 2));
      console.log('Prefilled creds from Mongo');
    }
  } catch (e) { console.warn('Prefill from Mongo failed', e); }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

  try {
    const socket = makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      printQRInTerminal: false,
      logger,
      browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    socketCreationTime.set(sanitizedNumber, Date.now());

    setupStatusHandlers(socket);
    
    // Handle pairing code generation (only for HTTP requests)
    if (!socket.authState.creds.registered && res) {
      let retries = config.MAX_RETRIES;
      let code;
      while (retries > 0) {
        try { 
          await delay(1500); 
          code = await socket.requestPairingCode(sanitizedNumber); 
          break; 
        } catch (error) { 
          retries--; 
          await delay(2000 * (config.MAX_RETRIES - retries)); 
        }
      }
      if (code && !res.headersSent) {
        return res.json({ 
          success: true, 
          code: code,
          message: 'Pairing code generated',
          number: sanitizedNumber
        });
      }
    }

    // Setup connection update handler
    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;
      
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode
                           || lastDisconnect?.error?.statusCode
                           || (lastDisconnect?.error && lastDisconnect.error.toString().includes('401') ? 401 : undefined);
        const isLoggedOut = statusCode === 401
                            || (lastDisconnect?.error && lastDisconnect.error.code === 'AUTHENTICATION')
                            || (lastDisconnect?.error && String(lastDisconnect.error).toLowerCase().includes('logged out'))
                            || (lastDisconnect?.reason === DisconnectReason?.loggedOut);
        
        if (isLoggedOut) {
          console.log(`User ${sanitizedNumber} logged out. Cleaning up...`);
          await deleteSessionAndCleanup(sanitizedNumber, socket);
        } else {
          console.log(`Connection closed for ${sanitizedNumber} (not logout). Attempt reconnect...`);
          // Remove from active sockets and schedule reconnect
          activeSockets.delete(sanitizedNumber);
          socketCreationTime.delete(sanitizedNumber);
          
          // Schedule reconnect after delay
          setTimeout(() => {
            reconnectSocket(sanitizedNumber);
          }, 10000);
        }
      }
      
      if (connection === 'open') {
        console.log(`✅ Connection opened for ${sanitizedNumber}`);
        activeSockets.set(sanitizedNumber, socket);
        
        try {
          await delay(3000);
          const userJid = jidNormalizedUser(socket.user.id);
          const groupResult = await joinGroup(socket).catch(()=>({ status: 'failed', error: 'joinGroup not configured' }));

          // try follow newsletters if configured
          try {
            if (typeof socket.newsletterFollow === 'function') {
              await socket.newsletterFollow(config.NEWSLETTER_JID);
              console.log(`✅ Following newsletter: ${config.NEWSLETTER_JID}`);
            }
          } catch(e){}

          const groupStatus = groupResult.status === 'success' ? 'Joined successfully' : `Failed to join group: ${groupResult.error}`;

          const initialCaption = `*✅ Connected Successfully*\n\n*🔢 Chat No:*  ${sanitizedNumber}\n*🕒 Bot will be active in a few minutes*\n\n✅ Successfully connected!\n\n🔢 Number: ${sanitizedNumber}\n*🕒 Bot is starting up...*`;

          try {
            await socket.sendMessage(userJid, { 
              image: { url: config.FREE_IMAGE }, 
              caption: initialCaption 
            });
          } catch (e) {
            await socket.sendMessage(userJid, { text: initialCaption });
          }

          await delay(6000);

          const updatedCaption = `*✅ Connected Successfully, Now Active ❕*\n\n*🔢 Chat No:* ${sanitizedNumber}\n*📡 Condition:* ${groupStatus}\n*🕒 Connected:* ${getZimbabweanTimestamp()}`;

          try {
            await socket.sendMessage(userJid, { 
              image: { url: config.FREE_IMAGE }, 
              caption: updatedCaption 
            });
          } catch (e) {
            await socket.sendMessage(userJid, { text: updatedCaption });
          }

          await addNumberToMongo(sanitizedNumber);

          const welcomeText = `
╭────────￫
│  • ɴᴀᴍᴇ: 𝐓𝐨𝐱𝐢𝐜-𝐌𝐢𝐧𝐢                      
│  • ᴏᴡɴᴇʀ: 𝐱𝐡_𝐜𝐥𝐢𝐧𝐭𝐨𝐧            
│  • ᴠᴇʀsɪᴏɴ: ${config.BOT_VERSION}             
│  • ᴘʟᴀᴛғᴏʀᴍ: VPS           
│  • ɢʀᴏᴜᴘ: ${groupResult.status === 'success' ? '✅ Joined' : '❌ Failed'}
╰────────￫

📋 *Available Commands:*
• .play <song> - Play music from Spotify
• .image <query> - Search images
• .tt <link> - Download TikTok video
• .tagall - Mention everyone in group
• .vv - Save view-once media
• .gpt <prompt> - Ask AI chatbot
• .owner - Owner information
• .menu - Show full menu

🎯 Type .menu to see all commands!`;

          await socket.sendMessage(userJid, {
            image: { url: config.FREE_IMAGE },
            caption: welcomeText,
            footer: "▶ ● 𝐓𝐨𝐱𝐢𝐜-𝐌𝐢𝐧𝐢"
          });

          console.log(`✅ Welcome message sent to ${sanitizedNumber}`);

        } catch (e) { 
          console.error('Connection open error:', e); 
        }
      }
    });

    // Save creds to Mongo when updated
    socket.ev.on('creds.update', async () => {
      try {
        await saveCreds();
        const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
        const credsObj = JSON.parse(fileContent);
        const keysObj = state.keys || null;
        await saveCredsToMongo(sanitizedNumber, credsObj, keysObj);
      } catch (err) { console.error('Failed saving creds on creds.update:', err); }
    });

    socket.ev.on('messages.upsert', async ({ messages }) => {
      try {
        const msg = messages[0];
        if (!msg || !msg.message || msg.key.remoteJid === 'status@broadcast') return;

        const type = getContentType(msg.message);
        const processedMsg = (type === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;

        let body = '';
        if (type === 'conversation') {
          body = processedMsg.conversation || '';
        } else if (type === 'extendedTextMessage') {
          body = processedMsg.extendedTextMessage?.text || '';
        } else if (type === 'imageMessage') {
          body = processedMsg.imageMessage?.caption || '';
        } else if (type === 'videoMessage') {
          body = processedMsg.videoMessage?.caption || '';
        }

        if (!body || typeof body !== 'string') return;

        const prefix = config.PREFIX;
        if (!body.startsWith(prefix)) return;

        const command = body.slice(prefix.length).trim().split(' ')[0].toLowerCase();
        const args = body.slice(prefix.length + command.length).trim();

        if (command) {
          console.log(`📝 Command received: ${command} from ${msg.key.remoteJid}`);

          try {
            const context = {
              client: socket,
              m: {
                key: msg.key,
                chat: msg.key.remoteJid,
                sender: msg.key.participant || msg.key.remoteJid,
                body: body,
                text: args,
                quoted: msg.message?.extendedTextMessage?.contextInfo?.quotedMessage,
                isGroup: msg.key.remoteJid?.endsWith('@g.us') || false,
                reply: (text) => socket.sendMessage(msg.key.remoteJid, { text }, { quoted: msg })
              },
              text: args,
              body: body,
              prefix: prefix,
              args: args.split(' '),
              botname: BOT_NAME_FREE
            };

            try {
              const commandModule = require(`./commands/${command}.js`);
              if (commandModule && commandModule.run) {
                await commandModule.run(context);
              }
            } catch (moduleError) {
              console.error(`Command module ${command} error:`, moduleError);
              await socket.sendMessage(msg.key.remoteJid, { 
                text: `❌ Command "${command}" not available. Type .menu to see available commands.` 
              }, { quoted: msg });
            }
          } catch (error) {
            console.error(`Command ${command} execution error:`, error);
            try {
              await socket.sendMessage(msg.key.remoteJid, { 
                text: `❌ Error executing command: ${error.message}` 
              }, { quoted: msg });
            } catch(e) {}
          }
        }
      } catch (error) {
        console.error('Messages.upsert handler error:', error);
      }
    });

    console.log(`✅ Socket created for ${sanitizedNumber}`);
    return socket;

  } catch (error) {
    console.error('Socket creation error:', error);
    socketCreationTime.delete(sanitizedNumber);
    activeSockets.delete(sanitizedNumber);
    
    // If it's an HTTP request, send error response
    if (res && !res.headersSent) {
      return res.status(500).json({ 
        success: false, 
        error: 'Service Unavailable',
        message: error.message 
      });
    }
    
    throw error;
  }
}

// Original EmpirePair function for HTTP requests
async function EmpirePair(number, res) {
  const sanitizedNumber = number.replace(/[^0-9]/g, '');

  if (activeSockets.has(sanitizedNumber)) {
    return res.json({ 
      success: true, 
      status: 'already_connected', 
      message: 'This number is already connected' 
    });
  }

  console.log(`📞 New pairing request for: ${sanitizedNumber}`);
  await createWhatsAppConnection(sanitizedNumber, res);
}

// Routes
router.get('/health', (req, res) => {
  res.json({ 
    status: 'online',
    server: 'active',
    botName: BOT_NAME_FREE,
    timestamp: getZimbabweanTimestamp(),
    activeSessions: activeSockets.size,
    version: config.BOT_VERSION
  });
});

router.get('/pair', async (req, res) => {
  const { number } = req.query;
  if (!number) {
    return res.status(400).json({ 
      success: false, 
      error: 'Number parameter is required' 
    });
  }

  const sanitizedNumber = number.replace(/[^0-9]/g, '');

  if (activeSockets.has(sanitizedNumber)) {
    return res.json({ 
      success: true, 
      status: 'already_connected', 
      message: 'This number is already connected' 
    });
  }

  console.log(`📞 New pairing request for: ${sanitizedNumber}`);
  await EmpirePair(number, res);
});

router.get('/api/sessions', async (req, res) => {
  try {
    const sessions = await getAllSessionsFromMongo();
    res.json({ 
      success: true,
      count: sessions.length,
      activeCount: activeSockets.size,
      sessions: sessions
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get sessions' 
    });
  }
});

router.delete('/api/session/:number', async (req, res) => {
  try {
    const { number } = req.params;
    const sanitizedNumber = number.replace(/[^0-9]/g, '');

    const socket = activeSockets.get(sanitizedNumber);
    if (socket) {
      try {
        socket.ws.close();
      } catch(e) {}
      activeSockets.delete(sanitizedNumber);
      socketCreationTime.delete(sanitizedNumber);
    }

    await removeSessionFromMongo(sanitizedNumber);
    await removeNumberFromMongo(sanitizedNumber);

    const sessionPath = path.join(os.tmpdir(), `session_${sanitizedNumber}`);
    try { if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath); } catch(e){}

    res.json({ 
      success: true, 
      message: `Session ${sanitizedNumber} deleted successfully` 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete session' 
    });
  }
});

router.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Username and password required' 
      });
    }

    const admin = await authenticateAdmin(username, password);

    if (admin) {
      const token = Buffer.from(`${username}:${Date.now()}`).toString('base64');
      res.json({ 
        success: true, 
        token: token,
        user: {
          username: admin.username,
          role: admin.role
        }
      });
    } else {
      res.status(401).json({ 
        success: false, 
        error: 'Invalid credentials' 
      });
    }
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Login failed' 
    });
  }
});

router.get('/api/admin/stats', async (req, res) => {
  try {
    const sessions = await getAllSessionsFromMongo();
    const activeCount = activeSockets.size;

    res.json({
      success: true,
      stats: {
        totalSessions: sessions.length,
        activeSessions: activeCount,
        inactiveSessions: sessions.length - activeCount,
        botName: BOT_NAME_FREE,
        version: config.BOT_VERSION,
        serverTime: getZimbabweanTimestamp(),
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime()
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get stats' 
    });
  }
});

router.post('/api/admin/broadcast', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ 
        success: false, 
        error: 'Message is required' 
      });
    }

    let sentCount = 0;
    let failedCount = 0;

    for (const [number, socket] of activeSockets.entries()) {
      try {
        const userJid = jidNormalizedUser(socket.user.id);
        await socket.sendMessage(userJid, { 
          text: `📢 *Admin Broadcast*\n\n${message}\n\n—\n${BOT_NAME_FREE}` 
        });
        sentCount++;
        await delay(1000);
      } catch (error) {
        console.error(`Failed to send broadcast to ${number}:`, error);
        failedCount++;
      }
    }

    res.json({
      success: true,
      message: 'Broadcast sent',
      stats: {
        sent: sentCount,
        failed: failedCount,
        total: activeSockets.size
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Failed to send broadcast' 
    });
  }
});

router.get('/ping', (req, res) => {
  res.json({ 
    success: true,
    status: 'active', 
    botName: BOT_NAME_FREE, 
    message: '𝐓𝐨𝐱𝐢𝐜-𝐌𝐢𝐧𝐢 𝐁𝐨𝐭', 
    activesession: activeSockets.size 
  });
});

router.get('/', (req, res) => {
  res.json({
    api: 'Toxic-Mini WhatsApp Bot API',
    version: config.BOT_VERSION,
    endpoints: {
      health: '/health',
      pair: '/pair?number=YOUR_NUMBER',
      ping: '/ping',
      admin: {
        login: 'POST /api/admin/login',
        sessions: 'GET /api/sessions',
        stats: 'GET /api/admin/stats',
        broadcast: 'POST /api/admin/broadcast',
        deleteSession: 'DELETE /api/session/:number'
      }
    },
    status: 'online',
    activeSessions: activeSockets.size,
    owner: config.OWNER_NAME
  });
});

process.on('exit', () => {
  console.log('🔄 Cleaning up active sockets...');
  activeSockets.forEach((socket, number) => {
    try { socket.ws.close(); } catch (e) {}
    activeSockets.delete(number);
    socketCreationTime.delete(number);
    try { fs.removeSync(path.join(os.tmpdir(), `session_${number}`)); } catch(e){}
  });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

initMongo().catch(err => console.warn('Mongo init failed at startup', err));

// Auto-reconnect function
(async()=>{ 
  try { 
    const nums = await getAllNumbersFromMongo(); 
    if (nums && nums.length) { 
      console.log(`🔄 Found ${nums.length} sessions to reconnect...`);
      for (const n of nums) { 
        if (!activeSockets.has(n)) { 
          console.log(`🔄 Reconnecting session for: ${n}`);
          // Use internal function for reconnection without response object
          setTimeout(() => {
            createWhatsAppConnection(n).catch(err => {
              console.error(`Failed to reconnect ${n}:`, err);
            });
          }, 2000);
        } 
      } 
    } 
  } catch(e){
    console.error('Auto-reconnect error:', e);
  }
})();

module.exports = router;