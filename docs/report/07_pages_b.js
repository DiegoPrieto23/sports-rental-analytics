/* ===========================================================================
   Paginas 5-8: tiendas, clientes, pricing y estadistica.
   =========================================================================== */

/* --------------------------- 5 · Tiendas ---------------------------------- */
/* Estado de vista del mapa. Vive fuera de la funcion porque `render()` recrea
   las tarjetas enteras en cada cambio de filtro y la eleccion debe sobrevivir. */
const geoView = { level: "country", metric: "rev" };

function pageTiendas(grid) {
  const rows = storeMetrics();
  const byRev = rows.slice().sort((a, b) => b.rev - a.rev);

  const cityList = cityRollup(rows);
  const sinCoord = cityList.filter(d => !CITY_LL[d.city]);

  const c0 = card("c12", "Mapa de negocio", "¿Cómo se reparte el negocio sobre el terreno?");
  grid.appendChild(c0);
  const drawMap = () => {
    const byRevM = geoView.metric === "rev";
    const fmt = v => byRevM ? compact(v) + " €" : compact(v);
    const groups = geoCountryGroups(cityList, byRevM);
    geoMap(c0._chart, {
      height: 620, level: geoView.level, countries: groups, fmt,
      measureLabel: byRevM ? "Ingresos" : "Alquileres",
    });
  };
  segmented(c0, [
    { label: "Ver por", store: geoView, key: "level",
      options: [{ id: "country", label: "Países" }, { id: "city", label: "Ciudades" }] },
    { label: "Métrica", store: geoView, key: "metric",
      options: [{ id: "rev", label: "Importe" }, { id: "n", label: "Alquileres" }] },
  ], drawMap);
  drawMap();
  note(c0, "Las plazas sin tienda activa en la selección desaparecen del mapa" +
    (sinCoord.length ? ", y " + nf(sinCoord.length) + " sin coordenada quedan fuera" : "") +
    ". Los alquileres sin tienda asignada no son localizables y no entran aquí.");
  setTable(c0, ["Ciudad", "País", "Tiendas", "Alquileres", "Ingresos", "Ticket"],
    cityList.map(d => [d.city, d.country, nf(d.stores), nf(d.n), eur(d.rev),
      eur(d.pn ? d.psum / d.pn : NaN, 2)]));

  const c1 = card("c6", "Top 15 tiendas por ingresos", "¿Dónde se concentra el negocio?");
  grid.appendChild(c1);
  barsH(c1._chart, {
    items: byRev.slice(0, 15).map(d => ({ label: d.name, value: d.rev,
      rows: [["Ciudad", d.city + " · " + d.country], ["Formato", d.size],
             ["Ingresos", eur(d.rev)], ["Alquileres", nf(d.n)],
             ["€ por visitante", eur(d.revPerVisitor, 3)]] })),
    rowH: 23, labelW: 152, valueW: 66, fmt: v => compact(v) + " €", measure: "Ingresos",
  });
  setTable(c1, ["Tienda", "Ciudad", "País", "Formato", "Ingresos", "Alquileres", "Ticket"],
    byRev.map(d => [d.name, d.city, d.country, d.size, eur(d.rev), nf(d.n),
      eur(A.store.pn[d.b] ? A.store.psum[d.b] / A.store.pn[d.b] : NaN, 2)]));

  const c2 = card("c6", "Ingreso por visitante anual",
    "¿Qué tiendas convierten mejor el tráfico que ya tienen?");
  grid.appendChild(c2);
  const byEff = rows.filter(d => isFinite(d.revPerVisitor)).sort((a, b) => b.revPerVisitor - a.revPerVisitor);
  barsH(c2._chart, {
    items: byEff.slice(0, 15).map(d => ({ label: d.name, value: d.revPerVisitor,
      rows: [["€ por visitante", eur(d.revPerVisitor, 3)], ["Visitantes/año", nf(d.visitors)],
             ["Ingresos", eur(d.rev)], ["Formato", d.size]] })),
    rowH: 23, labelW: 152, valueW: 70, fmt: v => nf(v, 3) + " €", measure: "€ por visitante",
  });
  setTable(c2, ["Tienda", "Formato", "Visitantes", "Ingresos", "€ / visitante"],
    byEff.map(d => [d.name, d.size, nf(d.visitors), eur(d.rev), nf(d.revPerVisitor, 3)]));
  insight(c2, "El ranking por ingreso absoluto premia el tamaño; este normaliza por tráfico y revela " +
    "qué tiendas <b>exprimen mejor cada visita</b>. Las diferencias apuntan a ejecución local y surtido, " +
    "no a metros cuadrados.");

  const c3 = card("c12", "Ingresos por país y categoría", "¿Cómo se reparte el negocio dentro de cada país?");
  grid.appendChild(c3);
  const cube = {};
  for (let i = 0; i < N; i++) {
    if (!MASK[i] || (F.flags[i] & 1)) continue;
    const ci = rowCountry[i], k = rowCat[i];
    if (ci < 0 || k < 0) continue;
    const key = ci + "|" + k;
    cube[key] = (cube[key] || 0) + (((F.flags[i] >> 3) & 1) ? 0 : F.price[i] / 100);
  }
  const groups = D.countries.map((c, ci) => {
    const children = D.categories.map((cat, k) => ({ label: cat, value: cube[ci + "|" + k] || 0 }))
      .filter(d => d.value > 0);
    return { label: c, value: children.reduce((a, b) => a + b.value, 0), children };
  }).filter(g => g.value > 0);
  const maxChild = Math.max(...groups.flatMap(g => g.children.map(c => c.value)), 1);
  treemap(c3._chart, {
    height: 400, groups, maxChild, fmtGroup: v => compact(v) + " €",
    tipRows: (g, ch) => [["Ingresos", eur(ch.value)],
                         ["Peso en " + g.label, pct(ch.value / g.value, 1)],
                         ["Peso del total", pct(ch.value / A.total.rev[0], 1)]],
  });
  note(c3, "El área es el ingreso; la intensidad del azul acompaña al área dentro de cada país. " +
    "La identidad la dan las etiquetas y la agrupación, no el color.");
  setTable(c3, ["País", "Categoría", "Ingresos", "% del país", "% del total"],
    groups.flatMap(g => g.children.slice().sort((a, b) => b.value - a.value)
      .map(ch => [g.label, ch.label, eur(ch.value), pct(ch.value / g.value, 1),
                  pct(ch.value / A.total.rev[0], 2)])));

  const c4 = card("c6", "Ingresos por formato de tienda", "¿Rinde el formato grande lo que ocupa?");
  grid.appendChild(c4);
  const sizes = D.sizes.map((s, i) => ({ s, b: i + 1 })).filter(d => A.size.n[d.b] > 0);
  barsV(c4._chart, {
    height: 250, items: sizes.map(d => ({ label: d.s, value: A.size.rev[d.b],
      rows: [["Ingresos", eur(A.size.rev[d.b])], ["Alquileres", nf(A.size.n[d.b])],
             ["Ticket medio", eur(kpi.ticket(A.size, d.b), 2)],
             ["Cancelación", pct(kpi.cancel(A.size, d.b), 2)]] })),
    fmt: v => compact(v) + " €", measure: "Ingresos",
  });
  setTable(c4, ["Formato", "Ingresos", "Alquileres", "Ticket", "Cancelación", "Averías", "Review"],
    sizes.map(d => [d.s, eur(A.size.rev[d.b]), nf(A.size.n[d.b]), eur(kpi.ticket(A.size, d.b), 2),
      pct(kpi.cancel(A.size, d.b), 2), pct(kpi.damage(A.size, d.b), 2), nf(kpi.review(A.size, d.b), 2)]));

  const c5 = card("c6", "Fricción operativa por tienda", "¿Dónde se cancela más de lo normal?");
  grid.appendChild(c5);
  const media = kpi.cancel(A.total, 0);
  const worst = rows.filter(d => d.n >= 100).sort((a, b) => b.cancel - a.cancel).slice(0, 12);
  barsH(c5._chart, {
    items: worst.map(d => ({ label: d.name, value: d.cancel * 100,
      rows: [["Cancelación", pct(d.cancel, 2)], ["Media de la selección", pct(media, 2)],
             ["Averías", pct(d.damage, 2)], ["Devolución tardía", pct(d.late, 2)],
             ["Alquileres", nf(d.n)]] })),
    rowH: 23, labelW: 152, valueW: 54, fmt: v => nf(v, 1) + " %", measure: "Cancelación",
  });
  setTable(c5, ["Tienda", "Alquileres", "Cancelación", "Averías", "Tardías", "Review"],
    rows.slice().sort((a, b) => b.cancel - a.cancel).map(d => [d.name, nf(d.n), pct(d.cancel, 2),
      pct(d.damage, 2), pct(d.late, 2), nf(d.review, 2)]));
  note(c5, "Solo tiendas con 100 o más alquileres en la selección, para que la tasa sea estable. " +
    "Media de la selección: " + pct(media, 2) + ".");

  /* Misma mecanica que el detalle de producto: {h, v} en lo numerico y arranque
     por ingresos, que es el orden que tenia fijo. Aqui ordenar por € por visitante
     es lo que de verdad se quiere mirar, y antes obligaba a irse a otra tarjeta. */
  const c7 = card("c12", "Detalle por tienda",
    nf(rows.length) + " tiendas con actividad. Pulsa una cabecera para ordenar.");
  grid.appendChild(c7);
  sortableOnly(c7, ["Tienda", "Ciudad", "País", "Formato", "Visitantes", "Alquileres", "Ingresos",
                    "€/visitante", "Cancelación", "Averías", "Tardías", "Review"],
    rows.map(d => [d.name, d.city, d.country, d.size,
      numCell(d.visitors, nf(d.visitors)),
      numCell(d.n, nf(d.n)),
      numCell(d.rev, eur(d.rev)),
      numCell(d.revPerVisitor, nf(d.revPerVisitor, 3)),
      numCell(d.cancel, pct(d.cancel, 2)),
      numCell(d.damage, pct(d.damage, 2)),
      numCell(d.late, pct(d.late, 2)),
      numCell(d.review, nf(d.review, 2))]),
    { col: 6, dir: -1 });

  recoBlock(grid, "tiendas");
}

/* --------------------------- 6 · Clientes --------------------------------- */
function pageClientes(grid) {
  const c1 = card("c5", "Ingresos por segmento", "¿Qué perfil sostiene la facturación?");
  grid.appendChild(c1);
  const segs = D.segments.map((s, i) => ({ s, b: i + 1 })).filter(d => A.segment.n[d.b] > 0);
  const segTotal = segs.reduce((a, d) => a + A.segment.rev[d.b], 0);
  barsH(c1._chart, {
    items: segs.map(d => ({ label: d.s, value: A.segment.rev[d.b],
      rows: [["Ingresos", eur(A.segment.rev[d.b])], ["Peso", pct(A.segment.rev[d.b] / segTotal, 1)],
             ["Alquileres", nf(A.segment.n[d.b])], ["Ticket medio", eur(kpi.ticket(A.segment, d.b), 2)],
             ["Cancelación", pct(kpi.cancel(A.segment, d.b), 2)]] })),
    rowH: 30, labelW: 104, valueW: 66, fmt: v => compact(v) + " €", measure: "Ingresos",
  });
  setTable(c1, ["Segmento", "Ingresos", "Peso", "Alquileres", "Ticket", "Cancelación", "Review"],
    segs.map(d => [d.s, eur(A.segment.rev[d.b]), pct(A.segment.rev[d.b] / segTotal, 1),
      nf(A.segment.n[d.b]), eur(kpi.ticket(A.segment, d.b), 2), pct(kpi.cancel(A.segment, d.b), 2),
      nf(kpi.review(A.segment, d.b), 2)]));

  const c2 = card("c7", "Concentración del valor de cliente (CLRV)",
    "¿Cuánto depende el negocio de su núcleo de clientes?", "histórico completo");
  grid.appendChild(c2);
  chips(c2, [["El 20 % top aporta", nf(DATA.lifecycle.top20_share, 0) + " %", "de los ingresos"]]);
  curveChart(c2._chart, {
    height: 240, points: DATA.lifecycle.curve, xLabel: "% de clientes, ordenados por CLRV",
    tipTitle: "Concentración de CLRV",
    marker: { x: 20, y: DATA.lifecycle.top20_share,
              text: "20 % de clientes = " + nf(DATA.lifecycle.top20_share, 0) + " % de los ingresos" },
  });
  setTable(c2, ["Segmento", "Clientes", "Ingresos (CLRV)", "CLRV medio"],
    DATA.lifecycle.segments.map(s => [s.segment, nf(s.customers), eur(s.revenue), eur(s.avg_clrv, 2)]));
  note(c2, "El CLRV es el ingreso acumulado de cada cliente en todo el histórico, así que esta tarjeta " +
    "no responde a los filtros.");

  const c3 = card("c6", "Satisfacción por nivel de socio", "¿Puntúa mejor quien es socio?");
  grid.appendChild(c3);
  const mem = D.members.map((m, i) => ({ m, b: i + 1 })).filter(d => A.member.n[d.b] > 0);
  const revColors = [0, 1, 2, 3, 4].map(i => rampArr()[[1, 4, 6, 9, 12][i]]);
  legend(c3, [1, 2, 3, 4, 5].map((s, i) => ({ name: s + " ★", color: revColors[i] })));
  stackedBarsH(c3._chart, {
    items: mem.map(d => ({ label: d.m,
      parts: [0, 1, 2, 3, 4].map(k => A.reviewByMember[d.b * 5 + k]) })),
    colors: revColors, partNames: ["1 ★", "2 ★", "3 ★", "4 ★", "5 ★"], labelW: 104, rowH: 32,
    rightLabel: d => {
      const b = mem.find(m => m.m === d.label).b;
      return nf(kpi.review(A.member, b), 2);
    },
  });
  setTable(c3, ["Membresía", "1 ★", "2 ★", "3 ★", "4 ★", "5 ★", "Review media", "Con review"],
    mem.map(d => [d.m].concat([0, 1, 2, 3, 4].map(k => nf(A.reviewByMember[d.b * 5 + k])))
      .concat([nf(kpi.review(A.member, d.b), 2), nf(A.member.rn[d.b])])));
  insight(c3, "Los niveles altos no solo cancelan menos: <b>puntúan mejor y tienen menos cola baja</b>. " +
    "La fidelización mejora la percepción de calidad, que es un argumento adicional para invertir en el " +
    "programa de socios.");

  const c4 = card("c6", "Cancelación por nivel de socio", "¿Protege ingresos el programa?");
  grid.appendChild(c4);
  barsV(c4._chart, {
    height: 240, color: SERIES(1), items: mem.map(d => ({ label: d.m, value: 100 * kpi.cancel(A.member, d.b),
      rows: [["Cancelación", pct(kpi.cancel(A.member, d.b), 2)], ["Alquileres", nf(A.member.n[d.b])],
             ["Ticket medio", eur(kpi.ticket(A.member, d.b), 2)],
             ["Review media", nf(kpi.review(A.member, d.b), 2)]] })),
    fmt: v => nf(v, 1) + " %", measure: "Cancelación",
  });
  setTable(c4, ["Membresía", "Alquileres", "Cancelación", "Ticket", "Ingresos", "Review"],
    mem.map(d => [d.m, nf(A.member.n[d.b]), pct(kpi.cancel(A.member, d.b), 2),
      eur(kpi.ticket(A.member, d.b), 2), eur(A.member.rev[d.b]), nf(kpi.review(A.member, d.b), 2)]));
  if (mem.length >= 2) {
    insight(c4, "De <b>" + mem[0].m + "</b> a <b>" + mem[mem.length - 1].m + "</b> la cancelación pasa de " +
      pct(kpi.cancel(A.member, mem[0].b), 2) + " a " + pct(kpi.cancel(A.member, mem[mem.length - 1].b), 2) +
      ". La página de estadística contrasta si esa diferencia es real o ruido.");
  }

  const c5 = card("c12", "Retención por cohorte", "¿Vuelve el cliente, y cuándo?", "histórico completo");
  grid.appendChild(c5);
  const co = DATA.lifecycle.cohort;
  heatmap(c5._chart, {
    rows: co.labels, cols: co.matrix[0].map((_, j) => "M+" + j), values: co.matrix,
    norm: v => v == null ? NaN : Math.min(1, v / 30), fmt: v => nf(v, 0) + " %",
    annotate: true, measure: "% de la cohorte activo", cellH: 22, labelW: 76,
    extra: i => [["Clientes en la cohorte", nf(co.sizes[i])]],
  });
  scaleLegend(c5, "0 % activo", "30 % o más");
  setTable(c5, ["Cohorte", "Clientes"].concat(co.matrix[0].map((_, j) => "M+" + j)),
    co.labels.map((l, i) => [l, nf(co.sizes[i])]
      .concat(co.matrix[i].map(v => v == null ? "—" : nf(v, 1) + " %"))));
  insight(c5, "La retención cae rápido tras el primer mes y reaparece de forma estacional: el alquiler " +
    "se comporta como <b>compra puntual</b>, no como suscripción. La palanca no es la frecuencia mensual " +
    "sino <b>volver la temporada siguiente</b>, y eso cambia el diseño de la campaña.");
  note(c5, "La cohorte se define por el primer alquiler del cliente en todo el histórico, así que esta " +
    "tarjeta no responde a los filtros.");

  recoBlock(grid, "clientes");
}

/* --------------------------- 7 · Pricing ---------------------------------- */
function pagePricing(grid) {
  const K = D.categories.length;
  const ppdBuckets = collect(i => rowCat[i] * 4 + monthSeason[F.month[i]],
    i => F.days[i] ? (F.price[i] / 100) / F.days[i] : null, K * 4,
    i => notCancelled(i) && hasPrice(i) && hasDays(i));
  const med = arr => arr.length ? quantileSorted(Float64Array.from(arr).sort(), .5) : NaN;
  const medians = ppdBuckets.map(med);

  const c1 = card("c7", "Precio por día por categoría y temporada",
    "¿Existe ya pricing dinámico y dónde queda recorrido?");
  grid.appendChild(c1);
  const present = D.categories.map((c, i) => i).filter(i => [0, 1, 2, 3].some(s => ppdBuckets[i * 4 + s].length));
  const order = present.slice().sort((a, b) => {
    const avg = k => {
      const v = [0, 1, 2, 3].map(s => medians[k * 4 + s]).filter(isFinite);
      return v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0;
    };
    return avg(b) - avg(a);
  });
  const pvals = order.map(i => [0, 1, 2, 3].map(s => medians[i * 4 + s]));
  const allP = pvals.flat().filter(isFinite);
  const pmin = Math.min(...allP), pmax = Math.max(...allP);
  heatmap(c1._chart, {
    rows: order.map(i => D.categories[i]), cols: D.season_labels, values: pvals,
    norm: v => isFinite(v) ? (v - pmin) / (pmax - pmin || 1) : NaN,
    fmt: v => nf(v, 1) + " €", annotate: true, measure: "Mediana €/día", cellH: 28, labelW: 96,
    extra: (i, j) => [["Alquileres", nf(ppdBuckets[order[i] * 4 + j].length)]],
  });
  scaleLegend(c1, nf(pmin, 1) + " €/día", nf(pmax, 1) + " €/día");
  const spread = order.map((i, r) => {
    const v = pvals[r].filter(isFinite);
    return { i, cat: D.categories[i], variacion: v.length > 1 ? (Math.max(...v) / Math.min(...v) - 1) * 100 : NaN };
  });
  setTable(c1, ["Categoría"].concat(D.season_labels).concat(["Variación"]),
    order.map((i, r) => [D.categories[i]]
      .concat(pvals[r].map(v => isFinite(v) ? nf(v, 2) + " €" : "—"))
      .concat([nf(spread[r].variacion, 0) + " %"])));
  insight(c1, "Se compara la <b>mediana del precio por día</b>, no el ticket, para neutralizar el mix de " +
    "duraciones y que las categorías sean comparables. Es <b>precio observado, no elasticidad</b>: " +
    "muestra lo que se cobra, no cómo respondería la demanda si se cambiara.");

  const c2 = card("c5", "Recorrido de pricing dinámico",
    "¿Qué categorías ya mueven el precio y cuáles lo tienen plano?");
  grid.appendChild(c2);
  const sp = spread.filter(d => isFinite(d.variacion)).sort((a, b) => b.variacion - a.variacion);
  barsH(c2._chart, {
    items: sp.map(d => ({ label: d.cat, value: d.variacion,
      rows: [["Variación pico/valle", nf(d.variacion, 0) + " %"]]
        .concat(D.season_labels.map((s, j) => [s, isFinite(medians[d.i * 4 + j])
          ? nf(medians[d.i * 4 + j], 2) + " €/día" : "—"])) })),
    rowH: 24, labelW: 104, valueW: 54, fmt: v => nf(v, 0) + " %", measure: "Variación",
  });
  setTable(c2, ["Categoría", "Mín €/día", "Máx €/día", "Variación"],
    sp.map(d => {
      const v = [0, 1, 2, 3].map(s => medians[d.i * 4 + s]).filter(isFinite);
      return [d.cat, nf(Math.min(...v), 2) + " €", nf(Math.max(...v), 2) + " €", nf(d.variacion, 0) + " %"];
    }));
  insight(c2, sp.length
    ? "Arriba, las categorías donde el precio <b>ya sube cuando aprieta la demanda</b>: se está " +
      "capturando el premium de escasez. Abajo, las planas: o la demanda es genuinamente aseasonal o hay " +
      "<b>poder de precio sin explotar</b> que a resolución estacional no se ve."
    : "No hay suficientes temporadas en la selección para medir el recorrido.");

  const c3 = card("c7", "Distribución del precio por categoría",
    "¿Qué dispersión de ticket tiene cada deporte?");
  grid.appendChild(c3);
  const priceBuckets = collect(i => rowCat[i], i => F.price[i] / 100, K,
    i => notCancelled(i) && hasPrice(i));
  const priceItems = D.categories.map((c, i) => ({ label: c, box: boxStats(priceBuckets[i]) }))
    .filter(d => d.box).sort((a, b) => b.box.med - a.box.med);
  boxplot(c3._chart, { items: priceItems, fmt: v => nf(v, 0) + " €", labelW: 104, rowH: 29 });
  setTable(c3, ["Categoría", "Mediana", "Q1", "Q3", "Bigote sup.", "Outliers", "Alquileres"],
    priceItems.map(d => [d.label, eur(d.box.med, 2), eur(d.box.q1, 2), eur(d.box.q3, 2),
      eur(d.box.hi, 2), nf(d.box.nOut), nf(d.box.n)]));
  insight(c3, "Nieve arriba —ticket alto y muy disperso, por la combinación de duración larga y prima " +
    "estacional—; running y raquetas abajo, con ticket bajo y compacto. Son <b>dos negocios distintos</b> " +
    "y no admiten la misma política de precio.");

  const c4 = card("c5", "Mix de canal", "¿Por dónde entra la demanda?");
  grid.appendChild(c4);
  const chans = D.channels.map((c, i) => ({ b: i + 1, label: D.channel_labels[i], digital: i < 2 }))
    .filter(d => A.channel.n[d.b] > 0);
  const totalCh = chans.reduce((a, d) => a + A.channel.n[d.b], 0);
  const digShare = chans.filter(d => d.digital).reduce((a, d) => a + A.channel.n[d.b], 0) / totalCh;
  legend(c4, [{ name: "Digital (Online + App)", color: SERIES(0) },
              { name: "Físico (Tienda + Teléfono)", color: cssVar("--neutral-mark") }]);
  barsV(c4._chart, {
    height: 230, items: chans.map(d => ({ label: d.label, value: 100 * A.channel.n[d.b] / totalCh,
      muted: !d.digital,
      rows: [["Alquileres", nf(A.channel.n[d.b])], ["Ingresos", eur(A.channel.rev[d.b])],
             ["Ticket medio", eur(kpi.ticket(A.channel, d.b), 2)],
             ["Cancelación", pct(kpi.cancel(A.channel, d.b), 2)]] })),
    fmt: v => nf(v, 0) + " %", measure: "Peso",
  });
  setTable(c4, ["Canal", "Alquileres", "Peso", "Ingresos", "Ticket", "Cancelación", "Antelación"],
    chans.map(d => [d.label, nf(A.channel.n[d.b]), pct(A.channel.n[d.b] / totalCh, 1),
      eur(A.channel.rev[d.b]), eur(kpi.ticket(A.channel, d.b), 2), pct(kpi.cancel(A.channel, d.b), 2),
      nf(kpi.avgLead(A.channel, d.b), 1) + " d"]));
  insight(c4, "El canal digital concentra el <b>" + pct(digShare, 0) + "</b> de los alquileres.");

  const c5 = card("c4", "Cancelación por canal", "¿Qué canal genera más fricción?");
  grid.appendChild(c5);
  barsV(c5._chart, {
    height: 230, color: SERIES(1), items: chans.map(d => ({ label: d.label,
      value: 100 * kpi.cancel(A.channel, d.b),
      rows: [["Cancelación", pct(kpi.cancel(A.channel, d.b), 2)], ["Alquileres", nf(A.channel.n[d.b])],
             ["Antelación media", nf(kpi.avgLead(A.channel, d.b), 1) + " días"]] })),
    fmt: v => nf(v, 1) + " %", measure: "Cancelación",
  });
  setTable(c5, ["Canal", "Cancelación", "Devolución tardía", "Review", "Antelación media"],
    chans.map(d => [d.label, pct(kpi.cancel(A.channel, d.b), 2), pct(kpi.late(A.channel, d.b), 2),
      nf(kpi.review(A.channel, d.b), 2), nf(kpi.avgLead(A.channel, d.b), 1) + " d"]));

  const c6 = card("c4", "Ticket medio por canal", "¿Compra distinto quien reserva por app?");
  grid.appendChild(c6);
  barsV(c6._chart, {
    height: 230, items: chans.map(d => ({ label: d.label, value: kpi.ticket(A.channel, d.b),
      rows: [["Ticket medio", eur(kpi.ticket(A.channel, d.b), 2)],
             ["Duración media", nf(kpi.avgDays(A.channel, d.b), 2) + " días"],
             ["Ingresos", eur(A.channel.rev[d.b])]] })),
    fmt: v => nf(v, 0) + " €", measure: "Ticket medio",
  });
  setTable(c6, ["Canal", "Ticket medio", "Duración media", "Ingresos"],
    chans.map(d => [d.label, eur(kpi.ticket(A.channel, d.b), 2),
      nf(kpi.avgDays(A.channel, d.b), 2) + " días", eur(A.channel.rev[d.b])]));

  recoBlock(grid, "pricing", recoCtxCanal());
}

/* --------------------------- 8 · Estadistica ------------------------------ */
const CORR_VARS = [
  { key: "rental_days", label: "Duración", get: i => hasDays(i) ? F.days[i] : null },
  { key: "rental_price", label: "Precio", get: i => hasPrice(i) ? F.price[i] / 100 : null },
  { key: "maintenance_cost", label: "Mantenimiento", get: i => ((F.flags[i] >> 5) & 1) ? null : F.maint[i] / 100 },
  { key: "review_score", label: "Review", get: i => F.review[i] || null },
  { key: "lead_time", label: "Antelación", get: i => F.lead[i] === 255 ? null : F.lead[i] },
  { key: "product_age", label: "Antigüedad", get: i => F.product[i] ? P.age[F.product[i] - 1] : null },
  { key: "purchase_price", label: "Precio compra", get: i => F.product[i] ? P.purchase[F.product[i] - 1] : null },
  { key: "inventory_units", label: "Unidades", get: i => F.product[i] ? P.units[F.product[i] - 1] : null },
  { key: "customer_age", label: "Edad cliente", get: i => F.cage[i] || null },
  { key: "prev_rentals", label: "Alq. previos", get: i => F.prevr[i] === 255 ? null : F.prevr[i] },
];

function pageEstadistica(grid) {
  /* --- matriz de correlacion --- */
  const c1 = card("c6", "Matriz de correlación", "¿Qué variables se mueven juntas?");
  grid.appendChild(c1);
  const V = CORR_VARS;
  const M = pearsonMatrix(V.map(v => v.get), MASK);
  heatmap(c1._chart, {
    rows: V.map(v => v.label), cols: V.map(v => v.label), values: M,
    color: v => isFinite(v) ? diverging(v) : cssVar("--grid"),
    fmt: v => nf(v, 2), annotate: true, measure: "r de Pearson", cellH: 26, labelW: 104,
  });
  scaleLegend(c1, "−1 inversa", "+1 directa", diverging);
  setTable(c1, ["Variable"].concat(V.map(v => v.label)),
    V.map((v, a) => [v.label].concat(M[a].map(x => nf(x, 2)))));
  insight(c1, "Azul es relación inversa, rojo directa y el gris del centro significa <b>ninguna</b>. " +
    "No aparece ninguna correlación espuria fuerte: las variables son coherentes entre sí y están listas " +
    "para modelar.");

  /* --- correlaciones con significacion --- */
  const c2 = card("c6", "Correlaciones clave con significación",
    "¿Las relaciones que se ven son reales?");
  grid.appendChild(c2);
  const pairs = [
    ["product_age", "maintenance_cost"], ["rental_days", "rental_price"],
    ["lead_time", "review_score"], ["product_age", "review_score"],
    ["prev_rentals", "rental_price"],
  ].map(([a, b]) => {
    const va = V.find(v => v.key === a), vb = V.find(v => v.key === b);
    const r = pearson(va.get, vb.get, MASK);
    return { label: va.label + " ~ " + vb.label, ...r };
  });
  dotplotCI(c2._chart, {
    items: pairs.map(p => {
      const z = 0.5 * Math.log((1 + p.r) / (1 - p.r));       // transformada de Fisher
      const se = 1 / Math.sqrt(Math.max(1, p.n - 3));
      const back = v => (Math.exp(2 * v) - 1) / (Math.exp(2 * v) + 1);
      return { label: p.label, est: p.r, lo: back(z - 1.96 * se), hi: back(z + 1.96 * se),
               p: p.p, sig: p.p < 0.05 };
    }),
    ref: 0, fmt: v => nf(v, 2), labelW: 200, rowH: 30, measure: "r de Pearson",
  });
  setTable(c2, ["Par de variables", "r", "n", "p-valor", "Significativa"],
    pairs.map(p => [p.label, nf(p.r, 3), nf(p.n), pval(p.p),
      p.p < 0.05 ? '<span class="sig">sí</span>' : '<span class="nosig">no</span>']));
  note(c2, "IC 95 % por la transformada de Fisher. Con decenas de miles de observaciones casi todo sale " +
    "significativo: lo que importa es el tamaño del efecto, no el p-valor.");

  /* --- OLS: precio --- */
  const c3 = card("c7", "Qué explica el precio de alquiler (regresión lineal)",
    "¿Cuánto aporta cada driver al precio, con todo lo demás constante?");
  grid.appendChild(c3);
  const catLv = [], seaLv = [], couLv = [];
  for (let i = 0; i < N; i++) {
    if (!MASK[i] || !notCancelled(i) || !hasPrice(i) || !hasDays(i)) continue;
    if (rowCat[i] >= 0 && !catLv.includes(rowCat[i])) catLv.push(rowCat[i]);
    const s = monthSeason[F.month[i]];
    if (!seaLv.includes(s)) seaLv.push(s);
    if (rowCountry[i] >= 0 && !couLv.includes(rowCountry[i])) couLv.push(rowCountry[i]);
  }
  catLv.sort((a, b) => a - b); seaLv.sort((a, b) => a - b); couLv.sort((a, b) => a - b);
  /* Posicion de cada nivel dentro de su bloque de dummies. Resolverlo con
     indexOf dentro del bucle de filas cuesta un escaneo lineal por fila, y el
     ajuste recorre las filas enteras: con 172k filas se nota en el render. */
  const catPos = new Int8Array(D.categories.length).fill(-1);
  catLv.forEach((k, j) => { catPos[k] = j; });
  const seaPos = new Int8Array(4).fill(-1);
  seaLv.forEach((s, j) => { seaPos[s] = j; });
  const couPos = new Int8Array(D.countries.length).fill(-1);
  couLv.forEach((c, j) => { couPos[c] = j; });
  const names = ["Intercepto", "Días de alquiler"]
    .concat(catLv.slice(1).map(k => "Categoría: " + D.categories[k]))
    .concat(seaLv.slice(1).map(s => "Temporada: " + D.season_labels[s]))
    .concat(couLv.slice(1).map(c => "País: " + D.countries[c]));
  const pOls = names.length;
  const olsRows = cb => {
    const x = new Float64Array(pOls);
    for (let i = 0; i < N; i++) {
      if (!MASK[i] || !notCancelled(i) || !hasPrice(i) || !hasDays(i)) continue;
      if (rowCat[i] < 0 || rowCountry[i] < 0) continue;
      x.fill(0);
      x[0] = 1; x[1] = F.days[i];
      const ci = catPos[rowCat[i]]; if (ci > 0) x[1 + ci] = 1;
      const si = seaPos[monthSeason[F.month[i]]];
      if (si > 0) x[1 + catLv.length - 1 + si] = 1;
      const ki = couPos[rowCountry[i]];
      if (ki > 0) x[1 + catLv.length - 1 + seaLv.length - 1 + ki] = 1;
      cb(x, F.price[i] / 100);
    }
  };
  const fit = ols(olsRows, pOls);
  if (fit) {
    chips(c3, [["R²", nf(fit.r2, 3)], ["R² ajustado", nf(fit.r2adj, 3)],
               ["Observaciones", nf(fit.n)], ["Predictores", nf(pOls - 1)]]);
    const items = names.map((nm, j) => ({
      label: nm, est: fit.beta[j], lo: fit.beta[j] - 1.96 * fit.se[j],
      hi: fit.beta[j] + 1.96 * fit.se[j], p: fit.p[j], sig: fit.p[j] < 0.05,
    })).filter((_, j) => j > 0);
    dotplotCI(c3._chart, { items, ref: 0, fmt: v => nf(v, 1) + " €", labelW: 190, rowH: 25,
                           measure: "Efecto sobre el precio" });
    setTable(c3, ["Término", "Coeficiente", "Error estándar", "IC 95 %", "p-valor", "Significativo"],
      names.map((nm, j) => [nm, eur(fit.beta[j], 2), nf(fit.se[j], 3),
        eur(fit.beta[j] - 1.96 * fit.se[j], 1) + " – " + eur(fit.beta[j] + 1.96 * fit.se[j], 1),
        pval(fit.p[j]), fit.p[j] < 0.05 ? '<span class="sig">sí</span>' : '<span class="nosig">no</span>']));
    insight(c3, "Cada coeficiente se lee como <b>«manteniendo lo demás constante, esto cambia el precio " +
      "en X €»</b>. Un día más de alquiler añade <b>" + eur(fit.beta[1], 2) + "</b>, y las categorías de " +
      "nieve llevan la mayor prima sobre la base. Con un R² de <b>" + nf(fit.r2, 3) + "</b>, el precio " +
      "es explicable y por tanto <b>automatizable</b>: es la base de un motor de pricing.");
    note(c3, "La primera categoría, temporada y país presentes son el nivel de referencia y quedan " +
      "absorbidos en el intercepto.");
  } else {
    c3._chart.innerHTML = '<p class="note">La selección no tiene variación suficiente para ajustar el modelo.</p>';
  }

  /* --- Logit: cancelacion --- */
  const c4 = card("c5", "Qué dispara la cancelación (regresión logística)",
    "¿Qué multiplica las probabilidades de que una reserva se caiga?");
  grid.appendChild(c4);
  const memLv = [], chLv = [];
  for (let i = 0; i < N; i++) {
    if (!MASK[i] || F.lead[i] === 255 || !hasDays(i) || !F.member[i] || !F.channel[i]) continue;
    if (!memLv.includes(F.member[i])) memLv.push(F.member[i]);
    if (!chLv.includes(F.channel[i])) chLv.push(F.channel[i]);
  }
  memLv.sort((a, b) => a - b); chLv.sort((a, b) => a - b);
  // Mismo motivo que en la OLS, agravado: el IRLS recorre las filas una vez por
  // iteracion, asi que un indexOf por fila se paga ~8 veces.
  const memPos = new Int8Array(D.members.length + 1).fill(-1);
  memLv.forEach((m, j) => { memPos[m] = j; });
  const chPos = new Int8Array(D.channels.length + 1).fill(-1);
  chLv.forEach((c, j) => { chPos[c] = j; });
  const lnames = ["Intercepto", "Antelación (por día)", "Duración (por día)"]
    .concat(memLv.slice(1).map(m => "Socio: " + D.members[m - 1]))
    .concat(chLv.slice(1).map(c => "Canal: " + D.channel_labels[c - 1]));
  const pLog = lnames.length;
  const logRows = cb => {
    const x = new Float64Array(pLog);
    for (let i = 0; i < N; i++) {
      if (!MASK[i] || F.lead[i] === 255 || !hasDays(i) || !F.member[i] || !F.channel[i]) continue;
      x.fill(0);
      x[0] = 1; x[1] = F.lead[i]; x[2] = F.days[i];
      const mi = memPos[F.member[i]]; if (mi > 0) x[2 + mi] = 1;
      const ci = chPos[F.channel[i]]; if (ci > 0) x[2 + memLv.length - 1 + ci] = 1;
      cb(x, F.flags[i] & 1);
    }
  };
  const lfit = logit(logRows, pLog);
  if (lfit) {
    chips(c4, [["Observaciones", nf(lfit.n)], ["Iteraciones IRLS", nf(lfit.iter)]]);
    dotplotCI(c4._chart, {
      items: lnames.map((nm, j) => ({
        label: nm, est: Math.exp(lfit.beta[j]),
        lo: Math.exp(lfit.beta[j] - 1.96 * lfit.se[j]),
        hi: Math.exp(lfit.beta[j] + 1.96 * lfit.se[j]),
        p: lfit.p[j], sig: lfit.p[j] < 0.05,
      })).filter((_, j) => j > 0),
      ref: 1, fmt: v => nf(v, 2), labelW: 160, rowH: 26, measure: "Odds ratio",
    });
    setTable(c4, ["Término", "Odds ratio", "IC 95 %", "p-valor", "Significativo"],
      lnames.map((nm, j) => [nm, nf(Math.exp(lfit.beta[j]), 3),
        nf(Math.exp(lfit.beta[j] - 1.96 * lfit.se[j]), 3) + " – " +
        nf(Math.exp(lfit.beta[j] + 1.96 * lfit.se[j]), 3),
        pval(lfit.p[j]), lfit.p[j] < 0.05 ? '<span class="sig">sí</span>' : '<span class="nosig">no</span>']));
    insight(c4, "Un <b>odds ratio &gt; 1</b> aumenta la probabilidad de cancelar y <b>&lt; 1</b> la " +
      "reduce; la línea vertical marca el 1, que es «no cambia nada». Los niveles altos de socio quedan " +
      "por debajo de 1 y la antelación por encima: <b>empujar membresía</b> y <b>acortar la ventana " +
      "entre reserva y uso</b> son las dos palancas que salen del modelo.");
  } else {
    c4._chart.innerHTML = '<p class="note">La selección no permite ajustar el modelo logístico.</p>';
  }

  /* --- IC de proporciones --- */
  const c5 = card("c6", "¿Cancelan menos los socios de nivel alto?",
    "Intervalos de confianza para la diferencia de proporciones");
  grid.appendChild(c5);
  const hi = [3, 4], lo = [1, 2];   // Premium+Gold vs Basic+Standard
  const s1 = hi.reduce((a, b) => a + A.member.canc[b], 0), n1 = hi.reduce((a, b) => a + A.member.n[b], 0);
  const s2 = lo.reduce((a, b) => a + A.member.canc[b], 0), n2 = lo.reduce((a, b) => a + A.member.n[b], 0);
  if (n1 > 30 && n2 > 30) {
    const tp = twoProportions(s1, n1, s2, n2);
    chips(c5, [["Diferencia", nf(tp.diff * 100, 2) + " pp"],
               ["Reducción relativa", nf(-tp.rel * 100, 1) + " %"],
               ["p-valor", pval(tp.p)]]);
    dotplotCI(c5._chart, {
      items: [
        { label: "Premium + Gold", est: tp.p1 * 100, lo: tp.ci1[0] * 100, hi: tp.ci1[1] * 100,
          p: tp.p, sig: tp.p < 0.05 },
        { label: "Basic + Standard", est: tp.p2 * 100, lo: tp.ci2[0] * 100, hi: tp.ci2[1] * 100,
          p: tp.p, sig: tp.p < 0.05 },
      ],
      ref: kpi.cancel(A.total, 0) * 100, fmt: v => nf(v, 2) + " %", labelW: 150, rowH: 34,
      measure: "Cancelación",
    });
    setTable(c5, ["Grupo", "Cancelaciones", "Reservas", "Tasa", "IC 95 %"], [
      ["Premium + Gold", nf(s1), nf(n1), pct(tp.p1, 2), pct(tp.ci1[0], 2) + " – " + pct(tp.ci1[1], 2)],
      ["Basic + Standard", nf(s2), nf(n2), pct(tp.p2, 2), pct(tp.ci2[0], 2) + " – " + pct(tp.ci2[1], 2)],
    ]);
    insight(c5, tp.p < 0.05
      ? "Los intervalos <b>no se solapan</b> y la diferencia es significativa (p " + pval(tp.p) + "): " +
        "convertir a un cliente a Premium o Gold reduce su cancelación de forma real, no por azar. Eso " +
        "<b>cuantifica el retorno</b> del programa en ingresos protegidos."
      : "La diferencia <b>no es estadísticamente significativa</b> en esta selección: no hay evidencia " +
        "suficiente para atribuir al nivel de socio la diferencia observada.");
    note(c5, "La línea vertical es la cancelación media de la selección.");
  } else {
    c5._chart.innerHTML = '<p class="note">Muestra insuficiente en la selección.</p>';
  }

  /* --- test A/B --- */
  const c6 = card("c6", "Test A/B · App frente a Online",
    "Si tratamos el canal como un experimento, ¿el resultado es real o azar?");
  grid.appendChild(c6);
  const iOnline = 1, iApp = 2;   // codigos de canal (1-based)
  if (A.channel.n[iApp] > 30 && A.channel.n[iOnline] > 30) {
    const ab = twoProportions(A.channel.canc[iApp], A.channel.n[iApp],
                              A.channel.canc[iOnline], A.channel.n[iOnline]);
    chips(c6, [["Uplift absoluto", nf(ab.diff * 100, 2) + " pp"],
               ["Uplift relativo", nf(ab.rel * 100, 1) + " %"],
               ["p-valor", pval(ab.p)],
               ["Decisión", ab.p < 0.05 ? "significativo" : "no significativo"]]);
    dotplotCI(c6._chart, {
      items: [
        { label: "Variante · App", est: ab.p1 * 100, lo: ab.ci1[0] * 100, hi: ab.ci1[1] * 100,
          p: ab.p, sig: ab.p < 0.05 },
        { label: "Control · Online", est: ab.p2 * 100, lo: ab.ci2[0] * 100, hi: ab.ci2[1] * 100,
          p: ab.p, sig: ab.p < 0.05 },
      ],
      ref: ab.p2 * 100, fmt: v => nf(v, 2) + " %", labelW: 150, rowH: 34, measure: "Cancelación",
    });
    setTable(c6, ["Grupo", "Cancelaciones", "Reservas", "Tasa", "IC 95 %"], [
      ["Variante · App", nf(A.channel.canc[iApp]), nf(A.channel.n[iApp]), pct(ab.p1, 2),
       pct(ab.ci1[0], 2) + " – " + pct(ab.ci1[1], 2)],
      ["Control · Online", nf(A.channel.canc[iOnline]), nf(A.channel.n[iOnline]), pct(ab.p2, 2),
       pct(ab.ci2[0], 2) + " – " + pct(ab.ci2[1], 2)],
    ]);
    insight(c6, ab.p < 0.05
      ? "Diferencia significativa: el canal <b>sí</b> influye en la cancelación."
      : "<b>No significativo</b>: no hay evidencia de que el canal cambie la cancelación. En un despliegue " +
        "real, esto es motivo para <b>no lanzar</b> el cambio y evitar un falso positivo.");
    note(c6, "Es un contraste observacional, no un experimento aleatorizado: los usuarios eligen canal, " +
      "así que la diferencia puede recoger el perfil del usuario y no el efecto del canal. La mecánica " +
      "del contraste sí es idéntica a la de un A/B.");
  } else {
    c6._chart.innerHTML = '<p class="note">Muestra insuficiente en la selección.</p>';
  }

  recoBlock(grid, "estadistica");
}

/* --------------------------- indice de paginas ----------------------------
   `group` decide en que mitad de la barra de navegacion cae cada pagina:
   "negocio" son las que responden a una pregunta del negocio, "metodo" las dos
   que responden por el propio analisis (de donde sale el dato y cuanto aguanta
   estadisticamente). El orden del array es el que ve el usuario.

   Ojo al reordenar: `state.page` guarda el INDICE de este array (05_ui.js), no
   el `id`. No hay routing por hash, asi que reordenar no rompe ningun enlace,
   pero la posicion 0 tiene que seguir siendo la pagina de entrada. */
