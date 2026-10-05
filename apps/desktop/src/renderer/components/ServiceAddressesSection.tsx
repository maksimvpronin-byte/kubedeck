import { Copy } from "lucide-react";
import { forwardableServicePorts, portForwardCommand, serviceAddresses } from "../utils/serviceAddresses";
import type { ResourceRow } from "../types";
import { PortForwardIcon } from "./PortForwardModal";

interface Props {
  row: ResourceRow;
  onCopy?: (text: string, message: string) => void;
  // Opens the port-forward window on this port. Without it the section only
  // offers the command to copy.
  onPortForward?: (port: number) => void;
  portForwardLabel?: string;
}

// How to reach a Service, which used to be something to work out from the type,
// the ClusterIP and the port list by hand. Every line is an address to copy -
// none of them is a link, because a ClusterIP is not routable from this machine
// and `svc.cluster.local` does not resolve on it.
export function ServiceAddressesSection({ row, onCopy, onPortForward, portForwardLabel = "Port forward" }: Props) {
  const addresses = serviceAddresses(row);
  const forwardCommand = portForwardCommand(row);
  // This is where people look for a way in from their own machine, and the
  // header button was an unlabelled icon they did not find. Each port gets its
  // own button, so the window opens on the port that was meant.
  const forwardPorts = onPortForward ? forwardableServicePorts(row) : [];
  if (addresses.length === 0 && !forwardCommand) return null;

  const copy = (value: string) => onCopy?.(value, "Address copied");

  return (
    <section className="resource-summary-section service-addresses" aria-label="How to reach this Service">
      <div className="resource-summary-section-title">How to reach it</div>
      <dl className="service-address-list">
        {addresses.map((address) => (
          <div className="service-address-row" key={`${address.group}:${address.address}`}>
            <dt>{address.group}</dt>
            <dd>
              <button type="button" className="service-address-value" title={onCopy ? `Copy ${address.address}` : address.address} onClick={() => copy(address.address)}>
                <code>{address.address}</code>
                {onCopy ? <Copy size={13} aria-hidden="true" /> : null}
              </button>
              {address.hint ? <small>{address.hint}</small> : null}
            </dd>
          </div>
        ))}
        {forwardCommand ? (
          <div className="service-address-row" key="port-forward">
            <dt>From here</dt>
            <dd>
              {forwardPorts.length ? (
                <div className="service-forward-actions">
                  {forwardPorts.map((port) => (
                    <button type="button" className="service-forward-button" key={port.port} onClick={() => onPortForward?.(port.port)} title={`${portForwardLabel}: ${port.port}`}>
                      <PortForwardIcon size={14} aria-hidden="true" />
                      {portForwardLabel} · {port.name ? `${port.name} ` : ""}
                      {port.port}
                    </button>
                  ))}
                </div>
              ) : null}
              <button type="button" className="service-address-value" title={onCopy ? `Copy ${forwardCommand}` : forwardCommand} onClick={() => copy(forwardCommand)}>
                <code>{forwardCommand}</code>
                {onCopy ? <Copy size={13} aria-hidden="true" /> : null}
              </button>
              <small>{forwardPorts.length ? "or run it yourself" : "reaches the Service from this machine; the port-forward button in the header does the same"}</small>
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
