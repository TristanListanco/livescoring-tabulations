"use client";

import { useFormStatus } from "react-dom";
import { Spinner } from "./spinner";

export function SubmitButton({
  children,
  pendingLabel = "Saving…",
  className = "btn btn-primary",
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {/* Until the server has it, the button says so, turning. */}
      {pending ? (
        <>
          <Spinner />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
