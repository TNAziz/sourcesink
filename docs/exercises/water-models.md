# Build-it-yourself water models

Three models to build from an empty canvas, step by step. Each one starts small, checks itself against a hand calculation, and only then grows. Each ends with an Analyze exercise that has ranges chosen to show something interesting.

| | Model | What it teaches | Builds on |
|---|---|---|---|
| A | [Tanks in series with a tracer](#a-tanks-in-series-with-a-tracer) | Residence-time distributions, arrays, DT and stability, comparing with CFD | nothing |
| B | [Treatment wetland (P-k-C\*)](#b-treatment-wetland-p-k-c) | First-order removal with a background concentration, hydraulic efficiency | A |
| C | [Activated sludge](#c-activated-sludge) | Monod kinetics, solids retention time, washout, oxygen demand | nothing |

Doing them in the order A → B → C works well: B reuses A's tanks, and C is the most non-linear.

> **About the ranges.** They are typical textbook values to start from: Kadlec & Wallace (2009) for wetlands, Metcalf & Eddy (5th ed.) for activated sludge, and US EPA disinfection guidance for baffling factors. Check them against the source and your own site before using any of them for design.

**General tips**

- Turn on units for every element. The unit checker catches most mistakes in these models (m/yr against m/d, h against min).
- Use **Runge-Kutta 4** for A and B, and keep DT well below the shortest time constant (see A3).
- After every step, **Run** and compare with the "check" line before moving on.
- **Scenarios** (in the inspector) let you save named parameter sets and switch between them, for example "N = 1" against "N = 10", or "SRT 2 d" against "SRT 10 d".

---

## A. Tanks in series with a tracer

A contact tank (for example a chlorine contact basin) gets a slug of tracer at the inlet. We follow the outlet concentration, which gives the residence-time distribution (RTD). Real tanks fall somewhere between one perfectly mixed tank and perfect plug flow. The tanks-in-series (TIS) model spans that range with one number, **N**.

**Base values** (time unit: minutes)

| Name | Meaning | Value | Units |
|---|---|---|---|
| `V` | tank volume | 100 | m³ |
| `Q` | flow | 3.33 | m³/min (200 m³/h) |
| `tau` | mean residence time, `V / Q` | ≈ 30 | min |
| `C0` | tracer mass ÷ total volume | 100 | mg/L |

### A1. One mixed tank

1. Add a stock `C1` (mg/L) with initial value `C0`. This is the slug, already mixed into the tank at t = 0.
2. Add an outflow `washout` = `Q / V * C1`.
3. Run from 0 to 150 min.

**Check:** `C1` should be `C0 * EXP(-TIME / tau)`. Add a converter `analytic_1` with that equation and plot both curves together.

### A2. Two and three tanks by hand

1. Split the volume: each tank holds `V / N` with `N` = 3. Stocks `C1`, `C2`, `C3`. Only `C1` starts at `N * C0`; the others start at 0.
2. Flows: `f12 = N * Q / V * C1` takes `C1` into `C2`, `f23` takes `C2` into `C3`, and `out = N * Q / V * C3`.

**Check:** the outlet `C3` should rise, peak and fall. The peak is at `t = tau * (N - 1) / N` (20 min for N = 3). The general curve is

    C_N(t) = C0 * N * (N*t/tau)^(N-1) * EXP(-N*t/tau) / (N-1)!

### A3. Arrays, and DT

1. Select the three tanks and use **convert repeated suffixed elements into arrays** (or build an arrayed stock `C[tank]` over a dimension `tank` = 1…N).
2. Set N = 10 and run with **Euler** at DT = 1 min, then 0.1 min.

**What you should see:** with Euler, each tank's time constant is `tau / N` = 3 min. DT has to stay well below that, or the result is wrong and can even oscillate. A good rule is DT ≤ `tau / (10 N)`. Switch to RK4 and see how much larger a DT you can get away with.

### A4. Mass balance and the F-curve

1. Add a stock `exited` (g) fed by the outlet flow `Q * C_N`. Watch the units: mg/L × m³/min = g/min.
2. **Check:** `exited` should approach the slug mass `C0 * V` = 10,000 g (10 kg).
3. Add a converter `F = exited / (C0 * V)`, the fraction that has left. **T10** is the time at which F = 0.1.

**Exercise:** in US EPA disinfection guidance, a **baffling factor** T10/τ of 0.1 means unbaffled, 0.3 poor, 0.5 average, 0.7 superior and 1.0 plug flow. Find the N that gives each class.

### A5. Dead zones and short-circuiting

Real tanks have stagnant corners and fast paths. Add the following to a single tank (or to your N-tank chain):

- **Dead zone:** split the volume into an active part `V * (1 - fd)` and a dead part `V * fd`, connected by an exchange flow `qx * (C_active - C_dead)`.
- **Bypass:** a fraction `fb` of Q goes straight from the inlet to the outlet.

| Parameter | Range to explore | What it does to the RTD |
|---|---|---|
| `fd` dead fraction | 0 – 0.4 | earlier peak plus a long tail |
| `qx / Q` exchange | 0.01 – 0.5 | how long the tail is |
| `fb` bypass | 0 – 0.2 | a sharp early spike at the outlet |
| `N` | 1 – 30 | from mixed toward plug flow |

### A6. Compare with CFD (or a field tracer test)

A CFD run (or a lithium/fluoride tracer test on a real tank) gives an outlet tracer curve: time against concentration. To compare:

1. Export the curve as a CSV with a time column and a concentration column. The time units must match the model.
2. In **Analyze → Calibrate**, load it as observations of `C_N`, and fit `fd`, `qx` and `fb` with N fixed. Repeat for a few values of N and keep the best fit.
3. Read the fitted values as an interpretation of the CFD flow field. A large `fd` points to recirculation zones. A large `fb` points to a jet along the wall.

The point to make, for teaching or in a paper: CFD gives the full spatial picture but is expensive to run. A calibrated compartment model reproduces its RTD in a fraction of a second, so you can run thousands of what-ifs on it: flows, temperatures, Monte Carlo.

**Analyze exercise:** Sensitivity, Morris, output `F`, statistic **Value at time…** at `t = 0.1 * tau`. Parameters `fd` 0–0.4, `fb` 0–0.2, `qx` 0.03–1.7 m³/min. Which defect hurts the baffling factor most?

---

## B. Treatment wetland (P-k-C\*)

A free-water-surface wetland polishing secondary effluent. Pollutant removal is first-order **toward a background concentration C\***, which the wetland itself produces. Hydraulics are tanks in series, the same as model A. This is the Kadlec & Wallace "P-k-C\*" model.

**Base values** (time unit: days; pollutant: BOD)

| Name | Meaning | Value | Range to explore | Units |
|---|---|---|---|---|
| `Cin` | inlet concentration | 30 | 10 – 100 | mg/L |
| `Cstar` | background concentration | 5 | 2 – 10 | mg/L |
| `k` | areal rate constant at 20 °C | 33 | 15 – 60 | m/yr |
| `q` | hydraulic loading rate, Q / A | 0.03 | 0.01 – 0.10 | m/d |
| `h` | water depth | 0.4 | 0.2 – 0.6 | m |
| `eps` | porosity (FWS with vegetation) | 0.95 | 0.75 – 1.0 | – |
| `N` | number of tanks (P) | 3 | 1 – 6 | – |
| `theta` | temperature factor | 1.0 for BOD | ~1.0 for BOD and TP, ~1.02 – 1.1 for nitrogen | – |

For other pollutants, change `k` and `Cstar`. Total phosphorus, for example, has `k` around 10 m/yr and a much smaller C\*. Check the values in Kadlec & Wallace (2009).

### B1. One cell

1. Stock `C` (mg/L), with initial value `Cstar`.
2. Inflow `loading = q / (h*eps) * Cin`, outflow `flushing = q / (h*eps) * C`.
3. Outflow `removal = k_d / (h*eps) * (C - Cstar)`, where `k_d = k / 365` turns m/yr into m/d. Let the unit checker confirm this.
4. Run from 0 to 60 d.

**Check (steady state):** `C = (Cin + (k_d/q) * Cstar) / (1 + k_d/q)` ≈ 11.3 mg/L with the base values.

### B2. N cells

Reuse the array structure from A3. Every cell has the same `removal` term, and the flow passes from cell to cell at `N * q / (h*eps)`.

**Check:** `(C_out - Cstar) / (Cin - Cstar) = (1 + k_d / (N*q))^(-N)`. With the base values this gives about 8.1 mg/L for N = 3 and about 6.2 mg/L as N → ∞ (plug flow). The same wetland with the same k removes noticeably more BOD just from better hydraulics.

### B3. Weather

1. Make the inflow change over time. Try `Cin = 30 + 20 * PULSE(...)` for a storm, or a STEP.
2. Add temperature, `T = 15 + 10 * SIN(2*PI*TIME/365)`, and `k_T = k * theta^(T - 20)`. Run for two years.

**Analyze exercise:**
- **Sensitivity, Sobol**, output `C_out`, statistic **Final value**, parameters `k` 15–60, `q` 0.01–0.1, `Cstar` 2–10.
- Then narrow the ranges to `q` 0.01–0.02, a large wetland. **What you should see:** `Cstar` takes over the ranking, because the outlet can't go below background no matter how big you build the wetland. At high loading (`q` 0.05–0.1), `k` and `q` dominate instead.
- **Uncertainty**, same ranges, 300 runs: how wide is the band on the outlet concentration you would promise a regulator?

---

## C. Activated sludge

A complete-mix aeration basin with an ideal clarifier. Biomass grows on the substrate with Monod kinetics, and the operator sets the **solids retention time (SRT)** by wasting sludge. (The example library has an activated-sludge model too; build yours first, then compare.)

**Base values** (time unit: days; heterotrophs at 20 °C, Metcalf & Eddy typical values)

| Name | Meaning | Value | Range to explore | Units |
|---|---|---|---|---|
| `S0` | influent biodegradable COD | 250 | 150 – 400 | mg/L |
| `mu_max` | max specific growth rate | 6 | 3 – 13 | 1/d |
| `Ks` | half-saturation constant | 20 | 5 – 40 | mg bCOD/L |
| `Y` | yield | 0.4 | 0.3 – 0.5 | g VSS / g bCOD |
| `kd` | endogenous decay | 0.12 | 0.06 – 0.20 | 1/d |
| `HRT` | V / Q | 0.25 | 0.15 – 0.4 | d (6 h) |
| `SRT` | V / Q_waste | 5 | **0.1 – 20 (log)** | d |

### C1. Substrate and biomass

1. Stocks `S` (mg/L, initial 250) and `X` (mg VSS/L, initial 50).
2. Converter `growth = mu_max * S / (Ks + S) * X`.
3. `S`: inflow `S0 / HRT`, outflows `S / HRT` and `uptake = growth / Y`.
4. `X`: inflow `growth`, outflows `decay = kd * X` and `wasting = X / SRT`. With an ideal clarifier, biomass leaves only through wasting.
5. Run from 0 to 40 d.

**Check (steady state):**

    S = Ks * (1 + kd*SRT) / (SRT * (mu_max - kd) - 1)            ≈ 1.1 mg/L
    X = (SRT/HRT) * Y * (S0 - S) / (1 + kd*SRT)                   ≈ 1,240 mg VSS/L

### C2. Find the washout cliff

Drop SRT to 1 d, then 0.5, 0.2 and 0.15 d. Below about `1 / (mu_max - kd)` (≈ 0.17 d), the biomass washes out faster than it grows. `X` collapses and `S` climbs back to `S0`. Save two scenarios, "SRT 5 d" and "SRT 0.15 d", and switch between them.

### C3. Oxygen

1. Add a stock `DO` (mg/L, initial 2) with:
   - inflow `aeration = kLa * (DO_sat - DO)`
   - outflow `OUR = (1 - 1.42*Y) * uptake + 1.42 * kd * X`
2. Values: `DO_sat` 9 mg/L, `kLa` 50–250 /d (2–10 /h).

**Check:** at the base values, OUR is about 640 mg/L/d (≈ 27 mg/L/h, a typical value). It needs `kLa` ≈ 90 /d to hold DO at 2 mg/L.

**Exercise:** a real basin's oxygen uptake is not first-order. Add a DO switching term `DO / (K_O + DO)` with `K_O` ≈ 0.2 mg/L to `growth`, and watch what happens when aeration fails.

**Analyze exercise:**
- **Sensitivity, Morris**, output `S`, statistic **Final value**, parameters `mu_max` 3–13, `Ks` 5–40, `kd` 0.06–0.2, `SRT` 0.1–20 with **log** ticked. Expect `SRT` to dominate, with a large σ, because the washout cliff is a strongly non-linear response.
- Then repeat with `SRT` 3–15 d, the normal operating window. The ranking changes and `Ks` matters. This shows how much the conclusions depend on the ranges you choose.

---

### References

- Kadlec, R. H., & Wallace, S. D. (2009). *Treatment Wetlands* (2nd ed.). CRC Press.
- Metcalf & Eddy / AECOM (2014). *Wastewater Engineering: Treatment and Resource Recovery* (5th ed.). McGraw-Hill.
- Levenspiel, O. (1999). *Chemical Reaction Engineering* (3rd ed.), ch. 11–14 (residence-time distributions and tanks in series). Wiley.
- US EPA (2020). *Disinfection Profiling and Benchmarking Technical Guidance Manual* (baffling factors).
