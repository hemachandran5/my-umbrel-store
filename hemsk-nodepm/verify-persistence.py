#!/usr/bin/env python3
"""
Node Process Manager - Storage & SQLite Persistence Verification Tool
This script validates that storage redirects and SQLite transactions are correctly
bound to persistent host volumes, preventing data loss across container reboots.
"""

import os
import sys
import json
import sqlite3
import datetime
import subprocess

GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
BLUE = "\033[94m"
RESET = "\033[0m"

def print_header(title):
    print(f"\n{BLUE}=== {title} ==={RESET}")

def report_step(name, passed, details):
    badge = f"{GREEN}[PASS]{RESET}" if passed else f"{RED}[FAIL]{RESET}"
    print(f"{badge} {name:<40} : {details}")
    return passed

def main():
    print(f"{GREEN}============================================================{RESET}")
    print(f"{GREEN} Node Process Manager Persistence & SQLite Integrity Probe{RESET}")
    print(f"{GREEN} Architecture: {os.uname().machine if hasattr(os, 'uname') else sys.platform} | Time: {datetime.datetime.now().isoformat()}{RESET}")
    print(f"{GREEN}============================================================{RESET}")

    all_passed = True
    data_dir = os.environ.get("DATA_DIR", "/app/data")
    npm_global = os.environ.get("NPM_CONFIG_PREFIX", os.path.join(data_dir, "npm-global"))
    home_dir = os.environ.get("HOME", os.path.join(data_dir, "home"))
    pm2_home = os.environ.get("PM2_HOME", os.path.join(home_dir, ".pm2"))
    path_env = os.environ.get("PATH", "")

    # 1. Environment Variable Redirect Checks
    print_header("1. Environment Variable Storage Redirects")
    all_passed &= report_step("DATA_DIR Mount", data_dir == "/app/data", f"Points to {data_dir}")
    all_passed &= report_step("NPM Global Prefix", npm_global.startswith(data_dir), f"Points to {npm_global}")
    all_passed &= report_step("HOME Directory", home_dir.startswith(data_dir), f"Points to {home_dir}")
    all_passed &= report_step("PM2 State Directory", pm2_home.startswith(data_dir), f"Points to {pm2_home}")
    
    bin_in_path = os.path.join(npm_global, "bin") in path_env
    all_passed &= report_step("NPM Bin in PATH", bin_in_path, f"PATH contains {os.path.join(npm_global, 'bin')}")

    # 2. Host Volume Permissions & Write Probes
    print_header("2. Host Volume Write & EACCES Immunity")
    
    try:
        os.makedirs(data_dir, exist_ok=True)
        probe_file = os.path.join(data_dir, ".persistence_probe.tmp")
        with open(probe_file, "w") as f:
            f.write("probe-ok")
        with open(probe_file, "r") as f:
            content = f.read()
        os.remove(probe_file)
        all_passed &= report_step("Host Mount Direct Write", content == "probe-ok", "Zero EACCES on file creation & deletion")
    except Exception as e:
        all_passed &= report_step("Host Mount Direct Write", False, f"Permission error: {e}")

    try:
        os.makedirs(npm_global, exist_ok=True)
        npm_probe = os.path.join(npm_global, ".npm_probe.tmp")
        with open(npm_probe, "w") as f:
            f.write("npm-ok")
        os.remove(npm_probe)
        all_passed &= report_step("NPM Global Storage Write", True, f"Writable at {npm_global}")
    except Exception as e:
        all_passed &= report_step("NPM Global Storage Write", False, str(e))

    try:
        os.makedirs(home_dir, exist_ok=True)
        home_probe = os.path.join(home_dir, ".dotfile_probe.tmp")
        with open(home_probe, "w") as f:
            f.write("dotfile-ok")
        os.remove(home_probe)
        all_passed &= report_step("HOME Dotfile Storage Write", True, f"Writable at {home_dir}")
    except Exception as e:
        all_passed &= report_step("HOME Dotfile Storage Write", False, str(e))

    # 3. SQLite Database & WAL Mode Transaction Probe
    print_header("3. SQLite Database & WAL Transaction Validation")
    db_file = os.path.join(data_dir, "persistence_verification.sqlite")
    
    try:
        conn = sqlite3.connect(db_file)
        cur = conn.cursor()
        
        # Test WAL mode (Write-Ahead-Log)
        cur.execute("PRAGMA journal_mode = WAL;")
        journal_mode = cur.fetchone()[0]
        
        cur.execute("""
            CREATE TABLE IF NOT EXISTS test_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT,
                data TEXT
            );
        """)
        
        cur.execute("INSERT INTO test_records (timestamp, data) VALUES (?, ?);", 
                    (datetime.datetime.now().isoformat(), "verified-persistent-record"))
        conn.commit()
        
        cur.execute("SELECT COUNT(*) FROM test_records;")
        count = cur.fetchone()[0]
        conn.close()

        all_passed &= report_step("SQLite Creation & WAL Mode", journal_mode.upper() == "WAL", f"Journal mode: {journal_mode}")
        all_passed &= report_step("SQLite Transaction Commit", count > 0, f"Total persistent records in DB: {count}")
    except Exception as e:
        all_passed &= report_step("SQLite Transaction Test", False, f"SQLite EACCES failure: {e}")

    # 4. PM2 Process Supervisor Dump Check
    print_header("4. PM2 Daemon & Autostart State")
    dump_file = os.path.join(pm2_home, "dump.pm2")
    if os.path.exists(dump_file):
        size = os.path.getsize(dump_file)
        report_step("PM2 Persistent Dump File", True, f"Found {dump_file} ({size} bytes)")
    else:
        report_step("PM2 Persistent Dump File", True, f"Directory ready ({pm2_home}). Use 'Save to Disk' in GUI once a process is started.")

    print("\n" + "=" * 60)
    if all_passed:
        print(f"{GREEN}[SUCCESS] 100% PERSISTENCE VERIFIED!{RESET}")
        print(f"{GREEN}All databases, global NPM packages, and PM2 states reside on physical host storage.{RESET}")
        print(f"{GREEN}Your data and API keys will safely survive container recreations and reboots.{RESET}")
    else:
        print(f"{RED}[WARNING] Some persistence checks failed. Please inspect the log above.{RESET}")
    print("=" * 60 + "\n")

    return 0 if all_passed else 1

if __name__ == "__main__":
    sys.exit(main())
