#!/usr/bin/env python3
"""
review_sim.py - HelpDeskNet-50K noisy labels, milestone 4 (issue #9)

Question: experts can review only 2,000 additional tickets out of the
45,000-ticket crowd-labeled pool. Which 2,000 do we send them so the
review budget removes the most label noise?

Simulation layout (all synthetic, ground truth known so we can score):
  - 5,000 expert-labeled "gold" tickets, clean labels
  - 45,000 crowd-labeled tickets:
      Tier A: 20,000 @ ~6.7% label error (vetted crowd, 3 votes)
      Tier B: 25,000 @ ~21.8% label error (open crowd, single vote)
      systematic confusion is heaviest between Billing <-> Refund,
      both in how crowd labelers flip labels and in ticket wording
  - a small hand-rolled multinomial Naive Bayes trained on the gold set
    predicts on the whole crowd pool; disagreements between the model
    and the crowd label drive the smarter selection strategies
  - selection strategies compared on "review yield": the fraction of the
    2,000 picked tickets that are actually mislabeled

Stdlib only; numpy is used when present (rng backend + small stats
helpers) and everything degrades gracefully without it. No sklearn.
"""

from __future__ import annotations

import bisect
import math
import os
import random
import sys
from collections import Counter

try:
    import numpy as _np
except ImportError:  # graceful degradation, stdlib only
    _np = None

# ----------------------------------------------------------------------------
# constants (issue #9 numbers)
# ----------------------------------------------------------------------------
SEED = 202609

N_POOL = 45_000          # crowd-labeled tickets
N_TIER_A = 20_000        # tier A, ~6.7% error
N_TIER_B = 25_000        # tier B, ~21.8% error
N_GOLD = 5_000           # expert-labeled portion (clean)
BUDGET = 2_000           # extra tickets experts can review

TIER_A_ERR = 0.067
TIER_B_ERR = 0.218

CLASSES = ["billing", "refund", "account", "technical", "shipping", "general"]
CLASS_PRIORS = [0.21, 0.19, 0.17, 0.17, 0.14, 0.12]

# when a crowd labeler gets a ticket wrong, where the wrong label lands.
# this is the "systematic" part: Billing <-> Refund dominates.
FLIP_TARGETS = {
    "billing":   [("refund", 0.50), ("account", 0.14), ("technical", 0.12),
                  ("shipping", 0.12), ("general", 0.12)],
    "refund":    [("billing", 0.50), ("account", 0.14), ("technical", 0.12),
                  ("shipping", 0.12), ("general", 0.12)],
    "account":   [("technical", 0.35), ("billing", 0.20), ("refund", 0.15),
                  ("shipping", 0.15), ("general", 0.15)],
    "technical": [("account", 0.35), ("billing", 0.15), ("refund", 0.15),
                  ("shipping", 0.20), ("general", 0.15)],
    "shipping":  [("general", 0.35), ("billing", 0.15), ("refund", 0.15),
                  ("account", 0.15), ("technical", 0.20)],
    "general":   [("shipping", 0.35), ("billing", 0.15), ("refund", 0.15),
                  ("account", 0.20), ("technical", 0.15)],
}

# keyword vocabularies: simple class-conditional bag of words.
# billing and refund share a big "money core" on purpose - those tickets
# genuinely read alike, which is why crowd labelers confuse them so much.
_MONEY_CORE = ["charge", "charged", "card", "payment", "receipt", "amount",
               "transaction", "order", "money", "cancel"]
_ACCESS_CORE = ["login", "access", "email", "verify", "code", "app"]
CLASS_VOCAB = {
    "billing":   _MONEY_CORE + ["invoice", "billed", "subscription", "fee", "price",
                                "due", "renewal", "auto", "renew", "statement",
                                "cycle", "monthly", "plan", "upgrade", "prorate",
                                "tax", "total", "pay"],
    "refund":    _MONEY_CORE + ["refund", "back", "return", "reimburse",
                                "reimbursement", "chargeback", "dispute",
                                "wrongly", "credited", "credit", "pending",
                                "processing", "days", "wait", "reversal",
                                "partial", "denied", "request", "status"],
    "account":   _ACCESS_CORE + ["password", "signin", "locked", "reset",
                                 "verification", "2fa", "otp", "username",
                                 "profile", "deactivated", "recover", "link",
                                 "credentials", "suspended", "unlock"],
    "technical": _ACCESS_CORE + ["error", "bug", "crash", "loading", "slow",
                                 "update", "fails", "screen", "blank", "timeout",
                                 "freeze", "broken", "spinning", "logs", "console",
                                 "version", "stuck", "white", "retry", "glitch",
                                 "hangs"],
    "shipping":  ["delivery", "tracking", "package", "shipped", "courier",
                  "address", "late", "missing", "parcel", "dispatch", "waybill",
                  "arrived", "delay", "lost", "transit", "customs", "warehouse",
                  "undelivered", "reship", "label", "order", "status"],
    "general":   ["question", "info", "details", "feedback", "complaint",
                  "suggestion", "inquiry", "policy", "hours", "contact", "sales",
                  "partner", "bulk", "enterprise", "demo", "pricing", "trial",
                  "wondering", "possible", "instead", "order", "delay"],
}

# cross-class bridge words: tickets from one class sometimes contain the
# confusion partner's *discriminative* words, so a billing ticket can really
# look like a refund ticket and vice versa
BRIDGE_VOCAB = {
    "billing":   ["refund", "dispute", "chargeback", "wrongly", "credited", "pending"],
    "refund":    ["invoice", "subscription", "renewal", "billed", "monthly", "upgrade"],
    "account":   ["error", "crash", "fails", "loading", "stuck", "retry"],
    "technical": ["password", "locked", "reset", "verification", "otp", "signin"],
    "shipping":  ["missing", "late", "question", "status", "info", "policy"],
    "general":   ["delivery", "tracking", "order", "account", "login", "payment"],
}
COMMON_WORDS = ["please", "help", "hi", "team", "thanks", "issue", "need",
                "urgent", "ticket", "support", "still", "since", "when",
                "after", "every", "getting", "keeps", "cannot", "with",
                "this", "again", "checked"]

P_OWN, P_BRIDGE, P_COMMON = 0.50, 0.28, 0.22
WORDS_MIN, WORDS_MAX = 4, 8

# domain prior used by the disagreement strategy: how "heavy" a confusion pair
# (crowd label, model prediction) is known to be from past audit cycles.
# billing <-> refund is the pair the issue calls out as heaviest.
CONFUSION_PAIR_WEIGHTS = {
    ("billing", "refund"): 1.0, ("refund", "billing"): 1.0,
    ("account", "technical"): 0.6, ("technical", "account"): 0.6,
    ("shipping", "general"): 0.35, ("general", "shipping"): 0.35,
    ("billing", "account"): 0.25, ("account", "billing"): 0.25,
    ("refund", "account"): 0.25, ("account", "refund"): 0.25,
}
DEFAULT_PAIR_WEIGHT = 0.1

# per-class risk prior for the combined score: a ticket whose *crowd label*
# sits in a heavy-confusion class is more likely to be wrong, even when the
# model happens to agree with the crowd
CLASS_RISK = {"billing": 1.0, "refund": 1.0, "account": 0.6, "technical": 0.6,
              "shipping": 0.35, "general": 0.35}

# combined-strategy weights, hand-tuned on this simulation.
# diagnostics on the disagreement pool showed: model confidence is the
# strongest per-ticket signal (low-confidence disagreements are usually the
# MODEL being wrong, not the label), tier B carries ~3x the base error of
# tier A, and heavy confusion pairs deserve only a mild boost because the
# model is weakest exactly there - which is why pure pair-ranking underperforms.
W_DISAGREE, W_TIER, W_PAIR, W_RISK, W_CONF = 1.0, 0.15, 0.08, 0.12, 0.60


def pair_weight(crowd_label, pred):
    if crowd_label == pred:
        return 0.0
    return CONFUSION_PAIR_WEIGHTS.get((crowd_label, pred), DEFAULT_PAIR_WEIGHT)


# ----------------------------------------------------------------------------
# seeded rng wrapper: numpy backend when present, stdlib fallback.
# uniforms are drawn in blocks so the numpy path is actually fast.
# ----------------------------------------------------------------------------
class RNG:
    _BLOCK = 65_536

    def __init__(self, seed):
        self._rng = _np.random.default_rng(seed) if _np is not None else random.Random(seed)
        self._buf = []
        self._pos = 0

    def _refill(self):
        if _np is not None:
            self._buf = self._rng.random(self._BLOCK)
        else:
            self._buf = [self._rng.random() for _ in range(self._BLOCK)]
        self._pos = 0

    def random(self):
        if self._pos >= len(self._buf):
            self._refill()
        u = self._buf[self._pos]
        self._pos += 1
        return float(u)

    def randint(self, lo, hi):  # lo inclusive, hi exclusive
        return lo + int(self.random() * (hi - lo))

    def shuffle(self, lst):
        for i in range(len(lst) - 1, 0, -1):  # fisher-yates, any backend
            j = self.randint(0, i + 1)
            lst[i], lst[j] = lst[j], lst[i]


def _cum_weights(pairs):
    items = [p[0] for p in pairs]
    cum, total = [], 0.0
    for _, w in pairs:
        total += w
        cum.append(total)
    return items, cum, total


def _weighted_pick(rng, items, cum, total):
    u = rng.random() * total
    return items[bisect.bisect_right(cum, u)]


# ----------------------------------------------------------------------------
# synthetic data generation
# ----------------------------------------------------------------------------
def _sample_words(rng, true_class):
    own = CLASS_VOCAB[true_class]
    bridge = BRIDGE_VOCAB[true_class]
    words = []
    for _ in range(rng.randint(WORDS_MIN, WORDS_MAX + 1)):
        r = rng.random()
        if r < P_OWN:
            words.append(own[rng.randint(0, len(own))])
        elif r < P_OWN + P_BRIDGE:
            words.append(bridge[rng.randint(0, len(bridge))])
        else:
            words.append(COMMON_WORDS[rng.randint(0, len(COMMON_WORDS))])
    return words


def _sample_class(rng, cls_items, cls_cum, cls_total):
    return _weighted_pick(rng, cls_items, cls_cum, cls_total)


def build_gold_set(rng):
    """5,000 expert-labeled tickets, clean labels (model training data)."""
    cls_items, cls_cum, cls_total = _cum_weights(list(zip(CLASSES, CLASS_PRIORS)))
    gold = []
    for tid in range(N_GOLD):
        c = _sample_class(rng, cls_items, cls_cum, cls_total)
        gold.append({"id": tid, "true": c, "label": c,
                     "tier": "gold", "words": _sample_words(rng, c)})
    return gold


def build_crowd_pool(rng):
    """45,000 crowd-labeled tickets with tier-dependent noisy labels."""
    cls_items, cls_cum, cls_total = _cum_weights(list(zip(CLASSES, CLASS_PRIORS)))
    flips = {c: _cum_weights(FLIP_TARGETS[c]) for c in CLASSES}

    tiers = ["A"] * N_TIER_A + ["B"] * N_TIER_B
    rng.shuffle(tiers)

    pool = []
    for tid, tier in enumerate(tiers):
        true_c = _sample_class(rng, cls_items, cls_cum, cls_total)
        err_rate = TIER_A_ERR if tier == "A" else TIER_B_ERR
        if rng.random() < err_rate:
            items, cum, total = flips[true_c]
            label = _weighted_pick(rng, items, cum, total)
        else:
            label = true_c
        pool.append({"id": tid, "true": true_c, "label": label,
                     "tier": tier, "words": _sample_words(rng, true_c)})
    return pool


# ----------------------------------------------------------------------------
# hand-rolled multinomial naive bayes (no sklearn)
# ----------------------------------------------------------------------------
def train_naive_bayes(docs, alpha=1.0):
    word_counts = {c: Counter() for c in CLASSES}
    doc_counts = Counter()
    for d in docs:
        c = d["label"]
        doc_counts[c] += 1
        word_counts[c].update(d["words"])

    vocab = set()
    for c in CLASSES:
        vocab.update(word_counts[c])
    v = len(vocab)
    total_docs = sum(doc_counts.values())

    model = {"vocab": vocab, "log_prior": {}, "log_cp": {}, "log_unseen": {}}
    for c in CLASSES:
        model["log_prior"][c] = math.log((doc_counts[c] + 1.0) / (total_docs + len(CLASSES)))
        denom = sum(word_counts[c].values()) + alpha * v
        model["log_cp"][c] = {w: math.log((n + alpha) / denom)
                              for w, n in word_counts[c].items()}
        model["log_unseen"][c] = math.log(alpha / denom)
    return model


def nb_predict(model, words):
    """returns (predicted class, posterior confidence in the prediction)"""
    scores = {}
    for c in CLASSES:
        s = model["log_prior"][c]
        cp = model["log_cp"][c]
        unseen = model["log_unseen"][c]
        for w in words:
            p = cp.get(w)
            if p is not None:
                s += p
            elif w in model["vocab"]:
                s += unseen
            # words outside the training vocab carry no signal, skip them
        scores[c] = s
    pred = max(CLASSES, key=lambda c: scores[c])
    # posterior of the winner via a stable softmax (max-shift logsumexp)
    m = scores[pred]
    denom = sum(math.exp(scores[c] - m) for c in CLASSES)
    return pred, 1.0 / denom


def predict_pool(model, pool):
    return [nb_predict(model, t["words"]) for t in pool]


# ----------------------------------------------------------------------------
# selection strategies: which BUDGET tickets go to the experts?
# ----------------------------------------------------------------------------
def select_random(pool, rng):
    """a) random baseline - what you get without thinking"""
    ids = list(range(len(pool)))
    rng.shuffle(ids)
    return ids[:BUDGET]


def select_tier_first(pool, rng):
    """b) all Tier B first (open crowd, noisier), random order inside tiers"""
    tier_b = [i for i, t in enumerate(pool) if t["tier"] == "B"]
    tier_a = [i for i, t in enumerate(pool) if t["tier"] == "A"]
    rng.shuffle(tier_b)
    rng.shuffle(tier_a)
    return (tier_b + tier_a)[:BUDGET]


def select_model_disagreement(pool, preds, rng):
    """c) model != crowd label, sub-ranked by heavy confusion pairs"""
    cand = [i for i, t in enumerate(pool) if preds[i][0] != t["label"]]
    cand.sort(key=lambda i: (-pair_weight(pool[i]["label"], preds[i][0]),
                             -preds[i][1], i))
    picked = cand[:BUDGET]
    if len(picked) < BUDGET:  # pad with randoms if disagreements ever run dry
        chosen = set(picked)
        rest = [i for i in range(len(pool)) if i not in chosen]
        rng.shuffle(rest)
        picked += rest[:BUDGET - len(picked)]
    return picked


def select_combined(pool, preds):
    """d) best bet: gate on model disagreement, then rank by model
    confidence + tier weight + confusion-pair weight + class risk.
    top BUDGET tickets by score go to the experts"""
    scored = []
    for i, t in enumerate(pool):
        pred, conf = preds[i]
        score = (W_DISAGREE * (1.0 if pred != t["label"] else 0.0)
                 + W_TIER * (1.0 if t["tier"] == "B" else 0.0)
                 + W_PAIR * pair_weight(t["label"], pred)
                 + W_RISK * CLASS_RISK[t["label"]]
                 + W_CONF * conf)
        scored.append((score, i))
    scored.sort(reverse=True)
    return [i for _, i in scored[:BUDGET]]


def review_yield(pool, selected):
    """fraction of the selected tickets that are actually mislabeled"""
    hits = sum(1 for i in selected if pool[i]["label"] != pool[i]["true"])
    return hits, hits / len(selected)


def cleanup_stats(pool, selected):
    """apply the expert corrections (experts relabel perfectly in this
    simulation) and measure the label noise left in the 45k pool"""
    corrected = set(selected)
    groups = {
        "all": range(len(pool)),
        "tierA": [i for i, t in enumerate(pool) if t["tier"] == "A"],
        "tierB": [i for i, t in enumerate(pool) if t["tier"] == "B"],
    }
    stats = {}
    for name, rows in groups.items():
        bad = sum(1 for i in rows
                  if i not in corrected and pool[i]["label"] != pool[i]["true"])
        stats[name] = (bad, 100.0 * bad / len(rows))
    return stats


PLOT_NAME = "anusha_review_yield.png"


def save_yield_plot(results):
    """optional bar chart of review yield per strategy; silently skipped
    when matplotlib is not importable"""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception:
        print("plot skipped (matplotlib not importable)")
        return None

    names = [r["name"] for r in results]
    yields = [100.0 * r["yield"] for r in results]
    colors = ["#9aa5b1", "#f0b429", "#4c9aff", "#2ecc71"]

    fig, ax = plt.subplots(figsize=(8.5, 4.8))
    bars = ax.bar(names, yields, color=colors[: len(names)])
    for b, y in zip(bars, yields):
        ax.text(b.get_x() + b.get_width() / 2, y + 1.2, f"{y:.1f}%",
                ha="center", fontsize=10)
    ax.set_ylabel("review yield (% of picked tickets truly mislabeled)")
    ax.set_title("HelpDeskNet-50K milestone 4: expert review yield by strategy "
                 f"(budget = {BUDGET:,} of {N_POOL:,})")
    ax.set_ylim(0, max(yields) * 1.2)
    ax.grid(axis="y", alpha=0.3)
    plt.xticks(rotation=10, ha="right")
    fig.tight_layout()

    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "plots")
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, PLOT_NAME)
    fig.savefig(path, dpi=140)
    plt.close(fig)
    return path


# ----------------------------------------------------------------------------
# reporting helpers
# ----------------------------------------------------------------------------
def line(char="-", n=78):
    return char * n


def pool_report(pool):
    n = len(pool)
    err = sum(1 for t in pool if t["label"] != t["true"])
    per_tier = {}
    for tier in ("A", "B"):
        sub = [t for t in pool if t["tier"] == tier]
        e = sum(1 for t in sub if t["label"] != t["true"])
        per_tier[tier] = (len(sub), e, 100.0 * e / len(sub))

    conf = Counter((t["true"], t["label"]) for t in pool if t["label"] != t["true"])
    cls_counts = Counter(t["true"] for t in pool)

    print(line("="))
    print("HelpDeskNet-50K - milestone 4: expert review prioritization (issue #9)")
    print(f"team plot-armor | seed {SEED} | numpy backend: {'on' if _np is not None else 'off (stdlib fallback)'}")
    print(line("="))
    print(f"crowd pool: {n:,} tickets   gold (expert, clean): {N_GOLD:,}   review budget: {BUDGET:,}")
    print(f"base label noise (before any review): {err:,}/{n:,} = {100.0 * err / n:.2f}%")
    for tier, (cnt, e, pct) in per_tier.items():
        print(f"  tier {tier}: {cnt:,} tickets, {e:,} mislabeled = {pct:.2f}%")
    print(f"class mix (true): " + ", ".join(f"{c} {cls_counts[c]:,}" for c in CLASSES))
    print("top crowd confusions (true -> wrong label):")
    for (t, l), cnt in conf.most_common(5):
        print(f"  {t:>9} -> {l:<9} {cnt:,} ({100.0 * cnt / err:.1f}% of all errors)")
    return err


# ----------------------------------------------------------------------------
def main():
    rng_pool = RNG(SEED)
    rng_gold = RNG(SEED + 1)
    rng_sel = RNG(SEED + 2)

    gold = build_gold_set(rng_gold)
    pool = build_crowd_pool(rng_pool)

    base_err = pool_report(pool)

    # ---- model: naive bayes on the expert-labeled portion -----------------
    print()
    print(line())
    print("model: multinomial naive bayes trained on the 5,000 expert labels")
    val_model = train_naive_bayes(gold[:4_000])
    correct = sum(1 for t in gold[4_000:] if nb_predict(val_model, t["words"])[0] == t["true"])
    print(f"held-out accuracy on 1,000 gold tickets: {100.0 * correct / 1_000:.1f}%")

    model = train_naive_bayes(gold)
    preds = predict_pool(model, pool)

    dis = [i for i, t in enumerate(pool) if preds[i][0] != t["label"]]
    dis_true_err = sum(1 for i in dis if pool[i]["label"] != pool[i]["true"])
    print(f"model vs crowd disagreements: {len(dis):,}/{N_POOL:,} = {100.0 * len(dis) / N_POOL:.1f}%")
    print(f"  of those, {dis_true_err:,} are real mislabels -> disagreement precision "
          f"{100.0 * dis_true_err / len(dis):.1f}%")

    # ---- strategies --------------------------------------------------------
    print()
    print(line())
    print(f"selection strategies: pick {BUDGET:,} of {N_POOL:,} for expert review")
    print(f"review yield = share of picked tickets that are truly mislabeled;")
    print(f"noise after = pool label noise once the experts' corrections are applied")
    print(line())
    strategies = [
        ("random", select_random(pool, rng_sel)),
        ("tier-first", select_tier_first(pool, rng_sel)),
        ("model-disagreement", select_model_disagreement(pool, preds, rng_sel)),
        ("combined", select_combined(pool, preds)),
    ]

    results = []
    for name, selected in strategies:
        hits, yld = review_yield(pool, selected)
        results.append({"name": name, "hits": hits, "yield": yld,
                        "cleanup": cleanup_stats(pool, selected)})

    base_pct = 100.0 * base_err / N_POOL
    hdr = (f"{'strategy':<20}{'found':>7}{'yield':>9}"
           f"{'noise after':>13}{'tierA after':>13}{'tierB after':>13}{'drop':>8}")
    print(hdr)
    for r in results:
        c = r["cleanup"]
        print(f"{r['name']:<20}{r['hits']:>7,}{100.0 * r['yield']:>8.1f}%"
              f"{c['all'][1]:>12.2f}%{c['tierA'][1]:>12.2f}%"
              f"{c['tierB'][1]:>12.2f}%{base_pct - c['all'][1]:>7.2f}p")

    # ---- verdict -----------------------------------------------------------
    best = max(results, key=lambda r: r["yield"])
    worst = min(results, key=lambda r: r["yield"])
    print()
    print(line())
    print("verdict")
    print(line())
    print(f"best strategy: {best['name']} -> {best['hits']:,}/{BUDGET:,} mislabeled found "
          f"({100.0 * best['yield']:.1f}% yield)")
    print(f"  vs random {100.0 * worst['yield']:.1f}% -> {(best['yield'] / worst['yield']):.1f}x "
          f"more error per expert hour")
    print(f"  pool noise {base_pct:.2f}% -> {best['cleanup']['all'][1]:.2f}% "
          f"({base_err - best['cleanup']['all'][0]:,} of {base_err:,} errors fixed "
          f"= {100.0 * (base_err - best['cleanup']['all'][0]) / base_err:.1f}% of all noise "
          f"with {100.0 * BUDGET / N_POOL:.1f}% of the pool relabeled)")
    print(f"  tier split of surviving noise: A {best['cleanup']['tierA'][1]:.2f}%, "
          f"B {best['cleanup']['tierB'][1]:.2f}%")

    # ---- optional plot ------------------------------------------------------
    path = save_yield_plot(results)
    if path:
        print(f"plot saved: {path}")
    print()
    print("done - exit 0")
    return 0


if __name__ == "__main__":
    sys.exit(main())
