---
name: plc
description: >
  Use this skill when working on anything related to PLC alerts,
  PLCHandler, Modbus TCP, coil control, register mapping, pymodbus,
  siren trigger, strobe light control, physical alarm activation,
  PLC reconnection logic, or any code that sends a signal to a
  Programmable Logic Controller when a PPE violation occurs.
version: 1.0.0
project: Construction-PPE-Detection
module: app/alerts/plc_handler.py
triggers:
  - PLCHandler
  - PLC
  - Modbus
  - ModbusTCP
  - pymodbus
  - coil
  - register
  - siren
  - strobe
  - physical alarm
  - PLC_HOST
  - PLC_PORT
  - PLC_COIL
  - write_coil
  - holding register
  - PLC trigger
  - industrial alert
---

# PLC Alert Skill

This skill governs how Claude reads, writes, debugs, and extends the
PLC alert handler of the PPE Detection System. The PLC handler is the
**physical world interface** of the pipeline — it translates a software
ViolationEvent into a real electrical signal that activates sirens,
strobe lights, or barrier gates on the construction site.
A mistake in this module can trigger or suppress a physical alarm
with real safety consequences.

---

## METADATA

| Field           | Value                                               |
|-----------------|-----------------------------------------------------|
| Module path     | `app/alerts/plc_handler.py`                         |
| Base class      | `AlertHandler` in `app/alerts/base.py`              |
| Main class      | `PLCHandler`                                        |
| Protocol        | Modbus TCP (port 502)                               |
| Library         | `pymodbus` (run via `run_in_executor`)              |
| Activation      | Enabled only when `PLC_HOST` is set in `.env`       |
| Physical output | Coil HIGH for `PLC_COIL_DURATION` seconds then LOW  |
| Test location   | `tests/unit/test_plc_handler.py`                    |
| Registered in   | `AlertDispatcher` handler list                      |

### Key Config Variables

| Variable              | Purpose                                           |
|-----------------------|---------------------------------------------------|
| `PLC_HOST`            | IP address of the PLC device                      |
| `PLC_PORT`            | Modbus TCP port (default: `502`)                  |
| `PLC_COIL_ADDRESS`    | Coil register address to write (e.g. `0`)         |
| `PLC_COIL_DURATION`   | Seconds coil stays HIGH before auto-reset to LOW  |
| `PLC_UNIT_ID`         | Modbus unit/slave ID (default: `1`)               |
| `PLC_TIMEOUT`         | TCP connection timeout in seconds (default: `3`)  |
| `PLC_RETRY_COUNT`     | Number of retry attempts on connection failure    |
| `PLC_RETRY_DELAY`     | Seconds between retry attempts                    |
| `PLC_VIOLATION_MAP`   | Optional mapping of violation type to coil address|

### Modbus Coil Control Sequence

| Step | Action              | Value  | Effect on Site          |
|------|---------------------|--------|-------------------------|
| 1    | Write coil HIGH     | `True` | Siren/strobe activates  |
| 2    | Wait `PLC_COIL_DURATION` | —  | Alarm continues         |
| 3    | Write coil LOW      | `False`| Siren/strobe deactivates|

### Violation to Coil Mapping (Default)

| Violation Type  | Coil Address | Physical Output     |
|-----------------|--------------|---------------------|
| NO_HARDHAT      | 0            | Siren channel 1     |
| NO_VEST         | 1            | Siren channel 2     |
| NO_MASK         | 2            | Strobe light        |
| Any violation   | 0            | Single shared siren |

### Modbus Function Codes Used

| Function Code | Name              | Purpose                      |
|---------------|-------------------|------------------------------|
| FC01          | Read Coils        | Verify coil state before write|
| FC05          | Write Single Coil | Activate / deactivate output |

---

## WORKFLOW

Claude must follow these steps **in order** every time it works on the
PLC handler.

### Step 1 — Check Activation Gate First
Before writing or editing any PLC logic, confirm that `PLCHandler`
is only activated when `PLC_HOST` is set in config. If `PLC_HOST`
is an empty string, the handler registers as inactive and
`AlertDispatcher` skips it silently. Never attempt a Modbus TCP
connection when PLC address is not configured.

### Step 2 — Confirm Handler Isolation in AlertDispatcher
Verify that `PLCHandler.send()` is wrapped in its own `try/except`
inside `AlertDispatcher`. A failed PLC trigger (device offline, network
timeout, wrong unit ID) must never prevent `DatabaseHandler`,
`EmailHandler`, or `MQTTHandler` from executing. PLC failure is
isolated — it logs an error and returns. Other alerts still fire.

### Step 3 — Run pymodbus in run_in_executor
The `pymodbus` library is synchronous. Every Modbus TCP connection,
coil write, and disconnect call must run inside
`loop.run_in_executor(None, ...)`. Never call `client.connect()`,
`client.write_coil()`, or `client.close()` directly inside `async def`
— they block the FastAPI event loop during the full TCP round-trip
to the PLC device.

### Step 4 — Resolve Coil Address From Violation Type
Before connecting to the PLC, resolve which coil address to write
based on the `violation_type` from the ViolationEvent. Use
`PLC_VIOLATION_MAP` from config if defined, otherwise default to
`PLC_COIL_ADDRESS`. Never hardcode coil addresses in the handler logic.

### Step 5 — Connect With Timeout Before Writing
Open the Modbus TCP connection using `PLC_TIMEOUT` as the connection
timeout. If the connection fails within the timeout, do not attempt
to write the coil. A failed connect must trigger the retry logic in
Step 7, not a coil write attempt on a closed connection.

### Step 6 — Write Coil HIGH Then LOW With Duration
The coil activation sequence must be:
1. Write coil HIGH (`True`) — activates physical alarm
2. `await asyncio.sleep(PLC_COIL_DURATION)` — alarm duration
3. Write coil LOW (`False`) — deactivates physical alarm

The LOW write in step 3 is **mandatory**. A coil left HIGH
permanently means the siren never stops until someone manually
resets the PLC. This is a safety hazard on a live construction site.

### Step 7 — Apply Retry Logic on Connection Failure
If the Modbus TCP connection fails, retry up to `PLC_RETRY_COUNT`
times with `await asyncio.sleep(PLC_RETRY_DELAY)` between attempts.
Retry on connection failures only — do not retry if the coil write
itself succeeds but the reset (LOW) write fails. In that case,
log a critical error and attempt the LOW write one final time.

### Step 8 — Always Close Modbus Connection
The Modbus TCP connection must be closed after every operation,
whether it succeeded or failed. Use a `try/finally` block to guarantee
`client.close()` is called. An unclosed Modbus connection holds a
TCP socket open and may exhaust the PLC's maximum connection limit,
locking out other controllers on the network.

### Step 9 — Log Every Outcome With Severity
Log the result of every PLC operation:
- Coil HIGH success → `INFO` — include camera ID, violation type, coil address
- Coil LOW success → `INFO` — include coil address and duration
- Coil LOW failure → `CRITICAL` — siren may be stuck ON, manual reset needed
- Retry attempt → `WARNING` — include attempt number and PLC host
- Final failure → `ERROR` — include all attempts exhausted message
- Skipped (no PLC host) → `DEBUG` — handler inactive

### Step 10 — Update or Write Tests After Every Change
After any change to PLC logic, update or add tests in
`tests/unit/test_plc_handler.py`. Tests must cover:
- Handler is skipped when `PLC_HOST` is empty
- Correct coil address resolved from violation type
- pymodbus calls run via `run_in_executor` not directly
- Coil HIGH is written before sleep, coil LOW after sleep
- Retry logic fires on connection failure up to `PLC_RETRY_COUNT`
- Modbus connection is closed in finally block
- Coil LOW is attempted even when HIGH write partially fails
- Exception from PLC does not propagate to AlertDispatcher

---

## RULES

### MUST DO

- **MUST** check `PLC_HOST` is set before activating the handler —
  skip silently if PLC address is not configured
- **MUST** run all `pymodbus` calls via `run_in_executor` —
  pymodbus is synchronous and must never touch the event loop directly
- **MUST** wrap the entire coil operation in `try/except` so exceptions
  never propagate to `AlertDispatcher`
- **MUST** resolve coil address from violation type before connecting —
  never hardcode coil addresses in handler logic
- **MUST** write coil LOW after `PLC_COIL_DURATION` seconds in every
  case — a permanently HIGH coil is a physical safety hazard
- **MUST** use `await asyncio.sleep(PLC_COIL_DURATION)` for alarm
  duration — never `time.sleep()`
- **MUST** set connection timeout to `PLC_TIMEOUT` before connecting —
  never connect without a timeout on industrial hardware
- **MUST** close Modbus connection in a `finally` block after every
  operation regardless of success or failure
- **MUST** retry connection failures up to `PLC_RETRY_COUNT` times
  with `await asyncio.sleep(PLC_RETRY_DELAY)` between attempts
- **MUST** log coil LOW failures at `CRITICAL` level —
  a stuck siren requires immediate human intervention
- **MUST** read all PLC settings from config — never hardcode
  IP address, port, coil address, unit ID, or timing values

### MUST NOT

- **MUST NOT** call `client.connect()` or `client.write_coil()`
  directly inside `async def` without `run_in_executor`
- **MUST NOT** skip the coil LOW write after the alarm duration —
  the physical siren must always be deactivated after `PLC_COIL_DURATION`
- **MUST NOT** raise exceptions from `send()` to the caller —
  catch all, log, and return
- **MUST NOT** connect to PLC without setting a connection timeout —
  a hung TCP connect to offline hardware blocks the executor thread
- **MUST NOT** hardcode coil address `0`, PLC IP, port `502`, or
  unit ID `1` anywhere in the handler source file
- **MUST NOT** trigger a PLC when `PLC_HOST` is empty or unset
- **MUST NOT** leave Modbus connections open after operation completes —
  always call `client.close()` in a `finally` block
- **MUST NOT** use `time.sleep()` for coil duration or retry delays —
  always use `await asyncio.sleep()` to keep the event loop free
- **MUST NOT** retry the coil write after a successful HIGH write —
  only retry on initial connection failures before any write occurs
- **MUST NOT** silently swallow a coil LOW failure —
  it must be logged at `CRITICAL` level immediately

### DECISION RULES

- **LOW write is non-negotiable**: Even if the violation event is
  cancelled or the session is shutting down, the coil LOW write must
  be attempted — a stuck physical siren is a higher risk than a
  delayed shutdown
- **Isolation over propagation**: PLC failures are fully contained —
  a PLC going offline must never prevent email or MQTT alerts from
  reaching the admin
- **Timeout always on industrial hardware**: PLC devices do not
  return connection refused — they simply stop responding. Without a
  timeout, a connect attempt hangs the executor thread indefinitely
- **Critical log on LOW failure**: A failed coil reset is not an
  ordinary error — it is a physical safety event that requires a
  human to manually reset the PLC on site
- **Config over code**: If a coil address or PLC IP appears anywhere
  other than `.env` and `config.py` it is a maintenance hazard —
  site engineers change hardware addresses without touching source code

---

## ANTI-PATTERN TABLE

| Anti-Pattern | Why It's Harmful |
|---|---|
| Calling `client.write_coil()` in `async def` without executor | Blocks entire FastAPI event loop during Modbus TCP round-trip to PLC |
| Skipping coil LOW write after alarm duration | Siren runs continuously until someone physically resets PLC on site |
| No timeout on Modbus TCP connect | Executor thread hangs indefinitely when PLC is offline — detection loop degrades |
| Raising PLC exception to AlertDispatcher | One offline PLC cancels email and MQTT alerts for the same violation |
| Hardcoding coil address `0` in source | Different sites have different PLC wiring — hardcode breaks every new deployment |
| Using `time.sleep()` for coil duration | Blocks event loop for full alarm duration — all API requests freeze during siren |
| Not closing Modbus connection in finally | TCP socket leaks — PLC hits max connection limit and rejects all future connects |
| Retrying coil write after HIGH already written | Triggers alarm twice — double siren burst confuses workers on site |
| Silent `CRITICAL` on LOW failure | Siren stuck ON, nobody notified — safety incident escalates without human response |
| Connecting without `PLC_UNIT_ID` set | Wrong slave responds — write goes to unintended PLC output on multi-device network |

---

*Place this file at `.claude/skills/plc/SKILL.md`
Claude reads it before touching any PLC alert logic in the project.*
