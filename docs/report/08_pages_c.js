/* ===========================================================================
   Pagina 9: modelo y metodologia. Y el indice PAGES, que cierra el fichero.

   Es la unica pagina que no depende de los filtros: explica de donde sale el
   dato y por que esta modelado asi. Aun asi vive dentro del mismo ciclo de
   render que las demas para que la navegacion, los tokens y el tema sean los
   mismos; las pocas cifras que usa las lee de DATA, no las repite a mano.
   =========================================================================== */

/* Tarjeta de prosa: sin grafico ni conmutador grafico/tabla. Aqui el contenido
   es texto y tabla, no marcas, y un boton "Tabla" sobre una tarjeta que ya es
   una tabla seria ruido. */
function proseCard(cls, title, question, tag) {
  const el = card(cls, title, question, tag);
  el._chart.remove();
  const b = el.querySelector(".tbtn");
  if (b) b.remove();
  el._table.classList.remove("hidden");
  textTable(el);
  return el;
}

/* Marca la tabla de una tarjeta como tabla de TEXTO: alineada a la izquierda y
   con el contenido envolviendo. Las tablas de datos alinean a la derecha para
   comparar columnas de cifras; en una tabla de prosa esa misma regla empuja
   cada celda al borde derecho y obliga a desplazarse para leer las cortas. */
function textTable(el) {
  el._table.classList.add("txt");
  return el;
}
function prose(el, html) {
  const d = document.createElement("div");
  d.className = "prose";
  d.innerHTML = html;
  el._table.parentNode.insertBefore(d, el._table);
  return d;
}

function pageModelo(grid) {
  const Q = DATA.quality;
  const nCat = D.categories.length, nCountry = D.countries.length;

  /* -- 1. El recorrido del dato -------------------------------------------- */
  const c1 = card("c12", "Recorrido del dato",
    "¿Por dónde pasa un alquiler desde el CSV hasta esta pantalla?");
  grid.appendChild(c1);
  flowDiagram(c1._chart, {
    nodeH: 46, gapX: 30,
    columns: [
      { title: "0 · rental_raw", subtitle: "fuente inmutable · nunca se modifica", accent: true,
        nodes: [
          { label: "rentals_raw", sub: nf(Q.n_raw) + " filas · tabla de hechos",
            rows: [["Origen", "output/rentals.csv"], ["Filas", nf(Q.n_raw)],
                   ["Generado por", "generate_dataset.py (semilla 42)"]] },
          { label: "customers_raw", sub: "dimensión de clientes",
            rows: [["Origen", "output/customers.csv"], ["Grano", "1 fila = 1 cliente"]] },
          { label: "products_raw", sub: nf(P.id.length) + " referencias alquilables",
            rows: [["Origen", "output/products.csv"], ["Grano", "1 fila = 1 referencia"]] },
          { label: "stores_raw", sub: nf(S.id.length) + " tiendas · " + nf(nCountry) + " países",
            rows: [["Origen", "output/stores.csv"], ["Grano", "1 fila = 1 tienda"]] },
        ] },
      { title: "1 · staging", subtitle: "vistas · 1:1 con la fuente",
        nodes: [
          { label: "stg_rentals", sub: "try_cast, trim, initcap",
            rows: [["Materialización", "view"],
                   ["Qué hace", "casting tolerante, trim de claves, texto en Title case"],
                   ["Qué NO hace", "no corrige valores ni elimina filas"],
                   ["Tests", "unique + not_null en rental_id, accepted_values en canal y temporada"]] },
          { label: "stg_customers", sub: "país y género normalizados",
            rows: [["Materialización", "view"],
                   ["Tests", "unique en customer_id, accepted_values en membresía y segmento"]] },
          { label: "stg_products", sub: "categoría al catálogo canónico",
            rows: [["Materialización", "view"],
                   ["Qué hace", "mapea Biciletas / esqui / Snow Board / RUNNING al catálogo"],
                   ["Tests", "accepted_values sobre las " + nf(nCat) + " categorías"]] },
          { label: "stg_stores", sub: "ciudad y país normalizados",
            rows: [["Materialización", "view"], ["Tests", "unique en store_id, annual_visitors > 0"]] },
        ] },
      { title: "2 · intermediate", subtitle: "tablas · reglas de negocio",
        nodes: [
          { label: "int_rentals_deduplicated", sub: "una fila por rental_id", strong: true,
            rows: [["Caso A", "fila 100 % idéntica → DISTINCT (" + nf(Q.exact_dups) + " filas)"],
                   ["Caso B", "PK repetida con datos en conflicto → se conserva la más completa y, en empate, la más reciente"],
                   ["Salida", nf(Q.n_clean) + " filas"],
                   ["Test", "unique + not_null en rental_id"]] },
          { label: "int_rentals_cleaned", sub: "valores imposibles → NULL",
            rows: [["Criterio", "anular el valor, conservar la fila"],
                   ["Reglas", "review 1–5 · precio 0,01–2000 € · duración 1–30 d · coste ≥ 0 · devolución ≥ alquiler"],
                   ["Añade", "completed, has_invalid_return_date"]] },
          { label: "int_rentals_enriched", sub: "la tabla de hechos del informe", strong: true,
            rows: [["Qué es", "estrella desnormalizada: alquiler + producto + tienda + cliente"],
                   ["Métricas", "revenue, profit, margin"],
                   ["Join", "LEFT en las tres dimensiones"]] },
        ] },
      { title: "3 · marts", subtitle: "tablas · métricas listas para consumo",
        nodes: [
          { label: "mart_global_kpis", sub: "los KPI de cabecera",
            rows: [["Grano", "1 fila"], ["Consume", "int_rentals_enriched"]] },
          { label: "mart_monthly_revenue", sub: "serie mensual y crecimiento",
            rows: [["Grano", "1 fila por mes"]] },
          { label: "mart_product_metrics", sub: "ABC, rotación, ocupación",
            rows: [["Grano", "1 fila por producto"], ["Tests", "accepted_values en rotation_class y abc_class"]] },
          { label: "mart_store_metrics", sub: "ingreso por visitante, fricción",
            rows: [["Grano", "1 fila por tienda"]] },
          { label: "mart_customer_metrics", sub: "CLRV, recencia, segmento",
            rows: [["Grano", "1 fila por cliente"]] },
          { label: "+ 5 marts más", sub: "categoría, canal, pricing, cohortes, calidad",
            rows: [["mart_category_performance", "1 fila por categoría"],
                   ["mart_channel_performance", "1 fila por canal"],
                   ["mart_pricing_by_season", "1 fila por categoría × temporada"],
                   ["mart_cohort_retention", "1 fila por cohorte × offset"],
                   ["mart_data_quality", "1 fila por dimensión de calidad"]] },
        ] },
    ],
  });
  setTable(c1, ["Modelo", "Capa", "Materialización", "Qué hace"], [
    ["<code>rentals_raw</code>", "fuente", "tabla cargada",
     "Los CSV de <code>output/</code> tal cual. " + nf(Q.n_raw) + " filas, con sus problemas de calidad."],
    ["<code>customers_raw</code> · <code>products_raw</code> · <code>stores_raw</code>",
     "fuente", "tabla cargada", "Las tres dimensiones crudas, sin tocar."],
    ["<code>stg_rentals</code>", "staging", "view",
     "Casting tolerante con <code>try_cast</code>, <code>trim</code> de las claves, texto a Title case, flags a false."],
    ["<code>stg_customers</code> · <code>stg_products</code> · <code>stg_stores</code>",
     "staging", "view", "Lo mismo en las dimensiones, más el mapeo de categorías al catálogo canónico."],
    ["<code>int_rentals_deduplicated</code>", "intermediate", "table",
     "Una fila por <code>rental_id</code>: colapsa las idénticas y resuelve la colisión de PK por regla de negocio."],
    ["<code>int_rentals_cleaned</code>", "intermediate", "table",
     "Anula los valores imposibles conservando la fila, y añade <code>completed</code>."],
    ["<code>int_rentals_enriched</code>", "intermediate", "table",
     "La tabla de hechos: alquiler + producto + tienda + cliente, con <code>revenue</code>, <code>profit</code> y <code>margin</code>."],
    ["<code>mart_global_kpis</code>", "marts", "table", "Grano: 1 fila. Los KPI de cabecera."],
    ["<code>mart_monthly_revenue</code>", "marts", "table", "Grano: 1 fila por mes. Serie e incremento."],
    ["<code>mart_product_metrics</code>", "marts", "table", "Grano: 1 fila por producto. ABC, rotación, ocupación."],
    ["<code>mart_store_metrics</code>", "marts", "table", "Grano: 1 fila por tienda. Ingreso por visitante y fricción."],
    ["<code>mart_customer_metrics</code>", "marts", "table", "Grano: 1 fila por cliente. CLRV, recencia, segmento."],
    ["<code>mart_category_performance</code>", "marts", "table", "Grano: 1 fila por categoría."],
    ["<code>mart_channel_performance</code>", "marts", "table", "Grano: 1 fila por canal de reserva."],
    ["<code>mart_pricing_by_season</code>", "marts", "table", "Grano: 1 fila por categoría × temporada."],
    ["<code>mart_cohort_retention</code>", "marts", "table", "Grano: 1 fila por cohorte × mes de vida."],
    ["<code>mart_data_quality</code>", "marts", "table", "Grano: 1 fila por dimensión de calidad, más el índice global."],
  ]);
  textTable(c1);
  note(c1, "Arquitectura medallion de tres capas en dbt (proyecto sports_rental). Pasa el ratón " +
    "por cualquier modelo para ver qué hace, con qué grano y qué tests lo protegen. Las mismas " +
    "transformaciones existen dos veces más, con los mismos resultados: en el notebook de análisis " +
    "y en el generador de este informe.");
  insight(c1, "La capa <b>staging</b> no corrige nada a propósito: si limpiara, la medida de " +
    "calidad se haría sobre dato ya arreglado y daría 100 por construcción. Ensuciar y limpiar " +
    "en capas distintas es lo que permite <b>medir</b> lo que entra y <b>reclamarlo</b> al sistema origen.");

  /* -- 2. El modelo ------------------------------------------------------- */
  const c2 = card("c5", "Modelo de datos", "¿Cómo se relacionan las tablas?");
  grid.appendChild(c2);
  starDiagram(c2._chart, {
    height: 330,
    fact: { label: "int_rentals_enriched", sub: nf(DATA.meta.n_rows) + " filas · tabla de hechos",
            grain: "grano: 1 fila = 1 alquiler (rental_id)",
            rows: [["Clave primaria", "rental_id"],
                   ["Grano", "1 fila = 1 alquiler"],
                   ["Métricas aditivas", "revenue, maintenance_cost, profit"],
                   ["Métricas no aditivas", "margin, ticket medio, tasas (%)"],
                   ["Periodo", DATA.meta.first_date + " → " + DATA.meta.last_date]] },
    dims: [
      { label: "customers", sub: "cliente", key: "customer_id", card: "1 — N",
        rows: [["Atributos", "edad, género, país, membresía, segmento, signup_date"],
               ["Integridad", "ningún alquiler es anterior al alta de su cliente"]] },
      { label: "products", sub: nf(P.id.length) + " referencias", key: "product_id", card: "1 — N",
        rows: [["Atributos", "categoría, deporte, precio de compra, unidades, antigüedad"],
               ["Ojo", "inventory_units es global por referencia, no por tienda"]] },
      { label: "stores", sub: nf(S.id.length) + " tiendas", key: "store_id", card: "1 — N",
        rows: [["Atributos", "ciudad, país, formato, visitantes anuales"],
               ["Alquileres sin tienda", pct(A.country.n[0] / A.total.n[0], 1) +
                " de la selección · se conservan con LEFT JOIN"]] },
    ],
  });
  setTable(c2, ["Tabla", "Rol", "Clave", "Relación", "Qué aporta"], [
    ["<code>int_rentals_enriched</code>", "<b>hecho</b>", "<code>rental_id</code>",
     "—", "Un alquiler. Ingreso, coste de mantenimiento, duración, reseña y los tres flags de negocio."],
    ["<code>customers</code>", "dimensión", "<code>customer_id</code>", "1 — N",
     "Edad, género, país, ciudad, membresía, segmento y fecha de alta."],
    ["<code>products</code>", "dimensión", "<code>product_id</code>", "1 — N",
     "Categoría, deporte, precio de compra, coste de reposición, antigüedad y unidades en catálogo."],
    ["<code>stores</code>", "dimensión", "<code>store_id</code>", "1 — N",
     "Ciudad, país, formato y visitantes anuales. Cerca del 2 % de los alquileres llega sin ella."],
  ]);
  textTable(c2);
  note(c2, "Estrella, no copo de nieve: las tres dimensiones se consumen tal cual, sin tablas " +
    "puente ni jerarquías normalizadas.");

  /* -- 3. Qué hace cada capa ---------------------------------------------- */
  const c3 = proseCard("c7", "Qué ocurre en cada capa",
    "¿Qué transformación entra en cada sitio y por qué ahí?");
  grid.appendChild(c3);
  setTable(c3, ["Capa", "Materialización", "Qué se hace", "Qué NO se hace aquí"], [
    ["<b>rental_raw</b><br><span class='q'>fuente</span>", "tablas cargadas",
     "Nada. Los cuatro CSV se cargan tal cual y no se vuelven a tocar.",
     "Ninguna limpieza: es la referencia contra la que se mide la calidad."],
    ["<b>staging</b><br><span class='q'>stg_*</span>", "view",
     "Casting tolerante (<code>try_cast</code>), <code>trim</code> de las claves, texto a Title case, " +
     "flags booleanos con <code>coalesce</code> a false, categorías al catálogo canónico.",
     "No se corrigen valores de negocio ni se eliminan filas: sale el mismo número de filas que entra."],
    ["<b>intermediate</b><br><span class='q'>int_*</span>", "table",
     "Deduplicación por regla de negocio, anulación de valores imposibles, join de las tres " +
     "dimensiones y cálculo de <code>revenue</code>, <code>profit</code> y <code>margin</code>.",
     "No se agrega: sigue habiendo una fila por alquiler."],
    ["<b>marts</b><br><span class='q'>mart_*</span>", "table",
     "Agregación a los granos de consumo (mes, producto, tienda, cliente, categoría, canal, cohorte) " +
     "y clasificaciones ABC y de rotación.",
     "No se vuelve a limpiar: si un mart necesita limpiar algo, la regla está en la capa equivocada."],
  ]);
  prose(c3, "Cada regla vive <b>en una sola capa</b>, y la capa la elige quién necesita el " +
    "resultado. Una corrección de tipos la necesita todo el mundo, así que va en staging. Una " +
    "regla de negocio —qué es un precio imposible, qué alquiler genera ingreso— la necesitan " +
    "todos los marts pero no la fuente, así que va en intermediate. Un ranking ABC solo lo " +
    "necesita quien mira producto, así que vive en su mart.");

  /* -- 4. Decisiones de modelado ------------------------------------------ */
  const c4 = proseCard("c6", "Decisiones de modelado",
    "¿Por qué está modelado así y no de otra forma?");
  grid.appendChild(c4);
  setTable(c4, ["Decisión", "Por qué"], [
    ["<b>Esquema en estrella</b>, no copo de nieve",
     "Las dimensiones son pequeñas (" + nf(P.id.length) + " productos, " + nf(S.id.length) +
     " tiendas) y se consultan enteras. Normalizar categoría o ciudad a su propia tabla ahorraría " +
     "unos kilobytes y añadiría un join a cada consulta del informe."],
    ["<b>Grano del hecho: un alquiler</b>",
     "Es el grano atómico del negocio y el más bajo que existe en la fuente. Todo lo demás " +
     "—mes, categoría, cohorte— es una agregación de este grano; guardar preagregados en lugar " +
     "del detalle cerraría cortes que hoy se pueden hacer."],
    ["<b>rental_id como clave primaria</b>, con regla explícita ante colisión",
     "Una PK duplicada esconde dos problemas: el reintento del ETL (fila idéntica, se colapsa sin " +
     "pérdida) y la colisión de identificadores (datos en conflicto, se resuelve por regla y se " +
     "escala al sistema origen). Tratarlos igual perdería información real."],
    ["<b>LEFT JOIN en las tres dimensiones</b>",
     "Cerca del 2 % de los alquileres llega sin <code>store_id</code>. El ingreso es real aunque " +
     "no se sepa dónde se registró: con INNER JOIN desaparecería facturación de la cuenta."],
    ["<b>revenue solo en alquileres completados</b>",
     "Un alquiler cancelado no entrega material, luego aporta 0 €. Cuenta en la tasa de " +
     "cancelación, no en los ingresos. Si el precio viene nulo, el ingreso queda nulo y las " +
     "agregaciones lo ignoran, en lugar de contarlo como cero y hundir el ticket medio."],
    ["<b>Sin dimensiones lentamente cambiantes</b> (SCD)",
     "Las dimensiones son una foto a fecha de snapshot: <code>membership_level</code>, " +
     "<code>customer_segment</code> o <code>product_age</code> valen lo que valían el " +
     DATA.meta.last_date.slice(0, 4) + ", no lo que valían el día de cada alquiler. Es una " +
     "limitación consciente: medir el efecto de <i>subir</i> de nivel exigiría una SCD tipo 2 " +
     "sobre la dimensión de cliente, con validez temporal por fila."],
    ["<b>Métricas definidas una vez</b>",
     "Ticket medio, ocupación, margen y tasas se calculan en funciones reutilizables " +
     "(<code>build_*_metrics</code>, <code>global_kpis</code>) y se replican aquí y en los marts. " +
     "Es el germen de una capa semántica: cambiar la definición en un sitio la cambia en todos."],
  ]);

  /* -- 5. Datos sintéticos ------------------------------------------------- */
  const c5 = proseCard("c6", "Cómo se generaron los datos", "¿De dónde sale todo esto?");
  grid.appendChild(c5);
  prose(c5, "<b>Ningún dato es real.</b> Los cuatro CSV los produce " +
    "<code>generate_dataset.py</code> con una única semilla, de modo que dos ejecuciones dan " +
    "ficheros idénticos byte a byte. Las variables no son independientes: se derivan unas de " +
    "otras en el mismo orden en que ocurren en el negocio —fecha → temporada → categoría → " +
    "producto → tienda y cliente → duración, cancelación, devolución, avería, precio y reseña—, " +
    "que es lo que hace que un análisis sobre ellas tenga sentido.");
  setTable(c5, ["Supuesto", "Valor"], [
    ["Semilla", "<code>SEED = 42</code>, un solo <code>numpy.random.Generator</code> más " +
     "<code>random</code> y <code>Faker</code> sembrados"],
    ["Ventana temporal", DATA.meta.first_date + " → " + DATA.meta.last_date +
     " (" + nf(D.months.length) + " meses)"],
    ["Volumetría", "alquileres sorteados en <code>U(170.000, 190.001)</code> — " +
     nf(Q.n_raw) + " filas crudas, " + nf(Q.n_clean) + " tras deduplicar"],
    ["Catálogo", nf(P.id.length) + " referencias en " + nf(nCat) + " categorías deportivas, " +
     nf(S.id.length) + " tiendas en " + nf(nCountry) + " países"],
    ["Crecimiento anual", "factor por año: 0,80 · 1,00 · 1,20 · 1,38 · 1,52 (2022 → 2026)"],
    ["Estacionalidad", "pesos de demanda por categoría y estación, más festivos y Semana Santa; " +
     "esquí y snowboard en invierno, kayak y paddle surf en verano"],
    ["Precio", "precio base por categoría × factor de temporada × factor de país × duración, " +
     "con descuento por membresía y ruido"],
    ["Problemas inyectados", "~1 % de filas duplicadas, 0,5 % de devoluciones anteriores al " +
     "alquiler, 0,3 % de reseñas fuera de escala, 0,2 % de precios ×50 y duraciones de 999 días, " +
     "~2 % de nulos en cinco columnas, categorías mal escritas y texto sin normalizar"],
  ]);
  prose(c5, "Los problemas de calidad están puestos <b>a propósito</b> y no se corrigen en el " +
    "generador: son el material sobre el que trabajan la capa de limpieza y el índice de calidad. " +
    "Un dataset perfecto no permitiría demostrar ninguna de las dos cosas.");

  /* -- 6. Data Trust Score ------------------------------------------------- */
  const c6 = proseCard("c7", "Cómo se calcula el Data Trust Score",
    "¿Qué hay exactamente detrás del " + nf(Q.score, 1) + " / 100?", "histórico completo");
  grid.appendChild(c6);
  prose(c6, "Un único número entre 0 y 100, media ponderada de cuatro dimensiones medidas " +
    "<b>sobre las tablas crudas</b>. Se mide lo que entra, no lo que sale: calcularlo después de " +
    "limpiar daría 100 siempre y no informaría de nada.");
  setTable(c6, ["Dimensión", "Cómo se mide", "Peso", "Valor actual"],
    [["<b>Validez</b>", "1 − proporción de filas que violan alguna regla de negocio (reseña fuera " +
      "de 1–5, precio fuera de 0,01–2000 €, duración fuera de 1–30 días, coste negativo, " +
      "devolución anterior al alquiler)", "35 %", ""],
     ["<b>Completitud</b>", "1 − tasa media de nulos en las cinco columnas críticas: " +
      "<code>rental_price</code>, <code>store_id</code>, <code>booking_channel</code>, " +
      "<code>review_score</code>, <code>return_date</code>", "30 %", ""],
     ["<b>Unicidad</b>", "1 − proporción de filas exactamente duplicadas", "20 %", ""],
     ["<b>Consistencia</b>", "% de categorías de producto dentro del catálogo canónico de " +
      nf(nCat) + " valores", "15 %", ""]]
      .map(r => {
        const d = Q.dims.find(x => r[0].indexOf(x.dim) >= 0);
        r[3] = d ? "<b>" + nf(d.valor, 2) + " %</b>" : "—";
        return r;
      }));
  prose(c6, "Uso operativo: el índice es una sola cifra que se puede vigilar. Si baja de un " +
    "umbral —por ejemplo 95— la publicación de los marts se bloquea y salta el aviso al equipo " +
    "de datos, en lugar de dejar que un mart se publique con dato roto y se descubra tres " +
    "semanas después en un informe. En este pipeline eso vive en <code>mart_data_quality</code> " +
    "y en el paso de <i>quality gate</i> del job.");

  /* -- 7. Controles por capa ---------------------------------------------- */
  const c7 = proseCard("c5", "Controles de calidad", "¿Qué comprueba el pipeline y dónde?");
  grid.appendChild(c7);
  setTable(c7, ["Dónde", "Control"], [
    ["staging", "<code>unique</code> y <code>not_null</code> en las cuatro claves primarias; " +
     "<code>accepted_values</code> en categoría, temporada, canal, membresía y segmento; " +
     "<code>inventory_units</code> y <code>annual_visitors</code> positivos"],
    ["intermediate", "<code>unique</code> en <code>rental_id</code> tras deduplicar — es el test " +
     "que demuestra que la regla de colisión ha funcionado; <code>relationships</code> de las tres " +
     "claves foráneas contra sus dimensiones; reseña dentro de 1–5"],
    ["intermediate", "Test propio <code>assert_cleaned_rentals_business_rules</code>: ninguna fila " +
     "sobrevive con un valor imposible tras la capa de limpieza"],
    ["intermediate", "Test propio <code>assert_revenue_only_on_completed</code>: ningún alquiler " +
     "cancelado aporta ingreso"],
    ["intermediate → marts", "Test propio <code>assert_no_revenue_leakage_between_layers</code>: " +
     "los ingresos del hecho y los de los marts cuadran al céntimo"],
    ["marts", "<code>accepted_values</code> en las clasificaciones ABC y de rotación; " +
     "<code>unique</code> en el grano de cada mart"],
    ["informe", "<code>verify_report.py</code> contrasta las cifras de esta página contra pandas, " +
     "scipy y statsmodels; <code>test_render.js</code> renderiza las nueve páginas × cuatro " +
     "escenarios de filtro"],
  ]);
  insight(c7, "Los tests <b>fallan el pipeline</b> (severidad <i>error</i>) salvo los marcados " +
    "como aviso. Un test que solo avisa no es un control: es una nota que nadie lee.");

  recoBlock(grid, "modelo");
}

/* --------------------------------------------------------------------------
   Indice de paginas. El orden es el del menu lateral y `state.page` es
   el indice de este array. El campo `group` separa las paginas de negocio de
   las de metodo con una linea fina, sin gastar una etiqueta.
   -------------------------------------------------------------------------- */
const PAGES = [
  { id: "resumen", label: "Resumen ejecutivo", group: "negocio", render: pageResumen,
    intro: "Los siete indicadores del negocio con su evolución dentro, la comparación interanual y de dónde sale el dinero." },
  { id: "demanda", label: "Demanda y estacionalidad", group: "negocio", render: pageDemanda,
    intro: "Cuándo se alquila, cuánto dura y qué semanas se salen del patrón." },
  { id: "producto", label: "Producto e inventario", group: "negocio", render: pageProducto,
    intro: "Qué referencias sostienen el negocio, cuáles no rotan y cuándo toca renovar la flota." },
  { id: "tiendas", label: "Tiendas y geografía", group: "negocio", render: pageTiendas,
    intro: "Dónde se vende, qué tiendas convierten mejor su tráfico y dónde hay fricción operativa." },
  { id: "clientes", label: "Clientes y fidelización", group: "negocio", render: pageClientes,
    intro: "Quién sostiene los ingresos, qué aporta la membresía y si el cliente vuelve." },
  { id: "pricing", label: "Pricing y canal", group: "negocio", render: pagePricing,
    intro: "Cómo está construido el precio, dónde queda recorrido y por qué canal entra la demanda." },
  { id: "calidad", label: "Calidad del dato", group: "metodo", render: pageCalidad,
    intro: "Qué problemas trae el dato de origen y qué se decidió con cada uno antes de calcular nada." },
  { id: "estadistica", label: "Estadística", group: "metodo", render: pageEstadistica,
    intro: "De «se ve una relación» a cuantificarla: correlaciones, regresiones y contrastes sobre la selección." },
  { id: "modelo", label: "Modelo y metodología", group: "metodo", render: pageModelo,
    intro: "El recorrido del dato de capa en capa, las decisiones de modelado y cómo se generó y se mide todo esto." },
];
