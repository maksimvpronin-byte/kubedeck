import http from "node:http";
import type { GatewayOptions } from "./types";

export async function clearLegacyResourceCache(
  options: GatewayOptions,
  clusterId: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const url = new URL("/resource-cache/clear", options.legacyBackendUrl);
    url.searchParams.set("cluster_id", clusterId);

    const request = http.request(
      url,
      {
        method: "POST",
        headers: {
          "X-KubeDeck-Token": options.sessionToken,
        },
      },
      (response) => {
        response.resume();
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          resolve();
          return;
        }
        reject(new Error(`Legacy cache clear returned HTTP ${response.statusCode ?? 0}`));
      },
    );

    request.setTimeout(1500, () => {
      request.destroy(new Error("Legacy cache clear timed out"));
    });
    request.on("error", reject);
    request.end();
  });
}
