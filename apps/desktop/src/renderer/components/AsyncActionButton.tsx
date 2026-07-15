import { Check, CircleAlert, RefreshCw } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import type { AsyncActionPhase } from "../utils/asyncActionFeedback";

export interface AsyncActionLabels {
  idle: string;
  pending: string;
  success: string;
  error: string;
}

export function refreshActionLabels(t: (key: string) => string): AsyncActionLabels {
  return {
    idle: t("common.refresh"),
    pending: t("common.refreshing"),
    success: t("common.updated"),
    error: t("common.refreshFailed"),
  };
}

export function reloadActionLabels(t: (key: string) => string): AsyncActionLabels {
  return {
    idle: t("common.reload"),
    pending: t("common.reloading"),
    success: t("common.reloaded"),
    error: t("common.reloadFailed"),
  };
}

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  phase: AsyncActionPhase;
  labels: AsyncActionLabels;
}

export function AsyncActionButton({ phase, labels, className = "", disabled, ...props }: Props) {
  const Icon = phase === "success" ? Check : phase === "error" ? CircleAlert : RefreshCw;
  const activeLabel = labels[phase];
  return (
    <button {...props} className={`${className} async-action-button is-${phase}`.trim()} disabled={disabled || phase === "pending"} aria-busy={phase === "pending"} aria-label={activeLabel}>
      <span className="async-action-icon" aria-hidden="true">
        <Icon size={14} />
      </span>
      <span className="async-action-labels" aria-live="polite" aria-atomic="true">
        {(Object.keys(labels) as AsyncActionPhase[]).map((candidate) => (
          <span key={candidate} className={candidate === phase ? "active" : ""} aria-hidden={candidate !== phase}>
            {labels[candidate]}
          </span>
        ))}
      </span>
    </button>
  );
}
