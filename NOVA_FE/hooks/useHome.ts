"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  api,
  type GoogleService,
  type Me,
  type UpdateMeInput,
} from "@/lib/api";

export type Notice =
  | { kind: "success"; service: GoogleService }
  | { kind: "error"; message: string }
  | null;

export interface HomeState {
  me: Me | null;
  loading: boolean;
  loadError: boolean;
  notice: Notice;
  connectedCount: number;
}

export interface HomeActions {
  retry: () => void;
  logout: () => Promise<void>;
  saveProfile: (input: UpdateMeInput) => Promise<void>;
  connect: (service: GoogleService) => Promise<void>;
  disconnect: (service: GoogleService) => Promise<void>;
  dismissNotice: () => void;
}

const SERVICES: GoogleService[] = ["calendar", "contacts", "gmail"];

function isGoogleService(value: string | null): value is GoogleService {
  return value !== null && (SERVICES as string[]).includes(value);
}

export function useHome(): HomeState & HomeActions {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const started = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await api.getMe();
      setMe(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/");
        return;
      }
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [router]);

  // Initial load: read OAuth return params, refresh, then clean the URL.
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let connected: string | null = null;
    let errorParam: string | null = null;
    try {
      const params = new URLSearchParams(window.location.search);
      connected = params.get("connected");
      errorParam = params.get("error");
    } catch {
      // Ignore URL parsing issues.
    }

    void load().then(() => {
      if (isGoogleService(connected)) {
        setNotice({ kind: "success", service: connected });
      } else if (errorParam) {
        setNotice({ kind: "error", message: errorParam });
      }
      if (connected || errorParam) {
        try {
          window.history.replaceState(null, "", window.location.pathname);
        } catch {
          // Ignore history failures.
        }
      }
    });
  }, [load]);

  const retry = useCallback(() => {
    void load();
  }, [load]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      router.replace("/");
    }
  }, [router]);

  const saveProfile = useCallback(async (input: UpdateMeInput) => {
    const updated = await api.updateMe(input);
    setMe(updated);
  }, []);

  const connect = useCallback(
    async (service: GoogleService) => {
      if (api.isMock) {
        await api.connectGoogle(service);
        setNotice({ kind: "success", service });
        await load();
      } else {
        // Full-page navigation into Google OAuth.
        window.location.href = api.getConnectUrl(service);
      }
    },
    [load],
  );

  const disconnect = useCallback(
    async (service: GoogleService) => {
      await api.disconnectGoogle(service);
      await load();
    },
    [load],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  const connectedCount = me
    ? SERVICES.filter((s) => me.services[s]).length
    : 0;

  return {
    me,
    loading,
    loadError,
    notice,
    connectedCount,
    retry,
    logout,
    saveProfile,
    connect,
    disconnect,
    dismissNotice,
  };
}
