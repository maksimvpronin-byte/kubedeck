import { useEffect, useState } from "react";

export function HelpPanel({ t }: { t: (key: string) => string }) {
  const [appVersion, setAppVersion] = useState("—");
  const quickStart = ["help.quickStart.1", "help.quickStart.2", "help.quickStart.3", "help.quickStart.4", "help.quickStart.5"];
  // Connection comes right after the quick start because a grey rail badge is
  // the first thing that stops a cluster from showing anything.
  const connection = ["help.connection.1", "help.connection.2", "help.connection.3", "help.connection.4", "help.connection.5"];
  const drawer = ["help.drawer.1", "help.drawer.2", "help.drawer.3", "help.drawer.4", "help.drawer.5", "help.drawer.6", "help.drawer.7"];
  const sections = ["help.sections.1", "help.sections.2", "help.sections.3", "help.sections.4", "help.sections.5", "help.sections.6", "help.sections.7"];
  const actions = ["help.actions.1", "help.actions.2", "help.actions.3", "help.actions.4"];
  const terminal = ["help.terminal.1", "help.terminal.2", "help.terminal.3", "help.terminal.4"];
  const portable = ["help.portable.1", "help.portable.2", "help.portable.3", "help.portable.4"];

  useEffect(() => {
    let active = true;
    window.kubedeck
      .getDesktopInfo()
      .then((info) => {
        if (active) setAppVersion(info.appVersion || "—");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="help-panel">
      <div className="help-hero">
        <span>{t("help.badge")}</span>
        <h2>{t("help.title")}</h2>
      </div>

      <div className="help-grid">
        <article className="help-card">
          <h3>{t("help.about")}</h3>
          <dl>
            <dt>{t("help.name")}</dt>
            <dd>KubeDeck</dd>
            <dt>{t("help.version")}</dt>
            <dd>{appVersion}</dd>
            <dt>{t("help.author")}</dt>
            <dd>Пронин Максим</dd>
            <dt>{t("help.project")}</dt>
            <dd>Autoops MOEX KubeDeck Project</dd>
            <dt>{t("help.buildType")}</dt>
            <dd>Windows x64 Portable / macOS arm64 DMG + ZIP</dd>
            <dt>{t("help.components")}</dt>
            <dd>Electron, React, TypeScript, Node Gateway, kubectl</dd>
            <dt>{t("help.appData")}</dt>
            <dd>Windows: %APPDATA%\KubeDeck / macOS: ~/Library/Application Support/KubeDeck</dd>
          </dl>
        </article>

        <HelpList title={t("help.quickStart")} items={quickStart.map(t)} />
        <HelpList title={t("help.connection")} items={connection.map(t)} />
        <HelpList title={t("help.drawer")} items={drawer.map(t)} />
        <HelpList title={t("help.sections")} items={sections.map(t)} />
        <HelpList title={t("help.actions")} items={actions.map(t)} />
        <HelpList title={t("help.terminal")} items={terminal.map(t)} />
        <HelpList title={t("help.portable")} items={portable.map(t)} />

        <article className="help-card wide">
          <h3>{t("help.diagnostics")}</h3>
          <p>{t("help.diagnostics.package")}</p>
          <code>npm run package:win / npm run package:mac</code>
        </article>
      </div>
    </section>
  );
}

function HelpList({ title, items }: { title: string; items: string[] }) {
  return (
    <article className="help-card">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  );
}
