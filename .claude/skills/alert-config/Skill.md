Implement FR_11 Alert Config UI in the SafeSite AI project.

Context:
SafeSite AI already has real-time alert dispatch logic for Email/SMTP, MQTT, and Webhook when a violation is logged. Now add a simple admin UI so the admin can configure these alert channels from the dashboard.

Goal:
Create an Alert Configuration settings page/form where admin can add/update SMTP, MQTT, and Webhook values.

Before coding:

1. Inspect the existing backend alert dispatcher, settings/config files, environment variables, alert_log model/table, and alert routes if any.
2. Inspect existing frontend admin pages, routing, API client, form styles, loading states, toast/error handling, and dashboard layout.
3. Reuse existing project patterns. Do not create a new architecture unnecessarily.

Frontend Requirements:

1. Add a new page or section named “Alert Configuration” in the admin/settings area.
2. Add navigation link if an admin/settings sidebar/navbar already exists.
3. Create three configuration cards or tabs:

   * SMTP Email
   * MQTT Broker
   * Webhook
4. Each card should have an enable/disable toggle.
5. SMTP form fields:

   * enabled
   * SMTP host
   * SMTP port
   * username
   * password/app password
   * sender email
   * receiver email
   * use TLS/SSL option if backend supports it
6. MQTT form fields:

   * enabled
   * broker host
   * broker port
   * topic
   * username/password only if backend supports authentication
7. Webhook form fields:

   * enabled
   * webhook URL
8. Add Save button for each section or one Save All button.
9. Show loading state while saving.
10. Show success message after saving.
11. Show clear validation/API errors.
12. Mask secret fields after saving. Do not display saved passwords in plain text.

Validation:

1. If a channel is enabled, required fields must be filled.
2. SMTP port and MQTT port must be numeric.
3. Email fields must have valid email format.
4. Webhook URL must start with http:// or https://.
5. Do not allow empty webhook URL if webhook is enabled.
6. Do not silently fail if backend rejects the settings.

Backend Requirements:

1. Use existing alert settings/config route if available.
2. If no route exists, add minimal backend routes consistent with existing FastAPI structure:

   * GET /api/v1/alerts/config
   * PUT /api/v1/alerts/config
   * optional POST /api/v1/alerts/test
3. Store settings using the existing project configuration approach.
4. Do not expose secret values such as SMTP password or MQTT password in GET response. Return masked values only.
5. Ensure AlertDispatcher reads the latest saved settings when dispatching alerts.
6. If the project currently uses only .env values, keep .env as fallback and allow UI/database config to override it.
7. Do not break existing alert dispatch behavior.
8. Do not break violation logging, worker management, fine configuration, payroll report, or dashboard pages.

Optional Test Button:
Add a “Test Alert” button only if it can be done safely with existing alert dispatcher logic.
The test button should:

1. Send a sample alert through the selected configured channel.
2. Show success/failure result.
3. Record result in alert_log if the existing system already logs alert attempts.

Security Rules:

1. Never store alert secrets in frontend localStorage.
2. Never print passwords in console logs.
3. Never return raw passwords from backend APIs.
4. Do not commit real SMTP, MQTT, or webhook credentials.
5. Keep placeholder/example values only.

Acceptance Checklist:
The feature is complete when:

1. Admin can open Alert Configuration page.
2. SMTP settings can be entered and saved.
3. MQTT settings can be entered and saved.
4. Webhook URL can be entered and saved.
5. Disabled channels are skipped by alert dispatcher.
6. Enabled channels are used by alert dispatcher.
7. Secrets are masked after save.
8. Validation works properly.
9. Success and error messages are shown professionally.
10. Frontend build passes.
11. Backend starts without errors.
12. Existing features are not broken.

Run checks:

* npm run build
* npm run lint if available
* python -m uvicorn backend.main:app --reload if backend changed

Final response after coding:

1. List files changed.
2. Explain frontend UI added.
3. Explain backend/API behavior added or reused.
4. Explain how secrets are handled.
5. Mention commands run and results.
6. Mention any manual step still required.
