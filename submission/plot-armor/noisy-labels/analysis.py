#!/usr/bin/env python3
"""HelpDeskNet-50K noisy-label analysis (issue #9) - core statistics.

Team Plot Armor. Runs on pure stdlib. Every number from the issue statement is
recalculated and printed step by step - the printed report is the deliverable
for milestones 1-5; simulate.py (Eshaal) and review_sim.py (Anusha) validate
the conclusions empirically.
"""
import math

# ---------------------------------------------------------------------------
# Issue facts
# ---------------------------------------------------------------------------
AUDITED, DISAGREE = 400, 60
TIER_A = ("Tier A", 180, 12, 20_000)   # name, audited, disagreements, total labeled
TIER_B = ("Tier B", 220, 48, 25_000)
CLASS_SHARES = {"Billing": 0.30, "Refund": 0.15, "Technical": 0.25,
                "Account Access": 0.15, "Shipping": 0.10, "Other": 0.05}
CONFUSION = [("Billing", "Refund", 14), ("Refund", "Billing", 12),
             ("Technical", "Account Access", 9), ("Shipping", "Other", 8),
             ("Account Access", "Technical", 6), ("Technical", "Other", 5),
             ("Other", "Shipping", 3), ("Billing", "Other", 3)]
NOISY_TEST_ACC = 0.82
UNIFORM_FLIP = 0.15
K = len(CLASS_SHARES)          # 6 classes -> flips land in one of K-1 = 5


def wilson(x, n, z=1.96):
    """Wilson score interval for a binomial proportion."""
    p = x / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return p, centre - half, centre + half


def two_proportion_z(x1, n1, x2, n2):
    """Pooled z-test for two binomial proportions; returns z and two-sided p."""
    p1, p2 = x1 / n1, x2 / n2
    pooled = (x1 + x2) / (n1 + n2)
    se = math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2))
    z = (p2 - p1) / se
    p_value = math.erfc(abs(z) / math.sqrt(2))   # 2 * (1 - Phi(|z|))
    return z, p_value


def m1_quantify():
    print("=" * 74)
    print("MILESTONE 1 - QUANTIFY LABEL NOISE")
    print("=" * 74)
    p, lo, hi = wilson(DISAGREE, AUDITED)
    print(f"\n1. Overall crowd noise rate from the expert audit ({DISAGREE}/{AUDITED}):")
    print(f"   p_hat = {DISAGREE}/{AUDITED} = {p:.4f}")
    print(f"   Wilson 95% CI = [{lo:.4f}, {hi:.4f}]  (we are 95% confident the")
    print(f"   true crowd disagreement rate lies in this interval)")

    print(f"\n   Per tier:")
    tiers = []
    for name, aud, dis, total in (TIER_A, TIER_B):
        pt, tlo, thi = wilson(dis, aud)
        tiers.append((name, pt, aud, dis, total))
        print(f"   {name}: {dis}/{aud} = {pt:.4f}   Wilson 95% CI [{tlo:.4f}, {thi:.4f}]")

    (na, pa, _, _, ta), (nb, pb, _, _, tb) = tiers
    z, pv = two_proportion_z(TIER_A[2], TIER_A[1], TIER_B[2], TIER_B[1])
    print(f"\n2. Tier A vs Tier B - two-proportion z-test (pooled):")
    print(f"   pooled p = {DISAGREE}/{AUDITED} = {DISAGREE/AUDITED:.4f}")
    print(f"   z = ({pb:.4f} - {pa:.4f}) / SE = {z:.3f}")
    print(f"   two-sided p = {pv:.2e}  ->  {'SIGNIFICANT' if pv < 0.001 else 'not significant'}")
    print(f"   The tier difference is real, not chance: Tier B workers mislabel at")
    print(f"   roughly {pb/pa:.1f}x the Tier A rate.")

    exp_a = ta * pa
    exp_b = tb * pb
    print(f"\n3. Extrapolated mislabeled tickets in the 45,000 crowd-labeled set:")
    print(f"   Tier A: {ta:,} x {pa:.4f} = {exp_a:,.0f}")
    print(f"   Tier B: {tb:,} x {pb:.4f} = {exp_b:,.0f}")
    print(f"   total ~ {exp_a + exp_b:,.0f} tickets = {(exp_a + exp_b)/45_000:.1%} of the crowd pool")
    return p


def m2_characterize():
    print("\n" + "=" * 74)
    print("MILESTONE 2 - CHARACTERIZE THE NOISE")
    print("=" * 74)
    print("\nCrowd -> expert disagreement breakdown:")
    for src, dst, n in CONFUSION:
        bar = "#" * n
        print(f"   {src:<16} -> {dst:<16} {n:2d}  {bar}")
    bidir = {("Billing", "Refund"), ("Technical", "Account Access"), ("Shipping", "Other")}
    totals = {}
    for s, d, n in CONFUSION:
        key = tuple(sorted((s, d)))
        totals[key] = totals.get(key, 0) + n
    print("\n   Pairwise totals (both directions):")
    for (a, b), n in sorted(totals.items(), key=lambda kv: -kv[1]):
        print(f"   {a} <-> {b}: {n}/60 ({n/60:.0%})")
    top = max(totals.items(), key=lambda kv: kv[1])
    print(f"\n   -> The noise is SYSTEMATIC, not random. {top[0][0]} <-> {top[0][1]} alone")
    print(f"      accounts for {top[1]/60:.0%} of all disagreements, and the confusion is")
    print(f"      roughly symmetric - the signature of an ambiguous category boundary")
    print(f"      (both are money-back transactions), not of random sloppiness.")
    print(f"\n   Root cause: unclear labeling guidelines at semantic boundaries +")
    print(f"   under-trained Tier B workers (21.8% vs 6.7% error confirms training gap).")
    print(f"\n   What to change in the annotation process:")
    print(f"   - decision-tree guidelines with worked examples for boundary cases")
    print(f"   - shared definitions + adjudication queue for Billing/Refund-style pairs")
    print(f"   - qualification test + calibration batch before Tier B workers go live")
    print(f"   - monitor inter-annotator agreement continuously, per worker")


def m3_ceiling():
    print("\n" + "=" * 74)
    print("MILESTONE 3 - REASON ABOUT THE ACCURACY CEILING")
    print("=" * 74)
    # observed = t*(1-f) + ((1-t) * f/(K-1))  where a flipped label can
    # accidentally equal the true class only via the model already being wrong.
    # Standard derivation treats observed correct = t*(1-f) + (1-t)*f/(K-1)... but
    # the classic identity is: expected agreement with noisy labels
    #   A = t*(1-f) + f*(1 - 1/K ... ) - we use the exact per-issue assumption:
    # 15% of labels flipped uniformly at random to one of the other five classes.
    # A prediction agrees with the noisy label when:
    #   model correct AND label not flipped          -> t*(1-f)
    #   model wrong AND label flipped onto the model's (wrong) answer -> (1-t)*f/(K-1)
    # Solve observed = t*(1-f) + (1-t)*f/(K-1) for t:
    rhs_flip = UNIFORM_FLIP / (K - 1)
    t = (NOISY_TEST_ACC - rhs_flip) / (1 - UNIFORM_FLIP)
    print(f"\n1. Naive uniform-flip estimate (15% of test labels flipped at random")
    print(f"   to one of the other {K-1} classes):")
    print(f"   observed = t*(1-f) + (1-t)*f/{K-1}")
    print(f"   {NOISY_TEST_ACC} = t*{1-UNIFORM_FLIP} + (1-t)*{rhs_flip}")
    print(f"   t = ({NOISY_TEST_ACC} - {rhs_flip:.3f}) / {1-UNIFORM_FLIP} = {t:.4f}")
    print(f"   -> estimated TRUE accuracy ~ {t:.1%} (vs {NOISY_TEST_ACC:.0%} observed)")
    print(f"\n2. Why that estimate is unreliable FOR THIS DATASET:")
    print(f"   a. The noise is NOT uniform - it is systematic (M2). Errors concentrate")
    print(f"      in adjacent-class pairs, so the correction depends on WHICH classes")
    print(f"      the model gets wrong, not just how many.")
    print(f"   b. Noise rate varies by tier (6.7% vs 21.8%) - the effective test noise")
    print(f"      depends on the unknown Tier A/B mix of the test set.")
    print(f"   c. Correlated errors: where the model's own confusion matches the")
    print(f"      crowd's (Billing->Refund), observed accuracy is INFLATED (both wrong")
    print(f"      the same way); where they differ it is deflated. Uniform flip")
    print(f"      assumes independence, which fails exactly here.")
    print(f"   d. Part of the 82% plateau may be irreducible ambiguity of boundary")
    print(f"      tickets rather than label noise - relabeling cannot fix ambiguity.")
    print(f"   -> the uniform-flip number is a rough sanity bound, not a measurement.")


def m4_review_plan():
    print("\n" + "=" * 74)
    print("MILESTONE 4 - FIND THE BAD LABELS (2,000-ticket expert budget)")
    print("=" * 74)
    print("\nSelection strategy - rank every crowd ticket by a composite score:")
    print(f"   1. model-vs-label disagreement: k-fold out-of-fold predictions from a")
    print(f"      model trained on the 5,000 expert-labeled tickets; disagreement = flag")
    print(f"   2. confusion-pair membership: Billing/Refund and Technical/Account")
    print(f"      Access tickets get weighted up (43% of known errors live there)")
    print(f"   3. provenance: Tier B tickets weighted up (3.3x the error rate)")
    print(f"   4. uncertainty: low prediction confidence / high loss near the boundary")
    print(f"   Budget split implied by error mass: ~1,400 Tier B + 600 Tier A,")
    print(f"   ~70% of slots reserved for confusion-pair classes.")
    print(f"\nHow to EVALUATE the selection method:")
    print(f"   - hold out an expert-labeled gold sample (~400 already exist)")
    print(f"   - precision@2000 (review yield): fraction of selected tickets that are")
    print(f"     truly mislabeled; compare against random selection (expected ~15%)")
    print(f"     and single-signal baselines (Anusha's review_sim.py measures exactly")
    print(f"     this: random vs tier-only vs disagreement vs combined)")
    print(f"   - sweep the budget (500/1000/2000) for the yield curve")
    print(f"\nHow to USE the corrected labels:")
    print(f"   - relabel the selected 2,000 with experts (adjudicated, not solo)")
    print(f"   - retrain on 45k crowd + 2k corrected + 5k expert (corrected set can")
    print(f"     also be used as a small trusted validation split)")
    print(f"   - keep a fresh expert-labeled test set untouched (see M5)")


def m5_robust_and_eval():
    print("\n" + "=" * 74)
    print("MILESTONE 5 - MITIGATE NOISE & EVALUATE RELIABLY")
    print("=" * 74)
    print("\n1. Two training-time methods that tolerate residual label noise:")
    print(f"   a. Robust loss / target smoothing: generalized cross-entropy, label")
    print(f"      smoothing (k=0.1) or bootstrapped targets - bounds the gradient any")
    print(f"      single wrong label can produce (Eshaal's simulate.py demos this)")
    print(f"   b. Sample selection: co-teaching / small-loss filtering - two networks")
    print(f"      cross-select low-loss samples for each other, since noisy examples")
    print(f"      tend to have high loss early in training")
    print(f"\n2. Constructing a trustworthy evaluation set:")
    print(f"   - fresh stratified sample (~1,000-2,000), NOT reused from training")
    print(f"   - dual annotation by experts + third-expert adjudication of disputes")
    print(f"   - measure inter-annotator agreement (Cohen's kappa >= 0.8 before use)")
    print(f"   - report metrics with bootstrap CIs, per class and on confusion pairs")
    print(f"\n3. Why the current crowd-labeled test set is problematic:")
    print(f"   - it measures agreement with the crowd process, not correctness: a")
    print(f"     model that copies the crowd's systematic biases scores artificially")
    print(f"     well, so model selection on it rewards mimicking the noise")
    print(f"   - with ~15% label error the test itself, observed accuracy differences")
    print(f"     of a few points are within the noise of the measurement")
    print(f"   - the 82% 'plateau' is partly the ceiling of agreement with noisy")
    print(f"     labels - bigger models cannot beat the labels' own consistency")


def main():
    print("HelpDeskNet-50K - noisy label analysis (Team Plot Armor)")
    print("=" * 74)
    m1_quantify()
    m2_characterize()
    m3_ceiling()
    m4_review_plan()
    m5_robust_and_eval()
    print("\n" + "=" * 74)
    print("END OF ANALYSIS - empirical validation: simulate.py, review_sim.py")
    print("=" * 74)


if __name__ == "__main__":
    main()
