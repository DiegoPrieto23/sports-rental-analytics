/* ===========================================================================
   Formato, tarjetas, filtros y ciclo de render.
   =========================================================================== */

const nf = (v, d = 0) => v == null || !isFinite(v) ? "—"
  : v.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
const eur = (v, d = 0) => v == null || !isFinite(v) ? "—" : nf(v, d) + " €";
const pct = (v, d = 1) => v == null || !isFinite(v) ? "—" : nf(v * 100, d) + " %";
const compact = v => {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return nf(v / 1e6, 2) + " M";
  if (a >= 1e3) return nf(v / 1e3, 0) + " k";
  return nf(v, 0);
};
const MONTH_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DOW_SHORT = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const monthLabel = m => MONTH_SHORT[+m.slice(5, 7) - 1] + " " + m.slice(2, 4);
const pval = p => p == null || !isFinite(p) ? "—" : p < 1e-4 ? "< 0,0001" : nf(p, 4);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* Separa la unidad de la cifra para poder darles peso distinto en los KPI. No
   reimplementa el formato: parte lo que ya devuelven eur() / pct() / nf(), asi
   que sigue habiendo un unico sitio donde se decide como se escribe un numero. */
const splitUnit = s => {
  const m = /^(.+?)\s*(€|%|\/ 5)$/.exec(s);
  return m ? [m[1], m[2]] : [s, ""];
};

/* --------------------------------------------------------------------------
   Iconos de la barra de filtros

   Dibujados a mano y en linea a proposito: el informe es un unico fichero que
   se abre sin red, asi que no hay libreria de iconos que valga. Todos comparten
   lienzo de 20x20, trazo de 1,5 y extremos redondeados, y heredan el color con
   `currentColor` para seguir el tema y el estado del filtro.
   -------------------------------------------------------------------------- */
const ICON = {
  // calendario
  periodo: '<rect x="3" y="4.5" width="14" height="12.5" rx="2"/><path d="M3 8.5h14"/>' +
           '<path d="M7 2.5v3"/><path d="M13 2.5v3"/>',
  // globo terraqueo
  pais: '<circle cx="10" cy="10" r="7"/><path d="M3 10h14"/>' +
        '<path d="M10 3c2.4 2.1 2.4 11.9 0 14"/><path d="M10 3c-2.4 2.1-2.4 11.9 0 14"/>',
  // bicicleta: el catalogo es material deportivo
  categoria: '<circle cx="5.5" cy="13.5" r="3.5"/><circle cx="14.5" cy="13.5" r="3.5"/>' +
             '<path d="M5.5 13.5 9 7h4.5l1 6.5"/><path d="M8 7h3.5"/>',
  // ramificacion: por donde entra la reserva
  canal: '<circle cx="4.5" cy="10" r="2"/><circle cx="15.5" cy="5" r="2"/>' +
         '<circle cx="15.5" cy="15" r="2"/><path d="M6.5 10h3l4-4"/><path d="M9.5 10l4 4"/>',
  // tarjeta de socio
  membresia: '<rect x="2.5" y="5" width="15" height="10" rx="2"/><path d="M2.5 8.5h15"/>' +
             '<path d="M6 12h3.5"/>',
  // porcion de un total
  segmento: '<circle cx="10" cy="10" r="7"/><path d="M10 10V3"/><path d="M10 10l6.1 3.4"/>',
};
const icon = k => '<svg class="ficon" viewBox="0 0 20 20" width="14" height="14" fill="none" ' +
  'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ' +
  'aria-hidden="true" focusable="false">' + ICON[k] + "</svg>";

/* --------------------------------------------------------------------------
   Tarjetas
   -------------------------------------------------------------------------- */
function card(cls, title, question, tag) {
  const el = document.createElement("section");
  el.className = "card " + cls;
  // El titulo y su pregunta comparten linea y envuelven solos en panel estrecho.
  // El conmutador grafico/tabla sale del flujo (posicionado sobre la tarjeta),
  // asi la linea de titulo dispone del ancho entero.
  el.innerHTML = '<div class="head"><h3></h3><span class="q"></span></div>' +
    '<button class="tbtn" type="button">Tabla</button>' +
    '<div class="chart"></div><div class="tablewrap hidden"></div>';
  el.querySelector("h3").textContent = title;
  if (tag) {
    const s = document.createElement("span");
    s.className = "tag"; s.textContent = tag;
    el.querySelector("h3").after(s);
  }
  const q = el.querySelector(".q");
  if (question) q.textContent = question; else q.remove();
  const chart = el.querySelector(".chart"), tw = el.querySelector(".tablewrap");
  const btn = el.querySelector(".tbtn");
  btn.addEventListener("click", () => {
    const chartVisible = tw.classList.toggle("hidden");
    chart.classList.toggle("hidden", !chartVisible);
    btn.classList.toggle("on", !chartVisible);
    btn.textContent = chartVisible ? "Tabla" : "Gráfico";
  });
  el._chart = chart; el._table = tw;
  return el;
}
function setTable(el, headers, rows) {
  el._table.innerHTML = "<table class='dt'><thead><tr>" +
    headers.map(h => "<th>" + h + "</th>").join("") + "</tr></thead><tbody>" +
    rows.map(r => "<tr>" + r.map(c => "<td>" + c + "</td>").join("") + "</tr>").join("") +
    "</tbody></table>";
}
function tableOnly(el, headers, rows) {
  el._chart.remove();
  el._table.classList.remove("hidden");
  const b = el.querySelector(".tbtn"); if (b) b.remove();
  setTable(el, headers, rows);
}
function insight(el, html) {
  const d = document.createElement("div");
  d.className = "insight"; d.innerHTML = html;
  el.appendChild(d);
}
function note(el, text) {
  const d = document.createElement("div");
  d.className = "note"; d.textContent = text;
  el.appendChild(d);
}
function legend(el, entries) {
  const d = document.createElement("div");
  d.className = "legend";
  d.innerHTML = entries.map(e => e.line
    ? '<span><span class="ln" style="background:' + (e.dash ? "none;border-top:2px dashed " + e.color : e.color) + '"></span>' + e.name + "</span>"
    : '<span><i style="background:' + e.color + '"></i>' + e.name + "</span>").join("");
  el._chart.parentNode.insertBefore(d, el._chart);
}
function scaleLegend(el, from, to, fn) {
  const d = document.createElement("div");
  d.className = "scale";
  const stops = (fn === diverging
    ? [diverging(-1), diverging(0), diverging(1)]
    : rampArr()).join(",");
  d.innerHTML = "<span>" + from + '</span><span class="ramp" style="background:linear-gradient(90deg,' +
    stops + ')"></span><span>' + to + "</span>";
  el.appendChild(d);
}
/* Controles de vista de una tarjeta (nivel geografico, metrica...). Guardan su
   valor en un objeto persistente del modulo, no en el DOM: `render()` recrea las
   tarjetas enteras en cada filtro y el estado tiene que sobrevivir a eso.
   `groups` = [{ label, store, key, options: [{ id, label }] }]; `onChange` recibe
   el control para que la tarjeta se repinte sola sin re-agregar los 77k hechos. */
function segmented(el, groups, onChange) {
  const row = document.createElement("div");
  row.className = "segrow";
  for (const g of groups) {
    const box = document.createElement("div");
    box.className = "seg";
    box.innerHTML = "<span>" + g.label + "</span><span class='opts'></span>";
    const opts = box.querySelector(".opts");
    for (const o of g.options) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = o.label;
      b.classList.toggle("on", g.store[g.key] === o.id);
      b.addEventListener("click", () => {
        if (g.store[g.key] === o.id) return;
        g.store[g.key] = o.id;
        opts.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
        onChange();
      });
      opts.appendChild(b);
    }
    row.appendChild(box);
  }
  el._chart.parentNode.insertBefore(row, el._chart);
}

function chips(el, items) {
  const d = document.createElement("div");
  d.className = "chips";
  d.innerHTML = items.map(c => '<div class="chip"><div class="k">' + c[0] +
    '</div><div class="v">' + c[1] + (c[2] ? " <small>" + c[2] + "</small>" : "") + "</div></div>").join("");
  el._chart.parentNode.insertBefore(d, el._chart);
}

/* --------------------------------------------------------------------------
   Filtros
   -------------------------------------------------------------------------- */
/* Un año que no esté aquí no se puede filtrar aunque haya datos suyos: al
   ampliar la ventana del generador hay que añadirlo. `2026` es parcial
   (enero-julio), así que comparar su total contra un año completo engaña. */
const PERIODS = [
  { id: "all", label: "Todo el histórico" },
  { id: "last12", label: "Últimos 12 meses" },
  { id: "2026", label: "2026 (parcial)" },
  { id: "2025", label: "2025" },
  { id: "2024", label: "2024" },
  { id: "2023", label: "2023" },
  { id: "2022", label: "2022" },
];

function multiselect(hostId, label, options, store, iconKey) {
  const host = document.getElementById(hostId);
  host.innerHTML = '<button type="button">' + icon(iconKey) +
    '<span class="txt"></span><span class="caret">▾</span></button>' +
    '<div class="pop" hidden></div>';
  const btn = host.querySelector("button"), pop = host.querySelector(".pop");
  const txt = host.querySelector(".txt");
  txt.dataset.all = label + ": todos";
  pop.innerHTML = '<div class="mini" data-act="clear">Quitar filtro (todos)</div><div class="sep"></div>' +
    options.map((o, i) => '<label><input type="checkbox" value="' + i + '"><span>' + o + "</span></label>").join("");
  function sync() {
    const n = store.size;
    txt.textContent = n === 0 ? txt.dataset.all
      : n === 1 ? label + ": " + options[[...store][0]]
      : label + ": " + n + " sel.";
    btn.classList.toggle("on", n > 0);
  }
  pop.addEventListener("change", e => {
    const v = +e.target.value;
    if (e.target.checked) store.add(v); else store.delete(v);
    if (store.size === options.length) {
      store.clear();
      pop.querySelectorAll("input").forEach(i => { i.checked = false; });
    }
    sync(); render();
  });
  pop.addEventListener("click", e => {
    e.stopPropagation();
    if (e.target.dataset.act !== "clear") return;
    store.clear();
    pop.querySelectorAll("input").forEach(i => { i.checked = false; });
    sync(); render();
  });
  btn.addEventListener("click", e => {
    e.stopPropagation();
    document.querySelectorAll(".ms .pop").forEach(p => { if (p !== pop) p.hidden = true; });
    pop.hidden = !pop.hidden;
  });
  addEventListener("click", () => { pop.hidden = true; });
  host._sync = sync;
  sync();
}

function buildChrome() {
  const sel = document.getElementById("f-period");
  sel.innerHTML = PERIODS.map(p => '<option value="' + p.id + '">' + p.label + "</option>").join("");
  sel.addEventListener("change", () => { state.period = sel.value; render(); });

  document.getElementById("f-period-icon").innerHTML = icon("periodo");

  multiselect("f-country", "País", D.countries, state.country, "pais");
  multiselect("f-cat", "Categoría", D.categories, state.cat, "categoria");
  multiselect("f-channel", "Canal", D.channel_labels, state.channel, "canal");
  multiselect("f-member", "Membresía", D.members, state.member, "membresia");
  multiselect("f-segment", "Segmento", D.segments, state.segment, "segmento");

  document.getElementById("f-reset").addEventListener("click", () => {
    state.period = "all"; sel.value = "all";
    [state.country, state.cat, state.channel, state.member, state.segment].forEach(s => s.clear());
    document.querySelectorAll(".ms input").forEach(i => { i.checked = false; });
    document.querySelectorAll(".ms").forEach(m => m._sync && m._sync());
    render();
  });

  /* Una sola fila de pestanas, en el orden del array: primero las seis paginas
     de negocio y al final las dos de metodo (calidad del dato y estadistica),
     separadas por una linea fina. El indice que se guarda en `state.page` es el
     del array PAGES: `render()` resuelve por PAGES[state.page]. */
  const nav = document.getElementById("pages");
  const panels = document.getElementById("panels");
  PAGES.forEach((p, i) => {
    if (i > 0 && p.group !== PAGES[i - 1].group) {
      const sep = document.createElement("span");
      sep.className = "pdiv";
      sep.setAttribute("role", "presentation");
      nav.appendChild(sep);
    }
    const b = document.createElement("button");
    b.type = "button"; b.textContent = p.label; b.setAttribute("role", "tab");
    b.setAttribute("id", "tab-" + p.id);
    b.setAttribute("aria-controls", "panels");
    b.setAttribute("aria-selected", i === 0);
    b.addEventListener("click", () => {
      state.page = i;
      nav.querySelectorAll("button").forEach(x => x.setAttribute("aria-selected", x === b));
      panels.setAttribute("aria-labelledby", "tab-" + p.id);
      render();
      scrollTo({ top: 0, behavior: "smooth" });
    });
    nav.appendChild(b);
  });
  panels.setAttribute("aria-labelledby", "tab-" + PAGES[0].id);

  document.getElementById("theme-toggle").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = cur === "dark" ? "light" : cur === "light" ? "dark"
      : (matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark");
    render();
  });

  document.getElementById("badge-rows").textContent =
    nf(DATA.meta.n_rows) + " alquileres · " + DATA.meta.first_date + " → " + DATA.meta.last_date;
  document.getElementById("badge-trust").textContent =
    "Data Trust Score " + nf(DATA.quality.score, 1) + "/100";
  document.getElementById("footer-meta").textContent =
    "Generado el " + DATA.meta.generated + " · " + nf(DATA.quality.n_raw) + " filas crudas → " +
    nf(DATA.quality.n_clean) + " tras deduplicar · " + P.id.length + " productos · " +
    S.id.length + " tiendas · " + D.countries.length + " países.";

  addEventListener("resize", debounce(render, 200));
}

/* --------------------------------------------------------------------------
   Ciclo de render
   -------------------------------------------------------------------------- */
let A, PREV, MASK, M0, M1, PDAYS;

function render() {
  [M0, M1] = monthRange(state.period);
  MASK = buildMask(M0, M1);
  A = aggregate(MASK);
  PDAYS = periodDays(M0, M1);
  const len = M1 - M0 + 1;
  PREV = (M0 - len >= 0) ? aggregate(buildMask(M0 - len, M0 - 1)) : null;

  document.getElementById("f-count").innerHTML =
    "<b>" + nf(A.total.n[0]) + "</b> alquileres · <b>" + nf(A.total.comp[0]) + "</b> completados · <b>" +
    eur(A.total.rev[0]) + "</b>";
  document.getElementById("pagehead").textContent = PAGES[state.page].intro;

  const panels = document.getElementById("panels");
  panels.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "grid";
  panels.appendChild(grid);

  if (!A.total.n[0]) {
    const empty = card("", "Sin datos en la selección");
    empty._chart.innerHTML = '<p style="color:var(--ink-2);margin:6px 0 2px">Ninguna combinación de ' +
      'filtros devuelve alquileres. Quita algún filtro o pulsa <b>Limpiar</b>.</p>';
    empty.querySelector(".tbtn").remove();
    grid.appendChild(empty);
    return;
  }
  PAGES[state.page].render(grid);
}

function delta(cur, prev, invert) {
  if (prev == null || !isFinite(prev) || prev === 0 || !isFinite(cur)) return "sin periodo anterior";
  const d = (cur - prev) / Math.abs(prev);
  const good = invert ? d < 0 : d > 0;
  return '<span class="' + (good ? "up" : "down") + '">' + (d > 0 ? "▲" : "▼") + " " +
    nf(Math.abs(d) * 100, 1) + " %</span> vs anterior";
}

// Ocupacion agregada: dias alquilados / (unidades x dias del periodo).
function occupancy(agg) {
  let days = 0, capacity = 0;
  for (let i = 0; i < P.id.length; i++) {
    if (!agg.product.n[i]) continue;
    days += agg.product.days[i];
    capacity += (P.units[i] || 0) * PDAYS;
  }
  return capacity ? days / capacity : NaN;
}

function kpiRow(host) {
  const t = A.total, p = PREV ? PREV.total : null;
  const occ = occupancy(A), occP = PREV ? occupancy(PREV) : null;
  const tiles = [
    ["Ingresos", eur(t.rev[0]), delta(t.rev[0], p && p.rev[0])],
    ["Ticket medio", eur(kpi.ticket(t, 0), 2), delta(kpi.ticket(t, 0), p && kpi.ticket(p, 0))],
    ["Alquileres", nf(t.n[0]), delta(t.n[0], p && p.n[0])],
    ["Ocupación", pct(occ), delta(occ, occP)],
    ["Cancelación", pct(kpi.cancel(t, 0), 2), delta(kpi.cancel(t, 0), p && kpi.cancel(p, 0), true)],
    ["Averías", pct(kpi.damage(t, 0), 2), delta(kpi.damage(t, 0), p && kpi.damage(p, 0), true)],
    ["Review media", nf(kpi.review(t, 0), 2) + " / 5", delta(kpi.review(t, 0), p && kpi.review(p, 0))],
  ];
  const wrap = document.createElement("div");
  wrap.className = "kpis";
  wrap.style.gridColumn = "span 12";
  // Siete tarjetas iguales. La unidad se separa de la cifra para que pese medio
  // paso menos: lo que se compara de un vistazo es el numero, no el simbolo.
  wrap.innerHTML = tiles.map(([k, v, d]) => {
    const [num, unit] = splitUnit(v);
    return '<div class="kpi"><div class="k">' + k + '</div><div class="v">' + num +
      (unit ? '<span class="u">' + unit + "</span>" : "") +
      '</div><div class="d">' + d + "</div></div>";
  }).join("");
  host.appendChild(wrap);
}

/* Metricas por producto sobre el corte activo. */
function productMetrics() {
  const out = [];
  for (let i = 0; i < P.id.length; i++) {
    const n = A.product.n[i];
    if (!n) continue;
    const units = P.units[i] || 0;
    out.push({
      i, id: P.id[i], name: P.name[i], cat: P.cat[i], age: P.age[i],
      purchase: P.purchase[i], units,
      rentals: n, completed: A.product.comp[i], revenue: A.product.rev[i],
      occupancy: units ? A.product.days[i] / (units * PDAYS) : NaN,
      utilization: units ? A.product.comp[i] / units : NaN,
      revPerUnit: units ? A.product.rev[i] / units : NaN,
      margin: kpi.margin(A.product, i), maintRatio: kpi.maintR(A.product, i),
      damage: kpi.damage(A.product, i), cancel: kpi.cancel(A.product, i),
      review: kpi.review(A.product, i),
    });
  }
  const occs = out.map(p => p.occupancy).filter(isFinite).sort((a, b) => a - b);
  const q = t => occs.length ? occs[Math.min(occs.length - 1, Math.floor(t * (occs.length - 1)))] : NaN;
  const q1 = q(.25), q3 = q(.75);
  out.forEach(p => {
    p.rotation = p.occupancy <= q1 ? "Infrautilizado" : p.occupancy >= q3 ? "Saturado" : "Normal";
  });
  return out;
}

/* Metricas por tienda sobre el corte activo. */
function storeMetrics() {
  const rows = [];
  for (let i = 0; i < S.id.length; i++) {
    const b = i + 1;
    if (!A.store.n[b]) continue;
    rows.push({
      b, name: S.name[i], city: S.city[i],
      country: S.country[i] >= 0 ? D.countries[S.country[i]] : "—",
      size: S.size[i] >= 0 ? D.sizes[S.size[i]] : "—",
      visitors: S.visitors[i], rev: A.store.rev[b], n: A.store.n[b],
      revPerVisitor: S.visitors[i] ? A.store.rev[b] / S.visitors[i] : NaN,
      cancel: kpi.cancel(A.store, b), damage: kpi.damage(A.store, b),
      late: kpi.late(A.store, b), review: kpi.review(A.store, b),
    });
  }
  return rows;
}

/* Recolecta valores crudos del corte para cajas y medianas (pasada extra). */
function collect(bucketOf, valueOf, nBuckets, filter) {
  const buckets = Array.from({ length: nBuckets }, () => []);
  for (let i = 0; i < N; i++) {
    if (!MASK[i]) continue;
    if (filter && !filter(i)) continue;
    const b = bucketOf(i);
    if (b < 0 || b >= nBuckets) continue;
    const v = valueOf(i);
    if (v == null || !isFinite(v)) continue;
    buckets[b].push(v);
  }
  return buckets;
}
const notCancelled = i => !(F.flags[i] & 1);
const hasPrice = i => !((F.flags[i] >> 3) & 1);
const hasDays = i => !((F.flags[i] >> 4) & 1);

async function boot() {
  await decodeFacts(DATA);
  document.getElementById("boot").classList.add("hidden");
  document.getElementById("ui").classList.remove("hidden");
  buildChrome();
  render();
}
