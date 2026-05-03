# SKILLS.md — Technical Expertise & Domain Knowledge

This file defines the specialized domains and engineering principles required to maintain and extend the **Construction PPE Detection / Safe Site AI System.**

## Core Competencies

### 1. Computer Vision (CV) Engineering
* **YOLO Inference**: Expert understanding of YOLOv8/v11 architectures, specifically focusing on real-time inference optimization, Non-Maximum Suppression (NMS), and confidence threshold tuning.
* **Frame Processing**: Proficient in `OpenCV` (cv2) for frame manipulation, drawing anti-aliased overlays, and handling MJPEG byte streams for high-frequency dashboard updates.
* **Model Mapping**: Deep knowledge of the 10-class PPE model (Hardhat, NO-Hardhat, Mask, NO-Mask, Safety Vest, NO-Safety Vest, Person, Safety Cone, Machinery, Vehicle).

### 2. High-Performance Asynchronous Python
* **FastAPI & Concurrency**: Mastery of `asyncio` for I/O-bound tasks (Alerts, DB, Webhooks) vs. `ThreadPoolExecutor` for CPU-bound tasks (YOLO inference).
* **Task Lifecycle**: Managing long-running camera tasks within the FastAPI `lifespan` context, ensuring clean resource teardown on shutdown.

### 3. Industrial Connectivity & Protocols
* **RTSP/ONVIF**: Expertise in managing IP camera streams, including handling network jitter, reconnection logic, and frame dropping to maintain real-time sync.
* **Industrial IoT (IIoT)**:
    * **MQTT**: Implementing Pub/Sub patterns for low-latency site alerts.
    * **Modbus/TCP**: Communicating with PLCs to trigger physical alarms or strobe lights on-site using libraries like `pymodbus`.
    * **Webhooks**: Standardizing violation payloads for Slack/Teams integration.

---

## 🏗 System Architecture Principles

### Temporal Consistency Logic
A single frame detection is **not** a violation. The system must use stateful tracking:
* **Persistence**: A "No-Hardhat" event is only triggered after a person is detected without a hardhat for a sustained period (`VIOLATION_PERSIST_SECONDS`).
* **Cooldown**: Prevent "Alert Fatigue" by implementing a cooldown window (`ALERT_COOLDOWN_SECONDS`) per camera.

### Alert Dispatcher Isolation
The `AlertDispatcher` must follow a **fan-out pattern**:
* All handlers (Email, MQTT, Webhook, DB) must execute concurrently.
* Failure in one handler (e.g., SMTP timeout) must **never** block or crash other handlers or the main detection loop.

---

## 📏 Implementation Guidelines

> **The Golden Rule**: Never block the `asyncio` event loop. All blocking I/O (cv2, YOLO, Modbus) must be wrapped in `loop.run_in_executor(None, func)`.

### Detection Target Classes
The model monitors 10 specific classes as defined in the repository configuration:
1.  **Hardhat** / **NO-Hardhat**
2.  **Mask** / **NO-Mask**
3.  **Safety Vest** / **NO-Safety Vest**
4.  **Person**
5.  **Safety Cone**
6.  **Machinery**
7.  **Vehicle**

---

## ⚖️ Safety & Compliance Knowledge
* **OSHA/HSE Basics**: Understanding the requirement for "Head Protection" and "High-Visibility" in construction zones.
* **Data Privacy**: Knowledge of handling worker privacy, including storing frames locally and managing resolution for stored violation snapshots.