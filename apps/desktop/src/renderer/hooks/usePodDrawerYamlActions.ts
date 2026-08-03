import type { Dispatch, SetStateAction } from "react";
import { ApiClient } from "../api";
import type { ErrorInfo, ResourceRow } from "../types";
import { toErrorInfo } from "../utils/errors";

interface Options {
  api: ApiClient;
  clusterId: string;
  pod: ResourceRow | null;
  resource: string;
  currentObjectKey: string;
  t: (key: string) => string;
  yamlDraft: string;
  yamlBaseline: string;
  setYamlBaseline: Dispatch<SetStateAction<string>>;
  setYamlDraft: Dispatch<SetStateAction<string>>;
  setYamlObjectKey: Dispatch<SetStateAction<string>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<ErrorInfo | null>>;
  setApplyResult: Dispatch<SetStateAction<string>>;
  setYamlStatus: Dispatch<SetStateAction<string>>;
  setYamlApplyConfirmOpen: Dispatch<SetStateAction<boolean>>;
  onActionComplete: () => void;
}

export function usePodDrawerYamlActions({
  api,
  clusterId,
  pod,
  resource,
  currentObjectKey,
  t,
  yamlDraft,
  yamlBaseline,
  setYamlBaseline,
  setYamlDraft,
  setYamlObjectKey,
  setLoading,
  setError,
  setApplyResult,
  setYamlStatus,
  setYamlApplyConfirmOpen,
  onActionComplete,
}: Options) {
  async function runYamlDryRun() {
    if (!pod) return;
    setLoading(true);
    setError(null);
    setApplyResult("");
    setYamlStatus("");
    try {
      await api.dryRunYaml(clusterId, yamlDraft);
      setYamlStatus(t("yaml.dryRunPassed"));
    } catch (err) {
      const info = toErrorInfo(err);
      setYamlStatus("");
      setError(info);
    } finally {
      setLoading(false);
    }
  }

  async function applyYaml(typedName: string) {
    if (!pod) return;
    const namespace = String(pod.namespace || "_cluster");
    const submittedYaml = yamlDraft;
    setLoading(true);
    setError(null);
    setApplyResult("");
    setYamlStatus("");
    try {
      await api.applyYaml(clusterId, submittedYaml, namespace, pod.name, typedName);
      setYamlStatus(t("yaml.applied"));
      setYamlBaseline(submittedYaml);
      setYamlDraft(submittedYaml);
      setYamlObjectKey(currentObjectKey);
      onActionComplete();

      try {
        const refreshed = await api.resourceText(clusterId, resource, namespace, pod.name, "yaml");
        setYamlBaseline(refreshed);
        setYamlDraft(refreshed);
        setYamlObjectKey(currentObjectKey);
      } catch {
        // Keep the submitted YAML as the new clean baseline if refresh fails.
      }
    } catch (err) {
      const info = toErrorInfo(err);
      setYamlStatus("");
      setError(info);
    } finally {
      setYamlApplyConfirmOpen(false);
      setLoading(false);
    }
  }

  function resetYamlDraft() {
    setYamlDraft(yamlBaseline);
    setYamlStatus("");
    setApplyResult("");
    setError(null);
  }

  async function reloadYamlFromCluster() {
    if (!pod) return false;
    const namespace = String(pod.namespace || "_cluster");
    setLoading(true);
    setError(null);
    setApplyResult("");
    setYamlStatus("");
    try {
      const text = await api.resourceText(clusterId, resource, namespace, pod.name, "yaml");
      setYamlBaseline(text);
      setYamlDraft(text);
      setYamlObjectKey(currentObjectKey);
      return true;
    } catch (err) {
      const info = toErrorInfo(err);
      setError(info);
      return false;
    } finally {
      setLoading(false);
    }
  }

  return { runYamlDryRun, applyYaml, resetYamlDraft, reloadYamlFromCluster };
}
