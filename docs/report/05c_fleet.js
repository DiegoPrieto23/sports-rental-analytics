/* ===========================================================================
   Plan de flota: una "next best action" por referencia.

   POR QUE SOBRE LA FLOTA Y NO SOBRE EL CLIENTE. Un NBA de cliente necesita
   pares (accion tomada, resultado) para estimar incrementalidad, y en las 36
   columnas del dataset no hay NI UNA que registre una accion hacia nadie: ni
   campana, ni contacto, ni oferta, ni descuento aplicado como intervencion.
   Solo hay hechos de alquiler y atributos. Encima la dimension de cliente es una
   foto del ultimo dia (sin SCD2), asi que cualquier modelo de propension
   entrenado con ella tendria fuga de futuro, y membresia y segmento son casi la
   misma variable (el 48,7 % de los VIP son Gold, el 0 % de los Occasional).
   Montar ahi un NBA seria inventarse la mitad del problema, y ademas
   contradiria la recomendacion de la pagina de clientes, que dice justo lo
   contrario: que eso no esta identificado y hay que aleatorizar para saberlo.

   La unidad de decision de este negocio no es el cliente, es la UNIDAD DE
   INVENTARIO. Y ahi el dato si llega, porque la accion no consiste en persuadir
   a nadie: es economia deterministica sobre cifras que ya estan en el hecho.
   Por eso esto es un motor de REGLAS y no un modelo. No hay nada que ajustar:
   hay una funcion de valor y un orden de precedencia.

   LA FUNCION DE VALOR. Todo cuelga de una sola magnitud derivada, el PAYBACK:
   cuantos anos tarda la contribucion anual de una unidad en devolver lo que
   costo comprarla.

       contribucion/ud/ano = ingreso/ud/ano - mantenimiento/ud/ano
       payback             = precio de compra / contribucion/ud/ano

   Se eligio el payback y no el margen porque es la unica forma de comparar una
   bici de 815 EUR con unas raquetas de 40 EUR sin que el tamano del ticket
   decida por ti, y porque es el numero que un financiero acepta sin traduccion.

   LOS DOS MODOS son el nucleo de la pagina, no un adorno:

     "sin imputar"  el cuadro de mando de hoy. El material no cuesta nada, asi
                    que una referencia solo es mala si el mantenimiento se come
                    el ingreso. Salen 8 de 320.
     "imputado"     se carga la amortizacion del material. Una referencia que no
                    devuelve su compra dentro de su vida util no se paga, por
                    mucho que su contribucion sea positiva.

   La diferencia entre los dos no es cosmetica: cambia mas de un tercio de las 320
   decisiones. Ese numero es el argumento entero de la primera recomendacion del
   informe (imputar el coste del material), ensenado en vez de contado.

   RETIRAR NO ES LO MISMO QUE NO REPONER, y separarlas es lo que evita el error
   clasico de este analisis. Una referencia que cubre su mantenimiento pero no
   devuelve su compra NO se retira: la compra ya esta pagada y es dinero hundido,
   asi que sacarla de circulacion mientras genere caja cuesta dinero en vez de
   ahorrarlo. Lo que se decide sobre ella es no volver a comprarla. "Retirar" se
   reserva a la que pierde caja hoy, que es la unica que justifica actuar ya.

   SOBRE LOS UMBRALES: la vida util sale de `AMORT_LIVES` (05b_reco.js, supuesto
   declarado, no dato) y el corte de "holgado" es la mitad de esa vida. No son
   verdades del negocio, son los valores con los que se puede razonar hasta que
   Finanzas fije los suyos, y la pagina termina recomendando exactamente eso.

QUE FILTROS APLICAN Y POR QUE. La economia de cada referencia se calcula
   siempre sobre el HISTORICO COMPLETO, pero la pagina SI responde al filtro de
   CATEGORIA: una referencia pertenece a una sola, asi que seleccionar Bicicletas
   no cambia la economia de ninguna, solo que filas se miran. Los de pais, canal,
   membresia y segmento NO aplican, y no es pereza: filtran ALQUILERES, no
   productos, asi que el ingreso de la referencia bajaria pero su
   `inventory_units` seguiria siendo global, el denominador de la ocupacion no se
   moveria y el payback dejaria de significar nada. El de periodo tampoco: esto
   es una decision de capital a anos vista, no de un trimestre, y un payback
   calculado sobre tres meses anualizados es ruido con pinta de cifra.

   Los UMBRALES (cuartil alto de ocupacion y neto mediano) se calculan siempre
   sobre el catalogo entero, tambien con el filtro puesto. Si se recalcularan
   dentro de la seleccion, "saturada" significaria una cosa distinta en cada
   filtro y el cuartil alto de una categoria mala seguiria saliendo como algo que
   ampliar.
   =========================================================================== */

/* Vida util del material. Misma constante que usa el bloque de recomendaciones
   para amortizar: si se cambia alli, cambia aqui, y es lo que se quiere. */
const FLEET_LIFE = AMORT_LIVES[0];
/* Una referencia que devuelve su compra en menos de media vida util va holgada.
   Entre media vida y la vida entera se paga, pero justo: es la banda de revision. */
const FLEET_FAST = FLEET_LIFE / 2;
/* Cuanto se amplia una referencia saturada. Un 10 % es un piloto: suficiente
   para medir si la unidad nueva alquila como las de al lado, pequeno para que
   equivocarse no cueste una temporada. */
const EXPAND_SHARE = 0.10;
/* El payback se recorta al dibujarlo: la peor referencia tardaria siglos y sin
   recortar aplasta a todas las demas contra el eje. Dos vidas utiles es de sobra:
   a partir de ahi la decision ya esta tomada. */
const PAYBACK_CAP = FLEET_LIFE * 2;

/* Las seis acciones. El orden es el de precedencia de las reglas y tambien el
   del resumen: primero lo que sale del catalogo, luego lo que se invierte, y al
   final lo que no toca. Seis tonos bien separados de la paleta del informe: rojo
   sale ya, morado sale al final de su vida, verde se repone, azul se amplia,
   ambar se revisa y gris no se toca. Rojo y morado no comparten familia a
   proposito, porque son justo las dos que no hay que confundir. */
const FLEET_ACTIONS = [
  { id: "retirar",   label: "Retirar",     s: 7 },
  { id: "noreponer", label: "No reponer",  s: 6 },
  { id: "renovar",   label: "Renovar",     s: 2 },
  { id: "ampliar",   label: "Ampliar",     s: 0 },
  { id: "revisar",   label: "Revisar",     s: 3 },
  { id: "mantener",  label: "Mantener",    s: -1 },
];
const fleetColor = id => {
  const a = FLEET_ACTIONS.find(x => x.id === id);
  return a && a.s >= 0 ? SERIES(a.s) : cssVar("--neutral-mark");
};
const fleetLabel = id => (FLEET_ACTIONS.find(x => x.id === id) || {}).label || id;

/* Modo activo. Vive a nivel de modulo porque `render()` recrea las tarjetas en
   cada cambio de filtro y el conmutador tiene que sobrevivir a eso. */
const fleetView = { mode: "neto" };

let FLEET_CACHE = null;

/* --------------------------------------------------------------------------
   El motor
   Devuelve, para cada referencia y cada modo, la accion elegida, por que, y el
   euro anual que mueve tomarla. Memoizado: no depende de los filtros.
   -------------------------------------------------------------------------- */
function fleetPlan() {
  if (FLEET_CACHE) return FLEET_CACHE;
  const R = recoFacts();
  const years = R.years;

  /* Ratio de mantenimiento del material mas nuevo del catalogo. Es lo que se
     supone que costaria mantener una referencia recien repuesta, y es lo unico
     que hace calculable la accion "renovar" sin inventarse nada. */
  const newR = R.age.length ? R.age[0].maintR : NaN;

  /* Ojo al construir la fila: `recoFacts().pm` ya trae un campo `contrib` que es
     un NUMERO (ingreso menos mantenimiento del periodo). Las decisiones van en
     `planContrib` / `planNeto` para no pisarlo. */
  const rows = R.pm.filter(p => p.units > 0 && p.purchase > 0).map(p => {
    const revY = p.rev / years, maintY = p.maint / years;
    const contribU = (revY - maintY) / p.units;
    const amortU = p.purchase / FLEET_LIFE;
    const netU = contribU - amortU;
    const payback = contribU > 0 ? p.purchase / contribU : Infinity;
    /* Reponer baja el mantenimiento al del material nuevo. Si ese ahorro no
       devuelve el coste de reposicion, renovar no es una opcion: es gastar. */
    const savingY = maintY - revY * newR;
    const replPayback = savingY > 0 ? (p.units * p.replacement) / savingY : Infinity;
    return Object.assign({}, p, {
      revY, maintY, contribU, amortU, netU, payback, savingY, replPayback,
      add: Math.max(1, Math.round(p.units * EXPAND_SHARE)),
      capital: p.units * p.purchase,
    });
  });

  const occs = rows.map(d => d.occ).filter(isFinite).sort((a, b) => a - b);
  const q3 = occs[Math.min(occs.length - 1, Math.floor(0.75 * (occs.length - 1)))];
  const nets = Float64Array.from(rows.map(d => d.netU).filter(isFinite)).sort();
  const medNet = nets.length ? quantileSorted(nets, 0.5) : 0;

  /* --- las reglas ------------------------------------------------------- */
  const decideNeto = d => {
    /* Reponer va antes que nada: si el ahorro de mantenimiento paga la reposicion,
       la referencia no es mala, es vieja. */
    if (d.payback > FLEET_LIFE && d.replPayback <= FLEET_LIFE) {
      return { action: "renovar", gain: d.savingY,
               why: "No devuelve su compra en " + nf(FLEET_LIFE) + " años, pero reponerla se " +
                    "paga en " + nf(d.replPayback, 1) };
    }
    /* RETIRAR se reserva a la que quema caja HOY. Mandar retirar una referencia
       con contribucion positiva porque no devuelve su compra seria razonar sobre
       coste hundido: la compra ya esta pagada, y mientras genere caja, sacarla de
       circulacion cuesta dinero en vez de ahorrarlo. */
    if (d.contribU <= 0) {
      return { action: "retirar", gain: -d.contribU * d.units,
               why: "El mantenimiento supera al ingreso: cada unidad pierde " +
                    eur(-d.contribU, 0) + " al año" };
    }
    /* La que paga su mantenimiento pero no devuelve su capital no se retira: se
       deja morir y NO SE VUELVE A COMPRAR. Lo que se ahorra no es P&L de este
       año, es el capital que se deja de comprometer cada vez que tocaria reponer. */
    if (d.payback > FLEET_LIFE) {
      return { action: "noreponer", gain: d.amortU * d.units,
               why: "Cubre su mantenimiento pero tardaría " + nf(d.payback, 1) + " años en " +
                    "devolver su compra: no compensa volver a comprarla" };
    }
    if (d.payback <= FLEET_FAST && d.occ >= q3) {
      return { action: "ampliar", gain: d.netU * d.add,
               why: "Devuelve su compra en " + nf(d.payback, 1) + " años y está en el cuartil " +
                    "alto de ocupación (" + pct(d.occ, 2) + ")" };
    }
    if (d.payback > FLEET_FAST) {
      return { action: "revisar", gain: Math.max(0, (medNet - d.netU) * d.units),
               why: "Se paga, pero tarda " + nf(d.payback, 1) + " años: más de la mitad de " +
                    "su vida útil" };
    }
    return { action: "mantener", gain: 0,
             why: "Devuelve su compra en " + nf(d.payback, 1) + " años con ocupación normal" };
  };

  /* Modo "sin imputar": el material no cuesta nada, asi que no hay umbral de
     capital que cruzar. Solo quedan dos senales, y por eso este modo manda
     mantener referencias que no se pagan. */
  const decideContrib = d => {
    if (d.contribU <= 0) {
      return { action: "retirar", gain: -d.contribU * d.units,
               why: "El mantenimiento supera al ingreso" };
    }
    if (d.occ >= q3) {
      return { action: "ampliar", gain: d.contribU * d.add,
               why: "Cuartil alto de ocupación (" + pct(d.occ, 2) + ")" };
    }
    return { action: "mantener", gain: 0,
             why: "Contribución positiva y ocupación normal" };
  };

  rows.forEach(d => { d.planNeto = decideNeto(d); d.planContrib = decideContrib(d); });

  /* Cuantas decisiones cambian al imputar el material, y el flujo de una a otra
     para el diagrama. */
  const flow = {};
  let changed = 0;
  rows.forEach(d => {
    const k = d.planContrib.action + "|" + d.planNeto.action;
    flow[k] = (flow[k] || 0) + 1;
    if (d.planContrib.action !== d.planNeto.action) changed++;
  });

  /* Sensibilidad al supuesto de vida util. Si la vida pasa del primer valor de
     `AMORT_LIVES` al segundo, las referencias que cambian de decision son
     exactamente las que tienen el payback entre las dos vidas (cruzan el umbral
     de retirada) o entre sus mitades (cruzan el de ampliacion). No hace falta
     re-ejecutar el motor para contarlas: es el mismo payback leido con otra
     regla. Es la cifra que justifica pedirle a Finanzas la vida util de verdad. */
  const [L1, L2] = AMORT_LIVES;
  const sens = rows.filter(d => (d.payback > L1 && d.payback <= L2) ||
                                (d.payback > L1 / 2 && d.payback <= L2 / 2));

  FLEET_CACHE = { rows, q3, medNet, newR, changed, flow, years,
                  lives: [L1, L2],
                  sens: { refs: sens.length, capital: sens.reduce((a, d) => a + d.capital, 0) },
                  worstPayback: Math.max(...rows.map(d => isFinite(d.payback) ? d.payback : 0)) };
  return FLEET_CACHE;
}

/* La decision de una fila en el modo pedido. Un solo sitio donde se traduce
   "neto"/"contrib" al campo, para que no se escape una cadena mal escrita. */
const fleetPick = (d, mode) => mode === "neto" ? d.planNeto : d.planContrib;

/* Filas del plan que caen dentro del filtro de categoria activo. El resto de
   filtros no tocan esta pagina (ver la cabecera). */
function fleetRows() {
  const P = fleetPlan();
  return state.cat.size ? P.rows.filter(d => state.cat.has(d.cat)) : P.rows;
}

/* Resumen por accion en el modo pedido. `rows` por defecto es el catalogo
   entero: el bloque de recomendaciones lo llama sin argumento a proposito,
   porque sus cifras son del historico completo y no deben moverse al filtrar. */
function fleetSummary(mode, rows) {
  const P = fleetPlan();
  const base = rows || P.rows;
  return FLEET_ACTIONS.map(a => {
    const set = base.filter(d => fleetPick(d, mode).action === a.id);
    return {
      id: a.id, label: a.label, color: fleetColor(a.id),
      refs: set.length,
      units: set.reduce((x, d) => x + d.units, 0),
      capital: set.reduce((x, d) => x + d.capital, 0),
      gain: set.reduce((x, d) => x + (isFinite(fleetPick(d, mode).gain)
                                      ? fleetPick(d, mode).gain : 0), 0),
      addUnits: a.id === "ampliar" ? set.reduce((x, d) => x + d.add, 0) : 0,
    };
  }).filter(d => d.refs);
}

/* --------------------------------------------------------------------------
   La pagina
   -------------------------------------------------------------------------- */
function pageFlota(grid) {
  const P = fleetPlan();
  const rows = fleetRows();
  const e = v => eur(v, 0);
  /* La etiqueta dice a la vez que la economia es del historico completo y que la
     seleccion de categoria si esta aplicada, que es justo la duda que provoca ver
     una tabla que no responde a un filtro de la barra. */
  const tag = "histórico completo" + (state.cat.size
    ? " · " + nf(state.cat.size) + (state.cat.size === 1 ? " categoría" : " categorías") : "");

  if (!rows.length) {
    const empty = card("c12", "Plan de flota", null, tag);
    empty._chart.innerHTML = '<p class="prose">Ninguna referencia del catálogo cae dentro de ' +
      'la categoría seleccionada.</p>';
    empty.querySelector(".tbtn").remove();
    grid.appendChild(empty);
    return;
  }
  /* Todas las tarjetas que siguen al conmutador se repintan juntas. Se registran
     aqui segun se van creando porque el conmutador vive en la primera y tiene que
     poder alcanzar a las de mas abajo, que aun no existen cuando se construye. */
  const redraw = [];

  /* -- 1. El plan --------------------------------------------------------- */
  const c1 = card("c12", "El plan", "¿Qué toca hacer con cada referencia, y cuánto mueve?", tag);
  grid.appendChild(c1);
  segmented(c1, [{
    label: "Coste del material", store: fleetView, key: "mode",
    options: [{ id: "contrib", label: "Sin imputar" },
              { id: "neto", label: "Imputado · " + nf(FLEET_LIFE) + " años" }],
  }], () => redraw.forEach(f => f()));

  const drawPlan = () => {
    const sum = fleetSummary(fleetView.mode, rows);
    const acting = sum.filter(d => d.id !== "mantener");
    const old = c1.querySelector(".chips");
    if (old) old.remove();
    chips(c1, [
      ["Referencias con acción", nf(acting.reduce((a, d) => a + d.refs, 0)),
       "de " + nf(rows.length)],
      ["€/año en juego", compact(sum.reduce((a, d) => a + d.gain, 0)) + " €"],
      ["Capital implicado", compact(acting.reduce((a, d) => a + d.capital, 0)) + " €"],
    ]);
    barsH(c1._chart, {
      rowH: 34, labelW: 96, valueW: 74, fmt: v => compact(v) + " €", measure: "€/año en juego",
      items: sum.map(d => ({
        label: d.label, value: d.gain, color: d.color, muted: d.id === "mantener",
        rows: [["Referencias", nf(d.refs)], ["Unidades", nf(d.units)],
               ["Capital", e(d.capital)], ["€/año en juego", e(d.gain)]]
          .concat(d.addUnits ? [["Unidades a añadir", nf(d.addUnits)]] : []),
      })),
    });
    setTable(c1, ["Acción", "Referencias", "Unidades", "Capital", "€/año en juego"],
      sum.map(d => [d.label, nf(d.refs), nf(d.units), e(d.capital), e(d.gain)]));
  };
  redraw.push(drawPlan);
  drawPlan();
  note(c1, "<b>€/año en juego</b> es el efecto anual de tomar la acción, y significa algo " +
    "distinto en cada una: en <i>retirar</i> es la pérdida de caja que se detiene, en " +
    "<i>renovar</i> el mantenimiento que se ahorra, en <i>ampliar</i> lo que aportan las unidades " +
    "nuevas y en <i>revisar</i> lo que ese capital rendiría en una referencia mediana. En " +
    "<b>no reponer</b> no es P&amp;L: es el capital que se deja de comprometer cada año al no " +
    "volver a comprar ese material. La columna <i>Por qué</i> de la tabla lo dice fila a fila.");
  note(c1, "<b>Filtros:</b> esta página responde al de <b>categoría</b> —una referencia " +
    "pertenece a una sola, así que seleccionarla no cambia la economía de ninguna, sólo qué " +
    "filas se miran—. No responde a los de país, canal, membresía ni segmento: ésos filtran " +
    "<i>alquileres</i>, no productos, y las unidades de inventario son globales por referencia, " +
    "así que el ingreso bajaría pero el denominador de la ocupación no, y el payback dejaría de " +
    "significar nada. Tampoco al de periodo: es una decisión de capital a años vista. Los " +
    "umbrales se calculan siempre sobre el catálogo entero, para que «saturada» signifique lo " +
    "mismo dentro y fuera del filtro.");

  /* -- 2. Lo que cambia al imputar el material ----------------------------
     Esta tarjeta NO sigue al conmutador a proposito: es la comparacion entre los
     dos modos, asi que enseña los dos a la vez. */
  const c2 = card("c6", "Qué cambia al imputar el material",
    "¿Cuántas decisiones dependen de un coste que hoy no se descuenta?", tag);
  grid.appendChild(c2);
  const before = fleetSummary("contrib", rows), after = fleetSummary("neto", rows);
  /* El flujo se recuenta sobre la seleccion: con Bicicletas puesto, la pregunta
     es cuantas decisiones de bicicleta cambian, no cuantas del catalogo. */
  const flow = {};
  let changed = 0;
  rows.forEach(d => {
    const k = d.planContrib.action + "|" + d.planNeto.action;
    flow[k] = (flow[k] || 0) + 1;
    if (d.planContrib.action !== d.planNeto.action) changed++;
  });
  const nodes = [], links = [];
  const nodeOf = (d, col, prefix) => ({
    id: prefix + d.id, col, label: d.label, value: d.refs, color: d.color,
    sub: compact(d.capital) + " €",
    tipRows: () => [["Referencias", nf(d.refs)], ["Unidades", nf(d.units)],
                    ["Capital", e(d.capital)], ["€/año en juego", e(d.gain)]],
  });
  before.forEach(d => nodes.push(nodeOf(d, 0, "a_")));
  after.forEach(d => nodes.push(nodeOf(d, 1, "b_")));
  Object.entries(flow).forEach(([k, v]) => {
    const [from, to] = k.split("|");
    links.push({
      s: "a_" + from, t: "b_" + to, value: v, color: fleetColor(to),
      tipRows: () => [["Referencias", nf(v)],
                      ["Decisión", from === to ? "no cambia"
                        : fleetLabel(from) + " → " + fleetLabel(to)]],
    });
  });
  sankey(c2._chart, { height: 360, fmt: v => nf(v) + " ref.", nodes, links });
  note(c2, "A la izquierda, el plan que sale <b>sin descontar lo que cuesta el material</b> —lo " +
    "que enseña hoy el cuadro de mando—. A la derecha, el mismo plan con la amortización " +
    "cargada. Cada cinta es un grupo de referencias; las que cruzan de un nombre a otro son las " +
    "que cambian de decisión.");
  setTable(c2, ["Sin imputar", "Imputado", "Referencias"],
    Object.entries(flow).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
      const [from, to] = k.split("|");
      return [fleetLabel(from), fleetLabel(to),
              nf(v) + (from === to ? "" : ' <span class="sig">cambia</span>')];
    }));
  const movedCapital = rows.filter(d => d.planContrib.action !== d.planNeto.action)
    .reduce((a, d) => a + d.capital, 0);
  const keptButUnpaid = rows.filter(d => d.planContrib.action === "mantener" &&
                                         d.planNeto.action !== "mantener").length;
  const keptBefore = before.find(d => d.id === "mantener");
  insight(c2, "<b>" + nf(changed) + " de " + nf(rows.length) + " decisiones cambian</b> (" +
    pct(changed / rows.length, 0) + " de la selección, " + e(movedCapital) + " de capital) sólo " +
    "por descontar lo que cuesta el material. Sin imputarlo el plan manda <b>mantener</b> " +
    nf(keptBefore ? keptBefore.refs : 0) + " referencias, y <b>" + nf(keptButUnpaid) +
    "</b> de ellas no devuelven su compra en " + nf(FLEET_LIFE) + " años. No es que el plan de la " +
    "izquierda sea distinto: es que no puede ver la mitad del problema.");

  /* -- 3. La regla, de un vistazo ----------------------------------------- */
  const c3 = card("c6", "La regla, de un vistazo",
    "¿Por qué le toca a cada referencia lo que le toca?", tag);
  grid.appendChild(c3);
  const legendBox = document.createElement("div");
  c3.appendChild(legendBox);
  const drawRule = () => {
    const m = fleetView.mode;
    scatter(c3._chart, {
      height: 300, sizeBy: true, zoom: true,
      xLabel: "Ocupación media de la referencia",
      hline: FLEET_LIFE, vline: P.q3 * 100,
      fmtX: v => nf(v, 1) + " %", fmtY: v => nf(v, 0) + " a",
      points: rows.map(d => ({
        x: d.occ * 100,
        y: Math.min(isFinite(d.payback) ? d.payback : PAYBACK_CAP, PAYBACK_CAP),
        r: d.capital, label: d.name, color: fleetColor(fleetPick(d, m).action),
        rows: [["Categoría", D.categories[d.cat]], ["Acción", fleetLabel(fleetPick(d, m).action)],
               ["Por qué", fleetPick(d, m).why], ["Unidades", nf(d.units)],
               ["Ocupación", pct(d.occ, 2)],
               ["Payback", isFinite(d.payback) ? nf(d.payback, 1) + " años" : "nunca"],
               ["Contribución/ud·año", eur(d.contribU, 2)],
               ["Amortización/ud·año", eur(d.amortU, 2)],
               ["Neto/ud·año", eur(d.netU, 2)], ["Capital", e(d.capital)]],
      })),
    });
    legendBox.innerHTML = "";
    const lg = document.createElement("div");
    lg.className = "legend";
    lg.innerHTML = FLEET_ACTIONS.filter(a => rows.some(d => fleetPick(d, m).action === a.id))
      .map(a => '<span><i style="background:' + fleetColor(a.id) + '"></i>' + a.label + "</span>")
      .join("");
    legendBox.appendChild(lg);
    const nt = document.createElement("div");
    nt.className = "note";
    nt.innerHTML = "La línea horizontal es la vida útil (" + nf(FLEET_LIFE) + " años): por " +
      "encima, la referencia no devuelve lo que costó. La vertical es el cuartil alto de " +
      "ocupación (" + pct(P.q3, 2) + "). El tamaño de la burbuja es el capital. El payback se " +
      "recorta a " + nf(PAYBACK_CAP) + " años —la peor tardaría " + nf(P.worstPayback, 0) +
      "— porque a partir de ahí la decisión ya está tomada.";
    legendBox.appendChild(nt);
  };
  redraw.push(drawRule);
  drawRule();
  setTable(c3, ["Acción", "Regla"], [
    ["<b>Renovar</b>", "El payback pasa de la vida útil (" + nf(FLEET_LIFE) + " años), pero el " +
     "ahorro de mantenimiento devuelve el coste de reposición dentro de ella"],
    ["<b>Retirar</b>", "El mantenimiento se come el ingreso: pierde caja hoy. Es lo <i>único</i> " +
     "que justifica sacarla de circulación ya; lo demás sería razonar sobre coste hundido"],
    ["<b>No reponer</b>", "Cubre su mantenimiento pero el payback pasa de la vida útil: se deja " +
     "morir y no se vuelve a comprar"],
    ["<b>Ampliar</b>", "Payback por debajo de " + nf(FLEET_FAST) + " años y ocupación en el " +
     "cuartil alto: +" + nf(EXPAND_SHARE * 100, 0) + " % de unidades"],
    ["<b>Revisar</b>", "Se paga, pero tarda más de " + nf(FLEET_FAST) + " años"],
    ["<b>Mantener</b>", "Todo lo demás"],
  ]);
  textTable(c3);

  /* -- 4. El detalle, referencia a referencia -----------------------------
     Ordenable por cualquier columna. Las celdas numericas viajan como {h, v}
     porque lo que se pinta ya esta formateado ("1.234 €", "12,3 %") y ordenar
     eso como texto pondria el 9 por encima del 1.234. El payback infinito —la
     referencia que no devuelve su compra nunca— lleva un centinela enorme para
     que caiga arriba al ordenar de peor a mejor, que es donde tiene que estar. */
  const DETAIL_COLS = ["Producto", "Categoría", "Acción", "Por qué", "Uds.", "Ocupación",
                       "Contrib./ud·año", "Amort./ud·año", "Neto/ud·año", "Payback",
                       "€/año en juego", "Capital"];
  const c4 = card("c12", "Las " + nf(rows.length) + " referencias",
    "Pulsa una cabecera para ordenar. Arranca por el euro anual que mueve la acción.", tag);
  grid.appendChild(c4);
  const drawDetail = () => {
    const m = fleetView.mode;
    sortableOnly(c4, DETAIL_COLS, rows.map(d => {
      const pk = fleetPick(d, m);
      return [
        d.name, D.categories[d.cat],
        { v: fleetLabel(pk.action),
          h: '<b style="color:' + fleetColor(pk.action) + '">' + fleetLabel(pk.action) + "</b>" },
        pk.why,
        numCell(d.units, nf(d.units)),
        numCell(d.occ, pct(d.occ, 2)),
        numCell(d.contribU, eur(d.contribU, 2)),
        numCell(d.amortU, eur(d.amortU, 2)),
        numCell(d.netU, eur(d.netU, 2)),
        { v: isFinite(d.payback) ? d.payback : 1e9,
          h: isFinite(d.payback) ? nf(d.payback, 1) + " a" : "nunca" },
        numCell(pk.gain, e(pk.gain)),
        numCell(d.capital, e(d.capital)),
      ];
    }), { col: 10, dir: -1 });
  };
  redraw.push(drawDetail);
  drawDetail();

  recoBlock(grid, "flota");
}
