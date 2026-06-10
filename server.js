const express = require("express");
const path = require("path");
const mysql = require("mysql2");
const dotenv = require("dotenv");
const multer = require("multer");
const XLSX = require("xlsx");

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static(__dirname));

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
});

db.connect((err) => {
  if (err) {
    console.error("Koneksi database gagal!");
    console.error(err);
    return;
  }
  console.log("Database berhasil terkoneksi!");

  const createTable = `
    CREATE TABLE IF NOT EXISTS pembayaran (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tanggal_terima VARCHAR(20),
      no_sppb VARCHAR(100) UNIQUE,
      kode_cc VARCHAR(50),
      nama VARCHAR(200),
      uraian TEXT,
      jenis_dokumen VARCHAR(100),
      nominal BIGINT,
      tanggal_rencana VARCHAR(20),
      tanggal_realisasi VARCHAR(20),
      status VARCHAR(20) DEFAULT 'Belum Bayar',
      bukti LONGTEXT,
      sumber VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  db.query(createTable, (err) => {
    if (err) console.error("Gagal buat tabel:", err);
    else console.log("Tabel pembayaran siap!");
  });
});

function hitungSAW(data) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const W = {
    c1: 3 / 19,
    c2: 4 / 19,
    c3: 5 / 19,
    c4: 4 / 19,
    c5: 3 / 19,
  };

  return data.map((d) => {
    // C1 — Kedekatan Tenggat
    let c1 = 1;
    if (d.tanggal_rencana) {
      const rencana = new Date(d.tanggal_rencana);
      rencana.setHours(0, 0, 0, 0);
      const selisih = Math.ceil((rencana - today) / (1000 * 60 * 60 * 24));
      if (selisih < 4) c1 = 5;
      else if (selisih <= 7) c1 = 4;
      else if (selisih <= 14) c1 = 3;
      else if (selisih <= 30) c1 = 2;
      else c1 = 1;
    }

    // C2 — Jenis Pembayaran
    const jenis = (d.jenis_dokumen || "").trim();
    let c2 = 3;
    if (jenis === "Gaji Karyawan Lepas" || jenis === "Gaji Karyawan Tetap")
      c2 = 5;
    else if (jenis === "Pembayaran Vendor Urgent") c2 = 4;
    else if (
      jenis === "Pembayaran Mingguan" ||
      jenis === "Pembayaran Vendor Non Urgent"
    )
      c2 = 3;

    // C3 — Urgensi Operasional
    let c3 = 2;
    if (jenis === "Gaji Karyawan Lepas" || jenis === "Gaji Karyawan Tetap")
      c3 = 5;
    else if (jenis === "Pembayaran Vendor Urgent") c3 = 4;
    else if (jenis === "Pembayaran Mingguan") c3 = 4;
    else if (jenis === "Pembayaran Vendor Non Urgent") c3 = 2;

    // C4 — Umur Tunggu
    let c4 = 1;
    if (d.tanggal_terima) {
      const terima = new Date(d.tanggal_terima);
      terima.setHours(0, 0, 0, 0);
      const umur = Math.ceil((today - terima) / (1000 * 60 * 60 * 24));
      if (umur < 6) c4 = 1;
      else if (umur <= 10) c4 = 2;
      else if (umur <= 20) c4 = 3;
      else if (umur <= 30) c4 = 4;
      else c4 = 5;
    }

    // C5 — Nominal
    const nominal = Number(d.nominal) || 0;
    let c5 = 1;
    if (nominal <= 5000000) c5 = 1;
    else if (nominal <= 15000000) c5 = 2;
    else if (nominal <= 50000000) c5 = 3;
    else if (nominal <= 500000000) c5 = 4;
    else c5 = 5;

    const r1 = c1 / 5;
    const r2 = c2 / 5;
    const r3 = c3 / 5;
    const r4 = c4 / 5;
    const r5 = c5 / 5;

    const saw = W.c1 * r1 + W.c2 * r2 + W.c3 * r3 + W.c4 * r4 + W.c5 * r5;

    return { ...d, saw_score: parseFloat(saw.toFixed(4)) };
  });
}

app.get("/api/pembayaran", (req, res) => {
  db.query("SELECT * FROM pembayaran ORDER BY id DESC", (err, results) => {
    if (err)
      return res.status(500).json({ success: false, error: err.message });

    const belumBayar = results.filter((d) => d.status !== "Sudah Bayar");
    const sudahBayar = results.filter((d) => d.status === "Sudah Bayar");

    const denganSAW = hitungSAW(belumBayar).sort((a, b) => {
      if (b.saw_score !== a.saw_score) return b.saw_score - a.saw_score;
      return new Date(a.tanggal_terima) - new Date(b.tanggal_terima);
    });

    return res.json([...denganSAW, ...sudahBayar]);
  });
});

app.post("/api/pembayaran", (req, res) => {
  const { tanggal, spp, cc, nama, uraian, jenis, nominal, rencana } = req.body;

  const sql = `
    INSERT INTO pembayaran (tanggal_terima, no_sppb, kode_cc, nama, uraian, jenis_dokumen, nominal, tanggal_rencana, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Belum Bayar')
  `;

  db.query(
    sql,
    [tanggal, spp, cc, nama, uraian || "", jenis, nominal, rencana],
    (err, result) => {
      if (err)
        return res
          .status(500)
          .json({ success: false, message: "Gagal menyimpan data" });
      return res.json({
        success: true,
        message: "Data berhasil disimpan",
        id: result.insertId,
      });
    },
  );
});

app.post("/api/upload-excel", upload.single("file"), (req, res) => {
  if (!req.file)
    return res
      .status(400)
      .json({ success: false, message: "File tidak ditemukan" });

  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    let berhasil = 0,
      duplikat = 0,
      gagal = 0;

    const promises = rows.map((row) => {
      return new Promise((resolve) => {
        const tanggal = row["Tanggal Terima"] || row["tanggal_terima"] || "";
        const spp = String(
          row["No SPPb"] || row["No SPPB"] || row["no_sppb"] || "",
        ).trim();
        const cc = String(row["Kode CC"] || row["kode_cc"] || "").trim();
        const nama = String(
          row["Nama Vendor"] || row["Nama"] || row["nama"] || "",
        ).trim();
        const uraian = String(row["Uraian"] || row["uraian"] || "").trim();
        const jenis = String(
          row["Jenis Dokumen"] ||
            row["jenis_dokumen"] ||
            "Pembayaran Vendor Non Urgent",
        ).trim();
        const rawNominal =
          row["Nominal"] ??
          row["Jumlah Hutang"] ??
          row["nominal"] ??
          row["jumlah_hutang"] ??
          0;
        const nominal =
          typeof rawNominal === "number"
            ? Math.round(rawNominal)
            : Math.round(
                parseFloat(String(rawNominal).replace(/[^0-9.-]/g, "")) || 0,
              );
        const rencana =
          row["Tgl Rencana Bayar"] || row["tanggal_rencana"] || "";
        const realisasi =
          row["Tgl Realisasi Bayar"] || row["tanggal_realisasi"] || "";
        const status =
          row["Status"] || (realisasi ? "Sudah Bayar" : "Belum Bayar");
        const sumber = String(row["Sumber"] || row["sumber"] || "").trim();

        if (!spp) {
          gagal++;
          return resolve();
        }

        const sql = `
          INSERT INTO pembayaran (tanggal_terima, no_sppb, kode_cc, nama, uraian, jenis_dokumen, nominal, tanggal_rencana, tanggal_realisasi, status, sumber)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            nominal = VALUES(nominal),
            uraian = VALUES(uraian),
            tanggal_rencana = VALUES(tanggal_rencana),
            tanggal_realisasi = VALUES(tanggal_realisasi),
            status = VALUES(status)
        `;

        db.query(
          sql,
          [
            tanggal,
            spp,
            cc,
            nama,
            uraian,
            jenis,
            nominal,
            rencana,
            realisasi,
            status,
            sumber,
          ],
          (err, result) => {
            if (err) {
              console.error("DB ERROR:", err.message, "| SPP:", spp);
              gagal++;
            } else if (result.affectedRows === 0) {
              duplikat++;
            } else {
              berhasil++;
            }
            resolve();
          },
        );
      });
    });

    Promise.all(promises).then(() => {
      res.json({
        success: true,
        message: `Import selesai! ${berhasil} berhasil, ${duplikat} duplikat dilewati, ${gagal} gagal.`,
        berhasil,
        duplikat,
        gagal,
      });
    });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Gagal membaca file Excel" });
  }
});

app.patch("/api/pembayaran/:id", (req, res) => {
  const { status, tanggal_realisasi, bukti } = req.body;
  db.query(
    "UPDATE pembayaran SET status=?, tanggal_realisasi=?, bukti=? WHERE id=?",
    [status, tanggal_realisasi, bukti, req.params.id],
    (err) => {
      if (err)
        return res
          .status(500)
          .json({ success: false, message: "Gagal update status" });
      return res.json({ success: true, message: "Status berhasil diupdate" });
    },
  );
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server berjalan di port ${PORT}`));
