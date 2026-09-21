import json, glob, os
from decimal import Decimal as D

DIR = r"C:\Users\Frane\Desktop\vs code workspaces\Optified\doc-ai-lib\prototypes\payslip-ocr\.agents\fixtures\expected"

def oib_ok(o):
    if not o or len(o) != 11 or not o.isdigit(): return None
    a = 10
    for ch in o[:10]:
        a = (a + int(ch)) % 10
        if a == 0: a = 10
        a = (a * 2) % 11
    return (11 - a) % 10 == int(o[10])

def d(v): return None if v is None else D(v)

files = sorted(glob.glob(os.path.join(DIR, "*.json")))
print(f"{len(files)} fixtures\n")
fails = 0
for f in files:
    p = json.load(open(f, encoding="utf-8"))
    s = p["sample"]; msgs = []
    unscorable = {u["field"] for u in p.get("unscorable", [])}

    def chk(name, lhs, rhs, tol=D("0.01")):
        global fails
        if lhs is None or rhs is None: return
        if abs(lhs - rhs) > tol:
            msgs.append(f"  FAIL {name}: {lhs} vs {rhs} (diff {lhs-rhs})"); fails += 1

    b, di, doh = d(p["brutoPlaca"]), d(p["doprinosiIzPlace"]), d(p["dohodak"])
    oo, po, pnd = d(p["osobniOdbitak"]), d(p["poreznaOsnovica"]), d(p["porezNaDohodak"])
    net, nep, obu = d(p["netoPlaca"]), d(p["neoporeziviPrimiciUkupno"]), d(p["obustaveUkupno"])
    isp, dnp, utr = d(p["iznosZaIsplatu"]), d(p["doprinosiNaPlacu"]), d(p["ukupanTrosakRada"])
    m1, m2 = d(p["doprinosMioIStup"]), d(p["doprinosMioIiStup"])

    chk("dohodak = bruto - doprinosiIzPlace", doh, (b - di) if b is not None and di is not None else None)
    chk("doprinosiIzPlace = MIO I + MIO II", di, (m1 + m2) if m1 is not None and m2 is not None else None)
    if po is not None and doh is not None and oo is not None:
        chk("poreznaOsnovica = max(0, dohodak - osobniOdbitak)", po, max(D(0), doh - oo))
    chk("netoPlaca = dohodak - porez", net, (doh - pnd) if doh is not None and pnd is not None else None)
    if isp is not None and net is not None and nep is not None:
        chk("iznosZaIsplatu = neto + neoporezivi - obustave", isp, net + nep - (obu or D(0)))
    if utr is not None and b is not None and dnp is not None and nep is not None:
        chk("ukupanTrosakRada = bruto + doprinosiNaPlacu + neoporezivi", utr, b + dnp + nep)

    if "payComponents" not in unscorable and p["payComponents"]:
        chk("sum(payComponents) = bruto", sum(d(r["iznos"]) for r in p["payComponents"] if r["iznos"]), b)
    if p["neoporeziviPrimici"]:
        chk("sum(neoporeziviPrimici) = total", sum(d(r["iznos"]) for r in p["neoporeziviPrimici"] if r["iznos"]), nep)
    if p["obustave"]:
        chk("sum(obustave) = total", sum(d(r["iznos"]) for r in p["obustave"] if r["iznos"]), obu)

    for k in ("employerOib", "employeeOib"):
        r = oib_ok(p[k])
        if r is False: msgs.append(f"  FAIL {k} checksum: {p[k]}"); fails += 1
    oibs = f"emp={'ok' if oib_ok(p['employerOib']) else ('-' if p['employerOib'] is None else 'BAD')}/rad={'ok' if oib_ok(p['employeeOib']) else ('-' if p['employeeOib'] is None else 'BAD')}"
    crit = [k for k in ("employerName","employeeName","employeeOib","period","brutoPlaca","netoPlaca","iznosZaIsplatu") if p[k] is None]
    print(f"{s}  OIB {oibs:22} critical-missing: {crit if crit else 'none'}")
    for m in msgs: print(m)
print(f"\n{'ALL IDENTITIES AND CHECKSUMS PASS' if fails==0 else str(fails)+' FAILURES'}")
