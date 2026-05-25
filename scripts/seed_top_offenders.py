"""Seed script for top offenders test data.

Creates sample workers and violations across multiple cameras with
a mix of identified (worker_id) and unidentified (track_id only) entries.

Usage:
    python -m scripts.seed_top_offenders
"""
from __future__ import annotations

import asyncio
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.models import Camera, Violation, Worker
from backend.db.session import async_engine, get_db, AsyncSessionLocal


WORKERS = [
    {"employee_id": "EMP-001", "name": "Ahmed Khan", "department": "Construction"},
    {"employee_id": "EMP-002", "name": "Ali Raza", "department": "Electrical"},
    {"employee_id": "EMP-003", "name": "Usman Tariq", "department": "Plumbing"},
    {"employee_id": "EMP-004", "name": "Bilal Hussain", "department": "Welding"},
    {"employee_id": "EMP-005", "name": "Farhan Sheikh", "department": "Construction"},
]

VIOLATION_TYPES = ["NO-Hardhat", "NO-Mask", "NO-Safety Vest"]
CAMERA_IDS = [1, 2, 3]


async def seed():
    async with AsyncSessionLocal() as db:
        # Ensure cameras exist
        for cam_id in CAMERA_IDS:
            existing = (await db.execute(select(Camera).where(Camera.id == cam_id))).scalar_one_or_none()
            if not existing:
                db.add(Camera(id=cam_id, name=f"Camera {cam_id}", source_type="webcam", source_uri=str(cam_id - 1)))
                print(f"  Created Camera {cam_id}")

        # Upsert workers
        worker_ids = []
        for w in WORKERS:
            existing = (await db.execute(
                select(Worker).where(Worker.employee_id == w["employee_id"])
            )).scalar_one_or_none()
            if existing:
                worker_ids.append(existing.id)
                print(f"  Worker '{w['name']}' already exists (id={existing.id})")
            else:
                worker = Worker(**w)
                db.add(worker)
                await db.flush()
                worker_ids.append(worker.id)
                print(f"  Created worker '{w['name']}' (id={worker.id})")

        await db.commit()

        # Create violations
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        violations = []

        # Identified workers: 60 violations spread across workers and cameras
        for _ in range(60):
            wid = random.choice(worker_ids)
            cam = random.choice(CAMERA_IDS)
            vtype = random.choice(VIOLATION_TYPES)
            ts = now - timedelta(hours=random.uniform(0.5, 48))
            track = random.randint(1, 20)
            violations.append(Violation(
                camera_id=cam,
                violation_type=vtype,
                confidence=round(random.uniform(0.6, 0.99), 2),
                timestamp=ts,
                worker_id=wid,
                track_id=track,
            ))

        # Unidentified tracked persons: 50 violations (no worker_id, only track_id)
        # Use a few specific track_ids per camera to simulate recurring unknowns
        unknown_tracks = {1: [50, 51, 52], 2: [60, 61], 3: [70, 71, 72, 73]}
        for _ in range(50):
            cam = random.choice(CAMERA_IDS)
            track = random.choice(unknown_tracks[cam])
            vtype = random.choice(VIOLATION_TYPES)
            ts = now - timedelta(hours=random.uniform(0.5, 48))
            violations.append(Violation(
                camera_id=cam,
                violation_type=vtype,
                confidence=round(random.uniform(0.55, 0.95), 2),
                timestamp=ts,
                worker_id=None,
                track_id=track,
            ))

        db.add_all(violations)
        await db.commit()
        print(f"\n  Seeded {len(violations)} violations ({60} identified, {50} unidentified)")
        print("  Done!")


if __name__ == "__main__":
    asyncio.run(seed())
