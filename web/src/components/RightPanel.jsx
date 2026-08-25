/**
 * Right-hand panel — reserved for file information / preview features
 * (planned). Kept as a slim placeholder so the layout stays stable while
 * the feature set grows.
 */
import { useTranslation } from "react-i18next";

export function RightPanel() {
  const { t } = useTranslation();
  const placeholder = t("rightpanel.placeholder");
  return (
    <aside className="flex w-52 shrink-0 flex-col border-l bg-muted/30 p-3">
      <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
        {placeholder.split("\n").map((line, i) => (
          <span key={i}>
            {line}
            {i === 0 ? <br /> : null}
          </span>
        ))}
      </div>
    </aside>
  );
}
