---
name: email
description: >
  Use this skill when working on anything related to email alerts,
  EmailHandler, async SMTP, violation email notifications, email
  templates, attachment handling, SMTP authentication, aiosmtplib,
  email retry logic, or any code that sends an email when a PPE
  violation occurs.
version: 1.0.0
project: Construction-PPE-Detection
module: app/alerts/email_handler.py
triggers:
  - EmailHandler
  - email alert
  - SMTP
  - aiosmtplib
  - send_email
  - email notification
  - violation email
  - SENDER_EMAIL
  - RECEIVER_EMAIL
  - EMAIL_PASSWORD
  - email template
  - snapshot attachment
  - email retry
  - Gmail App Password
---

# Email Alert Skill

This skill governs how Claude reads, writes, debugs, and extends the
email alert handler of the PPE Detection System. The email handler is
one of several **alert consumers** in the AlertDispatcher fan-out chain.
Its only job is to send a formatted email with violation details and
an optional snapshot attachment when a ViolationEvent is dispatched.

---

## METADATA

| Field           | Value                                              |
|-----------------|----------------------------------------------------|
| Module path     | `app/alerts/email_handler.py`                      |
| Base class      | `AlertHandler` in `app/alerts/base.py`             |
| Main class      | `EmailHandler`                                     |
| Library         | `aiosmtplib` (async SMTP)                          |
| Activation      | Enabled only when `SENDER_EMAIL` is set in `.env`  |
| Snapshot attach | Reads from `FRAMES_DIR/frame_path` on disk         |
| Test location   | `tests/unit/test_email_handler.py`                 |
| Registered in   | `AlertDispatcher` handler list                     |

### Key Config Variables

| Variable          | Purpose                                             |
|-------------------|-----------------------------------------------------|
| `SENDER_EMAIL`    | Gmail address used to send alerts                   |
| `RECEIVER_EMAIL`  | Admin email address that receives alerts            |
| `EMAIL_PASSWORD`  | Gmail App Password (not account password)           |
| `SMTP_HOST`       | SMTP server host (default: `smtp.gmail.com`)        |
| `SMTP_PORT`       | SMTP port (default: `587` for STARTTLS)             |
| `EMAIL_RETRY_COUNT` | Number of retry attempts on send failure          |
| `EMAIL_RETRY_DELAY` | Seconds to wait between retry attempts            |
| `FRAMES_DIR`      | Root directory to resolve snapshot file path        |

### Email Content Per Violation

| Field       | Value                                                |
|-------------|------------------------------------------------------|
| Subject     | `[PPE ALERT] {violation_type} — Camera {camera_id}` |
| Body        | Camera ID, violation type, confidence %, timestamp   |
| Attachment  | Snapshot jpg if `frame_path` exists on disk          |
| From        | `SENDER_EMAIL`                                       |
| To          | `RECEIVER_EMAIL`                                     |
| Encoding    | UTF-8, MIME multipart when attachment present        |

### Gmail Setup Requirements

| Requirement         | Detail                                           |
|---------------------|--------------------------------------------------|
| 2-Step Verification | Must be enabled on the Gmail account             |
| App Password        | Generate at myaccount.google.com/apppasswords    |
| Less Secure Apps    | Not used — App Password is the correct method    |
| SMTP Host           | `smtp.gmail.com` port `587` with STARTTLS        |

---

## WORKFLOW

Claude must follow these steps **in order** every time it works on the
email handler.

### Step 1 — Check Activation Gate First
Before writing or editing any email logic, confirm that `EmailHandler`
is only activated when `SENDER_EMAIL` is set in config. If
`SENDER_EMAIL` is an empty string, the handler must register itself
as inactive and the `AlertDispatcher` must skip it silently.
Never send email when credentials are not configured.

### Step 2 — Confirm Handler Isolation in AlertDispatcher
Verify that `EmailHandler.send()` is wrapped in its own `try/except`
inside `AlertDispatcher`. A failed email (SMTP timeout, wrong password,
network error) must never prevent `DatabaseHandler` or `MQTTHandler`
from executing. Email failure is isolated — it logs an error and returns.

### Step 3 — Build the MIME Message Before Connecting to SMTP
Construct the full `MIMEMultipart` message object (subject, body,
attachment) before opening the SMTP connection. Never open a connection
and then discover the attachment file is missing. Build first,
connect second.

### Step 4 — Attach Snapshot Only If File Exists on Disk
Before attaching the snapshot, confirm the file exists at
`FRAMES_DIR / frame_path`. If the file does not exist, send the email
without the attachment and log a warning. Never raise an exception
because a snapshot file is missing — the violation still needs to
be reported.

### Step 5 — Use aiosmtplib for Async SMTP
All SMTP operations must use `aiosmtplib` — never Python's built-in
`smtplib`. The built-in `smtplib` is synchronous and will block the
FastAPI event loop during the entire SMTP handshake and send operation.
The connection sequence is: `connect → starttls → login → sendmail → quit`.

### Step 6 — Apply Retry Logic With Delay
If the SMTP send fails, retry up to `EMAIL_RETRY_COUNT` times with
`EMAIL_RETRY_DELAY` seconds between attempts using `asyncio.sleep`.
After all retries are exhausted, log the final error and return —
never raise to the caller. The AlertDispatcher must not receive
an exception from this handler.

### Step 7 — Always Close SMTP Connection
The SMTP connection must be closed after every send attempt, whether
it succeeded or failed. Use a `try/finally` block to guarantee
`smtp.quit()` is called. An unclosed SMTP connection leaks a TCP
socket and may exhaust the server's connection limit over time.

### Step 8 — Log Every Outcome
Log the result of every send attempt:
- Success → `INFO` — include camera ID, violation type, receiver
- Retry attempt → `WARNING` — include attempt number and error
- Final failure → `ERROR` — include all attempts exhausted message
- Skipped (no credentials) → `DEBUG` — handler inactive

### Step 9 — Update or Write Tests After Every Change
After any change to email logic, update or add tests in
`tests/unit/test_email_handler.py`. Tests must cover:
- Handler is skipped when `SENDER_EMAIL` is empty
- Email is sent with correct subject and body fields
- Snapshot is attached when file exists on disk
- Email sends without attachment when snapshot file is missing
- Retry logic fires on SMTP failure up to `EMAIL_RETRY_COUNT`
- SMTP connection is closed even when send fails
- Exception from SMTP does not propagate to AlertDispatcher

---

## RULES

### MUST DO

- **MUST** check `SENDER_EMAIL` is set before activating the handler —
  skip silently if credentials are not configured
- **MUST** use `aiosmtplib` for all SMTP operations —
  never Python's synchronous `smtplib`
- **MUST** wrap the entire send operation in `try/except` so exceptions
  never propagate to `AlertDispatcher`
- **MUST** build the full MIME message before opening SMTP connection
- **MUST** verify snapshot file exists on disk before attaching it —
  send without attachment if file is missing
- **MUST** use `STARTTLS` on port `587` for Gmail —
  never send credentials over an unencrypted connection
- **MUST** close the SMTP connection in a `finally` block after
  every send attempt regardless of success or failure
- **MUST** retry up to `EMAIL_RETRY_COUNT` times with
  `asyncio.sleep(EMAIL_RETRY_DELAY)` between attempts
- **MUST** log every outcome — success, retry, failure, and skip
- **MUST** read all credentials and SMTP settings from config —
  never hardcode email addresses, passwords, or host values
- **MUST** use Gmail App Password — never the Gmail account password

### MUST NOT

- **MUST NOT** use Python's built-in `smtplib` — it blocks the event loop
- **MUST NOT** raise exceptions from `send()` to the caller —
  catch all, log, and return
- **MUST NOT** open an SMTP connection before the MIME message is built
- **MUST NOT** attach a snapshot file without first confirming it exists
- **MUST NOT** hardcode `smtp.gmail.com`, port numbers, email addresses,
  or retry counts anywhere in the handler source file
- **MUST NOT** send email when `SENDER_EMAIL` is empty or unset
- **MUST NOT** leave SMTP connections open after send completes —
  always call `smtp.quit()` in a `finally` block
- **MUST NOT** block retry delays with `time.sleep()` —
  always use `await asyncio.sleep()` to keep the event loop free
- **MUST NOT** send the Gmail account password in `EMAIL_PASSWORD` —
  only Gmail App Passwords work with SMTP when 2FA is enabled

### DECISION RULES

- **Send without attachment over not sending at all**: A missing snapshot
  file must never prevent the violation email from being sent —
  evidence in the body is better than no alert
- **Isolation over propagation**: Email failures are contained inside
  the handler — they never cancel or delay other alert handlers
- **Async always**: Any SMTP alternative library must be evaluated for
  async support before adoption — synchronous SMTP is never acceptable
- **Credentials in config only**: If an email address or password appears
  anywhere other than `.env` and `config.py`, it is a security violation
- **Retry with backoff on transient errors**: Network timeouts and
  temporary SMTP rejections are retried — authentication failures
  (wrong password) are logged immediately without retry

---

## ANTI-PATTERN TABLE

| Anti-Pattern | Why It's Harmful |
|---|---|
| Using `smtplib.SMTP` in `async def` | Blocks entire FastAPI event loop during SMTP handshake — all API requests freeze |
| Raising SMTP exception to AlertDispatcher | One failed email cancels MQTT and PLC alerts for the same violation |
| Opening SMTP connection before building MIME message | Holds TCP connection open while reading snapshot from disk — wastes server connection slots |
| Attaching snapshot without checking file exists | Raises `FileNotFoundError` mid-send — email never delivered |
| Hardcoding `smtp.gmail.com` in source | Breaks when switching to SendGrid, Outlook, or corporate SMTP |
| Using `time.sleep()` for retry delay | Blocks event loop for full retry delay — no requests served during wait |
| Storing Gmail account password in `EMAIL_PASSWORD` | Authentication fails when 2FA is on — App Password is required |
| Not closing SMTP in `finally` block | TCP socket leaks — Gmail blocks further connections after limit reached |
| Sending email when `SENDER_EMAIL` is empty | Runtime crash on every violation when email is not configured |

---

*Place this file at `.claude/skills/email/SKILL.md`
Claude reads it before touching any email alert logic in the project.*
