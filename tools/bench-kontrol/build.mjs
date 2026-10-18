import * as esbuild from "esbuild";
const stubModulSrc = `
const noop = () => {}; const kelas = class {};
export default new Proxy({}, { get: () => noop });
export const jsPDF = kelas, autoTable = noop, utils = new Proxy({}, { get: () => noop }),
  read = noop, write = noop, writeFile = noop, Capacitor = { isNativePlatform: () => false, getPlatform: () => "web" },
  Network = { getStatus: async () => ({ connected: true }), addListener: noop }, App = { addListener: noop },
  Filesystem = {}, Directory = {}, Encoding = {}, Share = {}, FirebaseAuthentication = {};
`;
const stubPlugin = {
  name: "stub",
  setup(b) {
    b.onResolve({ filter: /^(xlsx|jspdf|jspdf-autotable|@capacitor\/.*|@capacitor-firebase\/.*|firebase\/.*)$/ }, a => ({ path: a.path, namespace: "stub" }));
    b.onResolve({ filter: /hooks\/useDB$/ }, a => ({ path: "useDB", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.path === "useDB" ? "export const useDB = () => ({});" : stubModulSrc, loader: "js" }));
  },
};
await esbuild.build({
  entryPoints: ["bench-entry.jsx"], bundle: true, outfile: "bundle.mjs", format: "esm", platform: "node",
  jsx: "automatic", loader: { ".js": "jsx" }, plugins: [stubPlugin], logLevel: "error", sourcemap: false,
  define: { "import.meta.env": "{}", "process.env.NODE_ENV": JSON.stringify(process.env.BENCH_ENV || "development") },
  nodePaths: ["/tmp/bench/node_modules"],
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
});
console.log("build ok");
