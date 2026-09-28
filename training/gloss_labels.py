"""Phase 4: English sentence -> ISL gloss labels via Gemini, cached.

For every unique English sentence in the iSign .h5, ask Gemini which ISL gloss
words would actually be signed, lemmatised to base forms (said -> SAY,
went -> GO). ISL_SYSTEM_PROMPT from src/services/qwenRules.js is included as
grammar context (read through node, so there is one source of truth).

Sentences are sent in batches (one system prompt per batch, not per sentence),
but every sentence gets its own {"gloss": [...]} and its own cache line in
training/data/gloss_cache.jsonl, keyed by (prompt version, model, sentence).
Reruns only pay for sentences not yet cached.

    python training/gloss_labels.py estimate --price-in 0.30 --price-out 2.50
    python training/gloss_labels.py sample --n 50        # needs GEMINI_API_KEY
    python training/gloss_labels.py run --yes            # everything not cached

GEMINI_API_KEY is read from the environment or from the repo's .env file.
Prices are USD per 1M tokens and must come from Google's current price list:
this script never assumes them.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

TRAINING = Path(__file__).resolve().parent
REPO = TRAINING.parent
sys.path.insert(0, str(TRAINING))
import data as D  # noqa: E402

CACHE = TRAINING / "data" / "gloss_cache.jsonl"
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_MODEL = "gemini-3.6-flash"      # the model translator.js measured as working
PROMPT_VERSION = "gloss-v1"
BATCH = 40

TASK = """\
TASK (this overrides "Output ONLY the final sentence" above): you now work in the
opposite direction. For each numbered English sentence, list the ISL gloss
words a fluent Indian Sign Language signer would actually SIGN for it.

Rules:
- One UPPERCASE token per sign, lemmatised to its base form: said->SAY,
  went->GO, children->CHILD, better->GOOD, women->WOMAN.
- Omit what ISL does not sign: articles, copulas (is/are/was), most
  prepositions and auxiliaries, and "to" infinitive markers.
- KEEP negation (NOT, NO, NEVER), WH-words (WHAT, WHERE, WHO, WHY, HOW, WHEN),
  pronouns that are signed (I, YOU, HE, SHE, THEY, WE, MY, YOUR), time words
  (YESTERDAY, TOMORROW, NOW), numbers as digits ("5"), and proper names as one
  UPPERCASE token (MODI, DELHI).
- Order tokens as they would be signed (ISL order: time, topic, comment,
  negation/WH last), but correctness of the set matters most.
- If a "sentence" is not language (e.g. "2", "blank", "Page 111"), return the
  tokens that would be signed, or [] if nothing would be.
Return JSON only: {"items": [{"i": <number>, "gloss": [...]}, ...]} with one
item per input sentence, same numbers."""

SCHEMA = {
    "type": "OBJECT",
    "properties": {"items": {"type": "ARRAY", "items": {
        "type": "OBJECT",
        "properties": {"i": {"type": "INTEGER"},
                       "gloss": {"type": "ARRAY", "items": {"type": "STRING"}}},
        "required": ["i", "gloss"]}}},
    "required": ["items"],
}


# ------------------------------------------------------------------ inputs
def isl_system_prompt() -> str:
    js = (REPO / "src" / "services" / "qwenRules.js").as_uri()
    out = subprocess.run(
        ["node", "--input-type=module", "-e",
         f"import {{ ISL_SYSTEM_PROMPT }} from '{js}'; process.stdout.write(ISL_SYSTEM_PROMPT);"],
        capture_output=True, text=True, encoding="utf-8", check=True)
    return out.stdout


def system_prompt() -> str:
    return isl_system_prompt() + "\n\n" + TASK


def norm(s: str) -> str:
    return " ".join(str(s).split())


def unique_sentences() -> list[str]:
    _, texts, _ = D.h5_meta(D.H5_DEFAULT)
    seen, out = set(), []
    for t in texts:
        n = norm(t)
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out


def api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "")
    env = REPO / ".env"
    if not key and env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            m = re.match(r"\s*GEMINI_API_KEY\s*=\s*(.+?)\s*$", line)
            if m:
                key = m.group(1).strip().strip("'\"")
    if not key:
        sys.exit("GEMINI_API_KEY not set (environment or .env)")
    return key


# ------------------------------------------------------------------- cache
def cache_key(model: str, sentence: str) -> str:
    return hashlib.sha1(f"{PROMPT_VERSION}\0{model}\0{sentence}".encode()).hexdigest()


def load_cache() -> dict[str, dict]:
    out = {}
    if CACHE.exists():
        with open(CACHE, encoding="utf-8") as fh:
            for line in fh:
                try:
                    r = json.loads(line)
                    out[r["key"]] = r
                except (json.JSONDecodeError, KeyError):
                    continue          # a torn last line from an interrupted run
    return out


_cache_lock = threading.Lock()


def append_cache(rows: list[dict]) -> None:
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    with _cache_lock, open(CACHE, "a", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")


# ------------------------------------------------------------- rate limiting
class RateLimiter:
    """At most `rpm` request starts per rolling minute, across threads."""

    def __init__(self, rpm: float):
        self.interval = 60.0 / rpm
        self.next = time.monotonic()
        self.lock = threading.Lock()

    def wait(self):
        with self.lock:
            now = time.monotonic()
            t = max(now, self.next)
            self.next = t + self.interval
        time.sleep(max(0.0, t - time.monotonic()))


# --------------------------------------------------------------------- API
def call_gemini(key, model, sys_prompt, sentences, limiter, retries=6):
    body = {
        "system_instruction": {"parts": [{"text": sys_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": "\n".join(
            f"{i}. {s}" for i, s in enumerate(sentences))}]}],
        "generationConfig": {"responseMimeType": "application/json",
                             "responseSchema": SCHEMA, "temperature": 0.0},
    }
    data = json.dumps(body).encode()
    last = None
    for attempt in range(retries):
        limiter.wait()
        req = urllib.request.Request(
            f"{ENDPOINT}/{model}:generateContent", data=data, method="POST",
            headers={"Content-Type": "application/json", "x-goog-api-key": key})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                resp = json.loads(r.read())
            text = resp["candidates"][0]["content"]["parts"][0]["text"]
            items = json.loads(text)["items"]
            got = {int(it["i"]): [str(g).strip().upper() for g in it["gloss"] if str(g).strip()]
                   for it in items}
            missing = [i for i in range(len(sentences)) if i not in got]
            if missing:
                raise ValueError(f"reply is missing items {missing[:5]}")
            usage = resp.get("usageMetadata", {})
            return got, usage
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}: {e.read()[:200]!r}"
            if e.code not in (429, 500, 502, 503, 504):
                raise RuntimeError(last) from e
        except (urllib.error.URLError, TimeoutError, KeyError, ValueError,
                json.JSONDecodeError) as e:
            last = f"{type(e).__name__}: {e}"
        time.sleep(min(60, 2 ** attempt + random.random()))
    raise RuntimeError(f"gave up after {retries} attempts: {last}")


def gloss_many(sentences, model, rpm, workers, progress=True):
    """Gloss every sentence not already cached. -> (cache dict, usage totals)."""
    cache = load_cache()
    todo = [s for s in sentences if cache_key(model, s) not in cache]
    usage = {"prompt": 0, "output": 0, "requests": 0}
    if not todo:
        return cache, usage
    key, sp = api_key(), system_prompt()
    limiter = RateLimiter(rpm)
    batches = [todo[i:i + BATCH] for i in range(0, len(todo), BATCH)]
    t0, done = time.time(), 0

    def work(batch):
        got, u = call_gemini(key, model, sp, batch, limiter)
        rows = [{"key": cache_key(model, s), "model": model, "prompt": PROMPT_VERSION,
                 "sentence": s, "gloss": got[i]} for i, s in enumerate(batch)]
        append_cache(rows)
        return rows, u

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for fut in as_completed([pool.submit(work, b) for b in batches]):
            rows, u = fut.result()
            for r in rows:
                cache[r["key"]] = r
            usage["prompt"] += u.get("promptTokenCount", 0)
            usage["output"] += u.get("candidatesTokenCount", 0) + u.get("thoughtsTokenCount", 0)
            usage["requests"] += 1
            done += len(rows)
            if progress and (usage["requests"] % 20 == 0 or done == len(todo)):
                print(f"[gloss] {done}/{len(todo)} sentences | {time.time() - t0:.0f}s",
                      flush=True)
    return cache, usage


# ---------------------------------------------------------------- commands
def cmd_estimate(args):
    sents = unique_sentences()
    cache = load_cache()
    todo = [s for s in sents if cache_key(args.model, s) not in cache]
    sp = system_prompt()
    # ~4 characters per token for English; calibrate with a `sample` run's usage.
    sp_tok = len(sp) / 4
    in_tok = len(todo) / BATCH * (sp_tok + 30) + sum(len(s) + 5 for s in todo) / 4
    # measured-shape guess: ~6 gloss tokens/sentence * ~3 tokens + JSON framing
    out_tok = len(todo) * 28
    print(f"[estimate] unique sentences {len(sents)} | cached {len(sents) - len(todo)} "
          f"| to send {len(todo)} in {-(-len(todo) // BATCH)} requests of {BATCH}")
    print(f"[estimate] system prompt ~{sp_tok:.0f} tokens | input ~{in_tok / 1e6:.2f}M tokens "
          f"| output ~{out_tok / 1e6:.2f}M tokens (+ any thinking tokens)")
    if args.price_in is not None and args.price_out is not None:
        cost = in_tok / 1e6 * args.price_in + out_tok / 1e6 * args.price_out
        print(f"[estimate] at ${args.price_in}/M in, ${args.price_out}/M out: ~${cost:.2f}")
    else:
        print("[estimate] pass --price-in/--price-out (USD per 1M tokens, from Google's "
              "current price list) for a dollar figure")


def cmd_sample(args):
    sents = unique_sentences()
    rng = random.Random(args.seed)
    pick = rng.sample(sents, args.n)
    cache, usage = gloss_many(pick, args.model, args.rpm, args.workers, progress=False)
    labeller = D.Labeller(D.load_vocab()["words"])
    words = labeller.words
    for s in pick:
        g = cache[cache_key(args.model, s)]["gloss"]
        old = [words[i] for i in labeller(s)]
        print(f"\nEN   : {s}\nOLD  : {' '.join(old) or '-'}\nGLOSS: {' '.join(g) or '-'}")
    if usage["requests"]:
        per = {k: v / len(pick) for k, v in usage.items() if k != "requests"}
        print(f"\n[usage] {usage} | per sentence: in {per['prompt']:.0f}, "
              f"out {per['output']:.0f} tokens (use these to calibrate `estimate`)")


def cmd_run(args):
    if not args.yes:
        sys.exit("refusing to run on everything without --yes (see `estimate` first)")
    sents = unique_sentences()
    cache, usage = gloss_many(sents, args.model, args.rpm, args.workers)
    print(f"[run] cached {sum(1 for s in sents if cache_key(args.model, s) in cache)}"
          f"/{len(sents)} | this run {usage}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--rpm", type=float, default=60, help="max requests per minute")
    ap.add_argument("--workers", type=int, default=4)
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("estimate")
    e.add_argument("--price-in", type=float, default=None)
    e.add_argument("--price-out", type=float, default=None)
    s = sub.add_parser("sample")
    s.add_argument("--n", type=int, default=50)
    s.add_argument("--seed", type=int, default=4)
    r = sub.add_parser("run")
    r.add_argument("--yes", action="store_true")
    args = ap.parse_args()
    {"estimate": cmd_estimate, "sample": cmd_sample, "run": cmd_run}[args.cmd](args)


if __name__ == "__main__":
    main()
