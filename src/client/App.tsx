import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth";
import { DashboardPage } from "./pages/DashboardPage";
import { LandingPage } from "./pages/LandingPage";
import { MapPage } from "./pages/MapPage";

function currentPath() {
  return window.location.pathname;
}

export function App() {
  const { user, loading } = useAuth();
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    const onPopState = () => setPath(currentPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((next: string) => {
    window.history.pushState({}, "", next);
    setPath(next);
  }, []);

  useEffect(() => {
    if (!loading && !user && path !== "/") {
      window.history.replaceState({}, "", "/");
      setPath("/");
    }
  }, [loading, user, path]);

  if (loading) return <main className="loading-state"><span className="loader"/><p>Finding your maps…</p></main>;
  if (!user) return <LandingPage />;
  const mapMatch = path.match(/^\/maps\/([^/]+)$/);
  if (mapMatch) return <MapPage mapId={decodeURIComponent(mapMatch[1])} navigate={navigate}/>;
  return <DashboardPage navigate={navigate}/>;
}
