/* Vista 1: Explorador por SKU. */
window.VS = window.VS || {};
VS.explorador = (function (VS) {
  'use strict';

  const $ = id => document.getElementById(id);
  let M = null, tabla = null;

  function iniciar(modelo) {
    M = modelo;
    tabla = VS.tabla({
      tabla: $('tabla'), conteo: $('conteo'), pag: $('paginacion'), unidad: 'SKU',
      id: g => g.cod,
      clsFila: g => (g.key === VS.GLOSA ? 'fila-glosa' : ''),
      alClic: VS.detalle.ir,
    });
    $('btn-csv').addEventListener('click', () => tabla.csv('ventas_por_sku_' + (M.meta.corte || '') + '.csv'));
  }

  /** Repinta con las filas que pasan los filtros globales. La glosa sin detalle va fija arriba. */
  function render(filas, est, av, conservarPagina) {
    const mapa = VS.agruparPorSku(M, filas);
    const glosa = mapa.get(VS.GLOSA);
    mapa.delete(VS.GLOSA);
    tabla.fijar(VS.colsSku(M, av), Array.from(mapa.values()), glosa ? [glosa] : [], conservarPagina);
  }

  return { iniciar: iniciar, render: render };
})(window.VS);
