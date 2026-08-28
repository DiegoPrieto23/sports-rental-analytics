/* ===========================================================================
   Prueba de humo de las paginas del informe.

   No hay navegador disponible en este entorno, asi que se monta un DOM minimo
   —suficiente para que el codigo del informe corra— y se renderizan las ocho
   paginas con varias combinaciones de filtros. No comprueba como SE VE nada:
   comprueba que ninguna pagina lanza una excepcion, que todas producen tarjetas
   y graficos, y que el tiempo de render es razonable. Es lo que atrapa un typo
   o una variable sin definir en las ~1.100 lineas de codigo de pagina.

   Uso:
       node docs/test_render.js
   =========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

/* ------------------------------------------------------------------ DOM ---- */
/* Tercera copia de la paleta, necesaria para que cssVar() resuelva sin
   navegador. La fuente de verdad es el bloque de tokens de
   docs/report/01_head.html: al cambiar un color alli hay que cambiarlo aqui, o
   el humo se renderiza con colores que ya no existen y no avisa de nada.
   Solo hacen falta los colores: los tokens de tamano, espaciado y forma no se
   leen nunca desde JS (04_charts.js los duplica como FS_MICRO / FS_NANO). */
const COLORS = {
  "--s1": "#0082C3", "--s2": "#eb6834", "--s3": "#1baf7a", "--s4": "#eda100",
  "--s5": "#e87ba4", "--s6": "#008300", "--s7": "#4a3aa7", "--s8": "#e34948",
  "--plane": "#f9f9f7", "--surface": "#fcfcfb", "--ink": "#0b0b0b", "--ink-2": "#52514e",
  "--muted": "#898781", "--grid": "#e1e0d9", "--axis": "#c3c2b7",
  "--neutral-mark": "#b9b8b1", "--good": "#006300", "--bad": "#d03b3b",
  "--warn": "#ec835a", "--div-mid": "#f0efec", "--hairline": "#e0e0e0",
};

const stats = { elements: 0, svg: 0, listeners: 0 };

class El {
  constructor(tag) {
    this.tagName = String(tag).toLowerCase();
    this.children = [];
    this.attrs = {};
    this.style = {};
    this.dataset = {};
    this._text = "";
    this.parentNode = null;
    this._classes = new Set();
    stats.elements++;
    if (this.tagName === "svg") stats.svg++;
    const self = this;
    this.classList = {
      add: (...c) => c.forEach(x => self._classes.add(x)),
      remove: (...c) => c.forEach(x => self._classes.delete(x)),
      contains: c => self._classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !self._classes.has(c) : force;
        if (on) self._classes.add(c); else self._classes.delete(c);
        return on;   // devuelve el estado resultante, como el DOM real
      },
    };
  }
  get className() { return [...this._classes].join(" "); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === "class") this.className = v;
  }
  getAttribute(k) { return this.attrs[k]; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  insertBefore(node, ref) {
    const i = this.children.indexOf(ref);
    node.parentNode = this;
    this.children.splice(i < 0 ? this.children.length : i, 0, node);
    return node;
  }
  after(node) {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    this.parentNode.children.splice(i + 1, 0, node);
    node.parentNode = this.parentNode;
  }
  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    if (i >= 0) this.parentNode.children.splice(i, 1);
    this.parentNode = null;
  }
  addEventListener() { stats.listeners++; }
  removeEventListener() {}
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  set innerHTML(html) { this.children = []; parseInto(this, String(html)); }
  get innerHTML() { return ""; }
  get clientWidth() { return 0; }       // frame() cae a su ancho por defecto
  get offsetWidth() { return 120; }
  get offsetHeight() { return 60; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 300 }; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    // Soporta "tag", ".clase", "#id" y combinaciones separadas por espacio o ">".
    const parts = sel.split(/\s*>\s*|\s+/).filter(Boolean);
    let pool = [this];
    for (const p of parts) {
      const next = [];
      for (const node of pool) collect(node, p, next);
      pool = next;
    }
    return pool;
  }
}
function matches(node, sel) {
  if (sel.startsWith(".")) return node._classes.has(sel.slice(1));
  if (sel.startsWith("#")) return node.attrs.id === sel.slice(1);
  return node.tagName === sel.toLowerCase();
}
function collect(node, sel, out) {
  for (const c of node.children) {
    if (matches(c, sel)) out.push(c);
    collect(c, sel, out);
  }
}

/* Parser de HTML minimo: solo lo que el informe se escribe a si mismo. */
function parseInto(root, html) {
  const stack = [root];
  const re = /<\/?([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:=(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const [full, tag, attrStr, selfClose, text] = m;
    if (text != null) {
      const t = text.trim();
      if (t) stack[stack.length - 1]._text += t;
      continue;
    }
    if (full.startsWith("</")) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const el = new El(tag);
    const ar = /([\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'))?/g;
    let a;
    while ((a = ar.exec(attrStr || ""))) el.setAttribute(a[1], a[2] ?? a[3] ?? "");
    stack[stack.length - 1].appendChild(el);
    const VOID = ["input", "br", "img", "hr", "meta"];
    if (!selfClose && !VOID.includes(el.tagName)) stack.push(el);
  }
}

const byId = {};
function el(id) {
  if (!byId[id]) { byId[id] = new El("div"); byId[id].setAttribute("id", id); }
  return byId[id];
}
const documentElement = new El("html");
const document = {
  documentElement,
  createElement: t => new El(t),
  createElementNS: (ns, t) => new El(t),
  getElementById: el,
  querySelectorAll: sel => {
    const out = [];
    for (const k in byId) collect(byId[k], sel.split(/\s+/)[0], out);
    return out;
  },
  addEventListener() {},
};

const sandbox = {
  document, console, atob, Blob, DecompressionStream, Response, TextDecoder,
  Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Float64Array,
  getComputedStyle: () => ({ getPropertyValue: n => COLORS[n] || "#888888" }),
  matchMedia: () => ({ matches: false }),
  innerWidth: 1600, innerHeight: 900,
  addEventListener() {}, scrollTo() {}, setTimeout, clearTimeout,
  Math, Date, JSON, Object, Array, String, Number, Boolean, Error, isFinite, parseInt,
  Intl, Map, Set, Promise, RegExp, Symbol,
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;

/* --------------------------------------------------------------- ejecucion -- */
const html = fs.readFileSync(path.join(__dirname, "informe.html"), "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("No se encontro el <script> del informe"); process.exit(1); }
// Se quita la llamada final a boot() para controlarla desde aqui.
// Los `\r?` no sobran: `build_report.py` escribe el fichero con los finales de
// linea del sistema, asi que en Windows llega con CRLF y un patron anclado en
// "\n" no casa. Sin ellos el recorte fallaba en silencio: boot() arrancaba por
// su cuenta ademas del driver, y todo se construia y se medía dos veces. La
// comprobacion posterior existe para que un fallo asi vuelva a ser ruidoso.
const script = m[1].replace(/\r?\nboot\(\)\.catch\([\s\S]*?\}\);\r?\n/, "\n");
if (/boot\(\)\.catch\(/.test(script)) {
  console.error("No se pudo recortar la llamada a boot(): el arnes no controlaria el arranque.");
  process.exit(1);
}

const driver = `
globalThis.__run = async () => {
  await decodeFacts(DATA);
  buildChrome();
  const out = [];
  const scenarios = [
    { name: "sin filtros", apply: () => {} },
    { name: "Esquí+Snowboard · España", apply: () => {
        state.cat.add(D.categories.indexOf("Esquí"));
        state.cat.add(D.categories.indexOf("Snowboard"));
        state.country.add(D.countries.indexOf("España"));
      } },
    { name: "2025 · canal App · Gold", apply: () => {
        state.period = "2025";
        state.channel.add(D.channels.indexOf("App"));
        state.member.add(D.members.indexOf("Gold"));
      } },
    { name: "selección vacía", apply: () => {
        // Se busca una combinacion que no devuelva ninguna fila, para ejercitar
        // de verdad el estado vacio en vez de suponer que lo hace.
        state.period = "2024";
        const [a, b] = monthRange("2024");
        for (let ci = 0; ci < D.categories.length; ci++) {
          for (let co = 0; co < D.countries.length; co++) {
            for (let ch = 0; ch < D.channels.length; ch++) {
              state.cat.clear(); state.country.clear(); state.channel.clear();
              state.cat.add(ci); state.country.add(co); state.channel.add(ch);
              state.member.clear(); state.member.add(D.members.indexOf("Gold"));
              state.segment.clear(); state.segment.add(D.segments.indexOf("VIP"));
              const mk = buildMask(a, b);
              let n = 0;
              for (let i = 0; i < mk.length; i++) n += mk[i];
              if (n === 0) return;
            }
          }
        }
      } },
  ];
  for (const sc of scenarios) {
    state.period = "all";
    [state.cat, state.country, state.channel, state.member, state.segment].forEach(s => s.clear());
    sc.apply();
    for (let i = 0; i < PAGES.length; i++) {
      state.page = i;
      const t0 = Date.now();
      let error = null;
      try { render(); } catch (e) { error = (e && e.stack) || String(e); }
      const panels = document.getElementById("panels");
      const cards = panels.querySelectorAll(".card").length;
      const svgs = panels.querySelectorAll("svg").length;
      const tables = panels.querySelectorAll("table").length;
      out.push({ escenario: sc.name, pagina: PAGES[i].label, ms: Date.now() - t0,
                 filas: A.total.n[0], tarjetas: cards, graficos: svgs, tablas: tables, error });
    }
  }
  return out;
};
`;

vm.createContext(sandbox);
vm.runInContext(script + driver, sandbox, { filename: "informe.html" });

sandbox.__run().then(rows => {
  let fail = 0, empty = 0;
  let scen = "";
  console.log("escenario / página".padEnd(46) + "ms".padStart(6) + "filas".padStart(9) +
              "tarj.".padStart(7) + "gráf.".padStart(7) + "tablas".padStart(8) + "   estado");
  console.log("-".padEnd(97, "-"));
  for (const r of rows) {
    if (r.escenario !== scen) { scen = r.escenario; console.log("· " + scen); }
    const vacia = r.filas === 0;
    let estado = "OK";
    if (r.error) { estado = "ERROR"; fail++; }
    else if (vacia) estado = r.tarjetas === 1 ? "aviso OK" : (empty++, "SIN AVISO");
    else if (r.tarjetas === 0 || r.graficos === 0) { estado = "VACÍA"; empty++; }
    console.log("   " + r.pagina.padEnd(41) + String(r.ms).padStart(6) +
      r.filas.toLocaleString("es-ES").padStart(9) +
      String(r.tarjetas).padStart(7) + String(r.graficos).padStart(7) +
      String(r.tablas).padStart(8) + "   " + estado);
    if (r.error) console.log("      " + r.error.split("\n").slice(0, 3).join("\n      "));
  }
  const slow = rows.filter(r => r.ms > 1500).length;
  console.log("\nelementos creados: " + stats.elements.toLocaleString("es-ES") +
              " · svg: " + stats.svg + " · listeners: " + stats.listeners.toLocaleString("es-ES"));
  if (fail || empty) {
    console.error(`\n${fail} página(s) con excepción, ${empty} sin contenido`);
    process.exit(1);
  }
  console.log(`\nLas ${rows.length} combinaciones de página y filtro renderizan sin excepciones` +
              (slow ? ` (${slow} por encima de 1,5 s)` : "") + ".");
}).catch(e => { console.error(e); process.exit(1); });
