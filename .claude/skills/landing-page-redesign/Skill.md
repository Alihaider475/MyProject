SafeSite AI Landing Page Redesign Skill
Purpose
Use this skill when improving the SafeSite AI home/start/landing page so it looks professional, project-related, and suitable for a final year project demo.
SafeSite AI is an AI-powered PPE compliance monitoring system for construction and industrial sites. It detects missing hard hats, safety vests, and masks using YOLO. It supports live cameras, multi-camera monitoring, violation logging, violation history, analytics, worker identification, real-time alerts, and admin management.
When to Use
Use this skill when the user asks to improve, redesign, polish, modernize, or make the landing/start/home page more project-related.
Typical user requests:
Improve the home page.
Make the start page look more professional.
Add construction worker image.
Make the landing page related to PPE detection.
Improve SafeSite AI first screen for demo.
Make the landing page less empty and less generic.
Current Problem
The current landing page is clean but too empty and generic. It has a dark hero section, title, short text, one button, and three feature cards. It does not visually communicate construction safety, PPE detection, live monitoring, worker identification, or violation logging strongly enough.
Main Goal
Improve the landing page so it clearly represents a construction PPE detection system. The page should look like a polished SafeSite AI final year project/demo landing page, not a generic AI template.
Non-Negotiable Rules
Do not break existing routing.
Do not change backend APIs.
Do not change authentication logic.
Do not redesign the entire application theme unless absolutely necessary.
Preserve the existing dark/cyan visual identity, but make it more polished and safety-focused.
Keep the page responsive for desktop, tablet, and mobile.
Do not use random external stock image URLs if avoidable.
Prefer a local asset inside `frontend/src/assets/` or an existing local image.
If a placeholder worker image is used, make it easy to replace later.
Do not make the page look overly decorative or AI-generated.
Keep text concise, technical, and project-specific.
Ensure `npm run build` passes.
Do not commit changes automatically. Leave changes uncommitted for review.
Required Landing Page Improvements
1. Hero Section
Convert the current empty centered hero into a professional two-column hero.
Left side:
Brand title: `SafeSite AI`
Subtitle: `Real-Time PPE Compliance Monitoring`
Short description mentioning YOLO, live cameras, violation logging, and safety alerts.
Primary CTA: `Enter Dashboard`
Secondary CTA: `View Violations` or `See Demo`
Optional mini stats such as:
Real-time detection
Multi-camera support
Automated logging
Right side:
Construction worker/PPE safety visual OR dashboard preview card.
Worker image should relate to helmet, vest, mask, construction site, or safety monitoring.
Add subtle overlay badges around the visual:
Helmet Detection
Vest Detection
Mask Detection
Live AI Monitoring
2. Feature Cards
Replace generic cards with project-specific cards. Use six compact cards:
Real-Time PPE Detection
Multi-Camera Monitoring
Automated Violation Logging
Worker Identification
Safety Alerts
Analytics & Reports
Use consistent icons, colors, spacing, card borders, and hover effects.
3. How It Works Section
Add a small responsive section with four steps:
Connect Camera
Run YOLO Detection
Log Violations
Notify Safety Manager
This section should be simple, not too large.
4. Project Credibility / Tech Section
Add a compact technology/project section using pills or badges:
React
FastAPI
YOLO
OpenCV
WebSocket
MJPEG
PostgreSQL / SQLite
Supabase
5. Footer
Replace generic footer text with:
`SafeSite AI — Final Year Project`
Add short supporting text:
`AI-based construction safety monitoring system.`
Visual Design Guidelines
Use dark gradient background.
Add a subtle grid pattern or radial glow, but keep it professional.
Use cyan/blue for brand accent.
Use red/orange only for violation/safety warning badges.
Use green only for safe/active status.
Reduce excessive vertical empty space between hero and cards.
Use balanced spacing, modern cards, and consistent typography.
Avoid too many accent colors.
Avoid cartoonish or childish visuals.
The page should look suitable for a university FYP demo and real software presentation.
Accessibility Requirements
Add proper `alt` text for the worker image.
Maintain strong text/background contrast.
Keep buttons keyboard-accessible.
Avoid tiny unreadable text.
Use semantic links/buttons where possible.
Implementation Workflow
Step 1: Inspect First
Before making changes, inspect:
Current landing/home/start page component.
App routing to confirm where the start page is rendered.
Related CSS/Tailwind files.
Existing assets folder.
Existing button/navigation behavior.
Step 2: Implement Safely
Update only the landing/start page and necessary shared style files.
Add/reuse a suitable local image asset if available.
Preserve the route behavior of `Enter Dashboard`.
If current logic redirects unauthenticated users to login, preserve it.
Do not modify dashboard, auth, backend, Redux, API services, or unrelated pages unless required.
Step 3: Validate
Run:
```bash
cd frontend
npm run build
```
If there is an existing chunk-size warning, mention it as non-blocking if the build succeeds.
Step 4: Final Report
After implementation, report:
Files changed.
Assets/images added.
Layout improvements made.
Build result.
Any placeholder image or text the user may want to replace manually.
Any assumptions made.
Suggested Copy Text
Use concise text similar to this:
Title:
`SafeSite AI`
Subtitle:
`Real-Time PPE Compliance Monitoring`
Description:
`Monitor construction sites with YOLO-powered live camera analysis, automated violation logging, worker identification, and instant safety alerts.`
Primary CTA:
`Enter Dashboard`
Secondary CTA:
`View Violations`
Feature card descriptions:
Real-Time PPE Detection: `Detect missing helmets, vests, and masks from live camera feeds.`
Multi-Camera Monitoring: `Track multiple site zones from one unified dashboard.`
Automated Violation Logging: `Record violation type, camera, confidence, timestamp, and worker details.`
Worker Identification: `Link violations to registered workers using face recognition.`
Safety Alerts: `Notify managers through email, MQTT, or webhook integrations.`
Analytics & Reports: `Review trends, export reports, and support payroll deduction workflows.`
Output Expectation
The final landing page should be more visual, project-specific, and demo-ready while keeping the existing SafeSite AI dark/cyan identity intact.