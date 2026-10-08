// `kubectl get <type> [<name>] [-n <ns> | -A] [selectors] -o json`, read as the
// API request it stands for.
//
// Search, Overview, Problems, related resources, Secrets and deployment logs
// all ask kubectl for JSON this way. With the direct client those become one
// GET on a kept connection; anything with a flag or a type not understood here
// stays a kubectl command.

export interface GetJsonRequest {
  resource: string;
  name: string | null;
  // A namespace given with -n, or null for none.
  namespace: string | null;
  allNamespaces: boolean;
  fieldSelector: string | null;
  labelSelector: string | null;
}

const JSON_OUTPUT = new Set(["-ojson", "-o=json", "--output=json"]);

export function parseGetJson(args: readonly string[]): GetJsonRequest | null {
  if (args[0] !== "get" || args.length < 2) return null;
  const resource = args[1];
  if (!resource || resource.startsWith("-") || resource.includes("/") || resource.includes(",")) return null;
  const request: GetJsonRequest = { resource, name: null, namespace: null, allNamespaces: false, fieldSelector: null, labelSelector: null };
  let json = false;
  for (let index = 2; index < args.length; index++) {
    const arg = args[index];
    const next = () => {
      index += 1;
      return index < args.length ? args[index] : null;
    };
    if (arg === "-o" || arg === "--output") {
      if (next() !== "json") return null;
      json = true;
    } else if (JSON_OUTPUT.has(arg)) json = true;
    else if (arg === "-n" || arg === "--namespace") request.namespace = next();
    else if (arg.startsWith("--namespace=")) request.namespace = arg.slice("--namespace=".length);
    else if (arg === "-A" || arg === "--all-namespaces") request.allNamespaces = true;
    else if (arg === "--field-selector") request.fieldSelector = next();
    else if (arg.startsWith("--field-selector=")) request.fieldSelector = arg.slice("--field-selector=".length);
    else if (arg === "-l" || arg === "--selector") request.labelSelector = next();
    else if (arg.startsWith("--selector=")) request.labelSelector = arg.slice("--selector=".length);
    else if (!arg.startsWith("-") && request.name === null && index === 2) request.name = arg;
    else return null;
  }
  if (!json || request.namespace === "") return null;
  if (request.name && (request.allNamespaces || request.fieldSelector || request.labelSelector)) return null;
  return request;
}

export interface ResolvedEndpoint {
  prefix: string;
  plural: string;
  namespaced: boolean;
}

// The API path for the request, or null when only kubectl can say (a
// namespaced type with no namespace means the context's default).
export function getJsonPath(request: GetJsonRequest, endpoint: ResolvedEndpoint): string | null {
  let base: string;
  if (!endpoint.namespaced) base = `${endpoint.prefix}/${endpoint.plural}`;
  else if (request.allNamespaces) {
    if (request.name) return null;
    base = `${endpoint.prefix}/${endpoint.plural}`;
  } else if (request.namespace) base = `${endpoint.prefix}/namespaces/${encodeURIComponent(request.namespace)}/${endpoint.plural}`;
  else return null;
  if (request.name) return `${base}/${encodeURIComponent(request.name)}`;
  const query = new URLSearchParams();
  if (request.fieldSelector) query.set("fieldSelector", request.fieldSelector);
  if (request.labelSelector) query.set("labelSelector", request.labelSelector);
  const search = query.toString();
  return search ? `${base}?${search}` : base;
}
