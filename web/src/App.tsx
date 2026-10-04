import { useEffect, useState } from "react";

/** 手元のサーバーに届いたか。最初の応答までは "checking"、以後は応答の成否。 */
type ServerStatus = "checking" | "ok" | "unreachable";

/** 画面のルート。今は手元のサーバーに届くかだけを表示する。 */
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
