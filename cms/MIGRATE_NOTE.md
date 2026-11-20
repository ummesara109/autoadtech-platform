# After local check — migrate note

- **Canonical future repo:** `niyoads-cms` (Origin/GitHub — create only when Balappa approves publish).
- **Source branch:** `cursor/cms-milestone-1-gate-707b` on `balappa-gouda/niyoads-admin-patch`.
- **Do not merge** CMS into `niyoads-platform` / leave it living under admin-patch long-term.
- **After migrate:** close **PR #1** (or the CMS milestone PR) on `niyoads-admin-patch` without merging into platform `main`, once this standalone tree is the source of truth.
- This local tree was prepared for **check locally first** — no remote was created and nothing was pushed from this extraction.
