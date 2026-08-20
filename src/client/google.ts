import { Loader } from "@googlemaps/js-api-loader";

let loader: Loader | null = null;

export async function loadGoogleMaps(): Promise<typeof google> {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("VITE_GOOGLE_MAPS_API_KEY is not configured");
  loader ??= new Loader({
    apiKey,
    version: "beta",
  });
  await loader.load();
  return google;
}

let identityPromise: Promise<void> | null = null;

export function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  identityPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Google Identity Services"));
    document.head.appendChild(script);
  });
  return identityPromise;
}

declare global {
  interface Window {
    google: typeof google & {
      accounts?: {
        id: {
          initialize(options: { client_id: string; callback: (response: { credential: string }) => void }): void;
          renderButton(element: HTMLElement, options: Record<string, unknown>): void;
        };
      };
    };
  }
}
