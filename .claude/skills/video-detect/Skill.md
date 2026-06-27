Role: Act as an expert FastAPI + OpenCV + YOLO/Ultralytics debugging engineer.

Project Context:
I am working on SafeSite AI, a PPE detection dashboard. The backend uses FastAPI, OpenCV, and YOLO/Ultralytics. The frontend uses React.js. There is a Video Detection page where the user uploads a video file for PPE detection.

Current Bug:
When I upload a short video, around 13 seconds long, the Video Detection page stays in an infinite “processing” state. The detection result is never shown on the video page. Also, because processing never completes properly, violations are not saved/displayed correctly.

Important:
This is not mainly a model accuracy issue. The main issue is that the uploaded video processing lifecycle does not finish correctly or the frontend never receives the completed result.

Strict Workflow:

1. Do not edit files yet.
2. First inspect the relevant backend and frontend files.
3. Explain the current video upload flow.
4. Identify exactly where the infinite processing state starts.
5. Provide a file-by-file fix plan.
6. Wait for my approval before modifying code.
7. Do not touch unrelated features such as auth, DeepFace, live WebRTC overlay, worker management, fine configuration, payroll, or routing unless directly required.

Files / Areas to Inspect:
Backend:

* Video upload detection endpoint/controller.
* Video processing loop using OpenCV `cv2.VideoCapture`.
* YOLO inference call inside the video loop.
* Video writer/output file generation.
* Any background job/task system for video detection.
* Any job status variable/table/cache.
* Any response returned to frontend after processing.
* Any exception handling that may swallow errors.
* Any cleanup code: `cap.release()`, `writer.release()`, temporary files.

Frontend:

* Video Detection page.
* Upload submit handler.
* Processing/loading state.
* API call to video detection endpoint.
* Polling/status check logic if used.
* Code that sets result video URL.
* Code that calls `setProcessing(false)` or equivalent.

Main Hypotheses to Verify:

1. Backend has a `while True` loop that does not break correctly when the video ends.
2. `cap.read()` returns `False`, but the loop continues instead of breaking.
3. `frame_count` or FPS is invalid, causing progress logic to never reach 100%.
4. YOLO inference is very slow because it processes every frame of the video.
5. Backend processes frames successfully but never releases the video writer, so the output file is incomplete.
6. Backend creates the output video but never returns the output URL/path to frontend.
7. Backend exception occurs during processing but is swallowed, leaving frontend stuck in loading state.
8. Frontend receives a response but does not update result state.
9. Frontend polling continues forever because backend job status stays `processing` and never changes to `completed` or `failed`.
10. Frontend does not have a timeout or error state for long-running video processing.

Required Debugging Logs:
Add or inspect logs like:

Backend:

* `[VIDEO_UPLOAD] received filename=...`
* `[VIDEO_PROCESS] opened=true fps=... frame_count=... duration=...`
* `[VIDEO_PROCESS] frame_index=... / total=...`
* `[VIDEO_PROCESS] cap.read failed/end of video reached`
* `[VIDEO_PROCESS] writer released`
* `[VIDEO_PROCESS] output saved path=...`
* `[VIDEO_PROCESS] completed result_url=...`
* `[VIDEO_PROCESS_FAILED] error=...`

Frontend:

* `[VIDEO_UI] upload started`
* `[VIDEO_UI] response received`
* `[VIDEO_UI] result url set`
* `[VIDEO_UI] processing false`
* `[VIDEO_UI] error=...`

Required Backend Fix:
After identifying the exact root cause, implement the smallest safe fix.

The video loop must:

* Open the uploaded video with `cv2.VideoCapture`.
* Validate that the video opened correctly.
* Read total frame count and FPS safely.
* Use a clear loop like:

```python
while True:
    ret, frame = cap.read()
    if not ret:
        break

    # process frame
```

* Never continue forever after `ret == False`.
* Release both capture and writer in a `finally` block.
* Return a clear response to frontend with:

  * success status
  * output video URL/path
  * processed frame count
  * detected violations count if available
  * message/error if failed

Required Frontend Fix:
The Video Detection page must:

* Set processing/loading to true when upload starts.
* On success, display the returned processed video/result.
* On failure, show a clear error message.
* Always stop loading in `finally`.
* If polling is used, stop polling when status becomes `completed` or `failed`.
* Add timeout protection so the UI does not stay in processing forever.

Performance Requirement:
For video upload, do not process every frame if it is too slow. Add or use a frame stride option, for example:

* Process every 5th frame for detection.
* Still write output video properly.
* Make this configurable, e.g. `VIDEO_DETECTION_FRAME_STRIDE=5`.

Violation Logging Requirement:
If video detection finds NO-Mask / NO-Hardhat / NO-SafetyVest:

* Confirm whether video upload should save violation records.
* If yes, ensure detected video violations call the same violation creation service or a video-specific logging function.
* Avoid duplicate records for every frame by using one record per violation type per video or one record every N seconds.

Constraints:

* Do not change database schema unless absolutely necessary.
* Do not break live camera detection.
* Do not break image upload detection.
* Do not break existing API response formats unless adding optional fields is necessary.
* Keep the fix small and testable.

Tests Required:

* Test with a 13-second MP4 video.
* Confirm backend logs show video start, frame progress, end-of-video, writer release, and completed response.
* Confirm frontend leaves processing state.
* Confirm processed video/result appears on the Video Detection page.
* Confirm no infinite polling continues after completion.
* Run backend unit tests if available.
* Run frontend build if frontend code is changed.

Manual Acceptance Criteria:

1. Uploading a 13-second video does not stay in infinite processing.
2. Backend reaches `[VIDEO_PROCESS] completed`.
3. Frontend receives the response.
4. Processing/loading indicator stops.
5. Processed video/result appears on the Video Detection page.
6. If violations are detected, they are logged according to project requirement.
7. Violations page/dashboard update after successful logging.
8. If processing fails, the UI shows an error instead of loading forever.

Before coding, provide:

* Root cause.
* Evidence from inspected files/logs.
* Exact file-by-file fix plan.
* Whether the issue is backend loop, backend response, frontend state, or polling.
* Tests to run.

Wait for my approval before implementation.
