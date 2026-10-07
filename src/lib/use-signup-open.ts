"use client";

import { useEffect, useState } from "react";

/** null while unknown; true/false once the server has answered. */
export function useSignupOpen() {
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/auth/register")
      .then((r) => r.json())
      .then((d) => setOpen(!!d.open))
      .catch(() => setOpen(false));
  }, []);
  return open;
}
