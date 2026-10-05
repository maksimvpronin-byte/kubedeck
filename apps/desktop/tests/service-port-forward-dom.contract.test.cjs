// Forwarding a port of a Service, from the place people look for it.
//
// Reported from a real cluster: "I could not find port forward on a Service".
// It was there, as an unlabelled icon in the drawer header that looked like the
// Related tab's; the Service's own "How to reach it" section only offered a
// command to copy. And the window it opened offered the Service's targetPorts
// and nodePorts too, which `kubectl port-forward svc/...` refuses.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React } = require("./helpers/dom.cjs");

const { ServiceAddressesSection } = loadComponent("components/ServiceAddressesSection.tsx");
const modal = loadComponent("components/PortForwardModal.tsx");

const port = (extra) => ({ name: "", port: 0, targetPort: "", nodePort: 0, protocol: "TCP", appProtocol: "", ...extra });

const service = {
  name: "web",
  namespace: "shop",
  type: "NodePort",
  clusterIp: "10.43.7.21",
  ports: "http · 80 → 8080/TCP, metrics · 9090 → 9090/TCP, dns · 53 → 53/UDP",
  servicePortItems: [
    port({ name: "http", port: 80, targetPort: "8080", nodePort: 31080 }),
    port({ name: "metrics", port: 9090, targetPort: "9090" }),
    port({ name: "dns", port: 53, protocol: "UDP" }),
  ],
};

test("each TCP port of a Service has its own port-forward button, opening on that port", (t) => {
  const asked = [];
  const view = mount(React.createElement(ServiceAddressesSection, { row: service, onPortForward: (value) => asked.push(value), portForwardLabel: "Проброс порта" }));
  t.after(() => view.unmount());

  const buttons = view.all(".service-forward-button");
  assert.deepEqual(
    buttons.map((button) => button.textContent),
    ["Проброс порта · http 80", "Проброс порта · metrics 9090"],
    "UDP is not offered: kubectl forwards TCP only",
  );
  view.click(buttons[1]);
  assert.deepEqual(asked, [9090]);
  // The command to copy stays for whoever wants to run it themselves.
  assert.match(view.text(".service-address-row:last-child code"), /kubectl port-forward -n shop svc\/web 80:80/);
});

test("without a way to start one, the section still offers the command to copy", (t) => {
  const view = mount(React.createElement(ServiceAddressesSection, { row: service }));
  t.after(() => view.unmount());
  assert.equal(view.all(".service-forward-button").length, 0);
  assert.match(view.text(".service-address-row:last-child code"), /svc\/web 80:80/);
});

test("the port-forward window offers a Service its own ports, not targetPorts or nodePorts", () => {
  assert.deepEqual(modal.portChoicesForRow(service, "service"), [80, 9090]);
  assert.equal(modal.defaultPortForwardDraft("services", service).remotePort, 80);
  assert.equal(modal.defaultPortForwardDraft("services", service, 9090).remotePort, 9090);
  assert.equal(modal.defaultPortForwardDraft("services", service).resource, "service");
  // A pod still gets every port it mentions.
  assert.deepEqual(modal.portChoicesForRow({ name: "api", containerPorts: "8080/TCP, 9090/TCP" }, "pod"), [8080, 9090]);
});

test("a Service with nothing to forward to does not offer port forwarding", () => {
  assert.equal(modal.supportsPortForward("services", service), true);
  assert.equal(modal.supportsPortForward("services", { name: "vendor", namespace: "shop", type: "ExternalName", externalName: "api.vendor.example.com" }), false);
  assert.equal(modal.supportsPortForward("services", { name: "dns", namespace: "kube-system", servicePortItems: [port({ port: 53, protocol: "UDP" })] }), false);
});
