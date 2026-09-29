// router.js
// Full router with Mongo-backed sessions, newsletter react-config, commands, dashboard
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const FileType = require('file-type');
const { sms } = require("./msg"); // keep your helper file
const { MongoClient } = require('mongodb');

// Baileys imports (many helpers)
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  getContentType,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
  downloadContentFromMessage,
  prepareWAMessageMedia,
  generateWAMessageFromContent,
  proto,
  DisconnectReason
} = require('baileys');

// Optional GitHub (left but not required)
const { Octokit } = require('@octokit/rest');
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN || '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' });
const owner = process.env.GITHUB_OWNER || 'qwwerrtyupplkjgaavbncx';
const repo = process.env.GITHUB_REPO || 'Huththajana';

// ---------------- CONFIG ----------------
const SAVIX-mini = 'SOS FREE BOT';

const config = {
  AUTO_VIEW_STATUS: 'true',
  AUTO_LIKE_STATUS: 'true',
  AUTO_RECORDING: 'true',
  AUTO_LIKE_EMOJI: ['🔥','😀','👍','😃','😄','😁','😎','🥳','😸','😹','🌞','🌈','❤️'],
  PREFIX: '.',
  MAX_RETRIES: 3,
  GROUP_INVITE_LINK: 'https://whatsapp.com/channel/0029VbDSR3I6WaKiTDTh842Q',
  RCD_IMAGE_PATH: 'https://files.catbox.moe/o5y6zx.jpg',
  NEWSLETTER_JID: '120363402880755202@newsletter',
  OTP_EXPIRY: 300000,
  OWNER_NUMBER: '94769133537',
  CHANNEL_LINK: 'https://whatsapp.com/channel/0029VbDSR3I6WaKiTDTh842Q',
  BOT_NAME: 'SAVI✘ MINI',
  BOT_VERSION: '1.0.0V',
  OWNER_NAME: 'SAVINU  ID',
  IMAGE_PATH: 'https://files.catbox.moe/o5y6zx.jpg',
  BOT_FOOTER: 'SAVI✘ MINI',
  STATUS_AUTO_REPLY: 'true',
  STATUS_REPLY_MESSAGE: 'ඔයාගේ ස්ටේටස් එක ලස්සනයි 😍',
  STATUS_REPLY_EMOJI: '❤️'
};

// ---------------- MONGO SETUP ----------------
// Use env var if set, otherwise use provided string
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://nilapuldiluinda_db_user:Rad02JiIM4PtOxR2@cluster0.xdfsht7.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const MONGO_DB = process.env.MONGO_DB || 'sos_free_bot';

let mongoClient, mongoDB;
let sessionsCol, numbersCol, adminsCol, newsletterCol, configsCol, newsletterReactsCol;

async function initMongo() {
  try {
    // Check if already connected
    if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected && mongoClient.topology.isConnected()) {
      console.log('✅ Already connected to MongoDB');
      return;
    }
    
    console.log('🔄 Connecting to MongoDB...');
    
    // Connection options
    const options = {
      connectTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 30000,
      retryWrites: true,
      retryReads: true
    };
    
    mongoClient = new MongoClient(MONGO_URI, options);
    await mongoClient.connect();
    
    // Test connection
    await mongoClient.db('admin').command({ ping: 1 });
    console.log('✅ MongoDB connected successfully');
    
    mongoDB = mongoClient.db(MONGO_DB);

    // Initialize collections
    sessionsCol = mongoDB.collection('sessions');
    numbersCol = mongoDB.collection('numbers');
    adminsCol = mongoDB.collection('admins');
    newsletterCol = mongoDB.collection('newsletter_list');
    configsCol = mongoDB.collection('configs');
    newsletterReactsCol = mongoDB.collection('newsletter_reacts');

    // Create indexes
    await sessionsCol.createIndex({ number: 1 }, { unique: true });
    await numbersCol.createIndex({ number: 1 }, { unique: true });
    await newsletterCol.createIndex({ jid: 1 }, { unique: true });
    await newsletterReactsCol.createIndex({ jid: 1 }, { unique: true });
    
    console.log('✅ Mongo indexes created');
    console.log('📊 Connected to database:', MONGO_DB);
    
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    console.log('⚠️ Continuing without MongoDB - sessions will be saved locally only');
    
    // Create in-memory fallback collections
    const memoryStore = new Map();
    
    sessionsCol = {
        updateOne: async ({ number }, { $set }) => {
            memoryStore.set(number, $set);
            return { upsertedCount: 1 };
        },
        findOne: async ({ number }) => memoryStore.get(number) || null,
        deleteOne: async ({ number }) => memoryStore.delete(number),
        countDocuments: async () => memoryStore.size,
        find: () => ({
            toArray: async () => Array.from(memoryStore.values())
        })
    };
    
    numbersCol = { ...sessionsCol };
    adminsCol = { 
        ...sessionsCol,
        find: () => ({
            toArray: async () => []
        })
    };
    newsletterCol = { ...sessionsCol };
    configsCol = { ...sessionsCol };
    newsletterReactsCol = { ...sessionsCol };
  }
}

// ---------------- Mongo helpers ----------------
async function saveCredsToMongo(number, creds, keys = null) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = { 
      number: sanitized, 
      creds: creds, 
      keys: keys || null, 
      updatedAt: new Date() 
    };
    
    if (sessionsCol) {
      await sessionsCol.updateOne(
        { number: sanitized }, 
        { $set: doc }, 
        { upsert: true }
      );
      console.log(`✅ Saved creds to Mongo for ${sanitized}`);
    }
  } catch (e) { 
    console.error('❌ saveCredsToMongo error:', e.message); 
  }
}

async function loadCredsFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    if (sessionsCol) {
      const doc = await sessionsCol.findOne({ number: sanitized });
      return doc || null;
    }
    return null;
  } catch (e) { 
    console.error('❌ loadCredsFromMongo error:', e.message); 
    return null; 
  }
}

async function removeSessionFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    if (sessionsCol) {
      await sessionsCol.deleteOne({ number: sanitized });
      console.log(`✅ Removed session from Mongo for ${sanitized}`);
    }
  } catch (e) { 
    console.error('❌ removeSessionFromMongo error:', e.message); 
  }
}

async function addNumberToMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    if (numbersCol) {
      await numbersCol.updateOne(
        { number: sanitized }, 
        { $set: { number: sanitized, addedAt: new Date() } }, 
        { upsert: true }
      );
      console.log(`✅ Added number ${sanitized} to Mongo numbers`);
    }
  } catch (e) { 
    console.error('❌ addNumberToMongo', e.message); 
  }
}

async function removeNumberFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    if (numbersCol) {
      await numbersCol.deleteOne({ number: sanitized });
      console.log(`✅ Removed number ${sanitized} from Mongo numbers`);
    }
  } catch (e) { 
    console.error('❌ removeNumberFromMongo', e.message); 
  }
}

async function getAllNumbersFromMongo() {
  try {
    await initMongo();
    if (numbersCol) {
      const docs = await numbersCol.find({}).toArray();
      return docs.map(d => d.number);
    }
    return [];
  } catch (e) { 
    console.error('❌ getAllNumbersFromMongo', e.message); 
    return []; 
  }
}

async function loadAdminsFromMongo() {
  try {
    await initMongo();
    if (adminsCol) {
      const docs = await adminsCol.find({}).toArray();
      return docs.map(d => d.jid || d.number).filter(Boolean);
    }
    return [];
  } catch (e) { 
    console.error('❌ loadAdminsFromMongo', e.message); 
    return []; 
  }
}

async function addAdminToMongo(jidOrNumber) {
  try {
    await initMongo();
    if (adminsCol) {
      const doc = { jid: jidOrNumber, addedAt: new Date() };
      await adminsCol.updateOne(
        { jid: jidOrNumber }, 
        { $set: doc }, 
        { upsert: true }
      );
      console.log(`✅ Added admin ${jidOrNumber}`);
    }
  } catch (e) { 
    console.error('❌ addAdminToMongo', e.message); 
  }
}

async function removeAdminFromMongo(jidOrNumber) {
  try {
    await initMongo();
    if (adminsCol) {
      await adminsCol.deleteOne({ jid: jidOrNumber });
      console.log(`✅ Removed admin ${jidOrNumber}`);
    }
  } catch (e) { 
    console.error('❌ removeAdminFromMongo', e.message); 
  }
}

async function addNewsletterToMongo(jid) {
  try {
    await initMongo();
    if (newsletterCol) {
      await newsletterCol.updateOne(
        { jid }, 
        { $set: { jid, addedAt: new Date() } }, 
        { upsert: true }
      );
      console.log(`✅ Added newsletter ${jid}`);
    }
  } catch (e) { 
    console.error('❌ addNewsletterToMongo', e.message); 
  }
}

async function removeNewsletterFromMongo(jid) {
  try {
    await initMongo();
    if (newsletterCol) {
      await newsletterCol.deleteOne({ jid });
      console.log(`✅ Removed newsletter ${jid}`);
    }
  } catch (e) { 
    console.error('❌ removeNewsletterFromMongo', e.message); 
  }
}

async function listNewslettersFromMongo() {
  try {
    await initMongo();
    if (newsletterCol) {
      const docs = await newsletterCol.find({}).toArray();
      return docs.map(d => d.jid);
    }
    return [];
  } catch (e) { 
    console.error('❌ listNewslettersFromMongo', e.message); 
    return []; 
  }
}

async function setUserConfigInMongo(number, conf) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    if (configsCol) {
      await configsCol.updateOne(
        { number: sanitized }, 
        { $set: { number: sanitized, config: conf, updatedAt: new Date() } }, 
        { upsert: true }
      );
    }
  } catch (e) { 
    console.error('❌ setUserConfigInMongo', e.message); 
  }
}

async function loadUserConfigFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    if (configsCol) {
      const doc = await configsCol.findOne({ number: sanitized });
      return doc ? doc.config : null;
    }
    return null;
  } catch (e) { 
    console.error('❌ loadUserConfigFromMongo', e.message); 
    return null; 
  }
}

// -------------- newsletter react-config helpers --------------
async function addNewsletterReactConfig(jid, emojis = []) {
  try {
    await initMongo();
    if (newsletterReactsCol) {
      await newsletterReactsCol.updateOne(
        { jid }, 
        { $set: { jid, emojis, addedAt: new Date() } }, 
        { upsert: true }
      );
      console.log(`✅ Added react-config for ${jid} -> ${emojis.join(',')}`);
    }
  } catch (e) { 
    console.error('❌ addNewsletterReactConfig', e.message); 
    throw e; 
  }
}

async function removeNewsletterReactConfig(jid) {
  try {
    await initMongo();
    if (newsletterReactsCol) {
      await newsletterReactsCol.deleteOne({ jid });
      console.log(`✅ Removed react-config for ${jid}`);
    }
  } catch (e) { 
    console.error('❌ removeNewsletterReactConfig', e.message); 
    throw e; 
  }
}

async function listNewsletterReactsFromMongo() {
  try {
    await initMongo();
    if (newsletterReactsCol) {
      const docs = await newsletterReactsCol.find({}).toArray();
      return docs.map(d => ({ jid: d.jid, emojis: Array.isArray(d.emojis) ? d.emojis : [] }));
    }
    return [];
  } catch (e) { 
    console.error('❌ listNewsletterReactsFromMongo', e.message); 
    return []; 
  }
}

async function getReactConfigForJid(jid) {
  try {
    await initMongo();
    if (newsletterReactsCol) {
      const doc = await newsletterReactsCol.findOne({ jid });
      return doc ? (Array.isArray(doc.emojis) ? doc.emojis : []) : null;
    }
    return null;
  } catch (e) { 
    console.error('❌ getReactConfigForJid', e.message); 
    return null; 
  }
}

// ---------------- basic utils ----------------
function formatMessage(title, content, footer) {
  return `*${title}*\n\n${content}\n\n> *${footer}*`;
}
function generateOTP(){ return Math.floor(100000 + Math.random() * 900000).toString(); }
function getSriLankaTimestamp(){ return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss'); }

const activeSockets = new Map();
const socketCreationTime = new Map();
const otpStore = new Map();

// ---------------- helpers kept/adapted ----------------
async function joinGroup(socket) {
  let retries = config.MAX_RETRIES;
  const inviteCodeMatch = config.GROUP_INVITE_LINK.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
  if (!inviteCodeMatch) return { status: 'failed', error: 'Invalid group invite link' };
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

async function sendAdminConnectMessage(socket, number, groupResult) {
  const admins = await loadAdminsFromMongo();
  const groupStatus = groupResult.status === 'success' ? `Joined (ID: ${groupResult.gid})` : `Failed to join group: ${groupResult.error}`;
  const caption = formatMessage(BOT_NAME_FANCY, `📞 Number: ${number}\n🩵 Status: ${groupStatus}\n🕒 Connected at: ${getSriLankaTimestamp()}`, BOT_NAME_FANCY);
  for (const admin of admins) {
    try {
      const to = admin.includes('@') ? admin : `${admin}@s.whatsapp.net`;
      await socket.sendMessage(to, { image: { url: config.RCD_IMAGE_PATH }, caption });
    } catch (err) {
      console.error('Failed to send connect message to admin', admin, err?.message || err);
    }
  }
}

async function sendOwnerConnectMessage(socket, number, groupResult) {
  try {
    const ownerJid = `${config.OWNER_NUMBER.replace(/[^0-9]/g,'')}@s.whatsapp.net`;
    const activeCount = activeSockets.size;
    const groupStatus = groupResult.status === 'success' ? `Joined (ID: ${groupResult.gid})` : `Failed to join group: ${groupResult.error}`;
    const caption = formatMessage(`👑 OWNER CONNECT — ${BOT_NAME_FANCY}`, `📞 Number: ${number}\n🩵 Status: ${groupStatus}\n🕒 Connected at: ${getSriLankaTimestamp()}\n\n🔢 Active sessions: ${activeCount}`, BOT_NAME_FANCY);
    await socket.sendMessage(ownerJid, { image: { url: config.RCD_IMAGE_PATH }, caption });
  } catch (err) { console.error('Failed to send owner connect message:', err); }
}

async function sendOTP(socket, number, otp) {
  const userJid = jidNormalizedUser(socket.user.id);
  const message = formatMessage(`🔐 OTP VERIFICATION — ${BOT_NAME_FANCY}`, `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.\n\nNumber: ${number}`, BOT_NAME_FANCY);
  try { await socket.sendMessage(userJid, { text: message }); console.log(`✅ OTP ${otp} sent to ${number}`); }
  catch (error) { console.error(`❌ Failed to send OTP to ${number}:`, error); throw error; }
}

// ---------------- status auto reply handler ----------------
async function setupStatusAutoReply(socket, sessionNumber) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant) return;
        
        try {
            // Check if auto reply is enabled
            const userConfig = await loadUserConfigFromMongo(sessionNumber) || {};
            const statusAutoReply = userConfig.STATUS_AUTO_REPLY || config.STATUS_AUTO_REPLY;
            const replyMessage = userConfig.STATUS_REPLY_MESSAGE || config.STATUS_REPLY_MESSAGE;
            const replyEmoji = userConfig.STATUS_REPLY_EMOJI || config.STATUS_REPLY_EMOJI;
            
            if (statusAutoReply === 'true') {
                // Send reaction first
                await socket.sendMessage(message.key.remoteJid, { 
                    react: { text: replyEmoji, key: message.key } 
                }, { statusJidList: [message.key.participant] });
                
                // Send reply message
                await delay(1000);
                await socket.sendMessage(message.key.remoteJid, { 
                    text: replyMessage 
                }, { statusJidList: [message.key.participant] });
                
                console.log(`✅ Auto replied to status from ${message.key.participant}`);
            }
        } catch (error) { 
            console.error('❌ Status auto reply error:', error); 
        }
    });
}

// ---------------- handlers (newsletter + reactions) ----------------
async function setupNewsletterHandlers(socket, sessionNumber) {
  // round-robin pointers per jid
  const rrPointers = new Map();

  socket.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages[0];
    if (!message?.key) return;
    const jid = message.key.remoteJid;

    try {
      // quick checks
      const followed = await listNewslettersFromMongo(); // array of jids
      const reactConfigs = await listNewsletterReactsFromMongo(); // [{jid, emojis}]
      const reactMap = new Map();
      for (const r of reactConfigs) reactMap.set(r.jid, r.emojis || []);

      // ignore if nothing configured
      if (!followed.includes(jid) && !reactMap.has(jid)) return;

      // choose emoji list
      let emojis = reactMap.get(jid) || null;
      if (!emojis || emojis.length === 0) emojis = config.AUTO_LIKE_EMOJI;

      // pick emoji round-robin
      let idx = rrPointers.get(jid) || 0;
      const emoji = emojis[idx % emojis.length];
      rrPointers.set(jid, (idx + 1) % emojis.length);

      const messageId = message.newsletterServerId || message.key.id;
      if (!messageId) return;

      let retries = 3;
      while (retries-- > 0) {
        try {
          if (typeof socket.newsletterReactMessage === 'function') {
            await socket.newsletterReactMessage(jid, messageId.toString(), emoji);
          } else {
            await socket.sendMessage(jid, { react: { text: emoji, key: message.key } });
          }
          console.log(`✅ Reacted to ${jid} ${messageId} with ${emoji}`);
          break;
        } catch (err) {
          console.warn(`⚠️ Reaction attempt failed (${3 - retries}/3):`, err?.message || err);
          await delay(1200);
        }
      }
    } catch (error) {
      console.error('❌ Newsletter reaction handler error:', error?.message || error);
    }
  });
}

// ---------------- status + revocation + resizing ----------------
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
    } catch (error) { console.error('❌ Status handler error:', error); }
  });
}

async function handleMessageRevocation(socket, number) {
  socket.ev.on('messages.delete', async ({ keys }) => {
    if (!keys || keys.length === 0) return;
    const messageKey = keys[0];
    const userJid = jidNormalizedUser(socket.user.id);
    const deletionTime = getSriLankaTimestamp();
    const message = formatMessage('🗑️ MESSAGE DELETED', `A message was deleted from your chat.\n📋 From: ${messageKey.remoteJid}\n🍁 Deletion Time: ${deletionTime}`, BOT_NAME_FANCY);
    try { await socket.sendMessage(userJid, { image: { url: config.RCD_IMAGE_PATH }, caption: message }); }
    catch (error) { console.error('Failed to send deletion notification:', error); }
  });
}

async function resize(image, width, height) {
  let oyy = await Jimp.read(image);
  return await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
}

// ---------------- command handlers ----------------

function setupCommandHandlers(socket, number) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg || !msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

    const type = getContentType(msg.message);
    if (!msg.message) return;
    msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;

    const from = msg.key.remoteJid;
    const sender = from;
    const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid);
    const senderNumber = (nowsender || '').split('@')[0];
    const botNumber = socket.user.id ? socket.user.id.split(':')[0] : '';
    const isbot = botNumber.includes(senderNumber);
    const isOwner = isbot ? isbot : `${config.OWNER_NUMBER}`.includes(senderNumber);

    const body = (type === 'conversation') ? msg.message.conversation
      : (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text
      : (type === 'imageMessage' && msg.message.imageMessage.caption) ? msg.message.imageMessage.caption
      : (type === 'videoMessage' && msg.message.videoMessage.caption) ? msg.message.videoMessage.caption
      : (type === 'buttonsResponseMessage') ? msg.message.buttonsResponseMessage?.selectedButtonId
      : (type === 'listResponseMessage') ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId
      : (type === 'viewOnceMessage') ? (msg.message.viewOnceMessage?.message?.imageMessage?.caption || '') : '';

    if (!body || typeof body !== 'string') return;

    const prefix = config.PREFIX;
    const isCmd = body && body.startsWith && body.startsWith(prefix);
    const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : null;
    const args = body.trim().split(/ +/).slice(1);

    // Download helper
    socket.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
      let quoted = message.msg ? message.msg : message;
      let mime = (message.msg || message).mimetype || '';
      let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
      const stream = await downloadContentFromMessage(quoted, messageType);
      let buffer = Buffer.from([]);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
      const type = await FileType.fromBuffer(buffer);
      const trueFileName = attachExtension ? (filename + '.' + (type?.ext || 'bin')) : filename;
      await fs.writeFileSync(trueFileName, buffer);
      return trueFileName;
    };

    if (!command) return;

    // Load user-specific config if available
    const userConfig = await loadUserConfigFromMongo(number) || {};
    // Merge user config with global config (user overrides global)
    const mergedConfig = { ...config, ...userConfig };

    try {
      switch (command) {
        // --- Alive Command ---
        case 'alive': {
          try {
              const startTime = socketCreationTime.get(number) || Date.now();
              const uptime = Math.floor((Date.now() - startTime) / 1000);
              const hours = Math.floor(uptime / 3600);
              const minutes = Math.floor((uptime % 3600) / 60);
              const seconds = Math.floor(uptime % 60);

              // Get current time in Asia/Colombo timezone
              const timeNow = moment().tz('Asia/Colombo').format('HH');
              let greeting = '🌙 Good Night';
              if (timeNow >= 5 && timeNow < 12) greeting = '🌞 Good Morning';
              else if (timeNow >= 12 && timeNow < 18) greeting = '🌤️ Good Afternoon';
              else if (timeNow >= 18 && timeNow < 22) greeting = '🌆 Good Evening';

              // Memory usage
              const totalMem = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2);
              const freeMem = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2);
              const usedMem = (totalMem - freeMem).toFixed(2);

              // Send reaction
              await socket.sendMessage(sender, { react: { text: '⚡', key: msg.key } });

              // Prepare message
              const message = `
╔══════════════════════════╗
║       SAVI✘ MINI     
║══════════════════════════║
║ ${greeting}!
║ 🤖 Bot: SAVIX MINI   
║ 👑 Owner: SAVI   
║ ⏳ Uptime: ${hours}h ${minutes}m ${seconds}s
║ 💾 RAM: ${usedMem} GB / ${totalMem} GB
╚══════════════════════════╝
> Powered by YAKUZZ999 💌
        `.trim();

              // Fallback image URL
              const imageUrl = config?.BUTTON_IMAGES?.ALIVE || config?.IMAGE_PATH || 'https://files.catbox.moe/f3o8qk.jpg';

              // Send message with image
              await socket.sendMessage(sender, {
                  image: { url: imageUrl },
                  caption: message,
                  footer: '❤️‍🔥 SAVIX 💕',
                  headerType: 4
              }, { quoted: msg });
          } catch (error) {
              console.error('Alive command error:', error.message, error.stack);
              await socket.sendMessage(sender, { text: '❌ Error.' }, { quoted: msg });
          }
          break;
        }

        // --- Menu Command ---
        case 'menu': {
          const startTime = socketCreationTime.get(number) || Date.now();
          const uptime = Math.floor((Date.now() - startTime) / 1000);
          const hours = Math.floor(uptime / 3600);
          const minutes = Math.floor((uptime % 3600) / 60);
          const seconds = Math.floor(uptime % 60);

          await socket.sendMessage(sender, { react: { text: "📋", key: msg.key } });

          const menuText = `
*❍━━━❖•°🍂°•❖━━━❍*
║ 🤖 Bot: SAVIX MINI 
║ 👑 Owner: SAVI      
║ 🏷️ Version: 1.0.0        
║ ⏳ Uptime: ${hours}h ${minutes}m ${seconds}s
*❍━━━❖•° 🌸 °•❖━━━❍*

*Click buttons below to explore commands*
> Powered by YAKUZZ999  | Owner: SAVI
    `.trim();

          const buttons = [
              {
                  buttonId: `${config.PREFIX}mediamenu`,
                  buttonText: { displayText: "✅ Media Menu ✅" },
                  type: 1
              },
              {
                  buttonId: `${config.PREFIX}aimenu`,
                  buttonText: { displayText: "🫧 AI Menu 🫧" },
                  type: 1
              },
              {
                  buttonId: `${config.PREFIX}toolsmenu`,
                  buttonText: { displayText: "💕 Tools Menu 💕" },
                  type: 1
              }
          ];

          await socket.sendMessage(sender, {
              image: { url: "https://files.catbox.moe/f3o8qk.jpg" },
              caption: menuText,
              footer: "❤️‍🔥 SAVIX💕",
              buttons: buttons,
              headerType: 4
          }, { quoted: msg });
          break;
        }

        // --- Ping Command ---
        case 'ping': {
          await socket.sendMessage(sender, { react: { text: "📡", key: msg.key } });
          const start = Date.now();
          const pingMsg = await socket.sendMessage(sender, { text: '📡 *Pinging SAVIX...*' });
          const diff = Date.now() - start;
          await socket.sendMessage(sender, {
            text: `✅ *Pong!* ${diff} ms\n> Powered by SOS FREE BOT`
          }, { quoted: pingMsg });
          break;
        }

        // --- System Info ---
        case 'system': {
          const osmod = require("os");
          const startTime = socketCreationTime.get(number) || Date.now();
          const uptime = Math.floor((Date.now() - startTime) / 1000);
          const hours = Math.floor(uptime / 3600);
          const minutes = Math.floor((uptime % 3600) / 60);
          const seconds = Math.floor(uptime % 60);
          const totalMem = (osmod.totalmem() / (1024 * 1024 * 1024)).toFixed(2);
          const freeMem = (osmod.freemem() / (1024 * 1024 * 1024)).toFixed(2);
          const usedMem = (totalMem - freeMem).toFixed(2);
          const lkTime = moment().tz("Asia/Colombo").format("YYYY-MM-DD hh:mm:ss A");
          const activeCount = activeSockets.size;

          try {
            await socket.sendMessage(sender, { react: { text: "🛠️", key: msg.key } });
            const caption = `
╔══════════════════════════╗
║   🛠️ *SAVIX BOT SYSTEM* 🛠️ 
║══════════════════════════║
║ 🤖 *Bot*: SAVIX MINI
║ 🏷️ *Version*: ${config.BOT_VERSION}
║ 🔢 *Active Sessions*: ${activeCount}
║ ⏳ *Uptime*: ${hours}h ${minutes}m ${seconds}s
║ 💾 *RAM*: ${usedMem} GB / ${totalMem} GB
║ ⏰ *Time (LK)*: ${lkTime}
╚══════════════════════════╝
> Powered by SOS FREE BOT | Owner: SHANUWA 
            `.trim();

            await socket.sendMessage(sender, {
              image: { url: config.IMAGE_PATH },
              caption,
              footer: "🔥 SOS FREE BOT 🔥",
              headerType: 4
            }, { quoted: msg });

          } catch (e) {
            console.error("System command error:", e);
            await socket.sendMessage(sender, { text: `❌ *Error fetching system info: ${e.message || "Unknown error"}*` }, { quoted: msg });
          }
          break;
        }

        // --- JID Command ---
        case 'jid': {
          const userNumber = from.split('@')[0];
          await socket.sendMessage(sender, { react: { text: "🆔", key: msg.key } });
          await socket.sendMessage(sender, {
            text: `
╔══════════════════════════╗
║   🆔 *SAVIX* 🆔 
║══════════════════════════║
║ 📌 *Chat JID*: ${from}
║ 📞 *Your Number*: +${userNumber}
╚══════════════════════════╝
> Powered by YAKUZZ999  | Owner: SAVI
            `.trim()
          }, { quoted: msg });
          break;
        }

        // --- Save Status Command ---
        case 'save': {
          try {
              const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
              
              if (!quotedMsg) {
                  return await socket.sendMessage(sender, {
                      text: '*❌ Please reply to a status message to save*'
                  }, { quoted: msg });
              }

              await socket.sendMessage(sender, { react: { text: '💾', key: msg.key } });

              const userJid = jidNormalizedUser(socket.user.id);

              // Helper to download media
              const downloadMedia = async (mediaMsg, mediaType) => {
                try {
                  const stream = await downloadContentFromMessage(mediaMsg, mediaType);
                  let buffer = Buffer.from([]);
                  for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                  }
                  return buffer;
                } catch (error) {
                  console.error('Download error:', error);
                  return null;
                }
              };

              if (quotedMsg.imageMessage) {
                  const buffer = await downloadMedia(quotedMsg.imageMessage, 'image');
                  if (buffer) {
                    await socket.sendMessage(userJid, {
                        image: buffer,
                        caption: quotedMsg.imageMessage.caption || '✅ *Status Saved*'
                    });
                  }
              } else if (quotedMsg.videoMessage) {
                  const buffer = await downloadMedia(quotedMsg.videoMessage, 'video');
                  if (buffer) {
                    await socket.sendMessage(userJid, {
                        video: buffer,
                        caption: quotedMsg.videoMessage.caption || '✅ *Status Saved*'
                    });
                  }
              } else if (quotedMsg.conversation || quotedMsg.extendedTextMessage) {
                  const text = quotedMsg.conversation || quotedMsg.extendedTextMessage.text;
                  await socket.sendMessage(userJid, {
                      text: `✅ *Status Saved*\n\n${text}`
                  });
              } else {
                  await socket.sendMessage(userJid, quotedMsg);
              }

              await socket.sendMessage(sender, {
                  text: '🔥 *SOS FREE BOT STATUS SAVED SUCCESSFULLY 🔥*'
              }, { quoted: msg });

          } catch (error) {
              console.error('❌ Save error:', error);
              await socket.sendMessage(sender, {
                  text: '*❌ Failed to save status*'
              }, { quoted: msg });
          }
          break;
        }

        // --- Delete Own Session ---
        case 'deleteme': {
          const sanitized = (number || '').replace(/[^0-9]/g, '');
          const senderNum = senderNumber;
          const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');

          if (senderNum !== sanitized && senderNum !== ownerNum) {
            await socket.sendMessage(sender, { text: "❌ *Permission denied!*\nOnly the session owner or bot owner can delete this session." }, { quoted: msg });
            return;
          }

          try {
            await removeSessionFromMongo(sanitized);
            await removeNumberFromMongo(sanitized);
            const sessionPath = path.join(os.tmpdir(), `session_${sanitized}`);
            if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath);
            if (typeof socket.logout === 'function') await socket.logout().catch(() => {});
            socket.ws?.close();
            activeSockets.delete(sanitized);
            socketCreationTime.delete(sanitized);

            await socket.sendMessage(sender, {
              image: { url: config.RCD_IMAGE_PATH },
              caption: `
╔══════════════════════════╗
║   🗑️ *SESSION DELETED* 🗑️ 
║══════════════════════════║
║ ✅ *Your session has been removed!*
╚══════════════════════════╝
> Powered by SOS FREE BOT | Owner: SHANUWA 
              `.trim(),
              footer: "🔥 SOS FREE BOT 🔥",
              headerType: 4
            }, { quoted: msg });

            console.log(`✅ Session ${sanitized} deleted by ${senderNum}`);
          } catch (err) {
            console.error("❌ Deleteme command error:", err);
            await socket.sendMessage(sender, { text: `❌ *Failed to delete session: ${err.message || "Unknown error"}*` }, { quoted: msg });
          }
          break;
        }

        // --- Default Case ---
        default:
          await socket.sendMessage(sender, {
            text: "❌ *Unknown command!*\nType .menu to see all available commands."
          }, { quoted: msg });
          break;
      }
    } catch (err) {
      console.error("❌ Command handler error:", err);
      await socket.sendMessage(sender, {
        image: { url: config.RCD_IMAGE_PATH },
        caption: `
╔══════════════════════════╗
║   ❌ *ERROR OCCURRED* ❌   
║══════════════════════════║
║ 😔 *Something went wrong!*
║ Please try again later.
╚══════════════════════════╝
> Powered by SOS FREE BOT | Owner: SHANUWA 
        `.trim(),
        footer: "🔥 SOS FREE BOT 🔥",
        headerType: 4
      }, { quoted: msg });
    }
  });
}

// ---------------- message handlers ----------------
function setupMessageHandlers(socket) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;
    if (config.AUTO_RECORDING === 'true') {
      try { await socket.sendPresenceUpdate('recording', msg.key.remoteJid); } catch (e) {}
    }
  });
}

// ---------------- cleanup helper ----------------
async function deleteSessionAndCleanup(number, socketInstance) {
  const sanitized = number.replace(/[^0-9]/g, '');
  try {
    const sessionPath = path.join(os.tmpdir(), `session_${sanitized}`);
    try { if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath); } catch(e){}
    activeSockets.delete(sanitized); socketCreationTime.delete(sanitized);
    try { await removeSessionFromMongo(sanitized); } catch(e){}
    try { await removeNumberFromMongo(sanitized); } catch(e){}
    try {
      const ownerJid = `${config.OWNER_NUMBER.replace(/[^0-9]/g,'')}@s.whatsapp.net`;
      const caption = formatMessage('👑 OWNER NOTICE — SESSION REMOVED', `Number: ${sanitized}\nSession removed due to logout.\n\nActive sessions now: ${activeSockets.size}`, BOT_NAME_FANCY);
      if (socketInstance && socketInstance.sendMessage) await socketInstance.sendMessage(ownerJid, { image: { url: config.RCD_IMAGE_PATH }, caption });
    } catch(e){}
    console.log(`✅ Cleanup completed for ${sanitized}`);
  } catch (err) { console.error('❌ deleteSessionAndCleanup error:', err); }
}

// ---------------- auto-restart ----------------
function setupAutoRestart(socket, number) {
  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
                         || lastDisconnect?.error?.statusCode
                         || (lastDisconnect?.error && lastDisconnect.error.toString().includes('401') ? 401 : undefined);
      const isLoggedOut = statusCode === 401
                          || (lastDisconnect?.error && lastDisconnect.error?.code === 'AUTHENTICATION')
                          || (lastDisconnect?.error && String(lastDisconnect.error).toLowerCase().includes('logged out'))
                          || (lastDisconnect?.reason === DisconnectReason?.loggedOut);
      if (isLoggedOut) {
        console.log(`⚠️ User ${number} logged out. Cleaning up...`);
        try { await deleteSessionAndCleanup(number, socket); } catch(e){ console.error(e); }
      } else {
        console.log(`⚠️ Connection closed for ${number} (not logout). Attempt reconnect...`);
        try { await delay(10000); activeSockets.delete(number.replace(/[^0-9]/g,'')); socketCreationTime.delete(number.replace(/[^0-9]/g,'')); const mockRes = { headersSent:false, send:() => {}, status: () => mockRes }; await EmpirePair(number, mockRes); } catch(e){ console.error('❌ Reconnect attempt failed', e); }
      }
    }
  });
}

// ---------------- EmpirePair (pairing, temp dir, persist to Mongo) ----------------
async function EmpirePair(number, res) {
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const sessionPath = path.join(os.tmpdir(), `session_${sanitizedNumber}`);
  
  console.log(`🚀 Starting pairing process for ${sanitizedNumber}`);
  
  await initMongo().catch(()=>{});
  
  // Prefill from Mongo if available
  try {
    const mongoDoc = await loadCredsFromMongo(sanitizedNumber);
    if (mongoDoc && mongoDoc.creds) {
      fs.ensureDirSync(sessionPath);
      fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(mongoDoc.creds, null, 2));
      if (mongoDoc.keys) fs.writeFileSync(path.join(sessionPath, 'keys.json'), JSON.stringify(mongoDoc.keys, null, 2));
      console.log('✅ Prefilled creds from Mongo');
    }
  } catch (e) { console.warn('⚠️ Prefill from Mongo failed', e); }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

  try {
    const socket = makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      printQRInTerminal: false,
      logger,
      browser: Browsers.macOS('Safari')
    });

    socketCreationTime.set(sanitizedNumber, Date.now());

    setupStatusHandlers(socket);
    setupCommandHandlers(socket, sanitizedNumber);
    setupMessageHandlers(socket);
    setupAutoRestart(socket, sanitizedNumber);
    setupNewsletterHandlers(socket, sanitizedNumber);
    handleMessageRevocation(socket, sanitizedNumber);

    // Handle pairing code generation
    if (!socket.authState.creds.registered) {
      let retries = config.MAX_RETRIES;
      let code;
      let pairingSuccess = false;
      
      while (retries > 0 && !pairingSuccess) {
        try {
          await delay(2000); // Wait a bit before requesting code
          console.log(`📱 Requesting pairing code for ${sanitizedNumber} (attempt ${config.MAX_RETRIES - retries + 1}/${config.MAX_RETRIES})`);
          
          code = await socket.requestPairingCode(sanitizedNumber);
          
          if (code) {
            console.log(`✅ Pairing code generated: ${code} for ${sanitizedNumber}`);
            pairingSuccess = true;
            
            // Send response with code
            if (!res.headersSent) {
              res.send({ code });
            }
            
            // Log to console clearly
            console.log('\n');
            console.log('🔐 ========================================');
            console.log(`🔐 PAIRING CODE FOR ${sanitizedNumber}: ${code}`);
            console.log('🔐 ========================================');
            console.log('\n');
          }
        } catch (error) {
          console.error(`❌ Pairing attempt failed:`, error.message);
          retries--;
          
          if (retries > 0) {
            console.log(`⏳ Retrying in 3 seconds... (${retries} attempts left)`);
            await delay(3000);
          }
        }
      }
      
      if (!pairingSuccess) {
        console.error(`❌ Failed to generate pairing code for ${sanitizedNumber}`);
        if (!res.headersSent) {
          res.status(500).send({ error: 'Failed to generate pairing code' });
        }
      }
    }

    // Save creds to Mongo when updated
    socket.ev.on('creds.update', async () => {
      try {
        await saveCreds();
        const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
        const credsObj = JSON.parse(fileContent);
        const keysObj = state.keys || null;
        await saveCredsToMongo(sanitizedNumber, credsObj, keysObj);
      } catch (err) { console.error('❌ Failed saving creds on creds.update:', err); }
    });

    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;
      
      if (connection === 'open') {
        try {
          await delay(3000);
          const userJid = jidNormalizedUser(socket.user.id);
          const groupResult = await joinGroup(socket);
          
          console.log(`✅ Socket connected for ${sanitizedNumber}`);
          
          // try follow newsletters if configured
          try {
            const newsletterList = await listNewslettersFromMongo();
            for (const jid of newsletterList) {
              try { 
                if (typeof socket.newsletterFollow === 'function') {
                  await socket.newsletterFollow(jid); 
                }
                await delay(1000);
              } catch(e){}
            }
          } catch(e){}
          
          activeSockets.set(sanitizedNumber, socket);
          
          const groupStatus = groupResult.status === 'success' ? 'Joined successfully' : `Failed to join group: ${groupResult.error}`;
          const welcomeCaption = formatMessage(BOT_NAME_FANCY, `✅ Successfully connected!\n\n🔢 Number: ${sanitizedNumber}\n\n📢 Follow Channel:\n${config.CHANNEL_LINK}\n\nStatus: ${groupStatus}\n\n🔢 Active sessions: ${activeSockets.size}`, BOT_NAME_FANCY);
          
          await socket.sendMessage(userJid, { image: { url: config.RCD_IMAGE_PATH }, caption: welcomeCaption });
          await sendAdminConnectMessage(socket, sanitizedNumber, groupResult);
          await sendOwnerConnectMessage(socket, sanitizedNumber, groupResult);
          await addNumberToMongo(sanitizedNumber);
          
        } catch (e) { 
          console.error('❌ Connection open error:', e); 
        }
      }
      
      if (connection === 'close') {
        console.log(`🔌 Connection closed for ${sanitizedNumber}`);
        try { 
          if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath); 
        } catch(e){}
      }
    });

    activeSockets.set(sanitizedNumber, socket);
    
  } catch (error) {
    console.error('❌ Pairing error:', error);
    socketCreationTime.delete(sanitizedNumber);
    if (!res.headersSent) res.status(503).send({ error: 'Service Unavailable' });
  }
}

// ---------------- endpoints ----------------

// Main pairing endpoint
router.get('/', async (req, res) => {
  const { number } = req.query;
  if (!number) return res.status(400).send({ error: 'Number parameter is required' });
  
  const sanitized = number.replace(/[^0-9]/g, '');
  if (activeSockets.has(sanitized)) {
    return res.status(200).send({ 
      status: 'already_connected', 
      message: 'This number is already connected',
      code: 'Already Connected'
    });
  }
  
  await EmpirePair(sanitized, res);
});

// Active sessions endpoint
router.get('/active', (req, res) => {
  res.status(200).send({ 
    botName: BOT_NAME_FANCY, 
    count: activeSockets.size, 
    numbers: Array.from(activeSockets.keys()), 
    timestamp: getSriLankaTimestamp() 
  });
});

// Ping endpoint
router.get('/ping', (req, res) => {
  res.status(200).send({ 
    status: 'active', 
    botName: BOT_NAME_FANCY, 
    message: 'SOS FREE BOT', 
    activesession: activeSockets.size 
  });
});

// Connect all endpoint
router.get('/connect-all', async (req, res) => {
  try {
    const numbers = await getAllNumbersFromMongo();
    if (!numbers || numbers.length === 0) return res.status(404).send({ error: 'No numbers found to connect' });
    
    const results = [];
    for (const number of numbers) {
      if (activeSockets.has(number)) { 
        results.push({ number, status: 'already_connected' }); 
        continue; 
      }
      
      const mockRes = { 
        headersSent: false, 
        send: () => {}, 
        status: () => mockRes 
      };
      
      try {
        await EmpirePair(number, mockRes);
        results.push({ number, status: 'connection_initiated' });
        await delay(2000);
      } catch (err) {
        results.push({ number, status: 'failed', error: err.message });
      }
    }
    
    res.status(200).send({ status: 'success', connections: results });
  } catch (error) { 
    console.error('❌ Connect all error:', error); 
    res.status(500).send({ error: 'Failed to connect all bots' }); 
  }
});

// Reconnect endpoint
router.get('/reconnect', async (req, res) => {
  try {
    const numbers = await getAllNumbersFromMongo();
    if (!numbers || numbers.length === 0) return res.status(404).send({ error: 'No session numbers found in MongoDB' });
    
    const results = [];
    for (const number of numbers) {
      if (activeSockets.has(number)) { 
        results.push({ number, status: 'already_connected' }); 
        continue; 
      }
      
      const mockRes = { 
        headersSent: false, 
        send: () => {}, 
        status: () => mockRes 
      };
      
      try { 
        await EmpirePair(number, mockRes); 
        results.push({ number, status: 'connection_initiated' }); 
      } catch (err) { 
        results.push({ number, status: 'failed', error: err.message }); 
      }
      
      await delay(1000);
    }
    
    res.status(200).send({ status: 'success', connections: results });
  } catch (error) { 
    console.error('❌ Reconnect error:', error); 
    res.status(500).send({ error: 'Failed to reconnect bots' }); 
  }
});

// API endpoints for dashboard
router.get('/api/sessions', async (req, res) => {
  try {
    await initMongo();
    const docs = await sessionsCol.find({}, { projection: { number: 1, updatedAt: 1 } }).sort({ updatedAt: -1 }).toArray();
    res.json({ ok: true, sessions: docs });
  } catch (err) {
    console.error('❌ API /api/sessions error', err);
    res.status(500).json({ ok: false, error: err.message || err });
  }
});

router.get('/api/active', async (req, res) => {
  try {
    const keys = Array.from(activeSockets.keys());
    res.json({ ok: true, active: keys, count: keys.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || err });
  }
});

router.post('/api/session/delete', async (req, res) => {
  try {
    const { number } = req.body;
    if (!number) return res.status(400).json({ ok: false, error: 'number required' });
    
    const sanitized = ('' + number).replace(/[^0-9]/g, '');
    const running = activeSockets.get(sanitized);
    
    if (running) {
      try { if (typeof running.logout === 'function') await running.logout().catch(()=>{}); } catch(e){}
      try { running.ws?.close(); } catch(e){}
      activeSockets.delete(sanitized);
      socketCreationTime.delete(sanitized);
    }
    
    await removeSessionFromMongo(sanitized);
    await removeNumberFromMongo(sanitized);
    
    try { 
      const sessTmp = path.join(os.tmpdir(), `session_${sanitized}`); 
      if (fs.existsSync(sessTmp)) fs.removeSync(sessTmp); 
    } catch(e){}
    
    res.json({ ok: true, message: `Session ${sanitized} removed` });
  } catch (err) {
    console.error('❌ API /api/session/delete error', err);
    res.status(500).json({ ok: false, error: err.message || err });
  }
});

router.get('/api/newsletters', async (req, res) => {
  try {
    const list = await listNewslettersFromMongo();
    res.json({ ok: true, list });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || err });
  }
});

router.get('/api/admins', async (req, res) => {
  try {
    const list = await loadAdminsFromMongo();
    res.json({ ok: true, list });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || err });
  }
});

// ---------------- cleanup + process events ----------------
process.on('exit', () => {
  activeSockets.forEach((socket, number) => {
    try { socket.ws.close(); } catch (e) {}
    activeSockets.delete(number);
    socketCreationTime.delete(number);
    try { fs.removeSync(path.join(os.tmpdir(), `session_${number}`)); } catch(e){}
  });
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught exception:', err);
});

// Initialize MongoDB and auto-reconnect
initMongo().catch(err => console.warn('⚠️ Mongo init failed at startup', err));

// Auto-reconnect on startup
(async() => { 
  try { 
    const nums = await getAllNumbersFromMongo(); 
    if (nums && nums.length) { 
      console.log(`🔄 Auto-reconnecting ${nums.length} sessions...`);
      for (const n of nums) { 
        if (!activeSockets.has(n)) { 
          const mockRes = { 
            headersSent: false, 
            send: () => {}, 
            status: () => mockRes 
          }; 
          await EmpirePair(n, mockRes); 
          await delay(2000); 
        } 
      } 
    } 
  } catch(e){} 
})();

module.exports = router;
