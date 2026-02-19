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

bot.onText(/\/daftar/, async (msg) => {
  const userId = msg.from.id;
  const username = msg.from.username || "n/a";
  const firstName = msg.from.first_name || "User";

  const existing = await User.findOne({ userId });
  if (existing) return bot.sendMessage(msg.chat.id, "✅ Kamu sudah terdaftar.");
  
  await User.create({ userId, username, firstName });
  bot.sendMessage(msg.chat.id, "🔔 *Berhasil daftar notifikasi OPS DPRID!*\n\nData profilmu disimpan otomatis. Kamu akan menerima notifikasi setiap ada OPS.\n\n_Ketik /hapusdaftar untuk berhenti._", { parse_mode: "Markdown" });
});

bot.onText(/\/hapusdaftar/, async (msg) => {
  const userId = msg.from.id;
  const existing = await User.findOne({ userId });
  if (!existing) return bot.sendMessage(msg.chat.id, "⚠️ Kamu memang belum terdaftar.");
  await User.deleteOne({ userId });
  bot.sendMessage(msg.chat.id, "❌ *Unsubscribed.*\nKamu tidak akan menerima notifikasi lagi.", { parse_mode: "Markdown" });
});

// ================= COMMANDS (ADMIN) =================

bot.onText(/\/cekuser/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const users = await User.find();
  if (users.length === 0) return bot.sendMessage(msg.chat.id, "Belum ada subscriber.");
  let text = `📊 *SUBSCRIBER (${users.length})*\n\n`;
  users.forEach((u, i) => { text += `${i + 1}. ${u.firstName} (@${u.username})\n`; });
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

bot.onText(/\/listops/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const opsList = await OPS.find({ status: "aktif" });
  if (opsList.length === 0) return bot.sendMessage(msg.chat.id, "Tidak ada OPS aktif.");
  let text = "📋 *OPS AKTIF:*\n\n";
  opsList.forEach((o, i) => { text += `${i + 1}. ${o.namaKereta} - ${o.jadwal}\n`; });
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

bot.onText(/\/serveropen/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const opsList = await OPS.find({ status: "aktif" });
  if (opsList.length === 0) return bot.sendMessage(msg.chat.id, "Tidak ada OPS aktif.");
  const buttons = opsList.map(o => ([{ text: `🚆 ${o.namaKereta}`, callback_data: `open_${o._id}` }]));
  bot.sendMessage(msg.chat.id, "Pilih OPS untuk dibuka servernya:", { reply_markup: { inline_keyboard: buttons } });
});

bot.onText(/\/hapusops/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const opsList = await OPS.find({ status: "aktif" });
  if (opsList.length === 0) return bot.sendMessage(msg.chat.id, "Tidak ada OPS aktif.");
  const buttons = opsList.map(o => ([{ text: `🗑️ Hapus: ${o.namaKereta}`, callback_data: `delete_${o._id}` }]));
  bot.sendMessage(msg.chat.id, "Pilih OPS yang ingin dihapus & dibatalkan:", { reply_markup: { inline_keyboard: buttons } });
});

bot.onText(/\/tambahops/, (msg) => {
  if (!isAdmin(msg.from.id)) return;
  step[msg.from.id] = "nama";
  bot.sendMessage(msg.chat.id, "🚆 Masukkan Nama Kereta:");
});

bot.onText(/\/tambahpengumuman/, (msg) => {
  if (!isAdmin(msg.from.id)) return;
  pengumumanStep[msg.from.id] = "isi_pesan";
  bot.sendMessage(msg.chat.id, "📢 Masukkan isi pengumuman:");
});

// ================= CALLBACK QUERY (TOMBOL) =================
bot.on("callback_query", async (query) => {
  const userId = query.from.id;
  const data = query.data;
  if (!isAdmin(userId)) return;

  // OPEN SERVER
  if (data.startsWith("open_")) {
    const opsId = data.split("_")[1];
    const selectedOps = await OPS.findById(opsId);
    if (!selectedOps) return bot.answerCallbackQuery(query.id, { text: "OPS tidak ditemukan." });
    serverStep[userId] = { type: "input_link", ops: selectedOps };
    bot.editMessageText(`🔗 Kirim LINK SERVER untuk: *${selectedOps.namaKereta}*`, { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "Markdown" });
    bot.answerCallbackQuery(query.id);
  }

  // DELETE OPS + BROADCAST
  if (data.startsWith("delete_")) {
    const opsId = data.split("_")[1];
    const targetOps = await OPS.findById(opsId);
    if (!targetOps) return bot.answerCallbackQuery(query.id, { text: "Sudah tidak ada." });

    const { namaKereta, jadwal } = targetOps;
    await OPS.findByIdAndDelete(opsId);
    const users = await User.find();

    bot.editMessageText(`⏳ Menghapus & Mengirim notifikasi pembatalan...`, { chat_id: query.message.chat.id, message_id: query.message.message_id });

    for (let u of users) {
      try {
        await bot.sendMessage(u.userId, `❌ **OPS DIBATALKAN**\n\nOperasional:\n🚆 **${namaKereta}**\n🕒 Jadwal: ${jadwal}\n\n**Telah dibatalkan.** Mohon maaf!`, { parse_mode: "Markdown" });
      } catch(e) {}
    }

    bot.editMessageText(`✅ OPS *${namaKereta}* dihapus & dibatalkan!`, { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "Markdown" });
    bot.answerCallbackQuery(query.id);
  }
});

// ================= HANDLER PESAN =================
bot.on("message", async (msg) => {
  const userId = msg.from.id;
  const text = msg.text;
  if (!isAdmin(userId) || !text || text.startsWith("/")) return;

  // 1. INPUT LINK SERVER
  if (serverStep[userId]?.type === "input_link") {
    const ops = serverStep[userId].ops;
    const users = await User.find();
    bot.sendMessage(msg.chat.id, `🚀 Memulai broadcast...`);
    for (let u of users) {
      try {
        await bot.sendPhoto(u.userId, ops.suratFileId, { 
          caption: `🟢 **SERVER OPEN!**\n\n🚆 **${ops.namaKereta}**\n🕒 Jadwal: ${ops.jadwal}\n\nKlik tombol di bawah!`,
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [[{ text: "🔗 JOIN SERVER", url: text }]] }
        });
      } catch(e) {}
    }
    await OPS.updateOne({ _id: ops._id }, { status: "selesai" });
    delete serverStep[userId];
    return bot.sendMessage(msg.chat.id, `✅ Selesai!`);
  }

  // 2. TAMBAH OPS
  if (step[userId] === "nama") { tempData[userId] = { namaKereta: text }; step[userId] = "trainset"; return bot.sendMessage(msg.chat.id, "🚄 Masukkan Trainset:"); }
  if (step[userId] === "trainset") { tempData[userId].trainset = text; step[userId] = "jadwal"; return bot.sendMessage(msg.chat.id, "🕒 Masukkan Jadwal:"); }
  if (step[userId] === "jadwal") { tempData[userId].jadwal = text; step[userId] = "surat"; return bot.sendMessage(msg.chat.id, "📄 Kirim Foto Surat:"); }
  if (step[userId] === "surat" && msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    tempData[userId].suratFileId = fileId;
    const newOps = await OPS.create(tempData[userId]);
    const users = await User.find();
    for (let u of users) {
      try { await bot.sendPhoto(u.userId, fileId, { caption: `🚆 **OPS BARU**\n\nNama: ${newOps.namaKereta}\n🟡 Status: *MENUNGGU OPEN*`, parse_mode: "Markdown" }); } catch(e){}
    }
    delete step[userId]; delete tempData[userId];
    return bot.sendMessage(msg.chat.id, "✅ Tersebar!");
  }

  // 3. PENGUMUMAN
  if (pengumumanStep[userId] === "isi_pesan") {
    pengumumanData[userId] = { pesan: text };
    pengumumanStep[userId] = "foto_pengumuman";
    return bot.sendMessage(msg.chat.id, "🖼️ Kirim Foto atau ketik 'none':");
  }
  if (pengumumanStep[userId] === "foto_pengumuman") {
    const users = await User.find();
    const cap = `📢 **PENGUMUMAN**\n\n${pengumumanData[userId].pesan}`;
    if (text?.toLowerCase() === "none") {
      for (let u of users) { try { await bot.sendMessage(u.userId, cap, { parse_mode: "Markdown" }); } catch(e){} }
    } else if (msg.photo) {
      const fid = msg.photo[msg.photo.length - 1].file_id;
      for (let u of users) { try { await bot.sendPhoto(u.userId, fid, { caption: cap, parse_mode: "Markdown" }); } catch(e){} }
    }
    delete pengumumanStep[userId]; delete pengumumanData[userId];
    return bot.sendMessage(msg.chat.id, "✅ Terkirim!");
  }
});