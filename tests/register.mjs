// Loader kecil supaya Node bisa menjalankan file src/ yang memakai import
// tanpa ekstensi (gaya Vite): "./format" → "./format.js". Tanpa dependensi baru.
import { register } from "node:module";
register("./resolve-hook.mjs", import.meta.url);
