import { CommandPalette, type CommandPaletteItem } from "./CommandPalette";

interface Props {
  open: boolean;
  query: string;
  items: CommandPaletteItem[];
  loading: boolean;
  placeholder: string;
  t: (key: string) => string;
  onQueryChange: (value: string) => void;
  onClose: () => void;
}

export function AppCommandPalette({ open, query, items, loading, placeholder, t, onQueryChange, onClose }: Props) {
  if (!open) return null;
  return (
    <CommandPalette
      query={query}
      items={items}
      loading={loading}
      placeholder={placeholder}
      onQueryChange={onQueryChange}
      t={t}
      onClose={onClose}
      onRun={(item) => {
        onClose();
        onQueryChange("");
        void item.run();
      }}
    />
  );
}
