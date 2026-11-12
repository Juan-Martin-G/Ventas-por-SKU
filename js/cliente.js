/* Vista 2: Por cliente. Sin cliente elegido muestra la lista de clientes; con cliente, lo que compró. */
window.VS = window.VS || {};
VS.cliente = (function (VS) {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = VS.esc;

  let M = null, tLista = null, tSku = null;
  let terminos = [];              // búsqueda local por nombre de cliente
  let ult = null;                 // último render (para repintar al buscar)

  /** Un ítem por cliente: netos por año y cantidad de SKU distintos (la glosa no cuenta como SKU). */
  function agruparClientes(filas) {
    const mapa = new Map();
    for (const r of filas) {
      let c = mapa.get(r.c);
      if (!c) {
        c = { id: r.c, nombre: M.dic.cliente[r.c], u: M.anios.map(() => 0), m: M.anios.map(() => 0), skus: new Set() };
        c.x = VS.norm(c.nombre);
        mapa.set(r.c, c);
      }
      const i = M.idxAnio[r.a];
      c.u[i] += r.u; c.m[i] += r.m;
      if (!r.g) c.skus.add(r.key);
    }
    return Array.from(mapa.values());
  }

  function colsClientes(av) {
    return [
      { id: 'cli', t: 'Cliente', v: c => c.nombre, html: c => '<button type="button" class="enlace" title="' + esc(c.nombre) + '">' + esc(c.nombre) + '</button>' },
      { id: 'nsku', t: 'SKU distintos', num: true, v: c => c.skus.size, fmt: x => VS.num(x, 0) },
    ].concat(VS.colsAnios(M, av));
  }

  function pintarLista() {
    const items = terminos.length ? ult.clientes.filter(c => terminos.every(t => c.x.indexOf(t) !== -1)) : ult.clientes;
    tLista.fijar(colsClientes(ult.av), items, [], ult.conservar);
  }

  function pintarFicha() {
    const D = M.dic, est = ult.est, filas = ult.filas;
    $('cli-nombre').textContent = D.cliente[est.cliente];
    const mapa = VS.agruparPorSku(M, filas);
    const glosa = mapa.get(VS.GLOSA);
    mapa.delete(VS.GLOSA);

    const notas = [];
    if (glosa && glosa.m.some(x => Math.round(x) < 0)) {
      notas.push('<b>Glosa neta negativa:</b> corresponde a notas de crédito o NT sin referencia.');
    }
    if (filas.some(r => r.o === M.origenArriendo)) {
      notas.push('<b>Arriendos:</b> el monto se registra en el año de cada factura; las unidades, solo en el año en que partió el contrato.');
    }
    if (filas.some(r => r.m < 0)) notas.push('Valores netos por SKU: los negativos corresponden a notas de crédito.');
    $('cli-notas').hidden = !notas.length;
    $('cli-notas').innerHTML = notas.map(n => '<p>' + n + '</p>').join('');

    tSku.fijar(VS.colsSku(M, ult.av), Array.from(mapa.values()), glosa ? [glosa] : [], ult.conservar);
  }

  function iniciar(modelo) {
    M = modelo;
    tLista = VS.tabla({
      tabla: $('cli-tabla'), conteo: $('cli-conteo'), pag: $('cli-pag'), unidad: 'clientes',
      vacio: 'No hay clientes con los filtros actuales.',
      id: c => String(c.id),
      alClic: id => VS.fijarFiltros({ cliente: Number(id) }),
    });
    tSku = VS.tabla({
      tabla: $('cs-tabla'), conteo: $('cs-conteo'), pag: $('cs-pag'), unidad: 'SKU',
      vacio: 'Este cliente no tiene ventas con los filtros actuales.',
      id: g => g.cod,
      clsFila: g => (g.key === VS.GLOSA ? 'fila-glosa' : ''),
      alClic: VS.detalle.ir,
    });

    let espera = null;
    $('cli-q').addEventListener('input', e => {
      clearTimeout(espera);
      const v = e.target.value;
      espera = setTimeout(() => {
        terminos = VS.norm(v).split(/\s+/).filter(Boolean);
        ult.conservar = false;
        pintarLista();
      }, 140);
    });
    $('cli-volver').addEventListener('click', () => VS.fijarFiltros({ cliente: null }));
    $('cli-csv').addEventListener('click', () => tLista.csv('ventas_por_cliente_' + (M.meta.corte || '') + '.csv'));
    $('cs-csv').addEventListener('click', () => {
      const nom = M.dic.cliente[ult.est.cliente].replace(/[^\p{L}\p{N}.-]+/gu, '_').slice(0, 40);
      tSku.csv('compras_' + nom + '_' + (M.meta.corte || '') + '.csv');
    });
  }

  function render(filas, est, av, conservarPagina) {
    ult = { filas: filas, est: est, av: av, conservar: conservarPagina, clientes: null };
    const elegido = est.cliente !== null;
    $('cli-lista').hidden = elegido;
    $('cli-ficha').hidden = !elegido;
    if (elegido) pintarFicha();
    else { ult.clientes = agruparClientes(filas); pintarLista(); }
  }

  return { iniciar: iniciar, render: render };
})(window.VS);
