/**
 * Utility to get or create a persistent Device ID for the client.
 * Allows identifying the browser device during synchronization.
 */

const DEVICE_KEY = "syncguard_device_id";

export function getDeviceId(): string {
  if (typeof window === "undefined") return "server-context";

  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    // Generate a human-friendly device ID with short UUID
    const randomSuffix = crypto.randomUUID().slice(0, 6);
    id = "device-" + randomSuffix;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function setDeviceId(newId: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DEVICE_KEY, newId.trim());
}
