# Team Plot Armor

HacktoberFest-Hackathon 2026 submission — three problems solved across Web/App, DevOps and AI/ML.

## Team Members and Roles

| Member | GitHub | Role |
|--------|--------|------|
| Hussam Haroon | [@HussamHaroon](https://github.com/HussamHaroon) | Team Lead — architecture, integration, merges, submission |
| Eshaal | [@Eshaal607](https://github.com/Eshaal607) | Frontend & Data — ReliefHub modules (camps, inventory, needs), secure-pipeline sample app, noisy-labels simulation |
| Syeda Anusha Ali | [@SyedaAnushaAli](https://github.com/SyedaAnushaAli) | Operations & DevSecOps — dispatches/donations/volunteers modules, CI/CD security pipeline, review-prioritization simulation |

---

## 1) ReliefHub — Flood Relief Coordination Dashboard *(issue #10, Web/App)*

A coordination dashboard for flood-relief operations in Sindh: camp registry with capacity management, camp needs vs warehouse inventory with fulfilment tracking, dispatches with strict stock reservation rules, cash and in-kind donations, volunteer assignment, and a KPI dashboard with a critical-gaps view that highlights underserved camps.

**Tech:** vanilla JS module framework (hash router, role-based views for Coordinator/Volunteer), hand-written CSS, Chart.js, json-server mock API with seeded data (8 camps, 12 items, 20 needs, 10 dispatches, 10 donations, 15 volunteers), Unsplash photos + licensed video banners.

**Run:**
```bash
cd reliefhub
npx -y json-server@0.17.4 api-server/db.json --port 3000
python -m http.server 8080
# open http://localhost:8080  (add ?api=http://localhost:3011 to point at another API instance)
```
Without an API server the app automatically falls back to the bundled seed data in read-only demo mode.

## 2) Automated Security Vulnerability Scanning in a CI/CD Pipeline *(issue #2, DevOps)*

A DevSecOps pipeline that scans a sample camp-status API (Node/Express + Docker) with **Semgrep** (custom hand-written rules), **npm audit** (dependency CVEs), **Gitleaks** (secrets) and **Trivy** (container image + filesystem), then enforces a **policy gate** that fails the build on any Critical/High finding and publishes a consolidated HTML findings dashboard. The Actions history shows the full story: a red run that caught 48 findings on the intentionally vulnerable version, a remediation wave (env-based credentials, safe expression parser replacing `eval`, parameterized queries, sha256, patched lodash/moment), then a green run with documented `.trivyignore` exceptions for base-image/npm-toolchain CVEs. The AWS extension (ECR + Inspector + S3 report archival via OIDC, no long-lived keys) is documented as `aws-deploy.example.yml`.

**Run:** push to any `team-plot-armor*` branch (or use workflow_dispatch) — the pipeline lives at `.github/workflows/security.yml`. Local report generator: `python secure-pipeline/scripts/report.py --reports-dir secure-pipeline/scripts/fixtures`.

## 3) Noisy Labels: HelpDeskNet-50K *(issue #9, AI/ML)*

Statistical analysis and simulation of a 50,000-ticket support classifier plateaued at 82% accuracy because of noisy crowd labels.

- `analysis.py` — core statistics: Wilson 95% CI on the 15% audit disagreement rate, two-proportion z-test proving the Tier A/B quality gap is real (z = 4.22, p ≈ 2.4e-05), systematic-noise characterization (Billing↔Refund = 43% of errors), true-accuracy ceiling estimate (~96.3% under the uniform-flip assumption, plus why that assumption fails here), a prioritized 2,000-ticket expert-review plan, and noise-robust training + trustworthy-evaluation design.
- `simulate.py` — self-contained synthetic HelpDeskNet-50K (tier + systematic confusion), from-scratch classifier validating the ceiling math empirically, and label-smoothing / small-loss-filtering robustness demos.
- `review_sim.py` — compares expert-review selection strategies (random vs tier-first vs model-disagreement vs combined scoring) by review yield and post-cleanup noise rate.

**Run:** `python analysis.py`, `python simulate.py`, `python review_sim.py` (pure Python + numpy-if-available, no other dependencies).

---

## Workflow

Team branch `team-plot-armor`, per-member feature branches merged by the lead after review and testing; all three members appear in the commit history. Final submission via PR to the upstream `submission` branch.
