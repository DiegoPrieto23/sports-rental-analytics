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

/* Iconos de las paginas. Mismo lienzo de 20x20, mismo trazo de 1,5 y los mismos
   extremos redondeados que los de la barra de filtros: son la misma familia. La
   metafora sale del contenido de cada pagina, no de un repertorio generico, y
   cada una tiene que distinguirse de las otras ocho a 16 px. */
const PAGE_ICON = {
  // barras: las cifras del negocio
  resumen: '<path d="M3 16.5h14"/><path d="M6 16.5v-4.5"/><path d="M10 16.5v-9"/>' +
           '<path d="M14 16.5v-6.5"/>',
  // onda sobre la linea del ano: la demanda sube y baja con la temporada
  demanda: '<path d="M2.5 16.8h15"/><path d="M3 11c2-5 4.4-5 6.4 0s4.4 5 6.4 0"/>',
  // caja de material
  producto: '<path d="M10 2.9 3.2 6.2v7.6L10 17.1l6.8-3.3V6.2z"/><path d="M3.2 6.2 10 9.5l6.8-3.3"/>' +
            '<path d="M10 9.5v7.6"/>',
  // escaparate con toldo
  tiendas: '<path d="M3.6 8.6h12.8v8.4H3.6z"/><path d="M2.6 8.6 4.4 3.9h11.2l1.8 4.7"/>' +
           '<path d="M8.1 17v-4.6h3.8V17"/>',
  // dos personas
  clientes: '<circle cx="7.6" cy="7" r="2.6"/><path d="M3.2 16.6c0-2.6 2-4.3 4.4-4.3s4.4 1.7 4.4 4.3"/>' +
            '<path d="M13.3 5.1a2.6 2.6 0 0 1 0 5.2"/><path d="M14 12.5c1.9.5 2.9 1.9 2.9 4.1"/>',
  // etiqueta de precio
  pricing: '<path d="M10.3 2.9h6.1c.4 0 .7.3.7.7v6.1c0 .2-.1.4-.2.5l-6.7 6.7a.7.7 0 0 1-1 0L2.8 10.5' +
           'a.7.7 0 0 1 0-1l6.7-6.7c.1-.1.3-.2.5-.2z"/><circle cx="13.5" cy="6.4" r="1.2"/>',
  // escudo con marca de verificacion
  calidad: '<path d="M10 2.7 4.2 5v4.9c0 3.4 2.4 6.2 5.8 7.3 3.4-1.1 5.8-3.9 5.8-7.3V5z"/>' +
           '<path d="M7.5 9.9 9.4 11.8l3.4-3.7"/>',
  // nube de puntos con su recta
  estadistica: '<path d="M3.2 3v14h14"/><path d="M5.6 14.6 16 5.4"/><circle cx="7.2" cy="12.7" r="1.1"/>' +
               '<circle cx="10.6" cy="10.5" r="1.1"/><circle cx="13.8" cy="7.3" r="1.1"/>',
  // dos tablas encadenadas: el dato pasando de una capa a la siguiente
  modelo: '<rect x="2.4" y="6.5" width="5.2" height="7" rx="1.2"/>' +
          '<rect x="12.4" y="6.5" width="5.2" height="7" rx="1.2"/><path d="M7.6 10h4"/>' +
          '<path d="M10.2 8.4 11.9 10l-1.7 1.6"/>',
};
const pageIcon = (k, size) => '<svg class="pico" viewBox="0 0 20 20" width="' + (size || 16) +
  '" height="' + (size || 16) + '" fill="none" stroke="currentColor" stroke-width="1.5" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
  (PAGE_ICON[k] || "") + "</svg>";

/* Rotulo de cada bloque del menu. La separacion entre paginas de negocio y de
   metodo antes era una linea fina sin nombre; en vertical hay sitio para
   decirlo con palabras. */
const GROUP_LABEL = { negocio: "Negocio", metodo: "Método" };

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
/* La nota admite marcado, igual que `insight()`. Iba por textContent y cualquier
   <b> se veia como texto literal en la pagina. */
function note(el, html) {
  const d = document.createElement("div");
  d.className = "note"; d.innerHTML = html;
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

  /* Menu lateral, en el orden del array: primero las seis paginas de negocio y
     al final las tres de metodo, cada bloque bajo su rotulo. El indice que se
     guarda en `state.page` es el del array PAGES: `render()` resuelve por
     PAGES[state.page]. */
  const nav = document.getElementById("pages");
  const panels = document.getElementById("panels");
  PAGES.forEach((p, i) => {
    if (i === 0 || p.group !== PAGES[i - 1].group) {
      const h = document.createElement("div");
      h.className = "glabel";
      h.setAttribute("role", "presentation");
      h.textContent = GROUP_LABEL[p.group] || p.group;
      nav.appendChild(h);
    }
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = pageIcon(p.id) + "<span>" + p.label + "</span>";
    b.setAttribute("role", "tab");
    b.setAttribute("id", "tab-" + p.id);
    b.setAttribute("aria-controls", "panels");
    b.setAttribute("aria-selected", i === 0);
    b.addEventListener("click", () => goToPage(p.id));
    nav.appendChild(b);
  });
  panels.setAttribute("aria-labelledby", "tab-" + PAGES[0].id);

  document.getElementById("theme-toggle").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = cur === "dark" ? "light" : cur === "light" ? "dark"
      : (matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark");
    render();
  });

  /* Pie del riel: la identidad del dato que se esta mirando. Estaba en insignias
     de la cabecera, que se repetian en todas las paginas y competian por el
     ancho con los filtros. Aqui se dice una vez y se queda. */
  document.getElementById("rail-meta").innerHTML =
    "<div><b>" + nf(DATA.meta.n_rows) + "</b> alquileres sintéticos</div>" +
    "<div>" + DATA.meta.first_date + " → " + DATA.meta.last_date +
    " · <b>" + nf(D.months.length) + "</b> meses</div>" +
    "<div>Data Trust Score <b>" + nf(DATA.quality.score, 1) + "</b>/100</div>" +
    '<div class="chain">raw → staging → intermediate → marts</div>';
  // El pie del informe repite las cifras del riel porque este se oculta en
  // pantalla estrecha, y ahi es el unico sitio donde quedan.
  document.getElementById("footer-meta").textContent =
    "Generado el " + DATA.meta.generated + " · " + nf(DATA.quality.n_raw) + " filas crudas → " +
    nf(DATA.quality.n_clean) + " tras deduplicar · " + P.id.length + " productos · " +
    S.id.length + " tiendas · " + D.countries.length + " países · Data Trust Score " +
    nf(DATA.quality.score, 1) + "/100.";

  addEventListener("resize", debounce(render, 200));
}

/* Navegar a una pagina por su `id` del array PAGES. Vive fuera de `buildChrome`
   porque ya no lo usa solo el menu lateral: cada recomendacion de la portada
   enlaza a la pagina donde se desarrolla, y ese bloque se construye en otra
   pieza que no alcanza el cierre del manejador del menu. Mantiene sincronizados
   los tres sitios donde vive el estado de pestana: `state.page`, el
   `aria-selected` de los botones y el `aria-labelledby` del panel. */
function goToPage(id) {
  const i = PAGES.findIndex(p => p.id === id);
  if (i < 0 || i === state.page) return;
  state.page = i;
  const nav = document.getElementById("pages");
  const btn = nav.querySelector("#tab-" + PAGES[i].id);
  nav.querySelectorAll("button").forEach(x => x.setAttribute("aria-selected", x === btn));
  document.getElementById("panels").setAttribute("aria-labelledby", "tab-" + PAGES[i].id);
  render();
  scrollTo({ top: 0, behavior: "smooth" });
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
  // Con el menu fuera de la columna de contenido, la pagina tiene que decir su
  // propio nombre: el icono repetido es lo que la ata a su entrada del menu.
  const page = PAGES[state.page];
  document.getElementById("pagehead").innerHTML =
    '<div class="eyebrow">' + (GROUP_LABEL[page.group] || page.group) + "</div><h2>" +
    pageIcon(page.id, 19) + "<span>" + page.label + "</span></h2><p>" + page.intro + "</p>";

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

/* Ocupacion por categoria sobre el corte activo, con el mismo denominador que
   `occupancy()`: dias alquilados / (unidades del catalogo con actividad x dias
   del periodo). Filtrando por pais sigue siendo una cota inferior, porque las
   unidades de inventario son globales por referencia y no estan repartidas por
   tienda; la tarjeta que la usa lo dice. */
function occupancyByCategory() {
  const out = D.categories.map((c, i) => ({ c, i, days: 0, cap: 0, units: 0, refs: 0 }));
  for (let j = 0; j < P.id.length; j++) {
    if (!A.product.n[j]) continue;
    const k = P.cat[j];
    if (k < 0) continue;
    const d = out[k];
    d.days += A.product.days[j];
    d.cap += (P.units[j] || 0) * PDAYS;
    d.units += P.units[j] || 0;
    d.refs++;
  }
  return out.filter(d => d.cap > 0).map(d => Object.assign(d, { occ: d.days / d.cap }));
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

/* Ingresos de una ventana de meses distinta a la seleccionada, con los mismos
   filtros aplicados. La portada necesita tres: el mismo mes del ano anterior y
   las dos ventanas del puente de crecimiento.

   No usa `aggregate()` a proposito. Aquel llena quince medidas por cada uno de
   los doce cortes y cuesta lo que cuesta; aqui solo hacen falta los ingresos por
   mes y por categoria, y con tres ventanas extra la diferencia se nota en el
   tiempo de pintado de la primera pantalla que ve el usuario.

   La definicion de ingreso es la misma que en `aggregate()`: solo cuenta el
   alquiler completado, y el que llega sin precio suma cero. */
function revSlice(m0, m1) {
  const out = { total: 0, month: new Float64Array(D.months.length),
                cat: new Float64Array(D.categories.length) };
  if (m1 < m0 || m1 < 0) return out;
  const mask = buildMask(Math.max(0, m0), m1);
  for (let i = 0; i < N; i++) {
    if (!mask[i]) continue;
    const fl = F.flags[i];
    if (fl & 1) continue;                       // cancelado: no genera ingreso
    if ((fl >> 3) & 1) continue;                // sin precio: no suma
    const rev = F.price[i] / 100;
    out.total += rev;
    out.month[F.month[i]] += rev;
    const k = rowCat[i];
    if (k >= 0) out.cat[k] += rev;
  }
  return out;
}

/* Roll-up por ciudad a partir de las tiendas. El hecho ya trae `store_id`, asi
   que ciudad y pais salen de la dimension sin tocar el encoding binario. Lo usan
   el mapa del resumen y el de la pagina de tiendas: una sola definicion. */
function cityRollup(rows) {
  const cities = {};
  rows.forEach(d => {
    const k = d.city + "|" + d.country;
    if (!cities[k]) cities[k] = { city: d.city, country: d.country, rev: 0, n: 0,
                                  stores: 0, psum: 0, pn: 0 };
    const c = cities[k];
    c.rev += d.rev; c.n += d.n; c.stores++;
    c.psum += A.store.psum[d.b]; c.pn += A.store.pn[d.b];
  });
  return Object.values(cities).sort((a, b) => b.rev - a.rev);
}

/* Grupos de pais en el formato que espera geoMap(). Solo entran los paises con
   al menos una plaza con coordenada: el resto no es dibujable. */
function geoCountryGroups(cityList, byRevM) {
  const val = d => byRevM ? d.rev : d.n;
  return D.countries.map((name, ci) => {
    const own = cityList.filter(d => d.country === name && CITY_LL[d.city]);
    return {
      name, value: own.reduce((a, b) => a + val(b), 0),
      tipRows: () => [["Ingresos", eur(A.country.rev[ci + 1])],
                      ["Alquileres", nf(A.country.n[ci + 1])],
                      ["Ticket medio", eur(kpi.ticket(A.country, ci + 1), 2)],
                      ["Ciudades", nf(own.length)],
                      ["Tiendas", nf(own.reduce((a, b) => a + b.stores, 0))]],
      cities: own.map(d => ({
        name: d.city, lat: CITY_LL[d.city][0], lon: CITY_LL[d.city][1], value: val(d),
        tipRows: () => [["País", d.country], ["Ingresos", eur(d.rev)],
                        ["Alquileres", nf(d.n)], ["Tiendas", nf(d.stores)],
                        ["Ticket medio", eur(d.pn ? d.psum / d.pn : NaN, 2)]],
      })),
    };
  }).filter(g => g.cities.length);
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
