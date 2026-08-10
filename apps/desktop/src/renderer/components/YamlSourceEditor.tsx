import type { MutableRefObject, ReactNode } from "react";
import { useRef } from "react";

interface YamlSourceEditorProps {
  value: string;
  readOnly?: boolean;
  ariaLabel?: string;
  editorRef?: MutableRefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

// Shared between the resource drawer YAML tab and the kubeconfig editor so both
// use one highlighting implementation.
export function YamlSourceEditor({ value, readOnly = false, ariaLabel, editorRef, onChange, onKeyDown }: YamlSourceEditorProps) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const textareaRef = editorRef ?? localRef;

  return (
    <div className="yaml-ide-editor">
      <pre className="yaml-editor yaml-highlight-layer" ref={highlightRef} aria-hidden="true">
        {highlightYaml(value)}
      </pre>
      <textarea
        ref={textareaRef}
        className="yaml-editor yaml-editor-input"
        aria-label={ariaLabel}
        value={value}
        readOnly={readOnly}
        onChange={(event) => {
          if (readOnly) return;
          onChange(event.target.value);
        }}
        onScroll={(event) => {
          if (!highlightRef.current) return;
          highlightRef.current.scrollTop = event.currentTarget.scrollTop;
          highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
        onKeyDown={onKeyDown}
        spellCheck={false}
      />
    </div>
  );
}

export function highlightYaml(value: string): ReactNode[] {
  const lines = value.split("\n");
  return lines.map((line, index) => (
    <span className="yaml-line" key={index}>
      <span className="yaml-line-number">{index + 1}</span>
      <span className="yaml-line-code">{highlightYamlLine(line)}</span>
      {index < lines.length - 1 ? "\n" : ""}
    </span>
  ));
}

export function highlightYamlLine(line: string): ReactNode {
  const commentIndex = findYamlCommentIndex(line);
  const code = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
  const comment = commentIndex >= 0 ? line.slice(commentIndex) : "";
  const keyMatch = code.match(/^(\s*)(-\s*)?([^:#\n][^:\n]*?)(:\s*)(.*)$/);
  if (!keyMatch) {
    return (
      <>
        {highlightYamlScalars(code)}
        {comment ? <span className="yaml-comment">{comment}</span> : null}
      </>
    );
  }
  return (
    <>
      {keyMatch[1]}
      {keyMatch[2] ? <span className="yaml-punctuation">{keyMatch[2]}</span> : null}
      <span className="yaml-key">{keyMatch[3]}</span>
      <span className="yaml-punctuation">{keyMatch[4]}</span>
      {highlightYamlScalars(keyMatch[5])}
      {comment ? <span className="yaml-comment">{comment}</span> : null}
    </>
  );
}

function highlightYamlScalars(text: string): ReactNode {
  if (!text) return text;
  const trimmed = text.trim();
  const leading = text.slice(0, text.length - text.trimStart().length);
  if (/^(['"]).*\1$/.test(trimmed))
    return (
      <>
        {leading}
        <span className="yaml-string">{trimmed}</span>
      </>
    );
  if (/^(true|false|null|~)$/i.test(trimmed))
    return (
      <>
        {leading}
        <span className="yaml-constant">{trimmed}</span>
      </>
    );
  if (/^-?\d+(\.\d+)?$/.test(trimmed))
    return (
      <>
        {leading}
        <span className="yaml-number">{trimmed}</span>
      </>
    );
  if (/^[>|]-?$/.test(trimmed))
    return (
      <>
        {leading}
        <span className="yaml-punctuation">{trimmed}</span>
      </>
    );
  return text;
}

function findYamlCommentIndex(line: string) {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "'" || char === '"') && line[index - 1] !== "\\") {
      quote = quote === char ? null : (quote ?? char);
    }
    if (char === "#" && !quote && (index === 0 || /\s/.test(line[index - 1]))) return index;
  }
  return -1;
}
