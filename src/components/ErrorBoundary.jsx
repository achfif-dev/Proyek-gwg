import React from "react";

// Menangkap error saat render supaya layar tidak putih kosong. Error tampilan
// TIDAK menghapus data: data yang sudah tersimpan di Firebase / antrean lokal
// tetap utuh. Pengguna bisa memuat ulang atau menyalin detail error untuk dilaporkan.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, disalin: false };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }
  salin = async () => {
    const teks = `${this.state.error?.stack || this.state.error?.message || String(this.state.error)}`;
    try { await navigator.clipboard.writeText(teks); this.setState({ disalin: true }); } catch { /* clipboard tidak tersedia */ }
  };
  render() {
    if (!this.state.error) return this.props.children;
    const pesan = this.state.error?.message || String(this.state.error);
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#F8FAFC", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: 440, width: "100%", background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: 24, boxShadow: "0 4px 24px rgba(0,0,0,.06)" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#0F172A", marginBottom: 8 }}>Terjadi kesalahan pada tampilan</div>
          <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.6, marginBottom: 12 }}>
            Error ini hanya menghentikan tampilan. Data yang sudah tersimpan tidak terpengaruh. Coba muat ulang; kalau berulang, salin detail error dan laporkan.
          </div>
          <div style={{ fontSize: 12, color: "#B91C1C", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "8px 10px", marginBottom: 16, wordBreak: "break-word" }}>{pesan}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => window.location.reload()} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: "#1E1B8F", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Muat Ulang</button>
            <button onClick={this.salin} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid #CBD5E1", background: "#fff", color: "#0F172A", fontWeight: 700, cursor: "pointer" }}>{this.state.disalin ? "Tersalin" : "Salin Detail Error"}</button>
          </div>
        </div>
      </div>
    );
  }
}
