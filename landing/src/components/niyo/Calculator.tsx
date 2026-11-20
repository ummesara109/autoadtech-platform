import { useEffect, useMemo, useState } from "react";
import { Search, Info, ChevronDown, Car, Repeat, Wallet, MapPin, Users } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { CAMPAIGN_CONFIG as C, BENGALURU_AREAS, ALL_AREAS } from "@/lib/campaign-config";
import {
  clamp, estimateBudgetCampaign, formatINR, formatINR2, formatNum, maxPlaysPerVehiclePerDay,
} from "@/lib/campaign";

type Tab = "autos" | "frequency" | "amount" | "area";
const TABS: { k: Tab; l: string; Icon: typeof Car }[] = [
  { k: "autos", l: "No. of Autos", Icon: Car },
  { k: "frequency", l: "Ads per Day", Icon: Repeat },
  { k: "amount", l: "Amount", Icon: Wallet },
  { k: "area", l: "Area", Icon: MapPin },
];
const AD_SECONDS = 30;
const SLOT_CAP = maxPlaysPerVehiclePerDay(AD_SECONDS); // 240
const UNLIMITED = 1e12;

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={cn("rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary/60 text-foreground hover:border-primary/60")}>
      {children}
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 border-b border-border pb-6 last:border-0">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wider">{label}</h3>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, min, max, label, prefix }: { value: number; onChange: (n: number) => void; min: number; max: number; label: string; prefix?: string | undefined }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const invalid = text !== "" && (Number(text) < min || Number(text) > max);
  return (
    <div className="relative">
      {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">{prefix}</span>}
      <Input aria-label={label} inputMode="numeric" value={text} aria-invalid={invalid}
        className={cn("bg-background/60 font-semibold", prefix && "pl-7", invalid && "border-destructive")}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d]/g, "");
          setText(t);
          if (t !== "") onChange(clamp(Number(t), min, max));
        }}
        onBlur={() => setText(String(value))} />
      {invalid && <p className="mt-1 text-xs text-destructive">Enter {formatNum(min)}–{formatNum(max)}</p>}
    </div>
  );
}

function SliderNum({ label, value, onChange, min, max, step = 1, prefix }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number; step?: number; prefix?: string | undefined }) {
  return (
    <div className="grid grid-cols-[1fr_7rem] items-center gap-4">
      <Slider aria-label={label} min={min} max={max} step={step} value={[Math.min(value, max)]} onValueChange={([v]) => v !== undefined && onChange(v)} />
      <NumInput label={label} value={value} onChange={onChange} min={min} max={max} prefix={prefix} />
    </div>
  );
}

function Metric({ label, value, sub, highlight }: { label: string; value: string; sub?: string | undefined; highlight?: boolean }) {
  return (
    <div className={cn("rounded-xl border border-border bg-background/40 p-4", highlight && "border-primary/50 glow")}>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-display text-xl font-bold tabular-nums", highlight && "text-primary")}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Duration({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [custom, setCustom] = useState(![15, 30, 60].includes(value));
  return (
    <Field label="Duration" hint={`${value} days`}>
      <div className="flex flex-wrap gap-2">
        {([[15, "15 Days"], [30, "1 Month"], [60, "2 Months"]] as const).map(([d, l]) => (
          <Chip key={d} active={!custom && value === d} onClick={() => { setCustom(false); onChange(d); }}>{l}</Chip>
        ))}
        <Chip active={custom} onClick={() => setCustom(true)}>Custom</Chip>
      </div>
      {custom && <SliderNum label="Custom days" value={value} onChange={onChange} min={C.days.min} max={C.days.max} />}
    </Field>
  );
}

const Autos = ({ value, onChange }: { value: number; onChange: (n: number) => void }) => (
  <Field label="Number of autos" hint={`Fleet: ${formatNum(C.vehicles.max)} autos`}>
    <div className="flex flex-wrap gap-2">
      {[50, 100, 250, 500, 1000].map((n) => <Chip key={n} active={value === n} onClick={() => onChange(n)}>{formatNum(n)}</Chip>)}
    </div>
    <SliderNum label="Number of autos" value={value} onChange={onChange} min={C.vehicles.min} max={C.vehicles.max} />
  </Field>
);

const Frequency = ({ value, onChange }: { value: number; onChange: (n: number) => void }) => (
  <Field label="Ads per auto per day" hint={`Max ${SLOT_CAP} in ${C.screenActiveHoursPerDay} hours`}>
    <div className="flex flex-wrap gap-2">
      {[1, 10, 20, 50, 100, SLOT_CAP].map((n) => <Chip key={n} active={value === n} onClick={() => onChange(n)}>{n}×</Chip>)}
    </div>
    <SliderNum label="Ads per auto per day" value={value} onChange={onChange} min={1} max={SLOT_CAP} />
  </Field>
);

export function Calculator() {
  const [tab, setTab] = useState<Tab>("autos");
  const [autos, setAutos] = useState(100);
  const [plays, setPlays] = useState(20);
  const [days, setDays] = useState(30);
  const [budget, setBudget] = useState(10_000);
  const [areas, setAreas] = useState<string[]>(["HSR Layout", "Koramangala", "Indiranagar"]);
  const [areaMode, setAreaMode] = useState<"autos" | "amount">("autos");
  const [query, setQuery] = useState("");

  // Each tab decides which inputs drive the estimate.
  const input = useMemo(() => {
    switch (tab) {
      case "autos": return { vehicles: autos, playsPerDay: SLOT_CAP, budget: UNLIMITED };
      case "frequency": return { vehicles: autos, playsPerDay: plays, budget: UNLIMITED };
      case "amount": return { vehicles: C.vehicles.max, playsPerDay: SLOT_CAP, budget };
      case "area": return areaMode === "autos"
        ? { vehicles: autos, playsPerDay: plays, budget: UNLIMITED }
        : { vehicles: autos, playsPerDay: plays, budget };
    }
  }, [tab, autos, plays, budget, areaMode]);

  const r = useMemo(() => estimateBudgetCampaign({ ...input, days, adSeconds: AD_SECONDS, exposure: "base" }), [input, days]);
  const activeAutos = tab === "amount" ? Math.min(C.vehicles.max, Math.ceil(r.delivered / (SLOT_CAP * days))) : input.vehicles;
  const viewers = Math.round(Math.min(activeAutos * C.ridesPerVehiclePerDay * C.passengersPerRide * days * C.exposure.base, r.delivered * C.passengersPerRide));
  const riders = activeAutos * C.ridesPerVehiclePerDay * C.passengersPerRide * days;
  const playsPerDay = r.delivered / days;
  const playsPerAuto = activeAutos ? playsPerDay / activeAutos : 0;


  const groups = BENGALURU_AREAS.map((g) => ({ ...g, areas: g.areas.filter((a) => a.toLowerCase().includes(query.toLowerCase())) })).filter((g) => g.areas.length);
  const toggleArea = (a: string) => setAreas((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Calculation type" className="grid grid-cols-2 gap-2 rounded-2xl bg-secondary/40 p-1.5 md:grid-cols-4">
        {TABS.map(({ k, l, Icon }) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition-colors",
              tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            <Icon className="h-4 w-4" />{l}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="glass space-y-6 rounded-3xl p-6 md:p-8" role="tabpanel">
          {tab === "autos" && (<>
            <p className="text-sm text-muted-foreground">Pick how many autos show your 30-second ad. Each auto plays it {SLOT_CAP} times a day ({C.screenActiveHoursPerDay} hours) for {formatINR(SLOT_CAP * C.pricePer30sPlayback)}/day.</p>
            <Autos value={autos} onChange={setAutos} />
            <Duration value={days} onChange={setDays} />
          </>)}

          {tab === "frequency" && (<>
            <p className="text-sm text-muted-foreground">Choose how many times your 30-second ad plays on each auto every day.</p>
            <Frequency value={plays} onChange={setPlays} />
            <Autos value={autos} onChange={setAutos} />
            <Duration value={days} onChange={setDays} />
          </>)}

          {tab === "amount" && (<>
            <p className="text-sm text-muted-foreground">Enter your budget and duration — we show how many times your 30-second ad will play.</p>
            <Field label="Budget" hint={`${formatINR2(C.pricePer30sPlayback)} per play`}>
              <div className="flex flex-wrap gap-2">
                {C.budget.presets.map((p) => <Chip key={p} active={budget === p} onClick={() => setBudget(p)}>{formatINR(p)}</Chip>)}
              </div>
              <SliderNum label="Budget in rupees" prefix="₹" value={budget} onChange={setBudget} min={C.budget.min} max={C.budget.max} step={1000} />
            </Field>
            <Duration value={days} onChange={setDays} />
          </>)}

          {tab === "area" && (<>
            <Field label="Bengaluru areas" hint={`${areas.length} selected`}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-48 flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input aria-label="Search areas" placeholder="Search areas" value={query} onChange={(e) => setQuery(e.target.value)} className="bg-background/60 pl-9" />
                </div>
                <Button type="button" variant="secondary" size="sm" onClick={() => setAreas([...ALL_AREAS])}>Select all</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setAreas([])}>Clear</Button>
              </div>
              <div className="max-h-56 space-y-3 overflow-y-auto pr-1">
                {groups.map((g) => (
                  <div key={g.group}>
                    <p className="mb-2 text-xs text-muted-foreground">{g.group}</p>
                    <div className="flex flex-wrap gap-2">{g.areas.map((a) => <Chip key={a} active={areas.includes(a)} onClick={() => toggleArea(a)}>{a}</Chip>)}</div>
                  </div>
                ))}
              </div>
              {!areas.length && <p className="text-xs text-primary">Select at least one area.</p>}
            </Field>
            <Autos value={autos} onChange={setAutos} />
            <Frequency value={plays} onChange={setPlays} />
            <Field label="Limit by amount?">
              <div className="flex gap-2">
                <Chip active={areaMode === "autos"} onClick={() => setAreaMode("autos")}>No limit</Chip>
                <Chip active={areaMode === "amount"} onClick={() => setAreaMode("amount")}>Set a budget</Chip>
              </div>
              {areaMode === "amount" && <SliderNum label="Budget in rupees" prefix="₹" value={budget} onChange={setBudget} min={C.budget.min} max={C.budget.max} step={1000} />}
            </Field>
            <Duration value={days} onChange={setDays} />
          </>)}
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="glass space-y-4 rounded-3xl p-6 md:p-8" aria-live="polite">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">Your estimate</h3>
              <span className="rounded-full border border-accent/40 px-2.5 py-1 text-xs text-accent">Estimates</span>
            </div>

            <div className="flex items-center gap-4 rounded-2xl border border-accent/50 bg-accent/10 p-5">
              <Users className="h-10 w-10 shrink-0 text-accent" />
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Estimated viewership</p>
                <p className="font-display text-3xl font-extrabold tabular-nums text-accent">{formatNum(viewers)} people</p>
                <p className="text-xs text-muted-foreground">of ~{formatNum(riders)} passengers riding ({Math.round(C.exposure.base * 100)}% assumed to watch)</p>
              </div>
            </div>

            <div className="flex items-center gap-4 rounded-2xl border border-primary/50 bg-primary/10 p-5">
              <Repeat className="h-10 w-10 shrink-0 text-primary" />
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Ads played in a single day</p>
                <p className="font-display text-3xl font-extrabold tabular-nums text-primary">{formatNum(playsPerDay)} ads</p>
                <p className="text-xs text-muted-foreground">across {formatNum(activeAutos)} autos · {formatNum(playsPerAuto)} per auto in {C.screenActiveHoursPerDay} hours</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Metric label="Total ad plays" value={formatNum(r.delivered)} highlight />
              <Metric label="Total cost" value={formatINR(r.mediaCost)} highlight sub={`${formatINR2(r.price)} per 30s play`} />
              <Metric label="Autos" value={formatNum(activeAutos)} sub={tab === "area" ? `${areas.length} areas` : undefined} />
              <Metric label="Plays per auto / day" value={formatNum(playsPerAuto)} />
              <Metric label="Duration" value={`${days} days`} />
              <Metric label="Cost per day" value={formatINR(r.mediaCost / days)} />
              {(tab === "amount" || (tab === "area" && areaMode === "amount")) && <Metric label="Unspent" value={formatINR(r.unspent)} />}
            </div>


            {tab === "amount" && r.unspent > 0 && (
              <p className="rounded-xl border border-primary/40 bg-primary/10 p-3 text-sm">Your budget is more than all {formatNum(C.vehicles.max)} autos can play in {days} days. Try a longer duration.</p>
            )}

            <Collapsible>
              <CollapsibleTrigger className="flex w-full items-center justify-between text-sm text-muted-foreground hover:text-foreground">
                <span className="flex items-center gap-2"><Info className="h-4 w-4" />How this is calculated</span>
                <ChevronDown className="h-4 w-4" />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                <p>• {formatINR2(C.pricePer30sPlayback)} per 30-second play. {SLOT_CAP} plays fit in {C.screenActiveHoursPerDay} hours = {formatINR(SLOT_CAP * C.pricePer30sPlayback)} per auto per day.</p>
                <p>• Fleet of {formatNum(C.vehicles.max)} autos. Each does {C.ridesPerVehiclePerDay} rides/day with ~{C.passengersPerRide} passengers (1–3 average).</p>
                <p>• Viewership = autos × rides × passengers × days × {Math.round(C.exposure.base * 100)}% watching. Repeat riders may count more than once.</p>
                <p>• All figures are planning estimates, not verified delivery.</p>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </div>
      </div>
    </div>
  );
}
