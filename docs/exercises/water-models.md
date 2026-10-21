# Build-it-yourself water models

Four models to build from an empty canvas, step by step. Each one starts small, checks itself against a hand calculation, and only then grows. Each ends with an Analyze exercise that has ranges chosen to show something interesting.

| | Model | What it teaches | Builds on |
|---|---|---|---|
| A | [Tanks in series with a tracer](#a-tanks-in-series-with-a-tracer) | Residence-time distributions, arrays, DT and stability, comparing with CFD | nothing |
| B | [Treatment wetland (P-k-C\*)](#b-treatment-wetland-p-k-c) | First-order removal with a background concentration, hydraulic efficiency | A |
| C | [Activated sludge](#c-activated-sludge) | Monod kinetics, solids retention time, washout, oxygen demand | nothing |
| D | [Bioretention cell](#d-bioretention-cell-with-internal-water-storage) | Storm hydrographs, layered storage, overflow and underdrains, internal water storage, reactions in moving water | nothing (A helps) |

Doing them in the order A → B → C → D works well: B reuses A's tanks, C is the most non-linear, and D is the largest.

> **About the ranges.** They are typical textbook values to start from: Kadlec & Wallace (2009) for wetlands, Metcalf & Eddy (5th ed.) for activated sludge, US EPA disinfection guidance for baffling factors, and NC DEQ and Davis et al. (2009) for bioretention. Check them against the source and your own site before using any of them for design.

## Before you start

### Constants are converters

There is no separate "constant" tool. A constant is a **converter** whose equation is just a number:

1. Press **C** (or click the dashed circle in the left palette) and click on the canvas.
2. Type its name, for example `V`.
3. In the inspector on the right, type the number in **Equation** (`100`) and the units in **Units** (`m3`).

A converter whose equation uses other names (`V / Q`) is a calculated value. Both are drawn the same way, and a constant shows its value on the diagram (`kd 0.3`). The **Show constants** button in the palette hides or shows them.

### Connectors

An equation can only use names that are connected to it. Press **K** and drag from the value to the element that uses it, for example from `V` to the flow `washout`. If you type a name without a connector, the inspector says it isn't connected and offers a **Connect** button. **Connect all** in the palette draws every missing connector at once.

### Names

- Names are **not case-sensitive**: `N_gravel` and `n_gravel` are the same element. Give a stock and a constant names that differ in more than capitals, or one will silently replace the other in equations. Model D below uses `NO3_gravel` for the nitrate and `n_gravel` for porosity for exactly this reason.
- A name ending in `_1`, `_2`, `_3` marks copies of one thing. SourceSink can turn such copies into an array (see A3).

### Other tips

- **Hold Ctrl while dragging** an element to snap it to the dot grid. Centres snap, so stocks, valves and converters of different sizes line up with each other.
- Give every element units. The unit checker catches most mistakes in these models (m/yr against m/d, h against min).
- Use **Runge-Kutta 4** for A, B and D, and keep DT well below the shortest time constant (see A3).
- After every step, **Run** and compare with the "check" line before moving on.
- **Scenarios** (in the inspector) let you save named parameter sets and switch between them, for example "N = 1" against "N = 10", or "SRT 2 d" against "SRT 10 d".

---

## A. Tanks in series with a tracer

A contact tank (for example a chlorine contact basin) gets a slug of tracer at the inlet. We follow the outlet concentration, which gives the residence-time distribution (RTD). Real tanks fall somewhere between one perfectly mixed tank and perfect plug flow. The tanks-in-series (TIS) model spans that range with one number, **N**.

**Base values** (time unit: minutes). Make each of these a converter (see "Constants are converters" above):

| Name | Meaning | Value | Units |
|---|---|---|---|
| `V` | total tank volume | 100 | m3 |
| `Q` | flow | 3.333 | m3/min (200 m³/h) |
| `tau` | mean residence time, equation `V / Q` | ≈ 30 | min |
| `C0` | tracer mass ÷ total volume | 100 | mg/L |

In the run settings (inspector, nothing selected) set time units to `min`, start 0, stop 150, DT 0.05, method RK4.

### A1. One mixed tank

1. Add a stock `C_1` (mg/L) with initial value `C0`. This is the slug, already mixed into the tank at t = 0.
2. Add an outflow from `C_1` to a cloud (press **F**, drag from the stock to empty canvas) named `out_1`, equation `Q / V * C_1`.
3. Run.

**Check:** `C_1` should be `C0 * EXP(-TIME / tau)`. Add a converter `analytic_1` with that equation and plot both curves together.

### A2. Three tanks by hand, set up for arrays

Each tank now holds `V / N`, with a converter `N` = 3.

Build it so that **every flow belongs to exactly one tank**. Instead of one pipe from tank 1 into tank 2, give each tank its own inflow (from a cloud) and its own outflow (to a cloud), and make each inflow equal to the previous tank's outflow. The same amount leaves one tank and enters the next, so mass is conserved. This layout is what lets SourceSink turn the tanks into an array in A3.

| Element | Kind | Connects | Equation | Units |
|---|---|---|---|---|
| `C_1` | stock | | initial `N * C0` (the whole slug is in tank 1) | mg/L |
| `C_2`, `C_3` | stocks | | initial `0` | mg/L |
| `in_1` | flow | cloud → `C_1` | `0` | mg/L/min |
| `in_2` | flow | cloud → `C_2` | `out_1` | mg/L/min |
| `in_3` | flow | cloud → `C_3` | `out_2` | mg/L/min |
| `out_1` | flow | `C_1` → cloud | `N * Q / V * C_1` | mg/L/min |
| `out_2` | flow | `C_2` → cloud | `N * Q / V * C_2` | mg/L/min |
| `out_3` | flow | `C_3` → cloud | `N * Q / V * C_3` | mg/L/min |

Delete A1's `analytic_1` or point it at `C_3`. Use **Connect all** to draw the connectors.

**Check:** the outlet `C_3` rises, peaks and falls. The peak is at `t = tau * (N - 1) / N` = 20 min. At t = 20 min, `C_3` ≈ 81.2 mg/L. The general curve is

    C_N(t) = C0 * N * (N*t/tau)^(N-1) * EXP(-N*t/tau) / (N-1)!

(Concentration flows work here only because all tanks have the same volume. With unequal tanks, use mass stocks as in A5.)

### A3. Turn the tanks into an array, then use ten

**1. Convert.** Click empty canvas so nothing is selected. The inspector now shows the model overview, which includes a **Repeated elements** panel: "9 elements are copies of 3 patterns". (If the panel is missing, check that every name ends in `_1`, `_2`, `_3` and that each flow connects only its own tank or a cloud, as in A2.)
   - Rename the dimension from `Group A` to `tank`.
   - Leave `C`, `in` and `out` ticked and click **Convert to arrays**.
   - The diagram now has one `C`, one `in` and one `out`, and the results are named `C[1]`, `C[2]`, `C[3]`. Run: `C[3]` should match A2's `C_3` exactly.

**2. Add tanks.** In the overview's **Dimensions (arrays)** panel, change the labels of `tank` to `1, 2, 3, 4, 5, 6, 7, 8, 9, 10`. Set the converter `N` to `10`.

**3. Fix the starting values.** Select the stock `C`. Under **Arrayed over: tank**, the main equation is the one that "applies to all" elements, and the list below gives individual elements their own. After the conversion, the main initial value is `N * C0`, copied from tank 1. Change it to **`0`**, and make sure `C[1]` reads `N * C0`. Otherwise tanks 4–10 also start full of tracer.

**4. Chain the new tanks.** Select the flow `in`. Its main equation is `0`, and `in[2]` = `out[1]`, `in[3]` = `out[2]` came across from A2. Fill in the rest: `in[4]` = `out[3]`, `in[5]` = `out[4]`, …, `in[10]` = `out[9]`.

**5. Nothing to do for `out`.** Its equation `N * Q / V * C` uses `C` without a subscript, which inside an arrayed equation means "the same tank".

**Check:** plot `C[10]`. The peak is at `tau * 9 / 10` = 27 min, and it is taller and narrower than for N = 3.

**DT.** Switch the method to **Euler** and run at DT = 1 min, then 0.1 min. Each tank's time constant is `tau / N` = 3 min, and DT has to stay well below that or the result is wrong and can even oscillate. A good rule is DT ≤ `tau / (10 N)`. Switch back to RK4 and see how much larger a DT you can get away with.

### A4. Mass balance and the F-curve

1. Add a stock `exited` (g) fed by an inflow `leaving` = `Q * C[10]`. Watch the units: mg/L × m³/min = g/min.
2. **Check:** `exited` should approach the slug mass `C0 * V` = 10,000 g (10 kg).
3. Add a converter `F = exited / (C0 * V)`, the fraction that has left. **T10** is the time at which F = 0.1.

**Exercise:** in US EPA disinfection guidance, a **baffling factor** T10/τ of 0.1 means unbaffled, 0.3 poor, 0.5 average, 0.7 superior and 1.0 plug flow. Find the N that gives each class. A one-parameter **Sweep** of `N` won't work here, because N must match the number of array labels. Use Scenarios for N = 1, 2, 5, 10, 20 instead, or rebuild with more labels.

### A5. Dead zones and short-circuiting

Real tanks have stagnant corners (a **dead zone** that trades water slowly with the main flow) and fast paths (a **bypass**, where part of the flow reaches the outlet without mixing). Build this as a **new, single-tank model**: it is easier to see each effect on one tank first.

The two zones have different volumes, so this model tracks tracer **mass** (g) in each zone and works out concentrations from it. The tracer also has to arrive with the inflow, so that part of it can take the bypass. Inject it over the first minute instead of starting with it in the tank.

**Constants** (minutes; `V`, `Q`, `C0` as before):

| Name | Meaning | Value | Range to explore |
|---|---|---|---|
| `fd` | dead fraction of the volume | 0.3 | 0.01 – 0.4 (keep > 0: the dead-zone concentration divides by its volume) |
| `fb` | fraction of the flow that bypasses | 0.1 | 0 – 0.2 |
| `qx` | exchange flow between the zones | 0.3 m³/min | 0.03 – 3 (that is, 1% to 100% of Q) |
| `t_inj` | injection time | 1 min | |

**Calculated converters:**

| Name | Equation | Units |
|---|---|---|
| `injection` | `IF TIME < t_inj THEN C0 * V / t_inj ELSE 0` | g/min |
| `V_active` | `V * (1 - fd)` | m3 |
| `V_dead` | `V * fd` | m3 |
| `C_active` | `M_active / V_active` | mg/L |
| `C_dead` | `M_dead / V_dead` | mg/L |
| `C_out` | `(outflow + bypass) / Q` | mg/L |
| `F` | `exited / (C0 * V)` | – |

**Stocks** (all start at 0, units g): `M_active`, `M_dead`, `exited`.

**Flows** (g/min):

| Flow | From → to | Equation | Meaning |
|---|---|---|---|
| `injection_in` | cloud → `M_active` | `(1 - fb) * injection` | the tracer that enters the main flow |
| `bypass` | cloud → `exited` | `fb * injection` | the tracer that goes straight to the outlet |
| `outflow` | `M_active` → `exited` | `Q * (1 - fb) * C_active` | the main flow leaving |
| `to_dead` | `M_active` → `M_dead` | `qx * C_active` | exchange into the dead zone |
| `from_dead` | `M_dead` → `M_active` | `qx * C_dead` | exchange back out |

The two exchange flows are one-way on purpose. Their difference, `qx * (C_active - C_dead)`, is the net exchange, and both stay positive.

**Checks:**
- `F` approaches 1 (about 0.98–0.99 by 300 min): no tracer is lost.
- With `fd` = 0.01 and `fb` = 0, the tank is almost perfectly mixed and `C_out` follows A1's exponential.
- With `fd` = 0.3 and `fb` = 0, the outlet peak rises (to about 138 mg/L instead of about 98) because the tracer first mixes into a smaller active volume, and the tail lasts longer as the dead zone slowly releases it.
- With `fb` = 0.1, `C_out` spikes to 300 mg/L during the injection minute (10% of the tracer, undiluted by the tank).

| Parameter | What it does to the outlet curve |
|---|---|
| `fd` | higher early peak, longer tail |
| `qx` | small: the dead zone barely participates (a long, faint tail); large: the dead zone behaves like part of the tank |
| `fb` | a sharp spike at the start |

**Then combine:** put the dead zone and bypass on the last tank of the A3 chain. That shape (a delayed main peak, an early spike and a long tail) is what real contact tanks and CFD results often look like.

### A6. Compare with CFD (or a field tracer test)

A CFD run (or a lithium/fluoride tracer test on a real tank) gives an outlet tracer curve: time against concentration. To compare:

1. Export the curve as a CSV with a time column and a concentration column. The time units must match the model.
2. In **Analyze → Calibrate**, load it as observations of `C_out`, and fit `fd`, `qx` and `fb`. For the combined model, repeat for a few values of N and keep the best fit.
3. Read the fitted values as an interpretation of the CFD flow field. A large `fd` points to recirculation zones. A large `fb` points to a jet along the wall.

The point to make, for teaching or in a paper: CFD gives the full spatial picture but is expensive to run. A calibrated compartment model reproduces its RTD in a fraction of a second, so you can run thousands of what-ifs on it: flows, temperatures, Monte Carlo.

**Analyze exercises:**
- **Sweep** `fd` from 0.01 to 0.4 with output `F`, statistic **Value at time…** at 3 min (0.1 τ). How much does a dead zone hurt the baffling factor?
- **Sensitivity, Morris**, same output, with `fd` 0.01–0.4, `fb` 0–0.2, `qx` 0.03–3. Which defect hurts the baffling factor most?

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

Use the same layout as A2: cells `C_1`, `C_2`, `C_3`, each with its own `in_k`, `out_k` and `removal_k`, all starting at `Cstar`.
- `in_1 = N * q / (h*eps) * Cin`, and `in_k = out_(k-1)` for the later cells.
- `out_k = N * q / (h*eps) * C_k`.
- `removal_k = k_d / (h*eps) * (C_k - Cstar)`. Removal per unit depth is the same in every cell, because each cell has 1/N of the area and 1/N of the volume.

Then convert to arrays as in A3 if you want more cells.

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

## D. Bioretention cell with internal water storage

A bioretention cell takes runoff from a parking lot or roof. Water ponds on the surface, soaks into an engineered soil **media**, and drains into a **gravel** layer. From there it either seeps into the native soil (**exfiltration**) or leaves through an **underdrain** pipe. An upturned elbow on the underdrain holds water in the bottom of the gravel. This **internal water storage (IWS)** zone increases exfiltration and stays saturated, so nitrate can be denitrified there. When the cell fills, water spills over a weir (**overflow**).

```
 runoff ─►  [ ponding ]  ──overflow──►
               │ infiltration
               ▼
           [ media ]
               │ percolation
               ▼
           [ gravel + IWS ] ──underdrain (above the IWS outlet)──►
               │ exfiltration
               ▼
          native soil
```

Each layer is a stock of **water volume** (m³). Depths and moisture are converters worked out from the volumes. Later, each layer gets a second stock for **nitrate mass** (g), which moves with the water.

**Time unit:** hours. **Run settings:** RK4, DT 0.01 h, save every 0.5 h. The overflow weir and the "layer is full" limits make the model stiff, so a small DT matters here.

**Base values and ranges**

| Name | Meaning | Value | Range to explore | Units |
|---|---|---|---|---|
| `A` | cell surface area | 100 | 25 – 200 | m2 |
| `A_catch` | impervious catchment draining to the cell | 1500 | | m2 |
| `C_runoff` | runoff coefficient | 0.9 | 0.8 – 0.95 | – |
| `P` | storm depth | 0.025 (25 mm, a "first inch" design storm) | 0.01 – 0.1 | m |
| `Td`, `tp` | storm duration, time of peak rain | 6, 2 | | h |
| `h_max` | ponding depth before overflow | 0.25 | 0.15 – 0.30 | m |
| `Cw`, `L_weir` | weir coefficient, weir length | 1.7, 1 | | m^0.5/s, m |
| `L_media` | media depth | 0.9 | 0.6 – 1.2 | m |
| `porosity` | media porosity | 0.4 | 0.35 – 0.45 | – |
| `theta_fc` | media field capacity | 0.15 | 0.10 – 0.25 | – |
| `Ks_media` | media saturated conductivity | 0.05 (50 mm/h) | 0.025 – 0.15 | m/h |
| `d_gravel` | gravel layer depth | 0.6 | | m |
| `n_gravel` | gravel porosity | 0.4 | 0.35 – 0.45 | – |
| `d_IWS` | height of the underdrain outlet above the bottom | 0.45 | 0 – 0.6 | m |
| `Ks_native` | native soil conductivity | 0.0025 (2.5 mm/h, a clayey soil) | 0.00025 – 0.025 (log) | m/h |
| `k_ud` | how fast water above the outlet drains | 2 | 0.5 – 10 | 1/h |
| `T_event` | time from one storm to the next | 96 | 24 – 336 | h |
| `C_in` | nitrate-N in the runoff | 1 | 0.3 – 2 | mg/L |
| `C_init`, `C_init_IWS` | nitrate-N in the media and IWS at the start | 1, 0.2 | | mg/L |
| `k_dn` | first-order denitrification rate in the IWS | 0.05 | 0.002 – 1 (log) | 1/h |

The cell is about 7% of its catchment. Denitrification rates in the literature vary widely with carbon supply and temperature, so treat `k_dn` as something to calibrate or sweep rather than a known value.

### D1. The inflow hydrograph

1. Converters:
   - `i_peak = 2 * P / Td` (m/h): the peak of a triangular hyetograph holding depth P.
   - `rain = IF TIME <= tp THEN i_peak * TIME / tp ELSE IF TIME <= Td THEN i_peak * (Td - TIME) / (Td - tp) ELSE 0` (m/h)
2. A stock `V_in` (m3, starts at 0), fed from a cloud by a flow `runoff_count`, and a converter `runoff = C_runoff * rain * A_catch` (m3/h). Set `runoff_count` = `runoff`.
3. Run from 0 to 72 h.

**Check:** `runoff` peaks at 11.25 m³/h at 2 h, and `V_in` ends at `C_runoff * P * A_catch` = 33.75 m³.

`V_in` is a **running total**: a stock that only counts. The model will have one for each way water enters or leaves (`V_over`, `V_ud`, `V_exf`), and together they make the water balance easy to check. In D2, `runoff` stops being a converter and becomes the flow into the ponding zone. Delete the converter and draw a flow `runoff` with the same equation.

### D2. Ponding zone and overflow

1. Stock `W_pond` (m3, starts at 0) with inflow `runoff`.
2. Converter `h_pond = W_pond / A` (m).
3. Outflow `overflow = Cw * L_weir * MAX(0, h_pond - h_max) ^ 1.5 * 3600` (m3/h; the weir equation in m³/s × 3600 s/h).
4. Running total `V_over` fed by `overflow_count = overflow`.

### D3. The media

1. Stock `W_media` (m3), starting at field capacity: `A * L_media * theta_fc`.
2. Converter `theta = W_media / (A * L_media)`, the moisture content.
3. Flow `infiltration` from `W_pond` to `W_media`:

       Ks_media * A * (1 + h_pond / L_media) * h_pond / (h_pond + 0.002) * MAX(0, MIN(1, (porosity - theta) / 0.01))

   Each piece of this equation has a job:
   - `Ks_media * A * (1 + h_pond / L_media)` is Darcy flow through saturated media, with the ponded water adding head.
   - `h_pond / (h_pond + 0.002)` fades infiltration out smoothly as the pond empties, so `W_pond` can't go negative.
   - The last factor stops infiltration when the media is saturated (`theta` reaches `porosity`).
4. Flow `percolation` out of `W_media` (to a cloud for now):

       Ks_media * A * MAX(0, (theta - theta_fc) / (porosity - theta_fc)) ^ 3

   Media drains only above field capacity, and slowly until it is quite wet (the cube is a simple unsaturated-conductivity curve).

### D4. Gravel, IWS, underdrain and exfiltration

1. Stock `W_gravel` (m3), starting full up to the outlet: `A * n_gravel * d_IWS`, as if a previous storm had filled it.
2. Converters:
   - `W_IWS = A * n_gravel * d_IWS`: the water held below the outlet.
   - `W_gravel_max = A * n_gravel * d_gravel`: the gravel full to the top.
3. Point `percolation` into `W_gravel`, and multiply it by `MAX(0, MIN(1, (W_gravel_max - W_gravel) / (0.01 * A)))` so it stops when the gravel is full.
4. Outflow `underdrain = k_ud * MAX(0, W_gravel - W_IWS)`: only water above the outlet leaves.
5. Outflow `exfiltration = Ks_native * A * W_gravel / (W_gravel + 0.01 * A * n_gravel)`: seepage at the native soil's rate whenever the gravel holds water, fading out as it empties.
6. Running totals `V_ud` and `V_exf`, as in D1.
7. Converters:
   - `Q_out = overflow + underdrain`
   - `volume_reduction = 1 - (V_over + V_ud) / MAX(V_in, 0.001)`
   - `storage = W_pond + W_media + W_gravel`
   - `balance = V_in - V_over - V_ud - V_exf - (storage - (A * L_media * theta_fc + A * n_gravel * d_IWS))`

**Checks** (base values, one 25 mm storm, 72 h):
- `balance` stays at 0 (within about 1e-12). If it doesn't, a flow is missing from a running total or attached to the wrong stock.
- The pond peaks at about 0.11 m deep, so there is no overflow. The media reaches `theta` ≈ 0.39, almost saturated.
- Outflow peaks at about 3.9 m³/h around 7 h: a third of the 11.25 m³/h inflow peak, five hours later.
- At 72 h: `V_ud` ≈ 20.3 m³, `V_exf` ≈ 17.5 m³, and the volume reduction is about 40%.

Use **Results → Panels** to see `runoff`, `h_pond`, `theta` and `Q_out` stacked on one time axis.

### D5. A month of storms

Real cells see storm after storm, and what matters is how much the IWS has drained (by exfiltration) before the next one.

1. Converter `t_storm = MOD(TIME, T_event)`, the time since the current storm began.
2. In `rain`, replace `TIME` with `t_storm` (three places).
3. Run to 720 h (30 days).

**Check:** with storms every 96 h, volume reduction settles at about 65%.

### D6. Nitrate

Each layer gets a nitrate stock (g) that moves with the water. The concentration in a layer is its mass divided by its water volume, and every water flow carries the concentration of the layer it leaves.

1. Stocks:
   - `NO3_pond` (0)
   - `NO3_media` (`A * L_media * theta_fc * C_init`)
   - `NO3_gravel` (`A * n_gravel * d_IWS * C_init_IWS`)
   - running totals `M_in`, `M_out`, `M_exf`

   Remember that names are not case-sensitive: `NO3_gravel`, not `N_gravel`, which would collide with `n_gravel`.
2. Concentrations (mg/L = g/m³). The small additions keep an empty layer from dividing by zero:
   - `C_pond = NO3_pond / (W_pond + 0.001)`
   - `C_media = NO3_media / W_media`
   - `C_gravel = NO3_gravel / (W_gravel + 0.001)`
3. Mass flows (g/h), one per water flow:

   | Flow | From → to | Equation |
   |---|---|---|
   | `N_load` | cloud → `NO3_pond` | `runoff * C_in` |
   | `N_infil` | `NO3_pond` → `NO3_media` | `infiltration * C_pond` |
   | `N_over` | `NO3_pond` → cloud | `overflow * C_pond` |
   | `N_perc` | `NO3_media` → `NO3_gravel` | `percolation * C_media` |
   | `N_ud` | `NO3_gravel` → cloud | `underdrain * C_gravel` |
   | `N_exf` | `NO3_gravel` → cloud | `exfiltration * C_gravel` |
   | `denitrification` | `NO3_gravel` → cloud | `k_dn * NO3_gravel` |

4. Running totals: `M_in` ← `N_load`, `M_out` ← `N_over + N_ud`, `M_exf` ← `N_exf`. Converter `load_reduction = 1 - M_out / MAX(M_in, 0.001)`.

**Checks** (30 days, storms every 96 h):
- With `k_dn` = 0, the nitrate balance closes: `M_in` = `M_out` + `M_exf` + the change in the three nitrate stocks.
- With `k_dn` = 0.05 /h, the load reduction at the outlets is about 77%.

Note what "load reduction" counts. Nitrate that exfiltrates hasn't been removed; it has gone to groundwater. Only `denitrification` actually destroys it. Comparing `M_exf` with the denitrified total is part of the story.

One thing to watch: in a single 72-hour event, almost none of the storm's nitrate reaches the underdrain. The water leaving first is the **old water** that was already sitting in the IWS, and the new water is still in the media. This is real (it shows up in field studies), and it is why D5's sequence of storms is needed before the denitrification rate makes any difference.

### Analyze exercises

Each of these points at something real. Run it before reading the hint.

1. **When does it overflow?** Use the single storm (`T_event` large, run to 72 h). **Sweep** `P` from 0.01 to 0.1 m, output `V_over`, statistic **Final value**. The sweep should report a threshold. *Hint: somewhere between 30 and 40 mm.*
2. **Undersizing.** **Sweep** `A` from 25 to 200 m² with the same output. Where does the cell start to overflow on the design storm? Compare that with common sizing rules (cell area as a percentage of the impervious area).
3. **What the IWS buys.** Over 30 days, **sweep** `d_IWS` from 0 to 0.45 m with output `volume_reduction`, then `load_reduction`. *Hint: going from no IWS to 0.45 m changes both a lot.* Setting `d_IWS` = `d_gravel` (0.6 m) means no underdrain flow at all: a fully infiltrating cell.
4. **Soil against design.** A **two-parameter sweep** with `Ks_native` 0.00025–0.025 (log) and `d_IWS` 0–0.45. On which soils is an IWS worth the most?
5. **Time between storms.** **Sweep** `T_event` from 24 to 336 h. The volume reduction levels off; the sweep summary should say where.
6. **Denitrification.** **Sweep** `k_dn` from 0.002 to 1 /h (log), output `load_reduction`. Then add `T_event` as a second parameter: a longer dry period gives the IWS more time to work.
7. **Uncertainty.** `Ks_media` and `Ks_native` are rarely known within a factor of two. **Uncertainty**, 300 runs, `Ks_media` 0.025–0.1 and `Ks_native` 0.001–0.006, on `volume_reduction`. How confident can a design claim be?

Export any of these charts (**Export → PNG/SVG**) for a report or slide.

---

### References

- Kadlec, R. H., & Wallace, S. D. (2009). *Treatment Wetlands* (2nd ed.). CRC Press.
- Metcalf & Eddy / AECOM (2014). *Wastewater Engineering: Treatment and Resource Recovery* (5th ed.). McGraw-Hill.
- Levenspiel, O. (1999). *Chemical Reaction Engineering* (3rd ed.), ch. 11–14 (residence-time distributions and tanks in series). Wiley.
- US EPA (2020). *Disinfection Profiling and Benchmarking Technical Guidance Manual* (baffling factors).
- Davis, A. P., Hunt, W. F., Traver, R. G., & Clar, M. (2009). Bioretention technology: Overview of current practice and future needs. *Journal of Environmental Engineering*, 135(3), 109–117.
- NC Department of Environmental Quality. *Stormwater Design Manual*, Part C-2: Bioretention Cell (media depth, ponding depth, internal water storage and sizing guidance).
