import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { saveOrShareBlob, saveWorkbookNative } from "./fileSave";
import { GWG_LOGO_B64, GWG_EXPORT_LOGO_B64 } from "../theme/logo";

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
      ["Generasi Wangi Group - Super App"],
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
      doc.setFillColor(15, 76, 53);
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
        doc.addImage(GWG_EXPORT_LOGO_B64, "PNG", 24, 8, 34, 34);
        doc.restoreGraphicsState();
      } catch {}
      // Border hijau tipis di sekeliling badge logo, menyamai tampilan JPG.
      doc.setDrawColor(15, 76, 53);
      doc.setLineWidth(1.2);
      doc.circle(logoCx, logoCy, logoR, "S");
      doc.setTextColor(255,255,255);
      doc.setFont("helvetica","bold"); doc.setFontSize(13);
      doc.text(pdfSafe("Generasi Wangi Group"), 68, 22);
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

      // Font dikecilkan otomatis kalau kolom banyak (tab Kontrol bisa punya
      // puluhan kolom produk) — supaya lebih banyak kolom yang muat di SATU
      // kelompok halaman, dan horizontalPageBreak (lanjutan kolom ke halaman
      // berikutnya) hanya jadi jalan terakhir, bukan langsung kepakai untuk
      // tabel yang sebetulnya masih bisa muat kalau fontnya lebih kecil.
      const numColsNative = columns.length;
      const nativeFontSize = numColsNative <= 6 ? 9 : numColsNative <= 10 ? 8 : numColsNative <= 16 ? 7 : numColsNative <= 24 ? 6 : 5;

      autoTable(doc, {
        head: [columns.map(c=>pdfSafe(c.label))],
        body: rows,
        startY: 62,
        theme: "striped",
        // Kolom sering banyak (produk × stok/jual/bonus, dst), tidak selalu
        // muat di 1 halaman — horizontalPageBreak melanjutkan kolom yang
        // tidak muat ke halaman berikutnya (tetap utuh terbaca), bukan
        // diam-diam terpotong hilang seperti sebelumnya.
        horizontalPageBreak: true,
        horizontalPageBreakRepeat: 0,
        styles: { overflow: "linebreak" },
        headStyles: { fillColor: [15,76,53], textColor: 255, fontStyle: "bold", fontSize: nativeFontSize },
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

  // ── WEB: cara lama (buka jendela print) — terbukti bekerja baik di
  //    browser desktop maupun mobile, jadi tidak diubah.
  const rows = data.map(row =>
    columns.map(c => {
      const val = row[c.key] ?? "—";
      if (typeof val === "boolean") return val ? "Ya" : "Tidak";
      return String(val);
    })
  );

  const colWidths = columns.map((c, ci) => {
    const maxLen = Math.max(c.label.length, ...rows.map(r => String(r[ci]||"").length));
    return Math.min(Math.max(maxLen * 7 + 16, 60), 180);
  });
  const totalW = colWidths.reduce((s,w)=>s+w,0);
  const pct = colWidths.map(w=>(w/totalW*100).toFixed(2)+"%");

  // Kolom sering sangat banyak (mis. tab Kontrol: 3 kolom/produk × jumlah
  // produk aktif), jadi ukuran font & padding dikecilkan otomatis mengikuti
  // jumlah kolom — supaya tabel tetap muat 1 halaman lanskap tanpa terpotong,
  // bukannya dipaksa nowrap yang bikin tabel melebar lalu dicetak berulang
  // di halaman-halaman berikutnya.
  const numCols = columns.length;
  const cellFontSize = numCols <= 6 ? 11 : numCols <= 10 ? 10 : numCols <= 16 ? 9 : numCols <= 24 ? 8 : 7;
  const headFontSize = cellFontSize;
  const cellPad = numCols <= 10 ? "6px 10px" : numCols <= 20 ? "5px 6px" : "3px 4px";

  const tableRows = rows.map((row, i) => `
    <tr style="background:${i%2===0?"#fff":"#f8faf8"}">
      ${row.map((cell, ci) => `<td style="padding:${cellPad};font-size:${cellFontSize}px;border-bottom:1px solid #e5e7eb;width:${pct[ci]};overflow-wrap:anywhere;word-break:break-word;">${cell}</td>`).join("")}
    </tr>`).join("");

  const html = `<!DOCTYPE html><html><head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    @page { size: A4 landscape; margin: 15mm 12mm 15mm 12mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; margin:0; padding:0; color:#1F2937; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px; border-bottom:3px solid #0F4C35; padding-bottom:10px; }
    .brand { display:flex; align-items:center; gap:10px; }
    .brand-text h1 { margin:0; font-size:16px; color:#0F4C35; font-weight:800; }
    .brand-text p { margin:0; font-size:10px; color:#6B7280; letter-spacing:0.05em; text-transform:uppercase; }
    .meta { text-align:right; font-size:10px; color:#6B7280; line-height:1.6; }
    .meta .title { font-size:13px; font-weight:700; color:#1F2937; }
    .summary-bar { display:flex; gap:16px; margin-bottom:14px; }
    .summary-item { background:#F0FDF4; border:1px solid #86EFAC; border-radius:6px; padding:6px 14px; font-size:11px; }
    .summary-item b { color:#0F4C35; display:block; font-size:13px; }
    /* table-layout:fixed MEMAKSA lebar kolom mengikuti persentase yang sudah
       dihitung (jumlahnya 100%) dan TIDAK PERNAH melebar mengikuti isi —
       inilah kunci supaya tabel tidak pernah melebihi lebar kertas walau
       kolomnya banyak (mis. tab Kontrol dengan puluhan kolom produk).
       Sebelumnya thead th pakai white-space:nowrap yang memaksa header tetap
       1 baris utuh, jadi tabel jadi lebih lebar dari kertas — kelebihannya
       lalu dipotong browser dan dicetak ulang di halaman-halaman berikutnya
       (menumpuk berkali lipat) walau sudah mode lanskap. Sekarang teks boleh
       turun baris (word-break) sehingga tetap dalam batas lebar kolomnya. */
    table { width:100%; table-layout:fixed; border-collapse:collapse; font-size:11px; }
    thead { display:table-header-group; }
    tfoot { display:table-footer-group; }
    thead tr { background:#0F4C35; }
    thead th { color:#fff; padding:8px 6px; text-align:left; font-weight:700; font-size:10px; text-transform:uppercase; letter-spacing:0.04em; overflow-wrap:anywhere; word-break:break-word; }
    tbody tr:last-child td { border-bottom:none; }
    tr { page-break-inside:avoid; }
    .footer { margin-top:12px; border-top:1px solid #E5E7EB; padding-top:8px; display:flex; justify-content:space-between; font-size:9px; color:#9CA3AF; }
    @media print { button { display:none !important; } }
  </style>
  </head><body>
  <div class="header">
    <div class="brand">
      <img src="${GWG_EXPORT_LOGO_B64}" alt="GWG" style="width:40px;height:40px;border-radius:50%;background:#fff;padding:3px;object-fit:contain;border:2px solid #0F4C35;" onerror="this.onerror=null;this.src='${GWG_LOGO_B64}';" />
      <div class="brand-text">
        <h1>Generasi Wangi Group</h1>
        <p>Super App · Sistem Manajemen Konsinyasi</p>
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
    <thead><tr>${columns.map((c,i)=>`<th style="width:${pct[i]};font-size:${headFontSize}px;">${c.label}</th>`).join("")}</tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div class="footer">
    <span>Generasi Wangi Group · Super App</span>
    <span>${title} · ${now}</span>
    <span>GWG-${new Date().getFullYear()}</span>
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
      ctx.fillStyle = "#0F4C35";
      ctx.fillRect(0, 0, width, HEADER_H);
      drawLogoBadge(logoImg);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 17px 'Segoe UI', Arial, sans-serif";
      ctx.fillText("Generasi Wangi Group", MARGIN + 52, 34);
      ctx.font = "10px 'Segoe UI', Arial, sans-serif";
      ctx.fillStyle = "#D9F0E6";
      ctx.fillText("SUPER APP · SISTEM MANAJEMEN KONSINYASI", MARGIN + 52, 52);

      ctx.textAlign = "right";
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 14px 'Segoe UI', Arial, sans-serif";
      ctx.fillText(truncate(canvasSafe(title), width - MARGIN * 2 - 250, "bold 14px 'Segoe UI', Arial, sans-serif"), width - MARGIN, 32);
      ctx.font = "11px 'Segoe UI', Arial, sans-serif";
      ctx.fillStyle = "#D9F0E6";
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
        ctx.fillStyle = "#0F4C35";
        ctx.font = "bold 13px 'Segoe UI', Arial, sans-serif";
        ctx.fillText(String(num), bx + 10, y + 17);
        ctx.font = "10px 'Segoe UI', Arial, sans-serif";
        ctx.fillStyle = "#374151";
        ctx.fillText(label, bx + 10, y + 28);
      });
      y += SUMMARY_H;

      ctx.fillStyle = "#0F4C35";
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
      ctx.fillText("Generasi Wangi Group · Super App", MARGIN, y + 24);
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
      img.src = GWG_EXPORT_LOGO_B64;
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
      ctx.strokeStyle = "#0F4C35";
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
  <style>body{font-family:sans-serif;padding:24px}h1{color:#0F4C35}table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#0F4C35;color:#fff}tr:nth-child(even){background:#f2f2f2}</style>
  </head><body><h1>${title}</h1><p>Diekspor: ${new Date().toLocaleString("id-ID")}</p>
  <table><thead><tr>${columns.map(c=>`<th>${c.label}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  await saveOrShareBlob(blob, filename + ".html");
}

// ─────────────────────────────────────────────
//  IMPORT UTILITIES (Excel) — Template & Reader
// ─────────────────────────────────────────────
