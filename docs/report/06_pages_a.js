/* ===========================================================================
   Paginas 1-4: resumen, calidad del dato, demanda y producto.
   =========================================================================== */

/* --------------------------- 1 · Resumen ----------------------------------

   La portada responde, en este orden, las preguntas que se hace quien abre el
   informe por primera vez:

     como va         -> siete indicadores con su variacion contra el periodo anterior
     hacia donde va  -> ingresos del mes contra el mismo mes del ano anterior
     rinde el activo -> ocupacion de la flota, global y por categoria
     donde esta      -> peso por deporte y reparto geografico
     que sube y baja -> crecimiento por categoria contra los 12 meses anteriores

   Antes eran cuatro tarjetas y tres de ellas eran barras horizontales. La forma
   de cada una sale ahora de la naturaleza del dato: serie temporal -> area,
   indice unico -> arco, composicion -> treemap, geografia -> mapa, variacion con
   signo -> barras divergentes. Las dos tarjetas de reparto conservan la lectura
   en barras detras de un conmutador: el treemap y el mapa cuentan mejor la
   proporcion, pero para comparar dos valores parecidos nada gana a una barra.
   -------------------------------------------------------------------------- */

/* Vista elegida en las tarjetas conmutables. Fuera de la funcion porque
   `render()` recrea las tarjetas enteras en cada cambio de filtro. */
const catView = { mode: "treemap" };
const geoResumenView = { mode: "map" };
const growthView = { measure: "pct" };

function pageResumen(grid) {
  kpiRow(grid);

  /* -- Evolucion de ingresos ------------------------------------------------
     La version anterior superponia la serie y su media movil de 3 meses: dos
     trazos para una sola magnitud, y el segundo era un artefacto de calculo que
     ademas aplanaba justo los picos que sostienen el negocio. La comparacion
     util en un negocio estacional es contra el MISMO MES del ano anterior: dice
     si el pico de esta temporada ha sido mejor que el de la anterior, que es la
     pregunta real. Las dos series son euros sobre un unico eje, asi que no hay
     doble eje ni escalas que insinuen correlaciones inexistentes. */
  const c1 = card("c8", "Ingresos mensuales frente al año anterior",
    "¿Cómo se mueve el negocio y va mejor que hace doce meses?");
  grid.appendChild(c1);
  const months = [], rev = [];
  for (let m = M0; m <= M1; m++) { months.push(D.months[m]); rev.push(A.month.rev[m]); }
  // La serie del ano anterior cae fuera de la ventana filtrada, asi que necesita
  // su propia agregacion sobre la ventana desplazada 12 meses (mismos filtros).
  const hasYoY = M1 - 12 >= 0;
  const AY = hasYoY ? revSlice(M0 - 12, M1 - 12) : null;
  const yoy = months.map((_, i) => {
    const m = M0 + i - 12;
    return hasYoY && m >= 0 ? AY.month[m] : null;
  });
  const series = [{ name: "Ingresos del mes", values: rev, color: SERIES(0), area: true }];
  if (hasYoY) series.push({ name: "Mismo mes del año anterior", values: yoy,
                            color: cssVar("--ink-2"), width: 1.4, dash: "4 4" });
  legend(c1, [{ name: "Ingresos del mes", color: SERIES(0) }].concat(hasYoY
    ? [{ name: "Mismo mes del año anterior", color: cssVar("--ink-2"), line: true, dash: true }]
    : []));
  lineChart(c1._chart, {
    height: 350, x: months.map(monthLabel), xTitle: i => monthLabel(months[i]),
    series,
    fmtY: v => compact(v) + " €", fmtTip: v => eur(v),
    extraTip: i => {
      const base = yoy[i], cur = rev[i];
      const va = base ? (cur - base) / base : null;
      return [["Alquileres", nf(A.month.n[M0 + i])],
              ["Ticket medio", eur(kpi.ticket(A.month, M0 + i), 2)],
              ["Variación interanual", va == null ? "—" :
                (va >= 0 ? "+" : "−") + nf(Math.abs(va) * 100, 1) + " %"]];
    },
  });
  setTable(c1, ["Mes", "Ingresos", "Año anterior", "Var. interanual", "Alquileres", "Ticket medio", "Cancelación"],
    months.map((m, i) => {
      const base = yoy[i];
      const va = base ? (rev[i] - base) / base : null;
      return [m, eur(rev[i]), base == null ? "—" : eur(base),
        va == null ? "—" : (va >= 0 ? "+" : "−") + nf(Math.abs(va) * 100, 1) + " %",
        nf(A.month.n[M0 + i]), eur(kpi.ticket(A.month, M0 + i), 2),
        pct(kpi.cancel(A.month, M0 + i), 2)];
    }));
  const paired = months.map((_, i) => i).filter(i => yoy[i] > 0);
  const yoyAgg = paired.length
    ? paired.reduce((a, i) => a + rev[i], 0) / paired.reduce((a, i) => a + yoy[i], 0) - 1
    : null;
  insight(c1, yoyAgg != null
    ? "Doble pico estacional sobre una tendencia de fondo positiva: los meses con " +
      "comparable facturan un <b>" + (yoyAgg >= 0 ? "+" : "−") + nf(Math.abs(yoyAgg) * 100, 1) +
      " %</b> respecto al mismo mes del año anterior. Donde la línea gris queda por debajo del " +
      "área, ese mes ha batido a su equivalente: la compra de inventario y las campañas deben " +
      "adelantarse uno o dos meses a cada pico."
    : "La selección no alcanza a cubrir doce meses previos, así que no hay comparable " +
      "interanual: la serie se lee sola.");

  /* -- Ocupacion de la flota ------------------------------------------------
     En un negocio de alquiler el activo es el material, y su rendimiento es el
     % del tiempo que esta fuera trabajando. Es el unico de los siete KPI de
     arriba que no se entiende sin contexto —un 47 % no dice nada por si solo—,
     asi que se le da el arco y el desglose por categoria: ahi es donde se ve
     que el promedio esconde inventario parado en unas y saturado en otras. */
  const c2 = card("c4", "Ocupación de la flota", "¿Está trabajando el material o parado?");
  grid.appendChild(c2);
  const occGlobal = occupancy(A);
  const occCats = occupancyByCategory().sort((a, b) => b.occ - a.occ);
  /* La escala del arco NO llega al 100 %. Con esta flota la ocupacion se mueve
     entre el 2 % y el 9 %, y un arco de 0 a 100 dejaria todas las marcas
     pegadas al origen: se veria que la cifra es baja y nada mas. Se recorta a la
     siguiente marca redonda por encima del maximo, con los dos topes escritos
     en el propio arco para que la escala no se lea como si fuese 0–100. La
     magnitud absoluta la dice el numero grande y la remata el insight. */
  const occVals = occCats.map(d => d.occ * 100).concat(isFinite(occGlobal) ? [occGlobal * 100] : []);
  const gTicks = niceTicks(Math.max(...occVals, 1), 2);
  const gMax = gTicks[gTicks.length - 1];
  gauge(c2._chart, {
    value: isFinite(occGlobal) ? occGlobal * 100 : 0, max: gMax, rowH: 22,
    fmtValue: v => nf(v, 1) + " %", fmtEnd: v => nf(v, 0) + " %", fmtDim: v => nf(v, 1) + " %",
    title: "Ocupación de la flota",
    tipRows: [["Ocupación", pct(occGlobal)],
              ["Días alquilados", nf(occCats.reduce((a, b) => a + b.days, 0))],
              ["Unidades con actividad", nf(occCats.reduce((a, b) => a + b.units, 0))],
              ["Días del periodo", nf(PDAYS)],
              ["Escala del arco", "0 – " + nf(gMax, 0) + " %"]],
    dims: occCats.map(d => ({
      label: d.c, value: d.occ * 100,
      rows: [["Ocupación", pct(d.occ)], ["Unidades", nf(d.units)],
             ["Referencias", nf(d.refs)], ["Ingresos", eur(A.cat.rev[d.i])],
             ["€ por unidad", eur(d.units ? A.cat.rev[d.i] / d.units : NaN)]],
    })),
  });
  setTable(c2, ["Categoría", "Ocupación", "Unidades", "Referencias", "Ingresos", "€ por unidad"],
    occCats.slice().sort((a, b) => b.occ - a.occ).map(d => [d.c, pct(d.occ), nf(d.units),
      nf(d.refs), eur(A.cat.rev[d.i]), eur(d.units ? A.cat.rev[d.i] / d.units : NaN)]));
  /* Un solo bloque de texto, y escrito para alguien que no sabe que es una tasa
     de ocupacion. Antes habia dos —una nota tecnica con la formula y un insight
     con la lectura— y entre los dos estiraban la tarjeta muy por encima de la
     grafica de al lado, ademas de repetirse. */
  const best = occCats[0], worst = occCats[occCats.length - 1];
  const per100 = isFinite(occGlobal) ? occGlobal * 100 : NaN;
  note(c2, "<b>Qué mide:</b> de cada 100 días que una unidad del catálogo podría estar " +
    "alquilada, lo está <b>" + nf(per100, 1) + "</b>. El resto del tiempo espera en la tienda." +
    (occCats.length > 1
      ? " Cada barra es lo mismo por deporte: <b>" + best.c + "</b> se alquila " +
        nf(worst.occ ? best.occ / worst.occ : NaN, 1) + " veces más que <b>" + worst.c +
        "</b>, así que hay margen para mover unidades de uno a otro sin comprar nada."
      : "") +
    " El arco llega al " + nf(gMax, 0) + " %, no al 100 %, para que se aprecien esas " +
    "diferencias; al filtrar por país la cifra se queda corta.");

  /* -- Composicion por categoria -------------------------------------------
     El treemap dice la proporcion sin ejes; la barra compara mejor dos valores
     parecidos. Ninguna de las dos gana siempre, asi que decide quien mira. */
  const c3 = card("c5", "Peso de cada deporte", "¿Qué categorías sostienen la cuenta?");
  grid.appendChild(c3);
  const cats = D.categories.map((c, i) => ({ i, c })).filter(d => A.cat.rev[d.i] > 0)
    .sort((a, b) => A.cat.rev[b.i] - A.cat.rev[a.i]);
  const catRows = d => [["Ingresos", eur(A.cat.rev[d.i])],
                        ["Peso del total", pct(A.cat.rev[d.i] / A.total.rev[0], 1)],
                        ["Alquileres", nf(A.cat.n[d.i])],
                        ["Ticket medio", eur(kpi.ticket(A.cat, d.i), 2)],
                        ["Margen", pct(kpi.margin(A.cat, d.i))]];
  const drawCats = () => {
    if (catView.mode === "treemap") {
      treemapFlat(c3._chart, {
        height: 340, fmt: v => compact(v) + " €",
        items: cats.map(d => ({ label: d.c, value: A.cat.rev[d.i], rows: catRows(d) })),
      });
    } else {
      barsH(c3._chart, {
        rowH: 26, labelW: 104, valueW: 68, fmt: v => compact(v) + " €", measure: "Ingresos",
        items: cats.map(d => ({ label: d.c, value: A.cat.rev[d.i], rows: catRows(d) })),
      });
    }
  };
  segmented(c3, [{
    label: "Ver como", store: catView, key: "mode",
    options: [{ id: "treemap", label: "Treemap" }, { id: "bars", label: "Barras" }],
  }], drawCats);
  drawCats();
  setTable(c3, ["Categoría", "Ingresos", "% del total", "Alquileres", "Ticket", "Margen", "Review"],
    cats.map(d => [d.c, eur(A.cat.rev[d.i]), pct(A.cat.rev[d.i] / A.total.rev[0], 1),
      nf(A.cat.n[d.i]), eur(kpi.ticket(A.cat, d.i), 2), pct(kpi.margin(A.cat, d.i)),
      nf(kpi.review(A.cat, d.i), 2)]));
  // Si la seleccion no deja ninguna categoria con ingreso (todo cancelado, por
  // ejemplo) la nota no tiene nada que resumir y se calla en vez de romper.
  note(c3, cats.length
    ? "En treemap el área es el ingreso y la intensidad lo acompaña; en barras se comparan " +
      "mejor dos categorías parecidas. Las dos primeras suman " +
      pct((A.cat.rev[cats[0].i] + (cats[1] ? A.cat.rev[cats[1].i] : 0)) / A.total.rev[0], 1) +
      " de la facturación de la selección."
    : "Ninguna categoría registra ingreso en la selección: todos los alquileres están " +
      "cancelados o llegan sin precio.");

  /* -- Reparto geografico --------------------------------------------------- */
  const c4 = card("c7", "Reparto por mercado", "¿Dónde está el negocio sobre el terreno?");
  grid.appendChild(c4);
  const cityList = cityRollup(storeMetrics());
  const countries = D.countries.map((c, i) => ({ b: i + 1, c }))
    .concat([{ b: 0, c: "Sin tienda asignada", muted: true }])
    .filter(d => A.country.rev[d.b] > 0)
    .sort((a, b) => A.country.rev[b.b] - A.country.rev[a.b]);
  const drawGeo = () => {
    if (geoResumenView.mode === "map") {
      geoMap(c4._chart, {
        height: 380, level: "country", countries: geoCountryGroups(cityList, true),
        fmt: v => compact(v) + " €", measureLabel: "Ingresos",
      });
    } else {
      barsH(c4._chart, {
        rowH: 30, labelW: 132, valueW: 74, fmt: v => compact(v) + " €", measure: "Ingresos",
        items: countries.map(d => ({
          label: d.c, value: A.country.rev[d.b], muted: d.muted,
          rows: [["Ingresos", eur(A.country.rev[d.b])], ["Alquileres", nf(A.country.n[d.b])],
                 ["Ticket medio", eur(kpi.ticket(A.country, d.b), 2)],
                 ["Cancelación", pct(kpi.cancel(A.country, d.b), 2)]],
        })),
      });
    }
  };
  segmented(c4, [{
    label: "Ver como", store: geoResumenView, key: "mode",
    options: [{ id: "map", label: "Mapa" }, { id: "bars", label: "Barras" }],
  }], drawGeo);
  drawGeo();
  setTable(c4, ["País", "Ingresos", "Alquileres", "Ticket", "Cancelación", "Review"],
    countries.map(d => [d.c, eur(A.country.rev[d.b]), nf(A.country.n[d.b]),
      eur(kpi.ticket(A.country, d.b), 2), pct(kpi.cancel(A.country, d.b), 2),
      nf(kpi.review(A.country, d.b), 2)]));
  note(c4, "El mapa da la lectura geográfica y las barras el orden exacto. Un " +
    pct(A.country.rev[0] / A.total.rev[0], 1) + " de los ingresos llega sin tienda asignada: " +
    "no es localizable, así que aparece en las barras y en la tabla, pero no en el mapa. " +
    "La página de tiendas permite bajar a ciudad.");

  /* -- Crecimiento por categoria --------------------------------------------
     Sustituye al puente de variacion que habia aqui. El puente era correcto pero
     exigia reconstruir una suma para leerlo; estas barras salen de una linea de
     cero y el lado ya dice el sentido, sin ningun paso intermedio.

     Se compara siempre contra los doce meses inmediatamente anteriores, esten
     dentro o fuera de la seleccion: es la unica ventana comparable que existe
     para cualquier periodo con dos anos de historia por detras. */
  const c5 = card("c12", "Crecimiento por categoría",
    "¿Qué deportes tiran del negocio y cuáles lo frenan?");
  grid.appendChild(c5);
  if (M1 - 23 < 0) {
    c5._chart.innerHTML = "";
    const msg = document.createElement("p");
    msg.className = "prose";
    msg.innerHTML = "La comparación necesita los <b>doce meses anteriores</b> a los últimos " +
      "doce, y la selección no tiene veinticuatro meses de historia por detrás. Amplía el " +
      "periodo para verla.";
    c5._chart.appendChild(msg);
    c5.querySelector(".tbtn").remove();
  } else {
    const AR = revSlice(M1 - 11, M1);
    const AB = revSlice(M1 - 23, M1 - 12);
    const all = D.categories.map((c, i) => ({
      label: c, cur: AR.cat[i], prev: AB.cat[i],
      abs: AR.cat[i] - AB.cat[i],
      rel: AB.cat[i] > 0 ? (AR.cat[i] - AB.cat[i]) / AB.cat[i] * 100 : null,
    })).filter(d => d.cur > 0 || d.prev > 0);
    const net = AR.total - AB.total;
    chips(c5, [
      ["12 meses anteriores", eur(AB.total)],
      ["Últimos 12 meses", eur(AR.total)],
      ["Variación", (net >= 0 ? "+" : "−") + eur(Math.abs(net)),
       AB.total ? (net >= 0 ? "+" : "−") + nf(Math.abs(net / AB.total) * 100, 1) + " %" : ""],
    ]);
    const drawGrowth = () => {
      const byPct = growthView.measure === "pct";
      // En porcentaje se excluye la categoria que partia de cero: su crecimiento
      // no es un numero, y meterla como "infinito" desordenaria toda la escala.
      const items = all.filter(d => !byPct || d.rel != null)
        .map(d => ({
          label: d.label, value: byPct ? d.rel : d.abs,
          rows: [["12 meses anteriores", eur(d.prev)], ["Últimos 12 meses", eur(d.cur)],
                 ["Variación", (d.abs >= 0 ? "+" : "−") + eur(Math.abs(d.abs))],
                 ["Variación relativa", d.rel == null ? "sin base de comparación"
                   : (d.rel >= 0 ? "+" : "−") + nf(Math.abs(d.rel), 1) + " %"]],
        }))
        .sort((a, b) => b.value - a.value);
      barsDiverging(c5._chart, {
        items, rowH: 27, labelW: 128, valueW: byPct ? 56 : 66,
        fmt: byPct ? v => nf(v, 1) + " %" : v => compact(v) + " €",
        xLabel: byPct ? "Variación sobre los mismos meses del año anterior"
                      : "Euros ganados o perdidos frente a los mismos meses del año anterior",
      });
    };
    segmented(c5, [{
      label: "Medir en", store: growthView, key: "measure",
      options: [{ id: "pct", label: "%" }, { id: "abs", label: "€" }],
    }], drawGrowth);
    drawGrowth();
    setTable(c5, ["Categoría", "12 meses anteriores", "Últimos 12 meses", "Variación", "Variación %"],
      all.slice().sort((a, b) => b.abs - a.abs).map(d => [d.label, eur(d.prev), eur(d.cur),
        (d.abs >= 0 ? "+" : "−") + eur(Math.abs(d.abs)),
        d.rel == null ? "—" : (d.rel >= 0 ? "+" : "−") + nf(Math.abs(d.rel), 1) + " %"])
        .concat([["Total", eur(AB.total), eur(AR.total),
          (net >= 0 ? "+" : "−") + eur(Math.abs(net)),
          AB.total ? nf(net / AB.total * 100, 1) + " %" : "—"]]));
    note(c5, "Ventanas comparadas: " + monthLabel(D.months[M1 - 23]) + " – " +
      monthLabel(D.months[M1 - 12]) + " frente a " + monthLabel(D.months[M1 - 11]) + " – " +
      monthLabel(D.months[M1]) + ". En <b>%</b> se ve qué categoría crece más deprisa; en " +
      "<b>€</b>, cuál mueve de verdad la facturación. No suelen ser la misma.");
    const sorted = all.slice().sort((a, b) => b.abs - a.abs);
    const win = sorted[0], lose = sorted[sorted.length - 1];
    insight(c5, win && lose && win !== lose
      ? "<b>" + win.label + "</b> aporta <b>" + (win.abs >= 0 ? "+" : "−") +
        eur(Math.abs(win.abs)) + "</b> y <b>" + lose.label + "</b> resta <b>" +
        eur(lose.abs) + "</b>. Cuando el saldo neto es pequeño no significa que no pase nada: " +
        "puede ser una recomposición, con categorías moviéndose fuerte en sentidos opuestos."
      : "Todas las categorías con peso se mueven en el mismo sentido en esta selección.");
  }

  /* La portada cierra con la decision, no con el ultimo grafico: las cinco
     recomendaciones de mas retorno del informe entero, cada una enlazando a la
     pagina donde se desarrolla. */
  recoTop(grid);
}

/* --------------------------- 2 · Calidad ---------------------------------- */
function pageCalidad(grid) {
  const Q = DATA.quality;

  const c1 = card("c4", "Dimensiones del índice", "¿Por dónde falla el dato de origen?", "histórico completo");
  grid.appendChild(c1);
  chips(c1, [["Data Trust Score", nf(Q.score, 2), "/ 100"]]);
  barsH(c1._chart, {
    items: Q.dims.map(d => ({ label: d.dim, value: d.valor,
      rows: [["Cumplimiento", nf(d.valor, 2) + " %"], ["Peso", pct(d.peso, 0)]] })),
    rowH: 30, labelW: 106, valueW: 54, fmt: v => nf(v, 1) + " %",
  });
  setTable(c1, ["Dimensión", "Cumplimiento", "Peso"],
    Q.dims.map(d => [d.dim, nf(d.valor, 2) + " %", pct(d.peso, 0)]));
  insight(c1, "El índice pondera <b>validez</b> (35 %), <b>completitud</b> (30 %), <b>unicidad</b> " +
    "(20 %) y <b>consistencia</b> (15 %). Un solo número que baja de golpe es la señal que dispararía " +
    "la alerta en producción.");

  const c2 = card("c4", "Valores faltantes por columna", "¿Qué información llega incompleta?", "histórico completo");
  grid.appendChild(c2);
  barsH(c2._chart, {
    items: Q.missing.slice(0, 12).map(m => ({ label: m.columna, value: m.pct,
      rows: [["Nulos", nf(m.n)], ["Sobre el total", nf(m.pct, 2) + " %"]] })),
    rowH: 24, labelW: 148, valueW: 54, fmt: v => nf(v, 1) + " %", measure: "% nulos",
  });
  setTable(c2, ["Columna", "Nulos", "% del total"],
    Q.missing.map(m => [m.columna, nf(m.n), nf(m.pct, 2) + " %"]));
  insight(c2, "<b>store_id</b> es el nulo que importa: sin él no se sabe dónde se registró el alquiler, " +
    "pero el ingreso es real. Se conserva con LEFT JOIN en vez de descartarlo.");

  const c3 = card("c4", "Reglas de negocio incumplidas", "¿Cuánto dato es imposible?", "histórico completo");
  grid.appendChild(c3);
  barsH(c3._chart, {
    items: Q.invalid.map(r => ({ label: r.regla, value: r.n,
      rows: [["Filas", nf(r.n)], ["Sobre el total", nf(r.pct, 3) + " %"]] })),
    rowH: 28, labelW: 176, valueW: 54, fmt: v => nf(v), measure: "Filas",
  });
  setTable(c3, ["Regla", "Filas", "% del total"],
    Q.invalid.map(r => [r.regla, nf(r.n), nf(r.pct, 3) + " %"]));
  insight(c3, "Criterio conservador: el valor imposible se <b>anula</b>, la fila se conserva. El resto " +
    "de sus campos sigue siendo información válida.");

  const c4 = card("c6", "Duplicados y categorías inconsistentes", "¿Sobrevive la clave primaria?", "histórico completo");
  grid.appendChild(c4);
  chips(c4, [
    ["Filas crudas", nf(Q.n_raw)],
    ["Tras deduplicar", nf(Q.n_clean)],
    ["Filas idénticas", nf(Q.exact_dups)],
    ["PK repetidas", nf(Q.dup_ids)],
  ]);
  tableOnly(c4, ["Problema", "Cuántos", "Decisión"], [
    ["Fila 100 % duplicada", nf(Q.exact_dups), "Eliminar: no se pierde información"],
    ["rental_id repetido con datos en conflicto", nf(Q.dup_ids - Q.exact_dups),
     "Regla de negocio: conservar el registro más completo y, en empate, el más reciente"],
    ["Categorías mal escritas", nf(Q.dirty_categories.length),
     Q.dirty_categories.join(", ") + " → catálogo canónico"],
  ]);
  insight(c4, "Una PK duplicada esconde <b>dos problemas distintos</b>. La fila idéntica es un reintento " +
    "del ETL y se deduplica sin más. La PK repetida con datos en conflicto es una <b>colisión de " +
    "identificadores</b>: se resuelve con una regla explícita y se escala al sistema origen.");

  const c5 = card("c6", "Outliers por variable (regla de Tukey)",
    "¿Qué valores se salen del rango esperable en la selección actual?");
  grid.appendChild(c5);
  const vars = [
    { label: "rental_price", box: boxStats(collect(() => 0, i => F.price[i] / 100, 1, i => hasPrice(i))[0]), fmt: v => eur(v, 2) },
    { label: "rental_days", box: boxStats(collect(() => 0, i => F.days[i], 1, i => hasDays(i))[0]), fmt: v => nf(v, 1) },
    { label: "maintenance_cost", box: boxStats(collect(() => 0, i => F.maint[i] / 100, 1, i => !((F.flags[i] >> 5) & 1))[0]), fmt: v => eur(v, 2) },
    { label: "reservation_lead_time", box: boxStats(collect(() => 0, i => F.lead[i] === 255 ? null : F.lead[i], 1)[0]), fmt: v => nf(v, 1) },
  ].filter(v => v.box);
  tableOnly(c5, ["Variable", "Q1", "Mediana", "Q3", "Límite inf.", "Límite sup.", "Outliers", "%"],
    vars.map(v => [v.label, v.fmt(v.box.q1), v.fmt(v.box.med), v.fmt(v.box.q3),
      v.fmt(v.box.loLim), v.fmt(v.box.hiLim), nf(v.box.nOut), pct(v.box.nOut / v.box.n, 2)]));
  insight(c5, "Calculado sobre el dato <b>ya limpio</b>: los outliers técnicos (precios inflados ×50, " +
    "duraciones de 999 días) han desaparecido, así que lo que queda es <b>dispersión legítima del " +
    "negocio</b> —alquileres largos de esquí, material caro— y no debe recortarse.");

  recoBlock(grid, "calidad");
}

/* --------------------------- 3 · Demanda ---------------------------------- */
function pageDemanda(grid) {
  const c1 = card("c8", "Estacionalidad de la demanda",
    "¿Cuándo se alquila cada categoría y cuánto tiempo duerme el inventario?");
  grid.appendChild(c1);
  const rowsIdx = D.categories.map((c, i) => i).filter(i => {
    let s = 0; for (let m = 0; m < 12; m++) s += A.catMonth.n[i * 12 + m]; return s > 0;
  });
  const totals = rowsIdx.map(i => {
    let s = 0; for (let m = 0; m < 12; m++) s += A.catMonth.n[i * 12 + m]; return s;
  });
  const vals = rowsIdx.map((i, r) => Array.from({ length: 12 },
    (_, m) => totals[r] ? 100 * A.catMonth.n[i * 12 + m] / totals[r] : 0));
  heatmap(c1._chart, {
    rows: rowsIdx.map(i => D.categories[i]), cols: MONTH_SHORT, values: vals,
    norm: (v, i) => v / Math.max(...vals[i], 1), fmt: v => nf(v, 0) + " %",
    measure: "% de la categoría", cellH: 26, labelW: 96,
    extra: (i, j) => [["Alquileres", nf(A.catMonth.n[rowsIdx[i] * 12 + j])],
                      ["Ingresos", eur(A.catMonth.rev[rowsIdx[i] * 12 + j])]],
  });
  scaleLegend(c1, "mes flojo de la categoría", "mes pico");
  setTable(c1, ["Categoría"].concat(MONTH_SHORT),
    rowsIdx.map((i, r) => [D.categories[i]].concat(vals[r].map(v => nf(v, 1) + " %"))));
  const peak = rowsIdx.map((i, r) => ({
    cat: D.categories[i],
    top3: vals[r].slice().sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0),
  })).sort((a, b) => b.top3 - a.top3);
  insight(c1, "Cada fila se normaliza sobre su propio total, así que el color compara meses dentro de " +
    "la categoría y no categorías entre sí. <b>" + peak[0].cat + "</b> concentra el <b>" +
    nf(peak[0].top3, 0) + " %</b> de su demanda en tres meses: ese inventario está parado el resto del " +
    "año y ahí es donde se pierde margen que no se recupera.");

  const c2 = card("c4", "Demanda por temporada", "¿Cómo se reparte el año?");
  grid.appendChild(c2);
  barsV(c2._chart, {
    height: 230, items: D.season_labels.map((s, i) => ({
      label: s, value: A.season.rev[i],
      rows: [["Ingresos", eur(A.season.rev[i])], ["Alquileres", nf(A.season.n[i])],
             ["Ticket medio", eur(kpi.ticket(A.season, i), 2)],
             ["Duración media", nf(kpi.avgDays(A.season, i), 2) + " días"]],
    })), fmt: v => compact(v) + " €", measure: "Ingresos",
  });
  setTable(c2, ["Temporada", "Ingresos", "Alquileres", "Ticket", "Duración media"],
    D.season_labels.map((s, i) => [s, eur(A.season.rev[i]), nf(A.season.n[i]),
      eur(kpi.ticket(A.season, i), 2), nf(kpi.avgDays(A.season, i), 2) + " días"]));

  const c3 = card("c8", "Ingresos semanales y anomalías",
    "¿Alguna semana se sale del patrón y merece que alguien la mire?");
  grid.appendChild(c3);
  const startDay = D.month_offset[M0];
  const endDay = D.month_offset[M1] + periodDays(M1, M1) - 1;
  const w0 = Math.floor(startDay / 7) + 1, w1 = Math.floor(endDay / 7) - 1;   // sin semanas parciales
  const weeks = [], wrev = [];
  for (let w = w0; w <= w1; w++) { weeks.push(w); wrev.push(A.weekRev[w] || 0); }
  if (wrev.length >= 8) {
    const an = robustAnomalies(wrev, 13, 5);
    const dateOf = w => {
      const d = new Date(Date.UTC(+D.months[0].slice(0, 4), +D.months[0].slice(5, 7) - 1, 1));
      d.setUTCDate(d.getUTCDate() + w * 7);
      return d.getUTCDate() + " " + MONTH_SHORT[d.getUTCMonth()] + " " + String(d.getUTCFullYear()).slice(2);
    };
    legend(c3, [{ name: "Ingresos de la semana", color: SERIES(0) },
                { name: "Tendencia local (mediana móvil)", color: cssVar("--neutral-mark"), line: true },
                { name: "Semana señalada (|z| > 5)", color: cssVar("--bad") }]);
    lineChart(c3._chart, {
      height: 250, x: weeks.map(dateOf), xTitle: i => "Semana del " + dateOf(weeks[i]),
      series: [{ name: "Ingresos", values: wrev, color: SERIES(0), width: 1.6 },
               { name: "Tendencia local", values: Array.from(an.base), color: cssVar("--neutral-mark") }],
      marks: an.flagged.map(i => ({ i, v: wrev[i] })),
      fmtY: v => compact(v) + " €", fmtTip: v => eur(v),
      extraTip: i => [["z robusto", nf(an.z[i], 2)], ["Alquileres", nf(A.weekN[weeks[i]] || 0)]],
    });
    setTable(c3, ["Semana", "Ingresos", "Alquileres", "Tendencia local", "z robusto", "Estado"],
      weeks.map((w, i) => [dateOf(w), eur(wrev[i]), nf(A.weekN[w] || 0), eur(an.base[i]),
        nf(an.z[i], 2), Math.abs(an.z[i]) > 5 ? '<span class="sig">revisar</span>' : "normal"]));
    insight(c3, an.flagged.length
      ? "<b>" + an.flagged.length + " semana(s)</b> superan un z robusto de 5 sobre su tendencia local. " +
        "El z se calcula con mediana y MAD, insensibles a los propios outliers, para que un pico no " +
        "eleve el umbral y se esconda a sí mismo."
      : "Ninguna semana supera el umbral: la serie se mueve dentro de su variabilidad normal. " +
        "El z usa mediana y MAD para que un pico no eleve el propio umbral que debería detectarlo.");
    note(c3, "Se descartan la primera y la última semana del rango por estar incompletas.");
  } else {
    c3._chart.innerHTML = '<p class="note">La selección es demasiado corta para una serie semanal.</p>';
  }

  const c4 = card("c4", "Demanda por día de la semana", "¿Es un negocio de fin de semana?");
  grid.appendChild(c4);
  barsV(c4._chart, {
    height: 230, items: DOW_SHORT.map((s, i) => ({
      label: s, value: A.dow.n[i], muted: i < 5,
      rows: [["Alquileres", nf(A.dow.n[i])], ["Ingresos", eur(A.dow.rev[i])],
             ["Ticket medio", eur(kpi.ticket(A.dow, i), 2)]],
    })), fmt: v => compact(v), measure: "Alquileres",
  });
  legend(c4, [{ name: "Fin de semana", color: SERIES(0) },
              { name: "Entre semana", color: cssVar("--neutral-mark") }]);
  setTable(c4, ["Día", "Alquileres", "Ingresos", "Ticket medio"],
    DOW_SHORT.map((s, i) => [s, nf(A.dow.n[i]), eur(A.dow.rev[i]), eur(kpi.ticket(A.dow, i), 2)]));
  const we = A.dow.n[5] + A.dow.n[6], wd = A.dow.n.reduce((a, b) => a + b, 0) - we;
  insight(c4, "Sábado y domingo concentran el <b>" + pct(we / (we + wd), 0) + "</b> de los alquileres " +
    "con solo dos de siete días. Es la ventana natural para pricing de fin de semana y para dimensionar " +
    "el personal de tienda.");

  const c5 = card("c6", "Duración del alquiler", "¿Cuántos días se lleva el material?");
  grid.appendChild(c5);
  const maxDay = 15;
  barsV(c5._chart, {
    height: 220, items: Array.from({ length: maxDay }, (_, k) => ({
      label: String(k + 1), value: A.daysHist[k + 1] || 0,
      rows: [["Alquileres", nf(A.daysHist[k + 1] || 0)],
             ["Peso", pct((A.daysHist[k + 1] || 0) / A.total.comp[0], 1)]],
    })), fmt: v => compact(v), measure: "Alquileres",
  });
  setTable(c5, ["Días", "Alquileres", "Peso"],
    Array.from({ length: 30 }, (_, k) => k + 1).filter(k => A.daysHist[k])
      .map(k => [k, nf(A.daysHist[k]), pct(A.daysHist[k] / A.total.comp[0], 2)]));
  insight(c5, "Duración media de <b>" + nf(kpi.avgDays(A.total, 0), 2) + " días</b>. La masa está en " +
    "alquileres cortos, con una cola larga que arrastran esquí y camping: por eso el precio se compara " +
    "siempre <b>por día</b> y no por ticket.");

  const c6 = card("c6", "Antelación de la reserva por categoría",
    "¿Cuánto margen hay entre que se reserva y se usa?");
  grid.appendChild(c6);
  const leadBuckets = collect(i => rowCat[i], i => F.lead[i] === 255 ? null : F.lead[i], D.categories.length);
  const leadItems = D.categories.map((c, i) => ({ label: c, box: boxStats(leadBuckets[i]) }))
    .filter(d => d.box).sort((a, b) => b.box.med - a.box.med);
  boxplot(c6._chart, { items: leadItems, fmt: v => nf(v, 0) + " d", labelW: 104, rowH: 28 });
  setTable(c6, ["Categoría", "Mediana", "Q1", "Q3", "Bigote sup.", "Observaciones"],
    leadItems.map(d => [d.label, nf(d.box.med, 0) + " d", nf(d.box.q1, 0), nf(d.box.q3, 0),
      nf(d.box.hi, 0), nf(d.box.n)]));
  insight(c6, "Las categorías de nieve se reservan con semanas de antelación; las de proximidad, casi " +
    "el mismo día. Un lead time largo da margen para arrepentirse: es un <b>driver de cancelación</b> " +
    "y se confirma en la regresión logística de la página de estadística.");

  /* Ciclo de vida del alquiler. Los cuatro estados finales necesitan el cruce
     tardio x averia, que ningun bucket agregado guarda: se recorre la mascara.
     `late` y `dmg` solo se acumulan sobre completados (ver `bump`), asi que los
     denominadores coinciden con kpi.late / kpi.damage. */
  const c7 = card("c12", "Ciclo de vida del alquiler",
    "¿Qué le pasa a la demanda entre que se reserva y se cobra?");
  grid.appendChild(c7);
  const f = { n: 0, canc: 0, cancRev: 0, comp: 0 };
  const leaf = [[0, 0], [0, 0]];        // [tardio][averia] -> nº
  const leafRev = [[0, 0], [0, 0]];
  let maintDmg = 0;
  for (let i = 0; i < N; i++) {
    if (!MASK[i]) continue;
    const fl = F.flags[i];
    const price = ((fl >> 3) & 1) ? 0 : F.price[i] / 100;
    f.n++;
    if (fl & 1) { f.canc++; f.cancRev += price; continue; }
    f.comp++;
    const late = (fl >> 1) & 1, dmg = (fl >> 2) & 1;
    leaf[late][dmg]++;
    leafRev[late][dmg] += price;
    if (dmg) maintDmg += ((fl >> 5) & 1) ? 0 : F.maint[i] / 100;
  }
  const onTime = leaf[0][0] + leaf[0][1], late = leaf[1][0] + leaf[1][1];
  const noDmg = leaf[0][0] + leaf[1][0], dmg = leaf[0][1] + leaf[1][1];
  const shareN = v => pct(f.n ? v / f.n : NaN, 1);
  const okCol = SERIES(0), warnCol = SERIES(3), badCol = SERIES(1), lostCol = SERIES(7);
  sankey(c7._chart, {
    height: 400, fmt: v => nf(v),
    nodes: [
      { id: "all", col: 0, label: "Alquileres", value: f.n, color: okCol,
        tipRows: () => [["Alquileres", nf(f.n)], ["Ingreso realizado", eur(A.total.rev[0])]] },
      { id: "comp", col: 1, label: "Completados", value: f.comp, color: okCol,
        sub: shareN(f.comp),
        tipRows: () => [["Completados", nf(f.comp)], ["Ingresos", eur(A.total.rev[0])],
                        ["Ticket medio", eur(kpi.ticket(A.total, 0), 2)]] },
      { id: "canc", col: 1, label: "Cancelados", value: f.canc, color: lostCol,
        sub: "−" + compact(f.cancRev) + " €",
        tipRows: () => [["Cancelados", nf(f.canc)], ["Tasa", pct(kpi.cancel(A.total, 0), 2)],
                        ["Ingreso no realizado", eur(f.cancRev)]] },
      { id: "ontime", col: 2, label: "A tiempo", value: onTime, color: okCol, sub: shareN(onTime),
        tipRows: () => [["A tiempo", nf(onTime)], ["Sobre completados", pct(onTime / f.comp, 1)]] },
      { id: "late", col: 2, label: "Devolución tardía", value: late, color: warnCol,
        sub: shareN(late),
        tipRows: () => [["Tardíos", nf(late)], ["Tasa sobre completados", pct(kpi.late(A.total, 0), 2)],
                        ["Ingresos implicados", eur(leafRev[1][0] + leafRev[1][1])]] },
      { id: "ok", col: 3, label: "Sin incidencia", value: noDmg, color: okCol, sub: shareN(noDmg),
        tipRows: () => [["Sin avería", nf(noDmg)], ["Sobre completados", pct(noDmg / f.comp, 1)]] },
      { id: "dmg", col: 3, label: "Con avería", value: dmg, color: badCol, sub: shareN(dmg),
        tipRows: () => [["Con avería", nf(dmg)], ["Tasa sobre completados", pct(kpi.damage(A.total, 0), 2)],
                        ["Coste de mantenimiento", eur(maintDmg)],
                        ["Sobre ingresos", pct(A.total.rev[0] ? maintDmg / A.total.rev[0] : NaN, 2)]] },
    ],
    links: [
      { s: "all", t: "comp", value: f.comp, color: okCol,
        tipRows: () => [["Alquileres", nf(f.comp)], ["Sobre el total", shareN(f.comp)]] },
      { s: "all", t: "canc", value: f.canc, color: lostCol,
        tipRows: () => [["Alquileres", nf(f.canc)], ["Sobre el total", shareN(f.canc)],
                        ["Ingreso no realizado", eur(f.cancRev)]] },
      { s: "comp", t: "ontime", value: onTime, color: okCol,
        tipRows: () => [["Alquileres", nf(onTime)], ["Sobre completados", pct(onTime / f.comp, 1)]] },
      { s: "comp", t: "late", value: late, color: warnCol,
        tipRows: () => [["Alquileres", nf(late)], ["Sobre completados", pct(late / f.comp, 1)]] },
      { s: "ontime", t: "ok", value: leaf[0][0], color: okCol,
        tipRows: () => [["A tiempo y sin avería", nf(leaf[0][0])], ["Ingresos", eur(leafRev[0][0])]] },
      { s: "ontime", t: "dmg", value: leaf[0][1], color: badCol,
        tipRows: () => [["A tiempo, con avería", nf(leaf[0][1])], ["Ingresos", eur(leafRev[0][1])]] },
      { s: "late", t: "ok", value: leaf[1][0], color: warnCol,
        tipRows: () => [["Tardío, sin avería", nf(leaf[1][0])], ["Ingresos", eur(leafRev[1][0])]] },
      { s: "late", t: "dmg", value: leaf[1][1], color: badCol,
        tipRows: () => [["Tardío y con avería", nf(leaf[1][1])], ["Ingresos", eur(leafRev[1][1])]] },
    ],
  });
  legend(c7, [{ name: "Curso normal", color: SERIES(0) }, { name: "Devolución tardía", color: SERIES(3) },
              { name: "Avería", color: SERIES(1) }, { name: "Cancelación", color: SERIES(7) }]);
  setTable(c7, ["Estado final", "Alquileres", "% del total", "Ingresos"],
    [["Cancelado", nf(f.canc), shareN(f.canc), "− " + eur(f.cancRev)],
     ["A tiempo · sin avería", nf(leaf[0][0]), shareN(leaf[0][0]), eur(leafRev[0][0])],
     ["A tiempo · con avería", nf(leaf[0][1]), shareN(leaf[0][1]), eur(leafRev[0][1])],
     ["Tardío · sin avería", nf(leaf[1][0]), shareN(leaf[1][0]), eur(leafRev[1][0])],
     ["Tardío · con avería", nf(leaf[1][1]), shareN(leaf[1][1]), eur(leafRev[1][1])]]);
  insight(c7, "De cada 100 alquileres reservados, <b>" + nf(f.n ? leaf[0][0] / f.n * 100 : NaN, 0) +
    "</b> terminan el circuito limpio. La fuga mayor es la <b>cancelación</b> (" +
    eur(f.cancRev) + " que nunca se facturan), y la avería añade <b>" + eur(maintDmg) +
    "</b> de mantenimiento sobre los que sí se cobran. Son dos palancas distintas: la primera se " +
    "ataca en la reserva (el lead time la predice), la segunda en el estado del material.");

  recoBlock(grid, "demanda");
}

/* Tramos de antiguedad del material. La escala no es lineal a proposito: los
   primeros meses de vida de una bicicleta o unos esquis se comportan muy distinto
   entre si, y a partir de los cinco anos ya da igual el ano exacto. */
const AGE_BUCKETS = ["0–6 meses", "6–12 meses", "1–2 años", "2–5 años", "+5 años"];

/* Vista elegida en la tarjeta de averias. Vive fuera de la funcion de pagina
   porque `render()` recrea las tarjetas en cada filtro. */
const ageView = { mode: "box" };

/* --------------------------- 4 · Producto --------------------------------- */
function pageProducto(grid) {
  const pm = productMetrics();

  const c1 = card("c6", "Concentración de ingresos por producto (ABC)",
    "¿Cuántas referencias sostienen el 80 % del negocio?");
  grid.appendChild(c1);
  const sorted = pm.slice().sort((a, b) => b.revenue - a.revenue);
  const totalRev = sorted.reduce((a, b) => a + b.revenue, 0);
  const curve = [{ x: 0, y: 0 }];
  let cum = 0, nA = 0, nB = 0;
  sorted.forEach((p, i) => {
    cum += p.revenue;
    const y = totalRev ? 100 * cum / totalRev : 0;
    if (y <= 80) nA = i + 1; else if (y <= 95) nB = i + 1;
    curve.push({ x: 100 * (i + 1) / sorted.length, y });
  });
  nB = Math.max(nB, nA);
  const pctA = sorted.length ? 100 * nA / sorted.length : 0;
  curveChart(c1._chart, {
    height: 250, points: curve, xLabel: "% de productos, ordenados por ingreso",
    tipTitle: "Curva de Pareto",
    marker: { x: pctA, y: 80, text: nf(pctA, 0) + " % de las referencias = 80 % de los ingresos" },
  });
  const sumRange = (a, b) => sorted.slice(a, b).reduce((x, y) => x + y.revenue, 0);
  setTable(c1, ["Clase", "Productos", "% del catálogo", "Ingresos", "% de ingresos"], [
    ["A · hasta el 80 %", nf(nA), nf(pctA, 1) + " %", eur(sumRange(0, nA)), pct(sumRange(0, nA) / totalRev, 1)],
    ["B · 80–95 %", nf(nB - nA), nf(100 * (nB - nA) / sorted.length, 1) + " %",
     eur(sumRange(nA, nB)), pct(sumRange(nA, nB) / totalRev, 1)],
    ["C · cola larga", nf(sorted.length - nB), nf(100 * (sorted.length - nB) / sorted.length, 1) + " %",
     eur(sumRange(nB, sorted.length)), pct(sumRange(nB, sorted.length) / totalRev, 1)],
  ]);
  insight(c1, "<b>" + nf(nA) + " referencias</b> (" + nf(pctA, 0) + " % del catálogo) generan el 80 % de " +
    "los ingresos: son las que nunca pueden estar sin stock. La cola C inmoviliza capital y es candidata " +
    "a reducir o reubicar.");

  const c2 = card("c6", "Rotación del inventario", "¿Cuánto catálogo no rota?");
  grid.appendChild(c2);
  const rot = ["Infrautilizado", "Normal", "Saturado"].map(r => {
    const set = pm.filter(p => p.rotation === r);
    return { label: r, value: set.length,
      units: set.reduce((a, b) => a + b.units, 0),
      rev: set.reduce((a, b) => a + b.revenue, 0),
      occ: set.length ? set.reduce((a, b) => a + (isFinite(b.occupancy) ? b.occupancy : 0), 0) / set.length : NaN };
  });
  barsV(c2._chart, {
    height: 250, items: rot.map(r => ({ label: r.label, value: r.value,
      rows: [["Productos", nf(r.value)], ["Unidades", nf(r.units)],
             ["Ocupación media", pct(r.occ)], ["Ingresos", eur(r.rev)]] })),
    fmt: v => nf(v), measure: "Productos",
  });
  setTable(c2, ["Clase", "Productos", "Unidades", "Ocupación media", "Ingresos", "€ por unidad"],
    rot.map(r => [r.label, nf(r.value), nf(r.units), pct(r.occ), eur(r.rev),
      eur(r.units ? r.rev / r.units : NaN)]));
  insight(c2, "Clasificación por cuartiles de ocupación dentro de la selección. Las <b>" +
    nf(rot[0].units) + " unidades infrautilizadas</b> son capital parado que podría reasignarse a las " +
    "referencias saturadas o a otro mercado.");

  const c3 = card("c6", "Ocupación frente a margen por categoría",
    "¿Dónde añadir inventario genera retorno inmediato?");
  grid.appendChild(c3);
  const byCat = D.categories.map((c, i) => {
    const set = pm.filter(p => p.cat === i);
    if (!set.length) return null;
    const days = set.reduce((a, b) => a + A.product.days[b.i], 0);
    const cap = set.reduce((a, b) => a + b.units * PDAYS, 0);
    return { c, i, occ: cap ? days / cap : 0, margin: kpi.margin(A.cat, i),
             rev: set.reduce((a, b) => a + b.revenue, 0),
             units: set.reduce((a, b) => a + b.units, 0) };
  }).filter(Boolean);
  const avgOcc = byCat.reduce((a, b) => a + b.occ, 0) / byCat.length;
  const avgMar = byCat.reduce((a, b) => a + b.margin, 0) / byCat.length;
  scatter(c3._chart, {
    height: 290, sizeBy: true, labelPoints: true, xLabel: "Ocupación media",
    hline: avgMar * 100, vline: avgOcc * 100,
    points: byCat.map(d => ({ x: d.occ * 100, y: d.margin * 100, r: d.rev, label: d.c,
      rows: [["Ocupación", pct(d.occ)], ["Margen", pct(d.margin)], ["Ingresos", eur(d.rev)],
             ["Unidades", nf(d.units)]] })),
    fmtX: v => nf(v, 0) + " %", fmtY: v => nf(v, 0) + " %",
  });
  setTable(c3, ["Categoría", "Ocupación", "Margen", "Ingresos", "Unidades"],
    byCat.slice().sort((a, b) => b.rev - a.rev)
      .map(d => [d.c, pct(d.occ), pct(d.margin), eur(d.rev), nf(d.units)]));
  note(c3, "Las líneas marcan la media de cada eje; el tamaño de la burbuja son los ingresos. " +
    "Arriba a la derecha es donde ampliar stock rinde de inmediato.");

  /* -- Antiguedad frente a averias -----------------------------------------
     DECISION (para poder revertirla con criterio): la version anterior era una
     nube de ~250 burbujas de producto con TRES codificaciones a la vez —posicion,
     tamano por unidades y color por maintenance ratio— sobre puntos que se
     solapaban. Con esa densidad el patron "las averias suben con la edad" solo se
     intuia, y no habia forma de acercarse a mirar.

     Se sustituye por una CAJA Y BIGOTES sobre cinco tramos de antiguedad. Al
     agregar en tramos, el patron se lee de un vistazo (medianas crecientes) y
     ademas aparece algo que la nube escondia: cuanta dispersion hay DENTRO de
     cada tramo, que es justo lo que decide si la edad basta como regla de retirada.
     Agregado, el zoom deja de hacer falta.

     La nube original no se tira: queda detras del conmutador "Dispersion", ahora
     con zoom de rueda, arrastre y boton de reinicio. Para volver al comportamiento
     anterior basta con cambiar el valor inicial de `ageView.mode` a "scatter".
     -------------------------------------------------------------------------- */
  const c4 = card("c6", "Averías por antigüedad del material",
    "¿A partir de qué edad deja de compensar mantener una unidad?");
  grid.appendChild(c4);
  const pts = pm.filter(p => p.age != null && isFinite(p.damage) && p.completed >= 5);
  const maxMaint = Math.max(...pts.map(p => isFinite(p.maintRatio) ? p.maintRatio : 0), 0.001);
  const bucketOf = age => age < 0.5 ? 0 : age < 1 ? 1 : age < 2 ? 2 : age < 5 ? 3 : 4;
  const buckets = AGE_BUCKETS.map((label, b) => {
    const set = pts.filter(p => bucketOf(p.age) === b);
    const rev = set.reduce((a, x) => a + x.revenue, 0);
    return {
      label, b, set,
      box: boxStats(set.map(p => p.damage * 100)),
      units: set.reduce((a, x) => a + x.units, 0),
      rentals: set.reduce((a, x) => a + x.rentals, 0),
      rev,
      maint: rev ? set.reduce((a, x) => a + (isFinite(x.maintRatio) ? x.maintRatio * x.revenue : 0), 0) / rev : NaN,
      damage: set.reduce((a, x) => a + x.completed, 0)
        ? set.reduce((a, x) => a + x.damage * x.completed, 0) / set.reduce((a, x) => a + x.completed, 0)
        : NaN,
    };
  }).filter(d => d.set.length);
  const legendBox = document.createElement("div");
  c4.appendChild(legendBox);

  const drawAge = () => {
    legendBox.innerHTML = "";
    if (ageView.mode === "box") {
      boxplot(c4._chart, {
        rowH: 42, labelW: 108, fmt: v => nf(v, 1) + " %",
        items: buckets.map(d => ({ label: d.label, box: d.box })),
      });
      const d = document.createElement("div");
      d.className = "note";
      d.textContent = "Cada caja resume las referencias de ese tramo: la línea es la mediana " +
        "de su tasa de averías, la caja el recorrido intercuartílico y los bigotes 1,5·IQR. " +
        "Las cifras exactas están en la tabla.";
      legendBox.appendChild(d);
      setTable(c4, ["Tramo de antigüedad", "Referencias", "Unidades", "Alquileres",
                    "Avería mediana", "Tasa de avería del tramo", "Maint. ratio"],
        buckets.map(d => [d.label, nf(d.set.length), nf(d.units), nf(d.rentals),
          nf(d.box.med, 1) + " %", pct(d.damage, 1), pct(d.maint, 1)]));
    } else {
      scatter(c4._chart, {
        height: 290, sizeBy: true, zoom: true, xLabel: "Antigüedad del producto (años)",
        points: pts.map(p => ({ x: p.age, y: p.damage * 100, r: p.units, label: p.name,
          color: ramp((isFinite(p.maintRatio) ? p.maintRatio : 0) / maxMaint),
          rows: [["Categoría", D.categories[p.cat]], ["Antigüedad", nf(p.age, 1) + " años"],
                 ["Tasa de averías", pct(p.damage, 1)], ["Maintenance ratio", pct(p.maintRatio, 1)],
                 ["Unidades", nf(p.units)], ["Alquileres", nf(p.rentals)]] })),
        fmtX: v => nf(v, 1), fmtY: v => nf(v, 0) + " %",
      });
      scaleLegend(legendBox, "maintenance ratio bajo", "alto · el tamaño son las unidades");
      setTable(c4, ["Producto", "Categoría", "Años", "Averías", "Maint. ratio", "Unidades", "Alquileres"],
        pts.slice().sort((a, b) => b.damage - a.damage).slice(0, 80).map(p =>
          [p.name, D.categories[p.cat], nf(p.age, 1), pct(p.damage, 1), pct(p.maintRatio, 1),
           nf(p.units), nf(p.rentals)]));
    }
  };
  segmented(c4, [{
    label: "Vista", store: ageView, key: "mode",
    options: [{ id: "box", label: "Distribución" }, { id: "scatter", label: "Dispersión" }],
  }], drawAge);
  drawAge();
  const first = buckets[0], last = buckets[buckets.length - 1];
  insight(c4, buckets.length > 1
    ? "La avería mediana pasa del <b>" + nf(first.box.med, 1) + " %</b> en " +
      first.label.toLowerCase() + " al <b>" + nf(last.box.med, 1) + " %</b> en " +
      last.label.toLowerCase() + ", y el coste de mantenimiento sobre ingreso sube del <b>" +
      pct(first.maint, 1) + "</b> al <b>" + pct(last.maint, 1) + "</b>. El ancho de las cajas " +
      "avisa de que la edad no basta por sí sola: dentro del mismo tramo hay referencias sanas " +
      "y referencias que ya no compensan, así que la regla de retirada debe cruzar edad con " +
      "maintenance ratio."
    : "La selección deja un único tramo de antigüedad; amplíala para comparar.");

  const c5 = card("c6", "Referencias saturadas", "¿Dónde falta stock?");
  grid.appendChild(c5);
  const sat = pm.filter(p => p.rotation === "Saturado").sort((a, b) => b.occupancy - a.occupancy).slice(0, 12);
  barsH(c5._chart, {
    items: sat.map(p => ({ label: p.name, value: p.occupancy * 100,
      rows: [["Categoría", D.categories[p.cat]], ["Ocupación", pct(p.occupancy)],
             ["Unidades", nf(p.units)], ["Alquileres", nf(p.completed)], ["Ingresos", eur(p.revenue)]] })),
    rowH: 23, labelW: 168, valueW: 54, fmt: v => nf(v, 1) + " %", measure: "Ocupación",
  });
  setTable(c5, ["Producto", "Categoría", "Unidades", "Ocupación", "Alquileres", "Ingresos"],
    sat.map(p => [p.name, D.categories[p.cat], nf(p.units), pct(p.occupancy), nf(p.completed),
      eur(p.revenue)]));
  insight(c5, "Alta rotación con poco stock: cada unidad extra aquí se alquila casi seguro. Es la " +
    "inversión con retorno más previsible del catálogo.");

  const c6 = card("c6", "Referencias infrautilizadas", "¿Qué inventario está inmovilizado?");
  grid.appendChild(c6);
  const under = pm.filter(p => p.rotation === "Infrautilizado")
    .sort((a, b) => b.units * (b.purchase || 0) - a.units * (a.purchase || 0)).slice(0, 12);
  barsH(c6._chart, {
    items: under.map(p => ({ label: p.name, value: p.units * (p.purchase || 0), color: cssVar("--neutral-mark"),
      rows: [["Categoría", D.categories[p.cat]], ["Unidades", nf(p.units)],
             ["Capital inmovilizado", eur(p.units * (p.purchase || 0))],
             ["Ocupación", pct(p.occupancy)], ["Ingresos", eur(p.revenue)]] })),
    rowH: 23, labelW: 168, valueW: 62, fmt: v => compact(v) + " €", measure: "Capital inmovilizado",
  });
  setTable(c6, ["Producto", "Categoría", "Unidades", "Precio compra", "Capital", "Ocupación", "Ingresos"],
    under.map(p => [p.name, D.categories[p.cat], nf(p.units), eur(p.purchase || 0),
      eur(p.units * (p.purchase || 0)), pct(p.occupancy), eur(p.revenue)]));
  insight(c6, "Ordenadas por <b>capital inmovilizado</b> (unidades × precio de compra), no por número " +
    "de unidades: liberar caja es el objetivo, y no todas las referencias cuestan lo mismo.");

  const c7 = card("c12", "Detalle por referencia",
    nf(pm.length) + " referencias con actividad en la selección.");
  grid.appendChild(c7);
  tableOnly(c7, ["Producto", "Categoría", "Rotación", "Uds.", "Alquileres", "Ocupación",
                 "Utilización", "Ingresos", "€/unidad", "Margen", "Maint. ratio", "Averías", "Review"],
    pm.slice().sort((a, b) => b.revenue - a.revenue).map(p => [
      p.name, D.categories[p.cat], p.rotation, nf(p.units), nf(p.rentals), pct(p.occupancy),
      nf(p.utilization, 1), eur(p.revenue), eur(p.revPerUnit), pct(p.margin), pct(p.maintRatio),
      pct(p.damage), nf(p.review, 2)]));

  recoBlock(grid, "producto");
}
