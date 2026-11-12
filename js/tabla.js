/* Tabla genérica (orden por columna, paginación, filas fijas, CSV) y columnas compartidas. */
window.VS = window.VS || {};
(function (VS) {
  'use strict';

  const esc = VS.esc;

  /** <td> de una columna numérica. Las variaciones se colorean por signo; el resto, solo los negativos. */
  VS.tdNum = function (c, g) {
    if (c.vacio && c.vacio(g)) return '<td class="num mut">—</td>';
    const txt = c.fmt(c.v(g), g), p = txt.charAt(0);
    let cls = 'num';
    if (c.delta) cls += p === '-' ? ' baja' : (p === '+' || p === '>' ? ' sube' : ' mut');
    else cls += VS.clsNeg(txt);
    return '<td class="' + cls + '">' + txt + '</td>';
  };

  /**
   * Columnas numéricas por año para ítems con arreglos u[] (unidades) y m[] (montos):
   * unidades, montos y, si hay dos años visibles, variación del monto.
   */
  VS.colsAnios = function (M, av, op) {
    op = op || {};
    const c = [];
    if (!op.sinUnid) {
      av.forEach(a => {
        const i = M.idxAnio[a];
        c.push({ id: 'u' + a, t: 'Unid. ' + a, csv: 'Unidades ' + a, num: true, v: g => g.u[i], fmt: VS.unid, vacio: g => g.sinUnid === true });
      });
    }
    av.forEach(a => {
      const i = M.idxAnio[a];
      c.push({ id: 'm' + a, t: 'Monto ' + a, csv: 'Monto ' + a + ' (CLP)', num: true, v: g => g.m[i], fmt: VS.monto });
    });
    if (av.length >= 2) {
      const ant = av[av.length - 2], act = av[av.length - 1], i = M.idxAnio[ant], j = M.idxAnio[act];
      c.push({ id: 'var', t: 'Var. monto', num: true, delta: true, noCsv: true, tip: 'Monto ' + act + ' menos monto ' + ant,
               v: g => g.m[j] - g.m[i], fmt: x => VS.conSigno(x, VS.monto(x)) });
      c.push({ id: 'varp', t: 'Var. %', num: true, delta: true, noCsv: true, tip: 'Variación del monto respecto de ' + ant,
               v: g => VS.varPct(g.m[i], g.m[j]),
               fmt: (x, g) => (x === null ? (Math.round(g.m[i]) === 0 && g.m[j] > 0 ? 'nuevo' : '—') : VS.pctTxt(x)) });
    }
    return c;
  };

  /** Columnas de una tabla de SKU (grupos de VS.agruparPorSku). El SKU enlaza a su detalle. */
  VS.colsSku = function (M, av) {
    return [
      { id: 'sku', t: 'SKU', v: g => g.sku,
        html: g => (g.key === VS.GLOSA ? '<span class="tag">Aparte</span> ' : '') +
                   '<a href="#sku=' + encodeURIComponent(g.cod) + '">' + esc(g.sku) + '</a>' },
      { id: 'desc', t: 'Descripción', v: g => g.desc },
      { id: 'fam', t: 'Familia', v: g => g.fam },
      { id: 'lin', t: 'Línea', v: g => g.lin },
      { id: 'mar', t: 'Marca', v: g => g.mar },
    ].concat(VS.colsAnios(M, av));
  };

  /**
   * Crea una tabla sobre elementos ya existentes.
   * op: { tabla, conteo, pag, unidad: 'SKU', vacio: 'texto sin filas',
   *       id: ítem => texto, clsFila: ítem => clase, alClic: id => … }
   * Columnas: { id, t, v, num, fmt, delta, vacio, html, tip, csv, noCsv }
   */
  VS.tabla = function (op) {
    const el = op.tabla;
    const orden = { col: null, dir: -1 };
    let cols = [], items = [], fijas = [], pag = 1, porPag = 50;

    function ordenados() {
      const c = cols.find(x => x.id === orden.col);
      return c ? VS.ordenar(items, c.v, orden.dir) : items.slice();
    }

    function td(c, g) {
      if (c.num) return VS.tdNum(c, g);
      if (c.html) return '<td class="c-' + c.id + '">' + c.html(g) + '</td>';
      const v = c.v(g);
      return '<td class="c-' + c.id + '" title="' + esc(v) + '">' + esc(v) + '</td>';
    }

    function tr(g) {
      const cls = op.clsFila ? op.clsFila(g) : '';
      return '<tr data-id="' + esc(op.id(g)) + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + cols.map(c => td(c, g)).join('') + '</tr>';
    }

    function pintar() {
      let hh = '<tr>';
      cols.forEach(c => {
        const act = c.id === orden.col;
        hh += '<th class="' + (c.num ? 'num' : 'c-' + c.id) + '"' + (act ? ' aria-sort="' + (orden.dir > 0 ? 'ascending' : 'descending') + '"' : '') +
              (c.tip ? ' title="' + esc(c.tip) + '"' : '') + '><button type="button" data-col="' + c.id + '">' + esc(c.t) +
              '<span class="flecha">' + (act ? (orden.dir > 0 ? '▲' : '▼') : '') + '</span></button></th>';
      });
      el.tHead.innerHTML = hh + '</tr>';

      const lista = ordenados();
      const paginas = Math.max(1, Math.ceil(lista.length / porPag));
      if (pag > paginas) pag = paginas;
      const ini = (pag - 1) * porPag, vis = lista.slice(ini, ini + porPag);

      let h = fijas.map(tr).join('') + vis.map(tr).join('');
      if (!h) h = '<tr class="vacia"><td colspan="' + cols.length + '">' + (op.vacio || 'No hay ventas con los filtros actuales.') + '</td></tr>';
      el.tBodies[0].innerHTML = h;

      op.conteo.textContent = lista.length
        ? VS.num(lista.length, 0) + ' ' + op.unidad + ' · mostrando ' + VS.num(ini + 1, 0) + '–' + VS.num(ini + vis.length, 0)
        : '0 ' + op.unidad;
      const b = (rot, p, off, tit) => '<button type="button" data-pag="' + p + '"' + (off ? ' disabled' : '') + ' title="' + tit + '" aria-label="' + tit + '">' + rot + '</button>';
      op.pag.innerHTML =
        b('«', 1, pag === 1, 'Primera página') + b('‹', pag - 1, pag === 1, 'Página anterior') +
        '<span>Página ' + VS.num(pag, 0) + ' de ' + VS.num(paginas, 0) + '</span>' +
        b('›', pag + 1, pag === paginas, 'Página siguiente') + b('»', paginas, pag === paginas, 'Última página') +
        '<label>Filas <select class="por-pag">' + [25, 50, 100, 200].map(n => '<option' + (n === porPag ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>';
    }

    el.tHead.addEventListener('click', e => {
      const b = e.target.closest('button[data-col]');
      if (!b) return;
      const c = cols.find(x => x.id === b.dataset.col);
      if (orden.col === c.id) orden.dir = -orden.dir;
      else { orden.col = c.id; orden.dir = c.num ? -1 : 1; }
      pag = 1;
      pintar();
    });
    el.tBodies[0].addEventListener('click', e => {
      if (e.target.closest('a')) return;  // los enlaces navegan solos
      const fila = e.target.closest('tr[data-id]');
      if (fila && op.alClic && !String(window.getSelection())) op.alClic(fila.dataset.id);
    });
    op.pag.addEventListener('click', e => {
      const b = e.target.closest('button[data-pag]');
      if (!b) return;
      pag = Number(b.dataset.pag);
      pintar();
      const w = el.closest('.tabla-wrap');
      if (w) w.scrollTop = 0;
    });
    op.pag.addEventListener('change', e => {
      if (!e.target.classList.contains('por-pag')) return;
      porPag = Number(e.target.value); pag = 1;
      pintar();
    });

    return {
      /** Cambia columnas y datos. `fijas` van siempre arriba, fuera del orden y la paginación. */
      fijar: function (cols_, items_, fijas_, conservarPagina) {
        cols = cols_; items = items_; fijas = fijas_ || [];
        if (!cols.some(c => c.id === orden.col)) {
          const montos = cols.filter(c => /^m\d+$/.test(c.id));
          orden.col = montos.length ? montos[montos.length - 1].id : cols[0].id;
          orden.dir = montos.length ? -1 : 1;
        }
        if (!conservarPagina) pag = 1;
        pintar();
      },
      /** Exporta todo lo filtrado (no solo la página visible), en el orden que se ve. */
      csv: function (nombre) {
        const c = cols.filter(x => !x.noCsv).map(x => ({ t: x.csv || x.t, v: g => (x.vacio && x.vacio(g) ? null : x.v(g)) }));
        VS.descargarCsv(nombre, c, fijas.concat(ordenados()));
      },
    };
  };
})(window.VS);
