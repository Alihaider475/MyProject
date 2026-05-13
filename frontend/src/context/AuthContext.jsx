import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const AuthContext = createContext(null);

function isAdminUser(user) {
  return user?.user_metadata?.role === 'admin';
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
        localStorage.setItem('ppe-token', session.access_token);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      syncAdminFlag(session);
      if (session?.access_token) {
        localStorage.setItem('ppe-token', session.access_token);
      } else {
        localStorage.removeItem('ppe-token');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    localStorage.removeItem('ppe-token');
    sessionStorage.removeItem('admin_auth');
  }

  const user = session?.user ?? null;
  const isAdmin = isAdminUser(user);

  return (
    <AuthContext.Provider value={{ session, user, loading, logout, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
