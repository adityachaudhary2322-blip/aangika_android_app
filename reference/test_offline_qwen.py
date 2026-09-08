"""
Offline sentence reconstruction test -- Qwen2.5-0.5B-Instruct, no network.

    python scripts/test_offline_qwen.py

Forces mode="offline" so Gemini is never consulted, then reconstructs three
ISL tag sequences on device. Reports model load time, per-inference latency,
and process memory before/after load.

Nothing here raises: a failed load or a failed generation is reported as a
FAIL row and the run continues, so one bad case still yields a useful picture.
"""

from __future__ import annotations

import logging
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# The model is English-only here, but keep the console UTF-8 anyway -- a Windows
# cp1252 console would kill the run on any non-ASCII byte the model emits.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from llm.conversation_manager import reconstruct_sentence  # noqa: E402
from llm.qwen_engine import (  # noqa: E402
    FEW_SHOT, MAX_NEW_TOKENS, MODEL_ID, SYSTEM_PROMPT, QwenEngine, QwenUnavailable,
    available_ram_mb, process_peak_rss_mb, process_rss_mb,
)

logging.basicConfig(level=logging.WARNING,
                    format="    [%(levelname)s] %(name)s: %(message)s")
# The HF weight-loading bar rewrites one line with ANSI codes and makes the
# captured output unreadable; we time the load ourselves anyway.
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
try:
    from transformers.utils import logging as hf_logging
    hf_logging.set_verbosity_error()
    hf_logging.disable_progress_bar()
except Exception:
    pass

# The three cases from the brief. All three are ALSO few-shot examples in the
# prompt, so passing them shows the prompt is being followed -- not that the
# model generalises.
CASES: list[list[str]] = [
    ["I", "WANT", "WATER"],
    ["TOMORROW", "COLLEGE", "GO"],
    ["DOCTOR", "HELP", "NEED"],
]

# Held-out cases: never shown to the model. Each probes one prior from the
# system prompt, so a failure here points at a specific rule rather than a vague
# "it got worse". `expect` is a human-readable target, not an assertion -- there
# is more than one correct English rendering of most of these.
#
# YESTERDAY/MARKET/GO and MOTHER/HOSPITAL/YESTERDAY/GO used to live here. They
# are now few-shot demonstrations, so they have been REMOVED rather than left in
# to pad the pass rate -- a case the model has been shown is not a test. The
# replacements below probe the same two rules with words the prompt never
# mentions.
HELDOUT: list[tuple[list[str], str, str]] = [
    (["FOOD", "WANT"], "no hallucinated verb", "I want food."),
    (["HE", "TEACHER"], "explicit 3rd-person subject kept", "He is a teacher."),
    (["POLICE", "CALL", "NEED"], "emergency = signer's need",
     "I need to call the police."),
    # Kinship subject, undemonstrated word, future tense.
    (["FATHER", "SHOP", "TOMORROW", "GO"], "kinship subject + future",
     "My father will go to the shop tomorrow."),
    # Kinship subject with no time word at all.
    (["SISTER", "BOOK", "READ"], "kinship subject, no time cue",
     "My sister is reading a book."),
    # Past tense on an undemonstrated noun.
    (["YESTERDAY", "SCHOOL", "GO"], "past tense, new noun",
     "I went to school yesterday."),
    # Adversarial: FRIEND is a person noun but here it is the OBJECT, not the
    # subject. Over-applying the kinship rule would yield "My friend needs help."
    (["FRIEND", "HELP", "NEED"], "person noun as object, not subject",
     "I need my friend's help."),
]

RESULTS: list[tuple[str, str, str, float]] = []  # tags, status, sentence, ms
HELDOUT_RESULTS: list[tuple[str, str, str, float]] = []  # tags, got, target, ms


def rule(title: str) -> None:
    print(f"\n{title}\n" + "-" * 74)


def main() -> int:
    print("=" * 74)
    print("  Offline sentence reconstruction -- Qwen2.5-0.5B-Instruct")
    print("=" * 74)

    # ── Environment ─────────────────────────────────────────────────────────
    rule("0. Environment")
    try:
        import torch
        import transformers
        print(f"  torch          : {torch.__version__}")
        print(f"  transformers   : {transformers.__version__}")
        print(f"  CUDA available : {torch.cuda.is_available()}")
        print(f"  torch threads  : {torch.get_num_threads()}")
    except ImportError as exc:
        print(f"  ERROR: {exc}")
        print("  pip install torch transformers accelerate")
        return 1

    print(f"  model id       : {MODEL_ID}")
    print(f"  max_new_tokens : {MAX_NEW_TOKENS}")
    rss_before = process_rss_mb()
    print(f"  RSS before load: {rss_before:,.0f} MiB")
    print(f"  RAM free       : {available_ram_mb():,.0f} MiB")
    print(f"\n  system prompt  : {SYSTEM_PROMPT}")

    # ── Load ────────────────────────────────────────────────────────────────
    rule("1. Model load")
    engine = QwenEngine.get()
    try:
        started = time.perf_counter()
        engine.load()
        wall_ms = (time.perf_counter() - started) * 1000
    except QwenUnavailable as exc:
        print(f"  FAILED: {exc}")
        print("\n  The offline engine could not start. reconstruct_sentence()")
        print("  will still work -- it degrades to the rule-based join.")
        return 1

    rss_after = process_rss_mb()
    print(f"  loaded in      : {wall_ms:,.0f} ms")
    print(f"  device / dtype : {engine.device} / {engine.dtype_name}")
    print(f"  RSS after load : {rss_after:,.0f} MiB  "
          f"(+{rss_after - rss_before:,.0f} MiB for weights)")
    print(f"  peak RSS       : {process_peak_rss_mb():,.0f} MiB")
    print(f"  RAM free       : {available_ram_mb():,.0f} MiB")

    # ── Reconstruction ──────────────────────────────────────────────────────
    rule('2. Reconstruction (mode="offline", network never touched)')
    for i, tags in enumerate(CASES, 1):
        print(f"\n  Case {i}: {tags}")
        try:
            started = time.perf_counter()
            result = reconstruct_sentence(tags, mode="offline")
            elapsed = (time.perf_counter() - started) * 1000

            english = result.get("english", "")
            source = result.get("source", "?")
            status = "OK" if source.startswith("qwen") else "FELL BACK"

            print(f"    sentence   : {english!r}")
            print(f"    source     : {source}"
                  + (f"  ({result['device']})" if result.get("device") else ""))
            print(f"    latency    : {elapsed:,.0f} ms")
            if result.get("hindi"):
                print(f"    hindi      : {result['hindi']!r}")
            if result.get("error"):
                print(f"    diagnostic : {str(result['error'])[:200]}")

            RESULTS.append((" ".join(tags), status, english, elapsed))
        except Exception as exc:  # noqa: BLE001 - harness must not crash
            print(f"    UNEXPECTED : {type(exc).__name__}: {exc}")
            RESULTS.append((" ".join(tags), "ERROR", str(exc)[:60], 0.0))

    # ── Held-out generalisation ─────────────────────────────────────────────
    rule("2b. Held-out cases (NOT in the prompt) - does it generalise?")
    for tags, probes, expected in HELDOUT:
        try:
            started = time.perf_counter()
            result = reconstruct_sentence(tags, mode="offline")
            elapsed = (time.perf_counter() - started) * 1000
            got = result.get("english", "")
            print()
            print(f"  {tags}")
            print(f"    probes     : {probes}")
            print(f"    got        : {got!r}")
            print(f"    target     : {expected!r}")
            print(f"    latency    : {elapsed:,.0f} ms")
            HELDOUT_RESULTS.append((" ".join(tags), got, expected, elapsed))
        except Exception as exc:  # noqa: BLE001
            print()
            print(f"  {tags}")
            print(f"    UNEXPECTED : {type(exc).__name__}: {exc}")
            HELDOUT_RESULTS.append((" ".join(tags), f"ERROR: {exc}", expected, 0.0))

    # ── Direct engine call ──────────────────────────────────────────────────
    rule("3. Direct QwenEngine call (bypassing ConversationManager)")
    try:
        direct = engine.reconstruct_offline(["I", "WANT", "WATER"])
        print(f"    english    : {direct['english']!r}")
        print(f"    raw output : {direct['raw']!r}")
        print(f"    new tokens : {direct['new_tokens']}")
        print(f"    latency    : {direct['latency_ms']:,.0f} ms")
        print(f"    source     : {direct['source']}")
        keys_ok = {"english", "source", "latency_ms"} <= set(direct)
        print(f"    schema     : "
              f"{'OK - english/source/latency_ms present' if keys_ok else 'MISSING KEYS'}")
    except Exception as exc:  # noqa: BLE001
        print(f"    FAILED: {type(exc).__name__}: {exc}")

    # ── Degradation check ───────────────────────────────────────────────────
    rule("4. Tier degradation")
    empty = reconstruct_sentence([], mode="offline")
    print(f"    empty tags -> {empty['english']!r} "
          f"(source={empty['source']}, error={empty.get('error')})")
    try:
        reconstruct_sentence(["X"], mode="nonsense")
        print("    invalid mode -> NOT REJECTED (expected ValueError)")
    except ValueError as exc:
        print(f"    invalid mode -> correctly rejected: {exc}")

    # ── Summary ─────────────────────────────────────────────────────────────
    latencies = [ms for _, status, _, ms in RESULTS if status == "OK"]
    print("\n" + "=" * 74)
    print("  SUMMARY")
    print("-" * 74)
    print(f"  {'tags':<24} {'status':<10} {'ms':>8}   sentence")
    for tags, status, sentence, ms in RESULTS:
        print(f"  {tags:<24} {status:<10} {ms:>8,.0f}   {sentence}")
    if HELDOUT_RESULTS:
        print("-" * 74)
        print("  held-out (not in prompt):")
        for tags, got, target, ms in HELDOUT_RESULTS:
            print(f"  {tags:<24} {'':<10} {ms:>8,.0f}   {got}")
            print(f"  {'':<24} {'target':<10} {'':>8}   {target}")
    print("-" * 74)
    print(f"  model load        : {wall_ms:,.0f} ms")
    print(f"  weights in RAM    : ~{rss_after - rss_before:,.0f} MiB "
          f"(process RSS {rss_after:,.0f} MiB, peak {process_peak_rss_mb():,.0f} MiB)")
    if latencies:
        print(f"  inference latency : mean {sum(latencies) / len(latencies):,.0f} ms  "
              f"min {min(latencies):,.0f}  max {max(latencies):,.0f}")
    failures = [t for t, s, _, _ in RESULTS if s not in ("OK",)]
    print(f"  cases             : {len(latencies)}/{len(CASES)} via Qwen")
    print("=" * 74)

    if failures:
        print(f"\n  {len(failures)} case(s) did not use Qwen: {', '.join(failures)}")
        return 1
    print("\n  All cases reconstructed on device with no network.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\ninterrupted")
        sys.exit(130)
