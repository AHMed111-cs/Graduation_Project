#!/usr/bin/env python3
"""FTP-Scan (vendored). Prints ONE JSON document:
{ target, port, banner, anonymous_login, listing: [..], exploits: [{id, title}] }
It only connects, reads the banner, tries anonymous login and lists the root directory.
Exploit matches come from a small local table keyed on the banner; they are possible issues, not confirmed."""
import argparse, ftplib, json, re, sys

# id, title, regex matched against the banner
LOCAL_EXPLOIT_DB = [
    ("EDB-17491", "vsftpd 2.3.4 - Backdoor Command Execution", r"vsFTPd 2\.3\.4"),
    ("EDB-36742", "ProFTPd 1.3.5 - mod_copy Remote Command Execution", r"ProFTPD 1\.3\.5"),
    ("EDB-16929", "ProFTPd 1.3.3c - Backdoor Command Execution", r"ProFTPD 1\.3\.3c"),
    ("EDB-20745", "WU-FTPD 2.6.0 - Remote Format String", r"wu-2\.6\.0"),
]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target")
    ap.add_argument("--port", type=int, default=21)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--timeout", type=int, default=15)
    a = ap.parse_args()
    out = {"target": a.target, "port": a.port, "banner": None, "anonymous_login": False, "listing": [], "exploits": []}
    try:
        ftp = ftplib.FTP()
        ftp.connect(a.target, a.port, timeout=a.timeout)
        out["banner"] = ftp.getwelcome()
        try:
            ftp.login("anonymous", "naqb@scan.local")
            out["anonymous_login"] = True
            out["listing"] = ftp.nlst()[:100]
        except ftplib.error_perm:
            pass
        try: ftp.quit()
        except Exception: pass
    except Exception as e:
        print(f"ftp-scan: cannot connect to {a.target}:{a.port}: {e}", file=sys.stderr)
        sys.exit(2)
    for eid, title, rx in LOCAL_EXPLOIT_DB:
        if out["banner"] and re.search(rx, out["banner"], re.I):
            out["exploits"].append({"id": eid, "title": title})
    print(json.dumps(out))

main()
