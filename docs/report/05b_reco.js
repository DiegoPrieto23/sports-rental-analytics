/* ===========================================================================
   Recomendaciones: de hallazgo a accion.

   Cada pagina del informe termina en un bloque de recomendaciones y la portada
   lleva las cinco de mas retorno del conjunto. Una recomendacion es un objeto
   con seis campos obligatorios —accion, porque, impacto, quien, esfuerzo y con
   que se mide— y las reglas que las gobiernan estan escritas aqui porque son
   tan parte del diseno como los tokens de color:

     1. Cada una sale de un hallazgo concreto de SU pagina, citado con su cifra.
        Si el porque no se puede escribir citando un numero del analisis, la
        recomendacion no sale de los datos y no entra.
     2. La accion no repite el hallazgo en imperativo. "El mantenimiento supera
        al ingreso en 8 referencias" -> la accion no es "bajar el mantenimiento",
        es "retirarlas y fijar la regla de retirada por coste, no por edad".
     3. El impacto se DERIVA de las cifras, nunca se estima a ojo. Cuando sale de
        una cadena de supuestos, la cadena se escribe entera. Cuando no se puede
        poner en euros, se dice que desbloquea en su lugar.
     4. La incertidumbre se declara UNA vez, en la cabecera del bloque, y luego
        no se hedge cada linea.
     5. Las recomendaciones sobre la propia medicion cuentan igual que las de
        negocio. En este informe son, de hecho, las de mas retorno: tres de las
        cinco de portada son deuda de dato.
     6. Un hallazgo que no lleva a ninguna accion se queda como contexto. El
        bloque de la pagina de pricing dice explicitamente que el canal no
        sostiene ninguna accion, en vez de inventarse una.

   NINGUNA cifra de este fichero esta escrita a mano: todas salen de `recoFacts()`,
   que agrega sobre el MISMO motor que el resto del informe. Es la unica forma de
   que no se desincronicen cuando cambie el generador. El unico numero que no es
   dato son las vidas utiles de `AMORT_LIVES`, y por eso van en una constante con
   nombre y se citan en el texto como supuesto.

   Las recomendaciones se calculan sobre el HISTORICO COMPLETO, no sobre el corte
   filtrado, igual que las tarjetas de cohortes y calidad: una recomendacion que
   cambiara de sentido al marcar una casilla de pais no seria una recomendacion.
   =========================================================================== */

/* Vida util del material, en anos. NO es un dato: el hecho no trae amortizacion
   y la dimension de producto solo trae precio de compra y de reposicion. Es el
   supuesto que hace falta para convertir capital en coste anual, y el texto de
   la recomendacion lo dice con estas palabras. Dos valores para que se vea la
   sensibilidad: a 5 anos tres categorias quedan en negativo, a 8 solo una. */
const AMORT_LIVES = [5, 8];

/* Umbral de la regla de retirada: una referencia cuyo mantenimiento se come mas
   de esta fraccion de su ingreso entra en la lista de revision. El 1,0 (pierde
   dinero) es el corte duro; el 0,5 es el de vigilancia. */
const MAINT_WATCH = 0.5;

let RECO_FACTS = null, RECO_LIST = null;

/* --------------------------------------------------------------------------
   1 · Derivacion de las cifras
   Una sola pasada sobre el historico entero, memoizada. Se ejecuta la primera
   vez que se pinta un bloque de recomendaciones, no en el arranque, para no
   retrasar la primera pantalla.
   -------------------------------------------------------------------------- */
function recoFacts() {
  if (RECO_FACTS) return RECO_FACTS;

  const days = DATA.meta.period_days;
  const years = days / 365.25;
  /* El agregado sin filtros cuesta ~0,4 s sobre las 171k filas. En el estado de
     arranque —periodo completo y ningun filtro marcado— `render()` ya lo acaba
     de calcular en `A`, que entonces es exactamente el mismo objeto: se reutiliza
     y la primera pantalla no paga nada. Solo se recalcula si alguien abre el
     informe ya filtrado, y aun asi una sola vez: esto esta memoizado. */
  const unfiltered = state.period === "all" && !state.country.size && !state.cat.size &&
    !state.channel.size && !state.member.size && !state.segment.size;
  const G = (unfiltered && A) ? A : aggregate(new Uint8Array(N).fill(1));
  const t = G.total;
  const perYear = v => v / years;
  const R = { years, days, G, perYear };

  R.global = {
    n: t.n[0], comp: t.comp[0], rev: t.rev[0], revYear: perYear(t.rev[0]),
    ticket: kpi.ticket(t, 0), cancel: kpi.cancel(t, 0), cancN: t.canc[0],
    damage: kpi.damage(t, 0), review: kpi.review(t, 0),
    maint: t.maint[0], maintYear: perYear(t.maint[0]), maintR: kpi.maintR(t, 0),
    priced: t.pn[0],
  };

  /* -- una pasada de fila para todo lo que ningun bucket agregado guarda ---- */
  const LEAD_CUT = 15;                          // franja "reserva con antelacion"
  const lo = { n: 0, canc: 0 }, hi = { n: 0, canc: 0, lost: 0 };
  let cancRev = 0, noPriceComp = 0, noStoreN = 0;
  const noStoreByChan = new Float64Array(D.channels.length + 1);
  const chanN = new Float64Array(D.channels.length + 1);
  const segMem = new Float64Array(D.segments.length * D.members.length);
  const ppd = Array.from({ length: D.categories.length * 4 }, () => []);
  for (let i = 0; i < N; i++) {
    const fl = F.flags[i], canc = fl & 1;
    const noPrice = (fl >> 3) & 1, noDays = (fl >> 4) & 1;
    const price = noPrice ? 0 : F.price[i] / 100;
    if (canc) cancRev += price; else if (noPrice) noPriceComp++;
    const L = F.lead[i];
    if (L !== 255) {
      if (L <= 3) { lo.n++; if (canc) lo.canc++; }
      else if (L >= LEAD_CUT) { hi.n++; if (canc) { hi.canc++; hi.lost += price; } }
    }
    chanN[F.channel[i]]++;
    if (!F.store[i]) { noStoreN++; noStoreByChan[F.channel[i]]++; }
    const sg = F.segment[i] - 1, mb = F.member[i] - 1;
    if (sg >= 0 && mb >= 0) segMem[sg * D.members.length + mb]++;
    const k = rowCat[i];
    if (!canc && !noPrice && !noDays && k >= 0 && F.days[i]) {
      ppd[k * 4 + monthSeason[F.month[i]]].push(price / F.days[i]);
    }
  }
  const perCanc = t.canc[0] ? cancRev / t.canc[0] : NaN;
  R.cancel = {
    n: t.canc[0], rev: cancRev, revYear: perYear(cancRev), perCanc,
    rate: kpi.cancel(t, 0),
  };
  /* Franja de antelacion larga: cuanto se recuperaria llevandola a la tasa de
     las reservas de ultima hora. No es "eliminar la cancelacion": es cerrar el
     exceso que el propio lead time explica. */
  const avoided = Math.max(0, hi.canc - hi.n * (lo.n ? lo.canc / lo.n : 0));
  R.lead = {
    cut: LEAD_CUT, n: hi.n, canc: hi.canc, lost: hi.lost, lostYear: perYear(hi.lost),
    rate: hi.n ? hi.canc / hi.n : NaN, baseRate: lo.n ? lo.canc / lo.n : NaN,
    perCanc: hi.canc ? hi.lost / hi.canc : NaN,
    avoided, saved: avoided * (hi.canc ? hi.lost / hi.canc : 0),
    savedYear: perYear(avoided * (hi.canc ? hi.lost / hi.canc : 0)),
  };
  R.missing = {
    noPriceComp, unbilled: noPriceComp * kpi.ticket(t, 0),
    unbilledYear: perYear(noPriceComp * kpi.ticket(t, 0)),
    unbilledShare: t.rev[0] ? noPriceComp * kpi.ticket(t, 0) / t.rev[0] : NaN,
    noStoreN, noStoreRev: G.country.rev[0], noStoreRevYear: perYear(G.country.rev[0]),
    noStoreShare: t.rev[0] ? G.country.rev[0] / t.rev[0] : NaN,
    /* El nulo de tienda se reparte proporcionalmente entre los canales, asi que
       no hay un punto de captura culpable: la desviacion maxima entre el peso de
       un canal en los nulos y su peso en el total es la que decide esa lectura. */
    chanSkew: Math.max(...D.channels.map((c, i) =>
      Math.abs(noStoreByChan[i + 1] / noStoreN - chanN[i + 1] / N))),
    chans: D.channels.map((c, i) => ({ c: D.channel_labels[i], n: noStoreByChan[i + 1] })),
  };

  /* -- logit de cancelacion: la unica palanca medida -----------------------
     Viene precalculado en el payload (`cancel_model` en build_report.py) en vez
     de ajustarse aqui: es el mismo modelo que ajusta la pagina de estadistica,
     pero sobre el historico entero en lugar de la seleccion, y refitarlo en el
     navegador costaba 1,2 s en la primera pantalla. `verify_report.py` contrasta
     las dos versiones contra statsmodels, asi que no pueden separarse. */
  const lf = DATA.models.cancel_logit;
  R.logit = { n: lf.n, or: Math.exp(lf.lead), or7: Math.exp(lf.lead * 7), p: lf.p_lead };

  /* -- producto: contribucion, rotacion y edad ----------------------------- */
  const pm = [];
  for (let i = 0; i < P.id.length; i++) {
    if (!G.product.n[i]) continue;
    const units = P.units[i] || 0;
    const rev = G.product.rev[i], mnt = G.product.maint[i];
    pm.push({
      i, name: P.name[i], cat: P.cat[i], age: P.age[i], units,
      purchase: P.purchase[i] || 0, replacement: P.replacement[i] || 0,
      rev, maint: mnt, contrib: rev - mnt, maintR: rev ? mnt / rev : NaN,
      occ: units ? G.product.days[i] / (units * days) : NaN,
      damage: kpi.damage(G.product, i), review: kpi.review(G.product, i),
    });
  }
  const occSorted = pm.map(p => p.occ).filter(isFinite).sort((a, b) => a - b);
  const qOcc = f => occSorted[Math.min(occSorted.length - 1, Math.floor(f * (occSorted.length - 1)))];
  const q1 = qOcc(0.25), q3 = qOcc(0.75);
  pm.forEach(p => p.rotation = p.occ <= q1 ? "Infrautilizado" : p.occ >= q3 ? "Saturado" : "Normal");
  R.pm = pm;
  const sum = (set, f) => set.reduce((a, b) => a + f(b), 0);
  const group = set => ({
    refs: set.length, units: sum(set, p => p.units),
    rev: sum(set, p => p.rev), maint: sum(set, p => p.maint),
    capital: sum(set, p => p.units * p.purchase),
    replacement: sum(set, p => p.units * p.replacement),
    revUnitYear: perYear(sum(set, p => p.rev) / sum(set, p => p.units)),
    capitalUnit: sum(set, p => p.units * p.purchase) / sum(set, p => p.units),
    contribYear: perYear(sum(set, p => p.contrib)),
    occ: sum(set, p => G.product.days[p.i]) / (sum(set, p => p.units) * days),
  });
  R.under = group(pm.filter(p => p.rotation === "Infrautilizado"));
  R.sat = group(pm.filter(p => p.rotation === "Saturado"));
  R.occGlobal = sum(pm, p => G.product.days[p.i]) / sum(pm, p => p.units * days);

  /* Referencias que pierden dinero SIN necesidad de suponer nada: su
     mantenimiento registrado supera a su ingreso registrado. */
  const neg = pm.filter(p => p.contrib < 0).sort((a, b) => a.contrib - b.contrib);
  R.neg = Object.assign(group(neg), {
    list: neg,
    worst: neg[0],
    cats: [...new Set(neg.map(p => D.categories[p.cat]))],
  });
  /* Vigilancia: viejas y caras de mantener. Son las candidatas a renovacion, y
     el calculo de abajo es justo el que dice que renovarlas TODAS no compensa. */
  const watch = pm.filter(p => p.age >= 5 && p.maintR > MAINT_WATCH);
  R.watch = Object.assign(group(watch), { list: watch });

  const AGE_CUTS = [0.5, 1, 2, 5, Infinity];
  const AGE_NAMES = ["0–6 meses", "6–12 meses", "1–2 años", "2–5 años", "+5 años"];
  R.age = AGE_CUTS.map((hi2, b) => {
    const lo2 = b ? AGE_CUTS[b - 1] : 0;
    const set = pm.filter(p => p.age != null && p.age >= lo2 && p.age < hi2);
    if (!set.length) return null;
    const comp = sum(set, p => G.product.comp[p.i]);
    return Object.assign(group(set), {
      label: AGE_NAMES[b],
      damage: comp ? sum(set, p => p.damage * G.product.comp[p.i]) / comp : NaN,
      maintR: sum(set, p => p.rev) ? sum(set, p => p.maint) / sum(set, p => p.rev) : NaN,
      review: comp ? sum(set, p => (isFinite(p.review) ? p.review : 0) * G.product.comp[p.i]) / comp : NaN,
    });
  }).filter(Boolean);
  /* Renovar la lista de vigilancia al ratio de mantenimiento del material nuevo:
     el ahorro anual y los anos que tarda en pagarse la reposicion. */
  const newR = R.age.length ? R.age[0].maintR : NaN;
  R.renew = {
    maintYear: perYear(R.watch.maint), revYear: perYear(R.watch.rev),
    afterYear: perYear(R.watch.rev * newR), newR,
    savingYear: perYear(R.watch.maint - R.watch.rev * newR),
    payback: R.watch.replacement / perYear(R.watch.maint - R.watch.rev * newR),
  };

  /* -- categorias: ocupacion, capital y margen despues de amortizar -------- */
  R.cats = D.categories.map((c, k) => {
    const set = pm.filter(p => p.cat === k);
    if (!set.length) return null;
    const g = group(set);
    const o = Object.assign({ cat: c, k }, g, {
      occ: sum(set, p => G.product.days[p.i]) / (g.units * days),
      revYear: perYear(g.rev), maintYear: perYear(g.maint),
      margin: kpi.margin(G.cat, k), ticket: kpi.ticket(G.cat, k),
    });
    AMORT_LIVES.forEach(L => {
      o["amort" + L] = g.capital / L;
      o["net" + L] = o.contribYear - g.capital / L;
    });
    return o;
  }).filter(Boolean);
  R.fleet = {
    capital: sum(R.cats, c => c.capital),
    contribYear: sum(R.cats, c => c.contribYear),
  };
  AMORT_LIVES.forEach(L => {
    R.fleet["amort" + L] = R.fleet.capital / L;
    R.fleet["net" + L] = R.fleet.contribYear - R.fleet.capital / L;
    R.fleet["neg" + L] = R.cats.filter(c => c["net" + L] < 0).sort((a, b) => a["net" + L] - b["net" + L]);
  });
  R.bestOcc = R.cats.slice().sort((a, b) => b.occ - a.occ)[0];
  /* Ampliacion del 10 % de la flota de la categoria mas ocupada: lo que cuesta
     y lo que devuelve SI la unidad nueva alquila como la media de las actuales.
     Ese "si" es el unico supuesto y el texto lo dice. */
  const add = Math.round(R.bestOcc.units * 0.10);
  R.expand = {
    units: add, capex: add * R.bestOcc.capitalUnit,
    gainYear: add * R.bestOcc.revUnitYear,
    payback: R.bestOcc.revUnitYear ? R.bestOcc.capitalUnit / R.bestOcc.revUnitYear : NaN,
  };

  /* -- tiendas: el formato manda sobre el ingreso por visitante ------------ */
  const st = [];
  for (let i = 0; i < S.id.length; i++) {
    const b = i + 1;
    if (!G.store.n[b] || !S.visitors[i]) continue;
    st.push({
      name: S.name[i], city: S.city[i], size: S.size[i],
      visitors: S.visitors[i], rev: G.store.rev[b], n: G.store.n[b],
      rpv: G.store.rev[b] / S.visitors[i], canc: G.store.canc[b],
    });
  }
  const median = arr => {
    const s = Float64Array.from(arr).sort();
    return s.length ? quantileSorted(s, 0.5) : NaN;
  };
  const medGlobal = median(st.map(d => d.rpv));
  R.stores = {
    n: st.length, medGlobal,
    byFormat: D.sizes.map((s, i) => {
      const set = st.filter(d => d.size === i);
      return set.length ? { size: s, n: set.length, med: median(set.map(d => d.rpv)) } : null;
    }).filter(Boolean).sort((a, b) => b.med - a.med),
  };
  const medOf = {};
  R.stores.byFormat.forEach(f => medOf[f.size] = f.med);
  const gapOf = med => st.filter(d => d.rpv < med(d))
    .reduce((a, d) => a + (med(d) - d.rpv) * d.visitors, 0);
  const belowFmt = st.filter(d => d.rpv < medOf[D.sizes[d.size]]);
  R.stores.gapFormat = gapOf(d => medOf[D.sizes[d.size]]);
  R.stores.gapFormatYear = perYear(R.stores.gapFormat);
  R.stores.gapGlobalYear = perYear(gapOf(() => medGlobal));
  R.stores.nBelowFormat = belowFmt.length;
  R.stores.spread = R.stores.byFormat.length > 1
    ? R.stores.byFormat[0].med / R.stores.byFormat[R.stores.byFormat.length - 1].med : NaN;

  /* Homogeneidad de la cancelacion entre tiendas. La tarjeta de friccion ordena
     por tasa; esto contesta si esa tasa distingue algo. Chi-cuadrado de Pearson
     contra la proporcion comun, mas la comparacion de la dispersion observada
     con la que produciria el puro muestreo. */
  const p0 = R.global.cancel;
  let chi2 = 0, varExp = 0, nz2 = 0;
  const rates = [];
  for (const d of st) {
    const e = d.n * p0;
    chi2 += (d.canc - e) * (d.canc - e) / e + (d.n - d.canc - (d.n - e)) * (d.n - d.canc - (d.n - e)) / (d.n - e);
    const se = Math.sqrt(p0 * (1 - p0) / d.n);
    varExp += se * se;
    d.z = (d.canc / d.n - p0) / se;
    if (Math.abs(d.z) > 2) nz2++;
    rates.push(d.canc / d.n);
  }
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  R.stores.chi2 = chi2;
  R.stores.df = st.length - 1;
  R.stores.p = 1 - chiSqCdf(chi2, st.length - 1);
  R.stores.sdObs = Math.sqrt(rates.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (rates.length - 1));
  R.stores.sdExp = Math.sqrt(varExp / st.length);
  R.stores.nz2 = nz2;
  R.stores.expz2 = 0.0455 * st.length;
  R.stores.maxZ = st.slice().sort((a, b) => b.z - a.z)[0];
  R.stores.worstRate = st.filter(d => d.n >= 100).sort((a, b) => b.canc / b.n - a.canc / a.n)[0];

  /* -- clientes: la membresia y el segmento son casi la misma variable ----- */
  const s1 = G.member.canc[3] + G.member.canc[4], n1 = G.member.n[3] + G.member.n[4];
  const s2 = G.member.canc[1] + G.member.canc[2], n2 = G.member.n[1] + G.member.n[2];
  const tp = twoProportions(s1, n1, s2, n2);
  R.member = Object.assign({ s1, n1, s2, n2 }, tp, {
    hi: D.members.slice(2).join(" y "), lo: D.members.slice(0, 2).join(" y "),
    /* Techo, no promesa: cuantas cancelaciones se evitarian si el efecto fuera
       causal y los de abajo pasaran a la tasa de los de arriba. */
    ceiling: (tp.p2 - tp.p1) * n2,
    ceilingYear: perYear((tp.p2 - tp.p1) * n2 * perCanc),
    byLevel: D.members.map((m, i) => ({
      m, n: G.member.n[i + 1], cancel: kpi.cancel(G.member, i + 1),
      ticket: kpi.ticket(G.member, i + 1),
    })),
  });
  /* Cruce segmento x membresia: si los dos extremos no comparten nivel, la
     membresia no se puede separar del segmento con este dato. */
  const segTot = D.segments.map((s, sg) =>
    D.members.reduce((a, m, mb) => a + segMem[sg * D.members.length + mb], 0));
  R.segMem = D.segments.map((s, sg) => ({
    seg: s, n: segTot[sg],
    shares: D.members.map((m, mb) => segTot[sg] ? segMem[sg * D.members.length + mb] / segTot[sg] : 0),
  }));
  const clrv = DATA.lifecycle.segments.slice().sort((a, b) => b.avg_clrv - a.avg_clrv);
  R.clrv = { top: clrv[0], bottom: clrv[clrv.length - 1],
             ratio: clrv[0].avg_clrv / clrv[clrv.length - 1].avg_clrv };
  const co = DATA.lifecycle.cohort;
  const colOf = j => co.matrix.map(r => r[j]).filter(v => v != null);
  R.cohort = { m1: colOf(1), m12: colOf(12) };
  R.cohort.m1Range = [Math.min(...R.cohort.m1), Math.max(...R.cohort.m1)];
  R.cohort.m12Range = [Math.min(...R.cohort.m12), Math.max(...R.cohort.m12)];

  /* -- canal: cuatro canales que no se distinguen en nada ------------------ */
  const ch = D.channels.map((c, i) => ({
    c: D.channel_labels[i], b: i + 1, n: G.channel.n[i + 1],
    cancel: kpi.cancel(G.channel, i + 1), ticket: kpi.ticket(G.channel, i + 1),
    lead: kpi.avgLead(G.channel, i + 1),
  })).filter(d => d.n);
  const span = f => [Math.min(...ch.map(f)), Math.max(...ch.map(f))];
  R.channel = { list: ch, cancel: span(d => d.cancel), ticket: span(d => d.ticket), lead: span(d => d.lead) };

  /* -- pricing: variacion estacional del precio por dia -------------------- */
  R.ppd = D.categories.map((c, k) => {
    const v = [0, 1, 2, 3].map(s => ppd[k * 4 + s].length
      ? quantileSorted(Float64Array.from(ppd[k * 4 + s]).sort(), 0.5) : NaN).filter(isFinite);
    return v.length > 1
      ? { cat: c, k, min: Math.min(...v), max: Math.max(...v), spread: Math.max(...v) / Math.min(...v) - 1 }
      : null;
  }).filter(Boolean).sort((a, b) => b.spread - a.spread);
  R.ppdFlat = R.ppd[R.ppd.length - 1];
  R.ppdSteep = R.ppd[0];
  R.ppdOf = k => R.ppd.find(d => d.k === k);
  /* Contribucion de las dos categorias de mas ticket: lo que una prueba de
     precio pondria en juego. */
  R.topContrib = R.cats.slice().sort((a, b) => b.contribYear - a.contribYear).slice(0, 2);

  /* -- dia de la semana ---------------------------------------------------- */
  const weN = G.dow.n[5] + G.dow.n[6], weRev = G.dow.rev[5] + G.dow.rev[6];
  const wdN = G.dow.n.reduce((a, b) => a + b, 0) - weN;
  R.dow = {
    weN, wdN, share: weN / (weN + wdN), revYear: perYear(weRev),
    revShare: weRev / t.rev[0],
    weTicket: (G.dow.psum[5] + G.dow.psum[6]) / (G.dow.pn[5] + G.dow.pn[6]),
    wdTicket: [0, 1, 2, 3, 4].reduce((a, i) => a + G.dow.psum[i], 0) /
              [0, 1, 2, 3, 4].reduce((a, i) => a + G.dow.pn[i], 0),
  };

  /* -- anomalias semanales: que senala realmente el umbral ----------------- */
  const w0 = Math.floor(D.month_offset[0] / 7) + 1;
  const w1 = Math.floor((D.month_offset[D.months.length - 1] +
              periodDays(D.months.length - 1, D.months.length - 1) - 1) / 7) - 1;
  const wrev = [];
  for (let w = w0; w <= w1; w++) wrev.push(G.weekRev[w] || 0);
  const an = robustAnomalies(wrev, 13, 5);
  const monthOfWeek = i => {
    const d = new Date(Date.UTC(+D.months[0].slice(0, 4), +D.months[0].slice(5, 7) - 1, 1));
    d.setUTCDate(d.getUTCDate() + (w0 + i) * 7);
    return d.getUTCMonth();
  };
  const months = an.flagged.map(monthOfWeek);
  const modeMonth = months.length
    ? months.slice().sort((a, b) => months.filter(x => x === a).length - months.filter(x => x === b).length).pop()
    : null;
  R.anom = {
    weeks: wrev.length, flagged: an.flagged.length,
    inMode: months.filter(m => m === modeMonth).length,
    month: modeMonth == null ? null : MONTH_LONG[modeMonth],
    allSameMonth: months.length > 0 && months.every(m => m === modeMonth),
    peakSeason: modeMonth == null ? null : D.season_labels[monthSeason[D.months.findIndex(
      mm => +mm.slice(5, 7) - 1 === modeMonth)] || 0],
  };

  /* -- calidad: cuanto puede caer una dimension sin disparar la puerta ----- */
  const GATE = 95;                              // el umbral que propone la pagina 9
  const dims = DATA.quality.dims.slice().sort((a, b) => a.valor - b.valor);
  const weak = dims[0];
  const rest = dims.slice(1).reduce((a, d) => a + d.valor * d.peso, 0);
  R.quality = {
    score: DATA.quality.score, gate: GATE, weak,
    floor: (GATE - rest) / weak.peso,
    drop: weak.valor - (GATE - rest) / weak.peso,
    nullNow: 100 - weak.valor,
    nullThen: 100 - (GATE - rest) / weak.peso,
    dupIds: DATA.quality.dup_ids, exactDups: DATA.quality.exact_dups,
    conflicts: DATA.quality.dup_ids - DATA.quality.exact_dups,
  };
  R.quality.nullGrowth = R.quality.nullThen / R.quality.nullNow - 1;

  RECO_FACTS = R;
  return R;
}

const MONTH_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
                    "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/* Funcion de distribucion de la chi-cuadrado, por la gamma incompleta regularizada.
   Hace falta para poner un p-valor al contraste de homogeneidad entre tiendas, que
   es lo que convierte "esta tienda cancela mas" en "esta tienda cancela igual". */
function chiSqCdf(x, k) {
  if (x <= 0) return 0;
  const a = k / 2, xx = x / 2;
  // serie para xx < a+1, fraccion continua en el otro lado
  const lg = lnGamma(a);
  if (xx < a + 1) {
    let sum = 1 / a, term = sum;
    for (let i = 1; i < 500; i++) {
      term *= xx / (a + i);
      sum += term;
      if (term < sum * 1e-14) break;
    }
    return sum * Math.exp(-xx + a * Math.log(xx) - lg);
  }
  let b = xx + 1 - a, c = 1e30, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return 1 - Math.exp(-xx + a * Math.log(xx) - lg) * h;
}
function lnGamma(z) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091,
             -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z, y = z, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

/* --------------------------------------------------------------------------
   2 · Las recomendaciones
   `prio` es el orden por retorno frente a esfuerzo sobre el conjunto entero, no
   por pagina y no por el orden en que aparecieron los analisis. Lo fija esta
   lista a mano, con criterio y no con formula, porque la mitad de los impactos
   no estan en euros y una formula que los mezclara solo escondaria el juicio.
   El criterio, en orden: (1) euros al ano ya derivados, (2) euros al ano que se
   desbloquean, (3) esfuerzo, (4) cuantas otras recomendaciones dependen de ella.
   -------------------------------------------------------------------------- */
function buildRecos() {
  const R = recoFacts();
  const e = v => eur(v, 0);
  /* Una accion puede quedarse sin referencias si cambian los umbrales del plan
     de flota, y entonces `find` devuelve undefined. Leer `.gain` ahi tumbaria la
     pagina entera por una frase. */
  const fleetGain = id => (fleetSummary("neto").find(d => d.id === id) || { gain: 0 }).gain;
  const y = v => eur(v, 0) + "/año";
  const L = AMORT_LIVES[0], L2 = AMORT_LIVES[1];
  const negCats = R.fleet["neg" + L];
  const worstCat = negCats[0];
  const negCats2 = R.fleet["neg" + L2];
  const skiPair = R.topContrib;
  const flat = R.ppdFlat, steep = R.ppdSteep;
  const bestOcc = R.bestOcc, bestPpd = R.ppdOf(bestOcc.k);
  const vip = R.segMem.slice().sort((a, b) => b.shares[3] - a.shares[3])[0];
  const occ = R.segMem.slice().sort((a, b) => a.shares[3] - b.shares[3])[0];
  const w = R.neg.worst;

  return [
    /* ---- 1 · el margen del informe no descuenta el material -------------- */
    {
      prio: 1, page: "calidad", tipo: "medición",
      accion: "Imputar el coste del material a cada alquiler y publicar el margen " +
        "después de amortización, no el margen sobre mantenimiento.",
      porque: "El margen que publica el informe es <b>(ingreso − mantenimiento) / ingreso</b>: " +
        "no descuenta el material. Con esa definición " + R.cats.slice().sort((a, b) => b.margin - a.margin)[0].cat +
        " sale al <b>" + pct(R.cats.slice().sort((a, b) => b.margin - a.margin)[0].margin, 1) + "</b> y " +
        worstCat.cat + " al <b>" + pct(worstCat.margin, 1) + "</b>. Pero la flota vale <b>" +
        e(R.fleet.capital) + "</b> de precio de compra y nadie la amortiza contra los <b>" +
        y(R.global.revYear) + "</b> que ingresa.",
      impacto: "Amortizada linealmente a " + L + " años —supuesto, no dato: el hecho no trae " +
        "amortización— la flota carga <b>" + y(R.fleet["amort" + L]) + "</b> y <b>" + negCats.length +
        " categorías pasan a negativo</b>: " + negCats.map(c => c.cat + " " + e(c["net" + L]) + "/año").join(", ") +
        ". A " + L2 + " años " + (negCats2.length
          ? "solo " + negCats2.map(c => c.cat + " (" + e(c["net" + L2]) + "/año)").join(", ") + " sigue perdiendo"
          : "ninguna pierde") + ". Hoy " + worstCat.cat + " figura en el informe como un negocio de " +
        e(worstCat.rev) + " con un " + pct(worstCat.margin, 1) + " de margen. La vida útil es un " +
        "supuesto; el capital y el ingreso no lo son.",
      quien: "Finanzas · Datos",
      esfuerzo: "bajo",
      nota: "El dato ya está en la dimensión de producto (<code>purchase_price</code> y " +
        "<code>replacement_cost</code>); lo que falta es la vida útil y la regla de imputación.",
      mide: "Margen por categoría <b>después de amortización</b>, mensual. Hoy el cuadro de mando " +
        "enseña margen bruto de mantenimiento, que en un negocio cuyo activo es el material no es margen.",
      euros: Math.abs(worstCat["net" + L]),
      eurosLabel: "cambia el signo de " + worstCat.cat,
    },

    /* ---- 2 · 748 k€ de fuga sin una sola causa registrada ---------------- */
    {
      prio: 2, page: "calidad", tipo: "medición",
      accion: "Añadir <code>cancellation_reason</code> como campo obligatorio al cancelar, " +
        "con una lista cerrada de motivos acordada con tienda y atención al cliente.",
      porque: "<b>" + nf(R.cancel.n) + " cancelaciones</b> y <b>" + e(R.cancel.rev) + "</b> que no se " +
        "facturan (" + y(R.cancel.revYear) + "), y el hecho no guarda un solo campo sobre por qué. " +
        "Todo lo que se puede decir hoy es que la probabilidad sube un <b>" +
        nf((R.logit.or - 1) * 100, 2) + " % por cada día de antelación</b> (odds ratio " +
        nf(R.logit.or, 4) + " sobre " + nf(R.logit.n) + " observaciones): un indicio del calendario, " +
        "no una causa.",
      impacto: "Convierte <b>" + y(R.cancel.revYear) + "</b> de fuga en un problema diagnosticable. " +
        "La medida de su tamaño es la comparación: sin el motivo, la única palanca que sostienen los " +
        "datos es el recordatorio de la página de demanda, que cierra <b>" + y(R.lead.savedYear) +
        "</b> — un " + pct(R.lead.savedYear / R.cancel.revYear, 0) + " del agujero. El " +
        pct(1 - R.lead.savedYear / R.cancel.revYear, 0) + " restante no es que no se pueda atacar: " +
        "es que no se sabe con qué.",
      quien: "Producto · Datos",
      esfuerzo: "bajo",
      mide: "% de cancelaciones con motivo informado y reparto por motivo, semanal. Hoy el campo " +
        "no existe, así que la métrica de partida es 0 %.",
      euros: R.cancel.revYear,
      eurosLabel: "de fuga que pasa a ser diagnosticable",
    },

    /* ---- 3 · el ranking de tiendas compara peras con manzanas ------------ */
    {
      prio: 3, page: "tiendas", tipo: "negocio",
      accion: "Fijar el objetivo de cada tienda contra la mediana de <b>su formato</b> y " +
        "arrancar por las " + nf(R.stores.nBelowFormat) + " que están por debajo de la suya.",
      porque: "El ingreso por visitante cae de forma monótona con el tamaño: " +
        R.stores.byFormat.map(f => f.size + " " + nf(f.med, 3) + " €").join(", ") +
        ". El formato más pequeño convierte <b>" + nf(R.stores.spread, 1) + " veces</b> más por " +
        "visita que el más grande, así que un ranking sin controlar por formato coloca a las " +
        "grandes en el fondo por construcción: no es ejecución, es el denominador.",
      impacto: "La brecha real —" + nf(R.stores.nBelowFormat) + " tiendas por debajo de la mediana " +
        "<b>de su propio formato</b>— vale <b>" + e(R.stores.gapFormat) + "</b> en la ventana, <b>" +
        y(R.stores.gapFormatYear) + "</b>. Contra la mediana global saldrían " +
        y(R.stores.gapGlobalYear) + ", <b>" + nf(R.stores.gapGlobalYear / R.stores.gapFormatYear, 1) +
        " veces más</b>: esa diferencia es el artefacto del tamaño, y es la cifra que hoy se " +
        "llevaría a un comité.",
      quien: "Operaciones · Retail",
      esfuerzo: "medio",
      mide: "€ por visitante de cada tienda frente a la mediana de su formato, y número de tiendas " +
        "que cruzan esa mediana por trimestre. Hoy se mira el ingreso absoluto por tienda, que premia " +
        "el tamaño y esconde a las pequeñas que convierten el doble.",
      euros: R.stores.gapFormatYear,
      eurosLabel: "de brecha cerrable",
    },

    /* ---- 4 · ingreso real que el informe no cuenta ------------------------ */
    {
      prio: 4, page: "calidad", tipo: "medición",
      accion: "Recuperar el importe de los alquileres completados que llegan sin " +
        "<code>rental_price</code> y cuadrar el total contra contabilidad cada cierre.",
      porque: "<b>" + nf(R.missing.noPriceComp) + " alquileres completados</b> llegan sin importe. " +
        "No son cancelaciones: se entregó el material y se devolvió. El informe los cuenta como " +
        "alquiler y no como ingreso, y por eso el ticket medio se calcula sobre " +
        nf(R.global.priced) + " alquileres y no sobre los " + nf(R.global.comp) + " completados.",
      impacto: "Al ticket medio de " + eur(R.global.ticket, 2) + " son <b>" + e(R.missing.unbilled) +
        "</b> (" + y(R.missing.unbilledYear) + ") de ingreso facturado que no aparece en ninguna cifra " +
        "del informe: un <b>" + pct(R.missing.unbilledShare, 1) + "</b> de los ingresos. No es dinero " +
        "nuevo —el cliente ya pagó—, es dinero que hoy se publica de menos, y basta para cambiar el " +
        "signo de la comparación interanual de un mes flojo.",
      quien: "Datos · Finanzas",
      esfuerzo: "bajo",
      mide: "% de alquileres completados con importe, y diferencia entre el ingreso del informe y el " +
        "de contabilidad al cierre. Hoy el nulo se descuenta del denominador y desaparece sin dejar rastro.",
      euros: R.missing.unbilledYear,
      eurosLabel: "de ingreso que no se publica",
    },

    /* ---- 5 · la única compra con retorno previsible ----------------------- */
    {
      prio: 5, page: "producto", tipo: "negocio",
      accion: "Ampliar un " + nf(100 * R.expand.units / bestOcc.units, 0) + " % la flota de " +
        bestOcc.cat + " antes de comprar una sola unidad de cualquier otra categoría.",
      porque: "<b>" + bestOcc.cat + "</b> alcanza el <b>" + pct(bestOcc.occ, 2) + "</b> de ocupación " +
        "frente al " + pct(R.occGlobal, 2) + " de la flota, y con <b>" + nf(bestOcc.units) +
        " unidades</b> rinde <b>" + eur(bestOcc.revUnitYear, 0) + " por unidad y año</b>, contra los " +
        eur(R.under.revUnitYear, 0) + " de las " + nf(R.under.units) + " unidades infrautilizadas.",
      impacto: "<b>" + nf(R.expand.units) + " unidades más</b> al precio medio de compra de la " +
        "categoría (" + eur(bestOcc.capitalUnit, 0) + "/ud) cuestan <b>" + e(R.expand.capex) +
        "</b> y, si alquilan como las actuales, añaden <b>" + y(R.expand.gainYear) + "</b>: " +
        nf(R.expand.payback * 12, 0) + " meses de retorno. El «si» es el único supuesto de la cadena, " +
        "y lo sostiene la ocupación, no lo demuestra: sin registro de demanda no servida " +
        "(recomendación siguiente) no hay forma de confirmarlo antes de comprar.",
      quien: "Producto · Compras",
      esfuerzo: "bajo",
      mide: "€ por unidad y año de las referencias ampliadas, antes y después. <b>No</b> la ocupación " +
        "media: baja mecánicamente al añadir unidades y confundiría el éxito con el fracaso.",
      euros: R.expand.gainYear,
      eurosLabel: "con " + nf(R.expand.payback * 12, 0) + " meses de retorno",
    },

    /* ---- 6 · retirar por coste, no por edad ------------------------------ */
    {
      prio: 6, page: "producto", tipo: "negocio",
      accion: "Retirar las <b>" + nf(R.neg.refs) + " referencias</b> cuyo mantenimiento ya supera a su " +
        "ingreso, y sustituir la regla de retirada por edad por una de <b>edad × coste</b>.",
      porque: "<b>" + nf(R.neg.refs) + " referencias</b> de " + R.neg.cats.join(" y ") + " —" +
        nf(R.neg.units) + " unidades— facturan " + y(R.perYear(R.neg.rev)) + " y cuestan <b>" +
        y(R.perYear(R.neg.maint)) + "</b> de mantenimiento. La peor, <i>" + w.name + "</i> (" +
        nf(w.units) + " uds, " + nf(w.age, 1) + " años), gasta <b>" + nf(w.maintR, 2) +
        " €</b> de mantenimiento por cada euro que ingresa.",
      impacto: "Dejar de perder <b>" + y(-R.neg.contribYear) + "</b>. No hay cadena de supuestos: el " +
        "ingreso y el mantenimiento están los dos en el hecho. Y el mismo cálculo dice qué <b>no</b> " +
        "hacer: renovar las " + nf(R.watch.refs) + " referencias de más de 5 años cuyo mantenimiento " +
        "pasa del " + pct(MAINT_WATCH, 0) + " de su ingreso cuesta " + e(R.watch.replacement) +
        " y ahorra " + y(R.renew.savingYear) + " — <b>" + nf(R.renew.payback, 1) + " años de retorno</b>. " +
        "Compensa retirar las " + nf(R.neg.refs) + " que pierden dinero, no renovar el tramo entero.",
      quien: "Operaciones",
      esfuerzo: "bajo",
      mide: "Número de referencias con ratio de mantenimiento sobre 12 meses superior al 100 %, y su " +
        "capital. Hoy se mira la tasa de averías (" + pct(R.global.damage, 1) + "), que no distingue " +
        "una avería barata de una que se come la referencia.",
      euros: -R.neg.contribYear,
      eurosLabel: "que se pierden hoy",
    },

    /* ---- 7 · no hay elasticidad, solo tarifa ----------------------------- */
    {
      prio: 7, page: "pricing", tipo: "medición",
      accion: "Montar una prueba de precio controlada —mismo material, dos tarifas, tiendas " +
        "asignadas al azar— empezando por " + bestOcc.cat + ".",
      porque: "El OLS reconstruye el precio a partir de duración, categoría, temporada y país con " +
        "R² alto, pero eso describe <b>la tarifa vigente</b>, no cómo respondería la demanda. Ninguno " +
        "de los " + nf(R.global.priced) + " alquileres con importe se fijó nunca deliberadamente " +
        "distinto para medir la respuesta. La variación estacional que se ve —" + steep.cat + " " +
        nf(steep.spread * 100, 0) + " %, " + flat.cat + " " + nf(flat.spread * 100, 1) + " %— dice " +
        "lo que se cobró, no lo que se podría cobrar.",
      impacto: "Convierte un ratio decorativo en una cifra sobre la que decidir. Hoy cualquier " +
        "propuesta de subir el precio en pico es una apuesta: las dos categorías de más contribución " +
        "(" + skiPair.map(c => c.cat).join(" y ") + ", <b>" +
        y(skiPair.reduce((a, c) => a + c.contribYear, 0)) + "</b> entre las dos) se optimizarían a " +
        "ciegas. Empezar por " + bestOcc.cat + " es empezar por donde menos volumen se arriesga: " +
        "es la categoría con más ocupación (" + pct(bestOcc.occ, 2) + ") y el precio apenas se mueve " +
        "entre temporadas (" + nf(bestPpd.spread * 100, 0) + " %, frente al " +
        nf(steep.spread * 100, 0) + " % de " + steep.cat + "), así que hay recorrido que probar " +
        "sin tocar el pico de nadie.",
      quien: "Pricing · Datos",
      esfuerzo: "medio",
      mide: "Variación del ingreso por unidad y día ante el cambio de tarifa, <b>a ocupación " +
        "constante</b>. Hoy se mira el ticket medio, que se mueve con el mix de duración y no " +
        "distingue un precio mejor de un alquiler más largo.",
      euros: skiPair.reduce((a, c) => a + c.contribYear, 0),
      eurosLabel: "de contribución que hoy se fija a ciegas",
    },

    /* ---- 8 · la membresía no está identificada --------------------------- */
    {
      prio: 8, page: "clientes", tipo: "negocio",
      accion: "Antes de invertir en el programa de socios, aleatorizar la oferta de subida de nivel " +
        "sobre un grupo de clientes " + R.member.byLevel[0].m + " de alta frecuencia y medir contra " +
        "un control.",
      porque: "<b>" + R.member.hi + "</b> cancelan el <b>" + pct(R.member.p1, 2) + "</b> frente al <b>" +
        pct(R.member.p2, 2) + "</b> de " + R.member.lo + " —" + nf(Math.abs(R.member.diff) * 100, 2) +
        " puntos, z = " + nf(R.member.z, 1) + "— pero membresía y segmento son casi la misma variable: " +
        "el <b>" + pct(vip.shares[3], 1) + "</b> de los clientes <i>" + vip.seg + "</i> son " +
        D.members[3] + " y el <b>" + pct(occ.shares[3], 1) + "</b> de los <i>" + occ.seg +
        "</i> lo son. El CLRV medio de un " + R.clrv.top.segment + " es " + nf(R.clrv.ratio, 1) +
        " veces el de un " + R.clrv.bottom.segment + ". No se puede separar «ser socio reduce la " +
        "cancelación» de «quien alquila mucho acaba siendo socio».",
      impacto: "Si el efecto fuera causal, llevar a " + R.member.lo + " a la tasa de " + R.member.hi +
        " evitaría <b>" + nf(R.member.ceiling) + " cancelaciones</b> = " + y(R.member.ceilingYear) +
        ". Ese es el <b>techo que justifica el experimento</b>, no el resultado que promete. Y hay " +
        "un peaje que hoy no se contabiliza: el ticket medio cae de " +
        eur(R.member.byLevel[0].ticket, 2) + " en " + R.member.byLevel[0].m + " a " +
        eur(R.member.byLevel[R.member.byLevel.length - 1].ticket, 2) + " en " +
        R.member.byLevel[R.member.byLevel.length - 1].m + ", así que el programa sólo sale si la " +
        "frecuencia compensa el descuento — y eso es justo lo que el experimento mide.",
      quien: "Marketing · Datos",
      esfuerzo: "medio",
      mide: "Diferencia en la tasa de cancelación y en alquileres por cliente entre el grupo al que " +
        "se ofrece la subida y el de control, a 90 días. Hoy se mira la cancelación por nivel de socio, " +
        "que mezcla efecto y selección y siempre dará la respuesta que se quiere oír.",
      euros: R.member.ceilingYear,
      eurosLabel: "de techo, no de promesa",
    },

    /* ---- 9 · el plan de flota descansa en un supuesto sin dueño --------- */
    {
      prio: 9, page: "flota", tipo: "medición",
      accion: "Fijar con Finanzas la <b>vida útil por categoría</b> y el retorno mínimo que se " +
        "le exige a una unidad, y meterlos en la definición del plan de flota.",
      porque: "El plan entero cuelga de dos números que hoy los pone el análisis, no el negocio: " +
        "una vida útil de " + nf(FLEET_LIFE) + " años y un umbral de holgura en la mitad de esa " +
        "vida. Y no son inocuos: <b>" + nf(fleetPlan().sens.refs) + " de las " +
        nf(fleetPlan().rows.length) + " referencias</b> —" + e(fleetPlan().sens.capital) + " de " +
        "capital— cruzan un umbral si la vida útil resulta ser " + nf(AMORT_LIVES[1]) +
        " años en lugar de " + nf(AMORT_LIVES[0]) + ".",
      impacto: "No es un ajuste fino: es qué material sale del catálogo. Con " + nf(AMORT_LIVES[0]) +
        " años el plan manda retirar, no reponer o renovar " +
        nf(fleetSummary("neto").filter(d => ["retirar", "noreponer", "renovar"].includes(d.id))
           .reduce((a, d) => a + d.refs, 0)) + " referencias; " + nf(fleetPlan().sens.refs) +
        " decisiones más están a un supuesto de distancia de cambiar de bando. Mientras el número " +
        "lo ponga el análisis, el plan es una propuesta; en cuanto lo ponga Finanzas, es una " +
        "política que se puede auditar.",
      quien: "Finanzas · Operaciones",
      esfuerzo: "bajo",
      nota: "Va detrás de imputar el coste del material: sin esa imputación no hay nada que " +
        "amortizar y estos dos umbrales no se pueden ni plantear.",
      mide: "% del capital de flota cubierto por una vida útil acordada por categoría, y fecha de " +
        "la última revisión. Hoy es <b>0 %</b>: no existe el documento.",
      euros: null,
      eurosLabel: e(fleetPlan().sens.capital) + " de capital a un supuesto de distancia",
    },

    /* ---- 10 · la dimensión de cliente no tiene historia -------------------- */
    {
      prio: 10, page: "clientes", tipo: "medición",
      accion: "Historificar la dimensión de cliente con una SCD tipo 2: una fila por nivel de socio " +
        "y segmento, con validez desde–hasta.",
      porque: "<code>membership_level</code> y <code>customer_segment</code> valen lo que valían el " +
        DATA.meta.last_date + ", no lo que valían el día de cada alquiler. Un cliente que subió a " +
        D.members[3] + " en cualquier momento de la ventana aparece como " + D.members[3] +
        " también en sus alquileres de " + DATA.meta.first_date.slice(0, 4) + ". La página entera de " +
        "fidelización se apoya en un atributo que no existe en el momento del hecho.",
      impacto: "Sin esto, el experimento anterior no se puede leer ni siquiera a posteriori sobre el " +
        "histórico: hay " + nf(R.global.n) + " alquileres con nivel de socio y ninguno con el nivel " +
        "<i>vigente</i>. Desbloquea la única lectura que decide —qué pasó <b>después</b> de la " +
        "subida de nivel— y es el prerrequisito de la recomendación anterior: sin ella el experimento " +
        "mide 90 días y no se puede contrastar contra nada.",
      quien: "Datos",
      esfuerzo: "medio",
      mide: "% de alquileres cuyo nivel de socio coincide con el vigente en su fecha. Hoy es, por " +
        "construcción, el 100 % — y por eso no informa de nada.",
      euros: null,
      eurosLabel: "desbloquea medir la fidelización",
    },

    /* ---- 11 · el ranking de fricción ordena ruido ------------------------- */
    {
      prio: 11, page: "tiendas", tipo: "medición",
      accion: "Sacar el ranking de cancelación por tienda del seguimiento operativo y sustituirlo por " +
        "un control con intervalo: sólo se audita la tienda cuyo intervalo no toca la media.",
      porque: "Las " + nf(R.stores.n) + " tiendas cancelan estadísticamente igual. El contraste de " +
        "homogeneidad da <b>χ² = " + nf(R.stores.chi2, 1) + "</b> con " + nf(R.stores.df) +
        " grados de libertad (<b>p = " + nf(R.stores.p, 2) + "</b>), y la dispersión observada entre " +
        "tiendas (" + nf(R.stores.sdObs * 100, 3) + " pp) es <b>menor</b> que la que produciría el " +
        "puro muestreo (" + nf(R.stores.sdExp * 100, 3) + " pp). Ninguna tienda llega a |z| &gt; 3 y sólo " +
        nf(R.stores.nz2) + " pasan de |z| &gt; 2, cuando el azar predice " + nf(R.stores.expz2, 1) + ".",
      impacto: "La tienda que hoy encabeza el ranking (" + R.stores.worstRate.name + ", " +
        pct(R.stores.worstRate.canc / R.stores.worstRate.n, 2) + " sobre una media de " +
        pct(R.global.cancel, 2) + ") está a z = " + nf(R.stores.maxZ.z, 1) + ": indistinguible del " +
        "resto. Lo que ahorra no son euros, es <b>no gastar una auditoría de campo en una diferencia " +
        "que no existe</b> — y no perseguir cada trimestre a una tienda distinta por azar.",
      quien: "Operaciones · Datos",
      esfuerzo: "bajo",
      mide: "Número de tiendas cuyo intervalo de confianza del 95 % no contiene la media de la red. " +
        "Hoy, con este volumen por tienda, sería <b>cero</b>, y esa es la información útil.",
      euros: null,
      eurosLabel: "evita perseguir ruido",
    },

    /* ---- 12 · 2 % del ingreso sin dueño ---------------------------------- */
    {
      prio: 12, page: "calidad", tipo: "medición",
      accion: "Resolver el <code>store_id</code> nulo en el sistema de reservas, no en el pipeline, " +
        "y bloquear el cierre del alquiler sin tienda asignada.",
      porque: "<b>" + nf(R.missing.noStoreN) + " alquileres</b> llegan sin <code>store_id</code> y " +
        "arrastran <b>" + e(R.missing.noStoreRev) + "</b> —el " + pct(R.missing.noStoreShare, 2) +
        " del ingreso— que no entra en el mapa, ni en el ranking de tiendas, ni en el reparto de " +
        "objetivos. Y no hay un punto de captura culpable: los nulos se reparten entre los canales " +
        "(" + R.missing.chans.map(c => c.c + " " + nf(c.n)).join(", ") + ") con una desviación máxima " +
        "de " + nf(R.missing.chanSkew * 100, 1) + " puntos respecto a su peso en el total. Es el ETL, " +
        "no el mostrador.",
      impacto: "<b>" + y(R.missing.noStoreRevYear) + "</b> dejan de ser asignables. Y el efecto no es " +
        "sólo contable: a la tienda a la que le falta ese 2 % se lo descuentan de su € por visitante, " +
        "que es exactamente el número contra el que se la va a comparar.",
      quien: "Datos",
      esfuerzo: "bajo",
      mide: "% de alquileres con <code>store_id</code> resuelto en el día. Hoy el nulo se tapa con un " +
        "LEFT JOIN y se mira una vez, en la página de calidad.",
      euros: R.missing.noStoreRevYear,
      eurosLabel: "de ingreso sin dueño",
    },

    /* ---- 13 · el detector de anomalías detecta la temporada --------------- */
    {
      prio: 13, page: "estadistica", tipo: "medición",
      accion: "Desestacionalizar la serie semanal antes de aplicar el umbral: comparar cada semana " +
        "con la misma semana del año anterior, no con su mediana móvil.",
      porque: "Las <b>" + nf(R.anom.flagged) + " semanas</b> que superan el umbral de |z| &gt; 5 sobre " +
        nf(R.anom.weeks) + " " + (R.anom.allSameMonth ? "son <b>todas de " + R.anom.month + "</b>"
          : "se concentran en " + R.anom.month + " (" + nf(R.anom.inMode) + " de " + nf(R.anom.flagged) + ")") +
        ". No son anomalías: son el pico de temporada. La mediana móvil de 13 semanas no puede seguir " +
        "una rampa estacional y convierte la propia estacionalidad en residuo.",
      impacto: "La precisión del aviso es hoy de <b>" + nf(R.anom.flagged - R.anom.inMode) + " de " +
        nf(R.anom.flagged) + "</b>. Un aviso que salta cada " + R.anom.month + " se desactiva el " +
        "segundo año, y entonces tampoco avisa de la caída real. Lo que desbloquea es que la " +
        "vigilancia siga encendida cuando haga falta.",
      quien: "Datos",
      esfuerzo: "bajo",
      mide: "Precisión del aviso: % de semanas señaladas que resultan ser un incidente y no un pico " +
        "de calendario. Hoy es 0 %, y nadie la calcula porque nadie contrasta las señaladas.",
      euros: null,
      eurosLabel: "vigilancia que hoy no sirve",
    },

    /* ---- 14 · la única palanca de cancelación que sostienen los datos ----- */
    {
      prio: 14, page: "demanda", tipo: "negocio",
      accion: "Montar una confirmación escalonada para las reservas de más de " + nf(R.lead.cut) +
        " días —aviso a T−7, a T−2 y opción de cambiar fecha en un clic— en vez de esperar a la " +
        "cancelación.",
      porque: "La cancelación sube con la antelación: <b>" + pct(R.lead.baseRate, 2) + "</b> en las " +
        "reservas de 0–3 días frente a <b>" + pct(R.lead.rate, 2) + "</b> en las de " + nf(R.lead.cut) +
        " días o más. La regresión logística lo confirma con un odds ratio de " + nf(R.logit.or, 4) +
        " por día (" + nf(R.logit.or7, 3) + "× a siete días) sobre " + nf(R.logit.n) + " observaciones.",
      impacto: "Las <b>" + nf(R.lead.n) + " reservas</b> con " + nf(R.lead.cut) + " días o más " +
        "acumulan " + nf(R.lead.canc) + " cancelaciones y " + e(R.lead.lost) + " no facturados. " +
        "Llevar esa franja a la tasa de las reservas de última hora evita <b>" + nf(R.lead.avoided, 0) +
        " cancelaciones</b> × " + eur(R.lead.perCanc, 2) + " de ticket = <b>" + e(R.lead.saved) +
        "</b>, o <b>" + y(R.lead.savedYear) + "</b>. Es pequeño a propósito: es todo lo que el lead " +
        "time explica, y por eso la recomendación de registrar el motivo va antes que esta.",
      quien: "Producto · CRM",
      esfuerzo: "bajo",
      mide: "% de reservas con " + nf(R.lead.cut) + "+ días de antelación que confirman o reprograman " +
        "tras el aviso, y tasa de cancelación <b>de esa franja</b>. Hoy se mira la cancelación global " +
        "(" + pct(R.global.cancel, 2) + "), que promedia la franja con todo lo demás y no se movería.",
      euros: R.lead.savedYear,
      eurosLabel: "recuperables",
    },

    /* ---- 15 · nunca se registra lo que no se pudo servir ------------------ */
    {
      prio: 15, page: "producto", tipo: "medición",
      accion: "Registrar la demanda no servida: un evento por cada búsqueda o reserva que no se pudo " +
        "cerrar por falta de unidades, con referencia, tienda y fecha.",
      porque: "Toda la página mide lo que se alquiló y nunca lo que se pidió. La ocupación de la " +
        "flota es del <b>" + pct(R.occGlobal, 2) + "</b> y la de las " + nf(R.sat.refs) +
        " referencias saturadas del <b>" + pct(R.sat.occ, 2) + "</b>, pero no hay un solo registro " +
        "de una reserva que no se pudo servir. «Saturado» es hoy un cuartil de ocupación, no una " +
        "constatación de demanda insatisfecha.",
      impacto: "Es lo que separa la recomendación de ampliar " + bestOcc.cat + " —" +
        y(R.expand.gainYear) + " sobre " + e(R.expand.capex) + "— de un supuesto: si la ocupación " +
        "alta viene de demanda insatisfecha, la unidad nueva se alquila; si viene de que esa " +
        "referencia se alquila muchos días seguidos, no. Con el evento registrado, el ingreso " +
        "perdido por rotura pasa a ser una cifra y la compra de flota deja de decidirse por " +
        "analogía. Sin él, <b>" + e(R.sat.capital + R.under.capital) + "</b> de capital se " +
        "reasignan cada temporada mirando sólo el lado que sí se mide.",
      quien: "Producto · Datos",
      esfuerzo: "medio",
      mide: "Reservas rechazadas por falta de unidades, por referencia y semana, y su importe " +
        "potencial. Hoy el evento no se emite: la métrica de partida no es cero, es inexistente.",
      euros: null,
      eurosLabel: "convierte la ocupación en demanda",
    },

    /* ---- 16 · el plan no aprende porque nadie registra que se hizo ------ */
    {
      prio: 16, page: "flota", tipo: "medición",
      accion: "Registrar la acción ejecutada sobre cada referencia —qué, cuándo y cuántas " +
        "unidades— y comparar a doce meses el neto por unidad contra el que el plan predijo.",
      porque: "El plan propone una acción sobre <b>" +
        nf(fleetSummary("neto").filter(d => d.id !== "mantener").reduce((a, d) => a + d.refs, 0)) +
        " referencias</b>, pero nada en el pipeline guarda que se haya tomado. La temporada que " +
        "viene el mismo motor volverá a derivar la misma lista sin saber si la anterior funcionó: " +
        "es exactamente el hueco que impide hacer esto mismo sobre el cliente, en pequeño.",
      impacto: "Es lo que separa una lista de una <i>next best action</i>. Hoy el plan promete " +
        e(fleetGain("ampliar")) + "/año por ampliar y " +
        e(fleetGain("noreponer")) + "/año de capital por no reponer, y no hay " +
        "forma de comprobar ninguna de las dos cifras. Con el registro, cada temporada corrige los " +
        "umbrales de la anterior en vez de repetirlos.",
      quien: "Operaciones · Datos",
      esfuerzo: "bajo",
      mide: "Error del plan: diferencia entre el neto por unidad y año previsto y el observado a " +
        "doce meses, sobre las referencias en las que se actuó. Hoy no se puede calcular porque " +
        "no se sabe en cuáles se actuó.",
      euros: null,
      eurosLabel: "convierte la lista en un bucle que aprende",
    },

    /* ---- 17 · el índice compuesto esconde su dimensión más débil ---------- */
    {
      prio: 17, page: "modelo", tipo: "medición",
      accion: "Poner el umbral de la puerta de calidad en <b>cada dimensión</b>, no sólo en el índice " +
        "compuesto, y fijar el de " + R.quality.weak.dim.toLowerCase() + " en su nivel actual.",
      porque: "El índice está en <b>" + nf(R.quality.score, 2) + "</b>, pero sus cuatro dimensiones no " +
        "se mueven igual: <b>" + R.quality.weak.dim + "</b> está en " + nf(R.quality.weak.valor, 2) +
        " %, " + nf(DATA.quality.dims.slice().sort((a, b) => b.valor - a.valor)[0].valor -
          R.quality.weak.valor, 1) + " puntos por debajo de la mejor, y pesa el " +
        pct(R.quality.weak.peso, 0) + ".",
      impacto: "Con la puerta puesta en " + nf(R.quality.gate) + " sobre el compuesto, " +
        R.quality.weak.dim.toLowerCase() + " puede caer de <b>" + nf(R.quality.weak.valor, 2) +
        " % a " + nf(R.quality.floor, 2) + " %</b> sin que salte nada: la tasa de nulos pasaría del " +
        nf(R.quality.nullNow, 2) + " % al " + nf(R.quality.nullThen, 2) + " %, un <b>" +
        pct(R.quality.nullGrowth, 0) + " más de dato que falta</b>, invisible para el control. Una " +
        "puerta que sólo mira el agregado es una puerta que se puede compensar.",
      quien: "Datos",
      esfuerzo: "bajo",
      mide: "Número de dimensiones por debajo de su propio umbral, y días desde el último cruce. Hoy " +
        "se vigila un único número que promedia las cuatro.",
      euros: null,
      eurosLabel: "cierra un hueco del control",
    },

    /* ---- 18 · la colisión de identificadores se resuelve en el sitio malo -- */
    {
      prio: 18, page: "calidad", tipo: "medición",
      accion: "Escalar la colisión de <code>rental_id</code> al sistema de reservas y devolver ahí la " +
        "regla de desempate, en vez de resolverla en la capa analítica.",
      porque: "<b>" + nf(R.quality.dupIds) + " claves primarias repetidas</b>, de las que " +
        nf(R.quality.exactDups) + " son filas idénticas —un reintento del ETL, que se deduplica sin " +
        "más— y <b>" + nf(R.quality.conflicts) + " traen datos en conflicto bajo el mismo " +
        "identificador</b>. La regla que las resuelve (conservar el registro más completo y, en " +
        "empate, el más reciente) decide cuál de las dos versiones de un alquiler es la buena.",
      impacto: "<b>" + nf(R.quality.conflicts) + " alquileres</b> cuyo importe, duración o tienda " +
        "dependen de un desempate escrito en la capa analítica. No es dinero: es que la cifra que se " +
        "publique no es reconstruible desde el origen. Lo que desbloquea es poder auditar un número " +
        "hasta la operación que lo creó, que es la diferencia entre un informe y un dato.",
      quien: "Datos · Ingeniería de reservas",
      esfuerzo: "medio",
      mide: "Número de <code>rental_id</code> en conflicto detectados <b>en origen</b> por semana. Hoy " +
        "se cuentan una vez, aguas abajo, después de que el pipeline ya los haya fusionado.",
      euros: null,
      eurosLabel: "hace auditable la cifra",
    },

    /* ---- 19 · la retención no es mensual, es de temporada ----------------- */
    {
      prio: 19, page: "clientes", tipo: "negocio",
      accion: "Mover el calendario de recompra al mes anterior al pico de la categoría que el cliente " +
        "alquiló, en vez de al mes siguiente a su alquiler.",
      porque: "La retención cae al <b>" + nf(R.cohort.m1Range[0], 1) + "–" + nf(R.cohort.m1Range[1], 1) +
        " %</b> en M+1 y <b>no sigue bajando</b>: en M+12 sigue entre el " + nf(R.cohort.m12Range[0], 1) +
        " % y el " + nf(R.cohort.m12Range[1], 1) + " %. Eso no es una curva de abandono, es recompra " +
        "estacional. El alquiler se comporta como compra puntual, no como suscripción.",
      impacto: "No cuantificable con este dato: no hay coste de campaña ni respuesta histórica a " +
        "ninguna, así que cualquier euro sería inventado. Lo que cambia es el calendario, y es un " +
        "cambio caro de equivocar: una campaña lanzada en M+1 persigue a un cliente que acaba de " +
        "alquilar y no volverá hasta la temporada siguiente.",
      quien: "Marketing",
      esfuerzo: "bajo",
      mide: "% de clientes que repiten en la <b>temporada equivalente</b> del año siguiente (M+12), " +
        "por categoría del primer alquiler. Hoy se mira M+1, que en este negocio es ruido.",
      euros: null,
      eurosLabel: "cambia el calendario, no el gasto",
    },

    /* ---- 20 · el capital inmovilizado no tiene umbral --------------------- */
    {
      prio: 20, page: "producto", tipo: "negocio",
      accion: "Fijar un rendimiento mínimo por unidad y año y aplicarlo al cuartil de peor rotación " +
        "en la revisión de flota de cada temporada.",
      porque: "Las <b>" + nf(R.under.refs) + " referencias infrautilizadas</b> inmovilizan <b>" +
        e(R.under.capital) + "</b> de precio de compra y rinden <b>" + eur(R.under.revUnitYear, 0) +
        " por unidad y año</b>. El cuartil saturado rinde " + eur(R.sat.revUnitYear, 0) +
        " sobre un capital por unidad casi idéntico (" + eur(R.sat.capitalUnit, 0) +
        " la unidad saturada, " + eur(R.under.capitalUnit, 0) + " la infrautilizada): <b>" +
        nf(R.sat.revUnitYear / R.under.revUnitYear, 1) +
        " veces el retorno por el mismo euro invertido</b>.",
      impacto: "El umbral es lo que hoy no existe: no hay ninguna cifra que diga cuándo una unidad " +
        "deja de merecer el sitio que ocupa. Con el coste del material imputado (primera " +
        "recomendación) el umbral sale solo —el rendimiento tiene que cubrir la amortización, " +
        "" + eur(R.under.capitalUnit / AMORT_LIVES[0], 0) + " por unidad y año a " + AMORT_LIVES[0] +
        " años— y <b>el cuartil infrautilizado no lo cubre</b>. Es una decisión de " +
        e(R.under.capital) + " que hoy se toma sin número.",
      quien: "Operaciones · Finanzas",
      esfuerzo: "alto",
      mide: "€ de ingreso anual por € de capital inmovilizado, por referencia, y número de " +
        "referencias por debajo del umbral. Hoy se mira la ocupación, que no sabe lo que cuesta la unidad.",
      euros: null,
      eurosLabel: e(R.under.capital) + " de capital sin criterio",
    },

    /* ---- 21 · con este n, todo sale significativo ------------------------- */
    {
      prio: 21, page: "estadistica", tipo: "medición",
      accion: "Acordar un tamaño de efecto mínimo por decisión antes de mirar ningún p-valor, y " +
        "publicar el intervalo junto al contraste.",
      porque: "Con " + nf(R.logit.n) + " observaciones, el logit da p " + pval(R.logit.p) +
        " para un odds ratio de " +
        nf(R.logit.or, 4) + " por día —<b>" + nf(R.logit.or7, 3) + "× a siete días</b>— y el contraste " +
        "de membresía da z = " + nf(R.member.z, 1) + ". La propia página ya avisa de que con decenas " +
        "de miles de observaciones casi todo sale significativo; el problema es que el umbral de p " +
        "sigue siendo lo que se mira.",
      impacto: "Evita aprobar una acción porque «es significativa» cuando el efecto es de " +
        nf(R.logit.or7, 3) + "× a siete días. Es la diferencia entre la recomendación de confirmación " +
        "escalonada —" + y(R.lead.savedYear) + ", correctamente dimensionada por su efecto— y la misma " +
        "acción vendida como «driver estadísticamente significativo de la cancelación», que es como " +
        "se financian proyectos que no mueven nada.",
      quien: "Datos",
      esfuerzo: "bajo",
      mide: "% de decisiones aprobadas cuyo efecto estimado supera el mínimo acordado <b>antes</b> de " +
        "ver el resultado. Hoy no se acuerda ningún mínimo, así que la métrica no puede existir.",
      euros: null,
      eurosLabel: "evita decidir por el p-valor",
    },

    /* ---- 22 · el turno se dimensiona por semana, la demanda no ------------ */
    {
      prio: 22, page: "demanda", tipo: "negocio",
      accion: "Dimensionar el turno de tienda por día de la semana, con refuerzo de sábado y domingo, " +
        "en vez de por plantilla semanal constante.",
      porque: "Sábado y domingo concentran el <b>" + pct(R.dow.share, 1) + "</b> de los alquileres " +
        "con dos de siete días, y su ticket medio (" + eur(R.dow.weTicket, 2) + ") supera en un <b>" +
        pct(R.dow.weTicket / R.dow.wdTicket - 1, 1) + "</b> al de entre semana (" +
        eur(R.dow.wdTicket, 2) + ").",
      impacto: "<b>" + y(R.dow.revYear) + "</b> —el " + pct(R.dow.revShare, 1) + " del ingreso— entra " +
        "en el " + pct(2 / 7, 0) + " de los días. El ahorro no se puede calcular sin el coste por " +
        "turno, que no está en ningún sitio de este dato; lo que sí fija es el orden de magnitud sobre " +
        "el que negociarlo, y el hecho de que la plantilla plana está mal dimensionada en los dos " +
        "sentidos a la vez.",
      quien: "Operaciones",
      esfuerzo: "bajo",
      mide: "Alquileres por hora-persona, por día de la semana. Hoy se mira la productividad semanal " +
        "de la tienda, que promedia el sábado con el martes.",
      euros: null,
      eurosLabel: "no cuantificable sin el coste de turno",
    },
  ];
}

/* --------------------------------------------------------------------------
   3 · Render
   -------------------------------------------------------------------------- */
const ESFUERZO_ORDER = { bajo: 0, medio: 1, alto: 2 };

function recos() {
  if (!RECO_LIST) RECO_LIST = buildRecos().sort((a, b) => a.prio - b.prio);
  return RECO_LIST;
}

/* Cabecera del bloque. La incertidumbre se declara AQUI y una sola vez: luego
   ninguna linea dice "podria" ni "estimado", porque repetirlo en cada una lo
   convierte en ruido y acaba leyendose como que nada de esto es serio. */
const RECO_DISCLAIMER =
  "El impacto es una estimación con los datos del informe, no una promesa. Cada cifra sale del " +
  "análisis de esta página; cuando depende de un supuesto, el supuesto está escrito en la línea.";

function recoItem(r, n) {
  const el = document.createElement("article");
  el.className = "reco-item";
  const meta = [
    '<span class="who">' + r.quien + "</span>",
    '<span class="eff eff-' + r.esfuerzo + '">Esfuerzo ' + r.esfuerzo + "</span>",
    '<span class="kind">' + r.tipo + "</span>",
  ].join("");
  el.innerHTML =
    '<div class="reco-top"><span class="reco-n">' + n + '</span><h4>' + r.accion + "</h4></div>" +
    '<div class="reco-meta">' + meta + "</div>" +
    '<dl class="reco-fields">' +
      "<dt>Por qué</dt><dd>" + r.porque + "</dd>" +
      "<dt>Impacto</dt><dd>" + r.impacto + "</dd>" +
      "<dt>Se mide con</dt><dd>" + r.mide + "</dd>" +
    "</dl>" +
    (r.nota ? '<p class="reco-note">' + r.nota + "</p>" : "");
  return el;
}

/* Bloque de una pagina. Va al final del grid, a ancho completo: es la
   conclusion, no una tarjeta mas de la retahila. */
function recoBlock(grid, pageId, contexto) {
  const mine = recos().filter(r => r.page === pageId);
  if (!mine.length && !contexto) return;
  const el = card("c12 reco-card", "Qué hacer con esto",
    mine.length === 1 ? "Una recomendación de esta página."
                      : nf(mine.length) + " recomendaciones de esta página, ordenadas por retorno " +
                        "frente a esfuerzo.", "histórico completo");
  el._chart.remove();
  el.querySelector(".tbtn").remove();
  el._table.remove();
  grid.appendChild(el);
  const note0 = document.createElement("p");
  note0.className = "reco-disclaimer";
  note0.textContent = RECO_DISCLAIMER;
  el.appendChild(note0);
  const list = document.createElement("div");
  list.className = "reco";
  mine.forEach((r, i) => list.appendChild(recoItem(r, i + 1)));
  el.appendChild(list);
  /* Un hallazgo que no lleva a ninguna accion se queda como contexto, dicho con
     todas las letras. Forzar una recomendacion de relleno para que la pagina no
     quede corta es exactamente lo que hace inutil un informe. */
  if (contexto) {
    const c = document.createElement("div");
    c.className = "reco-ctx";
    c.innerHTML = "<b>Sin recomendación, a propósito.</b> " + contexto;
    el.appendChild(c);
  }
}

/* El canal es el caso de libro de hallazgo SIN accion, y merece decirse con sus
   cifras en vez de callarlo: los cuatro canales son indistinguibles en las tres
   variables que el informe mide sobre ellos. Forzar aqui una recomendacion de
   canal seria inventarse un hallazgo. */
function recoCtxCanal() {
  const R = recoFacts();
  const c = R.channel;
  return "Los <b>" + nf(c.list.length) + " canales no se distinguen en nada de lo que este informe " +
    "mide</b>: cancelan entre el " + pct(c.cancel[0], 2) + " y el " + pct(c.cancel[1], 2) +
    ", reservan con " + nf(c.lead[0], 2) + " a " + nf(c.lead[1], 2) + " días de antelación y " +
    "facturan entre " + eur(c.ticket[0], 2) + " y " + eur(c.ticket[1], 2) + " de ticket. La " +
    "diferencia mayor entre el mejor y el peor canal es de " +
    nf((c.cancel[1] - c.cancel[0]) * 100, 2) + " puntos de cancelación. No hay ninguna acción de " +
    "canal que estos datos sostengan, y el mix (dónde entra la demanda) sigue siendo información " +
    "útil para dimensionar el soporte aunque no lleve a ninguna palanca.";
}

/* Portada: las cinco de mas retorno de TODO el informe, cada una enlazando a la
   pagina donde se desarrolla. Aqui no se repite el porque ni la metrica: esto es
   el indice de la decision, el desarrollo esta en su pagina. */
function recoTop(grid) {
  const top = recos().slice(0, 5);
  const el = card("c12 reco-card", "Las cinco de más retorno",
    "¿Por dónde empezar el lunes?", "histórico completo");
  el._chart.remove();
  el.querySelector(".tbtn").remove();
  el._table.remove();
  grid.appendChild(el);
  const note0 = document.createElement("p");
  note0.className = "reco-disclaimer";
  note0.textContent = RECO_DISCLAIMER;
  el.appendChild(note0);

  const list = document.createElement("ol");
  list.className = "reco-top5";
  top.forEach((r, i) => {
    const page = PAGES.find(p => p.id === r.page);
    const li = document.createElement("li");
    li.innerHTML =
      '<div class="t5-rank">' + (i + 1) + "</div>" +
      '<div class="t5-body"><div class="t5-do">' + r.accion + "</div>" +
        '<div class="t5-meta"><span>' + r.quien + "</span>" +
        '<span class="eff eff-' + r.esfuerzo + '">Esfuerzo ' + r.esfuerzo + "</span>" +
        '<span class="kind">' + r.tipo + "</span></div></div>" +
      '<div class="t5-val">' + (r.euros == null ? "—" : "<b>" + eur(r.euros, 0) + "</b>") +
        "<small>" + r.eurosLabel + "</small></div>";
    const go = document.createElement("button");
    go.type = "button";
    go.className = "t5-go";
    go.innerHTML = pageIcon(r.page, 13) + "<span>" + page.label + "</span>";
    go.addEventListener("click", () => goToPage(r.page));
    li.querySelector(".t5-body").appendChild(go);
    list.appendChild(li);
  });
  el.appendChild(list);

  const n = recos().length;
  const med = recos().filter(r => r.tipo === "medición").length;
  const top5med = top.filter(r => r.tipo === "medición").length;
  insight(el, "De las <b>" + nf(n) + " recomendaciones</b> del informe, " + nf(med) +
    " son sobre la propia medición, y <b>" + nf(top5med) + " de estas cinco</b> también. No es un " +
    "accidente del orden: son las que menos cuestan y las que más desbloquean, y son justo las que " +
    "no aparecen cuando se mira sólo el negocio. Las " + nf(n - 5) + " restantes están al final de " +
    "su página.");
}
