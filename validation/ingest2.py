#!/usr/bin/env python3
"""Download 2025 IRS 990 bundles, stream-parse grant records into SQLite, delete zip.

v2: decompresses via `unzip -p` (supports Deflate64 / method 9, which Python's
zipfile cannot read). v1 silently skipped every entry in Deflate64 bundles and
reported 0 grants. Every bundle now records docs_seen so a genuine zero is
distinguishable from a parse failure.
"""
import os, re, sqlite3, subprocess, time

BASE = "https://apps.irs.gov/pub/epostcard/990/xml/2025/2025_TEOS_XML_%s.zip"
PARTS = ["01A","02A","03A","04A","05A","05B","06A","07A","08A","09A","10A","11A","12A"]
HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "grants2.db")

RE_FILER   = re.compile(rb"<Filer>(.*?)</Filer>", re.S)
RE_EIN     = re.compile(rb"<EIN>(\d+)</EIN>")
RE_NAME    = re.compile(rb"<BusinessNameLine1Txt>(.*?)</BusinessNameLine1Txt>", re.S)
RE_TAXYR   = re.compile(rb"<TaxYr>(\d+)</TaxYr>")
RE_GRANT   = re.compile(rb"<GrantOrContributionPdDurYrGrp>(.*?)</GrantOrContributionPdDurYrGrp>", re.S)
RE_PERSON  = re.compile(rb"<PersonNm>(.*?)</PersonNm>", re.S)
RE_CITY    = re.compile(rb"<CityNm>(.*?)</CityNm>", re.S)
RE_STATE   = re.compile(rb"<StateAbbreviationCd>(.*?)</StateAbbreviationCd>", re.S)
RE_ZIP     = re.compile(rb"<ZIPCd>(.*?)</ZIPCd>", re.S)
RE_COUNTRY = re.compile(rb"<CountryCd>(.*?)</CountryCd>", re.S)
RE_STATUS  = re.compile(rb"<RecipientFoundationStatusTxt>(.*?)</RecipientFoundationStatusTxt>", re.S)
RE_PURPOSE = re.compile(rb"<GrantOrContributionPurposeTxt>(.*?)</GrantOrContributionPurposeTxt>", re.S)
RE_AMT     = re.compile(rb"<Amt>(\d+)</Amt>")


def t(m):
    return m.group(1).decode("utf-8", "ignore").strip() if m else None


def setup(db):
    db.executescript("""
    CREATE TABLE IF NOT EXISTS grants(
      funder_ein TEXT, funder_name TEXT, tax_yr INT,
      recipient TEXT, city TEXT, state TEXT, zip TEXT, country TEXT,
      status TEXT, purpose TEXT, amt INT, src TEXT);
    CREATE TABLE IF NOT EXISTS done(
      part TEXT PRIMARY KEY, docs INT, pf_filings INT, grants INT, secs INT);
    """)
    db.commit()


def handle_doc(d, part, rows):
    """Return number of grant records extracted from one XML document."""
    if b"GrantOrContributionPdDurYrGrp" not in d:
        return 0
    fb = RE_FILER.search(d)
    fein = t(RE_EIN.search(fb.group(1))) if fb else None
    fnam = t(RE_NAME.search(fb.group(1))) if fb else None
    yr = t(RE_TAXYR.search(d))
    n = 0
    for g in RE_GRANT.finditer(d):
        b = g.group(1)
        amt = t(RE_AMT.search(b))
        rows.append((fein, fnam, int(yr) if yr and yr.isdigit() else None,
                     t(RE_NAME.search(b)) or t(RE_PERSON.search(b)),
                     t(RE_CITY.search(b)), t(RE_STATE.search(b)),
                     t(RE_ZIP.search(b)), t(RE_COUNTRY.search(b)),
                     t(RE_STATUS.search(b)), t(RE_PURPOSE.search(b)),
                     int(amt) if amt else None, part))
        n += 1
    return n


def parse_bundle(path, db, part):
    p = subprocess.Popen(["unzip", "-p", path], stdout=subprocess.PIPE,
                         stderr=subprocess.DEVNULL, bufsize=1 << 20)
    buf, rows = b"", []
    docs = pf = grants = 0
    while True:
        chunk = p.stdout.read(1 << 20)
        if not chunk:
            break
        buf += chunk
        parts = buf.split(b"<?xml")
        if len(parts) > 1:
            buf = b"<?xml" + parts[-1]
            for d in parts[:-1]:
                if not d.strip():
                    continue
                docs += 1
                n = handle_doc(d, part, rows)
                if n:
                    pf += 1; grants += n
            if len(rows) >= 20000:
                db.executemany("INSERT INTO grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", rows)
                db.commit(); rows = []
    if buf.strip():
        docs += 1
        n = handle_doc(buf, part, rows)
        if n:
            pf += 1; grants += n
    p.wait()
    if rows:
        db.executemany("INSERT INTO grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    db.commit()
    return docs, pf, grants


def main():
    db = sqlite3.connect(DB)
    setup(db)
    have = {r[0] for r in db.execute("SELECT part FROM done")}
    for part in PARTS:
        if part in have:
            print(f"{part} already done", flush=True); continue
        zp = os.path.join(HERE, f"{part}.zip")
        t0 = time.time()
        r = subprocess.run(["curl", "-sS", "--max-time", "2400", "--retry", "12",
                            "--retry-delay", "4", "--retry-all-errors", "-o", zp, BASE % part],
                           stderr=subprocess.DEVNULL)
        if r.returncode != 0 or not os.path.exists(zp):
            print(f"{part} DOWNLOAD FAILED", flush=True); continue
        mb = os.path.getsize(zp) / 1e6
        try:
            docs, pf, g = parse_bundle(zp, db, part)
            secs = int(time.time() - t0)
            db.execute("INSERT OR REPLACE INTO done VALUES(?,?,?,?,?)", (part, docs, pf, g, secs))
            db.commit()
            flag = "  <-- ZERO GRANTS, INVESTIGATE" if g == 0 else ""
            print(f"{part}: {mb:>4.0f}MB  docs={docs:>6}  PF={pf:>5}  grants={g:>7}  ({secs}s){flag}",
                  flush=True)
        except Exception as e:
            print(f"{part} PARSE FAILED: {e}", flush=True)
        finally:
            if os.path.exists(zp):
                os.remove(zp)
    tot = db.execute("SELECT COUNT(*), COUNT(DISTINCT funder_ein) FROM grants").fetchone()
    print(f"TOTAL grants={tot[0]:,} funders={tot[1]:,}", flush=True)


if __name__ == "__main__":
    main()
