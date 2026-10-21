# Legacy model-file format (`.stm` / `.itm`) — field-level notes

> Notes for SourceSink's legacy importer. Everything below was derived from
> observing sample model files (hex dumps, byte-format strings, differential
> comparison of files). Each conclusion cites a concrete offset in a named
> sample file; the sample files themselves are not part of this repository.

- Canonical exemplars: `sample-01.stm` (23,510 bytes, `.stm`),
  `sample-02.stm` (11,618), `sample-03.stm` (335,506),
  `sample-04.itm` (`.itm`).
- The `.stm` and `.itm` variants are **one format**. The only
  observed difference is the 4-byte application/model tag in the header.

---

## 1. File header / preamble (128 bytes, `0x00`–`0x7F`)

Every file begins with the same 12-byte fixed preamble, then two 4-byte ASCII
tags, then a fixed 4-byte value, then zero fill to `0x80`.

| Offset | Size | Value (observed) | Meaning |
|---|---|---|---|
| `0x00` | u16 LE | `06 00` (= 6) | format/serializer version major |
| `0x02` | u16 LE | `06 00` (= 6) | version minor |
| `0x04` | 4 bytes | `80 00 00 80` | constant stamp (all files) |
| `0x08` | 4 bytes | `FA D5 FA DE` | constant signature; `FA D5` / `FA DE` read big-endian (`0xFAD5`, `0xFADE` — "FADE"-family magic). Constant across every file, incl. name changes → **not** a checksum. |
| `0x0C` | 4 bytes ASCII | `STL2` (`.stm`) · `ithn` (`.itm`) | **application tag** (which variant authored the file) |
| `0x10` | 4 bytes ASCII | `STM2` (`.stm`) · `ithm` (`.itm`) | **model tag** (which variant last saved it) |
| `0x14` | u32 LE | `01 00 00 00` (= 1) | format "generation" (constant = 1) |
| `0x18`–`0x7F` | 104 bytes | `00` * 104 | reserved / zero pad |
| `0x80` | — | `Book\0…` | first entry of the type directory (see §2) |

Raw header of `sample-01.stm`:

``
00000000  06 00 06 00 80 00 00 80 fa d5 fa de 53 54 4c 32   ............STL2
00000010  53 54 4d 32 01 00 00 00 00 00 00 00 00 00 00 00   STM2............
``

Notes:

- **Tag observations across the corpus** (see §6 for the full matrix): `.stm` files
  carry `STL2`/`STM2`; `.itm` files carry `ithn`/`ithm` (all-lowercase). Some
  `.STM` files ship with a *mixed* `ithn` + `STM2` (e.g. `sample-05.stm`,
  `sample-06.stm`) — models authored as `.itm` but last saved as `.stm`, or vice
  versa. Both tags always end in `2` → **format version 2**.


---

## 2. Type directory ("table of contents"), from `0x80`

Immediately after the preamble is a linear directory that enumerates every
**class/type** the file knows about. It is a sequence of records:

``
entry := name 0x00   0x00  type_id  kind  flags
         ^--^ NUL           ^16-bit-ish meta (4 bytes)
``

So each entry is:

| Field | Size | Meaning |
|---|---|---|
| `name` | variable | ASCII, NUL-terminated type name (`Book`, `C_String`, `entity_struct`, …) |
| `0x00` | 1 | terminator of `name` |
| `pad` | 1 | always `0x00` (constant) |
| `type_id` | u8 | 1-based index of the class (`1`, `2`, `3`, … in order of appearance) |
| `kind` | u8 | `1` = simple class · `2` = composite class (see below) |
| `flags` | u8 | `0` default · `1` or `2` for instanced/arrayed classes (low confidence) |

The directory **starts at `0x80`** and ends at a byte whose high bit/pattern no
longer forms a printable name (i.e. the next NUL-terminated "name" is empty or
non-ASCII). The number of entries varies with model size — 58 (the smallest samples)
up to 82 (`sample-03.stm`, `sample-07.itm`). `sample-01.stm` has
63 entries; its directory ends at `0x44F`.

First entries of `sample-01.stm` (type_id → name):

``
#01 Book            #02 C_String   #03 Print_Setup  #04 TPrint
#05 Startup         #06 Sound_Tab   #07 LIST         #08 Book_Prefs
#09 Act             #10 List        #11 Scene        #12 Drawing_Model
#13 Draw_Specs      #14 diagram_struct_array         #15 Dependents
...
``

Full 63-entry list is reproducible with `src/legacy` (`parseStm()`).

`kind` byte (**partial**: the `1`/`2` split is reliable, the meaning is inferred):

- `kind = 1` — leaf classes: primitives (`C_String`, `LIST`, `int16_array`,
  `double_array`, `token_type_array`, `token_type`, `run_handle_array`) and the
  singletons (`Book`, `Act`, `Scene`, `Pad`, `Panel`, `Draw_Specs`, `Run_Specs`, …).
- `kind = 2` — composite classes that are serialized through a per-class object
  table (many named instances / a child graph): `List`, `Drawing_Model`,
  `Dependents`, `Model`, `entity_struct`, `diagram_struct`, `Draw_Index`,
  `Poster_Info`, `curve_type`, `Model_Index`, `Picture_array`.

---

## 3. Serialized object graph (after the directory)

The directory is followed by a flat serialized object graph. Each object is
introduced by a **two-byte tag**:

``
object := prefix  type_id  payload…
``

| Field | Size | Meaning |
|---|---|---|
| `prefix` | u8 | serialization *mode* (see table below) |
| `type_id` | u8 | class id — the 1-based index from the directory (§2) |

Object **forms** (verified by tokenizing all 85 unique sample models
byte-for-byte to end of file — `src/legacy/src/objects.ts`). All multi-byte
header fields are big-endian. Some forms *declare* a class's record size; the
"reuse" forms then take that size for later objects of the same class:

| form | header after `type_id` | payload | sets class size? |
|---|---|---|---|
| `c0` | — | none (null / absent field) | |
| `c1` | — | declared size; `C_String` is NUL-terminated instead | |
| `c9`, `cb` | u8 | declared size | |
| `ca` | u8 object number | none (back-reference) | |
| `cc` | u8 size | `size` bytes | no |
| `d0` | u16 object number | none (back-reference) | |
| `d1`, `d2` | u16 | declared size | |
| `d3` | u8 capacity, u8 size | `size` bytes | no |
| `d4` | u16 size | `size` bytes | no |
| `d9` | u8 capacity, u8 size, u8 tag | `size` bytes | **yes** |
| `de` | u16 capacity, u16 size | `size` bytes | no |
| `e5` | u16 capacity, u16 size, u8 tag | `size` bytes | **yes** |
| `e8` | u16 capacity, u16 size, u16 tag | `size` bytes | **yes** |
| `f4` | *(class id is u16)* u24 capacity, u24 size, u24 tag | `size` bytes + 1 trailing byte | no |

Back-reference numbers count every non-null object in stream order from 0
(`Book` = 0). `f4` only occurs for large embedded QuickDraw pictures. Objects
of a composite class are followed by their child objects (fields) in a fixed
order — see §9 for `entity_struct`.

Because `type_id` always matches the directory index, the directory both *names*
every tag and *sizes* the schema. That is why `entity_struct`, `Dependents`,
`Simulation_Model`, `Run_Specs` etc. appear as plaintext — they are the class
names of the in-memory C data model, leaked into the file.

---

## 4. Primitive encodings

### 4.1 `C_String` (type_id 2) — **decoded**

``
cc 02  n  char0 char1 … char(n-2)  0x00
``
- `n` is a **u8 = string length + 1** (it *counts the trailing NUL*).
- The string is raw 8-bit (extended-ASCII), terminated with `0x00`.

Examples (`sample-01.stm`):

| offset | `n` | content |
|---|---|---|
| `0x0A3C` | `10` (16) | a 15-character variable name |
| `0x0A4F` | `19` (25) | a 24-character equation (leading space) |
| `0x0C0B` | `5D` (93) | a multi-line equation (contains `0x0D` line breaks) |
| `0x4EA7` | `3A` (58) | a notice string (starts `0xA9` = ©) |

(Every variable name and equation in the model is stored this way.)

### 4.2 IEEE-754 doubles — big-endian

Numeric data is **big-endian binary64** (PowerPC heritage).
Verified by exact byte match:

- `10000.0` = `40 c3 88 00 00 00 00 00` at `sample-01.stm:0x20C6` (Inventory init).
- `1.0` = `3f f0 00 00 00 00 00 00` at `0x20CE`.
- The `labor_ratio` lookup curve is stored as the run `0.2, 0.4, 0.6, 0.8, 1.0,
  1.2, 1.4, 1.6, 1.8, 2.0` (`3f c9 99…9a`, `3f d9 99…9a`, … `40 00 …`)
  starting at `0x2B2F`.

### 4.3 `token_type_array` (type_id 31 / `0x1F`) — **decoded**

Compiled-equation token lists. Layout observed at `0x0E60` (equation
`productivity*4`, 3 tokens) and `0x0C7E` (`change_in_wages`, 14 tokens):

``
d2 1f  (count*4)  count  0x000000_count(BE)   token0 token1 … token(count-1)
``

| offset | bytes | meaning |
|---|---|---|
| `0x0E60` | `d2 1f 0c 03 00 00 00 03 c1 20 …` | `0c`=12=4·3; `03`=count; u32 BE `3` = count; 3 × `c1 20 …` tokens |
| `0x0C7E` | `d2 1f 38 0e 00 00 00 0e c1 20 …` | `0x38`=56=4·14; `0e`=count; u32 BE `14` = count; 14 tokens |

`count` is therefore stored **three** ways: `4·count` (u8), `count` (u8), and
`count` (u32 BE). Each `token_type` (`c1 20`):
`opcode` (u8), then a u16 operand (0–1 bytes used): e.g. `c1 20 00 16` = push
variable #0x16 = 22 → `productivity`; `c1 20 00 00 04` = push constant `4`;
`c1 20 00 03 0b` = binary operator (`multi`). **RPN** by construction.

### 4.4 `LIST` (type_id 7) — **partially decoded**

A `LIST` is `d2 07` followed by a (partially understood) header, then a sequence
of `c0 <type_id>` element references. At `sample-01.stm:0x065A`:

``
d2 07  a4 00 … (header)  c0 06   c0 0a   c0 0a   c0 0a   c0 10   c0 07   d9 11 …
``
→ a list whose first elements are a `Sound_Tab` (#06), three `List`s (#0A), a
`Script` (#10), and a `LIST` (#07). The header fields (`a4`, and in other lists a
`98`) are believed to be a size/capacity count but are **not yet confirmed**.

### 4.5 `int16_array` (type_id 29 / `0x1D`) — **partially decoded**

16-bit integer arrays (`cc 1d …`). Elements are little-endian u16. The element
count field is present but its exact layout differs from `token_type_array`'s
three-way count; **to be confirmed**.

### 4.6 `double_array` (type_id 30 / `0x1E`) — **partially decoded**

`double_array` payloads are runs of big-endian binary64. In the frequent inline
form `c1 1e` the element count is **implicit** (known to the parent object), e.g.
`0x2B7F` (`3f d0…` = 0.25, `3f c7…` ≈ 0.225, `3f c0…` = 0.125, …). A second,
rarely-seen form `d9 1e` carries extra leading bytes before the values
(`0x2B22`); **to be confirmed**.

---

## 5. Higher-level sections (directory classes)

Sections referenced in the plan, with directory `type_id`, `kind`, and inferred
role:

| section | type_id | kind | role (inferred from name + evidence) |
|---|---|---|---|
| `Book` | 1 | 1 | root document object; first thing serialized after directory |
| `C_String` | 2 | 1 | string primitive (§4.1) |
| `LIST` | 7 | 1 | list primitive (§4.4) |
| `List` | 10 | 2 | composite list (List-of-records) |
| `Drawing_Model` | 12 | 2 | the graphical map (nodes/edges as `diagram_struct`s) |
| `diagram_struct_array` | 14 | 1 | array of `diagram_struct` |
| `Dependents` | 15 | 2 | **topological dependency graph** between entities |
| `Manuscript` | 18 | 1 | manuscript (text/documentation blocks) |
| `Model` | 21 | 2 | model container (holds equations/variables) |
| `Subscript_Set_List` | 22 | 1 | list of `Subscript_Set` |
| `Subscript_Set` | 23 | 1 | one subscript set (dimension) — instance names seen e.g. `Subscript_Set_1` |
| `Array` | 24 | 1 | subscript/array instance |
| `Simulation_Model` | 25 | 1 | simulation model (topology override of `Model`) |
| `Run_Specs` | 26 | 1 | run specs (DT, start/stop, save interval, integrator) |
| `entity_struct_array` | 27 | 1 | array of `entity_struct` |
| `entity_struct` | 28 | 2 | **one variable** (stock/flow/converter/connector): name, equation, init |
| `int16_array` | 29 | 1 | int16 primitive (§4.5) |
| `double_array` | 30 | 1 | double primitive (§4.6) |
| `token_type_array` | 31 | 1 | compiled-equation token list (§4.3) |
| `token_type` | 32 | 1 | single RPN token |
| `run_handle_array` | 33 | 1 | simulation run handles |
| `draw_*`/`graph_type`/`curve_type`/`Model_Index` | 34–47 | 2 | graph/table output settings |
| `diagram_struct` | 38 | 2 | one diagram node/edge (position, glyph, wiring) |
| font/window/picture records | 55–63 | 1 | `Font_Map`, `Window_List`, `Model_Window`, `Pad_Window`, … |

Every model variable is kept as a `C_String` name plus an `entity_struct`, a
`token_type_array` and numeric arrays, and its equation string is stored
verbatim.

---

## 6. Header tags across the corpus

`ascii @0x0C` / `@0x10` per file (all share `06 00 06 00 80 00 00 80 fa d5 fa de`,
u32@0x14 = 1):

| product | tag1 | tag2 |
|---|---|---|
| `.stm` | `STL2` | `STM2` |
| `.itm` | `ithn` | `ithm` |
| mixed `.STM` (`.itm`-authored, `.stm`-saved) | `ithn` | `STM2` |

Examples: `sample-01.stm`, `sample-02.stm`, `sample-08.stm` → `STL2/STM2`;
`sample-04.itm`, `sample-09.stm`, `sample-10.stm`, `sample-11.stm`, `sample-12.stm` →
`ithn/ithm`; `sample-05.stm`, `sample-06.stm`, `sample-13.stm`, `sample-14.stm`,
`sample-15.stm`, `sample-16.stm`, `sample-17.stm`, `sample-18.stm` → `ithn/STM2`.

---

## 7. Confidence table

| item | status | confidence |
|---|---|---|
| 128-byte preamble, app/model tags | decoded | high |
| type directory | decoded | high |
| object framing (all forms, §3) | decoded — 85/85 files tokenize to EOF | high |
| `C_String` text encoding = Mac OS Roman | decoded | high |
| doubles = big-endian binary64; int16 arrays = big-endian u16 | decoded | high |
| `entity_struct` kind byte and child layout (§9.1) | decoded | high |
| graph point count + x range in struct (§9.2) | decoded | high |
| stock non-negative flag, struct byte 283 bit 0 (§9.2) | decoded | high |
| `Run_Specs` start/stop/DT/time units (§10) | decoded | high |
| `Run_Specs` integration method, save interval | unknown | — |
| `diagram_struct` glyph, position, entity index (§11) | decoded | high |
| connector geometry, labels, sectors | not needed yet | — |
| conveyor transit time and leak fraction (§9.4) | decoded | high |
| oven capacity @160, fill time @176 (§9.5) | inferred from dialog defaults | medium — verify against reference output |
| conveyor inflow limit (@168?) | not observed finite in any sample | low |
| arrays: one record per element, resolved equations (§9.6) | decoded | high |
| array subscript sets (`Subscript_Set`, `A_Subscript`) | not needed — element records suffice | — |
| `token_type` opcode map (RPN) | not needed — equation text is stored verbatim | — |

---

## 8. Remaining unknowns / next steps

1. Confirm oven capacity/fill-time offsets and the oven "one at a time"
   accept option against reference output. Conveyor flags at byte 283 (`18`, `64`).
2. Arrays: subscript sets, element records `Name[i]`, and kinds `z`/`u`/`y`.
3. Integration method and DT-related options in `Run_Specs`.
4. Flow-specific bits at struct byte 283 (`0x40` seen on 6 flows).

---

## 9. `entity_struct` — one model variable

Each variable is an `entity_struct` object with a **306-byte** payload,
followed by its child objects. Variables are numbered 0, 1, 2, … by **slot**:
every `entity_struct` object in stream order, *including null ones* — a
deleted variable leaves a null slot that keeps its number. Every
cross-reference below uses that number. (`sample-06.stm` has 35 variables in
137 slots; its conveyor exit `receiving_raw_materials` is slot 136.)

### 9.1 Child objects (in order)

| # | class | meaning |
|---|---|---|
| 0 | `C_String` | name (underscores for spaces) |
| 1 | `C_String` | equation text, verbatim (stock: initial value) |
| 2 | `int16_array` | inputs — variables this equation reads |
| 3 | `int16_array` | outputs — variables that read this one |
| 4 | `int16_array` | stock: inflows · flow: source stock |
| 5 | `int16_array` | stock: outflows · flow: sink stock |
| 6 | `double_array` | graph x values (null when evenly spaced) |
| 7 | `double_array` | graph y values (null when not a graph) |
| 8 | `token_type_array` | compiled equation (count), then N `token_type` objects |
| … | `run_handle_array` | run results handle (null in saved files) |
| next | `C_String` | documentation text |

Evidence: `sample-19.stm` — `capturing` (#1) has inputs `[2, 3]`
(`Customers`, `referral_multiplier`), source `[0]`, sink `[2]`;
`Potential_Customers` (#0) has outflows `[1]`.

### 9.2 Struct payload (306 bytes)

| offset | size | meaning |
|---|---|---|
| 0 | u8 ASCII | **kind**: `s` stock · `f` uniflow · `b` biflow · `c` converter · `l` conveyor · `m` conveyor exit · `k` conveyor leak · `q` queue · `u` queue outflow · `z` oven · `y` oven outflow · `g`/`S` sector |
| 2 | u16 | name length |
| 4 | u16 | equation length |
| 6 | u16 | number of inputs |
| 8 | u16 | number of outputs |
| 14 | u16 | graph point count (0 = no graph) |
| 16 | f64 | graph x minimum |
| 24 | f64 | graph x maximum |
| 32 | u16 | variable number |
| 283 | u8 | stocks: bit 0 = **non-negative** |

Byte 283 evidence: 164 stocks have `3`, 120 have `2`; it is clear on stocks
that must go negative (`sample-06.stm` `YTD_profit\loss`, `sample-20.itm`
`Cumulative_Net_Income`, both `sample-21.stm` stocks) and set on inventories,
machines and labor pools.

### 9.3 Equation text

Text is Mac OS Roman: `≥` (0xB3), `≤` (0xB2), `≠` (0xAD) are comparison
operators, `…` (0xC9) appears in placeholder comments. `{ … }` is a comment;
`\r` separates lines. Names may contain `$ % \ ' &`, which the importer quotes.

### 9.4 Conveyors and queues

A conveyor (`l`) stores **no transit time of its own**: its exit flow (`m`)
holds the transit-time expression in its equation slot, and each leak flow
(`k`) holds its leak fraction (`sample-22.itm`:
`xfer_to_verification = posting_process_time`; `sample-23.itm`:
`Beer_in_Transit` = 8 with exit `arrivals` = 2, the 2-week shipping delay).
A conveyor's initial value may be a comma list (`100,100,100` over a transit
of 3) giving its contents along the belt. A queue (`q`) is drained by `u`
flows. Equations may call `TRANSTIME(conveyor)` and `CYCLETIME(outflow)`.

### 9.5 Dialog settings shared by every variable

Every `entity_struct` carries the same block of doubles; ordinary variables
hold the dialog *defaults*. Matching them to the documented defaults:

| offset | default | meaning (inferred) |
|---|---|---|
| 160 | 1 (INF on conveyors) | **capacity** — oven capacity default 1, conveyor capacity default INF |
| 168 | 1 (INF on conveyors) | conveyor inflow limit (default INF); an oven's last sampled cook time |
| 176 | INF | **oven fill time**; 0 = the "DT" option (take the next in line) |

`sample-24.itm` ticket agents: capacity 3, fill time 0 (DT).
`sample-25.itm` treatment rooms: capacity 1, fill time INF. An oven (`z`) has a
single outflow (`y`) whose equation is the **cook time**, sampled when the
door closes.

### 9.6 Arrays

An arrayed variable has a parent record (`Prey`, often with a placeholder
equation) plus **one record per element** (`Prey[South,Hares]`) with its own
resolved equation, wiring and graph. The importer flattens arrays to those
element records; `ARRAYSUM/ARRAYMEAN/ARRAYSTDDEV(x[*])` expand to the matching
elements. Elements have no diagram glyph of their own.

## 10. `Run_Specs`

106-byte payload: f64 start @0, f64 stop @8, f64 DT @16, f64 (+∞ in all
samples) @24, then u32 fields not yet identified, and the NUL-terminated time
unit name @64 (`Time`, `Minutes`, `seconds`, …).

## 11. `diagram_struct` — one diagram glyph

97-byte payload: u8 glyph @0 (`s` stock, `f` flow valve, `c` converter, `a`
connector arrow, others for text/buttons/sectors), i16 y @1, i16 x @3
(QuickDraw point order: vertical first), u16 variable number @17. Flow pipes
are `Point_array` children (pairs of i16 y, x).
