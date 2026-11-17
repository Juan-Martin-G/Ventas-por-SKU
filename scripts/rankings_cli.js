#!/usr/bin/env node
/*
 * Calcula con js/rankings.js (el mismo código del panel) los top 10 por línea y año de SKU, familias,
 * clientes y marcas, y la concentración top 5 / top 10, sobre data/ventas.json sin filtros.
 * Uso: node scripts/rankings_cli.js > salida.json   (lo usa scripts/probar_rankings.py)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '..');
globalThis.window = globalThis;            // util.js y datos.js cuelgan de window.VS
require(path.join(BASE, 'js', 'util.js'));
require(path.join(BASE, 'js', 'datos.js'));
const R = require(path.join(BASE, 'js', 'rankings.js'));

const json = JSON.parse(fs.readFileSync(path.join(BASE, 'data', 'ventas.json'), 'utf8'));
const M = window.VS.preparar(json);
const info = R.anotar(M);

const salida = { meta: { corte: M.meta.corte, generado: M.meta.generado }, lineas: {} };
for (const l of info.lineas) {
  const nombre = M.dic.linea[l];
  const out = salida.lineas[nombre] = {};
  for (const dim of ['sku', 'familia', 'cliente', 'marca']) {
    const res = R.calcular(M, M.filas, dim, [l]);
    out[dim] = {};
    for (const a of M.anios) {
      const d = res.anios[a];
      out[dim][a] = {
        den: d.den,
        top5: R.concentracion(res, a, 5),
        top10: R.concentracion(res, a, 10),
        lista: d.lista.slice(0, 10).map(it => ({
          rank: it.rank, nombre: it.nombre, m: it.m, u: it.u, pct: it.pct,
          nsku: it.nsku === undefined ? null : it.nsku, principal: it.principal === undefined ? null : it.principal,
        })),
      };
    }
  }
}
process.stdout.write(JSON.stringify(salida));
