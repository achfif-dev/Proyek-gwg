import { encodeEmailKey } from "../lib/dataHelpers";

export const SUPER_ADMIN_EMAIL = "achfif@gmail.com"; // TODO: ganti dengan email Anda
export const isSuperAdminEmail = (email) =>
  !!SUPER_ADMIN_EMAIL && email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
// ID "resmi" baris Super Admin — dibuat deterministik dari email (sama seperti
// yang dipakai proses auto-register). Ini dipakai untuk membedakan baris
// Super Admin yang ASLI dari baris DUPLIKAT lama (bug sebelumnya) yang
// kebetulan punya email sama tapi id acak berbeda. Hanya baris dengan id
// PERSIS ini yang benar-benar dikunci dari hapus/edit — baris lain yang
// emailnya sama tapi id-nya beda dianggap duplikat basi dan BOLEH dihapus,
// supaya admin bisa membersihkan sisa duplikat tanpa terkunci total.
export const SUPER_ADMIN_CANONICAL_ID = SUPER_ADMIN_EMAIL
  ? "U_" + encodeEmailKey(SUPER_ADMIN_EMAIL.toLowerCase())
  : null;
