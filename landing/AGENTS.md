<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Campaign pricing/audience assumptions live only in src/lib/campaign-config.ts; calculation logic in src/lib/campaign.ts reads from it (tested in src/test/campaign.test.ts) — so rates change without touching logic.
- Landing page only: no backend calls or routes beyond /. The advertiser dashboard is a separate app in ../dashboard; the only links out to it are the "Advertiser Login" / "Create Advertiser Account" buttons (src/lib/links.ts). All other CTAs scroll within the page.
