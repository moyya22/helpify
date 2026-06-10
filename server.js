const express = require("express");
const path = require("path");
const mysql = require("mysql2");
const dotenv = require("dotenv");
const multer = require("multer");
const XLSX = require("xlsx");

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
      kode_ref VARCHAR(50),
      nama VARCHAR(200),
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
    if (err) {
      console.error("Gagal buat tabel:", err);
    } else {
      console.log("Tabel pembayaran siap!");
    }
  });
});

// GET semua pembayaran
app.get("/api/pembayaran", (req, res) => {
  db.query("SELECT * FROM pembayaran ORDER BY id DESC", (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, error: err.message });
    }
    return res.json(results);
  });
});

// POST input manual
app.post("/api/pembayaran", (req, res) => {
  const { tanggal, spp, cc, ref, nama, jenis, nominal, rencana } = req.body;

  const sql = `
    INSERT INTO pembayaran (tanggal_terima, no_sppb, kode_cc, kode_ref, nama, jenis_dokumen, nominal, tanggal_rencana, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Belum Bayar')
  `;

  db.query(
    sql,
    [tanggal, spp, cc, ref, nama, jenis, nominal, rencana],
    (err, result) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ success: false, message: "Gagal menyimpan data" });
      }
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
  if (!req.file) {
    return res
      .status(400)
      .json({ success: false, message: "File tidak ditemukan" });
  }

  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    let berhasil = 0;
    let duplikat = 0;
    let gagal = 0;

    const promises = rows.map((row) => {
      return new Promise((resolve) => {
        // Mapping kolom Excel ke database
        const tanggal = row["Tanggal Terima"] || row["tanggal_terima"] || "";
        const spp = row["No SPPb"] || row["no_sppb"] || "";
        const cc = row["Kode CC"] || row["kode_cc"] || "";
        const ref = row["Kode Ref"] || row["kode_ref"] || "";
        const nama = row["Nama Vendor"] || row["nama"] || "";
        const jenis =
          row["Uraian"] ||
          row["jenis_dokumen"] ||
          "Pembayaran Vendor Non Urgent";
        const nominal = parseInt(row["Jumlah Hutang"] || row["nominal"] || 0);
        const rencana =
          row["Tgl Rencana Bayar"] || row["tanggal_rencana"] || "";
        const realisasi =
          row["Tgl Realisasi Bayar"] || row["tanggal_realisasi"] || "";
        const status = realisasi ? "Sudah Bayar" : "Belum Bayar";
        const sumber = row["Sumber"] || row["sumber"] || "";

        if (!spp) {
          gagal++;
          return resolve();
        }

        const sql = `
          INSERT INTO pembayaran (tanggal_terima, no_sppb, kode_cc, kode_ref, nama, jenis_dokumen, nominal, tanggal_rencana, tanggal_realisasi, status, sumber)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE id=id
        `;

        db.query(
          sql,
          [
            tanggal,
            spp,
            cc,
            ref,
            nama,
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
    console.error(err);
    res
      .status(500)
      .json({ success: false, message: "Gagal membaca file Excel" });
  }
});

// PATCH update status
app.patch("/api/pembayaran/:id", (req, res) => {
  const { status, tanggal_realisasi, bukti } = req.body;
  const sql = `UPDATE pembayaran SET status=?, tanggal_realisasi=?, bukti=? WHERE id=?`;

  db.query(sql, [status, tanggal_realisasi, bukti, req.params.id], (err) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ success: false, message: "Gagal update status" });
    }
    return res.json({ success: true, message: "Status berhasil diupdate" });
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
});
