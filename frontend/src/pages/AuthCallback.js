import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { authApi } from '../lib/api';

export default function AuthCallback() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const hash = location.hash || window.location.hash;
    const sessionId = new URLSearchParams(hash.replace('#', '?')).get('session_id');

    if (!sessionId) {
      navigate('/login');
      return;
    }

    const processSession = async () => {
      try {
        const res = await authApi.session(sessionId);
        login(res.data.access_token, res.data.user);
        navigate('/dashboard', { replace: true });
      } catch {
        navigate('/login');
      }
    };

    processSession();
  }, [location.hash, login, navigate]);

  return null;
}
