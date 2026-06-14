import { createSlice } from '@reduxjs/toolkit';

export const DEFAULT_FILTERS = {
  time: '7d',
  camera_id: '',
  violation_type: '',
  resolved: '',
  track_id: '',
  worker_id: '',
};

const initialState = {
  filters: { ...DEFAULT_FILTERS },
  pagination: { page: 1, pageSize: 25 },
};

const violationsSlice = createSlice({
  name: 'violations',
  initialState,
  reducers: {
    // Full replace — used by ViolationsPage on mount to seed filters from the URL.
    initFilters(state, action) {
      state.filters = { ...DEFAULT_FILTERS, ...action.payload };
      state.pagination.page = 1;
    },
    setFilters(state, action) {
      state.filters = { ...state.filters, ...action.payload };
      state.pagination.page = 1;
    },
    clearFilters(state) {
      state.filters = { ...DEFAULT_FILTERS };
      state.pagination.page = 1;
    },
    clearPersonFilter(state) {
      state.filters.track_id = '';
      state.filters.worker_id = '';
      state.pagination.page = 1;
    },
    setPage(state, action) {
      state.pagination.page = action.payload;
    },
  },
});

export const { initFilters, setFilters, clearFilters, clearPersonFilter, setPage } =
  violationsSlice.actions;
export default violationsSlice.reducer;

// ─── Selectors ─────────────────────────────────────────────────────────────
export const selectViolationFilters = (state) => state.violations.filters;
export const selectViolationPagination = (state) => state.violations.pagination;
