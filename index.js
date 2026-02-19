require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

console.log("Bot berjalan...");

// ================= CONNECT DB =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log("MongoDB Error:", err));

// ================= SCHEMA =================
const userSchema = new mongoose.Schema({ 
    userId: Number,
    username: String,
    firstName: String
});

const opsSchema = new mongoose.Schema({
  namaKereta: String,
  trainset: String,
  jadwal: String,
  suratFileId: String,
  status: { type: String, default: "aktif" },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);
const OPS = mongoose.model("OPS", opsSchema);

// ================= ADMIN CHECK =================
function isAdmin(id) {
  return id == process.env.ADMIN_ID;
}

// ================= STATE MANAGEMENT =================
let step = {};           
let tempData = {};       
let pengumumanStep = {}; 
let pengumumanData = {}; 
let serverStep = {};     

// ================= COMMANDS (USER) =================

// DAFTAR (OTOMATIS)
bot.onText(/\/daftar/, async (msg) => {
  const userId = msg.from.id;
  const username = msg.from.username || "n/a";
  const firstName = msg.from.first_name || "User";

  const existing = await User.findOne({ userId });
  if (existing) return bot.sendMessage(msg.chat.id, "✅ Kamu sudah terdaftar dalam notifikasi.");
  
  await User.create({ userId, username, firstName });
  bot.sendMessage(msg.chat.id, "🔔 *Berhasil daftar notifikasi OPS DPRID!*\n\nData profilmu telah disimpan otomatis. Kamu akan menerima notifikasi setiap ada OPS baru.\n\n_Ketik /hapusdaftar untuk berhenti berlangganan._", { parse_mode: "Markdown" });
});

// UNSUBSCRIBE / HAPUS DAFTAR
bot.onText(/\/hapusdaftar/, async (msg) => {
  const userId = msg.from.id;
  const existing = await User.findOne({ userId });
  
  if (!existing) return bot.sendMessage(msg.chat.id, "⚠️ Kamu memang belum terdaftar.");

  await User.deleteOne({ userId });
  bot.sendMessage(msg.chat.id, "❌ *Unsubscribed.*\nKamu telah berhenti berlangganan dan tidak akan menerima notifikasi lagi.", { parse_mode: "Markdown" });
});

// ================= COMMANDS (ADMIN) =================

// CEK LIST SUBSCRIBER
bot.onText(/\/cekuser/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const users = await User.find();
  if (users.length === 0) return bot.sendMessage(msg.chat.id, "Belum ada subscriber.");
  
  let text = `📊 *DAFTAR SUBSCRIBER (${users.length})*\n\n`;
  users.forEach((u, i) => {
    text += `${i + 1}. ${u.firstName} (@${u.username})\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

// LIST OPS AKTIF
bot.onText(/\/listops/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const opsList = await OPS.find({ status: "aktif" });
  if (opsList.length === 0) return bot.sendMessage(msg.chat.id, "Tidak ada OPS aktif.");
  
  let text = "📋 *OPS AKTIF SAAT INI:*\n\n";
  opsList.forEach((o, i) => {
    text += `${i + 1}. ${o.namaKereta} - ${o.jadwal}\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

// SERVER OPEN (WITH BUTTON)
bot.onText(/\/serveropen/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const opsList = await OPS.find({ status: "aktif" });
  if (opsList.length === 0) return bot.sendMessage(msg.chat.id, "Tidak ada OPS aktif untuk dibuka.");
  
  const buttons = opsList.map(o => ([{ text: `🚆 ${o.namaKereta}`, callback_data: `open_${o._id}` }]));
  
  bot.sendMessage(msg.chat.id, "Pilih OPS yang ingin dibuka servernya:", {
    reply_markup: { inline_keyboard: buttons }
  });
});

// TAMBAH OPS
bot.onText(/\/tambahops/, (msg) => {
  if (!isAdmin(msg.from.id)) return;
  step[msg.from.id] = "nama";
  bot.sendMessage(msg.chat.id, "🚆 Masukkan Nama Kereta:");
});

// TAMBAH PENGUMUMAN
bot.onText(/\/tambahpengumuman/, (msg) => {
  if (!isAdmin(msg.from.id)) return;
  pengumumanStep[msg.from.id] = "isi_pesan";
  bot.sendMessage(msg.chat.id, "📢 Masukkan isi pengumuman:");
});

// ================= CALLBACK QUERY (TOMBOL ADMIN) =================
bot.on("callback_query", async (query) => {
  const userId = query.from.id;
  const data = query.data;

  if (!isAdmin(userId)) return;

  if (data.startsWith("open_")) {
    const opsId = data.split("_")[1];
    const selectedOps = await OPS.findById(opsId);

    if (!selectedOps) return bot.answerCallbackQuery(query.id, { text: "OPS tidak ditemukan." });

    serverStep[userId] = { type: "input_link", ops: selectedOps };
    
    bot.editMessageText(`🔗 Oke! Silakan kirimkan *LINK SERVER* untuk:\n*${selectedOps.namaKereta}*`, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: "Markdown"
    });
    bot.answerCallbackQuery(query.id);
  }
});

// ================= HANDLER PESAN (INPUT DATA) =================
bot.on("message", async (msg) => {
  const userId = msg.from.id;
  const text = msg.text;

  if (!isAdmin(userId) || !text) return;
  if (text.startsWith("/")) return;

  // 1. LOGIKA SERVER OPEN (BROADCAST LINK)
  if (serverStep[userId] && serverStep[userId].type === "input_link") {
    const ops = serverStep[userId].ops;
    const users = await User.find();
    
    bot.sendMessage(msg.chat.id, `🚀 Memulai broadcast ke ${users.length} subscriber...`);
    
    let success = 0;
    for (let u of users) {
      try {
        await bot.sendPhoto(u.userId, ops.suratFileId, { 
          caption: `🟢 **SERVER OPEN!**\n\n🚆 **${ops.namaKereta}**\n🚄 Trainset: ${ops.trainset}\n🕒 Jadwal: ${ops.jadwal}\n\nKlik tombol di bawah ini untuk masuk ke server!`,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "🔗 JOIN SERVER SEKARANG", url: text }]]
          }
        });
        success++;
      } catch(e) { console.log(`Gagal kirim ke ${u.userId}`); }
    }
    
    await OPS.updateOne({ _id: ops._id }, { status: "selesai" });
    delete serverStep[userId];
    return bot.sendMessage(msg.chat.id, `✅ Selesai! Link terkirim ke ${success} subscriber.`);
  }

  // 2. LOGIKA TAMBAH OPS
  if (step[userId]) {
    if (step[userId] === "nama") { 
        tempData[userId] = { namaKereta: text }; 
        step[userId] = "trainset"; 
        return bot.sendMessage(msg.chat.id, "🚄 Masukkan Trainset:"); 
    }
    if (step[userId] === "trainset") { 
        tempData[userId].trainset = text; 
        step[userId] = "jadwal"; 
        return bot.sendMessage(msg.chat.id, "🕒 Masukkan Jadwal:"); 
    }
    if (step[userId] === "jadwal") { 
        tempData[userId].jadwal = text; 
        step[userId] = "surat"; 
        return bot.sendMessage(msg.chat.id, "📄 Kirim Foto Surat Perjalanan:"); 
    }
  }
  
  // Handler Foto Surat (Bagian dari Tambah OPS)
  if (step[userId] === "surat" && msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    tempData[userId].suratFileId = fileId;
    const newOps = await OPS.create(tempData[userId]);
    const users = await User.find();
    
    for (let u of users) {
      try { 
        await bot.sendPhoto(u.userId, fileId, { 
            caption: `🚆 **OPS BARU DPRID**\n\nNama Kereta: ${newOps.namaKereta}\nTrainset: ${newOps.trainset}\nJadwal: ${newOps.jadwal}\n\n🟡 Status: *MENUNGGU SERVER OPEN*`, 
            parse_mode: "Markdown" 
        }); 
      } catch(e){}
    }
    delete step[userId]; delete tempData[userId];
    return bot.sendMessage(msg.chat.id, "✅ OPS Berhasil dibuat dan disebarkan!");
  }

  // 3. LOGIKA PENGUMUMAN
  if (pengumumanStep[userId]) {
    if (pengumumanStep[userId] === "isi_pesan") {
      pengumumanData[userId] = { pesan: text };
      pengumumanStep[userId] = "foto_pengumuman";
      return bot.sendMessage(msg.chat.id, "🖼️ Kirim Foto Pengumuman (atau ketik 'none' jika tidak ada):");
    }
    if (pengumumanStep[userId] === "foto_pengumuman") {
      const users = await User.find();
      const cap = `📢 **PENGUMUMAN BARU**\n\n${pengumumanData[userId].pesan}`;
      
      if (text?.toLowerCase() === "none") {
        for (let u of users) { try { await bot.sendMessage(u.userId, cap, { parse_mode: "Markdown" }); } catch(e){} }
      } else if (msg.photo) {
        const fid = msg.photo[msg.photo.length - 1].file_id;
        for (let u of users) { try { await bot.sendPhoto(u.userId, fid, { caption: cap, parse_mode: "Markdown" }); } catch(e){} }
      } else {
          return bot.sendMessage(msg.chat.id, "⚠️ Kirim foto atau ketik 'none'.");
      }
      
      delete pengumumanStep[userId]; delete pengumumanData[userId];
      return bot.sendMessage(msg.chat.id, "✅ Pengumuman berhasil dikirim ke semua user!");
    }
  }
});