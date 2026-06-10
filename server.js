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

// GET semua pembayaran
app.get("/api/pembayaran", (req, res) => {
  db.query("SELECT * FROM pembayaran ORDER BY id DESC", (err, results) => {
    if (err)
      return res.status(500).json({ success: false, error: err.message });
    return res.json(results);
  });
});

// POST input manual
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

// POST upload Excel
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

// PATCH update status
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
