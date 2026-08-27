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
function readable(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4);
  return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]) > .45 ? "#0b0b0b" : "#ffffff";
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
  const max = Math.max(...series.flatMap(s => s.values.filter(isFinite)), 0);
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
  series.forEach(s => {
    const d = s.values.map((v, i) => (i ? "L" : "M") + X(i) + " " + Y(v)).join(" ");
    mk("path", { d, fill: "none", stroke: s.color, "stroke-width": s.width || 2,
                 "stroke-dasharray": s.dash || null, "stroke-linejoin": "round",
                 "stroke-linecap": "round" }, svg);
  });
  const main = series[0];
  if (xs.length <= 32) main.values.forEach((v, i) => {
    mk("circle", { cx: X(i), cy: Y(v), r: 3, fill: main.color,
                   stroke: cssVar("--surface"), "stroke-width": 2 }, svg);
  });
  (spec.marks || []).forEach(m => {
    mk("circle", { cx: X(m.i), cy: Y(m.v), r: 5.5, fill: cssVar("--bad"),
                   stroke: cssVar("--surface"), "stroke-width": 2 }, svg);
  });
  const lastI = main.values.length - 1;
  if (isFinite(main.values[lastI])) {
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
          t.setAttribute("fill", readable(spec.colors[j]));
          t.setAttribute("font-size", FS_NANO);
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
        t.setAttribute("fill", readable(col));
        t.setAttribute("font-size", FS_NANO);
      }
      hover(mk("rect", { x: labelW + cw * j, y, width: cw, height: cellH, fill: "transparent" }, svg),
        r + " · " + c,
        [[spec.measure || "Valor", v == null || !isFinite(v) ? "—" : spec.fmt(v)]]
          .concat(spec.extra ? spec.extra(i, j) : []));
    });
  });
}

/* ---- dispersion / burbujas ---- */
function scatter(host, spec) {
  const { svg, pl, pr, pt, pb } = frame(host, spec.height || 300, [16, 24, 44, 58]);
  const pts = spec.points;
  const xt = niceTicks(Math.max(...pts.map(p => p.x), 0) * 1.05, 4);
  const yt = niceTicks(Math.max(...pts.map(p => p.y), 0) * 1.1, 4);
  const X = v => pl + (pr - pl) * (v / xt[xt.length - 1]);
  const Y = v => pb - (pb - pt) * (v / yt[yt.length - 1]);
  yt.forEach(t => {
    mk("line", { x1: pl, x2: pr, y1: Y(t), y2: Y(t), stroke: cssVar("--grid") }, svg);
    mk("text", { x: pl - 8, y: Y(t) + 4, "text-anchor": "end" }, svg).textContent = spec.fmtY(t);
  });
  xt.forEach(t => mk("text", { x: X(t), y: pb + 17, "text-anchor": "middle" }, svg)
    .textContent = spec.fmtX(t));
  mk("text", { x: (pl + pr) / 2, y: pb + 36, "text-anchor": "middle" }, svg).textContent = spec.xLabel || "";
  if (spec.hline != null) mk("line", { x1: pl, x2: pr, y1: Y(spec.hline), y2: Y(spec.hline),
                                       stroke: cssVar("--axis") }, svg);
  if (spec.vline != null) mk("line", { x1: X(spec.vline), x2: X(spec.vline), y1: pt, y2: pb,
                                       stroke: cssVar("--axis") }, svg);
  const rmax = Math.max(...pts.map(p => p.r || 1), 1);
  pts.forEach(p => {
    const r = spec.sizeBy ? 4 + 14 * Math.sqrt((p.r || 0) / rmax) : 5;
    mk("circle", { cx: X(p.x), cy: Y(p.y), r, fill: p.color || SERIES(0),
                   "fill-opacity": spec.sizeBy ? .72 : .8,
                   stroke: cssVar("--surface"), "stroke-width": 2 }, svg);
    hover(mk("circle", { cx: X(p.x), cy: Y(p.y), r: Math.max(r, 12), fill: "transparent" }, svg),
          p.label, p.rows || []);
  });
  if (spec.labelPoints) {
    const placed = [];
    pts.slice().sort((a, b) => (b.r || 0) - (a.r || 0)).forEach(p => {
      const x = X(p.x), y = Y(p.y) - 15, wpx = p.label.length * 5.6;
      if (placed.some(q => Math.abs(q.y - y) < 13 && Math.abs(q.x - x) < (q.w + wpx) / 2 + 6)) return;
      placed.push({ x, y, w: wpx });
      const t = mk("text", { x, y, "text-anchor": "middle", class: "lbl" }, svg);
      t.textContent = p.label; t.setAttribute("font-size", FS_NANO); halo(t);
    });
  }
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
    t.textContent = spec.marker.text; t.setAttribute("font-size", FS_MICRO); halo(t);
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
      const t = Math.min(1, ch.value / spec.maxChild);
      mk("rect", { x: cx, y: cy, width: Math.max(0, cw2 - 2), height: Math.max(0, ch2 - 2),
                   rx: 0, fill: SERIES(0), "fill-opacity": .25 + .6 * t }, svg);
      if (cw2 > 54 && ch2 > 18) {
        const lt = mk("text", { x: cx + 5, y: cy + 13 }, svg);
        lt.textContent = ch.label.length > Math.floor(cw2 / 6) ? ch.label.slice(0, Math.floor(cw2 / 6) - 1) + "…" : ch.label;
        lt.setAttribute("fill", cssVar("--ink"));
        lt.setAttribute("font-size", FS_NANO);
      }
      hover(mk("rect", { x: cx, y: cy, width: Math.max(0, cw2 - 2), height: Math.max(0, ch2 - 2),
                         fill: "transparent" }, svg),
            item.label + " · " + ch.label, spec.tipRows(item, ch));
    });
    const gt = mk("text", { x: x + 6, y: y + 14, class: "lbl" }, svg);
    gt.textContent = item.label;
    gt.setAttribute("font-size", FS_MICRO);
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
    lt.setAttribute("font-size", FS_MICRO);
    lt.setAttribute("font-weight", 600);
    lt.setAttribute("fill", ink);
    lt.setAttribute("pointer-events", "none");
    if (byCity) halo(lt);
    if (!byCity) {
      const vt = mk("text", { x: p[0], y: p[1] + 10, "text-anchor": "middle" }, g);
      vt.textContent = spec.fmt(data.value);
      vt.setAttribute("font-size", FS_NANO);
      vt.setAttribute("fill", ink);
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
      lt.setAttribute("font-size", FS_NANO);
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
  head.setAttribute("font-size", FS_MICRO);
  head.setAttribute("font-weight", 620);
  head.setAttribute("fill", cssVar("--ink"));

  const top = oy + 30, rowH = Math.min(30, (mapH - 46) / Math.max(1, rows.length));
  const barX = px0 + Math.min(150, pw * 0.42), barW = pw - (barX - px0) - 66;
  const rmax = Math.max(...rows.map(r => r.value), 1);
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const nt = mk("text", { x: px0, y: y + 10 }, svg);
    nt.textContent = r.name;
    nt.setAttribute("font-size", FS_MICRO);
    nt.setAttribute("fill", cssVar("--ink"));
    const st = mk("text", { x: px0, y: y + 21, class: "lbl" }, svg);
    st.textContent = rowH > 24 ? r.sub : "";
    st.setAttribute("font-size", FS_NANO);
    mk("rect", { x: barX, y: y + 3, width: Math.max(0, barW), height: 5, rx: 0,
                 fill: cssVar("--grid") }, svg);
    mk("rect", { x: barX, y: y + 3, width: Math.max(1, barW * r.value / rmax), height: 5,
                 rx: 0, fill: byCity ? SERIES(0) : ramp(Math.min(1, r.value / cMax)) }, svg);
    const vt = mk("text", { x: px0 + pw, y: y + 10, "text-anchor": "end" }, svg);
    vt.textContent = spec.fmt(r.value);
    vt.setAttribute("font-size", FS_MICRO);
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
    lo.textContent = "0"; lo.setAttribute("font-size", FS_NANO);
    const hi = mk("text", { x: px0 + Math.min(160, pw - 60), y: gy + 20, "text-anchor": "middle",
                            class: "lbl" }, svg);
    hi.textContent = spec.fmt(cMax); hi.setAttribute("font-size", FS_NANO);
  } else {
    const gy = oy + mapH - 20;
    let x = px0;
    for (const f of [1, .4, .1]) {
      const r = rMax * Math.sqrt(f);
      mk("circle", { cx: x + r, cy: gy + 10, r, fill: SERIES(0), "fill-opacity": .7,
                     stroke: cssVar("--surface"), "stroke-width": 1.2 }, svg);
      const vt = mk("text", { x: x + r, y: gy + 26, "text-anchor": "middle", class: "lbl" }, svg);
      vt.textContent = spec.fmt(vmax * f);
      vt.setAttribute("font-size", FS_NANO);
      x += r * 2 + 26;
    }
    const cap = mk("text", { x: x + 2, y: gy + 14, class: "lbl" }, svg);
    cap.textContent = "área ∝ " + spec.measureLabel.toLowerCase();
    cap.setAttribute("font-size", FS_NANO);
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
    lt.setAttribute("font-size", FS_MICRO);
    lt.setAttribute("font-weight", 600);
    lt.setAttribute("fill", cssVar("--ink"));
    const vt = mk("text", { x: tx, y: n._y - 5, "text-anchor": anchor, class: "lbl" }, svg);
    vt.textContent = spec.fmt(n.value) + (n.sub ? " · " + n.sub : "");
    vt.setAttribute("font-size", FS_NANO);
  }
}
