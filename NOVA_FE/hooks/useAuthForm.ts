"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, api } from "@/lib/api";
import { isValidPhone, sanitizePhoneInput, toE164 } from "@/lib/phone";

export type AuthTab = "login" | "register";

/** Semantic error codes; translated to text in the view so they react to language. */
export type AuthErrorCode =
  | "noProfile"
  | "alreadyExists"
  | "generic"
  | null;

export interface AuthFormState {
  /** Whether the initial GET /api/me check is still running. */
  checking: boolean;
  tab: AuthTab;
  phone: string;
  name: string;
  submitting: boolean;
  phoneTouched: boolean;
  phoneInvalid: boolean;
  nameMissing: boolean;
  errorCode: AuthErrorCode;
  /** Tab to offer switching to after a 404/409, keeping the number. */
  offerSwitchTo: AuthTab | null;
}

export interface AuthFormActions {
  setTab: (tab: AuthTab) => void;
  setPhone: (raw: string) => void;
  setName: (name: string) => void;
  submit: () => Promise<void>;
  /** Switch tab from the offered suggestion, keeping the typed number. */
  acceptSwitch: () => void;
}

export function useAuthForm(): AuthFormState & AuthFormActions {
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [tab, setTabState] = useState<AuthTab>("login");
  const [phone, setPhoneState] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [nameMissing, setNameMissing] = useState(false);
  const [errorCode, setErrorCode] = useState<AuthErrorCode>(null);
  const [offerSwitchTo, setOfferSwitchTo] = useState<AuthTab | null>(null);

  const checked = useRef(false);

  // If already authenticated, skip this page.
  // The ref guard keeps this to a single run (incl. React Strict Mode's
  // double-invoke in development), so we must not gate the result on an
  // effect-scoped "active" flag — the cleanup would discard it.
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    api
      .getMe()
      .then(() => router.replace("/home"))
      .catch(() => setChecking(false));
  }, [router]);

  const clearErrors = useCallback(() => {
    setErrorCode(null);
    setOfferSwitchTo(null);
    setNameMissing(false);
  }, []);

  const setTab = useCallback(
    (next: AuthTab) => {
      setTabState(next);
      clearErrors();
    },
    [clearErrors],
  );

  const setPhone = useCallback(
    (raw: string) => {
      setPhoneState(sanitizePhoneInput(raw));
      clearErrors();
    },
    [clearErrors],
  );

  const acceptSwitch = useCallback(() => {
    if (offerSwitchTo) {
      setTabState(offerSwitchTo);
    }
    clearErrors();
  }, [offerSwitchTo, clearErrors]);

  const submit = useCallback(async () => {
    setPhoneTouched(true);
    clearErrors();

    if (!isValidPhone(phone)) {
      return;
    }
    if (tab === "register" && name.trim() === "") {
      setNameMissing(true);
      return;
    }

    setSubmitting(true);
    try {
      const e164 = toE164(phone);
      if (tab === "login") {
        await api.login(e164);
      } else {
        await api.register(e164, name.trim());
      }
      router.replace("/home");
    } catch (err) {
      if (err instanceof ApiError && tab === "login" && err.status === 404) {
        setErrorCode("noProfile");
        setOfferSwitchTo("register");
      } else if (
        err instanceof ApiError &&
        tab === "register" &&
        err.status === 409
      ) {
        setErrorCode("alreadyExists");
        setOfferSwitchTo("login");
      } else {
        setErrorCode("generic");
      }
      setSubmitting(false);
    }
  }, [phone, name, tab, router, clearErrors]);

  return {
    checking,
    tab,
    phone,
    name,
    submitting,
    phoneTouched,
    phoneInvalid: phoneTouched && !isValidPhone(phone),
    nameMissing,
    errorCode,
    offerSwitchTo,
    setTab,
    setPhone,
    setName,
    submit,
    acceptSwitch,
  };
}
