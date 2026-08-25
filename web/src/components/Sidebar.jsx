import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Clock,
  Home,
  Monitor,
  FileText,
  Download,
  Image,
  HardDrive,
  Settings,
  Star,
  Trash2,
} from "lucide-react";
import { useFileStore } from "@/store/file-store";
import { usePlacesStore } from "@/store/places-store";
import { useDialogStore } from "@/store/dialog-store";
import { formatSize } from "@/lib/file-utils";

function Section({ title, children }) {
  return (
    <div className="mb-4">
      <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function NavItem({ icon: Icon, label, path, onClick, active }) {
  const { cwd, navigate } = useFileStore();
  const isActive = active ?? cwd === path;
  return (
    <button
      onClick={() => (onClick ? onClick() : navigate(path))}
      className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm hover:bg-accent ${
        isActive ? "bg-accent font-medium" : ""
      }`}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function DriveItem({ drive }) {
  const { t } = useTranslation();
  const { navigate } = useFileStore();
  const usedPct =
    drive.total_space > 0
      ? Math.round(((drive.total_space - drive.free_space) / drive.total_space) * 100)
      : 0;
  const danger = usedPct > 90;

  return (
    <button
      onClick={() => navigate(drive.path)}
      className="w-full rounded-md px-3 py-1.5 text-left hover:bg-accent"
    >
      <div className="flex items-center gap-2 text-sm">
        <HardDrive className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{drive.label}</span>
      </div>
      <div className="mt-1 pl-6">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${danger ? "bg-red-500" : "bg-sky-500"}`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {t("sidebar.freeOf", {
            free: formatSize(drive.free_space),
            total: formatSize(drive.total_space),
          })}
        </div>
      </div>
    </button>
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const { drives, userDirs, init } = useFileStore();
  const favorites = usePlacesStore((s) => s.favorites);
  const recent = usePlacesStore((s) => s.recent);

  useEffect(() => {
    init();
  }, []);

  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r bg-muted/30 py-2">
      {userDirs && (
        <Section title={t("sidebar.quickAccess")}>
          <NavItem icon={Home} label={t("common.home")} path={userDirs.home} />
          <NavItem icon={Monitor} label={t("sidebar.desktop")} path={userDirs.desktop} />
          <NavItem icon={FileText} label={t("sidebar.documents")} path={userDirs.documents} />
          <NavItem icon={Download} label={t("sidebar.downloads")} path={userDirs.downloads} />
          <NavItem icon={Image} label={t("sidebar.pictures")} path={userDirs.pictures} />
        </Section>
      )}
      {favorites.length > 0 && (
        <Section title={t("sidebar.favorites")}>
          {favorites.map((f) => (
            <NavItem key={f.path} icon={Star} label={f.name} path={f.path} />
          ))}
        </Section>
      )}
      {recent.length > 0 && (
        <Section title={t("sidebar.recent")}>
          {recent.slice(0, 6).map((r) => (
            <NavItem
              key={r.path}
              icon={Clock}
              label={r.path.split(/[/\\]/).pop() || r.path}
              path={r.path}
            />
          ))}
        </Section>
      )}
      <Section title={t("sidebar.system")}>
        <NavItem
          icon={Trash2}
          label={t("common.trash")}
          path="__trash__"
          onClick={() => useFileStore.getState().openTrash()}
        />
        <NavItem
          icon={Settings}
          label={t("common.settings")}
          path="__settings__"
          onClick={() => useDialogStore.getState().open("settings", {})}
        />
      </Section>
      {drives.length > 0 && (
        <Section title={t("sidebar.drives")}>
          {drives.map((d) => (
            <DriveItem key={d.path} drive={d} />
          ))}
        </Section>
      )}
    </aside>
  );
}
