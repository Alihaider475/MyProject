import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://whchabyglamkdhmcwzxv.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndoY2hhYnlnbGFta2RobWN3enh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzOTU2OTgsImV4cCI6MjA5Mzk3MTY5OH0.UQJsuDvk7KHQ55tUuNAGKFo_XHWWUEyhN_ecOZ2yMFU';

// Remove any stale token left in localStorage from before sessionStorage migration
localStorage.removeItem('ppe-token');

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: window.sessionStorage,
    persistSession: true,
  },
});
