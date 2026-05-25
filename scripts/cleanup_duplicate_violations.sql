-- One-time cleanup: remove duplicate violations within the same minute window
-- Run this in Supabase SQL Editor after deploying the dedup fix.

-- Step 1: Remove fines referencing duplicate violations
DELETE FROM fines WHERE violation_id IN (
  SELECT id FROM violations WHERE id NOT IN (
    SELECT MIN(id) FROM violations
    GROUP BY camera_id, violation_type,
      DATE_TRUNC('minute', timestamp)
  )
);

-- Step 2: Remove alert logs referencing duplicate violations
DELETE FROM alert_log WHERE violation_id NOT IN (
  SELECT MIN(id) FROM violations
  GROUP BY camera_id, violation_type,
    DATE_TRUNC('minute', timestamp)
);

-- Step 3: Remove duplicate violations (keep earliest per minute window)
DELETE FROM violations WHERE id NOT IN (
  SELECT MIN(id) FROM violations
  GROUP BY camera_id, violation_type,
    DATE_TRUNC('minute', timestamp)
);
