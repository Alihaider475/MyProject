# Frontend assets

Local image/static assets imported by React components live here.

## Swapping the landing-page hero visual for a real photo

The landing page (`src/pages/LandingPage.jsx`) currently renders a self-contained
SVG/CSS "live detection" mockup (`<DetectionPreview />` → `<WorkerSilhouette />`).
To replace the silhouette with a real construction-worker photo:

1. Add an image here, e.g. `frontend/src/assets/worker.jpg`
   (recommended ~4:3 aspect ratio, a worker wearing a hard hat + safety vest).
2. At the top of `src/pages/LandingPage.jsx` add:

   ```js
   import workerImg from '../assets/worker.jpg';
   ```

3. In the `DetectionPreview` component, replace `<WorkerSilhouette />` with:

   ```jsx
   <img
     src={workerImg}
     alt="Construction worker wearing a hard hat and safety vest detected by SafeSite AI"
     className="absolute inset-0 w-full h-full object-cover"
   />
   ```

The detection bounding boxes and badges are positioned with percentages, so they
keep lining up reasonably over a real photo (nudge the `top`/`left`/`width`/`height`
values in the `<DetBox />` calls if needed).
