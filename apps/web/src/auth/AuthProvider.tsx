import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AuthResponse,
  AuthUser,
  LoginInput,
  RegisterInput,
} from '@zakupki/shared';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (input: LoginInput) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMe(): Promise<AuthUser | null> {
  try {
    return await api<AuthUser>('/auth/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
    staleTime: 60_000,
    retry: false,
  });

  const setUser = useCallback((user: AuthUser | null) => qc.setQueryData(['me'], user), [qc]);

  const login = useCallback(
    async (input: LoginInput) => {
      const res = await api<AuthResponse>('/auth/login', { method: 'POST', body: input });
      setUser(res.user);
      return res.user;
    },
    [setUser],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const res = await api<AuthResponse>('/auth/register', { method: 'POST', body: input });
      setUser(res.user);
      return res.user;
    },
    [setUser],
  );

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' });
    setUser(null);
    qc.clear();
  }, [setUser, qc]);

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ['me'] });
  }, [qc]);

  const value = useMemo<AuthContextValue>(
    () => ({ user: data ?? null, loading: isLoading, login, register, logout, refresh }),
    [data, isLoading, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
