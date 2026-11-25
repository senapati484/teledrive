import { invoke } from "@tauri-apps/api/core";
import { isMobilePlatform } from "../platform";
import { isTauriRuntime } from "../runtime/bridge";

export interface WebdavSettingsStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  username: string;
  password: string;
  url: string;
  error: string | null;
}

export function isWebdavSupported(): boolean {
  return isTauriRuntime() && !isMobilePlatform();
}

const UNSUPPORTED: WebdavSettingsStatus = {
  enabled: false,
  running: false,
  port: 8747,
  username: "teledrive",
  password: "",
  url: "",
  error: null,
};

export async function getWebdavSettings(): Promise<WebdavSettingsStatus> {
  if (!isWebdavSupported()) return { ...UNSUPPORTED };
  return invoke<WebdavSettingsStatus>("get_webdav_settings");
}

export async function setWebdavSettings(input: {
  enabled: boolean;
  port: number;
  username: string;
  password: string;
}): Promise<WebdavSettingsStatus> {
  if (!isWebdavSupported()) return { ...UNSUPPORTED };
  return invoke<WebdavSettingsStatus>("set_webdav_settings", {
    enabled: input.enabled,
    port: input.port,
    username: input.username,
    password: input.password,
  });
}

export async function regenerateWebdavPassword(): Promise<WebdavSettingsStatus> {
  if (!isWebdavSupported()) return { ...UNSUPPORTED };
  return invoke<WebdavSettingsStatus>("regenerate_webdav_password");
}
