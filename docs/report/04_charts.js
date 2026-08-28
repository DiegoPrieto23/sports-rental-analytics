/* ===========================================================================
   Libreria de graficos en SVG. Sin dependencias.
   Reglas que se respetan en todas las formas: un solo eje por grafico, color
   por entidad y nunca por rango, marcas finas, rejilla en hairline, etiqueta
   directa selectiva y tooltip en todo lo que tenga marcas.
   =========================================================================== */

const NS = "http://www.w3.org/2000/svg";
function mk(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const SERIES = i => cssVar("--s" + (i + 1));

/* Espejo numerico de los tokens --t-micro / --t-nano de 01_head.html. El resto
   del texto del SVG hereda tamano desde la regla `.chart text`; estos dos son
   los unicos que hay que fijar por atributo. Deliberadamente NO se leen con
   cssVar(): el DOM falso de docs/test_render.js solo resuelve colores, y
   leerlos de ahi devolveria basura en el render headless. */
const FS_MICRO = 11;   // eje, etiqueta de entidad, valor junto a la marca
const FS_NANO  = 10;   // etiqueta dentro de la marca: heatmap, treemap, mapa

/* El tamano de fuente va SIEMPRE por estilo en linea, nunca por atributo de
   presentacion: la regla `.chart text { font-size: var(--t-micro) }` de
   01_head.html gana a cualquier atributo de presentacion, asi que fijar el
   tamano por atributo lo dejaba renderizando a 11 px sin avisar. El estilo en
   linea, en cambio, si gana a la regla. */
function fs(el, px) { el.style.fontSize = px + "px"; return el; }

/* Color de relleno del texto, tambien por estilo en linea. Se reserva a las
   etiquetas que van encima de una marca de color, donde el contraste lo decide
   `readable()` y no puede quedar a merced de una regla de hoja de estilos. */
function paint(el, color) { el.style.fill = color; return el; }

const RAMP = ["#cde2fb","#b7d3f6","#9ec5f4","#86b6ef","#6da7ec","#5598e7","#3987e5",
              "#2a78d6","#256abf","#1c5cab","#184f95","#104281","#0d366b"];
const isDark = () => document.documentElement.dataset.theme === "dark" ||
  (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
/* Misma direccion en ambos temas: a mas valor, azul mas oscuro. La convencion
   habitual invierte la rampa en oscuro para que "mas" sea "mas luminoso", pero
   aqui se prioriza que el significado del color no cambie al cambiar de tema. */
const rampArr = () => RAMP;
function ramp(t) {
  if (!isFinite(t)) return cssVar("--grid");
  const arr = rampArr();
  return arr[Math.max(0, Math.min(arr.length - 1, Math.round(t * (arr.length - 1))))];
}
// Divergente azul <-> rojo con gris neutro en el centro: los polos deben leerse
// como opuestos y el punto medio como "nada".
function diverging(t) {
  if (!isFinite(t)) return cssVar("--grid");
  const mid = cssVar("--div-mid");
  const pole = t < 0 ? (isDark() ? "#1f9fdb" : "#0082C3") : (isDark() ? "#e66767" : "#d03b3b");
  return mixHex(mid, pole, Math.min(1, Math.abs(t)));
}
function mixHex(a, b, t) {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
function relLum(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4);
  return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]);
}
/* Tinta o blanco: gana el que MAS contraste da sobre ese fondo. El criterio
   anterior era un umbral de luminancia fijo en .45, y eso elegia blanco sobre
   los azules medios de la rampa: blanco sobre #1f9fdb da 2,7:1 cuando la tinta
   da 6,9:1. Comparar los dos ratios pone el cruce donde toca (L = 0,179) y
   arregla de una vez las etiquetas del treemap, del heatmap y del mapa. */
function readable(hex) {
  const L = relLum(hex);
  return (L + .05) / .05 >= 1.05 / (L + .05) ? "#0b0b0b" : "#ffffff";
}

const tip = document.getElementById("tip");
function showTip(ev, title, rows) {
  tip.innerHTML = '<div class="t">' + title + "</div>" +
    (rows || []).map(r => '<div class="r"><span>' + r[0] + "</span><b>" + r[1] + "</b></div>").join("");
  tip.style.opacity = 1;
  const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + w > innerWidth - 8) x = ev.clientX - w - pad;
  if (y + h > innerHeight - 8) y = ev.clientY - h - pad;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
const hideTip = () => { tip.style.opacity = 0; };
function hover(el, title, rows) {
  el.addEventListener("mousemove", ev => showTip(ev, title, typeof rows === "function" ? rows() : rows));
  el.addEventListener("mouseleave", hideTip);
}
function halo(t) {
  t.setAttribute("stroke", cssVar("--surface"));
  t.setAttribute("stroke-width", 3);
  t.setAttribute("paint-order", "stroke");
}

function niceTicks(max, count) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = ([1, 2, 2.5, 5, 10].find(s => s * mag >= raw) || 10) * mag;
  const out = [];
  for (let v = 0; v <= max * 1.0001; v += step) out.push(+v.toFixed(10));
  if (out[out.length - 1] < max) out.push(+(out[out.length - 1] + step).toFixed(10));
  return out;
}
/* Lienzo que no baja de un ancho minimo. Los graficos de datos se reflujan al
   ancho que haya, pero un diagrama de cajas y flechas no: por debajo de cierto
   ancho las etiquetas se pisan. En vez de encoger el SVG hasta que el texto sea
   ilegible, se fija el ancho de diseno y la tarjeta desplaza en horizontal.
   Es la misma regla que ya siguen las tablas anchas del informe. */
function wideFrame(host, h, minW) {
  host.innerHTML = "";
  host.style.overflowX = "auto";
  const w = Math.max(minW, host.clientWidth || minW);
  const svg = mk("svg", { viewBox: "0 0 " + w + " " + h, height: h, role: "img" }, host);
  svg.style.minWidth = minW + "px";
  return { svg, w, h };
}

function frame(host, h, pad) {
  host.innerHTML = "";
  const w = Math.max(280, host.clientWidth || 600);
  const svg = mk("svg", { viewBox: `0 0 ${w} ${h}`, height: h, role: "img" }, host);
  return { svg, w, h, pl: pad[3], pr: w - pad[1], pt: pad[0], pb: h - pad[2] };
}

/* ---- lineas: varias series, un solo eje ---- */
function lineChart(host, spec) {
  const { svg, w, pl, pr, pt, pb } = frame(host, spec.height || 240, [14, 18, 30, 60]);
  const xs = spec.x, series = spec.series;
  const ok = v => v != null && isFinite(v);
  const max = Math.max(...series.flatMap(s => s.values.filter(ok)), 0);
  const ticks = niceTicks(max, 4), top = ticks[ticks.length - 1];
  const X = i => pl + (pr - pl) * (xs.length === 1 ? .5 : i / (xs.length - 1));
  const Y = v => pb - (pb - pt) * (v / top);

  ticks.forEach(t => {
    mk("line", { x1: pl, x2: pr, y1: Y(t), y2: Y(t), stroke: cssVar("--grid") }, svg);
    mk("text", { x: pl - 8, y: Y(t) + 4, "text-anchor": "end" }, svg).textContent = spec.fmtY(t);
  });
  const step = Math.max(1, Math.ceil(xs.length / Math.max(4, Math.floor(w / 80))));
  xs.forEach((x, i) => {
    if (i % step) return;
    mk("text", { x: X(i), y: pb + 18, "text-anchor": "middle" }, svg).textContent = x;
  });
  /* Los huecos se dibujan como huecos. Una serie de comparacion interanual no
     tiene dato en los primeros 12 meses de la ventana, y unirlos con una recta
     inventaria una tendencia que no existe: cada tramo continuo es un subpath. */
  const runs = vals => {
    const out = [];
    let cur = null;
    vals.forEach((v, i) => {
      if (v == null || !isFinite(v)) { cur = null; return; }
      if (!cur) { cur = []; out.push(cur); }
      cur.push(i);
    });
    return out;
  };
  series.forEach(s => {
    const segs = runs(s.values);
    if (s.area) {
      // El area va debajo de la linea y solo bajo la serie principal: rellena la
      // magnitud sin competir con la serie de comparacion, que queda como trazo.
      segs.forEach(seg => {
        if (seg.length < 2) return;
        const top = seg.map((i, k) => (k ? "L" : "M") + X(i) + " " + Y(s.values[i])).join(" ");
        mk("path", { d: top + " L" + X(seg[seg.length - 1]) + " " + pb + " L" + X(seg[0]) + " " + pb + " Z",
                     fill: s.color, "fill-opacity": .12, stroke: "none" }, svg);
      });
    }
    segs.forEach(seg => {
      if (seg.length === 1) {
        mk("circle", { cx: X(seg[0]), cy: Y(s.values[seg[0]]), r: 2.5, fill: s.color }, svg);
        return;
      }
      const d = seg.map((i, k) => (k ? "L" : "M") + X(i) + " " + Y(s.values[i])).join(" ");
      mk("path", { d, fill: "none", stroke: s.color, "stroke-width": s.width || 2,
                   "stroke-dasharray": s.dash || null, "stroke-linejoin": "round",
                   "stroke-linecap": "round" }, svg);
    });
  });
  const main = series[0];
  if (xs.length <= 32) main.values.forEach((v, i) => {
    if (v == null || !isFinite(v)) return;
    mk("circle", { cx: X(i), cy: Y(v), r: 3, fill: main.color,
                   stroke: cssVar("--surface"), "stroke-width": 2 }, svg);
  });
  (spec.marks || []).forEach(m => {
    mk("circle", { cx: X(m.i), cy: Y(m.v), r: 5.5, fill: cssVar("--bad"),
                   stroke: cssVar("--surface"), "stroke-width": 2 }, svg);
  });
  const lastI = main.values.length - 1;
  if (ok(main.values[lastI])) {
    const t = mk("text", { x: X(lastI) - 7, y: Math.max(pt + 10, Y(main.values[lastI]) - 9),
                           "text-anchor": "end", class: "val" }, svg);
    t.textContent = spec.fmtY(main.values[lastI]); halo(t);
  }
  const cross = mk("line", { y1: pt, y2: pb, stroke: cssVar("--axis"), opacity: 0 }, svg);
  const hit = mk("rect", { x: pl, y: pt, width: pr - pl, height: pb - pt, fill: "transparent" }, svg);
  hit.addEventListener("mousemove", ev => {
    const bb = svg.getBoundingClientRect();
    const rel = (ev.clientX - bb.left) * (w / bb.width);
    const i = Math.max(0, Math.min(xs.length - 1,
      Math.round((rel - pl) / ((pr - pl) / Math.max(1, xs.length - 1)))));
    cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("opacity", 1);
    showTip(ev, spec.xTitle ? spec.xTitle(i) : xs[i],
      series.map(s => [s.name, (spec.fmtTip || spec.fmtY)(s.values[i])])
        .concat(spec.extraTip ? spec.extraTip(i) : []));
  });
  hit.addEventListener("mouseleave", () => { cross.setAttribute("opacity", 0); hideTip(); });
}

/* ---- barras horizontales ---- */
function barsH(host, spec) {
  const items = spec.items, rowH = spec.rowH || 22, labelW = spec.labelW || 132;
  const { svg, pr, pt } = frame(host, items.length * rowH + 16, [8, spec.valueW || 62, 8, labelW]);
  const max = Math.max(...items.map(d => Math.abs(d.value)).filter(isFinite), 0) || 1;
  const color = spec.color || SERIES(0);
  const maxChars = Math.max(6, Math.floor((labelW - 12) / 6.4));
  items.forEach((d, i) => {
    const y = pt + i * rowH, bh = Math.min(13, rowH - 8);
    const wpx = isFinite(d.value) ? Math.max(1, (pr - labelW) * (Math.abs(d.value) / max)) : 0;
    const lab = mk("text", { x: labelW - 10, y: y + bh - 1, "text-anchor": "end", class: "lbl" }, svg);
    lab.textContent = d.label.length > maxChars ? d.label.slice(0, maxChars - 1) + "…" : d.label;
    mk("rect", { x: labelW, y, width: wpx, height: bh, rx: 0,
                 fill: d.muted ? cssVar("--neutral-mark") : (d.color || color) }, svg);
    mk("text", { x: labelW + wpx + 7, y: y + bh - 1, class: "val" }, svg).textContent = spec.fmt(d.value);
    hover(mk("rect", { x: 0, y: y - 3, width: pr, height: rowH, fill: "transparent" }, svg),
          d.label, d.rows || [[spec.measure || "Valor", spec.fmt(d.value)]]);
  });
}

/* ---- barras verticales ---- */
function barsV(host, spec) {
  const items = spec.items;
  const { svg, pl, pr, pt, pb } = frame(host, spec.height || 200, [16, 10, 46, 52]);
  const max = Math.max(...items.map(d => d.value).filter(isFinite), 0) || 1;
  const ticks = niceTicks(max, 3), top = ticks[ticks.length - 1];
  const Y = v => pb - (pb - pt) * (v / top);
  ticks.forEach(t => {
    mk("line", { x1: pl, x2: pr, y1: Y(t), y2: Y(t), stroke: cssVar("--grid") }, svg);
    mk("text", { x: pl - 8, y: Y(t) + 4, "text-anchor": "end" }, svg).textContent = spec.fmt(t);
  });
  const bw = (pr - pl) / items.length;
  const showLabels = items.length <= 14;
  items.forEach((d, i) => {
    const x = pl + i * bw + 2, bwi = Math.max(2, bw - 4);
    const v = isFinite(d.value) ? d.value : 0;
    mk("rect", { x, y: Y(v), width: bwi, height: Math.max(1, pb - Y(v)), rx: 0,
                 fill: d.muted ? cssVar("--neutral-mark") : (d.color || spec.color || SERIES(0)) }, svg);
    if (showLabels) {
      const t = mk("text", { x: x + bwi / 2, y: Y(v) - 6, "text-anchor": "middle", class: "val" }, svg);
      t.textContent = spec.fmt(v); halo(t);
    }
    const lt = mk("text", { x: x + bwi / 2, y: pb + 17, "text-anchor": "middle" }, svg);
    lt.textContent = d.label;
    if (bw < 46 && d.label.length > 6) lt.textContent = d.label.slice(0, 5) + "…";
    hover(mk("rect", { x, y: pt, width: bwi, height: pb - pt, fill: "transparent" }, svg),
          d.label, d.rows || [[spec.measure || "Valor", spec.fmt(d.value)]]);
  });
}

/* ---- barras apiladas horizontales (partes ordenadas) ---- */
function stackedBarsH(host, spec) {
  const items = spec.items, rowH = spec.rowH || 30, labelW = spec.labelW || 110;
  const { svg, pr, pt } = frame(host, items.length * rowH + 16, [8, 54, 8, labelW]);
  const width = pr - labelW;
  items.forEach((d, i) => {
    const y = pt + i * rowH, bh = Math.min(16, rowH - 10);
    const total = d.parts.reduce((a, b) => a + b, 0) || 1;
    mk("text", { x: labelW - 10, y: y + bh - 2, "text-anchor": "end", class: "lbl" }, svg)
      .textContent = d.label;
    let x = labelW;
    d.parts.forEach((v, j) => {
      const wpx = width * (v / total);
      if (wpx > 0) {
        mk("rect", { x, y, width: Math.max(0, wpx - 2), height: bh, rx: 0, fill: spec.colors[j] }, svg);
        if (wpx > 34) {
          const t = mk("text", { x: x + (wpx - 2) / 2, y: y + bh - 4, "text-anchor": "middle" }, svg);
          t.textContent = Math.round(100 * v / total) + " %";
          paint(t, readable(spec.colors[j]));
          fs(t, FS_NANO);
        }
        hover(mk("rect", { x, y, width: Math.max(0, wpx - 2), height: bh, fill: "transparent" }, svg),
              d.label + " · " + spec.partNames[j],
              [["Alquileres", nf(v)], ["Peso", pct(v / total, 1)]]);
      }
      x += wpx;
    });
    mk("text", { x: pr + 4, y: y + bh - 2, "text-anchor": "end", class: "val" }, svg)
      .textContent = spec.rightLabel ? spec.rightLabel(d) : "";
  });
}

/* ---- caja y bigotes (horizontal, un eje compartido) ---- */
function boxplot(host, spec) {
  const items = spec.items.filter(d => d.box);
  const rowH = spec.rowH || 30, labelW = spec.labelW || 110;
  const { svg, pl, pr, pt, pb } = frame(host, items.length * rowH + 40, [10, 16, 30, labelW]);
  const max = Math.max(...items.map(d => d.box.hi), 0) || 1;
  const ticks = niceTicks(max, 4), top = ticks[ticks.length - 1];
  const X = v => pl + (pr - pl) * (v / top);
  ticks.forEach(t => {
    mk("line", { x1: X(t), x2: X(t), y1: pt, y2: pb - 6, stroke: cssVar("--grid") }, svg);
    mk("text", { x: X(t), y: pb + 12, "text-anchor": "middle" }, svg).textContent = spec.fmt(t);
  });
  items.forEach((d, i) => {
    const y = pt + i * rowH, cy = y + rowH / 2 - 4, bh = Math.min(15, rowH - 12);
    const b = d.box;
    mk("text", { x: labelW - 10, y: cy + 4, "text-anchor": "end", class: "lbl" }, svg).textContent = d.label;
    mk("line", { x1: X(b.lo), x2: X(b.hi), y1: cy, y2: cy, stroke: cssVar("--axis") }, svg);
    [b.lo, b.hi].forEach(v => mk("line", { x1: X(v), x2: X(v), y1: cy - 5, y2: cy + 5,
                                           stroke: cssVar("--axis") }, svg));
    mk("rect", { x: X(b.q1), y: cy - bh / 2, width: Math.max(1, X(b.q3) - X(b.q1)), height: bh,
                 rx: 0, fill: spec.color || SERIES(0), "fill-opacity": .35,
                 stroke: spec.color || SERIES(0), "stroke-width": 1.5 }, svg);
    mk("line", { x1: X(b.med), x2: X(b.med), y1: cy - bh / 2, y2: cy + bh / 2,
                 stroke: cssVar("--surface"), "stroke-width": 2.5 }, svg);
    hover(mk("rect", { x: pl, y, width: pr - pl, height: rowH, fill: "transparent" }, svg), d.label, [
      ["Mediana", spec.fmt(b.med)], ["Q1 – Q3", spec.fmt(b.q1) + " – " + spec.fmt(b.q3)],
      ["Bigotes (1,5·IQR)", spec.fmt(b.lo) + " – " + spec.fmt(b.hi)],
      ["Outliers", nf(b.nOut) + " (" + pct(b.nOut / b.n, 1) + ")"], ["Observaciones", nf(b.n)],
    ]);
  });
}

/* ---- heatmap (secuencial o divergente segun spec.color) ---- */
function heatmap(host, spec) {
  const rows = spec.rows, cols = spec.cols;
  const cellH = spec.cellH || 24, labelW = spec.labelW || 104;
  const { svg, pr, pt } = frame(host, rows.length * cellH + 32, [24, 4, 8, labelW]);
  const cw = (pr - labelW) / cols.length;
  const colorOf = spec.color || ((v, i) => ramp(spec.norm(v, i)));
  cols.forEach((c, j) => {
    const t = mk("text", { x: labelW + cw * (j + .5), y: pt - 9, "text-anchor": "middle" }, svg);
    t.textContent = cw < 34 && c.length > 4 ? c.slice(0, 3) : c;
  });
  rows.forEach((r, i) => {
    const y = pt + i * cellH;
    const lab = mk("text", { x: labelW - 10, y: y + cellH / 2 + 4, "text-anchor": "end", class: "lbl" }, svg);
    lab.textContent = r.length > Math.floor((labelW - 12) / 6.4) ? r.slice(0, Math.floor((labelW - 12) / 6.4) - 1) + "…" : r;
    cols.forEach((c, j) => {
      const v = spec.values[i][j];
      const col = colorOf(v, i, j);
      mk("rect", { x: labelW + cw * j + 1, y: y + 1, width: Math.max(1, cw - 2),
                   height: cellH - 2, rx: 0, fill: col }, svg);
      if (spec.annotate && v != null && isFinite(v) && cw > 34) {
        const t = mk("text", { x: labelW + cw * (j + .5), y: y + cellH / 2 + 4, "text-anchor": "middle" }, svg);
        t.textContent = spec.fmt(v);
        paint(t, readable(col));
        fs(t, FS_NANO);
      }
      hover(mk("rect", { x: labelW + cw * j, y, width: cw, height: cellH, fill: "transparent" }, svg),
        r + " · " + c,
        [[spec.measure || "Valor", v == null || !isFinite(v) ? "—" : spec.fmt(v)]]
          .concat(spec.extra ? spec.extra(i, j) : []));
    });
  });
}

/* ---- dispersion / burbujas ----
   Con `spec.zoom` la nube pasa a ser navegable: rueda para acercar sobre el
   cursor, arrastre para desplazar y un boton para volver al encuadre inicial.
   El zoom NO es un `transform` sobre el grupo sino un cambio de dominio con
   redibujado: escalando el grupo creceria tambien el radio de las burbujas y
   se volverian a solapar, que es justo lo que el zoom viene a deshacer. */

/* Marcas "bonitas" dentro de un intervalo cualquiera. `niceTicks` solo sabe
   empezar en cero, y una vista con zoom no empieza en cero. */
function ticksIn(lo, hi, count) {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = ([1, 2, 2.5, 5, 10].find(x => x * mag >= raw) || 10) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out.length ? out : [lo, hi];
}

function scatter(host, spec) {
  const pts = spec.points;
  const xt = niceTicks(Math.max(...pts.map(p => p.x), 0) * 1.05, 4);
  const yt = niceTicks(Math.max(...pts.map(p => p.y), 0) * 1.1, 4);
  const home = { x0: 0, x1: xt[xt.length - 1], y0: 0, y1: yt[yt.length - 1] };
  const view = Object.assign({}, home);
  const atHome = () =>
    Math.abs(view.x0 - home.x0) < 1e-9 && Math.abs(view.x1 - home.x1) < 1e-9 &&
    Math.abs(view.y0 - home.y0) < 1e-9 && Math.abs(view.y1 - home.y1) < 1e-9;

  function clamp() {
    const sx = Math.min(view.x1 - view.x0, home.x1 - home.x0);
    const sy = Math.min(view.y1 - view.y0, home.y1 - home.y0);
    view.x0 = Math.min(Math.max(view.x0, home.x0), home.x1 - sx); view.x1 = view.x0 + sx;
    view.y0 = Math.min(Math.max(view.y0, home.y0), home.y1 - sy); view.y1 = view.y0 + sy;
  }

  function draw() {
    const f = frame(host, spec.height || 300, [16, 24, 44, 58]);
    const { svg, w, h, pl, pr, pt, pb } = f;
    const X = v => pl + (pr - pl) * ((v - view.x0) / (view.x1 - view.x0));
    const Y = v => pb - (pb - pt) * ((v - view.y0) / (view.y1 - view.y0));

    ticksIn(view.y0, view.y1, 4).forEach(t => {
      mk("line", { x1: pl, x2: pr, y1: Y(t), y2: Y(t), stroke: cssVar("--grid") }, svg);
      mk("text", { x: pl - 8, y: Y(t) + 4, "text-anchor": "end" }, svg).textContent = spec.fmtY(t);
    });
    ticksIn(view.x0, view.x1, 4).forEach(t =>
      mk("text", { x: X(t), y: pb + 17, "text-anchor": "middle" }, svg).textContent = spec.fmtX(t));
    mk("text", { x: (pl + pr) / 2, y: pb + 36, "text-anchor": "middle" }, svg).textContent = spec.xLabel || "";
    if (spec.hline != null && spec.hline >= view.y0 && spec.hline <= view.y1)
      mk("line", { x1: pl, x2: pr, y1: Y(spec.hline), y2: Y(spec.hline), stroke: cssVar("--axis") }, svg);
    if (spec.vline != null && spec.vline >= view.x0 && spec.vline <= view.x1)
      mk("line", { x1: X(spec.vline), x2: X(spec.vline), y1: pt, y2: pb, stroke: cssVar("--axis") }, svg);

    const g = mk("g", {}, svg);
    if (spec.zoom) {
      const cp = mk("clipPath", { id: "scclip" }, mk("defs", {}, svg));
      mk("rect", { x: pl - 3, y: pt - 3, width: pr - pl + 6, height: pb - pt + 6 }, cp);
      g.setAttribute("clip-path", "url(#scclip)");
    }

    const rmax = Math.max(...pts.map(p => p.r || 1), 1);
    const shown = spec.zoom
      ? pts.filter(p => p.x >= view.x0 && p.x <= view.x1 && p.y >= view.y0 && p.y <= view.y1)
      : pts;
    shown.forEach(p => {
      const r = spec.sizeBy ? 4 + 14 * Math.sqrt((p.r || 0) / rmax) : 5;
      mk("circle", { cx: X(p.x), cy: Y(p.y), r, fill: p.color || SERIES(0),
                     "fill-opacity": spec.sizeBy ? .72 : .8,
                     stroke: cssVar("--surface"), "stroke-width": 2 }, g);
      hover(mk("circle", { cx: X(p.x), cy: Y(p.y), r: Math.max(r, 12), fill: "transparent" }, g),
            p.label, p.rows || []);
    });
    if (spec.labelPoints) {
      const placed = [];
      shown.slice().sort((a, b) => (b.r || 0) - (a.r || 0)).forEach(p => {
        const x = X(p.x), y = Y(p.y) - 15, wpx = p.label.length * 5.6;
        if (placed.some(q => Math.abs(q.y - y) < 13 && Math.abs(q.x - x) < (q.w + wpx) / 2 + 6)) return;
        placed.push({ x, y, w: wpx });
        const t = mk("text", { x, y, "text-anchor": "middle", class: "lbl" }, g);
        t.textContent = p.label; fs(t, FS_NANO); halo(t);
      });
    }
    if (!spec.zoom) return;

    /* Superficie de navegacion sobre el area de trazado. Va encima de las marcas
       para que el arrastre no dependa de acertar en el hueco entre dos burbujas;
       el tooltip vive en las burbujas y sigue funcionando porque esta capa no
       captura `mousemove` salvo mientras se arrastra. */
    const surf = mk("rect", { x: pl, y: pt, width: pr - pl, height: pb - pt,
                              fill: "transparent", cursor: "grab",
                              "pointer-events": "all" }, svg);
    // Un pixel de pantalla en unidades del viewBox: el SVG se dibuja a lo ancho
    // de la tarjeta pero sus coordenadas son las del viewBox.
    const vb = ev => {
      const bb = svg.getBoundingClientRect();
      return [(ev.clientX - bb.left) * (w / Math.max(1, bb.width)),
              (ev.clientY - bb.top) * (h / Math.max(1, bb.height))];
    };
    surf.addEventListener("wheel", ev => {
      ev.preventDefault();
      const [vx, vy] = vb(ev);
      const fx = Math.min(1, Math.max(0, (vx - pl) / (pr - pl)));
      const fy = 1 - Math.min(1, Math.max(0, (vy - pt) / (pb - pt)));
      const k = ev.deltaY < 0 ? 1 / 1.3 : 1.3;
      const nx = Math.min(home.x1 - home.x0, (view.x1 - view.x0) * k);
      const ny = Math.min(home.y1 - home.y0, (view.y1 - view.y0) * k);
      const cx = view.x0 + (view.x1 - view.x0) * fx;
      const cy = view.y0 + (view.y1 - view.y0) * fy;
      view.x0 = cx - nx * fx; view.x1 = view.x0 + nx;
      view.y0 = cy - ny * fy; view.y1 = view.y0 + ny;
      clamp(); hideTip(); draw();
    });
    let drag = null;
    surf.addEventListener("mousedown", ev => {
      drag = { p: vb(ev), v: Object.assign({}, view) };
      surf.setAttribute("cursor", "grabbing");
    });
    surf.addEventListener("mousemove", ev => {
      if (!drag) return;
      const [vx, vy] = vb(ev);
      const dx = -(vx - drag.p[0]) * (drag.v.x1 - drag.v.x0) / (pr - pl);
      const dy = (vy - drag.p[1]) * (drag.v.y1 - drag.v.y0) / (pb - pt);
      view.x0 = drag.v.x0 + dx; view.x1 = drag.v.x1 + dx;
      view.y0 = drag.v.y0 + dy; view.y1 = drag.v.y1 + dy;
      clamp(); draw();
    });
    const stop = () => { drag = null; surf.setAttribute("cursor", "grab"); };
    surf.addEventListener("mouseup", stop);
    surf.addEventListener("mouseleave", stop);

    if (atHome()) {
      const t = mk("text", { x: pr, y: pt - 3, "text-anchor": "end", class: "lbl" }, svg);
      t.textContent = "rueda: acercar · arrastrar: mover";
      fs(t, FS_NANO);
      t.setAttribute("fill", cssVar("--muted"));
    } else {
      const bw = 96, bh = 18, bx = pr - bw, by = pt - 16;
      const gb = mk("g", { cursor: "pointer" }, svg);
      mk("rect", { x: bx, y: by, width: bw, height: bh, rx: 6, fill: cssVar("--plane"),
                   stroke: cssVar("--axis") }, gb);
      const bt = mk("text", { x: bx + bw / 2, y: by + 13, "text-anchor": "middle", class: "lbl" }, gb);
      bt.textContent = "Reiniciar zoom";
      fs(bt, FS_NANO);
      gb.addEventListener("click", () => { Object.assign(view, home); draw(); });
    }
  }
  draw();
}

/* ---- curva acumulada (Pareto / concentracion): un solo eje ---- */
function curveChart(host, spec) {
  const { svg, pl, pr, pt, pb } = frame(host, spec.height || 250, [14, 20, 44, 48]);
  const X = v => pl + (pr - pl) * (v / 100), Y = v => pb - (pb - pt) * (v / 100);
  [0, 25, 50, 75, 100].forEach(t => {
    mk("line", { x1: pl, x2: pr, y1: Y(t), y2: Y(t), stroke: cssVar("--grid") }, svg);
    mk("text", { x: pl - 8, y: Y(t) + 4, "text-anchor": "end" }, svg).textContent = t + " %";
    mk("text", { x: X(t), y: pb + 17, "text-anchor": "middle" }, svg).textContent = t + " %";
  });
  mk("text", { x: (pl + pr) / 2, y: pb + 35, "text-anchor": "middle" }, svg).textContent = spec.xLabel;
  if (!spec.points.length) return;
  if (spec.marker) {
    mk("line", { x1: pl, x2: pr, y1: Y(spec.marker.y), y2: Y(spec.marker.y), stroke: cssVar("--axis") }, svg);
    mk("line", { x1: X(spec.marker.x), x2: X(spec.marker.x), y1: pt, y2: pb,
                 stroke: SERIES(1), "stroke-width": 1.5 }, svg);
    const t = mk("text", { x: X(spec.marker.x) + 8, y: Y(spec.marker.y) - 10, class: "lbl" }, svg);
    t.textContent = spec.marker.text; fs(t, FS_MICRO); halo(t);
  }
  const d = spec.points.map((p, i) => (i ? "L" : "M") + X(p.x) + " " + Y(p.y)).join(" ");
  mk("path", { d, fill: "none", stroke: SERIES(0), "stroke-width": 2.2, "stroke-linejoin": "round" }, svg);
  const cross = mk("line", { y1: pt, y2: pb, stroke: cssVar("--axis"), opacity: 0 }, svg);
  const hit = mk("rect", { x: pl, y: pt, width: pr - pl, height: pb - pt, fill: "transparent" }, svg);
  hit.addEventListener("mousemove", ev => {
    const bb = svg.getBoundingClientRect();
    const relx = (ev.clientX - bb.left) * (svg.viewBox.baseVal.width / bb.width);
    let best = spec.points[0], bd = Infinity;
    for (const p of spec.points) { const dx = Math.abs(X(p.x) - relx); if (dx < bd) { bd = dx; best = p; } }
    cross.setAttribute("x1", X(best.x)); cross.setAttribute("x2", X(best.x));
    cross.setAttribute("opacity", 1);
    showTip(ev, spec.tipTitle || "", [[spec.xLabel, nf(best.x, 1) + " %"],
                                      ["% acumulado", nf(best.y, 1) + " %"]]);
  });
  hit.addEventListener("mouseleave", () => { cross.setAttribute("opacity", 0); hideTip(); });
}

/* ---- coeficientes con intervalo de confianza ---- */
function dotplotCI(host, spec) {
  const items = spec.items, rowH = spec.rowH || 26, labelW = spec.labelW || 180;
  const { svg, pl, pr, pt, pb } = frame(host, items.length * rowH + 40, [10, 60, 30, labelW]);
  const lo = Math.min(...items.map(d => d.lo), spec.ref);
  const hi = Math.max(...items.map(d => d.hi), spec.ref);
  const padv = (hi - lo) * .08 || 1;
  const X = v => pl + (pr - pl) * ((v - lo + padv) / (hi - lo + 2 * padv));
  [lo, (lo + hi) / 2, hi].forEach(t => {
    mk("text", { x: X(t), y: pb + 12, "text-anchor": "middle" }, svg).textContent = spec.fmt(t);
  });
  mk("line", { x1: X(spec.ref), x2: X(spec.ref), y1: pt, y2: pb - 6,
               stroke: cssVar("--axis"), "stroke-width": 1.5 }, svg);
  items.forEach((d, i) => {
    const y = pt + i * rowH + rowH / 2 - 4;
    mk("text", { x: labelW - 10, y: y + 4, "text-anchor": "end", class: "lbl" }, svg)
      .textContent = d.label.length > 30 ? d.label.slice(0, 29) + "…" : d.label;
    const col = d.sig ? SERIES(0) : cssVar("--neutral-mark");
    mk("line", { x1: X(d.lo), x2: X(d.hi), y1: y, y2: y, stroke: col, "stroke-width": 2 }, svg);
    [d.lo, d.hi].forEach(v => mk("line", { x1: X(v), x2: X(v), y1: y - 4, y2: y + 4, stroke: col }, svg));
    mk("circle", { cx: X(d.est), cy: y, r: 4.5, fill: col,
                   stroke: cssVar("--surface"), "stroke-width": 2 }, svg);
    mk("text", { x: pr + 6, y: y + 4, class: "val" }, svg).textContent = spec.fmt(d.est);
    hover(mk("rect", { x: 0, y: y - rowH / 2, width: pr, height: rowH, fill: "transparent" }, svg),
      d.label, [[spec.measure || "Estimación", spec.fmt(d.est)],
                ["IC 95 %", spec.fmt(d.lo) + " – " + spec.fmt(d.hi)],
                ["p-valor", d.p < 1e-4 ? "< 0,0001" : nf(d.p, 4)],
                ["Significativo", d.sig ? "sí (p < 0,05)" : "no"]]);
  });
}

/* ---- treemap (squarify). Area = valor; la identidad la dan las etiquetas y la
       agrupacion, nunca el color: un solo tono para no doble-codificar. ---- */
function squarify(items, x, y, w, h) {
  const out = [];
  let rest = items.slice().sort((a, b) => b.value - a.value);
  const total = rest.reduce((a, b) => a + b.value, 0);
  if (!total) return out;
  let scale = (w * h) / total;
  const worst = (row, len) => {
    const s = row.reduce((a, b) => a + b.value, 0) * scale;
    const mx = Math.max(...row.map(r => r.value)) * scale;
    const mn = Math.min(...row.map(r => r.value)) * scale;
    return Math.max((len * len * mx) / (s * s), (s * s) / (len * len * mn));
  };
  while (rest.length) {
    const vertical = w >= h;
    const len = vertical ? h : w;
    let row = [rest[0]], i = 1;
    while (i < rest.length && worst(row.concat(rest[i]), len) <= worst(row, len)) {
      row.push(rest[i]); i++;
    }
    const rowSum = row.reduce((a, b) => a + b.value, 0) * scale;
    const thick = rowSum / len;
    let off = 0;
    row.forEach(it => {
      const side = (it.value * scale) / thick;
      out.push(vertical
        ? { item: it, x, y: y + off, w: thick, h: side }
        : { item: it, x: x + off, y, w: side, h: thick });
      off += side;
    });
    if (vertical) { x += thick; w -= thick; } else { y += thick; h -= thick; }
    rest = rest.slice(row.length);
  }
  return out;
}
function treemap(host, spec) {
  const h = spec.height || 380;
  const { svg, w, pt } = frame(host, h, [4, 4, 4, 4]);
  const groups = spec.groups.filter(g => g.value > 0);
  const outer = squarify(groups, 2, pt, w - 4, h - 8);
  outer.forEach(({ item, x, y, w: gw, h: gh }) => {
    mk("rect", { x, y, width: gw - 3, height: gh - 3, rx: 0,
                 fill: cssVar("--plane"), stroke: cssVar("--hairline") }, svg);
    const inner = squarify(item.children, x + 4, y + 20, Math.max(1, gw - 11), Math.max(1, gh - 26));
    inner.forEach(({ item: ch, x: cx, y: cy, w: cw2, h: ch2 }) => {
      // Misma razon que en `treemapFlat`: la rampa validada en vez de opacidad,
      // para que el contraste de la etiqueta no dependa del tema.
      const t = Math.min(1, ch.value / spec.maxChild);
      const col = ramp(t);
      mk("rect", { x: cx, y: cy, width: Math.max(0, cw2 - 2), height: Math.max(0, ch2 - 2),
                   rx: 0, fill: col }, svg);
      if (cw2 > 54 && ch2 > 18) {
        const lt = mk("text", { x: cx + 5, y: cy + 13 }, svg);
        lt.textContent = ch.label.length > Math.floor(cw2 / 6) ? ch.label.slice(0, Math.floor(cw2 / 6) - 1) + "…" : ch.label;
        // La marca es SERIES(0) translucido sobre el fondo del grupo: el color
        // que ve el ojo es la mezcla, y es esa la que decide el color del texto.
        paint(lt, readable(col));
        fs(lt, FS_NANO);
      }
      hover(mk("rect", { x: cx, y: cy, width: Math.max(0, cw2 - 2), height: Math.max(0, ch2 - 2),
                         fill: "transparent" }, svg),
            item.label + " · " + ch.label, spec.tipRows(item, ch));
    });
    const gt = mk("text", { x: x + 6, y: y + 14, class: "lbl" }, svg);
    gt.textContent = item.label;
    fs(gt, FS_MICRO);
    gt.setAttribute("font-weight", 600);
    const gv = mk("text", { x: x + gw - 9, y: y + 14, "text-anchor": "end", class: "val" }, svg);
    gv.textContent = spec.fmtGroup(item.value);
    if (gw < 150) gv.textContent = "";
  });
}

/* ---- mapa: contornos reales + coropleta + burbujas ----
   Sin Leaflet y sin tiles a proposito: el informe es un fichero suelto que tiene
   que abrir sin red, y ademas la CSP del Artifact bloquea cualquier host
   externo, con lo que un mapa de tiles se quedaria en blanco justo alli. Las
   fronteras van embebidas en `03b_geo.js` (Natural Earth, dominio publico).

   Lo unico escrito a mano son las coordenadas de las 46 plazas del catalogo:
   dato fijo del generador, no dato de negocio. */
const CITY_LL = {
  "Madrid": [40.42, -3.70], "Barcelona": [41.39, 2.17], "Valencia": [39.47, -0.38],
  "Sevilla": [37.39, -5.98], "Málaga": [36.72, -4.42], "Bilbao": [43.26, -2.93],
  "Zaragoza": [41.65, -0.89], "Granada": [37.18, -3.60],
  "Paris": [48.86, 2.35], "Lyon": [45.76, 4.84], "Marseille": [43.30, 5.37],
  "Toulouse": [43.60, 1.44], "Nice": [43.70, 7.27], "Bordeaux": [44.84, -0.58],
  "Chamonix": [45.92, 6.87], "Annecy": [45.90, 6.13],
  "Roma": [41.90, 12.50], "Milano": [45.46, 9.19], "Napoli": [40.85, 14.27],
  "Torino": [45.07, 7.69], "Venezia": [45.44, 12.32], "Firenze": [43.77, 11.26],
  "Bologna": [44.49, 11.34], "Cortina": [46.54, 12.14],
  "Berlin": [52.52, 13.40], "München": [48.14, 11.58], "Hamburg": [53.55, 9.99],
  "Köln": [50.94, 6.96], "Frankfurt": [50.11, 8.68], "Garmisch": [47.49, 11.10],
  "Lisboa": [38.72, -9.14], "Porto": [41.15, -8.61], "Faro": [37.02, -7.93],
  "Braga": [41.55, -8.43], "Coimbra": [40.21, -8.43],
  "Bruxelles": [50.85, 4.35], "Antwerpen": [51.22, 4.40], "Gent": [51.05, 3.72],
  "Brugge": [51.21, 3.22], "Liège": [50.63, 5.57],
  "Amsterdam": [52.37, 4.90], "Rotterdam": [51.92, 4.48], "Utrecht": [52.09, 5.12],
  "Eindhoven": [51.44, 5.48], "Den Haag": [52.08, 4.31], "Groningen": [53.22, 6.57],
};

/* Web Mercator, DEVUELTO EN GRADOS. La conversion importa: la x del mapa son
   grados de longitud, asi que si la y se queda en radianes ambos ejes comparten
   escala con un factor 57 de diferencia y el mapa sale aplastado. */
const mercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 180 / Math.PI;

/* Centroide de area de un anillo (media ponderada de los triangulos). Para
   Italia o Portugal el centro de la caja envolvente cae fuera del pais. */
function ringCentroid(flat) {
  let a2 = 0, cx = 0, cy = 0;
  const n = flat.length / 2;
  for (let i = 0; i < n; i++) {
    const x0 = flat[i * 2], y0 = flat[i * 2 + 1];
    const j = (i + 1) % n;
    const x1 = flat[j * 2], y1 = flat[j * 2 + 1];
    const f = x0 * y1 - x1 * y0;
    a2 += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (!a2) return [flat[0], flat[1]];
  return [cx / (3 * a2), cy / (3 * a2)];
}

function geoMap(host, spec) {
  const h = spec.height || 620;
  const { svg, w } = frame(host, h, [0, 0, 0, 0]);
  const byCity = spec.level === "city";
  const [L0, L1, B0, B1] = GEO_WINDOW;
  const gyTop = -mercY(B1), gyBot = -mercY(B0);
  const spanX = L1 - L0, spanY = gyBot - gyTop;

  /* Europa occidental es un encuadre vertical y la tarjeta es apaisada: el mapa
     ocupa la izquierda y el ranking la derecha, en vez de dejar oceano vacio. */
  const gapPanel = 20;
  const mapW = Math.max(200, Math.min(w * 0.56, (h - 10) * spanX / spanY));
  const mapH = mapW * spanY / spanX;
  const ox = 2, oy = (h - mapH) / 2;
  const s = mapW / spanX;
  const PX = (lon, lat) => [ox + (lon - L0) * s, oy + (-mercY(lat) - gyTop) * s];

  const byName = {};
  for (const c of spec.countries) byName[c.name] = c;
  const cMax = Math.max(...spec.countries.map(c => c.value), 1);
  const vmax = byCity
    ? Math.max(...spec.countries.flatMap(c => c.cities.map(t => t.value)), 1)
    : cMax;

  // 1. Mar y recorte. Los contornos ya vienen recortados a la ventana; el
  //    clip solo protege de que una burbuja del borde se salga de la caja.
  const defs = mk("defs", {}, svg);
  const cp = mk("clipPath", { id: "geoclip" }, defs);
  mk("rect", { x: ox, y: oy, width: mapW, height: mapH }, cp);
  // El mar toma el tono mas claro del tema y la tierra el neutro medio: son los
  // dos tokens con separacion suficiente para distinguirse en claro y en oscuro.
  mk("rect", { x: ox, y: oy, width: mapW, height: mapH, rx: 6,
               fill: cssVar("--surface"), stroke: cssVar("--hairline") }, svg);
  const g = mk("g", { "clip-path": "url(#geoclip)" }, svg);

  // 2. Tierra. Los paises sin negocio son contexto: neutros y sin dato.
  const landCol = cssVar("--grid"), edge = cssVar("--axis");
  for (const land of GEO_LAND) {
    const data = land.name ? byName[land.name] : null;
    const t = data ? Math.min(1, data.value / cMax) : 0;
    for (const ring of land.rings) {
      let d = "";
      for (let i = 0; i < ring.length; i += 2) {
        const p = PX(ring[i], ring[i + 1]);
        d += (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1);
      }
      const path = mk("path", { d: d + "Z",
        fill: data && !byCity ? ramp(t) : landCol,
        "fill-opacity": data ? 1 : .55,
        stroke: data && !byCity ? cssVar("--surface") : edge,
        "stroke-width": .7, "stroke-opacity": data ? .85 : .4 }, g);
      if (data) hover(path, data.name, data.tipRows());
    }
  }

  // 3. Etiqueta dentro del pais solo si cabe; el panel lleva todas las cifras.
  for (const land of GEO_LAND) {
    const data = land.name ? byName[land.name] : null;
    if (!data) continue;
    const ring = land.rings[0];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      const p = PX(ring[i], ring[i + 1]);
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
      y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
    if (x1 - x0 < 52 || y1 - y0 < 26) continue;
    const c = ringCentroid(ring);
    const p = PX(c[0], c[1]);
    const ink = byCity ? cssVar("--ink-2")
      : readable(ramp(Math.min(1, data.value / cMax)));
    const lt = mk("text", { x: p[0], y: p[1] - (byCity ? 0 : 5), "text-anchor": "middle" }, g);
    lt.textContent = data.name;
    fs(lt, FS_MICRO);
    lt.setAttribute("font-weight", 600);
    paint(lt, ink);
    lt.setAttribute("pointer-events", "none");
    if (byCity) halo(lt);
    if (!byCity) {
      const vt = mk("text", { x: p[0], y: p[1] + 10, "text-anchor": "middle" }, g);
      vt.textContent = spec.fmt(data.value);
      fs(vt, FS_NANO);
      paint(vt, ink);
      vt.setAttribute("pointer-events", "none");
    }
  }

  // 4. Burbujas. En vista de paises quedan de contexto: donde hay tienda.
  const rMax = Math.max(9, Math.min(26, mapW * 0.055));
  const rOf = v => Math.max(2.5, rMax * Math.sqrt(Math.max(0, v) / vmax));
  const cityList = spec.countries.flatMap(c => c.cities.map(t => ({ t, c })));
  cityList.sort((a, b) => b.t.value - a.t.value);
  for (const { t, c } of cityList.slice().reverse()) {
    const p = PX(t.lon, t.lat);
    const circ = mk("circle", { cx: p[0], cy: p[1], r: byCity ? rOf(t.value) : 2.2,
      fill: byCity ? SERIES(0) : cssVar("--ink-2"),
      "fill-opacity": byCity ? .7 : .5,
      stroke: cssVar("--surface"), "stroke-width": byCity ? 1.2 : 0 }, g);
    if (byCity) hover(circ, t.name + " · " + c.name, t.tipRows());
  }
  if (byCity) {
    for (const { t } of cityList.slice(0, 7)) {
      const p = PX(t.lon, t.lat);
      const lt = mk("text", { x: p[0], y: p[1] - rOf(t.value) - 5, "text-anchor": "middle" }, g);
      lt.textContent = t.name;
      fs(lt, FS_NANO);
      lt.setAttribute("fill", cssVar("--ink"));
      lt.setAttribute("pointer-events", "none");
      halo(lt);
    }
  }

  // 5. Panel de ranking: hace de leyenda y da la cifra exacta que el color solo
  //    insinua. Ocupa el hueco que dejaria el encuadre vertical del mapa.
  const px0 = ox + mapW + gapPanel;
  const pw = w - px0 - 4;
  if (pw < 150) return;
  const rows = byCity
    ? cityList.slice(0, 14).map(d => ({ name: d.t.name, sub: d.c.name, value: d.t.value }))
    : spec.countries.slice().sort((a, b) => b.value - a.value)
        .map(d => ({ name: d.name, sub: nf(d.cities.length) + " ciudades", value: d.value }));
  const head = mk("text", { x: px0, y: oy + 12 }, svg);
  head.textContent = spec.measureLabel + (byCity ? " por ciudad" : " por país");
  fs(head, FS_MICRO);
  head.setAttribute("font-weight", 620);
  head.setAttribute("fill", cssVar("--ink"));

  const top = oy + 30, rowH = Math.min(30, (mapH - 46) / Math.max(1, rows.length));
  const barX = px0 + Math.min(150, pw * 0.42), barW = pw - (barX - px0) - 66;
  const rmax = Math.max(...rows.map(r => r.value), 1);
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const nt = mk("text", { x: px0, y: y + 10 }, svg);
    nt.textContent = r.name;
    fs(nt, FS_MICRO);
    nt.setAttribute("fill", cssVar("--ink"));
    const st = mk("text", { x: px0, y: y + 21, class: "lbl" }, svg);
    st.textContent = rowH > 24 ? r.sub : "";
    fs(st, FS_NANO);
    mk("rect", { x: barX, y: y + 3, width: Math.max(0, barW), height: 5, rx: 0,
                 fill: cssVar("--grid") }, svg);
    mk("rect", { x: barX, y: y + 3, width: Math.max(1, barW * r.value / rmax), height: 5,
                 rx: 0, fill: byCity ? SERIES(0) : ramp(Math.min(1, r.value / cMax)) }, svg);
    const vt = mk("text", { x: px0 + pw, y: y + 10, "text-anchor": "end" }, svg);
    vt.textContent = spec.fmt(r.value);
    fs(vt, FS_MICRO);
    vt.setAttribute("fill", cssVar("--ink-2"));
  });

  if (!byCity) {
    const gy = oy + mapH - 14;
    const grad = mk("linearGradient", { id: "mapgrad", x1: "0", x2: "1" }, defs);
    const arr = rampArr();
    arr.forEach((c, i) => mk("stop", { offset: (i / (arr.length - 1) * 100) + "%", "stop-color": c }, grad));
    mk("rect", { x: px0, y: gy, width: Math.min(160, pw - 60), height: 8, rx: 0,
                 fill: "url(#mapgrad)" }, svg);
    const lo = mk("text", { x: px0, y: gy + 20, class: "lbl" }, svg);
    lo.textContent = "0"; fs(lo, FS_NANO);
    const hi = mk("text", { x: px0 + Math.min(160, pw - 60), y: gy + 20, "text-anchor": "middle",
                            class: "lbl" }, svg);
    hi.textContent = spec.fmt(cMax); fs(hi, FS_NANO);
  } else {
    const gy = oy + mapH - 20;
    let x = px0;
    for (const f of [1, .4, .1]) {
      const r = rMax * Math.sqrt(f);
      mk("circle", { cx: x + r, cy: gy + 10, r, fill: SERIES(0), "fill-opacity": .7,
                     stroke: cssVar("--surface"), "stroke-width": 1.2 }, svg);
      const vt = mk("text", { x: x + r, y: gy + 26, "text-anchor": "middle", class: "lbl" }, svg);
      vt.textContent = spec.fmt(vmax * f);
      fs(vt, FS_NANO);
      x += r * 2 + 26;
    }
    const cap = mk("text", { x: x + 2, y: gy + 14, class: "lbl" }, svg);
    cap.textContent = "área ∝ " + spec.measureLabel.toLowerCase();
    fs(cap, FS_NANO);
  }
}

/* ---- sankey: nodos por columnas y cintas proporcionales ----
   spec.nodes = [{ id, col, label, value, color, sub, tipRows }]
   spec.links = [{ s, t, value, color, tipRows }]
   La escala vertical es unica para todo el grafico: una columna mas corta
   significa que por ahi pasan menos alquileres, no que se dibuje distinto. */
function sankey(host, spec) {
  const h = spec.height || 380;
  const { svg, w } = frame(host, h, [30, 12, 16, 12]);
  const pl = 12, pr = w - 12, pt = 30, pb = h - 16;
  const nodes = spec.nodes, byId = {};
  nodes.forEach(n => { byId[n.id] = n; });
  const cols = Math.max(...nodes.map(n => n.col)) + 1;
  const gap = 30, nodeW = 12;
  const usable = pb - pt;

  let s = Infinity;
  for (let c = 0; c < cols; c++) {
    const inCol = nodes.filter(n => n.col === c);
    const total = inCol.reduce((a, b) => a + b.value, 0);
    if (total > 0) s = Math.min(s, (usable - (inCol.length - 1) * gap) / total);
  }
  if (!isFinite(s) || s <= 0) return;

  const colX = c => cols === 1 ? pl : pl + (pr - pl - nodeW) * (c / (cols - 1));
  for (let c = 0; c < cols; c++) {
    let y = pt;
    for (const n of nodes.filter(x => x.col === c)) {
      n._x = colX(c); n._y = y; n._h = Math.max(1, n.value * s);
      n._out = 0; n._in = 0;
      y += n._h + gap;
    }
  }

  // Cintas primero: los nodos van encima y tapan la costura.
  for (const l of spec.links) {
    const a = byId[l.s], b = byId[l.t];
    if (!a || !b || !(l.value > 0)) continue;
    const th = l.value * s;
    const y0 = a._y + a._out, y1 = b._y + b._in;
    a._out += th; b._in += th;
    const x0 = a._x + nodeW, x1 = b._x, xm = (x0 + x1) / 2;
    const d = "M" + x0 + " " + y0 +
              "C" + xm + " " + y0 + "," + xm + " " + y1 + "," + x1 + " " + y1 +
              "L" + x1 + " " + (y1 + th) +
              "C" + xm + " " + (y1 + th) + "," + xm + " " + (y0 + th) + "," + x0 + " " + (y0 + th) + "Z";
    const path = mk("path", { d, fill: l.color || SERIES(0), "fill-opacity": .32 }, svg);
    path.addEventListener("mouseenter", () => path.setAttribute("fill-opacity", .55));
    path.addEventListener("mouseleave", () => path.setAttribute("fill-opacity", .32));
    hover(path, a.label + " → " + b.label, l.tipRows());
  }

  for (const n of nodes) {
    const rect = mk("rect", { x: n._x, y: n._y, width: nodeW, height: n._h, rx: 0,
                              fill: n.color || SERIES(0) }, svg);
    hover(rect, n.label, n.tipRows());
    const last = n.col === cols - 1;
    const tx = last ? n._x + nodeW : n._x;
    const anchor = last ? "end" : "start";
    const lt = mk("text", { x: tx, y: n._y - 17, "text-anchor": anchor }, svg);
    lt.textContent = n.label;
    fs(lt, FS_MICRO);
    lt.setAttribute("font-weight", 600);
    lt.setAttribute("fill", cssVar("--ink"));
    const vt = mk("text", { x: tx, y: n._y - 5, "text-anchor": anchor, class: "lbl" }, svg);
    vt.textContent = spec.fmt(n.value) + (n.sub ? " · " + n.sub : "");
    fs(vt, FS_NANO);
  }
}


/* ---- indicador radial + desglose ----
   Un arco para UN indice: es la unica forma de esta libreria que no compara nada,
   y por eso se reserva a un score global. El desglose que lo compone va debajo en
   barras finas, dentro del mismo SVG, para que arco y partes se lean como una
   sola pieza. El arco no usa semaforo: el color solo distingue lo hecho de lo que
   falta, y el juicio lo pone el numero. */
function gauge(host, spec) {
  const dims = spec.dims || [];
  const rowH = spec.rowH || 26, labelW = spec.labelW || 104, sw = 13;
  const A0 = 150, A1 = 390;                      // arco abierto por abajo
  /* La altura se deriva de la geometria, no se fija a ojo: el arco baja hasta
     `R/2` por debajo del centro y todavia lleva sus dos topes escritos debajo.
     Con una altura constante, un radio mayor metia el arco dentro de la primera
     barra del desglose. El radio, a su vez, sigue al ancho de la tarjeta. */
  const w0 = Math.max(280, host.clientWidth || 600);
  const R = Math.max(56, Math.min(84, w0 * 0.20));
  const cyRel = 6 + R + sw / 2;
  const capY = cyRel + (R + sw / 2 + 11) / 2 + 4;   // linea de los topes 0 / max
  const arcH = capY + 16;
  const { svg, w, pt } = frame(host, arcH + dims.length * rowH + 10, [10, 8, 8, 0]);
  const cx = w / 2, cy = pt + cyRel;
  const pol = (a, r) => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
  const arcPath = (a0, a1, r) => {
    const s0 = pol(a0, r), s1 = pol(a1, r);
    return "M" + s0[0].toFixed(1) + " " + s0[1].toFixed(1) +
      "A" + r + " " + r + " 0 " + (a1 - a0 > 180 ? 1 : 0) + " 1 " + s1[0].toFixed(1) + " " + s1[1].toFixed(1);
  };
  const t = Math.min(1, Math.max(0, spec.value / spec.max));
  mk("path", { d: arcPath(A0, A1, R), fill: "none", stroke: cssVar("--grid"),
               "stroke-width": sw, "stroke-linecap": "round" }, svg);
  mk("path", { d: arcPath(A0, A0 + (A1 - A0) * t, R), fill: "none", stroke: SERIES(0),
               "stroke-width": sw, "stroke-linecap": "round" }, svg);

  /* Dentro del arco solo cabe la cifra. Cualquier pie descriptivo se sale por
     los lados —el hueco util son 2R menos el trazo— y acaba tocando el propio
     arco, asi que la explicacion va en la nota de la tarjeta. */
  const big = mk("text", { x: cx, y: cy + 12, "text-anchor": "middle", class: "lbl" }, svg);
  big.textContent = spec.fmtValue(spec.value);
  fs(big, Math.round(R * 0.44));
  big.setAttribute("font-weight", 650);
  big.setAttribute("letter-spacing", "-0.02em");
  [0, 1].forEach(k => {
    const e = pol(k ? A1 : A0, R + sw / 2 + 11);
    const l = mk("text", { x: e[0], y: e[1] + 4, "text-anchor": k ? "start" : "end" }, svg);
    l.textContent = (spec.fmtEnd || spec.fmtValue)(k ? spec.max : 0);
    fs(l, FS_NANO);
  });
  hover(mk("circle", { cx, cy, r: R + sw, fill: "transparent" }, svg), spec.title || "",
        spec.tipRows || []);

  const barX = labelW, barW = w - labelW - 52;
  dims.forEach((d, i) => {
    const y = pt + arcH + i * rowH;
    mk("text", { x: labelW - 10, y: y + 12, "text-anchor": "end", class: "lbl" }, svg)
      .textContent = d.label;
    mk("rect", { x: barX, y: y + 4, width: barW, height: 9, rx: 0, fill: cssVar("--grid") }, svg);
    mk("rect", { x: barX, y: y + 4, width: Math.max(1, barW * d.value / spec.max), height: 9,
                 rx: 0, fill: SERIES(0), "fill-opacity": .55 + .45 * (d.value / spec.max) }, svg);
    const v = mk("text", { x: w - 4, y: y + 12, "text-anchor": "end", class: "val" }, svg);
    v.textContent = spec.fmtDim(d.value);
    fs(v, FS_MICRO);
    hover(mk("rect", { x: 0, y, width: w, height: rowH, fill: "transparent" }, svg),
          d.label, d.rows || []);
  });
}

/* ---- barras divergentes desde cero ----
   Para una variacion con signo. Frente al puente que habia aqui antes, no pide
   reconstruir ninguna suma: cada barra sale de la linea de cero y su lado ya
   dice el sentido. El signo va codificado dos veces —color y simbolo delante de
   la cifra— para que no dependa de distinguir azul de naranja.

   La mitad util del ancho se recorta en `valueW` para que la etiqueta de la
   barra mas larga quepa dentro del lienzo en vez de salirse por el borde. */
function barsDiverging(host, spec) {
  const items = spec.items, rowH = spec.rowH || 26, labelW = spec.labelW || 124;
  const valueW = spec.valueW || 58;
  const { svg, pl, pr, pt, pb } = frame(host, items.length * rowH + 46, [10, 14, 30, labelW]);
  const max = Math.max(...items.map(d => Math.abs(d.value)).filter(isFinite), 0) || 1;
  const ticks = niceTicks(max, 2), top = ticks[ticks.length - 1];
  const zero = (pl + pr) / 2;
  const half = Math.max(20, (pr - pl) / 2 - valueW);
  const X = v => zero + half * (v / top);

  // Rejilla simetrica: las mismas marcas a un lado y a otro del cero.
  ticks.slice(1).forEach(t => [t, -t].forEach(v => {
    mk("line", { x1: X(v), x2: X(v), y1: pt, y2: pb, stroke: cssVar("--grid") }, svg);
    const lt = mk("text", { x: X(v), y: pb + 16, "text-anchor": "middle" }, svg);
    lt.textContent = spec.fmt(v);
  }));
  mk("line", { x1: zero, x2: zero, y1: pt, y2: pb + 4, stroke: cssVar("--axis") }, svg);
  mk("text", { x: zero, y: pb + 16, "text-anchor": "middle" }, svg).textContent = spec.fmt(0);

  items.forEach((d, i) => {
    const y = pt + i * rowH, bh = Math.min(14, rowH - 8);
    const v = isFinite(d.value) ? d.value : 0;
    const up = v >= 0;
    const x1 = X(v);
    const lab = mk("text", { x: labelW - 10, y: y + bh - 1, "text-anchor": "end", class: "lbl" }, svg);
    const maxCh = Math.max(6, Math.floor((labelW - 12) / 6.4));
    lab.textContent = d.label.length > maxCh ? d.label.slice(0, maxCh - 1) + "…" : d.label;
    mk("rect", { x: Math.min(zero, x1), y, width: Math.max(1.5, Math.abs(x1 - zero)), height: bh,
                 rx: 0, fill: d.muted ? cssVar("--neutral-mark") : (up ? SERIES(0) : SERIES(1)) }, svg);
    const vt = mk("text", { x: x1 + (up ? 7 : -7), y: y + bh - 1,
                            "text-anchor": up ? "start" : "end", class: "val" }, svg);
    vt.textContent = (up ? "+" : "−") + spec.fmt(Math.abs(v));
    hover(mk("rect", { x: pl - labelW, y, width: pr - pl + labelW, height: rowH,
                       fill: "transparent" }, svg), d.label, d.rows || []);
  });
  if (spec.xLabel) {
    const t = mk("text", { x: zero, y: pb + 32, "text-anchor": "middle" }, svg);
    t.textContent = spec.xLabel;
  }
}

/* ---- treemap de un solo nivel ----
   El treemap de dos niveles de la pagina de tiendas responde "dentro de que"; este
   responde "cuanto de cada", que es lo que pide una portada. Comparte el squarify
   y la misma convencion: el area es el valor y la intensidad lo acompana. */
function treemapFlat(host, spec) {
  const h = spec.height || 300;
  const { svg, w, pt } = frame(host, h, [2, 2, 2, 2]);
  const items = spec.items.filter(d => d.value > 0);
  const max = Math.max(...items.map(d => d.value), 1);
  squarify(items, 1, pt, w - 2, h - 4).forEach(({ item, x, y, w: bw, h: bh }) => {
    const t = Math.min(1, item.value / max);
    /* Color de la rampa, no azul translucido.

       La opacidad sobre el fondo de la tarjeta producia una escala que cambia
       de sentido con el tema (en oscuro, mas valor = mas claro) y que pasa por
       la banda de luminancia media, donde ni la tinta ni el blanco alcanzan
       4,5:1 sobre la marca: la etiqueta del rectangulo mas grande se quedaba en
       4,4:1. La rampa esta validada para contraste y daltonismo, mantiene el
       mismo sentido en claro y en oscuro, y es la que ya usan el mapa y el
       heatmap, asi que "mas azul oscuro = mas" significa lo mismo en todo el
       informe. */
    const col = ramp(t);
    mk("rect", { x, y, width: Math.max(0, bw - 3), height: Math.max(0, bh - 3), rx: 0,
                 fill: col }, svg);
    if (bw > 62 && bh > 30) {
      const ink = readable(col);
      const lt = mk("text", { x: x + 7, y: y + 16 }, svg);
      lt.textContent = item.label.length > Math.floor((bw - 12) / 6.2)
        ? item.label.slice(0, Math.floor((bw - 12) / 6.2) - 1) + "…" : item.label;
      fs(lt, FS_MICRO);
      lt.setAttribute("font-weight", 600);
      paint(lt, ink);
      const vt = mk("text", { x: x + 7, y: y + 31 }, svg);
      vt.textContent = spec.fmt(item.value);
      fs(vt, FS_NANO);
      paint(vt, ink);
    }
    hover(mk("rect", { x, y, width: Math.max(0, bw - 3), height: Math.max(0, bh - 3),
                       fill: "transparent" }, svg), item.label, item.rows || []);
  });
}

/* ---- diagrama de flujo por capas ----
   Cajas en columnas y flechas entre columnas. No es un grafico de datos: es el
   plano del pipeline, y por eso vive aqui y no en una imagen: hereda tema, tokens
   y tooltip como cualquier otra forma. */
function flowDiagram(host, spec) {
  const cols = spec.columns;
  const nodeH = spec.nodeH || 44, gapY = 10, headH = 40, gapX = spec.gapX || 26;
  const rows = Math.max(...cols.map(c => c.nodes.length));
  const h = headH + rows * (nodeH + gapY) + 26;
  // 200 px por columna es lo que necesita el nombre de modelo mas largo del
  // pipeline (`int_rentals_deduplicated`) sin partirse.
  const { svg, w } = wideFrame(host, h, 200 * cols.length + gapX * (cols.length - 1));
  const pt = 4;
  const cw = (w - gapX * (cols.length - 1)) / cols.length;
  const colX = i => i * (cw + gapX);

  cols.forEach((c, i) => {
    const x = colX(i);
    mk("rect", { x, y: pt, width: cw, height: h - 14, rx: 10,
                 fill: c.accent ? cssVar("--plane") : "none",
                 stroke: cssVar("--hairline") }, svg);
    const t = mk("text", { x: x + 12, y: pt + 20 }, svg);
    t.textContent = c.title;
    fs(t, FS_MICRO);
    t.setAttribute("font-weight", 650);
    t.setAttribute("fill", cssVar("--ink"));
    const st = mk("text", { x: x + 12, y: pt + 33, class: "lbl" }, svg);
    st.textContent = c.subtitle || "";
    fs(st, FS_NANO);
    st.setAttribute("fill", cssVar("--muted"));

    c.nodes.forEach((n, j) => {
      const y = pt + headH + j * (nodeH + gapY);
      const g = mk("g", {}, svg);
      mk("rect", { x: x + 10, y, width: cw - 20, height: nodeH, rx: 6,
                   fill: cssVar("--surface"), stroke: n.strong ? SERIES(0) : cssVar("--axis"),
                   "stroke-width": n.strong ? 1.6 : 1 }, g);
      const nt = mk("text", { x: x + 20, y: y + 19 }, g);
      nt.textContent = n.label;
      fs(nt, FS_MICRO);
      nt.setAttribute("font-weight", 600);
      nt.setAttribute("fill", cssVar("--ink"));
      const ns = mk("text", { x: x + 20, y: y + 33, class: "lbl" }, g);
      ns.textContent = n.sub || "";
      fs(ns, FS_NANO);
      ns.setAttribute("fill", cssVar("--muted"));
      hover(mk("rect", { x: x + 10, y, width: cw - 20, height: nodeH, fill: "transparent" }, g),
            n.label, n.rows || []);
    });

    if (i < cols.length - 1) {
      const ax = x + cw + 4, ay = pt + headH + nodeH / 2 + (rows - 1) * (nodeH + gapY) / 2;
      mk("path", { d: "M" + ax + " " + ay + "h" + (gapX - 12), fill: "none",
                   stroke: cssVar("--axis"), "stroke-width": 1.4 }, svg);
      mk("path", { d: "M" + (ax + gapX - 12) + " " + (ay - 4.5) + "l5 4.5l-5 4.5z",
                   fill: cssVar("--axis") }, svg);
    }
  });
}

/* ---- diagrama de modelo estrella ----
   El hecho en el centro y las dimensiones alrededor, con la cardinalidad escrita
   en la propia linea. Dice de un vistazo lo que una lista de tablas no dice: cual
   es el grano y quien apunta a quien. */
function starDiagram(host, spec) {
  const h = spec.height || 340;
  // El hecho central y dos dimensiones enfrentadas no caben por debajo de esto.
  const { svg, w } = wideFrame(host, h, 620);
  const pt = 4;
  const cx = w / 2, cy = pt + h / 2 - 6;
  const fw = Math.min(240, w * 0.40), fh = 74;
  const dims = spec.dims;
  const dw = Math.min(158, w * 0.26), dh = 52;

  /* Colocacion por separacion, no por radio.

     La version anterior ponia las dimensiones sobre una elipse de radio fijo, y
     en los angulos intermedios (30°, 150°) ni la separacion horizontal ni la
     vertical llegaban a la suma de los semianchos: las cajas se montaban sobre
     el hecho. Aqui, para cada rayo, se busca la distancia minima a la que las
     dos cajas YA no se solapan —basta con separarlas en UNO de los dos ejes— y
     se coloca ahi. Funciona con cualquier numero de dimensiones. */
  const GAP = 28;
  const needX = (fw + dw) / 2 + GAP, needY = (fh + dh) / 2 + GAP;
  const place = a => {
    const ca = Math.cos(a), sa = Math.sin(a);
    const tX = Math.abs(ca) > 1e-6 ? needX / Math.abs(ca) : Infinity;
    const tY = Math.abs(sa) > 1e-6 ? needY / Math.abs(sa) : Infinity;
    const t = Math.min(tX, tY);
    // Y sin salirse del lienzo, que es la otra forma de que esto se vea mal.
    const x = Math.max(dw / 2 + 4, Math.min(w - dw / 2 - 4, cx + t * ca));
    const y = Math.max(pt + dh / 2, Math.min(pt + h - dh / 2 - 8, cy + t * sa));
    return [x, y];
  };

  dims.forEach((d, i) => {
    const a = (-90 + (360 / dims.length) * i) * Math.PI / 180;
    const [x, y] = place(a);
    mk("line", { x1: cx, y1: cy, x2: x, y2: y, stroke: cssVar("--axis"),
                 "stroke-dasharray": "3 3" }, svg);
    // La cardinalidad va en el punto medio del rayo, que con esta colocacion
    // cae siempre en el hueco entre las dos cajas.
    const mx = cx + (x - cx) * 0.5, my = cy + (y - cy) * 0.5;
    const ct = mk("text", { x: mx, y: my + 3, "text-anchor": "middle", class: "val" }, svg);
    ct.textContent = d.card || "1 — N";
    fs(ct, FS_NANO); halo(ct);
    const g = mk("g", {}, svg);
    mk("rect", { x: x - dw / 2, y: y - dh / 2, width: dw, height: dh, rx: 8,
                 fill: cssVar("--surface"), stroke: cssVar("--axis") }, g);
    const t = mk("text", { x, y: y - 6, "text-anchor": "middle" }, g);
    t.textContent = d.label;
    fs(t, FS_MICRO);
    t.setAttribute("font-weight", 600);
    t.setAttribute("fill", cssVar("--ink"));
    const s2 = mk("text", { x, y: y + 9, "text-anchor": "middle", class: "lbl" }, g);
    s2.textContent = d.sub || "";
    fs(s2, FS_NANO);
    s2.setAttribute("fill", cssVar("--muted"));
    const s3 = mk("text", { x, y: y + 21, "text-anchor": "middle", class: "lbl" }, g);
    s3.textContent = d.key || "";
    fs(s3, FS_NANO);
    s3.setAttribute("fill", cssVar("--muted"));
    hover(mk("rect", { x: x - dw / 2, y: y - dh / 2, width: dw, height: dh, fill: "transparent" }, g),
          d.label, d.rows || []);
  });

  mk("rect", { x: cx - fw / 2, y: cy - fh / 2, width: fw, height: fh, rx: 8,
               fill: cssVar("--plane"), stroke: SERIES(0), "stroke-width": 1.8 }, svg);
  const ft = mk("text", { x: cx, y: cy - 10, "text-anchor": "middle" }, svg);
  ft.textContent = spec.fact.label;
  fs(ft, 13);
  ft.setAttribute("font-weight", 650);
  ft.setAttribute("fill", cssVar("--ink"));
  const fs2 = mk("text", { x: cx, y: cy + 8, "text-anchor": "middle", class: "lbl" }, svg);
  fs2.textContent = spec.fact.sub || "";
  fs(fs2, FS_NANO);
  fs2.setAttribute("fill", cssVar("--ink-2"));
  const fs3 = mk("text", { x: cx, y: cy + 22, "text-anchor": "middle", class: "lbl" }, svg);
  fs3.textContent = spec.fact.grain || "";
  fs(fs3, FS_NANO);
  fs3.setAttribute("fill", cssVar("--muted"));
  hover(mk("rect", { x: cx - fw / 2, y: cy - fh / 2, width: fw, height: fh, fill: "transparent" }, svg),
        spec.fact.label, spec.fact.rows || []);
}
