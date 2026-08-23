import { Copy } from "lucide-react";
import { portForwardCommand, serviceAddresses } from "../utils/serviceAddresses";
import type { ResourceRow } from "../types";

interface Props {
  row: ResourceRow;
  onCopy?: (text: string, message: string) => void;
}

// How to reach a Service, which used to be something to work out from the type,
// the ClusterIP and the port list by hand. Every line is an address to copy -
// none of them is a link, because a ClusterIP is not routable from this machine
// and `svc.cluster.local` does not resolve on it.
export function ServiceAddressesSection({ row, onCopy }: Props) {
  const addresses = serviceAddresses(row);
  const forwardCommand = portForwardCommand(row);
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
              <button type="button" className="service-address-value" title={onCopy ? `Copy ${forwardCommand}` : forwardCommand} onClick={() => copy(forwardCommand)}>
                <code>{forwardCommand}</code>
                {onCopy ? <Copy size={13} aria-hidden="true" /> : null}
              </button>
              <small>reaches the Service from this machine; the port-forward button in the header does the same</small>
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
