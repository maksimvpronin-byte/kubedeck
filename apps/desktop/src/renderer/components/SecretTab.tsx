import { formatBytes as sharedBytes } from "../../shared/formatQuantity";
import { Check, Copy, Eye, EyeOff, Lock, Save } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ApiClient } from "../api";
import { toErrorInfo } from "../utils/errors";
import { canonicalSecretBase64, decodeSecretText, encodeSecretText } from "../utils/secretCodec";
import type { ErrorInfo, ResourceRow, SecretKeyInfo, SecretKeysResponse } from "../types";
import { ErrorPanel } from "./ErrorPanel";
import { useAsyncActionFeedback } from "../hooks/useAsyncActionFeedback";
import { AsyncActionButton } from "./AsyncActionButton";

interface Props {
  api: ApiClient;
  clusterId: string;
  row: ResourceRow;
  copyLabel: string;
  t: (key: string) => string;
}

type ValueMode = "base64" | "text";
type KeyNote = "copied" | "saved";

// A value longer than this opens folded to a few lines.
const LONG_VALUE_CHARS = 240;

// Each value is on screen as the manifest holds it, base64, and ready to edit;
// the eye decodes it to text (audited), Save writes it at once. An edit that
// is not saved is dropped when the Secret is left: nothing asks about it.
export function SecretTab({ api, clusterId, row, copyLabel, t }: Props) {
  const namespace = String(row.namespace || "");
  const name = row.name;
  const [response, setResponse] = useState<SecretKeysResponse | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [modes, setModes] = useState<Record<string, ValueMode>>({});
  // Keys decoded once already in this load, so toggling back and forth is
  // audited once rather than on every press.
  const [decodedKeys, setDecodedKeys] = useState<Record<string, true>>({});
  const [decodingKey, setDecodingKey] = useState("");
  // An edit as valid base64, and what was typed when it is not base64 (yet).
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, true>>({});
  const [notes, setNotes] = useState<Record<string, KeyNote>>({});
  const [savingKey, setSavingKey] = useState("");
  const noteTimers = useRef<Record<string, number>>({});
  const fieldIdPrefix = useId();
  // The drawer is not remounted when another Secret is selected. Everything
  // read from one Secret - values, edits, what was decoded - goes when the next
  // is selected, before it has loaded and for good if it cannot be read.
  const secretIdentity = `${clusterId}\u0000${namespace}\u0000${name}`;
  const identityRef = useRef(secretIdentity);
  identityRef.current = secretIdentity;
  const [shownIdentity, setShownIdentity] = useState(secretIdentity);
  if (shownIdentity !== secretIdentity) {
    setShownIdentity(secretIdentity);
    setResponse(null);
    resetValueState();
  }
  const refreshFeedback = useAsyncActionFeedback();

  useEffect(() => {
    const controller = new AbortController();
    void loadSecret(controller.signal);
    return () => controller.abort();
  }, [api, clusterId, namespace, name]);

  useEffect(
    () => () => {
      Object.values(noteTimers.current).forEach((timer) => window.clearTimeout(timer));
      noteTimers.current = {};
    },
    [],
  );

  function resetValueState() {
    setModes({});
    setDecodedKeys({});
    setDecodingKey("");
    setEdited({});
    setInvalid({});
    setExpanded({});
    setNotes({});
    setSavingKey("");
  }

  // `savedKey` keeps the other keys' edits through the reload a save makes.
  async function loadSecret(signal?: AbortSignal, savedKey?: string) {
    if (!namespace) return false;
    const identity = identityRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await api.secretKeys(clusterId, namespace, name, signal);
      if (identityRef.current !== identity) return false;
      setResponse(data);
      if (savedKey === undefined) {
        resetValueState();
      } else {
        setEdited((current) => without(current, savedKey));
        setInvalid((current) => without(current, savedKey));
      }
      return true;
    } catch (err) {
      if ((err as Error).name === "AbortError") return false;
      setError(toErrorInfo(err));
      return false;
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  function setNote(key: string, note: KeyNote | null) {
    if (noteTimers.current[key]) window.clearTimeout(noteTimers.current[key]);
    delete noteTimers.current[key];
    setNotes((current) => (note ? { ...current, [key]: note } : without(current, key)));
    if (note === "copied") noteTimers.current[key] = window.setTimeout(() => setNote(key, null), 1600);
  }

  async function toggleMode(item: SecretKeyInfo) {
    const key = item.key;
    if ((modes[key] ?? "base64") === "text") {
      setModes((current) => ({ ...current, [key]: "base64" }));
      return;
    }
    if (!decodedKeys[key]) {
      // Decoding is what the audit log records; the value itself is already here.
      const identity = identityRef.current;
      setDecodingKey(key);
      setError(null);
      try {
        await api.revealSecret(clusterId, namespace, name, key);
      } catch (err) {
        if (identityRef.current === identity) setError(toErrorInfo(err));
        return;
      } finally {
        if (identityRef.current === identity) setDecodingKey("");
      }
      if (identityRef.current !== identity) return;
      setDecodedKeys((current) => ({ ...current, [key]: true }));
    }
    setModes((current) => ({ ...current, [key]: "text" }));
  }

  function changeValue(key: string, mode: ValueMode, value: string) {
    setNote(key, null);
    if (mode === "text") {
      setEdited((current) => ({ ...current, [key]: encodeSecretText(value) }));
      setInvalid((current) => without(current, key));
      return;
    }
    const canonical = canonicalSecretBase64(value);
    if (canonical === null) {
      setInvalid((current) => ({ ...current, [key]: value }));
    } else {
      setEdited((current) => ({ ...current, [key]: canonical }));
      setInvalid((current) => without(current, key));
    }
  }

  function revert(key: string) {
    setEdited((current) => without(current, key));
    setInvalid((current) => without(current, key));
  }

  async function copyValue(key: string, text: string) {
    await navigator.clipboard?.writeText(text);
    setNote(key, "copied");
    try {
      await api.auditSecretCopy(clusterId, namespace, name, key);
    } catch {
      // Copy must not fail just because audit logging failed.
    }
  }

  async function saveValue(key: string, encoded: string) {
    const identity = identityRef.current;
    setSavingKey(key);
    setError(null);
    try {
      await api.updateSecret(clusterId, namespace, name, key, encoded);
      if (identityRef.current !== identity) return;
      if (await loadSecret(undefined, key)) setNote(key, "saved");
    } catch (err) {
      if (identityRef.current === identity) setError(toErrorInfo(err));
    } finally {
      if (identityRef.current === identity) setSavingKey("");
    }
  }

  const keys = response?.keys ?? [];
  const immutable = Boolean(response?.immutable);

  return (
    <div className="drawer-panel-stack secret-tab">
      <div className="drawer-filterbar">
        <div className="secret-meta">
          <span>
            {t("secret.type")}: <strong>{response?.type || "—"}</strong>
          </span>
          <span>
            {t("secret.keys")}: <strong>{keys.length}</strong>
          </span>
          {immutable ? <span className="secret-immutable">{t("secret.immutable")}</span> : null}
          <span className="secret-audit-note">
            <Lock size={12} aria-hidden="true" />
            {t("secret.auditNote")}
          </span>
        </div>
        <AsyncActionButton
          className="icon-text"
          phase={refreshFeedback.phase}
          labels={{
            idle: t("secret.refreshKeys"),
            pending: t("secret.refreshingKeys"),
            success: t("secret.keysUpdated"),
            error: t("common.refreshFailed"),
          }}
          disabled={loading}
          onClick={() => void refreshFeedback.run(() => loadSecret())}
        />
      </div>

      {loading && !response ? <div className="muted">{t("secret.loadingKeys")}</div> : null}
      <ErrorPanel error={error} copyLabel={copyLabel} t={t} />

      {!loading && !error && response && keys.length === 0 ? (
        <div className="empty-state">
          <strong>{t("secret.noKeys")}</strong>
          <p>{t("secret.noKeysHint")}</p>
        </div>
      ) : null}

      <div className="secret-key-list">
        {keys.map((item) => {
          const key = item.key;
          const fieldId = `${fieldIdPrefix}-${key}`;
          const original = item.encoded;
          const current = edited[key] ?? original;
          const typedInvalid = invalid[key];
          const textual = item.validBase64 && !item.binary && item.utf8;
          const currentText = current !== null && textual ? decodeSecretText(current) : null;
          const mode: ValueMode = (modes[key] ?? "base64") === "text" && currentText !== null && typedInvalid === undefined ? "text" : "base64";
          const shown = mode === "text" ? (currentText ?? "") : (typedInvalid ?? current ?? "");
          const dirty = typedInvalid !== undefined || (edited[key] !== undefined && edited[key] !== original);
          const canSave = !immutable && dirty && typedInvalid === undefined && savingKey === "";
          const storedInvalid = !item.validBase64 && !dirty;
          const canToggle = original !== null && typedInvalid === undefined && (mode === "text" || currentText !== null) && decodingKey !== key;
          const long = shown.length > LONG_VALUE_CHARS || shown.split("\n").length > 3;
          const note = notes[key];
          const chip = mode === "text" ? t("secret.chipText") : storedInvalid ? t("secret.chipAsIs") : "base64";
          const fieldState = typedInvalid !== undefined || storedInvalid ? " is-invalid" : dirty ? " is-dirty" : "";
          const toggleLabel =
            mode === "text"
              ? t("secret.showBase64")
              : !item.validBase64 || typedInvalid !== undefined
                ? t("secret.notBase64")
                : !textual || currentText === null
                  ? t("secret.base64Only")
                  : t("secret.decode");
          return (
            <article className="secret-key-row" key={key} data-key={key}>
              <header>
                <label htmlFor={fieldId}>{key}</label>
                <span className={item.validBase64 ? "secret-key-meta" : "secret-key-meta is-invalid"}>{keyMeta(item, t)}</span>
              </header>
              <div className="secret-key-body">
                {original === null ? (
                  <div className="secret-value-placeholder">{t("secret.tooLarge").replace("{size}", formatBytes(item.decodedBytes || item.encodedBytes))}</div>
                ) : (
                  <div className={`secret-value-field${fieldState}`}>
                    <span className={`secret-format-chip is-${mode === "text" ? "text" : storedInvalid ? "invalid" : "base64"}`}>{chip}</span>
                    <div className="secret-value-text">
                      <textarea
                        id={fieldId}
                        className={long && !expanded[key] ? "is-folded" : undefined}
                        spellCheck={false}
                        readOnly={immutable}
                        value={shown}
                        onChange={(event) => changeValue(key, mode, event.target.value)}
                      />
                      {long ? (
                        <button type="button" className="link-button" onClick={() => setExpanded((open) => (open[key] ? without(open, key) : { ...open, [key]: true }))}>
                          {expanded[key] ? t("secret.collapse") : t("secret.showAll")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}
                <div className="secret-key-actions">
                  <button
                    type="button"
                    className={mode === "text" ? "icon-button is-active" : "icon-button"}
                    aria-label={toggleLabel}
                    title={toggleLabel}
                    aria-pressed={mode === "text"}
                    disabled={!canToggle}
                    onClick={() => void toggleMode(item)}
                  >
                    {mode === "text" ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={mode === "text" ? t("secret.copyText") : t("secret.copyBase64")}
                    title={mode === "text" ? t("secret.copyText") : t("secret.copyBase64")}
                    disabled={original === null}
                    onClick={() => void copyValue(key, shown)}
                  >
                    {note === "copied" ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                  {immutable ? null : (
                    <button
                      type="button"
                      className={canSave ? "icon-button primary" : "icon-button"}
                      aria-label={t("secret.save")}
                      title={dirty ? t("secret.save") : t("secret.noChanges")}
                      disabled={!canSave}
                      onClick={() => {
                        if (current !== null) void saveValue(key, current);
                      }}
                    >
                      <Save size={16} />
                    </button>
                  )}
                </div>
              </div>
              {dirty ? (
                <div className="secret-key-note">
                  <span className={typedInvalid !== undefined ? "is-error" : undefined}>
                    {typedInvalid !== undefined ? t("secret.invalidDraft") : mode === "text" ? t("secret.changedText") : t("secret.changedBase64")}
                  </span>
                  <button type="button" className="link-button" onClick={() => revert(key)}>
                    {t("secret.revert")}
                  </button>
                </div>
              ) : storedInvalid && !immutable ? (
                <div className="secret-key-note">{t("secret.storedInvalid")}</div>
              ) : note ? (
                <div className="secret-key-note is-success">{note === "saved" ? t("secret.saved") : mode === "text" ? t("secret.copiedText") : t("secret.copiedBase64")}</div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function keyMeta(item: SecretKeyInfo, t: (key: string) => string) {
  if (!item.validBase64) return t("secret.invalidBase64");
  const kind = item.binary ? t("secret.binaryLike") : item.utf8 ? t("secret.textKind") : t("secret.notUtf8");
  return `${formatBytes(item.decodedBytes)} · ${kind}`;
}

function without<T>(record: Record<string, T>, key: string) {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

const formatBytes = (value: number) => (value < 0 ? "0 B" : sharedBytes(value, { digits: 1, fallback: "0 B" }));
