# Environmental Engineering Example Models

A library of stock-and-flow example models for the SourceSink project, written in
**XMILE v1.0** (namespace-free per project convention). Each `.xmile` file is a
valid, well-formed XMILE document that is part of the project's example-model
and differential-test corpus.

All files use the SD equation dialect supported by `src/model/src/functions.ts`
(`+ - * / ^`, `IF THEN ELSE`, `MIN`, `MAX`, `EXP`, `LN`, `ABS`, `SIN`, `COS`,
`TIME`, `DT`, and the stateful functions `SMTH1`/`SMTH3`/`DELAY1`/`DELAY3`/
`STEP`/`RAMP`/`PULSE`). Equations are dimensionally consistent; each stock's
initial value lives in its `<eqn>`.

Time units are consistent within a model and stated on `<sim_specs>`.

---

## 1. `streeter-phelps.xmile` — Streeter-Phelps DO sag

**Question:** After a waste load is discharged, how far does dissolved oxygen
(DO) fall, and when/where does the minimum occur?

**State:** `BOD` L(t) [mg/L], `DO_deficit` D(t) [mg/L].

**Governing equations** (moving water parcel, time domain):

```
dL/dt = -kd * L
dD/dt =  kd * L - ka * D
C(t)  =  Cs - D(t)          (Cs = saturation DO = DO_sat)
```

**Parameters:** `kd` = 0.3 /day, `ka` = 0.6 /day, `Cs` = 9 mg/L, `D(0)` = 2 mg/L
(so `C(0)` = 7 mg/L), `L(0)` = 20 mg/L. Critical time `t* = ln(ka/kd)/(ka-kd)`.

**Units:** time in days; concentrations in mg/L; rate coefficients in 1/day.

**Expected behavior:** BOD decays exponentially; the deficit rises to a single
maximum (the "sag") then relaxes back to zero; DO consequently dips to a minimum
then recovers toward saturation. Since `ka > kd`, a sag point exists around
`t* ≈ 2.3` days.

---

## 2. `eutrophication.xmile` — Phosphorus → algae → DO (and back to P on death)

**Question:** How does an external phosphorus load drive an algal bloom that
depletes dissolved oxygen, and how does phosphorus recycling on death close the
loop?

**State:** available phosphorus `P` [mg/L], algal biomass `A` [mg/L], dissolved
oxygen `DO` [mg/L].

**Governing equations:**

```
growth       = mu_max * A * (P / (Ks + P)) * (1 - A / AK)     AK = self-shading cap
uptake       = growth * P_quota
death        = death_rate * A
recycle      = death * P_quota * recycle_frac
dP/dt        = P_load_rate - uptake + recycle
dA/dt        = growth - death
photosynthesis = growth * photo_yield
respiration  = resp_rate * A
decomposition = death * decay_O_demand
reaeration   = rear_rate * (DO_sat - DO)                     (biflow)
dDO/dt       = photosynthesis + reaeration - respiration - decomposition
```

**Units:** time in days; concentrations in mg/L; growth/death in mg/L/day.

**Expected behavior:** loading fertilizes an algal bloom (Monod growth capped by
self-shading). P is taken up faster than it is recycled, so P dips, algae peaks
and partially crashes, then P re-accumulates through recycling + external input,
producing a damped bloom/crash oscillation. DO sags during the bloom (respiration
outstrips photosynthesis+reaeration) and recovers as biomass declines.

---

## 3. `groundwater-contaminant.xmile` — Contaminant transport with first-order decay

**Question:** How does a contaminant mass evolve in an aquifer under advection
and first-order decay, and how does the concentration respond when the source is
removed?

**State:** resident contaminant mass `Mass` [kg].

**Governing equations:**

```
injection     = loading_rate * (1 - STEP(1, spill_stop))
discharge     = Mass / residence_time
decay         = decay_rate * Mass
d(Mass)/dt    = injection - discharge - decay
concentration = 1000 * Mass / aquifer_volume          [mg/L]
```

**Parameters:** `loading_rate` = 100 kg/yr, `spill_stop` = 20 yr,
`residence_time` = 50 yr, `decay_rate` = 0.05 /yr (half-life 13.9 yr),
`aquifer_volume` = 1e6 m3.

**Units:** time in years; mass in kg; concentration in mg/L.

**Expected behavior:** mass rises toward a quasi-steady balance of loading vs.
(advection + decay), then decays roughly exponentially (with both advective and
first-order sinks) after the source is shut off at year 20. Concentration tracks
mass identically. This is the SD counterpart of the classic C = C0·exp(-k·t)
solution with a finite source and a residence-time (advective) pathway.

---

## 4. `logistic-harvest.xmile` — Logistic growth with harvest

**Question:** At what effort does a harvested population (fishery / invasive
species) reach equilibrium, and when does it collapse?

**State:** `Population` N [individuals].

**Governing equations:**

```
growth = r * N * (1 - N / K)
harvest = effort * N
dN/dt  = growth - harvest
```

**Parameters:** `r` = 0.3 /yr, `K` = 1000, `effort` = 0.15 /yr.

**Units:** time in years; abundance in individuals; rates in individuals/yr.

**Expected behavior:** the stock rises logistically from 100 to the shaved
equilibrium `K * (1 - effort/r)` = 500. When `effort >= r` the equilibrium
collapses to zero (overharvesting). Catch (`harvest`) tracks abundance.

---

## 5. `watershed-nutrient.xmile` — Nonpoint-source nutrient export from land use

**Question:** How much nitrogen does a watershed deliver to a stream as a
function of land use and seasonal precipitation, and what is the resulting
in-stream concentration?

**State:** in-reach nitrogen mass `Stream_N` [kg N].

**Governing equations:**

```
precip       = precip_mean * (1 + seasonality * SIN(2 * PI * TIME / season_period))   (season_period = 12 month)
runoff_depth = precip * runoff_coeff
load_i       = area_i * ec_i * runoff_depth         i in {forest, ag, urban}
total_load   = forest_load + ag_load + urban_load
d(Stream_N)/dt = total_load - Stream_N / residence_time
N_concentration = 1000 * Stream_N / stream_volume
```

**Parameters:** `precip_mean` = 9 cm/month, `seasonality` = 0.4,
`runoff_coeff` = 0.35, areas 50/30/20 ha, export coefficients
0.02/0.15/0.25 kg N/(ha·cm), `residence_time` = 1 month.

**Units:** time in months; areas in ha; runoff in cm/month; loads in kg/month.

**Expected behavior:** export scales with runoff depth and land-use coefficient
(urban > agriculture > forest). Total load and in-stream N oscillate with the
12-month precipitation cycle, accumulating during wet seasons and flushing during
dry ones.

---

## 6. `co2-accumulation.xmile` — Atmospheric CO2 accumulation with feedback

**Question:** Given constant emissions, to what new atmospheric CO2 and
temperature does the Earth system settle once a carbon-climate feedback weakens
natural uptake?

**State:** `CO2` [ppm].

**Governing equations:**

```
emissions      = base_emissions
temp_anomaly   = climate_sensitivity * LN(CO2 / preindustrial) / LN(2)
natural_uptake = uptake_rate * (CO2 - preindustrial) * (1 - feedback_strength * temp_anomaly)
d(CO2)/dt      = emissions - natural_uptake
```

**Parameters:** `base_emissions` = 2.5 ppm/yr, `preindustrial` = 280 ppm,
`uptake_rate` = 0.02 /yr, `climate_sensitivity` = 3.0 degC/doubling,
`feedback_strength` = 0.05 /degC.

**Units:** time in years; CO2 in ppm; temperature in degC.

**Expected behavior:** CO2 rises from 280 toward a new equilibrium (≈ 415–420 ppm)
where the (concentration-proportional) sink balances emissions; the warming
feedback `(1 - feedback_strength * temp_anomaly)` progressively weakens uptake,
so the new equilibrium is higher than the no-feedback case, and temperature
anomaly rises in tandem. The magnitude of the negative (sink) loop exceeds the
positive (warming) loop, so the system remains stable.

---

## 7. `reservoir-sedimentation.xmile` — Reservoir sedimentation

**Question:** How fast does a reservoir fill with sediment as trap efficiency
declines, and how does maintenance dredging extend its life?

**State:** accumulated sediment `Sediment` [m3].

**Governing equations:**

```
trap_efficiency      = MAX(0, 1 - Sediment / capacity)
trapped              = upstream_load * trap_efficiency
pass_through         = upstream_load - trapped
dredging             = STEP(dredge_capacity, dredge_start)
d(Sediment)/dt       = trapped - dredging
remaining_capacity   = capacity - Sediment
```

**Parameters:** `upstream_load` = 3000 m3/yr, `capacity` = 1e5 m3,
`dredge_capacity` = 2000 m3/yr, `dredge_start` = 25 yr.

**Units:** time in years; volumes in m3.

**Expected behavior:** the reservoir fills on an S-shaped path — nearly linearly
while trap efficiency is near 1, then decelerating toward the limit as trap
efficiency falls to 0 and all sediment passes through. Dredging (from year 25)
creates a new, lower steady-state storage (dynamic equilibrium between trapping
and removal).

---

## 8. `activated-sludge.xmile` — Activated-sludge BOD removal with recycle

**Question:** What effluent BOD and mixed-liquor solids does an activated-sludge
basin achieve, and how does sludge recycle improve treatment?

**State:** substrate `S` [mg BOD/L], biomass (MLSS) `X` [mg/L].

**Governing equations** (well-mixed reactor with clarifier recycle):

```
growth        = mu_max * X * S / (Ks + S)
uptake        = growth / Y
decay         = kd * X
to_clarifier  = D * X
recycle_return = b * D * X
dS/dt         = D * (S_in - S) - uptake
dX/dt         = growth - decay - D * X * (1 - b)
removal       = 100 * (1 - S / S_in)
```

**Parameters:** `D` = 4 /day (HRT = 0.25 day), `S_in` = 250 mg/L, `mu_max` = 6 /day,
`Ks` = 60 mg/L, `Y` = 0.5, `kd` = 0.1 /day, `b` = 0.9.

**Units:** time in days; concentrations in mg/L.

**Expected behavior:** biomass grows (Monod) and oxidizes BOD, so effluent BOD
drops from 250 mg/L to a low steady value (≈ 5 mg/L, i.e. ~98% removal) while
MLSS rises to ~1000 mg/L. The recycle fraction `b` lengthens solids retention
(solids washout rate is `D*(1-b)`); reducing `b` lowers MLSS and worsens removal,
up to complete washout.