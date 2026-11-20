import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight, MapPin, PlayCircle, BarChart3, Users, Wallet, Rocket, UtensilsCrossed, Hotel,
  ShoppingCart, Megaphone, Smartphone, Navigation, Video, LineChart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calculator } from "@/components/niyo/Calculator";
import hero from "@/assets/hero-auto.jpg";
import { ADMIN_URL, DASHBOARD_URL } from "@/lib/links";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NiyoAds — Video Ads in Bengaluru Autos & Cabs" },
      { name: "description", content: "Plan in-auto and in-cab video ad campaigns across Bengaluru. Set budget, areas, duration and frequency and see live reach estimates." },
      { property: "og:title", content: "NiyoAds — Your Brand. Every Ride. More Reach." },
      { property: "og:description", content: "Plan in-auto and in-cab video ad campaigns across Bengaluru with a live campaign calculator." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const steps = [
  { icon: Users, t: "Choose Your Audience", d: "Select Bengaluru areas, vehicles, and campaign duration." },
  { icon: Wallet, t: "Set Your Budget", d: "Configure video duration, ad frequency, and campaign spending." },
  { icon: Rocket, t: "Reach People On The Move", d: "Launch and review playback and audience estimates." },
];
const advertisers = [
  { icon: UtensilsCrossed, t: "Restaurants & Cloud Kitchens", d: "Promote meals, offers, and delivery services to local audiences." },
  { icon: Hotel, t: "Hotels & Hospitality", d: "Promote stays, experiences, and local hospitality businesses." },
  { icon: ShoppingCart, t: "Supermarkets & Retail", d: "Advertise product launches, offers, and store locations." },
  { icon: Megaphone, t: "Brands, Agencies & Local Businesses", d: "Run targeted campaigns across selected Bengaluru areas." },
  { icon: Smartphone, t: "E-commerce, Entertainment & Mobility", d: "Drive app installs, releases, and service awareness." },
];
const benefits = [
  { icon: Navigation, t: "Location-Based Advertising", d: "Target the neighbourhoods that matter to your business." },
  { icon: Wallet, t: "Flexible Campaign Budgets", d: "Start small or scale city-wide — you set the spend limit." },
  { icon: Video, t: "Digital Video on the Move", d: "15.6\" secured screens playing your video inside the ride." },
  { icon: LineChart, t: "Campaign Delivery Analytics", d: "Playback and audience estimates, clearly labelled." },
];

function Index() {

  return (
    <div className="min-h-screen bg-background font-sans">
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <a href="/" className="font-display text-xl font-extrabold tracking-tight">Niyo<span className="text-primary">Ads</span></a>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="ghost"><a href={DASHBOARD_URL}>Advertiser Login</a></Button>
            <Button asChild size="sm" variant="ghost"><a href={ADMIN_URL}>Admin</a></Button>
            <Button asChild size="sm" variant="secondary"><a href="#calculator">Calculate My Ad Campaign</a></Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-hero relative overflow-hidden pt-28 pb-20">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 lg:grid-cols-2">
          <div className="space-y-7">
            <span className="inline-flex items-center gap-2 rounded-full border border-accent/40 px-3 py-1 text-xs text-accent">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> Smart mobility advertising · Bengaluru
            </span>
            <h1 className="font-display text-4xl font-extrabold leading-[1.05] md:text-6xl">
              Your Brand.<br />Every Ride.<br /><span className="text-primary">More Reach.</span>
            </h1>
            <p className="max-w-lg text-lg text-muted-foreground">
              Reach passengers across Bengaluru through digital video advertising on in-auto and in-cab screens. Choose your locations, budget, campaign duration, and ad frequency.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" className="glow font-semibold"><a href="#calculator">Calculate Your Campaign <ArrowRight /></a></Button>
              <Button asChild size="lg" variant="outline" className="bg-transparent"><a href="#how-it-works">How It Works</a></Button>
            </div>
          </div>
          <div className="relative">
            <img src={hero} alt="Locked 15.6-inch ad screen inside a Bengaluru auto-rickshaw at night" width={1536} height={1024} className="rounded-3xl border border-border object-cover shadow-2xl" />
            <div className="glass absolute -bottom-6 -left-4 flex items-center gap-3 rounded-2xl px-4 py-3">
              <PlayCircle className="h-6 w-6 text-primary" /><div><p className="text-sm font-semibold">30-Second Video Ads</p><p className="text-xs text-muted-foreground">₹0.50 per playback*</p></div>
            </div>
            <div className="glass absolute -top-5 right-4 flex items-center gap-3 rounded-2xl px-4 py-3">
              <MapPin className="h-6 w-6 text-accent" /><div><p className="text-sm font-semibold">Location-Based Campaigns</p><p className="text-xs text-muted-foreground">32 Bengaluru areas</p></div>
            </div>
            <div className="glass absolute -right-3 bottom-16 hidden items-center gap-3 rounded-2xl px-4 py-3 sm:flex">
              <BarChart3 className="h-6 w-6 text-primary" /><div><p className="text-sm font-semibold">Measurable Estimated Reach</p><p className="text-xs text-muted-foreground">Illustrative estimates</p></div>
            </div>
          </div>
        </div>
      </section>

      {/* Calculator */}
      <section id="calculator" className="scroll-mt-6 py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mb-10 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">Campaign planner</p>
            <h2 className="mt-2 font-display text-3xl font-bold md:text-4xl">Calculate My Ad Campaign</h2>
            <p className="mt-3 text-muted-foreground">Every change updates your estimate instantly. Figures are planning estimates, not verified delivery.</p>
          </div>
          <Calculator />
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-6 border-y border-border bg-navy/40 py-20">
        <div className="mx-auto max-w-7xl px-6">
          <h2 className="font-display text-3xl font-bold">How NiyoAds works</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {steps.map((s, i) => (
              <div key={s.t} className="relative">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><s.icon className="h-5 w-5" /></span>
                  <span className="font-display text-sm text-muted-foreground">0{i + 1}</span>
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold">{s.t}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who can advertise */}
      <section id="who" className="scroll-mt-6 py-20">
        <div className="mx-auto max-w-7xl px-6">
          <h2 className="font-display text-3xl font-bold">Who can advertise?</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {advertisers.map((a) => (
              <div key={a.t} className="glass group rounded-2xl p-6 transition-colors hover:border-primary/50">
                <a.icon className="h-7 w-7 text-primary transition-transform group-hover:scale-110" />
                <h3 className="mt-4 font-semibold">{a.t}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{a.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why */}
      <section className="pb-20">
        <div className="mx-auto max-w-7xl px-6">
          <h2 className="font-display text-3xl font-bold">Why NiyoAds?</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {benefits.map((b) => (
              <div key={b.t} className="rounded-2xl border border-border p-6">
                <b.icon className="h-6 w-6 text-accent" />
                <h3 className="mt-4 font-semibold">{b.t}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{b.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-6 pb-20">
        <div className="bg-hero glass mx-auto max-w-5xl rounded-3xl px-8 py-14 text-center">
          <h2 className="font-display text-3xl font-bold md:text-4xl">Ready to Put Your Brand on the Move?</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">Plan your campaign, explore your budget, and estimate your reach across Bengaluru.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="glow font-semibold"><a href="#calculator">Calculate My Campaign</a></Button>
            <Button asChild size="lg" variant="outline" className="bg-transparent"><a href={DASHBOARD_URL}>Create Advertiser Account</a></Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} NiyoAds · *All rates and audience figures are illustrative planning estimates.
      </footer>

    </div>
  );
}

