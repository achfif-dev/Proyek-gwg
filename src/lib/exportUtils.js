import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { saveOrShareBlob, saveWorkbookNative } from "./fileSave";
import { GWG_EXPORT_LOGO_B64 } from "../theme/logo";
import { loadAppConfig, lighten } from "../config/appConfig";

// ✅ WHITE LABEL: nama & logo di semua ekspor (Excel/PDF/Print/Gambar)
// memakai identitas brand yang diisi lewat Setup Wizard — jatuh balik ke
// logo bawaan GWG kalau belum pernah diisi logo custom.
const _brand = loadAppConfig().brand;
const BRAND_NAME = _brand.companyName;
const BRAND_TAGLINE = _brand.tagline;
const BRAND_LOGO = _brand.logoDataUrl || GWG_EXPORT_LOGO_B64;
// ✅ OPTIMASI: fallback pakai file /logo.png (bukan base64 GWG_LOGO_B64
// yang sudah dihapus dari bundle) — aman di sini karena dipakai sebagai
// <img src> di HTML export (exportHTML), bukan di-embed biner ke PDF/Excel.
const BRAND_LOGO_FALLBACK = _brand.logoDataUrl || "/logo.png";
// ✅ FIX WARNA EKSPOR: sebelumnya warna header PDF/Excel/Print/Gambar
// hardcode hijau GWG ("#0F4C35") walau nama/logo sudah ikut brand —
// akibatnya laporan perusahaan lain tetap berwarna hijau GWG. Sekarang
// ikut brand.primaryColor juga.
const BRAND_COLOR = _brand.primaryColor || "#0F4C35";
// Varian terang dari warna brand, dipakai untuk teks tagline/meta di atas
// header gambar (header-nya sendiri berwarna solid BRAND_COLOR, jadi teks
// sekunder di atasnya perlu versi lebih terang biar tetap kebaca).
const BRAND_COLOR_LT = lighten(BRAND_COLOR, 0.8);
// jsPDF butuh warna sebagai array [r,g,b] (0-255), bukan string hex —
// dipakai supaya header/border PDF juga ikut warna brand (sebelumnya
// hardcode rgb(15,76,53) = "#0F4C35").
function hexToRgbArray(hex) {
  const clean = (hex || "#000000").replace("#", "");
  const full = clean.length === 3 ? clean.split("").map(c => c + c).join("") : clean;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}
const BRAND_COLOR_RGB = hexToRgbArray(BRAND_COLOR);

export function autoColumns(records) {
  const keys = new Set();
  records.forEach(r => Object.keys(r || {}).forEach(k => keys.add(k)));
  return Array.from(keys).map(k => ({ key: k, label: k }));
}


export async function exportCSV(data, columns, filename) {
  const header = columns.map(c => `"${c.label}"`).join(",");
  const rows = data.map(row =>
    columns.map(c => {
      const val = row[c.key] ?? "";
      const str = typeof val === "boolean" ? (val?"Ya":"Tidak") : String(val);
      return `"${str.replace(/"/g,'""')}"`;
    }).join(",")
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  await saveOrShareBlob(blob, filename + ".csv");
}

export async function exportJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  await saveOrShareBlob(blob, filename + ".json");
}

// Export Excel (XLSX) menggunakan SheetJS
export async function exportExcel(data, columns, title, filename) {
  try {
    const header = columns.map(c => c.label);
    const rows = data.map(row =>
      columns.map(c => {
        const val = row[c.key] ?? "";
        if (typeof val === "boolean") return val ? "Ya" : "Tidak";
        if (typeof val === "number") return val;
        return String(val);
      })
    );

    const wsData = [header, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Styling header (lebar kolom otomatis)
    const colWidths = columns.map((c, ci) => {
      const maxLen = Math.max(c.label.length, ...rows.map(r => String(r[ci]||"").length));
      return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
    });
    ws["!cols"] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, title.slice(0,30));

    // Tambah sheet info
    const infoWs = XLSX.utils.aoa_to_sheet([
      [`${BRAND_NAME} - Super App`],
      ["Judul Laporan:", title],
      ["Diekspor:", new Date().toLocaleString("id-ID")],
      ["Total Data:", data.length + " baris"],
    ]);
    XLSX.utils.book_append_sheet(wb, infoWs, "Info");

    await saveWorkbookNative(wb, filename + ".xlsx");
  } catch(e) {
    alert("Gagal ekspor Excel: " + e.message);
  }
}

// Export PDF landscape profesional menggunakan browser print dengan layout khusus
export async function exportPDF(data, columns, title, filename) {
  const now = new Date().toLocaleString("id-ID");

  // jsPDF pakai font standar (Helvetica) yang TIDAK punya karakter
  // emoji/simbol Unicode (🛣️, ═══, 📊, dst) — kalau dibiarkan, karakter itu
  // berubah jadi teks sampah di PDF. Dibersihkan dulu, teks biasa (huruf/
  // angka Indonesia) tidak terpengaruh sama sekali.
  const pdfSafe = (s) => String(s ?? "")
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .replace(/[\u2190-\u2BFF]/g, "")
    .replace(/[\uFE00-\uFE0F]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // ── APK NATIVE: window.open()+window.print() yang dipakai jalur web di
  //    bawah TIDAK berfungsi di WebView (tidak ada jendela baru, dan dialog
  //    print sistem tidak ter-hubung) — makanya sebelumnya cuma menampilkan
  //    halaman HTML polos tanpa opsi apa pun. Di native, bikin file PDF
  //    SUNGGUHAN pakai jsPDF, lalu simpan/bagikan lewat Filesystem+Share
  //    (mekanisme yang sama seperti export Excel/CSV yang sudah terbukti).
  if (Capacitor.isNativePlatform()) {
    try {
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();

      // Header hijau + logo + judul
      doc.setFillColor(...BRAND_COLOR_RGB);
      doc.rect(0, 0, pageW, 50, "F");
      // Latar putih eksplisit dulu di belakang logo (bulat) — beberapa versi
      // jsPDF tidak mengompositkan transparansi PNG dengan benar, jadi tanpa
      // ini logo bisa tampil dengan kotak/pinggiran tidak rapi.
      const logoCx = 24 + 17, logoCy = 8 + 17, logoR = 17;
      doc.setFillColor(255,255,255);
      doc.circle(logoCx, logoCy, 18, "F");
      // Sama seperti versi JPG: logo di-clip jadi bulat SEBELUM digambar,
      // supaya foto logo (persegi) tidak "mentok"/terlihat kotak di dalam
      // badge bulat. Tanpa clip ini, hasil PDF terlihat beda dari JPG.
      try {
        doc.saveGraphicsState();
        doc.ellipse(logoCx, logoCy, logoR, logoR, null);
        doc.clip();
        doc.discardPath();
        doc.addImage(BRAND_LOGO, "PNG", 24, 8, 34, 34);
        doc.restoreGraphicsState();
      } catch {}
      // Border hijau tipis di sekeliling badge logo, menyamai tampilan JPG.
      doc.setDrawColor(...BRAND_COLOR_RGB);
      doc.setLineWidth(1.2);
      doc.circle(logoCx, logoCy, logoR, "S");
      doc.setTextColor(255,255,255);
      doc.setFont("helvetica","bold"); doc.setFontSize(13);
      doc.text(pdfSafe(BRAND_NAME), 68, 22);
      doc.setFont("helvetica","normal"); doc.setFontSize(8);
      doc.text(pdfSafe("SUPER APP · SISTEM MANAJEMEN KONSINYASI"), 68, 33);
      doc.setFontSize(10);
      doc.text(pdfSafe(title), pageW-24, 20, { align:"right" });
      doc.setFontSize(8);
      doc.text(pdfSafe(`Diekspor: ${now}  ·  Total: ${data.length} data`), pageW-24, 32, { align:"right" });

      const rows = data.map(row => columns.map(c => {
        const val = row[c.key] ?? "—";
        const str = typeof val === "boolean" ? (val?"Ya":"Tidak") : String(val);
        return pdfSafe(str) || "—";
      }));

      // PENTING: sebelumnya lebar tiap kolom DITEBAK dari JUMLAH KARAKTER
      // label/isi lalu dipaksa proporsional ke availableWidth — tanpa
      // memperhatikan apakah teksnya benar-benar muat di font yang
      // dipakai. Kalau kolomnya banyak (mis. Siklus Kontrol dengan 20
      // kolom), proporsi kolom berangka pendek ("0", "180") jadi lebih
      // sempit dari lebar 1 karakter di font itu → autoTable terpaksa
      // menurunkan baris di SETIAP huruf/angka (persis hasil PDF yang
      // berantakan di APK). Perbaikannya: ukur lebar teks SUNGGUHAN pakai
      // doc.getTextWidth() (bukan tebak), dan kalau totalnya kelebihan,
      // KECILKAN FONT-nya dulu (bukan cuma paksa kolomnya menyempit) —
      // sama prinsipnya dengan exportJPG yang mengukur teks asli.
      const numColsNative = columns.length;
      const availableWidth = pageW - 24 - 24; // dikurangi margin kiri+kanan
      const CELL_PAD = 4; // pt per sisi — harus sama dengan cellPadding di styles bawah
      const MIN_FONT = 4.5;
      let nativeFontSize = numColsNative <= 6 ? 9 : numColsNative <= 10 ? 8 : numColsNative <= 16 ? 7 : numColsNative <= 24 ? 6 : numColsNative <= 34 ? 5 : MIN_FONT;

      // ⚡ OPTIMASI: measuredWidths() sebelumnya di-scan ULANG PENUH
      // (semua baris × semua kolom, pakai doc.getTextWidth()) SETIAP KALI
      // loop guard di bawah mengecilkan font — bisa sampai 21x total pass
      // (1 awal + 20 iterasi guard). Di data 5.000 baris × banyak kolom,
      // itu setara puluhan ribu—jutaan pemanggilan getTextWidth() dan bikin
      // export PDF terasa macet/lag beberapa detik.
      //
      // Fix: doc.getTextWidth(text) di jsPDF = getStringUnitWidth(text) *
      // fontSize / scaleFactor — SELALU proporsional linear terhadap
      // fontSize untuk font & teks yang sama. Jadi cukup ukur SEKALI pakai
      // getStringUnitWidth() (unit yang tidak bergantung fontSize), lalu di
      // setiap iterasi guard tinggal kalikan angka yang sudah ada — tanpa
      // pernah men-scan ulang data baris. Hasilnya identik persis (bukan
      // aproksimasi), cuma jauh lebih cepat.
      const scaleFactor = doc.internal.scaleFactor;
      doc.setFont("helvetica", "bold");
      const headerUnitW = columns.map(c => doc.getStringUnitWidth(pdfSafe(c.label)));
      doc.setFont("helvetica", "normal");
      const bodyUnitW = columns.map((c, ci) =>
        rows.reduce((m, r) => Math.max(m, doc.getStringUnitWidth(String(r[ci] ?? ""))), 0)
      );
      const unitWidths = columns.map((c, ci) => Math.max(headerUnitW[ci], bodyUnitW[ci]));

      function measuredWidths(fontSize) {
        return unitWidths.map(u => (u * fontSize) / scaleFactor + CELL_PAD * 2);
      }

      let colWidths = measuredWidths(nativeFontSize);
      let totalMeasured = colWidths.reduce((s, w) => s + w, 0);
      let guard = 0;
      // Kalau teks di font saat ini lebih lebar dari 1 halaman, kecilkan
      // font sedikit demi sedikit lalu hitung ulang (tinggal aritmatika,
      // bukan scan ulang), sampai muat (atau sampai batas minimum font
      // yang masih layak dibaca).
      while (totalMeasured > availableWidth && nativeFontSize > MIN_FONT && guard < 20) {
        nativeFontSize = Math.max(MIN_FONT, +(nativeFontSize * 0.92).toFixed(2));
        colWidths = measuredWidths(nativeFontSize);
        totalMeasured = colWidths.reduce((s, w) => s + w, 0);
        guard++;
      }
      // Sesudah pas (atau sedekat mungkin), regangkan/susutkan semua kolom
      // secara PROPORSIONAL (bukan tebak ulang) supaya totalnya persis
      // selebar halaman — kolom tetap sebanding dengan kebutuhan isinya.
      const fitFactor = totalMeasured > 0 ? availableWidth / totalMeasured : 1;
      colWidths = colWidths.map(w => w * fitFactor);

      const columnStyles = {};
      colWidths.forEach((w, ci) => { columnStyles[ci] = { cellWidth: w }; });

      autoTable(doc, {
        head: [columns.map(c=>pdfSafe(c.label))],
        body: rows,
        startY: 62,
        theme: "striped",
        tableWidth: availableWidth,
        horizontalPageBreak: false,
        styles: { overflow: "linebreak", cellWidth: "wrap", cellPadding: CELL_PAD },
        columnStyles,
        headStyles: { fillColor: BRAND_COLOR_RGB, textColor: 255, fontStyle: "bold", fontSize: nativeFontSize },
        bodyStyles: { fontSize: nativeFontSize },
        alternateRowStyles: { fillColor: [248,250,248] },
        margin: { left: 24, right: 24, top: 62 },
      });

      const blob = doc.output("blob");
      await saveOrShareBlob(blob, filename + ".pdf");
    } catch (e) {
      alert("Gagal membuat PDF: " + e.message);
    }
    return;
  }

  // ── WEB: buka jendela print) — dulu lebar kolom ditebak dari JUMLAH
  //    KARAKTER (maxLen*7+16) lalu dipaksa jadi tabel table-layout:fixed
  //    lebar 100%. Masalahnya: WebView/browser print di Android biasanya
  //    me-layout halaman di lebar layar HP (bukan lebar kertas A4 lanskap
  //    sungguhan) SEBELUM dicetak — jadi tabel 100% itu ikut mengecil ke
  //    lebar layar HP, dan kolom yang tadinya "cukup" (mis. lebar untuk
  //    "180") jadi jauh lebih sempit dari itu, sampai lebih kecil dari 1
  //    karakter → browser terpaksa turun baris SETIAP HURUF/ANGKA (persis
  //    seperti hasil PDF yang terlihat rusak). Perbaikannya: ukur lebar
  //    teks SUNGGUHAN pakai canvas (sama seperti exportJPG di bawah, yang
  //    hasilnya sudah rapi), kasih tiap kolom lebar tetap dalam PIXEL lewat
  //    <colgroup> (bukan tebakan/persentase), lalu satu kali "zoom" seluruh
  //    halaman supaya pas dalam satu lebar kertas — tidak pernah lebih
  //    sempit dari yang dibutuhkan teksnya, dan tidak pernah kepotong ke
  //    "halaman lanjutan kolom".
  const rows = data.map(row =>
    columns.map(c => {
      const val = row[c.key] ?? "—";
      if (typeof val === "boolean") return val ? "Ya" : "Tidak";
      return String(val);
    })
  );

  // Kolom sering sangat banyak (mis. tab Kontrol: 3 kolom/produk × jumlah
  // produk aktif), jadi ukuran font & padding dikecilkan otomatis mengikuti
  // jumlah kolom — supaya tabel tetap kompak dalam satu halaman lanskap.
  const numCols = columns.length;
  const cellFontSize = numCols <= 6 ? 11 : numCols <= 10 ? 10 : numCols <= 16 ? 9 : numCols <= 24 ? 8 : 7;
  const headFontSize = cellFontSize;
  const cellPad = numCols <= 10 ? "6px 10px" : numCols <= 20 ? "5px 6px" : "3px 4px";
  const padX = numCols <= 10 ? 10 : numCols <= 20 ? 6 : 4;

  // Ukur lebar teks SUNGGUHAN (bukan tebak dari jumlah karakter) — sama
  // persis prinsipnya dengan exportJPG, jadi hasil PDF konsisten dengan JPG.
  const meas = document.createElement("canvas").getContext("2d");
  function textWidth(text, font) {
    meas.font = font;
    return meas.measureText(String(text)).width;
  }
  const headFont = `bold ${headFontSize}px 'Segoe UI', Arial, sans-serif`;
  const cellFontStr = `${cellFontSize}px 'Segoe UI', Arial, sans-serif`;
  const MIN_COL = 30;   // lebar minimum tiap kolom (px) — cukup buat header/angka pendek
  const MAX_COL = 220;  // lebar maksimum (px) — kolom teks panjang tetap boleh turun baris
  const colWidths = columns.map((c, ci) => {
    let w = textWidth(String(c.label).toUpperCase(), headFont);
    rows.forEach(r => { w = Math.max(w, textWidth(r[ci], cellFontStr)); });
    return Math.min(Math.max(Math.ceil(w) + padX * 2, MIN_COL), MAX_COL);
  });
  const tableWidth = colWidths.reduce((s, w) => s + w, 0);

  // Lebar konten kertas A4 lanskap sungguhan (setelah margin @page di bawah),
  // dikonversi ke px (96dpi) — target lebar cetak, TERLEPAS dari lebar layar HP.
  const PAGE_CONTENT_PX = Math.round((297 - 24) * (96 / 25.4));
  const bodyWidth = Math.max(tableWidth, 760); // biar header tetap enak dilihat kalau kolom sedikit
  // "zoom" (bukan transform:scale) supaya layout ikut menyusut rapi tanpa
  // perlu hitung ulang tinggi manual — didukung baik di Chrome/WebView
  // Android, yaitu mesin yang dipakai fitur print/"simpan sbg PDF" di HP.
  const fitScale = tableWidth > PAGE_CONTENT_PX ? +(PAGE_CONTENT_PX / tableWidth).toFixed(4) : 1;

  const colgroup = `<colgroup>${colWidths.map(w => `<col style="width:${w}px">`).join("")}</colgroup>`;

  const tableRows = rows.map((row, i) => `
    <tr style="background:${i%2===0?"#fff":"#f8faf8"}">
      ${row.map((cell) => `<td style="padding:${cellPad};font-size:${cellFontSize}px;border-bottom:1px solid #e5e7eb;overflow-wrap:anywhere;word-break:break-word;">${cell}</td>`).join("")}
    </tr>`).join("");

  const html = `<!DOCTYPE html><html><head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    @page { size: A4 landscape; margin: 15mm 12mm 15mm 12mm; }
    * { box-sizing: border-box; }
    html { width:${bodyWidth}px; }
    body { font-family: 'Segoe UI', Arial, sans-serif; margin:0; padding:0; color:#1F2937; width:${bodyWidth}px; zoom:${fitScale}; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px; border-bottom:3px solid ${BRAND_COLOR}; padding-bottom:10px; }
    .brand { display:flex; align-items:center; gap:10px; }
    .brand-text h1 { margin:0; font-size:16px; color:${BRAND_COLOR}; font-weight:800; }
    .brand-text p { margin:0; font-size:10px; color:#6B7280; letter-spacing:0.05em; text-transform:uppercase; }
    .meta { text-align:right; font-size:10px; color:#6B7280; line-height:1.6; }
    .meta .title { font-size:13px; font-weight:700; color:#1F2937; }
    .summary-bar { display:flex; gap:16px; margin-bottom:14px; }
    .summary-item { background:#F0FDF4; border:1px solid #86EFAC; border-radius:6px; padding:6px 14px; font-size:11px; }
    .summary-item b { color:${BRAND_COLOR}; display:block; font-size:13px; }
    /* Lebar tiap kolom sekarang datang dari <colgroup> (px sungguhan, hasil
       ukur teks asli) — table-layout:fixed di sini cuma mengunci lebar itu
       supaya browser tidak menghitung ulang otomatis, BUKAN sumber lebar
       kolomnya. Tabel punya lebar aslinya sendiri (tableWidth), lalu satu
       kali "zoom" di <body> yang menyesuaikan semuanya ke lebar kertas —
       jadi kolom tidak akan pernah dipaksa lebih sempit dari isi kontennya. */
    table { width:${tableWidth}px; table-layout:fixed; border-collapse:collapse; font-size:11px; }
    thead { display:table-header-group; }
    tfoot { display:table-footer-group; }
    thead tr { background:${BRAND_COLOR}; }
    thead th { color:#fff; padding:8px 6px; text-align:left; font-weight:700; font-size:10px; text-transform:uppercase; letter-spacing:0.04em; overflow-wrap:anywhere; word-break:break-word; }
    tbody tr:last-child td { border-bottom:none; }
    tr { page-break-inside:avoid; }
    .footer { margin-top:12px; border-top:1px solid #E5E7EB; padding-top:8px; display:flex; justify-content:space-between; font-size:9px; color:#9CA3AF; }
    @media print { button { display:none !important; } }
  </style>
  </head><body>
  <div class="header">
    <div class="brand">
      <img src="${BRAND_LOGO}" alt="${BRAND_NAME}" style="width:40px;height:40px;border-radius:50%;background:#fff;padding:3px;object-fit:contain;border:2px solid ${BRAND_COLOR};" onerror="this.onerror=null;this.src='${BRAND_LOGO_FALLBACK}';" />
      <div class="brand-text">
        <h1>${BRAND_NAME}</h1>
        <p>${BRAND_TAGLINE}</p>
      </div>
    </div>
    <div class="meta">
      <div class="title">${title}</div>
      <div>Diekspor: ${now}</div>
      <div>Total: ${data.length} data</div>
    </div>
  </div>
  <div class="summary-bar">
    <div class="summary-item"><b>${data.length}</b>Total Baris</div>
    <div class="summary-item"><b>${columns.length}</b>Kolom</div>
    <div class="summary-item"><b>${now.split(",")[0]}</b>Tanggal Ekspor</div>
  </div>
  <table>
    ${colgroup}
    <thead><tr>${columns.map((c)=>`<th style="font-size:${headFontSize}px;">${c.label}</th>`).join("")}</tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div class="footer">
    <span>${BRAND_NAME} · Super App</span>
    <span>${title} · ${now}</span>
    <span>${(BRAND_NAME||"App").replace(/\s+/g,"").slice(0,12)}-${new Date().getFullYear()}</span>
  </div>
  <script>setTimeout(()=>window.print(),400)<\/script>
  </body></html>`;

  const win = window.open("","_blank");
  if (win) { win.document.write(html); win.document.close(); }
  else alert("Pop-up diblokir. Izinkan pop-up untuk ekspor PDF.");
}

// Ekspor JPG: menggambar tabel langsung ke <canvas> (tanpa dependensi
// eksternal seperti html2canvas) lalu mengunduhnya sebagai file gambar.
// Cocok untuk dibagikan cepat lewat WhatsApp/chat karena hasilnya berupa
// satu gambar utuh, bukan dokumen yang perlu dibuka aplikasi lain.
export async function exportJPG(data, columns, title, filename) {
  try {
    const now = new Date().toLocaleString("id-ID");
    const rows = data.map(row => columns.map(c => {
      const val = row[c.key] ?? "—";
      if (typeof val === "boolean") return val ? "Ya" : "Tidak";
      return String(val);
    }));

    const PAD_X = 14;
    const meas = document.createElement("canvas").getContext("2d");
    const headerFont = "bold 11px 'Segoe UI', Arial, sans-serif";
    const cellFont = "12px 'Segoe UI', Arial, sans-serif";

    function widthOf(text, font) {
      meas.font = font;
      return meas.measureText(String(text)).width;
    }
    function truncate(text, maxWidth, font) {
      text = String(text);
      meas.font = font;
      if (meas.measureText(text).width <= maxWidth) return text;
      let lo = 0, hi = text.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (meas.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid;
        else hi = mid - 1;
      }
      return text.slice(0, lo) + (lo < text.length ? "…" : "");
    }

    const colWidths = columns.map((c, ci) => {
      let w = widthOf(c.label.toUpperCase(), headerFont);
      rows.forEach(r => { w = Math.max(w, widthOf(r[ci], cellFont)); });
      return Math.min(Math.max(w + PAD_X * 2, 90), 260);
    });

    const tableWidth = colWidths.reduce((s, w) => s + w, 0);
    const MARGIN = 28;
    const HEADER_H = 78;
    const SUMMARY_H = 38;
    const HEAD_ROW_H = 32;
    const ROW_H = 28;
    const FOOTER_H = 30;
    const width = tableWidth + MARGIN * 2;
    const height = MARGIN + HEADER_H + SUMMARY_H + HEAD_ROW_H + rows.length * ROW_H + FOOTER_H + MARGIN;

    const SCALE = 2; // render 2x lalu di-downscale otomatis oleh browser → teks lebih tajam
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * SCALE);
    canvas.height = Math.ceil(height * SCALE);
    const ctx = canvas.getContext("2d");
    ctx.scale(SCALE, SCALE);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    // Canvas fillText di sebagian WebView Android (HP kamu) ternyata tidak
    // punya font emoji sama sekali — bukannya kosong/kotak seperti biasanya,
    // malah muncul karakter acak/rusak. Bersihkan emoji khusus untuk teks
    // yang digambar ke canvas (tidak menyentuh data aslinya, jadi tampilan
    // di layar & PDF tetap normal seperti biasa).
    function canvasSafe(s) {
      return String(s ?? "")
        .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
        .replace(/[\u2190-\u2BFF]/g, "")
        .replace(/[\uFE00-\uFE0F]/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    }

    function drawTableAndDownload(logoImg) {
      let y;
      ctx.fillStyle = BRAND_COLOR;
      ctx.fillRect(0, 0, width, HEADER_H);
      drawLogoBadge(logoImg);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 17px 'Segoe UI', Arial, sans-serif";
      ctx.fillText(BRAND_NAME, MARGIN + 52, 34);
      ctx.font = "10px 'Segoe UI', Arial, sans-serif";
      ctx.fillStyle = BRAND_COLOR_LT;
      ctx.fillText(BRAND_TAGLINE.toUpperCase(), MARGIN + 52, 52);

      ctx.textAlign = "right";
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 14px 'Segoe UI', Arial, sans-serif";
      ctx.fillText(truncate(canvasSafe(title), width - MARGIN * 2 - 250, "bold 14px 'Segoe UI', Arial, sans-serif"), width - MARGIN, 32);
      ctx.font = "11px 'Segoe UI', Arial, sans-serif";
      ctx.fillStyle = BRAND_COLOR_LT;
      ctx.fillText(`Diekspor: ${now}`, width - MARGIN, 50);
      ctx.fillText(`Total: ${data.length} data`, width - MARGIN, 65);
      ctx.textAlign = "left";

      y = HEADER_H + 14;
      ctx.fillStyle = "#F0FDF4";
      ctx.strokeStyle = "#86EFAC";
      const sumW = 120, sumGap = 10;
      [[data.length, "Total Baris"], [columns.length, "Kolom"]].forEach(([num, label], i) => {
        const bx = MARGIN + i * (sumW + sumGap);
        ctx.fillStyle = "#F0FDF4";
        ctx.fillRect(bx, y, sumW, SUMMARY_H - 10);
        ctx.strokeRect(bx, y, sumW, SUMMARY_H - 10);
        ctx.fillStyle = BRAND_COLOR;
        ctx.font = "bold 13px 'Segoe UI', Arial, sans-serif";
        ctx.fillText(String(num), bx + 10, y + 17);
        ctx.font = "10px 'Segoe UI', Arial, sans-serif";
        ctx.fillStyle = "#374151";
        ctx.fillText(label, bx + 10, y + 28);
      });
      y += SUMMARY_H;

      ctx.fillStyle = BRAND_COLOR;
      ctx.fillRect(MARGIN, y, tableWidth, HEAD_ROW_H);
      ctx.fillStyle = "#ffffff";
      let x = MARGIN;
      columns.forEach((c, ci) => {
        ctx.font = headerFont;
        ctx.fillText(truncate(canvasSafe(c.label).toUpperCase(), colWidths[ci] - PAD_X * 2, headerFont), x + PAD_X, y + HEAD_ROW_H / 2 + 4);
        x += colWidths[ci];
      });
      y += HEAD_ROW_H;

      rows.forEach((r, ri) => {
        ctx.fillStyle = ri % 2 === 0 ? "#ffffff" : "#F8FAF8";
        ctx.fillRect(MARGIN, y, tableWidth, ROW_H);
        ctx.strokeStyle = "#E5E7EB";
        ctx.beginPath();
        ctx.moveTo(MARGIN, y + ROW_H);
        ctx.lineTo(MARGIN + tableWidth, y + ROW_H);
        ctx.stroke();
        ctx.fillStyle = "#1F2937";
        let cx = MARGIN;
        r.forEach((cell, ci) => {
          ctx.font = cellFont;
          ctx.fillText(truncate(canvasSafe(cell), colWidths[ci] - PAD_X * 2, cellFont), cx + PAD_X, y + ROW_H / 2 + 4);
          cx += colWidths[ci];
        });
        y += ROW_H;
      });

      ctx.strokeStyle = "#E5E7EB";
      ctx.beginPath();
      ctx.moveTo(MARGIN, y + 8);
      ctx.lineTo(MARGIN + tableWidth, y + 8);
      ctx.stroke();
      ctx.fillStyle = "#9CA3AF";
      ctx.font = "9px 'Segoe UI', Arial, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`${BRAND_NAME} · Super App`, MARGIN, y + 24);
      ctx.textAlign = "right";
      ctx.fillText(`${title} · ${now}`, MARGIN + tableWidth, y + 24);
      ctx.textAlign = "left";

      canvas.toBlob(async (blob) => {
        await saveOrShareBlob(blob, filename + ".jpg");
      }, "image/jpeg", 0.92);
    }

    // Logo digambar dari gambar raster asli (GWG_EXPORT_LOGO_B64), BUKAN
    // bentuk vektor. Sebelumnya sempat diganti ke vektor karena drawImage()
    // dipanggil sebelum gambar selesai di-decode, sehingga di sebagian
    // WebView Android (.apk) logo gagal muncul (kosong/putih). Perbaikannya:
    // tunggu proses decode gambar selesai dulu (pakai img.decode() dengan
    // fallback ke onload/onerror) baru gambar tabelnya, di web maupun .apk.
    async function loadLogoImage() {
      const img = new Image();
      img.src = BRAND_LOGO;
      try {
        if (img.decode) {
          await img.decode();
        } else {
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
          });
        }
        return img;
      } catch (e) {
        return null; // gagal dimuat → header tetap dicetak tanpa logo
      }
    }

    function drawLogoBadge(img) {
      if (!img) return; // tidak ada fallback vektor, sesuai permintaan
      const cx = MARGIN + 22, cy = 39, r = 19;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.clip();
      ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = BRAND_COLOR;
      ctx.stroke();
      ctx.restore();
    }

    const logoImg = await loadLogoImage();
    drawTableAndDownload(logoImg);
  } catch (e) {
    alert("Gagal ekspor JPG: " + e.message);
  }
}

export async function exportHTML(data, columns, title, filename) {
  const rows = data.map(row =>
    `<tr>${columns.map(c => {
      const val = row[c.key] ?? "—";
      const str = typeof val === "boolean" ? (val?"Ya":"Tidak") : String(val);
      return `<td>${str}</td>`;
    }).join("")}</tr>`
  ).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>body{font-family:sans-serif;padding:24px}h1{color:${BRAND_COLOR}}table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:${BRAND_COLOR};color:#fff}tr:nth-child(even){background:#f2f2f2}</style>
  </head><body><h1>${title}</h1><p>Diekspor: ${new Date().toLocaleString("id-ID")}</p>
  <table><thead><tr>${columns.map(c=>`<th>${c.label}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  await saveOrShareBlob(blob, filename + ".html");
}

// ─────────────────────────────────────────────
//  IMPORT UTILITIES (Excel) — Template & Reader
// ─────────────────────────────────────────────
