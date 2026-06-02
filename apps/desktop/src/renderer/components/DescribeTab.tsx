import type { ReactNode } from "react";

interface DescribeTabProps {
  content: string;
}

export function DescribeTab({ content }: DescribeTabProps) {
  const lines = content.split("\n");

  return (
    <pre className="describe-viewer">
      {lines.map((line, index) => (
        <span className="describe-line" key={index}>
          {highlightDescribeLine(line)}
          {index < lines.length - 1 ? "\n" : ""}
        </span>
      ))}
    </pre>
  );
}

function highlightDescribeLine(line: string): ReactNode {
  const heading = line.match(/^([A-Z][A-Za-z ]+):\s*$/);
  if (heading) return <span className="describe-heading">{line}</span>;

  const keyed = line.match(/^(\s*)([^:\n]+:)(.*)$/);
  if (!keyed) return <span className="describe-text">{line}</span>;

  return (
    <>
      {keyed[1]}
      <span className="describe-key">{keyed[2]}</span>
      <span className="describe-value">{keyed[3]}</span>
    </>
  );
}
