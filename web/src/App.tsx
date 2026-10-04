import { useEffect, useState } from "react";

/** Whether the local server answered: "checking" until the first response, then its status or "unreachable". */
type ServerStatus = "checking" | "ok" | "unreachable";

/** The root of the web app. For now it only shows whether the local server is reachable. */
export function App() {
  const [serverStatus, setServerStatus] = useState<ServerStatus>("checking");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then((response) => setServerStatus(response.ok ? "ok" : "unreachable"))
      .catch(() => {
        if (!controller.signal.aborted) {
          setServerStatus("unreachable");
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>agent-timeline</h1>
      <p data-testid="server-status">server: {serverStatus}</p>
    </main>
  );
}
