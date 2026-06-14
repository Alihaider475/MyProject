import { configureStore } from '@reduxjs/toolkit';
import camerasReducer from '../features/cameras/camerasSlice.js';
import violationsReducer from '../features/violations/violationsSlice.js';

export const store = configureStore({
  reducer: {
    cameras: camerasReducer,
    violations: violationsReducer,
  },
});
