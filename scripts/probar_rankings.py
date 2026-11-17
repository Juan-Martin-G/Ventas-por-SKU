#!/usr/bin/env python
"""Prueba de js/rankings.js: sus top 5 / top 10 deben coincidir AL PESO con los Excel de las láminas.

Uso:  python scripts/probar_rankings.py [--detalle]
Compara, para las 8 líneas y 2025 / 2026:
  - SKU y clientes contra presentaciones/Top_por_linea_v2.xlsx (hojas «Top10 SKU AAAA», «Top10 Clientes AAAA»)
  - familias contra presentaciones/Top_por_linea_v3.xlsx (hojas «Top10 Familias AAAA»)
  - concentración top 5 / top 10 contra «Totales línea» (v2 para SKU y clientes; v3 para familias)
Revisa nombre y orden del ranking, monto (al peso), unidades, %, N° SKU y SKU principal.
Muestra en detalle el top 5 de E. Esterilización y MMQ. Termina con código 1 si algo no coincide.
Los Excel están en presentaciones/ (no se publican); deben ser de la misma exportación que data/ventas.json.
"""
import json
import subprocess
import sys
from pathlib import Path

import openpyxl

BASE = Path(__file__).resolve().parent.parent
V2 = BASE / "presentaciones" / "Top_por_linea_v2.xlsx"
V3 = BASE / "presentaciones" / "Top_por_linea_v3.xlsx"
ANIOS = (2025, 2026)
DETALLE = ("E. Esterilización", "MMQ")


def leer_excel():
    esp = {}          # (dim, línea, año) -> lista de dicts del top 10
    conc = {}         # (dim, línea, año, n) -> %
    w2 = openpyxl.load_workbook(V2, data_only=True, read_only=True)
    w3 = openpyxl.load_workbook(V3, data_only=True, read_only=True)
    for a in ANIOS:
        # Línea, Ranking, SKU, Descripción, Familia, Marca, Unidades, Monto, % productos, % línea
        for r in w2[f"Top10 SKU {a}"].iter_rows(min_row=2, values_only=True):
            if r[0]:
                esp.setdefault(("sku", r[0], a), []).append({"rank": r[1], "nombre": str(r[2]), "u": r[6], "m": r[7], "pct": r[8]})
        # Línea, Ranking, Cliente, N° SKU, Monto, % línea, SKU principal
        for r in w2[f"Top10 Clientes {a}"].iter_rows(min_row=2, values_only=True):
            if r[0]:
                esp.setdefault(("cliente", r[0], a), []).append({"rank": r[1], "nombre": r[2], "nsku": r[3], "m": r[4], "pct": r[5], "principal": r[6]})
        # Línea, Ranking, Familia, N° SKU con venta, Unidades, Monto, % Línea, SKU principal
        for r in w3[f"Top10 Familias {a}"].iter_rows(min_row=2, values_only=True):
            if r[0]:
                esp.setdefault(("familia", r[0], a), []).append({"rank": r[1], "nombre": r[2], "nsku": r[3], "u": r[4], "m": r[5], "pct": r[6], "principal": r[7]})
    for wb, dims in ((w2, (("sku", "SKU"), ("cliente", "Clientes"))), (w3, (("familia", "Familias"),))):
        tl = wb["Totales línea"]
        cab = [c.value for c in next(tl.iter_rows(min_row=1, max_row=1))]
        for r in tl.iter_rows(min_row=2, values_only=True):
            for dim, hoja in dims:
                for n in (5, 10):
                    for a in ANIOS:
                        col = f"% Top {n} {hoja} {a}"
                        if r[0] and col in cab:
                            conc[(dim, r[0], a, n)] = r[cab.index(col)]
    return esp, conc


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    js = json.loads(subprocess.run(["node", str(BASE / "scripts" / "rankings_cli.js")], capture_output=True,
                                   text=True, encoding="utf-8", check=True).stdout)
    esp, conc = leer_excel()
    errores, n = [], 0

    def chk(ok, msg):
        nonlocal n
        n += 1
        if not ok:
            errores.append(msg)

    for linea, dims in js["lineas"].items():
        for dim in ("sku", "familia", "cliente"):
            for a in ANIOS:
                got = dims[dim][str(a)]
                exp = esp.get((dim, linea, a), [])
                tag = f"{dim} {linea} {a}"
                chk(len(got["lista"]) == len(exp), f"{tag}: {len(got['lista'])} ítems vs {len(exp)} en el Excel")
                for g, e in zip(got["lista"], exp):
                    t = f"{tag} #{e['rank']}"
                    chk(g["rank"] == e["rank"] and str(g["nombre"]) == str(e["nombre"]), f"{t}: «{g['nombre']}» vs «{e['nombre']}»")
                    chk(round(g["m"]) == round(e["m"]), f"{t}: monto {g['m']:.2f} vs {e['m']:.2f}")
                    chk(abs(g["pct"] - e["pct"]) < 1e-9, f"{t}: % {g['pct']} vs {e['pct']}")
                    if "u" in e:
                        chk(abs(g["u"] - e["u"]) < 1e-9, f"{t}: unidades {g['u']} vs {e['u']}")
                    if "nsku" in e:
                        chk(g["nsku"] == e["nsku"], f"{t}: N° SKU {g['nsku']} vs {e['nsku']}")
                    if "principal" in e:
                        chk(g["principal"] == e["principal"], f"{t}: principal {g['principal']} vs {e['principal']}")
                for k in (5, 10):
                    ce = conc.get((dim, linea, a, k))
                    chk(ce is not None and abs(got[f"top{k}"] - ce) < 1e-9, f"{tag}: % top {k} {got[f'top{k}']} vs {ce}")

    m = lambda v: f"{v:,.0f}".replace(",", ".")
    print("PRUEBA js/rankings.js contra Top_por_linea_v2.xlsx (SKU, clientes) y v3.xlsx (familias)")
    print(f"Datos: ventas.json generado {js['meta']['generado']}, corte {js['meta']['corte']}")
    print(f"Comparaciones: {n}  |  diferencias: {len(errores)}")
    for e in errores[:30]:
        print("  ✗", e)
    print()
    for linea in DETALLE:
        for dim, nom in (("sku", "SKU"), ("familia", "Familias"), ("cliente", "Clientes")):
            for a in ANIOS:
                got = js["lineas"][linea][dim][str(a)]["lista"][:5]
                exp = esp[(dim, linea, a)][:5]
                print(f"{linea} · Top 5 {nom} {a}")
                for g, e in zip(got, exp):
                    igual = str(g["nombre"]) == str(e["nombre"]) and round(g["m"]) == round(e["m"])
                    print(f"  {g['rank']}. {str(g['nombre'])[:44]:<44} panel {m(g['m']):>14}  Excel {m(e['m']):>14}  "
                          f"{g['pct'] * 100:5.1f}%  {'OK' if igual else 'DISTINTO'}")
    print("\nRESULTADO:", "OK — todo coincide" if not errores else f"{len(errores)} diferencias")
    sys.exit(1 if errores else 0)


if __name__ == "__main__":
    main()
