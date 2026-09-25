"""Examen del intérprete contra Gemini real (no se ejecuta en CI).

Usa las MISMAS instrucciones, esquema de respuesta, prompt y validación que el
servidor (se importan de app.py), así que la nota es la que tendría la app.

Uso (desde backend/):
    GCP_TOKEN=$(gcloud auth print-access-token) python3 eval/run_eval.py gemini-2.5-flash-lite gemini-2.5-flash
Opciones por modelo: "modelo@thinking=0" fija el presupuesto de razonamiento.
"""

from __future__ import annotations

import json
import os
import statistics
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import app  # noqa: E402

PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "angeli-secretaria")
CASES = json.loads((Path(__file__).parent / "cases.json").read_text(encoding="utf-8"))


def plain(value) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFD", str(value or "").lower()) if unicodedata.category(ch) != "Mn")


def call(model: str, text: str, thinking: int | None) -> tuple[dict | None, str | None, float, dict]:
    config = {"responseMimeType": "application/json", "responseJsonSchema": app.RESPONSE_SCHEMA, "temperature": 0, "maxOutputTokens": 800}
    if thinking is not None:
        config["thinkingConfig"] = {"thinkingBudget": thinking}
    body = {
        "systemInstruction": {"parts": [{"text": app.SYSTEM_INSTRUCTION}]},
        "contents": [{"role": "user", "parts": [{"text": app.interpreter_prompt(text, CASES["now"], CASES["timeZone"], None)}]}],
        "generationConfig": config,
    }
    url = f"https://aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/global/publishers/google/models/{model}:generateContent"
    request = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Authorization": "Bearer " + os.environ["GCP_TOKEN"], "Content-Type": "application/json"})
    started = time.monotonic()
    for attempt in range(4):
        try:
            data = json.load(urllib.request.urlopen(request, timeout=90))
            break
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt < 3:
                time.sleep(3 * (attempt + 1))
                continue
            return None, f"HTTP {error.code}", time.monotonic() - started, {}
        except Exception as error:  # noqa: BLE001
            return None, f"red: {error}", time.monotonic() - started, {}
    elapsed = time.monotonic() - started
    usage = data.get("usageMetadata", {})
    try:
        parts = data["candidates"][0]["content"]["parts"]
        raw = json.loads("".join(part.get("text", "") for part in parts if not part.get("thought")))
    except Exception:  # noqa: BLE001
        return None, "JSON inválido o cortado", elapsed, usage
    try:
        return app.validate_interpretation(raw), None, elapsed, usage
    except ValueError as error:
        return None, f"rechazada por validación: {error}", elapsed, usage


def check(case: dict, result: dict) -> list[str]:
    problems = []
    def want(key, actual):
        expected = case[key]
        options = expected if isinstance(expected, list) else [expected]
        if actual not in options:
            problems.append(f"{key}: {actual!r} (esperado {expected!r})")
    def contains(key, actual):
        if plain(case[key]) not in plain(actual):
            problems.append(f"{key}: {actual!r} (debe incluir {case[key]!r})")
    want("intent", result.get("intent"))
    if "date" in case: want("date", result.get("date"))
    if "time" in case: want("time", result.get("time"))
    if "rangeStart" in case: want("rangeStart", result.get("rangeStart"))
    if "rangeEnd" in case: want("rangeEnd", result.get("rangeEnd"))
    if "changes_date" in case: want("changes_date", (result.get("changes") or {}).get("date"))
    if "changes_time" in case: want("changes_time", (result.get("changes") or {}).get("time"))
    if "linked_date" in case: want("linked_date", (result.get("linkedReminder") or {}).get("date"))
    if "contact_exacto" in case and plain(result.get("contactName")) != plain(case["contact_exacto"]):
        problems.append(f"contacto: {result.get('contactName')!r} (esperado {case['contact_exacto']!r})")
    if "contact_incluye" in case: contains("contact_incluye", result.get("contactName"))
    if "phone_incluye" in case: contains("phone_incluye", (result.get("phone") or "").replace(" ", ""))
    if "notes_incluye" in case: contains("notes_incluye", result.get("notes"))
    if "location_incluye" in case: contains("location_incluye", result.get("location"))
    if "target_incluye" in case: contains("target_incluye", (result.get("target") or {}).get("title"))
    if "notequery_incluye" in case: contains("notequery_incluye", result.get("noteQuery"))
    if "missing_incluye" in case and case["missing_incluye"] not in (result.get("missingFields") or []):
        problems.append(f"falta pedir {case['missing_incluye']!r} (missingFields={result.get('missingFields')})")
    return problems


def evaluate(spec: str) -> dict:
    model, _, option = spec.partition("@")
    thinking = int(option.split("=")[1]) if option.startswith("thinking=") else None
    def one(case):
        result, error, elapsed, usage = call(model, case["text"], thinking)
        problems = [error] if error else check(case, result)
        return {"case": case, "result": result, "problems": problems, "elapsed": elapsed, "usage": usage}
    with ThreadPoolExecutor(max_workers=6) as pool:
        rows = list(pool.map(one, CASES["cases"]))
    return {"spec": spec, "rows": rows}


def report(run: dict) -> None:
    rows = run["rows"]
    ok = [row for row in rows if not row["problems"]]
    times = sorted(row["elapsed"] for row in rows)
    tokens_in = sum(row["usage"].get("promptTokenCount", 0) for row in rows) / len(rows)
    tokens_out = sum(row["usage"].get("candidatesTokenCount", 0) + row["usage"].get("thoughtsTokenCount", 0) for row in rows) / len(rows)
    rejected = sum(1 for row in rows if row["problems"] and not row["result"])
    print(f"\n=== {run['spec']}: {len(ok)}/{len(rows)} aciertos ({100 * len(ok) / len(rows):.0f} %) · respuestas rechazadas {rejected}")
    print(f"    tiempo mediana {statistics.median(times):.1f} s · p90 {times[int(len(times) * 0.9)]:.1f} s · tokens medios entrada {tokens_in:.0f} / salida+razonamiento {tokens_out:.0f}")
    by_cat: dict[str, list[int]] = {}
    for row in rows:
        by_cat.setdefault(row["case"]["cat"], [0, 0])
        by_cat[row["case"]["cat"]][1] += 1
        if not row["problems"]:
            by_cat[row["case"]["cat"]][0] += 1
    print("    " + " · ".join(f"{cat} {good}/{total}" for cat, (good, total) in by_cat.items()))


if __name__ == "__main__":
    runs = [evaluate(spec) for spec in sys.argv[1:]]
    for run in runs:
        report(run)
    out = Path(os.getenv("EVAL_OUT", "/tmp/angeli-eval.json"))
    out.write_text(json.dumps([{"spec": run["spec"], "rows": [{"text": row["case"]["text"], "cat": row["case"]["cat"], "problems": row["problems"], "result": row["result"], "elapsed": row["elapsed"]} for row in run["rows"]]} for run in runs], ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nDetalle: {out}")
