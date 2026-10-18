import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
for (const k of ["window", "document", "navigator", "localStorage", "sessionStorage", "HTMLElement", "Node", "Event", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"])
  if (!(k in globalThis) || k === "navigator") { try { Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true }); } catch {} }
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.self = dom.window; globalThis.HTMLElement = dom.window.HTMLElement;
await import("./bundle.mjs");
