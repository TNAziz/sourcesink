# Example models

A library of well-known system-dynamics models, each an original SourceSink implementation built from the cited equations. Open a model from the in-app Examples gallery or from the table below. Every model is unit-checked, simulates cleanly and ships with the checks a teacher would use in class. Choices made where a source leaves room for interpretation are recorded in [MODELING-NOTES.md](MODELING-NOTES.md).

## Environmental engineering

Water, air and contaminant systems built from environmental-engineering models.

| Model | Level | Question | Source |
| --- | --- | --- | --- |
| [Activated-sludge BOD removal with recycle](environmental/activated-sludge.xmile) | intermediate | What effluent BOD and mixed-liquor solids does an activated-sludge basin achieve, and how does sludge recycle improve treatment? | [Monod (1949)](https://doi.org/10.1146/annurev.mi.03.100149.002103) |
| [Atmospheric CO2 accumulation with carbon-climate feedback](environmental/co2-accumulation.xmile) | intermediate | Given constant emissions, to what new atmospheric CO2 and temperature does the Earth system settle once a carbon-climate feedback weakens natural uptake? | SourceSink original |
| [Groundwater contaminant transport with first-order decay](environmental/groundwater-contaminant.xmile) | intro | How does a contaminant mass evolve in an aquifer under advection and first-order decay, and how does the concentration respond when the source is removed? | SourceSink original |
| [Lake eutrophication: phosphorus, algae and dissolved oxygen](environmental/eutrophication.xmile) | advanced | How does an external phosphorus load drive an algal bloom that depletes dissolved oxygen, and how does phosphorus recycling on death close the loop? | [Vollenweider (1975)](https://doi.org/10.1007/BF02505178) |
| [Logistic population growth with harvest](environmental/logistic-harvest.xmile) | intro | At what effort does a harvested population (fishery / invasive species) reach equilibrium, and when does it collapse? | Schaefer (1954) |
| [Reservoir sedimentation](environmental/reservoir-sedimentation.xmile) | intermediate | How fast does a reservoir fill with sediment as trap efficiency declines, and how does maintenance dredging extend its life? | [Brune (1953)](https://doi.org/10.1029/TR034i003p00407) |
| [Streeter-Phelps dissolved-oxygen sag](environmental/streeter-phelps.xmile) | intro | After a waste load is discharged, how far does dissolved oxygen (DO) fall, and when/where does the minimum occur? | Streeter (1925) |
| [Watershed nonpoint-source nutrient export](environmental/watershed-nutrient.xmile) | intermediate | How much nitrogen does a watershed deliver to a stream as a function of land use and seasonal precipitation, and what is the resulting in-stream concentration? | SourceSink original |

## Business and management

Firms, markets and the diffusion of products and practices.

| Model | Level | Question | Source |
| --- | --- | --- | --- |
| [Bass diffusion: adoption of a new technology](business/bass-diffusion.xmile) | intro | When does adoption peak, and how much of the market is still untapped at that point? | [Bass (1969)](https://doi.org/10.1287/mnsc.15.5.215) |
| [Rework cycle and the 90 percent syndrome](business/rework-cycle.xmile) | intermediate | Why is a project only 80 percent done after the time needed to do all 1000 tasks at full productivity? | [Cooper (1980)](https://doi.org/10.1287/inte.10.6.20) |
| [Solar PV: learning curve meets diffusion](business/learning-curve-adoption.xmile) | advanced | How much does cost fall by the time solar capacity has doubled four times, and when does adoption peak? | [Wright (1936)](https://doi.org/10.2514/8.155) |
| [Stock management with a supply-line delay](business/stock-management.xmile) | intermediate | Why does inventory overshoot when managers ignore the supply line, and what changes when they weight it fully? | [Sterman (1989)](https://doi.org/10.1287/mnsc.35.3.321) |
| [Workforce aging chain: hiring, training and attrition](business/workforce-aging-chain.xmile) | intro | Why does productivity per head fall just after a hiring surge even though total headcount is rising? | Sterman (2000) |

## Natural resources and economics

Harvested resources, depletion and the economics of extraction.

| Model | Level | Question | Source |
| --- | --- | --- | --- |
| [Easter Island: a Ricardo–Malthus resource model](resources/easter-island.xmile) | advanced | How can a society grow rapidly on a renewable resource and then collapse even though the resource can regenerate? | Brander (1998) |
| [Groundwater commons: the tragedy of the commons](resources/groundwater-commons.xmile) | intro | Why do two rational farmers keep expanding irrigation until the shared aquifer is depleted, and when does expansion stop? | [Hardin (1968)](https://doi.org/10.1126/science.162.3859.1243) |
| [Hubbert-style peak in a nonrenewable resource](resources/nonrenewable-depletion.xmile) | intermediate | Why does oil production rise, peak, and then decline even while demand and investment continue? | Hubbert (1956) |
| [Kaibab deer: predator removal and range overshoot](resources/kaibab-deer.xmile) | intro | What happens to a deer herd and its range when the predators that once kept the herd in check are removed? | [Rasmussen (1941)](https://doi.org/10.2307/1943204) |
| [Limits to growth: a population–resource–pollution toy](resources/limits-to-growth-toy.xmile) | intro | How do resource depletion and pollution combine to make a growing population overshoot and then decline? | Meadows (1972) |
| [Open-access fishery: bioeconomic equilibrium](resources/open-access-fishery.xmile) | intermediate | Where does an unregulated fishery end up, and why is that not the stock level that produces the largest sustainable catch? | [Gordon (1954)](https://doi.org/10.1086/257497) |

## Climate and the Earth system

Carbon, energy balance and feedbacks in the climate system.

| Model | Level | Question | Source |
| --- | --- | --- | --- |
| [Carbon pulse: how long does emitted CO2 stay in the air?](climate/carbon-pulse.xmile) | intermediate | If we emit a pulse of CO2 today, how much of it is still warming the climate in 20 years, in 100 years, and in 1000 years? | [Joos (2013)](https://doi.org/10.5194/acp-13-2793-2013) |
| [Daisyworld: biological regulation of planetary temperature](climate/daisyworld.xmile) | advanced | How can life regulate a planet's temperature without any foresight or feedback controller? | [Watson (1983)](https://doi.org/10.1111/j.1600-0889.1983.tb00031.x) |
| [Ice-albedo feedback: warm Earth and snowball Earth](climate/ice-albedo.xmile) | intermediate | Can the same amount of sunlight support either a warm Earth or a frozen Earth, and what decides which one you get? | [Budyko (1969)](https://doi.org/10.3402/tellusa.v21i5.10109) |
| [Two-layer ocean warming: fast and slow responses to CO2 forcing](climate/two-layer-warming.xmile) | intermediate | Why does most of the surface warming from CO2 happen in a few decades while the rest takes centuries? | [Held (2010)](https://doi.org/10.1175/2009JCLI3466.1) |
| [Zero-dimensional energy balance of the Earth](climate/energy-balance.xmile) | intro | Why does the Earth's average surface temperature settle near 288 K rather than heating without limit or freezing? | [North (1981)](https://doi.org/10.1029/RG019i001p00091) |

## Populations and ecology

Populations, food webs and the dynamics of living systems.

| Model | Level | Question | Source |
| --- | --- | --- | --- |
| [Lotka-Volterra predator and prey cycles](ecology/lotka-volterra.xmile) | intro | Why do predator and prey abundances cycle, and why does the cycle neither grow nor settle? | Lotka (1925) |
| [Rosenzweig-MacArthur model: the paradox of enrichment](ecology/rosenzweig-macarthur.xmile) | advanced | What happens to predator-prey stability when the prey carrying capacity is raised? | [Rosenzweig (1963)](https://doi.org/10.1086/282272) |
| [SIR epidemic in a closed population](ecology/sir-epidemic.xmile) | intro | How large is the final epidemic, and when does the number of infectious people peak? | [Kermack (1927)](https://doi.org/10.1098/rspa.1927.0118) |
| [U.S. population: Pearl and Reed's logistic curve](ecology/us-population-logistic.xmile) | intro | How well does a single logistic curve fitted to early census data predict the U.S. population a century later? | [Pearl (1920)](https://doi.org/10.1073/pnas.6.6.275) |

## Environmental problem solving

Structured exercises that turn a messy problem into a testable model.

| Model | Level | Question | Source |
| --- | --- | --- | --- |
| [Bioconcentration of a contaminant in fish](problem-solving/bioconcentration.xmile) | intro | How high does a contaminant build up in fish tissue, and how fast does it leave after exposure ends? | Harte (1988) |
| [Exponential growth and the rule of 70](problem-solving/doubling-time.xmile) | intro | How many times does a population double in a century at a 2 % annual growth rate? | Harte (1988) |
| [Lake phosphorus: Vollenweider steady state](problem-solving/lake-phosphorus.xmile) | intermediate | What phosphorus concentration should a lake reach for a given external load, flushing rate and sedimentation rate? | Harte (1988) |
| [Radon in a house](problem-solving/indoor-radon.xmile) | intro | How much does reducing the air-exchange rate raise indoor radon? | Harte (1988) |
| [Residence time of a pollutant in a well-mixed lake](problem-solving/residence-time.xmile) | intro | How long does a lake take to reach steady pollution, and how much pollutant does it hold then? | Harte (1988) |
