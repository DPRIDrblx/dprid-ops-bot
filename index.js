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

// ================= DAFTAR =================
bot.onText(/\/daftar/, async (msg) => {
  const userId = msg.from.id;

  const existing = await User.findOne({ userId });
  if (existing) {
    return bot.sendMessage(msg.chat.id, "✅ Kamu sudah terdaftar.");
  }

  await User.create({ userId });
  bot.sendMessage(msg.chat.id, "🔔 Berhasil daftar notifikasi OPS DPRID!");
});

// ================= HAPUS DAFTAR =================
bot.onText(/\/hapusdaftar/, async (msg) => {
  await User.deleteOne({ userId: msg.from.id });
  bot.sendMessage(msg.chat.id, "❌ Kamu berhenti menerima notifikasi.");
});

// ================= TAMBAH OPS =================
let step = {};
let tempData = {};

bot.onText(/\/tambahops/, (msg) => {
  if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, "❌ Bukan admin.");

  step[msg.from.id] = "nama";
  bot.sendMessage(msg.chat.id, "🚆 Masukkan Nama Kereta:");
});

bot.on("message", async (msg) => {
  if (!step[msg.from.id]) return;
  if (!isAdmin(msg.from.id)) return;

  const userStep = step[msg.from.id];

  if (userStep === "nama") {
    tempData[msg.from.id] = { namaKereta: msg.text };
    step[msg.from.id] = "trainset";
    return bot.sendMessage(msg.chat.id, "🚄 Masukkan Trainset:");
  }

  if (userStep === "trainset") {
    tempData[msg.from.id].trainset = msg.text;
    step[msg.from.id] = "jadwal";
    return bot.sendMessage(msg.chat.id, "🕒 Masukkan Jadwal:");
  }

  if (userStep === "jadwal") {
    tempData[msg.from.id].jadwal = msg.text;
    step[msg.from.id] = "surat";
    return bot.sendMessage(msg.chat.id, "📄 Kirim PNG Surat Perjalanan:");
  }

  if (userStep === "surat" && msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    tempData[msg.from.id].suratFileId = fileId;

    const newOps = await OPS.create(tempData[msg.from.id]);

    const users = await User.find();

    for (let u of users) {
      bot.sendPhoto(u.userId, fileId, {
        caption:
`🚆 OPS BARU DPRID

Nama Kereta: ${newOps.namaKereta}
Trainset: ${newOps.trainset}
Jadwal: ${newOps.jadwal}

🟡 Status: MENUNGGU SERVER OPEN`
      });
    }

    delete step[msg.from.id];
    delete tempData[msg.from.id];

    bot.sendMessage(msg.chat.id, "✅ OPS berhasil dibuat & dikirim!");
  }
});

// ================= LIST OPS =================
bot.onText(/\/listops/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;

  const opsList = await OPS.find({ status: "aktif" });

  if (opsList.length === 0)
    return bot.sendMessage(msg.chat.id, "Tidak ada OPS aktif.");

  let text = "📋 OPS AKTIF:\n\n";
  opsList.forEach((o, i) => {
    text += `${i + 1}. ${o.namaKereta} (${o.jadwal})\n`;
  });

  bot.sendMessage(msg.chat.id, text);
});

// ================= SERVER OPEN =================
let serverStep = {};

bot.onText(/\/serveropen/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;

  const opsList = await OPS.find({ status: "aktif" });

  if (opsList.length === 0)
    return bot.sendMessage(msg.chat.id, "Tidak ada OPS aktif.");

  let text = "Pilih OPS:\n\n";
  opsList.forEach((o, i) => {
    text += `${i + 1}. ${o.namaKereta}\n`;
  });

  serverStep[msg.from.id] = opsList;
  bot.sendMessage(msg.chat.id, text);
});

bot.on("message", async (msg) => {
  if (!serverStep[msg.from.id]) return;
  if (!isAdmin(msg.from.id)) return;

  const opsList = serverStep[msg.from.id];
  const index = parseInt(msg.text) - 1;

  if (!opsList[index]) return;

  const selectedOps = opsList[index];

  bot.sendMessage(msg.chat.id, "Kirim link server Roblox:");
  serverStep[msg.from.id] = { selectedOps };
});

bot.on("message", async (msg) => {
  if (!serverStep[msg.from.id]?.selectedOps) return;
  if (!isAdmin(msg.from.id)) return;

  const link = msg.text;
  const selectedOps = serverStep[msg.from.id].selectedOps;

  const users = await User.find();

  for (let u of users) {
    await bot.sendPhoto(u.userId, selectedOps.suratFileId, {
      caption:
`🟢 SERVER OPEN!

🚆 ${selectedOps.namaKereta}
Trainset: ${selectedOps.trainset}
Jadwal: ${selectedOps.jadwal}

🔗 Link Server:
${link}`
    });
  }

  await OPS.updateOne({ _id: selectedOps._id }, { status: "selesai" });

  delete serverStep[msg.from.id];

  bot.sendMessage(msg.chat.id, "✅ Server link dikirim & OPS ditutup.");
});
