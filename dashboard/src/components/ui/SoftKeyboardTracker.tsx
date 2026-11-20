"use client";

import { useEffect } from "react";
import { trackSoftKeyboard } from "@/lib/soft-keyboard";

/** Mounts once at the app root to keep focused fields above mobile virtual keyboards. */
export function SoftKeyboardTracker() {
  useEffect(() => trackSoftKeyboard(), []);
  return null;
}
