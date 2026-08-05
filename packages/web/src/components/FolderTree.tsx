import type { DriftReport, RunResult } from "../api";
import { countRequests, type FolderNode } from "../tree";

export type RowKind = "request" | "folder";
export type RowAction = "rename" | "duplicate" | "delete";

export interface RowActionsController {
  renamingPath: string | null;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onAction: (action: RowAction, path: string, kind: RowKind) => void;
}

function RowActions({
  path,
  kind,
  actions,
}: {
  path: string;
  kind: RowKind;
  actions: RowActionsController;
}) {
  return (
    <span className="row-actions">
      <button
        className="row-action-btn"
        title={`rename ${kind}`}
        onClick={(e) => {
          e.stopPropagation();
          actions.onAction("rename", path, kind);
        }}
      >
        ✎
      </button>
      <button
        className="row-action-btn"
        title={`duplicate ${kind}`}
        onClick={(e) => {
          e.stopPropagation();
          actions.onAction("duplicate", path, kind);
        }}
      >
        ⧉
      </button>
      <button
        className="row-action-btn danger"
        title={`delete ${kind}`}
        onClick={(e) => {
          e.stopPropagation();
          actions.onAction("delete", path, kind);
        }}
      >
        ✕
      </button>
    </span>
  );
}

function RenameInput({ actions }: { actions: RowActionsController }) {
  return (
    <input
      autoFocus
      className="rename-input"
      spellCheck={false}
      value={actions.renameValue}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => actions.onRenameChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") actions.onRenameSubmit();
        else if (e.key === "Escape") actions.onRenameCancel();
      }}
    />
  );
}

export interface DragState {
  path: string;
  kind: RowKind;
}

export function FolderTree({
  node,
  depth,
  collapsed,
  onToggle,
  selected,
  driftRep,
  ranResults,
  resultKey,
  onSelect,
  actions,
  onContextMenu,
  dragging,
  dropTarget,
  onDragStart,
  onDragEnd,
  onFolderDragEnter,
  onFolderDragLeave,
  onFolderDrop,
}: {
  node: FolderNode;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  selected: string | null;
  driftRep: DriftReport | null;
  ranResults: Map<string, RunResult>;
  resultKey: (path: string) => string;
  onSelect: (path: string) => void;
  actions: RowActionsController;
  onContextMenu: (x: number, y: number, path: string, kind: RowKind) => void;
  dragging: DragState | null;
  dropTarget: string | null;
  onDragStart: (path: string, kind: RowKind) => void;
  onDragEnd: () => void;
  onFolderDragEnter: (path: string) => void;
  onFolderDragLeave: (path: string) => void;
  onFolderDrop: (path: string) => void;
}) {
  const indent = 8 + depth * 14;
  return (
    <>
      {node.folders.map((f) => {
        const isCollapsed = collapsed.has(f.path);
        const isRenaming = actions.renamingPath === f.path;
        return (
          <div key={f.path}>
            <div
              className={`folder-row ${dragging?.path === f.path ? "dragging" : ""} ${
                dropTarget === f.path ? "drop-target" : ""
              }`}
              style={{ paddingLeft: indent }}
              onClick={() => onToggle(f.path)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onContextMenu(e.clientX, e.clientY, f.path, "folder");
              }}
              role="button"
              tabIndex={0}
              title={f.path}
              draggable={!isRenaming}
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", f.path);
                onDragStart(f.path, "folder");
              }}
              onDragEnd={(e) => {
                e.stopPropagation();
                onDragEnd();
              }}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
              }}
              onDragEnter={(e) => {
                if (!dragging) return;
                e.preventDefault();
                e.stopPropagation();
                onFolderDragEnter(f.path);
              }}
              onDragLeave={(e) => {
                e.stopPropagation();
                onFolderDragLeave(f.path);
              }}
              onDrop={(e) => {
                if (!dragging) return;
                e.preventDefault();
                e.stopPropagation();
                onFolderDrop(f.path);
              }}
            >
              <span className={`folder-chev ${isCollapsed ? "" : "open"}`}>▸</span>
              <span className="folder-icon">▤</span>
              {isRenaming ? <RenameInput actions={actions} /> : <span className="folder-name">{f.name}</span>}
              <span className="folder-count">{countRequests(f)}</span>
              {!isRenaming && <RowActions path={f.path} kind="folder" actions={actions} />}
            </div>
            {!isCollapsed && (
              <FolderTree
                node={f}
                depth={depth + 1}
                collapsed={collapsed}
                onToggle={onToggle}
                selected={selected}
                driftRep={driftRep}
                ranResults={ranResults}
                resultKey={resultKey}
                onSelect={onSelect}
                actions={actions}
                onContextMenu={onContextMenu}
                dragging={dragging}
                dropTarget={dropTarget}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onFolderDragEnter={onFolderDragEnter}
                onFolderDragLeave={onFolderDragLeave}
                onFolderDrop={onFolderDrop}
              />
            )}
          </div>
        );
      })}
      {node.requests.map((r, i) => {
        const res = ranResults.get(resultKey(r.path));
        const isRenaming = actions.renamingPath === r.path;
        return (
          <div
            key={r.path}
            className={`req ${selected === r.path ? "sel" : ""} ${dragging?.path === r.path ? "dragging" : ""}`}
            style={{ paddingLeft: indent + 8, animationDelay: `${i * 18}ms` }}
            onClick={() => onSelect(r.path)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onContextMenu(e.clientX, e.clientY, r.path, "request");
            }}
            role="button"
            tabIndex={0}
            draggable={!isRenaming}
            onDragStart={(e) => {
              e.stopPropagation();
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", r.path);
              onDragStart(r.path, "request");
            }}
            onDragEnd={(e) => {
              e.stopPropagation();
              onDragEnd();
            }}
          >
            <span className={`m m-${r.method}`}>{r.method}</span>
            {isRenaming ? <RenameInput actions={actions} /> : <span className="rname">{r.name}</span>}
            {!!driftRep?.removed.includes(r.specRef ?? "") && <span className="stale-tag">stale</span>}
            {res && <span className={`dot ${res.ok ? "ok" : "bad"}`} />}
            {!isRenaming && <RowActions path={r.path} kind="request" actions={actions} />}
          </div>
        );
      })}
    </>
  );
}
