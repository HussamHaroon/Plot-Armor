#!/usr/bin/env python3
"""
report.py - aggregates security scan reports into one dashboard + policy gate.

Parses (tolerantly - missing/empty/malformed files count as zero findings
and get flagged as "report missing" instead of crashing):
  - semgrep-report.json    (semgrep --json output)
  - npm-audit.json         (npm audit --json output)
  - trivy-image.json       (trivy image --format json)
  - trivy-fs.json          (trivy fs --format json)
  - gitleaks-report.json   (gitleaks --report-format json), optional

Modes:
  default       -> writes dashboard.html next to the reports
  --gate        -> prints summary table, exit 1 if Critical+High > 0, else 0
  --reports-dir -> where the json reports live (default: .)

Python 3 stdlib only, no pip installs.
"""

import argparse
import glob
import html
import json
import os
import sys
from datetime import datetime, timezone

SEVERITY_ORDER = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1, "UNKNOWN": 0}

SEVERITY_COLORS = {
    "CRITICAL": "#e74c3c",
    "HIGH": "#e67e22",
    "MEDIUM": "#f1c40f",
    "LOW": "#2ecc71",
    "UNKNOWN": "#95a5a6",
}

# semgrep severity -> normalized severity
SEMGREP_MAP = {"ERROR": "HIGH", "WARNING": "MEDIUM", "INFO": "LOW"}


def norm_severity(raw):
    """Uppercase + clamp to a known severity bucket."""
    s = str(raw or "UNKNOWN").strip().upper()
    return s if s in SEVERITY_ORDER else "UNKNOWN"


def find_report(reports_dir, *names):
    """Locate a report file, accepting common name variations.

    Tries each candidate name (case-insensitive, -/_ interchangeable),
    then falls back to a prefix glob so 'npm_audit-report.json' etc. work.
    """
    def variants(n):
        return (n, n.replace("-", "_"), n.replace("_", "-"))

    wanted = []
    for n in names:
        wanted.extend(variants(n))
    wanted_lower = [w.lower() for w in wanted]

    try:
        entries = os.listdir(reports_dir)
    except OSError:
        return None

    for entry in entries:
        if entry.lower() in wanted_lower:
            return os.path.join(reports_dir, entry)

    # prefix-glob fallback: e.g. 'semgrep' matches 'semgrep-sast.json'
    prefixes = [names[0].split(".")[0].lower()]
    for entry in entries:
        stem = os.path.splitext(entry.lower())[0].replace("_", "-")
        if any(stem.startswith(p.replace("_", "-")) for p in prefixes) and entry.lower().endswith(".json"):
            return os.path.join(reports_dir, entry)
    return None


def find_gitleaks_report(reports_dir):
    """gitleaks-report.json if present; otherwise any SARIF file anywhere
    under reports_dir - the gitleaks-action@v2 artifact is named
    gitleaks-results.sarif but ships the file nested (work/.../results.sarif),
    and it is the only sarif producer in this pipeline."""
    path = find_report(reports_dir, "gitleaks-report.json")
    if path:
        return path
    for root, _dirs, files in os.walk(reports_dir):
        for entry in sorted(files):
            if entry.lower().endswith(".sarif"):
                return os.path.join(root, entry)
    return None


def load_json(path):
    """Return parsed JSON or None when missing/empty/malformed.

    Accepts both objects (semgrep/npm/trivy) and top-level arrays
    (gitleaks --report-format json emits a bare list).
    """
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def short_path(p, max_len=90):
    p = str(p or "?")
    return (p[: max_len - 3] + "...") if len(p) > max_len else p


# --------------------------------------------------------------------------
# parsers - each returns (list_of_findings, status_string)
# a finding dict: source, severity, title, location
# --------------------------------------------------------------------------

def parse_semgrep(data):
    findings = []
    if not isinstance(data, dict):
        return findings, "report missing"
    if not data.get("results"):
        return findings, "no findings"
    for res in data.get("results", []) or []:
        extra = res.get("extra") or {}
        sev = SEMGREP_MAP.get(str(extra.get("severity", "")).upper(), "MEDIUM")
        rule = res.get("check_id") or extra.get("message") or "semgrep finding"
        msg = (extra.get("message") or rule)[:160]
        path = res.get("path") or "?"
        start = (res.get("start") or {})
        line = start.get("line", "?")
        findings.append({
            "source": "semgrep",
            "severity": norm_severity(sev),
            "title": msg or rule,
            "location": "{}:{}".format(short_path(path), line),
        })
    return findings, "ok"


def parse_npm_audit(data):
    findings = []
    if not isinstance(data, dict):
        return findings, "report missing"
    vulns = data.get("vulnerabilities")
    if not vulns:
        # npm audit also has an 'error' key when the registry blew up
        if data.get("error"):
            return findings, "report error"
        return findings, "no findings"
    for name, info in vulns.items():
        info = info or {}
        sev = norm_severity(info.get("severity"))
        via = info.get("via") or []
        title = name
        for v in via:
            if isinstance(v, dict) and v.get("title"):
                title = "{}: {}".format(name, v["title"])
                break
        rng = (info.get("range") or "").strip()
        fix = "fix available" if info.get("fixAvailable") else "no fix"
        findings.append({
            "source": "npm-audit",
            "severity": sev,
            "title": "{} ({}) [{}]".format(title, rng or "range ?", fix),
            "location": "node_modules/{}".format(name),
        })
    return findings, "ok"


def parse_trivy(data, source_name):
    findings = []
    if not isinstance(data, dict):
        return findings, "report missing"
    results = data.get("Results")
    if not results:
        return findings, "no findings"
    for block in results:
        target = block.get("Target") or "?"
        for vuln in block.get("Vulnerabilities") or []:
            sev = norm_severity(vuln.get("Severity"))
            v_id = vuln.get("VulnerabilityID") or "CVE-?"
            pkg = vuln.get("PkgName") or "?"
            ver = vuln.get("InstalledVersion") or ""
            findings.append({
                "source": source_name,
                "severity": sev,
                "title": "{} {}@{} - {}".format(
                    v_id, pkg, ver, (vuln.get("Title") or vuln.get("Description") or "")[:100]
                ).strip(),
                "location": short_path(target),
            })
    return findings, ("ok" if findings else "no findings")


def parse_gitleaks(data):
    findings = []
    if data is None:
        return findings, "report missing"
    if isinstance(data, dict) and "runs" in data:
        # SARIF shape (gitleaks-results.sarif from gitleaks-action@v2)
        results = []
        for run in data.get("runs") or []:
            results.extend(run.get("results") or [])
        if not results:
            return findings, "no findings"
        for res in results:
            rule = res.get("ruleId") or "secret"
            location = "?"
            try:
                phys = res["locations"][0]["physicalLocation"]
                uri = phys["artifactLocation"]["uri"]
                line = phys.get("region", {}).get("startLine", "?")
                location = "{}:{}".format(short_path(uri), line)
            except (KeyError, IndexError, TypeError):
                pass
            level = str(res.get("level", "error")).lower()
            findings.append({
                "source": "gitleaks",
                "severity": "MEDIUM" if level == "note" else "HIGH",
                "title": "secret detected: {}".format(rule),
                "location": location,
            })
        return findings, "ok"
    if not isinstance(data, list):
        # newer gitleaks emits a bare list; some wrappers emit {"findings": []}
        data = data.get("findings") or [] if isinstance(data, dict) else []
    if not data:
        return findings, "no findings"
    for leak in data:
        rule = leak.get("RuleID") or leak.get("RuleName") or "secret"
        findings.append({
            "source": "gitleaks",
            "severity": "HIGH",  # gitleaks has no severity levels, leaked secret = high
            "title": "secret detected: {}".format(rule),
            "location": "{}:{}".format(
                short_path(leak.get("File") or "?"), leak.get("StartLine", "?")
            ),
        })
    return findings, "ok"


# --------------------------------------------------------------------------
# collection
# --------------------------------------------------------------------------

def collect_reports(reports_dir):
    """Returns (all_findings, source_statuses)."""
    sources = [
        ("semgrep", find_report(reports_dir, "semgrep-report.json"), parse_semgrep),
        ("npm-audit", find_report(reports_dir, "npm-audit.json"), parse_npm_audit),
        ("trivy-image", find_report(reports_dir, "trivy-image.json"),
         lambda d: parse_trivy(d, "trivy-image")),
        ("trivy-fs", find_report(reports_dir, "trivy-fs.json", "trivy-fs-report.json"),
         lambda d: parse_trivy(d, "trivy-fs")),
        ("gitleaks", find_gitleaks_report(reports_dir), parse_gitleaks),
    ]

    findings = []
    statuses = {}
    for name, path, parser in sources:
        data = load_json(path)
        found, status = parser(data)
        findings.extend(found)
        statuses[name] = status
    return findings, statuses


def count_by_severity(findings):
    counts = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0, "UNKNOWN": 0}
    for f in findings:
        counts[f["severity"]] += 1
    return counts


def verdict(counts):
    return "FAILED" if (counts["CRITICAL"] + counts["HIGH"]) > 0 else "SECURED"


# --------------------------------------------------------------------------
# gate mode
# --------------------------------------------------------------------------

def run_gate(findings, statuses, counts):
    """Print a summary table; exit 1 on any Critical/High."""
    blocked = counts["CRITICAL"] + counts["HIGH"]

    print("=" * 62)
    print("  SECURITY GATE - Plot Armor secure-pipeline")
    print("=" * 62)
    print()
    print("  {:<14} {:>8}".format("source", "status"))
    for name, status in statuses.items():
        print("  {:<14} {:>8}".format(name, status))
    print()
    print("  findings by severity:")
    for sev in ("CRITICAL", "HIGH", "MEDIUM", "LOW"):
        print("    {:<10} {}".format(sev, counts[sev]))
    print("    {:<10} {}".format("total", len(findings)))
    print()

    # fail closed: a scanner that produced no report must block the pipeline,
    # otherwise a crashed or misconfigured scan would silently go green
    missing = [name for name, st in statuses.items() if st == "report missing"]
    if missing:
        print("  gate fails closed: no report from: {}".format(", ".join(missing)))
        print("  policy: every scanner must produce a report before the gate can pass")
        print("=" * 62)
        return 1

    if blocked > 0:
        print("  blocking findings (critical/high):")
        for f in findings:
            if f["severity"] in ("CRITICAL", "HIGH"):
                print("    [{}] {} - {} @ {}".format(
                    f["severity"], f["source"], f["title"], f["location"]))
        print()
        print("  security gate: FAILED")
        print("  policy: no CRITICAL or HIGH findings are allowed on this branch")
        print("=" * 62)
        return 1

    print("  security gate: PASSED")
    print("=" * 62)
    return 0


# --------------------------------------------------------------------------
# dashboard mode
# --------------------------------------------------------------------------

def esc(s):
    return html.escape(str(s), quote=True)


def build_dashboard(findings, statuses, counts, generated_at):
    """Standalone dark-theme dashboard page, inline CSS only."""
    v = verdict(counts)
    ordered = sorted(findings, key=lambda f: (-SEVERITY_ORDER[f["severity"]], f["source"]))

    cards = """
      <div class="card total"><div class="num">{total}</div><div class="lbl">total findings</div></div>
      <div class="card crit"><div class="num">{c}</div><div class="lbl">critical</div></div>
      <div class="card high"><div class="num">{h}</div><div class="lbl">high</div></div>
      <div class="card med"><div class="num">{m}</div><div class="lbl">medium</div></div>
      <div class="card low"><div class="num">{l}</div><div class="lbl">low</div></div>
      <div class="card src"><div class="num">{n}</div><div class="lbl">sources scanned</div></div>
    """.format(
        total=len(findings), c=counts["CRITICAL"], h=counts["HIGH"],
        m=counts["MEDIUM"], l=counts["LOW"], n=len(statuses),
    )

    src_rows = "".join(
        '<tr><td>{}</td><td class="st {}">{}</td></tr>'.format(
            esc(name), "ok" if st == "ok" else "warn", esc(st))
        for name, st in statuses.items()
    )

    if ordered:
        rows = "".join(
            '<tr><td class="src-cell">{}</td>'
            '<td><span class="pill" style="background:{}">{}</span></td>'
            '<td class="title-cell">{}</td><td class="loc-cell">{}</td></tr>'.format(
                esc(f["source"]), SEVERITY_COLORS[f["severity"]],
                f["severity"], esc(f["title"]), esc(f["location"]))
            for f in ordered
        )
    else:
        rows = '<tr><td colspan="4" class="empty">no findings - clean scan</td></tr>'

    banner_cls = "fail" if v == "FAILED" else "pass"

    return """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plot Armor - Security Dashboard</title>
<style>
  :root {{
    color-scheme: dark;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    background: #0d1117; color: #e6edf3; padding: 32px 20px 60px;
  }}
  .wrap {{ max-width: 1080px; margin: 0 auto; }}
  h1 {{ font-size: 22px; margin-bottom: 4px; }}
  .sub {{ color: #8b949e; font-size: 13px; margin-bottom: 24px; }}
  .banner {{
    border-radius: 10px; padding: 18px 22px; margin-bottom: 26px;
    font-size: 18px; font-weight: 700; letter-spacing: 1px;
    border: 1px solid;
  }}
  .banner.fail {{ background: rgba(231,76,60,.12); border-color: #e74c3c; color: #ff8a7a; }}
  .banner.pass {{ background: rgba(46,204,113,.10); border-color: #2ecc71; color: #7ee2a8; }}
  .banner small {{ display:block; font-weight:400; letter-spacing:0; margin-top:6px; color:#8b949e; font-size:12px; }}
  .cards {{ display:grid; grid-template-columns: repeat(auto-fit, minmax(150px,1fr)); gap:14px; margin-bottom:30px; }}
  .card {{
    background:#161b22; border:1px solid #30363d; border-radius:10px;
    padding:18px 14px; text-align:center;
  }}
  .card .num {{ font-size:30px; font-weight:800; }}
  .card .lbl {{ color:#8b949e; font-size:12px; text-transform:uppercase; letter-spacing:1px; margin-top:4px; }}
  .card.crit .num {{ color:#e74c3c; }}
  .card.high .num {{ color:#e67e22; }}
  .card.med .num {{ color:#f1c40f; }}
  .card.low .num, .card.total .num, .card.src .num {{ color:#2ecc71; }}
  h2 {{ font-size:15px; margin-bottom:10px; color:#c9d1d9; }}
  table {{ width:100%; border-collapse:collapse; background:#161b22; border:1px solid #30363d; border-radius:10px; overflow:hidden; margin-bottom:30px; }}
  th {{ text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#8b949e; padding:10px 12px; background:#1c2129; border-bottom:1px solid #30363d; }}
  td {{ padding:10px 12px; border-bottom:1px solid #21262d; font-size:13px; vertical-align:top; }}
  tr:last-child td {{ border-bottom:none; }}
  .pill {{ display:inline-block; padding:2px 10px; border-radius:99px; color:#0d1117; font-weight:700; font-size:11px; letter-spacing:.5px; }}
  .src-cell {{ color:#79c0ff; white-space:nowrap; font-weight:600; }}
  .title-cell {{ max-width:480px; word-break:break-word; }}
  .loc-cell {{ color:#8b949e; font-family:Consolas,monospace; font-size:12px; word-break:break-all; }}
  .empty {{ text-align:center; color:#8b949e; padding:26px; }}
  table.sources {{ margin-bottom:34px; }}
  .st.ok {{ color:#2ecc71; }}
  .st.warn {{ color:#f1c40f; }}
  footer {{ color:#484f58; font-size:11px; text-align:center; margin-top:10px; }}
</style>
</head>
<body>
<div class="wrap">
  <h1>Plot Armor &mdash; Security Dashboard</h1>
  <div class="sub">aggregated report &middot; generated {when}</div>

  <div class="banner {cls}">
    PIPELINE VERDICT: {v}
    <small>policy gate: pipeline fails when any CRITICAL or HIGH finding is present</small>
  </div>

  <div class="cards">{cards}</div>

  <h2>Sources scanned</h2>
  <table class="sources">
    <tr><th>scanner</th><th>status</th></tr>
    {src_rows}
  </table>

  <h2>Findings</h2>
  <table>
    <tr><th>source</th><th>severity</th><th>title / message</th><th>location</th></tr>
    {rows}
  </table>

  <footer>secure-pipeline &middot; generated by scripts/report.py (stdlib only, no external deps)</footer>
</div>
</body>
</html>
""".format(
        when=esc(generated_at), cls=banner_cls, v=v,
        cards=cards, src_rows=src_rows, rows=rows,
    )


def write_dashboard(findings, statuses, counts, out_path):
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    page = build_dashboard(findings, statuses, counts, generated_at)
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(page)
    return page


# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="aggregate security scan reports")
    ap.add_argument("--reports-dir", default=".", help="directory holding the json reports")
    ap.add_argument("--gate", action="store_true", help="enforce policy: exit 1 on any critical/high finding")
    ap.add_argument("--output", default=None, help="dashboard output path (default <reports-dir>/dashboard.html)")
    args = ap.parse_args()

    reports_dir = args.reports_dir
    findings, statuses = collect_reports(reports_dir)
    counts = count_by_severity(findings)

    if args.gate:
        sys.exit(run_gate(findings, statuses, counts))

    out = args.output or os.path.join(reports_dir, "dashboard.html")
    page = write_dashboard(findings, statuses, counts, out)
    # open-check: the page must contain our markers to count as valid html
    ok = all(m in page for m in ("<html", "</html>", "Security Dashboard", "PIPELINE VERDICT"))
    print("wrote {} ({} bytes) - html valid: {}".format(out, len(page), "yes" if ok else "NO"))
    print("verdict: {} | critical={} high={} medium={} low={}".format(
        verdict(counts), counts["CRITICAL"], counts["HIGH"], counts["MEDIUM"], counts["LOW"]))
    for name, st in statuses.items():
        print("  {}: {}".format(name, st))


if __name__ == "__main__":
    main()
