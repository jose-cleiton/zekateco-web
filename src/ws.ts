import { useEffect, useRef } from "react";
import type { WSMessage } from "./types";

export function useWebSocket(onMessage: (msg: WSMessage) => void) {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let knownBootId: string | null = null;
    let socket: WebSocket | null = null;

    const connect = () => {
      if (stopped) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}`);

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WSMessage;
          if (data.type === "hello") {
            if (knownBootId === null) {
              knownBootId = data.boot_id;
            } else if (knownBootId !== data.boot_id) {
              window.location.reload();
              return;
            }
          }
          handlerRef.current(data);
        } catch (e) {
          console.error("[WS] parse error", e);
        }
      };

      socket.onerror = () => {};
      socket.onclose = () => {
        if (stopped) return;
        reconnectTimer = setTimeout(connect, 1500);
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);
}
