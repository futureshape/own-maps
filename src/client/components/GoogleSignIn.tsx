import { useEffect, useRef, useState } from "react";
import { loadGoogleIdentity } from "../google";

export function GoogleSignIn({ onCredential }: { onCredential: (credential: string) => Promise<void> }) {
  const target = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadGoogleIdentity()
      .then(() => {
        if (!active || !target.current || !window.google.accounts?.id) return;
        const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
        if (!clientId) throw new Error("VITE_GOOGLE_CLIENT_ID is not configured");
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) => {
            setError(null);
            void onCredential(credential).catch((reason) =>
              setError(reason instanceof Error ? reason.message : "Sign-in failed"),
            );
          },
        });
        target.current.replaceChildren();
        window.google.accounts.id.renderButton(target.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          shape: "pill",
          text: "continue_with",
          width: 280,
        });
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Google sign-in is unavailable"));
    return () => {
      active = false;
    };
  }, [onCredential]);

  return (
    <div className="google-signin-wrap">
      <div ref={target} />
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
