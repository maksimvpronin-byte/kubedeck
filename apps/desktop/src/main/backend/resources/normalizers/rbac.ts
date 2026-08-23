import { type JsonObject, meta, record, records, type ResourceRow, strings, text } from "./primitives";

function formatSubjects(subjects: JsonObject[]): string {
  return subjects
    .map((subject) => {
      const kind = text(subject.kind);
      const namespace = text(subject.namespace);
      const name = text(subject.name);
      return `${kind}/${namespace ? `${namespace}/` : ""}${name}`.replace(/^\/|\/$/g, "");
    })
    .join(", ");
}

function formatPolicyRules(rules: JsonObject[]): string {
  return rules
    .map((rule) => {
      const verbs = strings(rule.verbs).join(",");
      const resources = strings(rule.resources).join(",");
      const apiGroups = strings(rule.apiGroups).join(",");
      return `${verbs} ${apiGroups}/${resources}`.trim();
    })
    .join("; ");
}

export function serviceAccountSummary(item: JsonObject): ResourceRow {
  const secrets = records(item.secrets);
  const imagePullSecrets = records(item.imagePullSecrets);
  return {
    ...meta(item),
    secrets: secrets
      .map((secret) => text(secret.name))
      .filter(Boolean)
      .join(", "),
    imagePullSecrets: imagePullSecrets
      .map((secret) => text(secret.name))
      .filter(Boolean)
      .join(", "),
  };
}

export function roleSummary(item: JsonObject): ResourceRow {
  const rules = records(item.rules);
  return {
    ...meta(item),
    rules,
    rulesText: formatPolicyRules(rules),
  };
}

export function roleBindingSummary(item: JsonObject): ResourceRow {
  const subjects = records(item.subjects);
  const roleRef = record(item.roleRef);
  return {
    ...meta(item),
    subjects,
    subjectsText: formatSubjects(subjects),
    roleRef,
    roleRefKind: text(roleRef.kind),
    roleRefName: text(roleRef.name),
  };
}
