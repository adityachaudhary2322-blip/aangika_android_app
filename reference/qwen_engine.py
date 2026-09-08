"""
Offline sentence reconstruction with Qwen2.5-0.5B-Instruct.

When the device has no network, the language layer must still produce a real
sentence rather than a bag of words. This module is that fallback: a ~0.5 B
instruct model, small enough to sit in RAM next to the ONNX tagger, that turns
["I", "WANT", "WATER"] into "I want water."

Design notes
------------
* Lazy singleton. The weights are ~1 GB and take seconds to load, so nothing is
  touched until the first reconstruction actually needs it. Loading is guarded
  by a lock so two threads cannot race the same load.
* Greedy decoding, short cap. This is a grammar-repair task with one right
  answer, not a creative one -- sampling only adds variance and latency.
* Aggressive post-processing. A 0.5 B model ignores "output only the sentence"
  often enough that we cannot trust it; [_clean] strips preambles, quotes,
  markdown and multi-line rambling down to a single sentence.
* Raises [QwenUnavailable] rather than returning garbage. The caller
  (ConversationManager) treats that as "drop to the rule-based join".
"""

from __future__ import annotations

import ctypes
import logging
import os
import re
import threading
import time
from typing import Any

logger = logging.getLogger("llm.qwen_engine")

MODEL_ID = os.getenv("QWEN_MODEL_ID") or "Qwen/Qwen2.5-0.5B-Instruct"
SOURCE_NAME = "qwen2.5-0.5b"

# ISL is not word-order-shuffled English. It is topic-comment, drops the
# first-person subject, marks tense with a leading time word, and puts the verb
# late. A 0.5 B model applies English defaults unless told otherwise, which is
# how "DOCTOR HELP NEED" became "Doctor needs help." -- grammatical, and exactly
# backwards. These priors exist to correct that specific class of error.
SYSTEM_PROMPT = (
    "You are an ISL (Indian Sign Language) translation assistant.\n"
    "ISL frequently omits first-person pronouns ('I', 'me', 'my'). Unless "
    "another subject is explicitly stated, default to first-person 'I'.\n"
    "An explicit subject includes pronouns ('he', 'she', 'they'), specific "
    "names, kinship nouns ('MOTHER', 'FATHER', 'BROTHER', 'SISTER', 'FRIEND'), "
    "and other nouns naming a person who acts. When such a word is present it "
    "IS the subject and must NEVER be replaced by 'I'. Render kinship nouns "
    "possessively where natural ('MOTHER' -> 'my mother').\n"
    "Time words (e.g., 'TOMORROW', 'YESTERDAY') establish tense: 'TOMORROW' "
    "implies future tense ('I will...'), 'YESTERDAY' implies past tense "
    "('I went...'). Never combine a past time word with a future verb.\n"
    "Medical/emergency signs like 'DOCTOR HELP NEED' represent the signer's "
    "need: translate as 'I need doctor's help' or 'I need a doctor'.\n"
    "Do not hallucinate extra actions (e.g., do not add 'drink' to "
    "'WANT WATER').\n"
    "Output ONLY the final, grammatically correct English sentence."
)

# Few-shot demonstrations, supplied as real chat turns rather than pasted into
# the system message. Instruct models are tuned on multi-turn transcripts, so a
# worked user/assistant pair steers a 0.5 B model far more reliably than the
# same text described inside a system prompt.
#
# NOTE: anything demonstrated here is no longer evidence of generalisation.
# Passing a case that appears below proves the prompt is being followed, not
# that the model reasons about it -- that is what the held-out cases in
# scripts/test_offline_qwen.py are for.
#
# The last two pairs exist because the first three were not enough. With only
# TOMORROW demonstrated, the model learned "time word => will" and produced
# "I will go to the market yesterday."; with only pronouns listed as subjects,
# it dropped MOTHER and said "I will go to the hospital yesterday." One example
# of each corrects both.
FEW_SHOT: tuple[tuple[str, str], ...] = (
    ("I, WANT, WATER", "I want water."),
    ("TOMORROW, COLLEGE, GO", "I will go to college tomorrow."),
    ("DOCTOR, HELP, NEED", "I need a doctor's help."),
    ("YESTERDAY, MARKET, GO", "I went to the market yesterday."),
    ("MOTHER, HOSPITAL, YESTERDAY, GO",
     "My mother went to the hospital yesterday."),
)

# A sign sentence is short. 32 new tokens is generous for "I want water." and
# keeps worst-case CPU latency bounded when the model decides to ramble.
MAX_NEW_TOKENS = 32


def build_messages(tags: list[str]) -> list[dict]:
    """System prompt + few-shot turns + the real request."""
    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for signs, sentence in FEW_SHOT:
        messages.append({"role": "user", "content": signs})
        messages.append({"role": "assistant", "content": sentence})
    messages.append({"role": "user", "content": ", ".join(tags)})
    return messages


class QwenUnavailable(RuntimeError):
    """The offline model could not be loaded or could not produce output."""


# ── Memory helpers (Windows-safe, no psutil dependency) ──────────────────────

if os.name == "nt":
    class _PROCESS_MEMORY_COUNTERS(ctypes.Structure):
        _fields_ = [
            ("cb", ctypes.c_ulong),
            ("PageFaultCount", ctypes.c_ulong),
            ("PeakWorkingSetSize", ctypes.c_size_t),
            ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
            ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t),
            ("PeakPagefileUsage", ctypes.c_size_t),
        ]


def _win_memory_counters() -> "_PROCESS_MEMORY_COUNTERS | None":
    """Query this process's memory counters, or None on failure.

    argtypes/restype must be declared: without them ctypes truncates the
    GetCurrentProcess pseudo-handle (-1) to a 32-bit int and the call silently
    fails, reporting 0 bytes used.
    """
    import ctypes.wintypes as wintypes

    get_current_process = ctypes.windll.kernel32.GetCurrentProcess
    get_current_process.restype = wintypes.HANDLE
    get_current_process.argtypes = []

    for library, symbol in (("psapi", "GetProcessMemoryInfo"),
                            ("kernel32", "K32GetProcessMemoryInfo")):
        try:
            fn = getattr(getattr(ctypes.windll, library), symbol)
        except (AttributeError, OSError):
            continue
        fn.argtypes = [wintypes.HANDLE,
                       ctypes.POINTER(_PROCESS_MEMORY_COUNTERS),
                       ctypes.c_ulong]
        fn.restype = ctypes.c_int

        counters = _PROCESS_MEMORY_COUNTERS()
        counters.cb = ctypes.sizeof(_PROCESS_MEMORY_COUNTERS)
        if fn(get_current_process(), ctypes.byref(counters), counters.cb):
            return counters
    return None


def process_rss_mb() -> float:
    """Resident set size of this process in MiB, or 0.0 if unavailable."""
    try:
        if os.name == "nt":
            counters = _win_memory_counters()
            return counters.WorkingSetSize / (1024 * 1024) if counters else 0.0
        import resource  # POSIX only
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # Linux reports KiB; macOS reports bytes.
        return peak / (1024 * 1024) if peak > 1 << 30 else peak / 1024
    except Exception:
        return 0.0


def process_peak_rss_mb() -> float:
    """Peak resident set size in MiB, or 0.0 if unavailable."""
    try:
        if os.name == "nt":
            counters = _win_memory_counters()
            return counters.PeakWorkingSetSize / (1024 * 1024) if counters else 0.0
        import resource
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return peak / (1024 * 1024) if peak > 1 << 30 else peak / 1024
    except Exception:
        return 0.0


def available_ram_mb() -> float:
    """Free physical RAM in MiB, or 0.0 if it cannot be determined."""
    try:
        if os.name == "nt":
            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            status = MEMORYSTATUSEX()
            status.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status))
            return status.ullAvailPhys / (1024 * 1024)
        with open("/proc/meminfo") as handle:
            for line in handle:
                if line.startswith("MemAvailable:"):
                    return float(line.split()[1]) / 1024
        return 0.0
    except Exception:
        return 0.0


# ── Engine ───────────────────────────────────────────────────────────────────

class QwenEngine:
    """Lazy singleton wrapper around Qwen2.5-0.5B-Instruct."""

    _instance: "QwenEngine | None" = None
    _instance_lock = threading.Lock()

    def __init__(self, model_id: str = MODEL_ID) -> None:
        self.model_id = model_id
        self._model: Any = None
        self._tokenizer: Any = None
        self._load_lock = threading.Lock()

        self.device: str = "cpu"
        self.dtype_name: str = "float32"
        self.load_time_ms: float = 0.0
        self.rss_after_load_mb: float = 0.0
        self.load_error: str | None = None

    # ── Singleton access ─────────────────────────────────────────────────────

    @classmethod
    def get(cls, model_id: str = MODEL_ID) -> "QwenEngine":
        """Return the shared engine, creating (but not loading) it if needed."""
        with cls._instance_lock:
            if cls._instance is None or cls._instance.model_id != model_id:
                cls._instance = cls(model_id)
            return cls._instance

    @classmethod
    def reset(cls) -> None:
        """Drop the singleton and free its weights. Mainly for tests."""
        with cls._instance_lock:
            if cls._instance is not None:
                cls._instance.unload()
            cls._instance = None

    @property
    def is_loaded(self) -> bool:
        return self._model is not None and self._tokenizer is not None

    # ── Loading ──────────────────────────────────────────────────────────────

    def _select_device_and_dtype(self) -> tuple[str, Any]:
        """Pick the fastest safe (device, dtype) pair for this machine.

        CPU stays float32 deliberately: torch's CPU kernels are tuned for fp32,
        and bf16 without AMX support is usually slower, not faster. Half
        precision is only a win when a CUDA device is actually present.
        """
        import torch

        if torch.cuda.is_available():
            if torch.cuda.is_bf16_supported():
                return "cuda", torch.bfloat16
            return "cuda", torch.float16
        return "cpu", torch.float32

    def load(self) -> None:
        """Load tokenizer and weights. Idempotent; safe to call concurrently."""
        if self.is_loaded:
            return

        with self._load_lock:
            if self.is_loaded:
                return

            started = time.perf_counter()
            try:
                import torch
                from transformers import AutoModelForCausalLM, AutoTokenizer
            except ImportError as exc:
                self.load_error = f"transformers/torch unavailable: {exc}"
                raise QwenUnavailable(self.load_error) from exc

            device, dtype = self._select_device_and_dtype()
            self.device = device
            self.dtype_name = str(dtype).replace("torch.", "")

            free_mb = available_ram_mb()
            logger.info(
                "loading %s on %s/%s (%.0f MiB RAM free)",
                self.model_id, device, self.dtype_name, free_mb
            )

            try:
                self._tokenizer = AutoTokenizer.from_pretrained(self.model_id)

                # transformers 5.x renamed torch_dtype -> dtype. Support both so
                # this file works across the 4.x/5.x boundary.
                try:
                    self._model = AutoModelForCausalLM.from_pretrained(
                        self.model_id, dtype=dtype, low_cpu_mem_usage=True
                    )
                except TypeError:
                    self._model = AutoModelForCausalLM.from_pretrained(
                        self.model_id, torch_dtype=dtype, low_cpu_mem_usage=True
                    )

                self._model.to(device)
                self._model.eval()
            except Exception as exc:
                self._model = None
                self._tokenizer = None
                self.load_error = f"{type(exc).__name__}: {exc}"
                raise QwenUnavailable(
                    f"could not load {self.model_id}: {self.load_error}"
                ) from exc

            self.load_time_ms = (time.perf_counter() - started) * 1000
            self.rss_after_load_mb = process_rss_mb()
            self.load_error = None
            logger.info(
                "loaded in %.0f ms, RSS %.0f MiB",
                self.load_time_ms, self.rss_after_load_mb
            )

    def unload(self) -> None:
        """Release the weights."""
        with self._load_lock:
            self._model = None
            self._tokenizer = None
            try:
                import gc
                import torch
                gc.collect()
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass

    def warmup(self) -> None:
        """Load and run one throwaway generation, so the first real call is fast."""
        self.load()
        try:
            self.reconstruct_offline(["I", "WANT", "WATER"])
        except Exception as exc:
            logger.warning("warmup generation failed: %s", exc)

    # ── Inference ────────────────────────────────────────────────────────────

    def reconstruct_offline(self, tags: list[str]) -> dict:
        """Turn sign tags into one English sentence, entirely on device.

        Returns {"english": str, "source": "qwen2.5-0.5b", "latency_ms": float}
        plus diagnostics. Raises [QwenUnavailable] if the model cannot run --
        the caller is expected to drop to the rule-based join.
        """
        started = time.perf_counter()

        if not tags:
            return {
                "english": "",
                "source": SOURCE_NAME,
                "latency_ms": round((time.perf_counter() - started) * 1000, 1),
                "raw": "",
                "device": self.device,
                "error": "no tags supplied",
            }

        self.load()  # no-op when already loaded

        import torch

        messages = build_messages(tags)

        try:
            prompt = self._tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
            inputs = self._tokenizer([prompt], return_tensors="pt").to(self.device)

            with torch.no_grad():
                generated = self._model.generate(
                    **inputs,
                    max_new_tokens=MAX_NEW_TOKENS,
                    do_sample=False,          # grammar repair has one right answer
                    num_beams=1,
                    repetition_penalty=1.05,
                    pad_token_id=self._tokenizer.pad_token_id
                    or self._tokenizer.eos_token_id,
                )

            # Keep only the newly generated continuation.
            new_tokens = generated[0][inputs["input_ids"].shape[-1]:]
            raw = self._tokenizer.decode(new_tokens, skip_special_tokens=True)
        except Exception as exc:
            raise QwenUnavailable(
                f"generation failed: {type(exc).__name__}: {exc}"
            ) from exc

        sentence = _clean(raw, tags)
        latency_ms = round((time.perf_counter() - started) * 1000, 1)

        return {
            "english": sentence,
            "source": SOURCE_NAME,
            "latency_ms": latency_ms,
            "raw": raw.strip(),
            "device": f"{self.device}/{self.dtype_name}",
            "new_tokens": int(len(new_tokens)),
        }


# ── Output cleanup ───────────────────────────────────────────────────────────

_PREAMBLE = re.compile(
    r"^\s*(?:sure|certainly|of course|here(?:'s| is)(?: the)?"
    r"(?: reconstructed| corrected| final)?(?: sentence)?|"
    r"the (?:reconstructed |corrected |final )?sentence(?: is)?|"
    r"answer|output|result)\s*[:\-]?\s*",
    re.IGNORECASE,
)


def _clean(raw: str, tags: list[str]) -> str:
    """Reduce a small model's chatty output to one clean sentence.

    A 0.5 B model ignores "output only the sentence" often enough that this is
    not optional. If nothing survives, fall back to the deterministic join so a
    caller always gets a usable string.
    """
    text = (raw or "").strip()

    # Drop markdown fences and stray formatting.
    text = re.sub(r"^```[a-z]*\s*|\s*```$", "", text, flags=re.IGNORECASE).strip()
    text = text.replace("**", "").replace("__", "")

    # First non-empty line only -- the model often adds commentary underneath.
    for line in text.splitlines():
        if line.strip():
            text = line.strip()
            break

    text = _PREAMBLE.sub("", text).strip()

    # Strip symmetric wrapping quotes.
    if len(text) >= 2 and text[0] in "\"'“‘" and text[-1] in "\"'”’":
        text = text[1:-1].strip()

    # Keep only the first sentence.
    match = re.search(r"^(.*?[.!?])(?:\s|$)", text)
    if match:
        text = match.group(1).strip()

    if not text:
        # Deterministic last resort, identical to the rule-based path.
        return " ".join(tags).capitalize() + "."

    text = text[0].upper() + text[1:]
    if text[-1] not in ".!?":
        text += "."
    return text


# ── Module-level convenience ─────────────────────────────────────────────────

def reconstruct_offline(tags: list[str]) -> dict:
    """Reconstruct via the shared singleton engine."""
    return QwenEngine.get().reconstruct_offline(tags)


def warmup() -> None:
    """Preload the shared engine."""
    QwenEngine.get().warmup()
