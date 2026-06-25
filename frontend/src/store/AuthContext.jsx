import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../services/supabase.js';

const AuthContext = createContext(null);

// Default landing pages per role — used on login and when a user is
// redirected away from a route their role isn't allowed to view.
export const ADMIN_HOME = '/admin/register-workers';
export const USER_HOME = '/dashboard';
export const WORKER_HOME = '/worker/dashboard';

function isAdminUser(user) {
  return user?.user_metadata?.role === 'admin';
}

function isWorkerUser(user) {
  return user?.user_metadata?.role === 'worker';
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  function syncAdminFlag(session) {
    if (isAdminUser(session?.user)) {
      sessionStorage.setItem('admin_auth', 'true');
    } else {
      sessionStorage.removeItem('admin_auth');
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      syncAdminFlag(session);
      if (session?.access_token) {
        sessionStorage.setItem('ppe-token', session.access_token);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      syncAdminFlag(session);
      if (session?.access_token) {
        sessionStorage.setItem('ppe-token', session.access_token);
      } else {
        sessionStorage.removeItem('ppe-token');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    sessionStorage.removeItem('ppe-token');
    sessionStorage.removeItem('admin_auth');
  }

  const user = session?.user ?? null;
  const isAdmin = isAdminUser(user);
  const isWorker = isWorkerUser(user);

  return (
    <AuthContext.Provider value={{ session, user, loading, logout, isAdmin, isWorker }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
