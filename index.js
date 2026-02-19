require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

console.log("Bot berjalan...");

// ================= CONNECT DB =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

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

// ================= COMMANDS =================
bot.onText(/\/daftar/, async (msg) => {
  const userId = msg.from.id;
  const username = msg.from.username || "n/a";
  const firstName = msg.from.first_name || "User";

  const existing = await User.findOne({ userId });
  if (existing) return bot.sendMessage(msg.chat.id, "✅ Kamu sudah terdaftar.");
  
  await User.create({ userId, username, firstName });
  bot.sendMessage(msg.chat.id, "🔔 Berhasil daftar! Data profilmu tersimpan otomatis.");
});

bot.onText(/\/cekuser/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const users = await User.find();
  if (users.length === 0) return bot.sendMessage(msg.chat.id, "Belum ada subscriber.");
  
  let text = `📊 *SUBSCRIBER: ${users.length}*\n\n`;
  users.forEach((u, i) => {
    text += `${i + 1}. ${u.firstName} (@${u.username})\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

bot.onText(/\/serveropen/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const opsList = await OPS.find({ status: "aktif" });
  if (opsList.length === 0) return bot.sendMessage(msg.chat.id, "Tidak ada OPS aktif.");
  
  let text = "Pilih nomor OPS untuk dibuka:\n\n";
  opsList.forEach((o, i) => { text += `${i + 1}. ${o.namaKereta}\n`; });
  
  serverStep[msg.from.id] = { type: "pilih_ops", list: opsList };
  bot.sendMessage(msg.chat.id, text);
});

// Perintah lain tetap sama (tambahops, tambahpengumuman, listops)
bot.onText(/\/tambahops/, (msg) => { if (isAdmin(msg.from.id)) step[msg.from.id] = "nama"; bot.sendMessage(msg.chat.id, "🚆 Masukkan Nama Kereta:"); });
bot.onText(/\/tambahpengumuman/, (msg) => { if (isAdmin(msg.from.id)) pengumumanStep[msg.from.id] = "isi_pesan"; bot.sendMessage(msg.chat.id, "📢 Masukkan isi pengumuman:"); });

// ================= HANDLER UTAMA =================
bot.on("message", async (msg) => {
  const userId = msg.from.id;
  const text = msg.text;

  if (!isAdmin(userId) || !text) return;
  if (text.startsWith("/")) return; // JANGAN proses jika itu adalah command baru

  // 1. Logika Server Open (DIPERBAIKI)
  if (serverStep[userId]) {
    if (serverStep[userId].type === "pilih_ops") {
      const index = parseInt(text) - 1;
      const selected = serverStep[userId].list[index];
      if (!selected) return bot.sendMessage(msg.chat.id, "❌ Nomor salah. Pilih lagi:");
      
      serverStep[userId] = { type: "input_link", ops: selected };
      return bot.sendMessage(msg.chat.id, `🔗 Kirim link server untuk: ${selected.namaKereta}`);
    }
    
    if (serverStep[userId].type === "input_link") {
      const ops = serverStep[userId].ops;
      const users = await User.find();
      
      bot.sendMessage(msg.chat.id, "⏳ Menyiapkan pengiriman...");
      
      for (let u of users) {
        try {
          await bot.sendPhoto(u.userId, ops.suratFileId, { 
            caption: `🟢 SERVER OPEN!\n\n🚆 ${ops.namaKereta}\nTrainset: ${ops.trainset}\n\n🔗 Link:\n${text}` 
          });
        } catch(e) { console.log("Gagal kirim ke:", u.userId); }
      }
      
      await OPS.updateOne({ _id: ops._id }, { status: "selesai" });
      delete serverStep[userId];
      return bot.sendMessage(msg.chat.id, "✅ Server link dikirim ke semua subscriber!");
    }
  }

  // 2. Logika Tambah OPS
  if (step[userId]) {
    if (step[userId] === "nama") { tempData[userId] = { namaKereta: text }; step[userId] = "trainset"; return bot.sendMessage(msg.chat.id, "🚄 Masukkan Trainset:"); }
    if (step[userId] === "trainset") { tempData[userId].trainset = text; step[userId] = "jadwal"; return bot.sendMessage(msg.chat.id, "🕒 Masukkan Jadwal:"); }
    if (step[userId] === "jadwal") { tempData[userId].jadwal = text; step[userId] = "surat"; return bot.sendMessage(msg.chat.id, "📄 Kirim Foto Surat:"); }
  }
  
  if (step[userId] === "surat" && msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    tempData[userId].suratFileId = fileId;
    const newOps = await OPS.create(tempData[userId]);
    const users = await User.find();
    for (let u of users) {
      try { await bot.sendPhoto(u.userId, fileId, { caption: `🚆 OPS BARU\n\nKereta: ${newOps.namaKereta}\n\n🟡 Status: MENUNGGU SERVER OPEN` }); } catch(e){}
    }
    delete step[userId]; delete tempData[userId];
    return bot.sendMessage(msg.chat.id, "✅ OPS Berhasil Dibuat!");
  }

  // 3. Logika Pengumuman
  if (pengumumanStep[userId]) {
    if (pengumumanStep[userId] === "isi_pesan") {
      pengumumanData[userId] = { pesan: text };
      pengumumanStep[userId] = "foto_pengumuman";
      return bot.sendMessage(msg.chat.id, "🖼️ Kirim Foto (atau ketik 'none'):");
    }
    if (pengumumanStep[userId] === "foto_pengumuman") {
      const users = await User.find();
      const cap = `📢 *PENGUMUMAN*\n\n${pengumumanData[userId].pesan}`;
      if (text?.toLowerCase() === "none") {
        for (let u of users) { try { await bot.sendMessage(u.userId, cap, { parse_mode: "Markdown" }); } catch(e){} }
      } else if (msg.photo) {
        const fid = msg.photo[msg.photo.length - 1].file_id;
        for (let u of users) { try { await bot.sendPhoto(u.userId, fid, { caption: cap, parse_mode: "Markdown" }); } catch(e){} }
      }
      delete pengumumanStep[userId]; delete pengumumanData[userId];
      return bot.sendMessage(msg.chat.id, "✅ Pengumuman Terkirim!");
    }
  }
});