import type { Section } from "../types";

export function PlaceholderSection({ section, t }: { section: Section; t: (key: string) => string }) {
  const notes: Record<string, string> = {
    problems: "Problems engine placeholder. Live diagnostics will be added in the next stage.",
    terminal: "Pod terminal is planned for a later stage.",
  };
  return (
    <section className="placeholder-page">
      <h2>{t(`nav.${section}`)}</h2>
      <p>{notes[section]}</p>
    </section>
  );
}
