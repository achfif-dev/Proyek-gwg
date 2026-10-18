import fs from "fs";
const f = fs.readdirSync("prof").filter(x => x.endsWith(".cpuprofile")).map(x => "prof/" + x).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
const p = JSON.parse(fs.readFileSync(f));
const byId = new Map(p.nodes.map(n => [n.id, n]));
const self = new Map();
const dt = p.timeDeltas; 
p.samples.forEach((id, i) => { self.set(id, (self.get(id) || 0) + (dt[i] || 0)); });
const agg = new Map();
for (const [id, t] of self) {
  const n = byId.get(id); const cf = n.callFrame;
  const key = `${cf.functionName || "(anon)"} @ ${cf.url.split("/").slice(-1)[0]}:${cf.lineNumber + 1}`;
  agg.set(key, (agg.get(key) || 0) + t);
}
const total = [...agg.values()].reduce((a, b) => a + b, 0);
console.log("total sampel (ms):", (total / 1000).toFixed(0));
[...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 28).forEach(([k, t]) => console.log((t / 1000).toFixed(0).padStart(6), "ms ", k));
