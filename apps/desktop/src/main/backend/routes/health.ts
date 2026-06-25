import type { ServerResponse } from "node:http";
import { writeJson } from "../http";

export function writeHealth(response: ServerResponse, appVersion: string): void {
  writeJson(response, {
    ok: true,
    service: "kubedeck-backend",
    runtime: "node",
    gatewayVersion: appVersion,
  });
}
