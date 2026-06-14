import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { api } from '../../api/client.js';

// ─── Thunks ────────────────────────────────────────────────────────────────
// Fetch is skipped if a fetch is already in flight or has already completed —
// CameraGrid, LiveFeed, FilterBar and TopOffendersPage all dispatch this on
// mount, but only the first call hits the network.
export const fetchCameras = createAsyncThunk(
  'cameras/fetchCameras',
  () => api.listCameras(),
  {
    condition: (_, { getState }) => {
      const { loading, loaded } = getState().cameras;
      return !loading && !loaded;
    },
  }
);

export const addCamera = createAsyncThunk(
  'cameras/addCamera',
  (form) => api.createCamera(form)
);

export const editCamera = createAsyncThunk(
  'cameras/editCamera',
  ({ id, body }) => api.updateCamera(id, body)
);

export const removeCamera = createAsyncThunk(
  'cameras/removeCamera',
  async (id) => {
    await api.deleteCamera(id);
    return id;
  }
);

export const startCamera = createAsyncThunk(
  'cameras/startCamera',
  async (id) => {
    await api.startCamera(id);
    return id;
  }
);

export const stopCamera = createAsyncThunk(
  'cameras/stopCamera',
  async (id) => {
    await api.stopCamera(id);
    return id;
  }
);

const initialState = {
  items: [],
  loaded: false,
  loading: false,
  error: null,
  startStopLoadingById: {},
  countsByCameraId: {},
};

function findCamera(items, id) {
  return items.find((c) => String(c.id) === String(id));
}

const camerasSlice = createSlice({
  name: 'cameras',
  initialState,
  reducers: {
    setCameraCounts(state, action) {
      const { cameraId, counts } = action.payload;
      state.countsByCameraId[cameraId] = counts;
    },
    clearCameraCounts(state, action) {
      delete state.countsByCameraId[action.payload];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchCameras.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchCameras.fulfilled, (state, action) => {
        state.loading = false;
        state.loaded = true;
        state.items = action.payload;
      })
      .addCase(fetchCameras.rejected, (state, action) => {
        state.loading = false;
        state.loaded = true;
        state.error = action.error.message;
      })
      .addCase(addCamera.fulfilled, (state, action) => {
        state.items.push(action.payload);
      })
      .addCase(editCamera.fulfilled, (state, action) => {
        const idx = state.items.findIndex((c) => c.id === action.payload.id);
        if (idx !== -1) state.items[idx] = action.payload;
      })
      .addCase(removeCamera.fulfilled, (state, action) => {
        state.items = state.items.filter((c) => c.id !== action.payload);
      })
      .addCase(startCamera.pending, (state, action) => {
        state.startStopLoadingById[String(action.meta.arg)] = true;
      })
      .addCase(startCamera.fulfilled, (state, action) => {
        delete state.startStopLoadingById[String(action.payload)];
        const cam = findCamera(state.items, action.payload);
        if (cam) cam.is_running = true;
      })
      .addCase(startCamera.rejected, (state, action) => {
        delete state.startStopLoadingById[String(action.meta.arg)];
      })
      .addCase(stopCamera.pending, (state, action) => {
        state.startStopLoadingById[String(action.meta.arg)] = true;
      })
      .addCase(stopCamera.fulfilled, (state, action) => {
        delete state.startStopLoadingById[String(action.payload)];
        const cam = findCamera(state.items, action.payload);
        if (cam) cam.is_running = false;
      })
      .addCase(stopCamera.rejected, (state, action) => {
        delete state.startStopLoadingById[String(action.meta.arg)];
      });
  },
});

export const { setCameraCounts, clearCameraCounts } = camerasSlice.actions;
export default camerasSlice.reducer;

// ─── Selectors ─────────────────────────────────────────────────────────────
export const selectCameras = (state) => state.cameras.items;
export const selectCamerasLoaded = (state) => state.cameras.loaded;
export const selectCamerasLoading = (state) => state.cameras.loading;
export const selectStartStopLoading = (id) => (state) =>
  !!state.cameras.startStopLoadingById[String(id)];
export const selectCameraCounts = (id) => (state) =>
  state.cameras.countsByCameraId[id] ?? null;
