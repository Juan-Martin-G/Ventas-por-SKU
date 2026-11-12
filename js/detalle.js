/* Detalle de un SKU (panel lateral). Se abre desde cualquier vista con el enlace #sku=CÓDIGO. */
window.VS = window.VS || {};
VS.detalle = (function (VS) {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = VS.esc;

  let M = null;
  let filas = [];      // filas que pasan los filtros globales
  let av = [];         // años visibles
  let cod = null;      // código del SKU abierto (null = cerrado)
  let clientes = [];
  let sinUnid = false;
  const ordCli = { col: 'total', dir: -1 };

  const ceros = () => M.anios.map(() => 0);

  /** Tabla chica de desglose (sin paginar). Con op.ordenable, los encabezados ordenan. */
  function tablaDesglose(items, titulo, op) {
    op = op || {};
    const idx = av.map(a => M.idxAnio[a]);
    const th = (id, t, num) => {
      if (!op.ordenable) return '<th' + (num ? ' class="num"' : '') + '>' + t + '</th>';
      const act = ordCli.col === id;
      return '<th' + (num ? ' class="num"' : '') + (act ? ' aria-sort="' + (ordCli.dir > 0 ? 'ascending' : 'descending') + '"' : '') +
             '><button type="button" data-ocol="' + id + '">' + t + '<span class="flecha">' + (act ? (ordCli.dir > 0 ? '▲' : '▼') : '') + '</span></button></th>';
    };
    let h = '<div class="tabla-wrap chica"><table class="t-det"><thead><tr>' + th('nombre', titulo, false);
    if (!op.sinUnid) av.forEach(a => { h += th('u' + a, 'Unid. ' + a, true); });
    av.forEach(a => { h += th('m' + a, 'Monto ' + a, true); });
    h += '</tr></thead><tbody>';
    const num = (x, fmt) => { const t = fmt(x); return '<td class="num' + VS.clsNeg(t) + '">' + t + '</td>'; };
    const fila = (it, cls) => {
      let f = '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td class="c-nom" title="' + esc(it.nombre) + '">' + esc(it.nombre) + '</td>';
      if (!op.sinUnid) idx.forEach(i => { f += num(it.u[i], VS.unid); });
      idx.forEach(i => { f += num(it.m[i], VS.monto); });
      return f + '</tr>';
    };
    items.forEach(it => { h += fila(it); });
    if (!items.length) h += '<tr class="vacia"><td colspan="9">Sin ventas con los filtros actuales.</td></tr>';
    if (op.total && items.length > 1) {
      const t = { nombre: 'Total', u: ceros(), m: ceros() };
      items.forEach(it => idx.forEach(i => { t.u[i] += it.u[i]; t.m[i] += it.m[i]; }));
      h += fila(t, 'total');
    }
    return h + '</tbody></table></div>';
  }

  function clientesOrdenados() {
    const col = ordCli.col;
    let fn;
    if (col === 'nombre') fn = it => it.nombre;
    else if (col === 'total') fn = it => av.reduce((s, a) => s + it.m[M.idxAnio[a]], 0);
    else { const i = M.idxAnio[Number(col.slice(1))], k = col.charAt(0); fn = it => it[k][i]; }
    return VS.ordenar(clientes, fn, ordCli.dir);
  }

  function pintarClientes() {
    $('det-clientes').innerHTML = tablaDesglose(clientesOrdenados(), 'Cliente', { ordenable: true, sinUnid: sinUnid, total: true });
  }

  function pintar() {
    if (cod === null) return;
    const D = M.dic;
    const especial = cod === VS.GLOSA || cod === VS.SIN_SKU;
    const key = especial ? cod : M.skuIdx.get(cod);
    const base = key === undefined ? null : M.filas.find(r => r.key === key);
    const cab = t => '<header class="det-cab"><div>' + t + '</div><button type="button" id="det-cerrar" aria-label="Cerrar detalle">×</button></header>';
    const cont = $('detalle');
    if (!base) {
      cont.innerHTML = cab('<h2>SKU no encontrado</h2>') + '<div class="det-cuerpo"><p class="nota">No hay ventas registradas para “' + esc(cod) + '”.</p></div>';
      return;
    }
    const propias = filas.filter(r => r.key === key);
    const g = VS.agruparPorSku(M, propias.length ? propias : [base]).get(key);
    const esGlosa = key === VS.GLOSA;
    sinUnid = esGlosa;

    let h = cab('<div class="det-cod">' + (esGlosa ? 'Se muestra aparte · sin unidades' : 'SKU') + '</div><h2>' + esc(g.sku) + '</h2>' +
                '<p class="det-desc">' + esc(g.desc) + '</p>');
    h += '<div class="det-cuerpo">';

    if (!esGlosa) {
      const tipos = Array.from(new Set(propias.map(r => D.tipo[r.t])));
      const chips = [['Línea', g.lin], ['Familia', g.fam], ['Marca', g.mar]];
      if (tipos.length) chips.push(['Tipo', tipos.join(', ')]);
      h += '<div class="chips">' + chips.map(c => '<span><b>' + c[0] + '</b> ' + esc(c[1]) + '</span>').join('') + '</div>';
    }

    const tot = av.map(() => ({ m: new VS.Suma(), u: new VS.Suma() }));
    propias.forEach(r => { const t = tot[av.indexOf(r.a)]; t.m.mas(r.m); t.u.mas(r.u); });
    h += '<div class="det-kpis">';
    av.forEach((a, n) => {
      h += '<div class="kpi"><div class="kpi-rot">Monto ' + a + ' (' + VS.rotuloMonto() + ')</div><div class="kpi-val">' + VS.monto(tot[n].m.valor()) + '</div>' +
           (esGlosa ? '' : '<div class="kpi-sub">' + VS.unid(tot[n].u.valor()) + ' unidades</div>') + '</div>';
    });
    h += '</div>';

    clientes = VS.desglose(M, propias, 'c', D.cliente);
    const notas = [];
    const hayNeg = clientes.some(it => it.m.some(x => Math.round(x) < 0));
    if (esGlosa) {
      notas.push('Las glosas sin detalle tienen monto pero no unidades y no se reparten entre los SKU.');
      if (hayNeg) notas.push('<b>Glosa neta negativa:</b> los clientes con monto negativo corresponden a notas de crédito o NT sin referencia.');
    } else {
      if (propias.some(r => r.o === M.origenArriendo)) notas.push('<b>Arriendos:</b> el monto se registra en el año de cada factura; las unidades, solo en el año en que partió el contrato.');
      if (hayNeg || propias.some(r => r.m < 0)) notas.push('Valores netos: los negativos corresponden a notas de crédito.');
    }
    if (VS.hayFiltros && VS.hayFiltros()) notas.push('El detalle respeta los filtros activos del panel.');
    if (notas.length) h += '<div class="notas">' + notas.map(n => '<p>' + n + '</p>').join('') + '</div>';

    if (esGlosa) {
      h += '<h3>Por línea</h3>' + tablaDesglose(VS.ordenar(VS.desglose(M, propias, 'l', D.linea), it => it.nombre, 1), 'Línea', { sinUnid: true, total: true });
    } else {
      h += '<h3>Por origen</h3>' + tablaDesglose(VS.ordenar(VS.desglose(M, propias, 'o', D.origen), it => it.nombre, -1), 'Origen', { total: true });
    }

    h += '<div class="det-tit"><h3>Clientes (' + VS.num(clientes.length, 0) + ')</h3>' +
         '<button type="button" class="btn-sec" id="det-csv"' + (clientes.length ? '' : ' disabled') + '>Exportar CSV</button></div>' +
         '<div id="det-clientes"></div></div>';

    const sc = cont.querySelector('.det-cuerpo');
    const pos = sc ? sc.scrollTop : 0;
    cont.innerHTML = h;
    pintarClientes();
    cont.querySelector('.det-cuerpo').scrollTop = pos;
  }

  function abrir(codigo) {
    const nuevo = cod !== codigo;
    cod = codigo;
    if (nuevo) { ordCli.col = 'total'; ordCli.dir = -1; $('detalle').innerHTML = ''; }
    pintar();
    $('detalle').hidden = false;
    $('velo').hidden = false;
    document.body.classList.add('con-detalle');
    if (nuevo) { const x = $('det-cerrar'); if (x) x.focus(); }
  }

  function ocultar() {
    cod = null;
    $('detalle').hidden = true;
    $('velo').hidden = true;
    document.body.classList.remove('con-detalle');
  }

  /** Cierra quitando el #sku de la URL (sin saltar el scroll). */
  function cerrar() {
    if (/^#sku=/.test(location.hash)) history.pushState(null, '', location.pathname + location.search);
    ocultar();
  }

  function leerHash() {
    const m = /^#sku=(.*)$/.exec(location.hash);
    if (!m) { ocultar(); return; }
    let c;
    try { c = decodeURIComponent(m[1]); } catch (e) { c = m[1]; }
    abrir(c);
  }

  function exportarClientes() {
    const c = [{ t: 'Cliente', v: it => it.nombre }];
    if (!sinUnid) av.forEach(a => { const i = M.idxAnio[a]; c.push({ t: 'Unidades ' + a, v: it => it.u[i] }); });
    av.forEach(a => { const i = M.idxAnio[a]; c.push({ t: 'Monto ' + a + ' (CLP)', v: it => it.m[i] }); });
    const nom = cod === VS.GLOSA ? 'glosa_sin_detalle' : (cod === VS.SIN_SKU ? 'sin_sku' : cod.replace(/[^\p{L}\p{N}.-]+/gu, '_'));
    VS.descargarCsv('clientes_' + nom + '_' + (M.meta.corte || '') + '.csv', c, clientesOrdenados());
  }

  function iniciar(modelo) {
    M = modelo;
    $('detalle').addEventListener('click', e => {
      if (e.target.closest('#det-cerrar')) { cerrar(); return; }
      if (e.target.closest('#det-csv')) { exportarClientes(); return; }
      const b = e.target.closest('button[data-ocol]');
      if (b) {
        const id = b.dataset.ocol;
        if (ordCli.col === id) ordCli.dir = -ordCli.dir;
        else { ordCli.col = id; ordCli.dir = id === 'nombre' ? 1 : -1; }
        pintarClientes();
      }
    });
    $('velo').addEventListener('click', cerrar);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && cod !== null) cerrar(); });
    window.addEventListener('hashchange', leerHash);
  }

  return {
    iniciar: iniciar,
    leerHash: leerHash,
    /** Abre el detalle de un SKU (código, VS.GLOSA o VS.SIN_SKU). */
    ir: function (codigo) { location.hash = 'sku=' + encodeURIComponent(codigo); },
    /** Se llama cada vez que cambian los filtros; repinta si está abierto. */
    actualizar: function (filasFiltradas, aniosVisibles) { filas = filasFiltradas; av = aniosVisibles; pintar(); },
  };
})(window.VS);
