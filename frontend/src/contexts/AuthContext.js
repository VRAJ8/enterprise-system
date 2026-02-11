import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Initialize from localStorage synchronously to prevent flash
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('user');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [loading, setLoading] = useState(() => {
    // If we have a token in localStorage, set loading false immediately
    // (user is already set from localStorage above)
    return !localStorage.getItem('token');
  });
  const [token, setToken] = useState(() => localStorage.getItem('token'));

  // Background verify - don't block rendering
  useEffect(() => {
    const verify = async () => {
      const savedToken = localStorage.getItem('token');
      if (!savedToken) {
        setLoading(false);
        return;
      }
      try {
        const res = await authApi.me();
        setUser(res.data);
        localStorage.setItem('user', JSON.stringify(res.data));
      } catch {
        // Token is invalid - clear auth
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setUser(null);
        setToken(null);
      }
      setLoading(false);
    };
    verify();
  }, []);

  const login = useCallback((tokenValue, userData) => {
    localStorage.setItem('token', tokenValue);
    localStorage.setItem('user', JSON.stringify(userData));
    setToken(tokenValue);
    setUser(userData);
  }, []);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch {}
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  }, []);

  const updateUser = useCallback((userData) => {
    setUser(userData);
    localStorage.setItem('user', JSON.stringify(userData));
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
};
