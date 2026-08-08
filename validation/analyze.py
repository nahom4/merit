#!/usr/bin/env python3
"""Coverage validation: for 3 real small nonprofits, how many credible, material
funders does the 990 giving graph surface via peer organisations?"""
import html, re, sqlite3, statistics as st

DB = "grants2.db"

ORGS = [
    dict(name="Cape Fear Literacy Council", ein="581613254", city="Wilmington", state="NC",
         rev=655_738, label="adult literacy",
         peer=r"\bLITERACY\b|\bREAD(ING)?\s+(COUNCIL|FOUNDATION|PROGRAM)|ADULT\s+EDUCATION|\bESL\b"),
    dict(name="Boys & Girls Club of Cabarrus County", ein="560577630", city="Concord", state="NC",
         rev=4_536_790, label="youth development",
         peer=r"BOYS\s*(&|AND)\s*GIRLS\s*CLUB|\bYOUTH\b.*\b(CENTER|SERVICES|DEVELOPMENT|PROGRAM|FOUNDATION)"
              r"|AFTER\s*SCHOOL|\bMENTOR|\bYMCA\b|YOUNG\s+MENS\s+CHRISTIAN"),
    dict(name="Lake County Free Clinic", ein="341081191", city="Painesville", state="OH",
         rev=1_200_000, label="free / community clinic",
         peer=r"FREE\s+(CLINIC|HEALTH|MEDICAL)|COMMUNITY\s+(HEALTH|MEDICAL|CLINIC)"
              r"|\bCLINIC\b|CHARITABLE\s+PHARMACY|HEALTH\s+CENTER|\bFEDERALLY\s+QUALIFIED"),
]

ADJ = {"NC": {"NC", "SC", "VA", "TN", "GA"}, "OH": {"OH", "PA", "WV", "KY", "IN", "MI"}}


def m(x):
    return f"${x:,.0f}"


def clean(s):
    return html.unescape(s or "").strip()


def run(db, o, rows):
    rx = re.compile(o["peer"], re.I)
    own = o["name"].upper()

    peers = [r for r in rows if rx.search(r[2] or "")]
    peers = [r for r in peers if clean(r[2]).upper() != own]

    near = ADJ.get(o["state"], {o["state"]})
    instate = [r for r in peers if (r[3] or "") == o["state"]]
    regional = [r for r in peers if (r[3] or "") in near]

    funders = {}
    for fein, fname, rcpt, stt, amt, purp, yr in peers:
        f = funders.setdefault(fein, dict(name=clean(fname), grants=[], peers=set(), states=set()))
        f["grants"].append(amt); f["peers"].add(clean(rcpt)); f["states"].add(stt)

    # material = a typical grant is worth pursuing for an org this size
    floor = max(2_500, 0.005 * o["rev"])
    credible = {}
    for fein, f in funders.items():
        med = st.median(f["grants"])
        if med < floor or med > 500_000:
            continue
        if len(f["peers"]) >= 2 or (f["states"] & near):
            credible[fein] = dict(f, med=med)

    ranked = sorted(credible.items(), key=lambda kv: (len(kv[1]["peers"]), kv[1]["med"]), reverse=True)
    reg = [(k, v) for k, v in ranked if v["states"] & near]

    print(f"\n{'='*78}\n{o['name']}  ({o['city']}, {o['state']} | revenue {m(o['rev'])})"
          f"\n  category: {o['label']}   materiality floor: {m(floor)}\n{'='*78}")
    print(f"  peer grant records matched   : {len(peers):,}   (in-state {len(instate):,} / in-region {len(regional):,})")
    print(f"  distinct funders of peers    : {len(funders):,}")
    print(f"  CREDIBLE + MATERIAL funders  : {len(credible):,}")
    print(f"    of which fund in-region    : {len(reg):,}")

    print(f"\n  Top prospects (regional first):")
    for fein, f in (reg + [x for x in ranked if x not in reg])[:12]:
        tag = "REGION" if f["states"] & near else "  nat "
        print(f"    [{tag}] {f['name'][:40]:40} | {len(f['peers']):>2} peers | median {m(f['med']):>9}")
    if not ranked:
        print("    (none)")
    return len(credible), len(reg)


def main():
    db = sqlite3.connect(DB)
    tot = db.execute("SELECT COUNT(*), COUNT(DISTINCT funder_ein) FROM grants").fetchone()
    parts = [r[0] for r in db.execute("SELECT part FROM done ORDER BY part")]
    yrs = db.execute("SELECT tax_yr, COUNT(*) FROM grants WHERE tax_yr IS NOT NULL "
                     "GROUP BY tax_yr ORDER BY 2 DESC LIMIT 5").fetchall()
    print(f"CORPUS: {tot[0]:,} grant records | {tot[1]:,} distinct funders "
          f"| {len(parts)}/13 bundles {parts}")
    print(f"  tax years present: {yrs}")

    rows = db.execute("""SELECT funder_ein, funder_name, recipient, state, amt, purpose, tax_yr
                         FROM grants WHERE recipient IS NOT NULL AND amt IS NOT NULL""").fetchall()
    res = [run(db, o, rows) for o in ORGS]
    print(f"\n{'='*78}\nSUMMARY   credible+material / of which regional")
    for o, (c, r) in zip(ORGS, res):
        print(f"  {o['name'][:46]:46} {c:>5} / {r}")


if __name__ == "__main__":
    main()
