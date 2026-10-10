"use client";

import { useEffect, useRef } from "react";

export default function AloPrototype() {
  const appRef = useRef(null);
  const modalRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let unmount;
    // Import only in the browser: the prototype uses localStorage and DOM APIs.
    import("../app.js").then(({ mountAlo }) => {
      if (!cancelled) unmount = mountAlo(appRef.current, modalRef.current);
    });
    return () => {
      cancelled = true;
      unmount?.();
    };
  }, []);

  return (
    <>
      <div id="app" ref={appRef} />
      <div id="toast" role="status" aria-live="polite" />
      <dialog id="modal" ref={modalRef} aria-labelledby="modal-title" />
      <noscript>Please enable JavaScript to use Alo.</noscript>
    </>
  );
}
