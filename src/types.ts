export interface Device {
  sn: string;
  alias: string;
  last_seen: string;
  ip: string;
  online: boolean;
}

export interface SyncStatus {
  status: "pending" | "sent" | "success" | "error" | "critical";
  operation_id: string | null;
  error_detail: string | null;
}

export interface User {
  pin: string;
  name: string;
  privilege: number;
  password?: string;
  card?: string;
  photo_url?: string;
  photoSync?: SyncStatus | null;
  userSync?: SyncStatus | null;
}

export interface Log {
  id: number;
  sn: string;
  pin: string;
  time: string;
  status: number;
  verify_type: number;
}

export type TabId =
  | "home"
  | "novo-usuario"
  | "lista-usuarios"
  | "edit-usuario"
  | "rt"
  | "info-reg"
  | "rel"
  | "dispositivo"
  | "dados"
  | "fw";

export interface Tab {
  id: string;
  label: string;
  closable?: boolean;
}

export type WSMessage =
  | { type: "hello"; boot_id: string }
  | { type: "new_log"; log: Log }
  | { type: "device_update"; sn: string; online?: boolean; last_seen?: string }
  | { type: "users_updated" }
  | { type: "photo_op_update"; operation_id: string; status: SyncStatus["status"]; pin: string; error_detail?: string }
  | { type: "user_op_update"; operation_id: string; status: SyncStatus["status"]; pin: string; error_detail?: string }
  | { type: "command_result"; id: number; success: boolean };
