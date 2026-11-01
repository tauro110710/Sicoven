#!/usr/bin/env python3
"""Seed and verify a synthetic SICOVEN accounting snapshot across installer upgrades."""
import hashlib
import json
import os
import sqlite3
import sys

DB_PATH = os.environ.get("SICOVEN_DB_PATH")
if not DB_PATH or not os.path.isfile(DB_PATH):
    raise SystemExit("SICOVEN_DB_PATH no apunta a una base SQLite existente.")

COMPANY_ID = "cert-upgrade-company"
ENTRY_ID = "cert-upgrade-opening-0001"
PROBE_TABLE = "_sicoven_upgrade_probe"


def connect():
    connection = sqlite3.connect(DB_PATH)
    connection.execute(
        f"CREATE TABLE IF NOT EXISTS {PROBE_TABLE} "
        "(probe_key TEXT PRIMARY KEY, probe_value TEXT NOT NULL)"
    )
    return connection


def seed():
    company = {
        "id": COMPANY_ID,
        "rif": "J-12345678-9",
        "name": "Empresa de certificación de actualización",
        "address": "Dirección de prueba",
        "phone": "",
        "email": "",
        "taxpayerType": "ORDINARIO",
        "defaultIvaRetentionRate": 75,
        "fiscalYear": 2026,
        "bcvRate": 100,
    }
    accounts = [
        {"code": "1.1.1.01", "name": "Banco", "type": "ACTIVO", "level": 4, "isMovement": True},
        {"code": "3.1.1.01", "name": "Capital social", "type": "PATRIMONIO", "level": 4, "isMovement": True},
    ]
    journal = {
        "id": ENTRY_ID,
        "companyId": COMPANY_ID,
        "entryNumber": 1,
        "date": "2026-10-01",
        "description": "Asiento de apertura sintético para prueba de actualización",
        "type": "MANUAL",
        "bcvRate": 100,
        "items": [
            {"accountCode": "1.1.1.01", "accountName": "Banco",
             "debitBs": 10000, "creditBs": 0, "debitUsd": 100, "creditUsd": 0},
            {"accountCode": "3.1.1.01", "accountName": "Capital social",
             "debitBs": 0, "creditBs": 10000, "debitUsd": 0, "creditUsd": 100},
        ],
        "createdAt": "2026-10-01T10:00:00.000Z",
    }
    collections = {
        "companies": [company],
        "accounts": accounts,
        "journalEntries": [journal],
        "purchases": [],
        "sales": [],
        "products": [],
        "movements": [],
        "vatVouchers": [],
        "vatWithholdingDeclarations": [],
        "vatWithholdingDeclarationEvents": [],
        "islrVouchers": [],
        "bankAccounts": [],
        "bankStatementMovements": [],
        "creditSettlements": [],
        "supplierAdvanceSettlements": [],
        "supplierDirectAdvances": [],
        "islrFiscalEvents": [],
        "financialDisclosures": [],
    }
    payload = json.dumps(collections, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    with connect() as db:
        db.execute(
            "INSERT OR REPLACE INTO app_state(state_key,state_json,updated_at) "
            "VALUES('accounting',?,datetime('now'))",
            (payload,),
        )
        db.execute(
            f"INSERT OR REPLACE INTO {PROBE_TABLE}(probe_key,probe_value) VALUES(?,?)",
            ("accounting_state_sha256", digest),
        )
        db.execute(
            f"INSERT OR REPLACE INTO {PROBE_TABLE}(probe_key,probe_value) VALUES(?,?)",
            ("upgrade", "preserve-me"),
        )
    print(f"Snapshot contable sintético sembrado: empresa={COMPANY_ID}, asiento={ENTRY_ID}, SHA-256={digest}")


def verify():
    with connect() as db:
        row = db.execute(
            "SELECT state_json FROM app_state WHERE state_key='accounting'"
        ).fetchone()
        expected = db.execute(
            f"SELECT probe_value FROM {PROBE_TABLE} WHERE probe_key='accounting_state_sha256'"
        ).fetchone()
        marker = db.execute(
            f"SELECT probe_value FROM {PROBE_TABLE} WHERE probe_key='upgrade'"
        ).fetchone()
    if not row or not expected or not marker or marker[0] != "preserve-me":
        raise SystemExit("Falta el snapshot o marcador de prueba después de actualizar.")
    actual = hashlib.sha256(row[0].encode("utf-8")).hexdigest()
    if actual != expected[0]:
        raise SystemExit("El hash del snapshot contable SQLite cambió durante la actualización.")
    state = json.loads(row[0])
    company_ids = {item.get("id") for item in state.get("companies", [])}
    entries = state.get("journalEntries", [])
    if COMPANY_ID not in company_ids or not any(
        item.get("id") == ENTRY_ID and item.get("companyId") == COMPANY_ID and item.get("entryNumber") == 1
        for item in entries
    ):
        raise SystemExit("No se conservó la empresa o el asiento de apertura del dataset de certificación.")
    print(f"Snapshot contable conservado: empresa={COMPANY_ID}, asiento={ENTRY_ID}, SHA-256={actual}")


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in {"seed", "verify"}:
        raise SystemExit("Uso: verify-sqlite-upgrade.py seed|verify")
    seed() if sys.argv[1] == "seed" else verify()
