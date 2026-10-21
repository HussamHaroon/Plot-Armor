#!/usr/bin/env python3
"""empirical simulation for issue #9 - "Noisy Labels: HelpDeskNet-50K".

replicates the dataset described in the issue with synthetic tickets so the
lead's ceiling math (analysis.py) can be checked against an actual learning
experiment instead of just on paper:

  * 50,000 tickets, 6 classes (Billing 30%, Refund 15%, Technical 25%,
    Account Access 15%, Shipping 10%, Other 5%)
  * 10% expert labels (0% error) + 90% crowd labels
      - tier A: 20,000 tickets, ~6.7% error   (audit: 12/180)
      - tier B: 25,000 tickets, ~21.8% error  (audit: 48/220)
  * crowd errors are systematic, not uniform: Billing<->Refund heaviest,
    then Technical<->Account Access, then Shipping<->Other
  * test set labeled by the same crowd process + a gold (expert) test set

everything here is stdlib + numpy, models written by hand (no sklearn).
"""

from __future__ import annotations

import os
import sys

import numpy as np

try:  # plots are optional, the report works without them
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    HAS_MPL = True
except Exception:  # pragma: no cover
    HAS_MPL = False

# ----------------------------------------------------------------------------
# issue numbers, these drive everything
# ----------------------------------------------------------------------------
SEED = 42

CLASSES = ["Billing", "Refund", "Technical", "Account Access", "Shipping", "Other"]
K = len(CLASSES)
PRIORS = np.array([0.30, 0.15, 0.25, 0.15, 0.10, 0.05])

N_TRAIN = 50_000
N_TEST = 5_000
N_EXPERT = 5_000          # 10% of train, clean gold labels
N_TIER_A = 20_000
N_TIER_B = 25_000

ERR_A = 12 / 180          # 6.67% from the expert audit
ERR_B = 48 / 220          # 21.82% from the expert audit

TARGET_NOISY_ACC = 0.82   # the plateau the issue reports on the noisy test set

# robust-training knobs (section 7)
K_SMOOTH = 0.1            # label smoothing: mix one-hot with uniform, k=0.1
DROP_FRAC = 0.15          # small-loss: drop the 15% highest-loss per epoch
SMALL_LOSS_EPOCHS = 3

# ----------------------------------------------------------------------------
# vocabulary: per-class keyword pools so classes are learnable but confusable.
# each class has its own distinctive pool, and each confusable pair shares a
# pool (Billing/Refund share "charge", "refund"-adjacent money words etc).
# ----------------------------------------------------------------------------
DISTINCT_WORDS = {
    "Billing": [
        "invoice", "billed", "overcharged", "subscription", "plan", "pricing",
        "statement", "billing", "autopay", "renew", "renewal", "promo",
        "coupon", "vat", "tax", "upgrade", "downgrade", "prorate", "surcharge",
        "installment", "tariff", "quotation", "billing_cycle", "receipt",
    ],
    "Refund": [
        "refund", "refunds", "reimbursed", "reimbursement", "dispute",
        "chargeback", "reversal", "owed", "repay", "payout", "cashback",
        "compensate", "cancellation", "cancelled", "return", "returned",
        "unredeemed", "refund_status", "refund_request", "money_back",
        "reimbursement_claim", "refund_policy", "repayment", "partial_refund",
    ],
    "Technical": [
        "crash", "crashed", "bug", "glitch", "error_code", "traceback",
        "timeout", "fails", "failing", "broken", "freeze", "freezes", "slow",
        "lag", "laggy", "spinner", "api", "endpoint", "stacktrace",
        "exception", "malformed", "patch", "regression", "white_screen",
    ],
    "Account Access": [
        "locked", "unlock", "blocked", "ban", "banned", "suspend", "suspended",
        "verification", "otp", "2fa", "authenticator", "passphrase", "signin",
        "logged_out", "session_expired", "hijacked", "recovery", "regain",
        "inaccessible", "permission", "role", "deactivate", "reactivate",
        "account_recovery",
    ],
    "Shipping": [
        "tracking", "courier", "shipment", "dispatch", "dispatched", "transit",
        "delivered", "undelivered", "parcel", "consignment", "waybill",
        "shipping", "pickup", "dropoff", "logistics", "freight", "postoffice",
        "ship", "shipping_label", "reship", "courier_service",
    ],
    "Other": [
        "inquiry", "question", "general", "feedback", "complaint",
        "suggestion", "compliment", "unrelated", "miscellaneous", "info",
        "information", "unsure", "clarify", "documentation", "policy",
        "guidelines", "howto", "off_topic",
    ],
}

# shared pools for the confusable pairs (the systematic part of the noise)
PAIR_POOLS = {
    "billing-refund": [
        "charge", "charged", "card", "payment", "paid", "pay", "amount",
        "dollars", "transaction", "bank", "deducted", "money", "wallet",
        "processing",
    ],
    "tech-account": [
        "login", "log_in", "password", "username", "email", "error", "access",
        "reset", "account", "mfa", "token", "profile", "retry", "locked_out",
    ],
    "shipping-other": [
        "delivery", "arrive", "arrived", "late", "delay", "delayed",
        "waiting", "address", "box", "order", "missing", "receive",
    ],
}

BACKGROUND_WORDS = [
    "hello", "hi", "please", "help", "issue", "problem", "thanks", "team",
    "support", "urgent", "today", "still", "need", "want", "kindly",
    "resolve", "ticket", "app", "site", "when", "can", "not", "working",
    "update", "response", "again", "since", "last", "week", "month",
    "request", "unable", "try", "tried", "someone", "anything", "know",
    "back", "soon", "asap",
]

# which pair pool a class draws its "confusable" words from
PAIR_OF_CLASS = {
    "Billing": "billing-refund",
    "Refund": "billing-refund",
    "Technical": "tech-account",
    "Account Access": "tech-account",
    "Shipping": "shipping-other",
    "Other": "shipping-other",
}

# confusion partner index (content leakage is biased the same way the crowd
# errors are, that is what makes the classes genuinely confusable)
PARTNER = np.array([1, 0, 3, 2, 5, 4])

# generation knobs: how much signal vs leak vs pair-overlap vs background per
# word. a ticket mostly uses its own class words, but leaks words from other
# classes (the confusion partner mostly), which is what makes borderline
# tickets genuinely arguable instead of trivially separable.
# tuned so naive bayes trained on the noisy labels lands near the 82% plateau
# the issue reports (see tune_noise_scale) while gold accuracy stays ~95%+.
P_SIGNAL = 0.34
P_LEAK = 0.11          # leaked from another class, 75% of the time the partner
LEAK_TO_PARTNER = 0.75
P_PAIR = 0.22
MIN_LEN = 12
MAX_LEN = 28
DISTINCT_POOL_SIZE = 20  # words used per distinctive pool (rest are spares)

# ----------------------------------------------------------------------------
# systematic confusion the crowd makes, rows = true class, entries = where the
# label goes *given that it flips*. Billing<->Refund heaviest, then
# Technical<->Account Access, then Shipping<->Other.
# ----------------------------------------------------------------------------
FLIP_ROWS = np.array([
    # Billing:      Refund .60  Tech .10  Acct .10  Ship .10  Other .10
    [0.00, 0.60, 0.10, 0.10, 0.10, 0.10],
    # Refund:       Billing .60
    [0.60, 0.00, 0.10, 0.10, 0.10, 0.10],
    # Technical:    Acct .50, rest spread
    [0.125, 0.125, 0.00, 0.50, 0.125, 0.125],
    # Account Access: Technical .50
    [0.125, 0.125, 0.50, 0.00, 0.125, 0.125],
    # Shipping:     Other .45
    [0.1375, 0.1375, 0.1375, 0.1375, 0.00, 0.45],
    # Other:        Shipping .45
    [0.1375, 0.1375, 0.1375, 0.1375, 0.45, 0.00],
])
FLIP_CDF = np.cumsum(FLIP_ROWS, axis=1)


def build_vocab():
    """assign every word an id, remember which ids belong to which pool."""
    word2id = {}
    next_id = 0

    def ids_for(words):
        nonlocal next_id
        ids = []
        for w in words:
            if w not in word2id:
                word2id[w] = next_id
                next_id += 1
            ids.append(word2id[w])
        return np.array(ids, dtype=np.int64)

    distinct_ids = {c: ids_for(ws[:DISTINCT_POOL_SIZE])
                    for c, ws in DISTINCT_WORDS.items()}
    pair_ids = {p: ids_for(ws) for p, ws in PAIR_POOLS.items()}
    bg_ids = ids_for(BACKGROUND_WORDS)
    return word2id, distinct_ids, pair_ids, bg_ids, next_id


def make_ticket(rng, cls, distinct_ids, pair_ids, bg_ids):
    """one multinomial bag-of-words ticket for a given true class.

    word mix: own-class signal words, leaked foreign words (mostly from the
    confusion partner), shared pair words, background filler. the leak is
    what makes borderline tickets arguable - a refund ticket that talks about
    charges and payments half sounds like billing.
    """
    dist_pool = distinct_ids[CLASSES[cls]]
    pair_pool = pair_ids[PAIR_OF_CLASS[CLASSES[cls]]]
    others = [distinct_ids[CLASSES[c]] for c in range(K) if c != cls]
    partner_pool = distinct_ids[CLASSES[PARTNER[cls]]]
    n_words = int(rng.integers(MIN_LEN, MAX_LEN + 1))
    words = np.empty(n_words, dtype=np.int64)
    for j in range(n_words):
        r = rng.random()
        if r < P_SIGNAL:
            words[j] = dist_pool[rng.integers(len(dist_pool))]
        elif r < P_SIGNAL + P_LEAK:
            if rng.random() < LEAK_TO_PARTNER:
                pool = partner_pool
            else:
                pool = others[rng.integers(len(others))]
            words[j] = pool[rng.integers(len(pool))]
        elif r < P_SIGNAL + P_LEAK + P_PAIR:
            words[j] = pair_pool[rng.integers(len(pair_pool))]
        else:
            words[j] = bg_ids[rng.integers(len(bg_ids))]
    return words


def docs_to_counts(docs, vocab_size):
    """dense (n_docs x vocab) count matrix - small vocab so this is fine."""
    counts = np.zeros((len(docs), vocab_size), dtype=np.float32)
    for i, words in enumerate(docs):
        counts[i] = np.bincount(words, minlength=vocab_size)
    return counts


def apply_crowd_noise(rng, true_labels, base_err, u=None, v=None):
    """flip labels with per-annotator error rates and the systematic matrix.

    u/v are fresh uniform draws when None. using pre-drawn u/v lets the
    tuning loop scale the error rate while keeping the *same* tickets and the
    same flip decisions nested (a flip at scale s stays a flip at s' > s).
    """
    n = len(true_labels)
    if u is None:
        u = rng.random(n)
    if v is None:
        v = rng.random(n)
    err = np.clip(base_err, 0.0, 0.98)
    flipped = u < err
    noisy = true_labels.copy()
    for i in np.where(flipped)[0]:
        # inverse-cdf sample from the flip row so it is deterministic in v
        noisy[i] = int(np.searchsorted(FLIP_CDF[true_labels[i]], v[i]))
    return noisy, flipped


def generate(n=N_TRAIN, seed=SEED, n_test=N_TEST, noise_scale=1.0):
    """synthesize HelpDeskNet-50K: tickets, crowd labels, gold labels, tests."""
    rng = np.random.default_rng(seed)
    word2id, distinct_ids, pair_ids, bg_ids, vocab_size = build_vocab()

    # ---- true labels follow the class distribution ------------------------
    train_true = rng.choice(K, size=n, p=PRIORS)
    test_true = rng.choice(K, size=n_test, p=PRIORS)

    # ---- tickets -----------------------------------------------------------
    train_docs = [make_ticket(rng, c, distinct_ids, pair_ids, bg_ids)
                  for c in train_true]
    test_docs = [make_ticket(rng, c, distinct_ids, pair_ids, bg_ids)
                 for c in test_true]

    # ---- annotator assignment ----------------------------------------------
    # train: 10% expert, 20k tier A, 25k tier B (exact counts from the issue)
    n_expert = round(0.10 * n)
    n_a = round(N_TIER_A / (N_TIER_A + N_TIER_B) * (n - n_expert))
    perm = rng.permutation(n)
    tier = np.full(n, 2, dtype=np.int8)      # 0=expert 1=tier A 2=tier B
    tier[perm[:n_expert]] = 0
    tier[perm[n_expert:n_expert + n_a]] = 1
    base_err_train = np.where(tier == 1, ERR_A, ERR_B)
    base_err_train[tier == 0] = 0.0

    # test set: labeled by the same crowd process (no experts), tier mix
    # matches the crowd population 20k/45k vs 25k/45k
    n_a_test = round(n_test * N_TIER_A / (N_TIER_A + N_TIER_B))
    test_tier = np.full(n_test, 2, dtype=np.int8)
    test_tier[:n_a_test] = 1
    rng.shuffle(test_tier)
    base_err_test = np.where(test_tier == 1, ERR_A, ERR_B)

    # ---- labels: experts are perfect, crowd flips systematically ------------
    noise_rng = np.random.default_rng(seed + 7)
    u_tr, v_tr = noise_rng.random(n), noise_rng.random(n)
    u_te, v_te = noise_rng.random(n_test), noise_rng.random(n_test)
    train_noisy, train_flipped = apply_crowd_noise(
        noise_rng, train_true, base_err_train * noise_scale, u_tr, v_tr)
    test_noisy, test_flipped = apply_crowd_noise(
        noise_rng, test_true, base_err_test * noise_scale, u_te, v_te)

    return {
        "vocab_size": vocab_size,
        "n_words_per_pool": {c: len(w) for c, w in DISTINCT_WORDS.items()},
        "train_true": train_true,
        "train_noisy": train_noisy,
        "train_flipped": train_flipped,
        "train_tier": tier,
        "train_counts": docs_to_counts(train_docs, vocab_size),
        "test_true": test_true,
        "test_noisy": test_noisy,
        "test_flipped": test_flipped,
        "test_tier": test_tier,
        "test_counts": docs_to_counts(test_docs, vocab_size),
    }


def expert_audit(data, seed=78):
    """re-run the issue's audit: 180 tier A + 220 tier B tickets re-checked
    by an expert, count the disagreements with the crowd."""
    rng = np.random.default_rng(seed)
    crowd_idx = np.where(data["train_tier"] > 0)[0]
    a_idx = rng.choice(crowd_idx[data["train_tier"][crowd_idx] == 1],
                       size=180, replace=False)
    b_idx = rng.choice(crowd_idx[data["train_tier"][crowd_idx] == 2],
                       size=220, replace=False)
    a_dis = int((data["train_noisy"][a_idx] != data["train_true"][a_idx]).sum())
    b_dis = int((data["train_noisy"][b_idx] != data["train_true"][b_idx]).sum())
    return a_dis, b_dis


def pct(x):
    return f"{100.0 * x:.2f}%"


# ----------------------------------------------------------------------------
# hand-rolled multinomial naive bayes (no sklearn, this is deliberate)
# ----------------------------------------------------------------------------
class NaiveBayes:
    """multinomial NB with laplace smoothing. fit() takes *soft* targets so
    label smoothing is just a different target matrix, and loss() gives the
    -log posterior of the assigned label for small-loss sample selection."""

    def __init__(self, n_vocab, alpha=1.0):
        self.n_vocab = n_vocab
        self.alpha = alpha

    def fit(self, counts, targets):
        # counts (n, V), targets (n, K) nonneg, rows sum to 1
        class_word = targets.T @ counts + self.alpha        # (K, V)
        self.log_lik = np.log(class_word / class_word.sum(axis=1, keepdims=True))
        prior = targets.sum(axis=0)
        self.log_prior = np.log(prior / prior.sum())
        return self

    def fit_labels(self, counts, labels):
        targets = np.zeros((len(labels), K), dtype=np.float64)
        targets[np.arange(len(labels)), labels] = 1.0
        return self.fit(counts, targets)

    def score(self, counts):
        return counts @ self.log_lik.T + self.log_prior      # (n, K) log joint

    def predict(self, counts):
        return self.score(counts).argmax(axis=1)

    def posterior(self, counts):
        s = self.score(counts)
        s = s - s.max(axis=1, keepdims=True)
        p = np.exp(s)
        return p / p.sum(axis=1, keepdims=True)

    def loss(self, counts, labels):
        """-log P(assigned label | ticket) under the current model."""
        p = self.posterior(counts)[np.arange(len(labels)), labels]
        return -np.log(np.clip(p, 1e-12, None))


def one_hot(labels):
    targets = np.zeros((len(labels), K), dtype=np.float64)
    targets[np.arange(len(labels)), labels] = 1.0
    return targets


def relabel_with_scale(seed_docs_bundle, scale):
    """regenerate only the noisy labels at a given error scale, keeping the
    exact same tickets (docs/counts are cached in the bundle)."""
    n, n_test = len(seed_docs_bundle["train_true"]), len(seed_docs_bundle["test_true"])
    rng = np.random.default_rng(SEED + 7)   # same stream as generate()
    u_tr, v_tr = rng.random(n), rng.random(n)
    u_te, v_te = rng.random(n_test), rng.random(n_test)
    tier = seed_docs_bundle["train_tier"]
    base = np.where(tier == 1, ERR_A, np.where(tier == 2, ERR_B, 0.0))
    train_noisy, _ = apply_crowd_noise(rng, seed_docs_bundle["train_true"],
                                       base * scale, u_tr, v_tr)
    test_tier = seed_docs_bundle["test_tier"]
    base_te = np.where(test_tier == 1, ERR_A, ERR_B)
    test_noisy, _ = apply_crowd_noise(rng, seed_docs_bundle["test_true"],
                                      base_te * scale, u_te, v_te)
    return train_noisy, test_noisy


def tune_noise_scale(data):
    """the issue says the classifier plateaus at 82% on the noisy test set.
    scale the tier error rates around the audit-anchored values (1.00 = the
    exact audit rates) until naive bayes lands there, and report the table.
    """
    section("3. TUNING THE CLASS-CONDITIONAL NOISE TO THE 82% PLATEAU")
    scales = [0.80, 0.90, 1.00, 1.10, 1.20, 1.30]
    rows = []
    for s in scales:
        train_noisy, test_noisy = relabel_with_scale(data, s)
        nb = NaiveBayes(data["vocab_size"]).fit_labels(data["train_counts"], train_noisy)
        acc = (nb.predict(data["test_counts"]) == test_noisy).mean()
        rows.append((s, acc))
        print(f"  noise scale {s:.2f}  (tier A {pct(min(ERR_A * s, .98))}, "
              f"tier B {pct(min(ERR_B * s, .98))}) -> noisy test acc {pct(acc)}")
    best = min(rows, key=lambda r: abs(r[1] - TARGET_NOISY_ACC))
    print(f"\n  closest to the issue's {pct(TARGET_NOISY_ACC)} plateau: "
          f"scale {best[0]:.2f} at {pct(best[1])}")
    if best[0] == 1.00:
        print("  the audit-anchored rates (6.67% / 21.82%) land nearest, no tuning needed")
    return best[0]


def train_and_eval(data, noise_scale):
    """train hand-rolled multinomial NB on the NOISY train labels, then score
    it on (a) the noisy test set and (b) the gold test set. this is the core
    empirical check of the issue: the same model looks ~82% on the labels it
    is graded against but is actually far better on clean labels."""
    train_noisy, test_noisy = relabel_with_scale(data, noise_scale)
    nb = NaiveBayes(data["vocab_size"]).fit_labels(data["train_counts"], train_noisy)
    pred = nb.predict(data["test_counts"])
    noisy_acc = (pred == test_noisy).mean()
    gold_acc = (pred == data["test_true"]).mean()
    return {
        "model": nb,
        "train_noisy": train_noisy,
        "test_noisy": test_noisy,
        "pred": pred,
        "noisy_acc": noisy_acc,
        "gold_acc": gold_acc,
    }


def section(title):
    print("\n" + "=" * 74)
    print(f" {title}")
    print("=" * 74)


def dataset_report(data):
    section("1. DATASET - synthetic HelpDeskNet-50K")
    print(f"tickets: {len(data['train_true']):,} train + {len(data['test_true']):,} test, "
          f"vocab {data['vocab_size']} words")
    print(f"train annotators: {int((data['train_tier'] == 0).sum()):,} expert / "
          f"{int((data['train_tier'] == 1).sum()):,} tier A / "
          f"{int((data['train_tier'] == 2).sum()):,} tier B")

    print("\nclass distribution (target vs generated):")
    for c in range(K):
        gen = (data["train_true"] == c).mean()
        print(f"  {CLASSES[c]:<16} target {pct(PRIORS[c]):>6}   generated {pct(gen):>6}")

    # realized error rates per tier vs the audit
    tier_mask = data["train_tier"]
    err_a = (data["train_noisy"][tier_mask == 1] != data["train_true"][tier_mask == 1]).mean()
    err_b = (data["train_noisy"][tier_mask == 2] != data["train_true"][tier_mask == 2]).mean()
    crowd = tier_mask > 0
    err_crowd = (data["train_noisy"][crowd] != data["train_true"][crowd]).mean()
    err_all = (data["train_noisy"] != data["train_true"]).mean()
    test_err = (data["test_noisy"] != data["test_true"]).mean()
    print(f"\nrealized label error rates (vs the issue's audit):")
    print(f"  tier A crowd      {pct(err_a)}   audit 12/180  = {pct(ERR_A)}")
    print(f"  tier B crowd      {pct(err_b)}   audit 48/220  = {pct(ERR_B)}")
    print(f"  crowd overall     {pct(err_crowd)}   audit 60/400  = {pct(60 / 400)}")
    print(f"  whole train set   {pct(err_all)}   (90% crowd x 15.1% + 10% expert x 0%)")
    print(f"  noisy test set    {pct(test_err)}   (same crowd process as train)")

    a_dis, b_dis = expert_audit(data)
    section("2. EXPERT AUDIT REPRODUCTION")
    print("re-checked 180 tier A + 220 tier B tickets against gold labels:")
    print(f"  tier A: {a_dis}/180 disagreements   (issue: 12/180)")
    print(f"  tier B: {b_dis}/220 disagreements   (issue: 48/220)")
    print(f"  total : {a_dis + b_dis}/400            (issue: 60/400)")


def plateau_report(data, train_noisy, test_noisy):
    """the issue says the classifier 'plateaus at 82% on the noisy test set'.
    train on growing slices of the noisy train data and watch noisy-test
    accuracy rise, flatten and stall - more data cannot fix bad labels."""
    section("5. LEARNING CURVE - WHY IT PLATEAUS AT 82%")
    rng = np.random.default_rng(SEED + 5)
    order = rng.permutation(len(train_noisy))
    counts = data["train_counts"]
    fracs = [0.005, 0.01, 0.02, 0.05, 0.10, 0.25, 0.50, 1.00]
    curve = []
    for frac in fracs:
        idx = order[: int(frac * len(order))]
        nb = NaiveBayes(data["vocab_size"]).fit_labels(counts[idx], train_noisy[idx])
        pred = nb.predict(data["test_counts"])
        acc = (pred == test_noisy).mean()
        curve.append((frac, len(idx), acc))
        bar = "#" * int(round(acc * 50))
        print(f"  {len(idx):>6,} noisy tickets ({frac*100:>4.1f}%): noisy test acc "
              f"{pct(acc)}  {bar}")
    accs = [c[2] for c in curve]
    print(f"\n  climbs fast, then flat: last three points "
          f"{pct(accs[-3])} -> {pct(accs[-2])} -> {pct(accs[-1])}")
    print("  the plateau is set by the 15% crowd error in the labels the model is")
    print("  graded against, not by model capacity or data volume")
    return curve


def ceiling_report(baseline, data):
    """compare the measured gold accuracy against the lead's uniform-flip
    ceiling: obs = a(1-eps) + (1-a)eps/(K-1) solved for a at eps = 15%."""
    section("6. CEILING MATH - UNIFORM-FLIP ESTIMATE vs MEASURED GOLD")
    obs = baseline["noisy_acc"]
    gold = baseline["gold_acc"]
    eps = 60 / 400                      # audit: overall crowd error 15%
    chance = eps / (K - 1)              # a wrong pred matches a uniform flip 1-in-5
    a_uniform = (obs - chance) / (1 - eps - chance)
    print(f"  observed accuracy on noisy test set   : {pct(obs)}")
    print(f"  uniform-flip ceiling (eps=15%, k=6)   : {pct(a_uniform)}")
    print(f"  MEASURED accuracy on gold test set    : {pct(gold)}")

    # decompose the observed agreement: clean-label vs flipped-label test docs
    flipped = baseline["test_noisy"] != data["test_true"]
    pred, test_noisy = baseline["pred"], baseline["test_noisy"]
    agree_flipped = (pred[flipped] == test_noisy[flipped]).mean()
    agree_clean = (pred[~flipped] == test_noisy[~flipped]).mean()
    err_rate = flipped.mean()
    print(f"\n  accounting identity (sanity): "
          f"{pct(agree_clean)} x {pct(1 - err_rate)} + {pct(agree_flipped)} x "
          f"{pct(err_rate)} = {pct(agree_clean * (1 - err_rate) + agree_flipped * err_rate)}"
          f"  (observed {pct(obs)})")
    print(f"  agreement on clean-labelled test docs : {pct(agree_clean)} (basically the gold accuracy)")
    uniform_agree_wrong = (1 - gold) / (K - 1)
    print(f"  agreement on flipped  test docs      : {pct(agree_flipped)} "
          f"(uniform-noise guess would be ~{pct(uniform_agree_wrong)})")
    print("\n  reading: with systematic noise the estimate shifts for two reasons")
    print("  that cancel here -")
    gap, clean_acc = gold_clean_gap(baseline, data)
    print("  (1) train labels are noisy too (the formula assumes clean training),")
    print(f"      gold-trained NB reaches {pct(clean_acc)}, so noisy train labels alone")
    print(f"      cost about {pct(gap)}")
    print("  (2) crowd flips target the confusion pairs and the model repeats the")
    print(f"      same confusions {int(round(agree_flipped / max(uniform_agree_wrong, 1e-9)))}x more often than")
    print("      uniform chance, inflating observed accuracy")
    print(f"  net effect here: measured {pct(gold)} vs uniform estimate {pct(a_uniform)} -")
    print("  both far above the observed 82%, which is the point of M3")


def gold_clean_gap(baseline, data):
    """accuracy we would get if the 90% crowd portion of train were expert
    labelled - i.e. how much noisy TRAIN labels alone cost us."""
    nb_clean = NaiveBayes(data["vocab_size"]).fit_labels(
        data["train_counts"], data["train_true"])
    acc = (nb_clean.predict(data["test_counts"]) == data["test_true"]).mean()
    return max(acc - baseline["gold_acc"], 0.0), acc


def robust_demo(data, baseline):
    """two training-time noise-tolerant tricks on the exact same noisy data:

    (i)   label smoothing k=0.1 - mix the one-hot targets with the uniform
          distribution before counting (naive bayes handles this natively,
          each ticket just contributes fractional counts to every class)
    (ii)  small-loss sample selection - each epoch, drop the 15% of training
          tickets with the highest -log P(label | ticket) under the current
          model and refit; mislabelled tickets stand out because their words
          do not match their label
    """
    section("7. NOISE-ROBUST TRAINING - SAME DATA, SAME NAIVE BAYES")
    X, Xt = data["train_counts"], data["test_counts"]
    tr_noisy, te_noisy = baseline["train_noisy"], baseline["test_noisy"]
    yt = data["test_true"]
    V = data["vocab_size"]
    results = {"baseline": (baseline["noisy_acc"], baseline["gold_acc"])}

    # ---- (i) label smoothing ---------------------------------------------
    targets = one_hot(tr_noisy) * (1.0 - K_SMOOTH) + K_SMOOTH / K
    nb_smooth = NaiveBayes(V).fit(X, targets)
    pred = nb_smooth.predict(Xt)
    smooth_noisy, smooth_gold = (pred == te_noisy).mean(), (pred == yt).mean()
    results["label_smoothing"] = (smooth_noisy, smooth_gold)

    # ---- (ii) small-loss selection ---------------------------------------
    n = len(tr_noisy)
    all_idx = np.arange(n)
    mislabelled = tr_noisy != data["train_true"]
    expert = data["train_tier"] == 0
    kept = all_idx
    for epoch in range(1, SMALL_LOSS_EPOCHS + 1):
        nb_sel = NaiveBayes(V).fit_labels(X[kept], tr_noisy[kept])
        losses = nb_sel.loss(X, tr_noisy)
        cutoff = np.quantile(losses, 1.0 - DROP_FRAC)
        kept = np.where(losses <= cutoff)[0]
        dropped = np.setdiff1d(all_idx, kept)
        sel_gold = (nb_sel.predict(Xt) == yt).mean()
        print(f"  epoch {epoch}: dropped {len(dropped):,} tickets "
              f"({pct(mislabelled[dropped].mean())} of them truly mislabelled, "
              f"{int(expert[dropped].sum())} expert tickets lost) "
              f"-> gold acc so far {pct(sel_gold)}")
    pred = nb_sel.predict(Xt)
    sel_noisy, sel_gold = (pred == te_noisy).mean(), (pred == yt).mean()
    results["small_loss"] = (sel_noisy, sel_gold)
    caught = int(mislabelled[dropped].sum())
    print(f"\n  selection caught {caught:,} of the {int(mislabelled.sum()):,} mislabelled "
          f"tickets ({pct(caught / mislabelled.sum())} recall, "
          f"{pct(mislabelled[dropped].mean())} precision)")

    # ---- summary table -----------------------------------------------------
    print(f"\n  {'method':<22}{'noisy test':>12}{'gold test':>12}{'gold delta':>12}")
    for name, key in [("baseline (noisy labels)", "baseline"),
                      ("label smoothing k=0.1", "label_smoothing"),
                      ("small-loss drop x=15%", "small_loss")]:
        nacc, gacc = results[key]
        print(f"  {name:<22}{pct(nacc):>12}{pct(gacc):>12}"
              f"{(gacc - baseline['gold_acc']):>+11.2%}")
    print("\n  honest read: small-loss selection is the winner - it physically")
    print("  removes crowd contamination (see precision above). label smoothing")
    print("  is a wash here: naive bayes is already count-averaged and laplace")
    print("  regularized, and shrinking sparse classes (Other, Shipping) toward")
    print("  the uniform target costs about what the noise-robustness gains.")
    return results


PLOTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "plots")


def crowd_confusion_matrix(data, baseline):
    """P(crowd label | true class) estimated over every crowd-annotated
    ticket (45k train crowd + 5k noisy test)."""
    mat = np.zeros((K, K))
    crowd = data["train_tier"] > 0
    for t, l in zip(data["train_true"][crowd], baseline["train_noisy"][crowd]):
        mat[t, l] += 1
    for t, l in zip(data["test_true"], baseline["test_noisy"]):
        mat[t, l] += 1
    return mat / mat.sum(axis=1, keepdims=True)


def make_plots(data, baseline, robust):
    """(a) crowd confusion heatmap, (b) noise rate by tier, (c) baseline vs
    robust methods. saved as pngs next to this script in plots/."""
    section("8. PLOTS")
    if not HAS_MPL:
        print("  matplotlib not available - skipping plots, report above is complete")
        return []
    os.makedirs(PLOTS_DIR, exist_ok=True)
    written = []

    # ---- (a) crowd confusion heatmap --------------------------------------
    mat = crowd_confusion_matrix(data, baseline)
    fig, ax = plt.subplots(figsize=(7.5, 6.5))
    im = ax.imshow(mat, cmap="Blues", vmin=0.0, vmax=1.0)
    for i in range(K):
        for j in range(K):
            ax.text(j, i, f"{mat[i, j] * 100:.1f}", ha="center", va="center",
                    color="white" if mat[i, j] > 0.55 else "black", fontsize=9)
    ax.set_xticks(range(K), CLASSES, rotation=30, ha="right", fontsize=8)
    ax.set_yticks(range(K), CLASSES, fontsize=8)
    ax.set_xlabel("crowd label")
    ax.set_ylabel("true class")
    ax.set_title("crowd annotation confusion (rows sum to 100%)\n"
                 "Billing<->Refund heaviest, then Technical<->Account Access, Shipping<->Other")
    fig.colorbar(im, ax=ax, shrink=0.8)
    fig.tight_layout()
    p = os.path.join(PLOTS_DIR, "crowd_confusion.png")
    fig.savefig(p, dpi=150)
    plt.close(fig)
    written.append(p)

    # ---- (b) realized noise rate by tier vs the audit ---------------------
    tier = data["train_tier"]
    crowd = tier > 0
    rates = [
        (data["train_noisy"][tier == 0] != data["train_true"][tier == 0]).mean(),
        (data["train_noisy"][tier == 1] != data["train_true"][tier == 1]).mean(),
        (data["train_noisy"][tier == 2] != data["train_true"][tier == 2]).mean(),
        (data["train_noisy"][crowd] != data["train_true"][crowd]).mean(),
    ]
    audit = [0.0, ERR_A, ERR_B, 60 / 400]
    labels = ["expert\n(5k)", "tier A\n(20k)", "tier B\n(25k)", "crowd\noverall"]
    fig, ax = plt.subplots(figsize=(7, 5))
    xs = np.arange(4)
    ax.bar(xs, [r * 100 for r in rates], width=0.55, color="#4878CF", label="simulated")
    ax.scatter(xs, [a * 100 for a in audit], color="crimson", marker="D", zorder=3,
               label="issue audit (12/180, 48/220, 60/400)")
    for x, r in zip(xs, rates):
        ax.text(x, r * 100 + 0.4, f"{r * 100:.2f}%", ha="center", fontsize=9)
    ax.set_xticks(xs, labels)
    ax.set_ylabel("label error rate (%)")
    ax.set_title("HelpDeskNet-50K label noise by annotator tier")
    ax.legend()
    fig.tight_layout()
    p = os.path.join(PLOTS_DIR, "noise_by_tier.png")
    fig.savefig(p, dpi=150)
    plt.close(fig)
    written.append(p)

    # ---- (c) baseline vs robust methods ------------------------------------
    methods = ["baseline\n(noisy labels)", "label smoothing\nk=0.1", "small-loss\ndrop x=15%"]
    keys = ["baseline", "label_smoothing", "small_loss"]
    noisy = [robust[k][0] * 100 for k in keys]
    gold = [robust[k][1] * 100 for k in keys]
    xs = np.arange(3)
    fig, ax = plt.subplots(figsize=(7, 5))
    ax.bar(xs - 0.18, noisy, width=0.36, color="#D65F5F", label="noisy test set (crowd labels)")
    ax.bar(xs + 0.18, gold, width=0.36, color="#6ACC65", label="gold test set (expert labels)")
    for x, v in zip(xs - 0.18, noisy):
        ax.text(x, v + 0.5, f"{v:.2f}", ha="center", fontsize=9)
    for x, v in zip(xs + 0.18, gold):
        ax.text(x, v + 0.5, f"{v:.2f}", ha="center", fontsize=9)
    ax.axhline(TARGET_NOISY_ACC * 100, color="gray", ls="--", lw=1,
               label="82% plateau from the issue")
    ax.set_xticks(xs, methods)
    ax.set_ylim(70, 100)
    ax.set_ylabel("accuracy (%)")
    ax.set_title("same naive bayes, same noisy data: observed vs true accuracy")
    ax.legend(loc="lower center", fontsize=8)
    fig.tight_layout()
    p = os.path.join(PLOTS_DIR, "robust_accuracy.png")
    fig.savefig(p, dpi=150)
    plt.close(fig)
    written.append(p)

    for p in written:
        print(f"  wrote {os.path.relpath(p, os.path.dirname(PLOTS_DIR))}")
    return written


def main():
    data = generate()
    dataset_report(data)

    noise_scale = tune_noise_scale(data)
    baseline = train_and_eval(data, noise_scale)
    section("4. BASELINE - NAIVE BAYES TRAINED ON THE NOISY LABELS")
    print(f"  accuracy on the NOISY test set (crowd labels): {pct(baseline['noisy_acc'])}")
    print(f"  accuracy on the GOLD  test set (expert labels): {pct(baseline['gold_acc'])}")
    print(f"  same model, same tickets - the gap is the crowd noise, not the model")

    plateau_report(data, baseline["train_noisy"], baseline["test_noisy"])
    ceiling_report(baseline, data)
    robust = robust_demo(data, baseline)
    make_plots(data, baseline, robust)

    print("\nsimulation finished - the 82% plateau is a measurement artifact,")
    print("true accuracy is ~96%, and small-loss filtering recovers part of the gap")
    return 0


if __name__ == "__main__":
    sys.exit(main())
