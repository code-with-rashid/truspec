import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  coverage as apiCoverage,
  createFolder,
  deletePath,
  drift as apiDrift,
  duplicatePath,
  exportPostman,
  getRequest,
  getState,
  mockLog as apiMockLog,
  mockStart as apiMockStart,
  mockStatus as apiMockStatus,
  mockStop as apiMockStop,
  renamePath,
  run as apiRun,
  saveRequest,
  saveRequestObject,
  type CoverageReport,
  type DriftReport,
  type MockLogEntry,
  type MockStatus,
  type RequestDetail,
  type RequestSummary,
  type RunResult,
  type WorkspaceState,
} from "./api";
import { CommandPalette } from "./components/CommandPalette";
import { ConfirmModal } from "./components/ConfirmModal";
import { ContextMenu, type ContextMenuItem, type ContextMenuState } from "./components/ContextMenu";
import { Editor, type EditMode } from "./components/Editor";
import { EnvironmentModal } from "./components/EnvironmentModal";
import { FolderSettingsModal } from "./components/FolderSettingsModal";
import { FolderTree, type RowAction, type RowActionsController, type RowKind } from "./components/FolderTree";
import { contractInfo, RequestWorkspace, specRefOf, type ReqTab, type RespTab } from "./components/RequestWorkspace";
import { TabStrip } from "./components/TabStrip";
import { statusClass } from "./format-utils";
import { FlowView } from "./FlowView";
import { baseName, buildFolderTree, countRequests, filterTree, normPath, shortDir, type FolderNode } from "./tree";

type Theme = "dark" | "light";
type View = "workspace" | "spec" | "mock" | "flow";
type RailTab = "spec" | "runs";

/** One open request tab. `detail`/`draft` are null while the tab's content is still loading.
 * Draft/dirty live here (per tab), not in a shared hook, so a background tab keeps its unsaved
 * edits and dirty flag even while a different tab is mounted in the workspace pane. */
interface OpenTab {
  path: string;
  detail: RequestDetail | null;
  draft: RequestDetail | null;
  dirty: boolean;
  tab: ReqTab;
  respTab: RespTab;
}

const NEW_TEMPLATE = `name: New request
method: GET
url: "{{baseUrl}}/path"
assertions:
  - { type: status, equals: 200 }
`;

interface SpecOpRow {
  key: string;
  method: string;
  path: string;
  badge: "tested" | "changed" | "untested";
}

const MIN_SIDEBAR = 200;
const MAX_SIDEBAR = 480;
const MIN_RAIL = 260;
const MAX_RAIL = 560;

/** Drag-to-resize for a grid column's pixel width, persisted across sessions. */
function usePanelWidth(storageKey: string, initial: number, min: number, max: number, invert: boolean) {
  const [size, setSize] = useState<number>(() => {
    const saved = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(saved) && saved >= min && saved <= max ? saved : initial;
  });

  useEffect(() => {
    window.localStorage.setItem(storageKey, String(size));
  }, [storageKey, size]);

  const onDragStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startSize = size;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (ev: PointerEvent): void => {
        const delta = ev.clientX - startX;
        setSize(Math.min(max, Math.max(min, startSize + (invert ? -delta : delta))));
      };
      const onUp = (): void => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [size, min, max, invert],
  );

  return [size, onDragStart] as const;
}

export function App() {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [env, setEnv] = useState("");
  const [spec, setSpec] = useState("");
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<{ missingSecrets: string[] } | null>(null);
  const [ranResults, setRanResults] = useState<Map<string, RunResult>>(new Map());
  const [driftRep, setDriftRep] = useState<DriftReport | null>(null);
  const [covRep, setCovRep] = useState<CoverageReport | null>(null);
  const [view, setView] = useState<View>("workspace");
  const [theme, setTheme] = useState<Theme>("dark");
  const [booted, setBooted] = useState(false);
  const [editing, setEditing] = useState<EditMode | null>(null);
  const [editorKey, setEditorKey] = useState(0); // bump to remount Editor with a fresh draft
  const [editorPath, setEditorPath] = useState("");
  const [editorText, setEditorText] = useState("");
  const [editorErr, setEditorErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [railTab, setRailTab] = useState<RailTab>("spec");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQ, setPaletteQ] = useState("");
  const [mock, setMock] = useState<MockStatus>({ running: false });
  const [mockEntries, setMockEntries] = useState<MockLogEntry[]>([]);
  const [mockBusy, setMockBusy] = useState(false);
  const [mockErr, setMockErr] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [collectionCollapsed, setCollectionCollapsed] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderPath, setNewFolderPath] = useState("");
  const [folderErr, setFolderErr] = useState<string | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renamingKind, setRenamingKind] = useState<RowKind>("request");
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; kind: RowKind } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ path: string; kind: RowKind } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [envModalOpen, setEnvModalOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [folderSettingsPath, setFolderSettingsPath] = useState<string | null>(null);
  const [sidebarW, sidebarDrag] = usePanelWidth("truspec.sidebarWidth", 270, MIN_SIDEBAR, MAX_SIDEBAR, false);
  const [railW, railDrag] = usePanelWidth("truspec.railWidth", 340, MIN_RAIL, MAX_RAIL, true);

  const activeTab = tabs.find((t) => t.path === activeTabPath) ?? null;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    getState()
      .then((s) => {
        setState(s);
        if (s.environments[0]) setEnv(s.environments[0]);
        if (s.specs[0]) setSpec(s.specs[0]);
      })
      .catch((e: unknown) => setError(String(e)));
    apiMockStatus()
      .then(setMock)
      .catch(() => {});
  }, []);

  // Fetch content for any tab that doesn't have it yet (freshly opened). A ref-tracked in-flight
  // set (rather than relying purely on `detail === null`) stops a second fetch from firing for the
  // same path while the first is still resolving, across the effect re-running as `tabs` changes.
  const loadingTabsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const t of tabs) {
      if (t.detail !== null || loadingTabsRef.current.has(t.path)) continue;
      loadingTabsRef.current.add(t.path);
      getRequest(t.path)
        .then((d) => {
          setTabs((prev) => prev.map((x) => (x.path === t.path ? { ...x, detail: d, draft: d } : x)));
        })
        .catch(() => {
          setTabs((prev) => prev.filter((x) => x.path !== t.path));
          setActiveTabPath((prev) => (prev === t.path ? null : prev));
        })
        .finally(() => {
          loadingTabsRef.current.delete(t.path);
        });
    }
  }, [tabs]);

  // A chosen spec drives the header badge, the right rail, and the spec dashboard — analyze it
  // as soon as it's picked rather than waiting for the user to open the spec tab.
  useEffect(() => {
    if (!spec) {
      setDriftRep(null);
      setCovRep(null);
      return;
    }
    let ignore = false;
    Promise.all([apiDrift(spec), apiCoverage(spec)])
      .then(([d, c]) => {
        if (!ignore) {
          setDriftRep(d);
          setCovRep(c);
        }
      })
      .catch((e: unknown) => {
        if (!ignore) setError(String(e));
      });
    return () => {
      ignore = true;
    };
  }, [spec]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        setPaletteQ("");
      } else if (e.key === "Escape" && paletteOpen) {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen]);

  // Poll the request log while the mock view is open and the server is live.
  useEffect(() => {
    if (view !== "mock" || !mock.running) return;
    let cancelled = false;
    const tick = (): void => {
      apiMockLog()
        .then((r) => {
          if (!cancelled) setMockEntries(r.log);
        })
        .catch(() => {});
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [view, mock.running]);

  const resultKey = useCallback((path: string) => normPath(state ? `${state.dir}/${path}` : path), [state]);

  const fullTree = useMemo(() => buildFolderTree(state?.requests ?? [], state?.folders ?? []), [state]);
  const [treeQuery, setTreeQuery] = useState("");
  const filteredTree = useMemo(() => filterTree(fullTree, treeQuery), [fullTree, treeQuery]);
  const tree = filteredTree ?? { ...fullTree, folders: [], requests: [] };
  const treeNoMatches = treeQuery.trim() !== "" && filteredTree === null;
  // An active search overrides manual collapse state without mutating it, so clearing the
  // search reverts to whatever was collapsed before — the filtered tree only contains matching
  // folders anyway, so there's nothing to hide.
  const visibleCollapsed = treeQuery.trim() ? new Set<string>() : collapsedFolders;
  const collectionName = state ? baseName(state.dir) : "";

  const toggleFolder = useCallback((path: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const openNewFolder = useCallback((prefix?: string) => {
    setFolderErr(null);
    setNewFolderPath(prefix ? `${prefix}/` : "");
    setCreatingFolder(true);
  }, []);

  const closeNewFolder = useCallback(() => {
    setCreatingFolder(false);
    setNewFolderPath("");
    setFolderErr(null);
  }, []);

  const doCreateFolder = useCallback(async () => {
    const p = newFolderPath.trim();
    if (!p) return;
    setFolderBusy(true);
    setFolderErr(null);
    try {
      const res = await createFolder(p);
      if (!res.ok) {
        setFolderErr(res.error ?? "failed to create folder");
        return;
      }
      setState(await getState());
      closeNewFolder();
    } catch (e) {
      setFolderErr(String(e));
    } finally {
      setFolderBusy(false);
    }
  }, [newFolderPath, closeNewFolder]);

  // Open-or-focus a request tab. Reused by the tree, the command palette, run results, and the
  // raw-YAML editor's save flow.
  const openTab = useCallback((path: string) => {
    setActiveTabPath(path);
    setTabs((prev) => {
      if (prev.some((t) => t.path === path)) return prev;
      return [...prev, { path, detail: null, draft: null, dirty: false, tab: "params", respTab: "body" }];
    });
  }, []);

  const closeTab = useCallback(
    (path: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.path === path);
        if (idx === -1) return prev;
        const next = prev.filter((t) => t.path !== path);
        if (activeTabPath === path) {
          const neighbor = next[Math.min(idx, next.length - 1)];
          setActiveTabPath(neighbor?.path ?? null);
        }
        return next;
      });
    },
    [activeTabPath],
  );

  const updateActiveTab = useCallback(
    (patch: Partial<OpenTab>) => {
      setTabs((prev) => prev.map((t) => (t.path === activeTabPath ? { ...t, ...patch } : t)));
    },
    [activeTabPath],
  );

  const setActiveTabField = useCallback(
    <K extends keyof RequestDetail>(key: K, value: RequestDetail[K]) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.path !== activeTabPath || !t.draft || !t.detail) return t;
          const draft = { ...t.draft, [key]: value };
          const dirty = JSON.stringify(draft) !== JSON.stringify(t.detail);
          return { ...t, draft, dirty };
        }),
      );
    },
    [activeTabPath],
  );

  const resetActiveTabDraft = useCallback(() => {
    setTabs((prev) => prev.map((t) => (t.path === activeTabPath ? { ...t, draft: t.detail, dirty: false } : t)));
  }, [activeTabPath]);

  const startRename = useCallback((path: string, kind: RowKind) => {
    const norm = normPath(path);
    const slash = norm.lastIndexOf("/");
    const leaf = slash === -1 ? norm : norm.slice(slash + 1);
    setRenamingPath(path);
    setRenamingKind(kind);
    setRenameValue(kind === "request" ? leaf.replace(/\.tspec\.yaml$/, "") : leaf);
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingPath(null);
    setRenameValue("");
  }, []);

  const doRename = useCallback(
    async (oldPath: string, newPath: string, kind: RowKind) => {
      const res = await renamePath(oldPath, newPath);
      if (!res.ok) {
        setError(res.error ?? "rename failed");
        setRenamingPath(null);
        return;
      }
      const finalPath = res.path ?? newPath;
      const oldNorm = normPath(oldPath);
      const finalNorm = normPath(finalPath);
      // A request rename only ever changes one path; a folder rename can move a whole prefix —
      // remap `tabs`/`activeTabPath`/`ranResults`/`collapsedFolders` so in-flight state survives either.
      const remap = (p: string): string => {
        const pn = normPath(p);
        if (pn === oldNorm) return finalNorm;
        if (kind === "folder" && pn.startsWith(`${oldNorm}/`)) return finalNorm + pn.slice(oldNorm.length);
        return p;
      };
      setTabs((prev) => prev.map((t) => ({ ...t, path: remap(t.path) })));
      setActiveTabPath((prev) => (prev !== null ? remap(prev) : prev));
      setRanResults((prev) => {
        const oldKey = resultKey(oldPath);
        const newKey = resultKey(finalPath);
        const next = new Map<string, RunResult>();
        for (const [k, v] of prev) {
          if (k === oldKey) next.set(newKey, v);
          else if (kind === "folder" && k.startsWith(`${oldKey}/`)) next.set(newKey + k.slice(oldKey.length), v);
          else next.set(k, v);
        }
        return next;
      });
      setCollapsedFolders((prev) => new Set([...prev].map(remap)));
      setRenamingPath(null);
      setRenameValue("");
      setState(await getState());
    },
    [resultKey],
  );

  // Only called via handleFolderDrop, which already checks canDropAt — so the target is
  // guaranteed valid (not the item's current folder, not the item's own subtree) by the time
  // this runs.
  const doMove = useCallback(
    (draggedPath: string, kind: RowKind, targetFolderPath: string) => {
      const leaf = baseName(normPath(draggedPath));
      const newPath = targetFolderPath ? `${targetFolderPath}/${leaf}` : leaf;
      void doRename(draggedPath, newPath, kind);
    },
    [doRename],
  );

  const handleRowDragStart = useCallback((path: string, kind: RowKind) => {
    setDragging({ path, kind });
  }, []);

  const handleRowDragEnd = useCallback(() => {
    setDragging(null);
    setDropTarget(null);
  }, []);

  const canDropAt = useCallback(
    (targetFolderPath: string): boolean => {
      if (!dragging) return false;
      const norm = normPath(dragging.path);
      const slash = norm.lastIndexOf("/");
      const currentParent = slash === -1 ? "" : norm.slice(0, slash);
      if (targetFolderPath === currentParent) return false;
      if (dragging.kind === "folder" && (targetFolderPath === norm || targetFolderPath.startsWith(`${norm}/`))) {
        return false;
      }
      return true;
    },
    [dragging],
  );

  const handleFolderDragEnter = useCallback(
    (path: string) => {
      if (canDropAt(path)) setDropTarget(path);
    },
    [canDropAt],
  );

  const handleFolderDragLeave = useCallback((path: string) => {
    setDropTarget((prev) => (prev === path ? null : prev));
  }, []);

  const handleFolderDrop = useCallback(
    (targetFolderPath: string) => {
      if (dragging && canDropAt(targetFolderPath)) doMove(dragging.path, dragging.kind, targetFolderPath);
      setDragging(null);
      setDropTarget(null);
    },
    [dragging, canDropAt, doMove],
  );

  const submitRename = useCallback(() => {
    if (!renamingPath) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      cancelRename();
      return;
    }
    const norm = normPath(renamingPath);
    const slash = norm.lastIndexOf("/");
    const dir = slash === -1 ? "" : norm.slice(0, slash);
    const leaf = renamingKind === "request" ? `${trimmed}.tspec.yaml` : trimmed;
    const newPath = dir ? `${dir}/${leaf}` : leaf;
    if (newPath === norm) {
      cancelRename();
      return;
    }
    void doRename(renamingPath, newPath, renamingKind);
  }, [renamingPath, renameValue, renamingKind, doRename, cancelRename]);

  const doDuplicate = useCallback(async (path: string) => {
    try {
      const res = await duplicatePath(path);
      if (!res.ok) {
        setError(res.error ?? "duplicate failed");
        return;
      }
      setState(await getState());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const doExport = useCallback(async () => {
    try {
      const result = await exportPostman();
      const failure = result as { ok?: boolean; error?: string };
      if (failure.ok === false) {
        setError(failure.error ?? "export failed");
        return;
      }
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${collectionName || "collection"}.postman_collection.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e));
    }
  }, [collectionName]);

  const handleRowAction = useCallback(
    (action: RowAction, path: string, kind: RowKind) => {
      if (action === "rename") startRename(path, kind);
      else if (action === "duplicate") void doDuplicate(path);
      else if (action === "delete") {
        setDeleteErr(null);
        setDeleteTarget({ path, kind });
      }
    },
    [startRename, doDuplicate],
  );

  const rowActions: RowActionsController = {
    renamingPath,
    renameValue,
    onRenameChange: setRenameValue,
    onRenameSubmit: submitRename,
    onRenameCancel: cancelRename,
    onAction: handleRowAction,
  };

  const doDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteErr(null);
    try {
      const res = await deletePath(deleteTarget.path);
      if (!res.ok) {
        setDeleteErr(res.error ?? "delete failed");
        return;
      }
      const { path, kind } = deleteTarget;
      const norm = normPath(path);
      const under = (p: string): boolean => {
        const pn = normPath(p);
        return pn === norm || (kind === "folder" && pn.startsWith(`${norm}/`));
      };
      const remainingTabs = tabs.filter((t) => !under(t.path));
      setTabs(remainingTabs);
      if (activeTabPath !== null && under(activeTabPath)) {
        setActiveTabPath(remainingTabs[remainingTabs.length - 1]?.path ?? null);
      }
      setRanResults((prev) => {
        const key = resultKey(path);
        const next = new Map<string, RunResult>();
        for (const [k, v] of prev) {
          if (k === key) continue;
          if (kind === "folder" && k.startsWith(`${key}/`)) continue;
          next.set(k, v);
        }
        return next;
      });
      setCollapsedFolders((prev) => new Set([...prev].filter((p) => !under(p))));
      if (editing === "edit" && under(editorPath)) setEditing(null);
      setDeleteTarget(null);
      setState(await getState());
    } catch (e) {
      setDeleteErr(String(e));
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteTarget, tabs, activeTabPath, resultKey, editing, editorPath]);

  const deleteCount = useMemo(() => {
    if (!deleteTarget || deleteTarget.kind !== "folder") return 0;
    const find = (node: FolderNode): FolderNode | null => {
      if (node.path === deleteTarget.path) return node;
      for (const f of node.folders) {
        const found = find(f);
        if (found) return found;
      }
      return null;
    };
    const node = find(fullTree);
    return node ? countRequests(node) : 0;
  }, [deleteTarget, fullTree]);

  const deleteEnvironment = useCallback((name: string) => deletePath(`environments/${name}.env.yaml`), []);

  const onEnvironmentsChanged = useCallback(async () => {
    const s = await getState();
    setState(s);
    if (env && !s.environments.includes(env)) setEnv(s.environments[0] ?? "");
  }, [env]);

  const doRun = useCallback(
    async (target?: string) => {
      setRunning(true);
      setError(null);
      try {
        const r = await apiRun(target, env || undefined, spec || undefined);
        setLastRun({ missingSecrets: r.missingSecrets });
        setRanResults((prev) => {
          const next = new Map(prev);
          for (const res of r.results) if (res.filePath) next.set(normPath(res.filePath), res);
          return next;
        });
        // A run triggered from the Flow view should stay there — only workspace-triggered
        // runs (or the top-bar "run all") jump to the runs rail.
        setView((v) => (v === "flow" ? v : "workspace"));
        setRailTab("runs");
      } catch (e) {
        setError(String(e));
      } finally {
        setRunning(false);
      }
    },
    [env, spec],
  );

  const openEdit = useCallback(() => {
    if (!activeTab?.detail) return;
    setEditorPath(activeTab.path);
    setEditorText(activeTab.detail.raw ?? "");
    setEditorErr(null);
    setEditorKey((k) => k + 1);
    setEditing("edit");
  }, [activeTab]);

  const openNew = useCallback((prefix?: string) => {
    setEditorPath(prefix ? `${prefix}/new-request.tspec.yaml` : "new-request.tspec.yaml");
    setEditorText(NEW_TEMPLATE);
    setEditorErr(null);
    setEditorKey((k) => k + 1);
    setEditing("new");
  }, []);

  const handleRowContextMenu = useCallback(
    (x: number, y: number, path: string, kind: RowKind) => {
      const items: ContextMenuItem[] = [];
      if (kind === "folder") {
        items.push(
          { label: "new request", onSelect: () => openNew(path) },
          { label: "new folder", onSelect: () => openNewFolder(path) },
          { label: "settings", onSelect: () => setFolderSettingsPath(path) },
        );
      }
      items.push(
        { label: "rename", onSelect: () => startRename(path, kind) },
        { label: "duplicate", onSelect: () => void doDuplicate(path) },
        {
          label: "delete",
          danger: true,
          onSelect: () => {
            setDeleteErr(null);
            setDeleteTarget({ path, kind });
          },
        },
      );
      setCtxMenu({ x, y, items });
    },
    [openNew, openNewFolder, startRename, doDuplicate],
  );

  const handleTreeContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      setCtxMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          { label: "new request", onSelect: () => openNew() },
          { label: "new folder", onSelect: () => openNewFolder() },
        ],
      });
    },
    [openNew, openNewFolder],
  );

  const doSave = useCallback(async (path: string, text: string) => {
    setSaving(true);
    setEditorErr(null);
    try {
      const res = await saveRequest(path, text);
      if (!res.ok) {
        setEditorErr(res.error ?? "save failed");
        return;
      }
      const saved = res.path ?? path;
      setState(await getState()); // refresh sidebar (picks up a new file)
      const freshDetail = await getRequest(saved);
      setTabs((prev) => {
        if (prev.some((t) => t.path === saved)) {
          return prev.map((t) =>
            t.path === saved ? { ...t, detail: freshDetail, draft: freshDetail, dirty: false } : t,
          );
        }
        return [...prev, { path: saved, detail: freshDetail, draft: freshDetail, dirty: false, tab: "params", respTab: "body" }];
      });
      setActiveTabPath(saved);
      setView("workspace");
      setEditing(null);
    } catch (e) {
      setEditorErr(String(e));
    } finally {
      setSaving(false);
    }
  }, []);

  const doSaveInline = useCallback(async (path: string, request: Record<string, unknown>) => {
    const res = await saveRequestObject(path, request);
    if (res.ok) {
      const saved = res.path ?? path;
      setState(await getState());
      const freshDetail = await getRequest(saved);
      setTabs((prev) =>
        prev.map((t) =>
          t.path === path ? { ...t, path: saved, detail: freshDetail, draft: freshDetail, dirty: false } : t,
        ),
      );
      setActiveTabPath((prev) => (prev === path ? saved : prev));
    }
    return res;
  }, []);

  const doMockStart = useCallback(async () => {
    if (!spec) return;
    setMockBusy(true);
    setMockErr(null);
    try {
      const r = await apiMockStart(spec);
      if (!r.ok) {
        setMockErr(r.error ?? "failed to start the mock server");
        return;
      }
      setMock(r);
    } catch (e) {
      setMockErr(String(e));
    } finally {
      setMockBusy(false);
    }
  }, [spec]);

  const doMockStop = useCallback(async () => {
    setMockBusy(true);
    setMockErr(null);
    try {
      await apiMockStop();
      setMock({ running: false });
      setMockEntries([]);
    } catch (e) {
      setMockErr(String(e));
    } finally {
      setMockBusy(false);
    }
  }, []);

  const toggleMock = useCallback(() => {
    if (mock.running) void doMockStop();
    else void doMockStart();
  }, [mock.running, doMockStart, doMockStop]);

  // Deep-link boot actions (?run=all, ?view=spec|mock, ?theme=light, ?new=1) — handy for demos/CI.
  useEffect(() => {
    if (!state || booted) return;
    setBooted(true);
    const p = new URLSearchParams(window.location.search);
    if (p.get("theme") === "light") setTheme("light");
    if (p.get("run") === "all") void doRun(undefined);
    const v = p.get("view");
    if (v === "spec" || v === "mock" || v === "flow") setView(v);
    if (p.get("new") === "1") openNew();
  }, [state, booted, doRun, openNew]);

  const selectedResult = activeTab ? ranResults.get(resultKey(activeTab.path)) : undefined;

  const runRows = useMemo(() => {
    if (!state) return [];
    return state.requests
      .map((r) => ({ r, res: ranResults.get(resultKey(r.path)) }))
      .filter((x): x is { r: RequestSummary; res: RunResult } => !!x.res)
      .map(({ r, res }) => ({
        path: r.path,
        name: r.name,
        method: r.method,
        ok: res.ok,
        status: res.response?.status,
        ms: res.response?.durationMs,
        onSelect: () => {
          openTab(r.path);
          setView("workspace");
        },
      }));
  }, [state, ranResults, resultKey, openTab]);

  const runStats = useMemo(() => {
    let passed = 0;
    let failed = 0;
    for (const r of ranResults.values()) (r.ok ? passed++ : failed++);
    return { passed, failed, total: passed + failed };
  }, [ranResults]);

  const driftCount = driftRep ? driftRep.added.length + driftRep.removed.length + driftRep.changed.length : 0;

  const specOps: SpecOpRow[] = useMemo(() => {
    if (!covRep) return [];
    const changedKeys = new Set((driftRep?.changed ?? []).map((c) => c.split(":")[0]));
    const all = [
      ...covRep.covered.map((k) => ({ key: k, covered: true })),
      ...covRep.uncovered.map((k) => ({ key: k, covered: false })),
    ];
    return all
      .map(({ key, covered }) => {
        const spaceAt = key.indexOf(" ");
        const method = spaceAt === -1 ? key : key.slice(0, spaceAt);
        const path = spaceAt === -1 ? "" : key.slice(spaceAt + 1);
        const changed = changedKeys.has(key);
        const badge: SpecOpRow["badge"] = covered ? (changed ? "changed" : "tested") : "untested";
        return { key, method, path, badge };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [covRep, driftRep]);

  const activeSpecRef = specRefOf(activeTab?.detail ?? null);
  const isStale = !!activeSpecRef && !!driftRep?.removed.includes(activeSpecRef);
  const contract = contractInfo(activeTab?.detail ?? null, selectedResult);

  const paletteItems = useMemo(() => {
    const q = paletteQ.trim().toLowerCase();
    return (state?.requests ?? []).filter((r) => !q || `${r.name} ${r.method} ${r.url}`.toLowerCase().includes(q));
  }, [state, paletteQ]);

  const jumpTo = useCallback(
    (path: string) => {
      openTab(path);
      setView("workspace");
      setPaletteOpen(false);
    },
    [openTab],
  );

  const showRail = view === "workspace" && !editing;

  return (
    <div className="app">
      <header className="topbar">
        {/* The visible brand is decorative styling; this is the document's real top-level heading. */}
        <h1 className="sr-only">TruSpec — local-first API client</h1>
        <div className="brand">
          <span className="logo">◢◤</span>
          <span className="word">
            Tru<span className="accent">Spec</span>
          </span>
          <span className="tag">spec-synced api client</span>
        </div>

        <nav className="nav">
          <button className={`nav-btn ${view === "workspace" ? "active" : ""}`} onClick={() => setView("workspace")}>
            workspace
          </button>
          <button className={`nav-btn ${view === "flow" ? "active" : ""}`} onClick={() => setView("flow")}>
            flow
          </button>
          <button className={`nav-btn ${view === "spec" ? "active" : ""}`} onClick={() => setView("spec")}>
            spec
          </button>
          <button className={`nav-btn ${view === "mock" ? "active" : ""}`} onClick={() => setView("mock")}>
            mock
          </button>
        </nav>

        <span className="spacer" />

        <button
          className="search-btn"
          onClick={() => {
            setPaletteOpen(true);
            setPaletteQ("");
          }}
        >
          <span className="muted">search</span>
          <kbd>⌘K</kbd>
        </button>

        <label className="field">
          <span>env</span>
          <select value={env} onChange={(e) => setEnv(e.target.value)}>
            <option value="">(none)</option>
            {state?.environments.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <button className="btn ghost" onClick={() => setEnvModalOpen(true)} title="manage environments">
          ⚙
        </button>

        {covRep && (
          <button className="spec-chip" title="OpenAPI coverage" onClick={() => setView("spec")}>
            <span className="spec-chip-label">spec</span>
            <span className="spec-chip-bar">
              <span className="spec-chip-fill" style={{ width: `${covRep.percent}%` }} />
            </span>
            <span className="spec-chip-pct">{covRep.percent}%</span>
          </button>
        )}

        <button className="btn run" disabled={running} onClick={() => doRun(undefined)}>
          {running ? "running…" : "▶ run all"}
        </button>
        <button className="btn ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="toggle theme">
          {theme === "dark" ? "☾" : "☀"}
        </button>
      </header>

      <div
        className={`workspace ${showRail ? "" : "no-rail"}`}
        style={{
          gridTemplateColumns: showRail
            ? `${sidebarW}px 5px minmax(0, 1fr) 5px ${railW}px`
            : `${sidebarW}px 5px minmax(0, 1fr)`,
        }}
      >
        <aside className="sidebar">
          <div className="collection-block">
            <div
              className="rail-head collection-head"
              title={state?.dir}
              role="button"
              tabIndex={0}
              onClick={() => setCollectionCollapsed((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setCollectionCollapsed((v) => !v);
                }
              }}
            >
              <span className={`collection-chev ${collectionCollapsed ? "" : "open"}`}>▸</span>
              <span className="collection-glyph">▣</span>
              <span className="collection-name">{collectionName || "collection"}</span>
              <span className="count">{state?.requests.length ?? 0}</span>
            </div>
            <div className="collection-actions">
              <button className="newreq new-folder" onClick={() => openNewFolder()} title="new folder">
                + folder
              </button>
              <button className="newreq new-request" onClick={() => openNew()} title="new request">
                + new
              </button>
              <button
                className="newreq export-postman"
                onClick={() => void doExport()}
                title="export as a Postman collection"
              >
                ⇩ export
              </button>
            </div>
          </div>
          {creatingFolder && (
            <div className="new-folder-row">
              <input
                autoFocus
                className="new-folder-input"
                placeholder="folder/subfolder"
                spellCheck={false}
                value={newFolderPath}
                onChange={(e) => setNewFolderPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void doCreateFolder();
                  else if (e.key === "Escape") closeNewFolder();
                }}
              />
              <button className="btn ghost small" onClick={closeNewFolder} disabled={folderBusy}>
                cancel
              </button>
              <button
                className="btn run small"
                onClick={() => void doCreateFolder()}
                disabled={folderBusy || !newFolderPath.trim()}
              >
                create
              </button>
            </div>
          )}
          {folderErr && <div className="new-folder-err">{folderErr}</div>}
          {!collectionCollapsed && (
            <>
              <div className="tree-search">
                <input
                  aria-label="filter requests"
                  placeholder="filter requests…"
                  spellCheck={false}
                  value={treeQuery}
                  onChange={(e) => setTreeQuery(e.target.value)}
                />
                {treeQuery && (
                  <button className="tree-search-clear" title="clear filter" onClick={() => setTreeQuery("")}>
                    ✕
                  </button>
                )}
              </div>
              <div
                className={`tree ${dragging && dropTarget === "" ? "drop-target-root" : ""}`}
                onContextMenu={handleTreeContextMenu}
                onDragOver={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDragEnter={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  if (canDropAt("")) setDropTarget("");
                }}
                onDrop={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  handleFolderDrop("");
                }}
              >
                {treeNoMatches ? (
                  <div className="muted pad">no requests match "{treeQuery.trim()}".</div>
                ) : (
                  <FolderTree
                    node={tree}
                    depth={0}
                    collapsed={visibleCollapsed}
                    onToggle={toggleFolder}
                    selected={activeTabPath}
                    driftRep={driftRep}
                    ranResults={ranResults}
                    resultKey={resultKey}
                    onSelect={(path) => {
                      openTab(path);
                      setView("workspace");
                    }}
                    actions={rowActions}
                    onContextMenu={handleRowContextMenu}
                    dragging={dragging}
                    dropTarget={dropTarget}
                    onDragStart={handleRowDragStart}
                    onDragEnd={handleRowDragEnd}
                    onFolderDragEnter={handleFolderDragEnter}
                    onFolderDragLeave={handleFolderDragLeave}
                    onFolderDrop={handleFolderDrop}
                  />
                )}
              </div>
            </>
          )}

          <div className="sidebar-foot">
            <div className="spec-pick">
              <span className="field">spec</span>
              <select aria-label="OpenAPI spec" value={spec} onChange={(e) => setSpec(e.target.value)}>
                <option value="">(choose spec)</option>
                {state?.specs.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            {covRep && (
              <div className="sidebar-bar">
                <span className="sidebar-bar-track">
                  <span className="sidebar-bar-fill" style={{ width: `${covRep.percent}%` }} />
                </span>
                <span className="muted">
                  {covRep.covered.length}/{covRep.total}
                </span>
                <button className="btn small" onClick={() => setView("spec")}>
                  analyze →
                </button>
              </div>
            )}
          </div>
        </aside>

        <div
          className="resize-handle"
          onPointerDown={sidebarDrag}
          role="separator"
          aria-orientation="vertical"
          aria-label="resize sidebar"
        />

        <main className="main">
          {!editing && tabs.length > 0 && (
            <TabStrip
              tabs={tabs.map((t) => ({
                path: t.path,
                name: t.detail?.name ?? baseName(t.path),
                method: t.detail?.method ?? "GET",
                dirty: t.dirty,
              }))}
              activePath={activeTabPath}
              onSelect={(path) => {
                setActiveTabPath(path);
                setView("workspace");
              }}
              onClose={closeTab}
            />
          )}
          {editing ? (
            <Editor
              key={editorKey}
              mode={editing}
              initialPath={editorPath}
              initialText={editorText}
              err={editorErr}
              saving={saving}
              onSave={doSave}
              onCancel={() => {
                setEditing(null);
                setEditorErr(null);
              }}
            />
          ) : view === "flow" ? (
            <FlowView
              env={env}
              running={running}
              onRun={() => doRun(undefined)}
              getResult={(path) => ranResults.get(resultKey(path))}
              onImported={() => {
                getState()
                  .then(setState)
                  .catch((e: unknown) => setError(String(e)));
              }}
            />
          ) : view === "spec" ? (
            <SpecDashboard spec={spec} driftRep={driftRep} covRep={covRep} specOps={specOps} driftCount={driftCount} />
          ) : view === "mock" ? (
            <MockView
              spec={spec}
              mock={mock}
              entries={mockEntries}
              busy={mockBusy}
              err={mockErr}
              onToggle={toggleMock}
              ops={specOps}
            />
          ) : activeTab ? (
            activeTab.detail && activeTab.draft ? (
              <RequestWorkspace
                key={activeTab.path}
                detail={activeTab.detail}
                draft={activeTab.draft}
                dirty={activeTab.dirty}
                result={selectedResult}
                running={running}
                tab={activeTab.tab}
                respTab={activeTab.respTab}
                activeSpecRef={activeSpecRef}
                isStale={isStale}
                contract={contract}
                onRun={() => doRun(activeTab.path)}
                onEdit={openEdit}
                onFieldChange={setActiveTabField}
                onDiscard={resetActiveTabDraft}
                onSave={(request) => doSaveInline(activeTab.path, request)}
                onTab={(t) => updateActiveTab({ tab: t })}
                onRespTab={(t) => updateActiveTab({ respTab: t })}
                onGotoSpec={() => setView("spec")}
              />
            ) : (
              <div className="empty muted">loading…</div>
            )
          ) : (
            <div className="empty">
              <div className="empty-mark">◢◤</div>
              <p>select a request, or run the whole collection.</p>
              <p className="muted">requests execute server-side via @truspec/core — no CORS, fully local.</p>
              <button className="btn small" onClick={() => openNew()}>
                + new request
              </button>
            </div>
          )}
        </main>

        {showRail && (
          <div
            className="resize-handle"
            onPointerDown={railDrag}
            role="separator"
            aria-orientation="vertical"
            aria-label="resize spec intelligence panel"
          />
        )}
        {showRail && (
          <section className="rail" aria-label="spec intelligence">
            <div className="rail-head">
              <span className="muted" style={{ color: "var(--lime)" }}>
                ⇄
              </span>
              spec intelligence
            </div>
            <div className="rail-body">
              {spec ? (
                <>
                  <div className="intel-card">
                    <div className="intel-card-head">
                      <span className="label">coverage</span>
                      <span className="intel-num">{covRep ? `${covRep.percent}%` : "…"}</span>
                    </div>
                    <div className="cov-bar">
                      <div className="cov-fill" style={{ width: `${covRep?.percent ?? 0}%` }} />
                    </div>
                    <div className="intel-sub">
                      {covRep ? `${covRep.covered.length}/${covRep.total}` : "…"} spec operations tested
                    </div>
                  </div>
                  <div className="drift-card">
                    <div className="drift-card-head">
                      drift
                      {driftRep &&
                        (driftRep.ok ? (
                          <span className="c-green">clean</span>
                        ) : (
                          <span className="c-amber">{driftCount} to resolve</span>
                        ))}
                    </div>
                    <div className="drift-mini-grid">
                      <button className="drift-mini" onClick={() => setView("spec")}>
                        <span className="n c-amber">{driftRep?.added.length ?? 0}</span>
                        <span className="l">untracked</span>
                      </button>
                      <button className="drift-mini" onClick={() => setView("spec")}>
                        <span className="n c-red">{driftRep?.removed.length ?? 0}</span>
                        <span className="l">stale</span>
                      </button>
                      <button className="drift-mini" onClick={() => setView("spec")}>
                        <span className="n c-violet">{driftRep?.changed.length ?? 0}</span>
                        <span className="l">changed</span>
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="muted pad">choose an OpenAPI spec below to see coverage and drift.</div>
              )}
            </div>

            <div className="rail-tabs">
              <button className={`rail-tab ${railTab === "spec" ? "active" : ""}`} onClick={() => setRailTab("spec")}>
                this request
              </button>
              <button className={`rail-tab ${railTab === "runs" ? "active" : ""}`} onClick={() => setRailTab("runs")}>
                runs
              </button>
            </div>

            {railTab === "spec" ? (
              <div className="rail-panel">
                {!activeTab?.detail ? (
                  <div className="muted pad">select a request to see its spec status.</div>
                ) : !activeSpecRef ? (
                  <div className="muted pad">
                    not linked to a spec operation. Add a <code>spec:</code> block to enable drift + coverage tracking.
                  </div>
                ) : isStale ? (
                  <div className="stale-card">
                    <div className="stale-card-title">⚠ stale — not in current spec</div>
                    <p>
                      This request maps to no operation in <code>{spec}</code>. Either add the operation to the spec
                      or delete the request. CI&apos;s <code>drift</code> gate fails while it exists.
                    </p>
                  </div>
                ) : (
                  <div className="spec-op-card">
                    <div className="spec-op-head">
                      <span className={`m m-${activeTab.detail.method}`}>{activeTab.detail.method}</span>
                      <code>{activeTab.detail.spec?.operationId ?? activeTab.detail.spec?.operation}</code>
                    </div>
                    <div className="spec-op-body">
                      {contract.state === "ok" && <span className="c-green" style={{ fontSize: 11.5, fontWeight: 600 }}>✓ contract passes</span>}
                      {contract.state === "fail" && <span className="c-red" style={{ fontSize: 11.5, fontWeight: 600 }}>✗ contract failed</span>}
                      <p>{contract.note}</p>
                      <button className="btn small" onClick={() => setView("spec")}>
                        view in spec →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rail-panel">
                {runStats.total > 0 ? (
                  <>
                    <div className="rsum">
                      <span className="ok">{runStats.passed} passed</span>
                      {runStats.failed > 0 && <span className="bad">{runStats.failed} failed</span>}
                    </div>
                    <div className="result-list">
                      {runRows.map((row) => (
                        <RunRow key={row.path} row={row} />
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="empty-runs">
                    <div style={{ marginBottom: 12 }}>nothing run yet.</div>
                    <button className="btn run" onClick={() => doRun(undefined)}>
                      ▶ run collection
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      <footer className="statusline">
        <span className="seg dir" title={state?.dir}>
          {state ? shortDir(state.dir) : "…"}
        </span>
        <span className="seg">env: {env || "—"}</span>
        {covRep && <span className="seg">coverage {covRep.percent}%</span>}
        {driftRep && (
          <span className="seg" style={{ color: driftRep.ok ? "var(--green)" : "var(--amber)" }}>
            {driftRep.ok ? "no drift" : `drift · ${driftCount}`}
          </span>
        )}
        {runStats.total > 0 && (
          <span className="seg">
            {runStats.passed} passed · {runStats.failed} failed
          </span>
        )}
        {lastRun?.missingSecrets.length ? (
          <span className="seg warn">missing secrets: {lastRun.missingSecrets.join(", ")}</span>
        ) : null}
        {error && <span className="seg warn">{error}</span>}
        <span className="seg grow" />
        <span className="seg">
          <span className={`dot ${mock.running ? "live" : "off"}`} />
          mock {mock.running ? `:${mock.port}` : "stopped"}
        </span>
        <span className="seg brandlet">TRUSPEC</span>
      </footer>

      {paletteOpen && (
        <CommandPalette
          query={paletteQ}
          onQuery={setPaletteQ}
          items={paletteItems}
          total={state?.requests.length ?? 0}
          onSelect={jumpTo}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title={`delete ${deleteTarget.kind}`}
          body={
            deleteTarget.kind === "folder"
              ? `Delete "${baseName(deleteTarget.path)}" and ${deleteCount} request${deleteCount === 1 ? "" : "s"} inside it? This cannot be undone.`
              : `Delete "${baseName(deleteTarget.path)}"? This cannot be undone.`
          }
          confirmLabel="delete"
          danger
          busy={deleteBusy}
          error={deleteErr}
          onConfirm={() => void doDelete()}
          onCancel={() => {
            setDeleteTarget(null);
            setDeleteErr(null);
          }}
        />
      )}

      {envModalOpen && (
        <EnvironmentModal
          environments={state?.environments ?? []}
          onClose={() => setEnvModalOpen(false)}
          onDelete={deleteEnvironment}
          onChanged={() => void onEnvironmentsChanged()}
        />
      )}

      <ContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />

      {folderSettingsPath && (
        <FolderSettingsModal
          path={folderSettingsPath}
          onClose={() => setFolderSettingsPath(null)}
          onSaved={() => {
            getState()
              .then(setState)
              .catch((e: unknown) => setError(String(e)));
          }}
        />
      )}
    </div>
  );
}

function RunRow({
  row,
}: {
  row: { path: string; name: string; method: string; ok: boolean; status?: number; ms?: number; onSelect: () => void };
}) {
  return (
    <button className={`rrow ${row.ok ? "ok" : "bad"}`} onClick={row.onSelect}>
      <div className="rrow-top">
        <span className="tick">{row.ok ? "✓" : "✗"}</span>
        <span className={`m m-${row.method}`}>{row.method}</span>
        <span className="rrow-name">{row.name}</span>
        {row.status !== undefined && <span className={`rrow-status ${statusClass(row.status)}`}>{row.status}</span>}
        {row.ms !== undefined && <span className="muted">{row.ms}ms</span>}
      </div>
    </button>
  );
}

function SpecDashboard({
  spec,
  driftRep,
  covRep,
  specOps,
  driftCount,
}: {
  spec: string;
  driftRep: DriftReport | null;
  covRep: CoverageReport | null;
  specOps: SpecOpRow[];
  driftCount: number;
}) {
  if (!spec) {
    return (
      <div className="empty">
        <div className="empty-mark">◢◤</div>
        <p>choose an OpenAPI spec to analyze drift and coverage.</p>
      </div>
    );
  }
  if (!driftRep || !covRep) return <div className="empty muted">analyzing {spec}…</div>;

  return (
    <div className="specview">
      <div className="spec-title">
        <span className="glyph">⇄</span>
        <code>{spec}</code>
        {driftRep.ok ? <span className="pill s2">no drift</span> : <span className="pill s4">drift · {driftCount}</span>}
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-card-head">coverage</div>
          <div className="stat-big-row">
            <span className="stat-big">{covRep.percent}%</span>
            <span className="stat-big-sub">
              {covRep.covered.length}/{covRep.total} operations
              <br />
              have a test
            </span>
          </div>
          <div className="cov-bar">
            <div className="cov-fill" style={{ width: `${covRep.percent}%` }} />
          </div>
          {covRep.uncovered.length > 0 && (
            <>
              <div className="cov-meta">untested:</div>
              <div className="oplist">
                {covRep.uncovered.map((o) => (
                  <code key={o} className="op amber">
                    ✗ {o}
                  </code>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="stat-card">
          <div className="stat-card-head">drift vs spec</div>
          <div className="drift-stat-grid">
            <div className="drift-stat">
              <span className="n c-amber">{driftRep.added.length}</span>
              <span className="l">untracked</span>
            </div>
            <div className="drift-stat">
              <span className="n c-red">{driftRep.removed.length}</span>
              <span className="l">stale</span>
            </div>
            <div className="drift-stat">
              <span className="n c-violet">{driftRep.changed.length}</span>
              <span className="l">changed</span>
            </div>
          </div>
          <p>
            CI runs <code>truspec drift</code> and exits non-zero on any of these — the build fails the moment code
            and spec disagree.
          </p>
        </div>
      </div>

      <div className="ops-block">
        <div className="section-head">
          operations <span className="muted">{covRep.total}</span>
        </div>
        <div className="ops-table">
          {specOps.map((o) => (
            <div className="op-row" key={o.key}>
              <span className={`m m-${o.method}`}>{o.method}</span>
              <code>{o.path}</code>
              <span className={`op-badge ${o.badge}`}>{o.badge}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="section-head">what to resolve</div>
        <div className="resolve-groups">
          {driftRep.added.length > 0 && (
            <div>
              <div className="resolve-group-head">
                <span className="resolve-dot amber" />
                <span className="resolve-title">Untracked in collection</span>
                <span className="resolve-sub">in the spec, no test yet</span>
              </div>
              <div className="resolve-items">
                {driftRep.added.map((o) => (
                  <code key={o} className="op amber">
                    + {o}
                  </code>
                ))}
              </div>
            </div>
          )}
          {driftRep.removed.length > 0 && (
            <div>
              <div className="resolve-group-head">
                <span className="resolve-dot red" />
                <span className="resolve-title">Stale — not in spec</span>
                <span className="resolve-sub">a request exists for an operation the spec dropped</span>
              </div>
              <div className="resolve-items">
                {driftRep.removed.map((o) => (
                  <code key={o} className="op red">
                    − {o}
                  </code>
                ))}
              </div>
            </div>
          )}
          {driftRep.changed.length > 0 && (
            <div>
              <div className="resolve-group-head">
                <span className="resolve-dot violet" />
                <span className="resolve-title">Signature changed</span>
                <span className="resolve-sub">params or schema differ from the request</span>
              </div>
              <div className="resolve-items">
                {driftRep.changed.map((o) => (
                  <code key={o} className="op violet">
                    ~ {o}
                  </code>
                ))}
              </div>
            </div>
          )}
          {driftRep.ok && <div className="muted pad">collection matches the spec.</div>}
        </div>
      </div>

      {driftRep.liveMissing && driftRep.liveMissing.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div className="section-head">missing from live API</div>
          <div className="oplist">
            {driftRep.liveMissing.map((o) => (
              <code key={o} className="op red">
                ✗ {o}
              </code>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MockView({
  spec,
  mock,
  entries,
  busy,
  err,
  onToggle,
  ops,
}: {
  spec: string;
  mock: MockStatus;
  entries: MockLogEntry[];
  busy: boolean;
  err: string | null;
  onToggle: () => void;
  ops: SpecOpRow[];
}) {
  return (
    <div className="mockview">
      <div className="mock-card">
        <div className="mock-card-top">
          <div className="mock-dot-wrap">
            <span className={`dot ${mock.running ? "live" : "off"}`} />
          </div>
          <div className="mock-title-block">
            <span className="mock-title">Mock server</span>
            <span className="mock-sub">offline HTTP server generated from your spec</span>
          </div>
          <span className="spacer" />
          <span className="mock-state" style={{ color: mock.running ? "var(--green)" : "var(--dimmer)" }}>
            {mock.running ? "running" : "stopped"}
          </span>
          {mock.running && (
            <span className="mock-port">
              localhost:<span className="n">{mock.port}</span>
            </span>
          )}
          <button className="btn run" disabled={!spec || busy} onClick={onToggle}>
            {mock.running ? "■ stop" : "▶ start"}
          </button>
        </div>
        <div className="mock-cmd">
          <span className="prompt">$</span>
          <code>
            truspec mock --spec {spec || "<spec>"} --port {mock.port ?? 4000}
          </code>
        </div>
        <div className="mock-features">
          <span>✓ request validation</span>
          <span>✓ example responses from schema</span>
          <span>✓ configurable latency</span>
          <span>✓ no cloud, no account</span>
        </div>
        {!spec && <div className="mock-err" style={{ color: "var(--dim)" }}>choose an OpenAPI spec (below) to start the mock server.</div>}
        {err && <div className="mock-err">{err}</div>}
      </div>

      <div className="mock-grid">
        <div>
          <div className="section-head">
            routes <span className="muted">{ops.length}</span>
          </div>
          <div className="ops-table">
            {ops.map((o) => (
              <div className="op-row" key={o.key}>
                <span className={`m m-${o.method}`}>{o.method}</span>
                <code>{o.path}</code>
                <span className={`op-badge ${o.badge}`}>{o.badge}</span>
              </div>
            ))}
            {ops.length === 0 && <div className="muted pad">select a spec to see its routes.</div>}
          </div>
        </div>

        <div>
          <div className="section-head">request log</div>
          {mock.running ? (
            <>
              <div className="mock-log-wrap">
                {entries.map((h, i) => (
                  <div className="mock-log-row" key={i}>
                    <span className={`method m-${h.method}`}>{h.method}</span>
                    <code>{h.path}</code>
                    <span className={`status ${statusClass(h.status)}`}>{h.status}</span>
                    <span className="ms">{h.durationMs}ms</span>
                  </div>
                ))}
                {entries.length === 0 && <div className="muted pad">no requests yet — hit the mock server to see them here.</div>}
              </div>
              <p className="mock-log-hint">
                A <code>404</code> means request validation rejected a call that doesn&apos;t match the spec.
              </p>
            </>
          ) : (
            <div className="mock-empty">server stopped — start it to serve routes and log requests.</div>
          )}
        </div>
      </div>
    </div>
  );
}
