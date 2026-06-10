const express = require("express");
const path = require("path");
const mysql = require("mysql2");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

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
});

app.post("/api/pembayaran", (req, res) => {
  const { tanggal, spp, cc, ref, nama, jenis, nominal, rencana } = req.body;

  const sql = `
    INSERT INTO pembayaran (
      tanggal_terima,
      no_sppb,
      kode_cc,
      kode_ref,
      nama,
      jenis_dokumen,
      nominal,
      tanggal_rencana,
      status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Belum Bayar')
  `;

  db.query(
    sql,
    [tanggal, spp, cc, ref, nama, jenis, nominal, rencana],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({
          success: false,
          message: "Gagal menyimpan data",
        });
      }

      return res.json({
        success: true,
        message: "Data berhasil disimpan",
        id: result.insertId,
      });
    },
  );
});

app.get("/api/pembayaran", (req, res) => {
  db.query("SELECT * FROM pembayaran ORDER BY id DESC", (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        error: err.message,
      });
    }

    return res.json(results);
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
});
