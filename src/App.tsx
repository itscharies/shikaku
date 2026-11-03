import { useEffect, useState } from "react";
import { Home } from "./components/Home.tsx";
import { Play } from "./components/Play.tsx";

// Hash routes: "#/" is home, "#/<id>" plays a puzzle (e.g. "#/7x7-d20261103").
// Hash routing keeps the static build deployable anywhere without a SPA
// fallback; swap for the History API if that ever matters.
const readRoute = () => window.location.hash.replace(/^#\/?/, "").replace(/\/+$/, "");

export const goTo = (route: string) => {
  window.location.hash = route ? `/${route}` : "/";
};

export default function App() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (route) return <Play key={route} id={route} />;
  return <Home />;
}
