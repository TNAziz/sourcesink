# Modeling notes for the example library

The example models are our own implementations of published models and
classic teaching problems. Where an implementation had to make a choice the
source does not dictate, or where a first draft disagreed with the source,
the decision is recorded here so teachers can see exactly what was done.

## Climate: `ice-albedo`

The albedo is 0.62 below 250 K, 0.30 above 280 K, and linear in between. A
first draft started the transition at 240 K, but the snowball equilibrium
with an ice albedo of 0.62 is about 247 K, which would then sit inside the
transition, where the albedo is already lower. The cold state would not be an
equilibrium and a cold start would warm all the way to the warm state.
Holding the ice plateau to 250 K keeps both stable states (about 247 K and
287.8 K), which is the behaviour Budyko (1969) and Sellers (1969) describe.

## Resources: `easter-island`

Brander and Taylor (1998) use a time period of one decade: r = 0.04 and
b − d = −0.1 are per decade. The model converts every rate to per year
(r = 0.004, α = 0.000001 per person per year, b − d = −0.01), which leaves
the interior equilibrium unchanged (S* = 6,250, L* ≈ 4,792). Read in years
without the conversion, the population would peak 80 years after settlement
instead of about 800.

## Business: `stock-management`

Deliveries are a third-order delay (`DELAY3`) and the supply line starts at
its equilibrium (expected demand times the delivery delay). With a
first-order delay the model barely oscillates, which hides the behaviour
Sterman (1989) reports: when decision makers under-weight the supply line,
inventory overshoots and oscillates.

## Ecology and problem solving: units

The unit checker reads ASCII units, so micrograms are written `ug`, rates per
pair of animals `1/individuals/year`, and uptake coefficients `L/kg/day`.
The element documentation uses the familiar symbols (µg/L). The U.S.
population model is kept in `people` with values in the millions.
