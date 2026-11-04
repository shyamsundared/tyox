import { Icon } from "@/components/Icon";

type PreviewPanelProps = {
  previewUrl: string;
  previewVersion: number;
  onRefresh: () => void;
};

export function PreviewPanel({ previewUrl, previewVersion, onRefresh }: PreviewPanelProps) {
  const statusClassName = previewUrl ? "online-dot" : "idle-dot";

  return (
    <section className="preview-panel" aria-label="Generated app preview">
      <header className="preview-toolbar">
        <div>
          <span className="preview-title">Preview</span>
          <span className="preview-live">
            <span className={statusClassName} />
            {previewUrl ? "Live" : "Waiting"}
          </span>
        </div>
        <div className="preview-actions">
          <button
            type="button"
            className="icon-action"
            onClick={onRefresh}
            disabled={!previewUrl}
            aria-label="Refresh preview"
          >
            <Icon name="refresh" size={16} />
          </button>
          {previewUrl && (
            <a
              className="icon-action"
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Open preview in new tab"
            >
              <Icon name="external" size={16} />
            </a>
          )}
        </div>
      </header>

      {previewUrl ? (
        <iframe
          key={previewVersion}
          title="Generated React app preview"
          src={previewUrl}
          sandbox="allow-scripts allow-forms allow-same-origin"
          className="preview-frame"
        />
      ) : (
        <div className="preview-empty">
          <div className="preview-empty-copy">
            <h2>Your app will appear here</h2>
            <p>Send your first request and Tyox will build a preview you can interact with.</p>
          </div>
        </div>
      )}

      <footer className="preview-footer">
        <span>
          <span className={statusClassName} />
          {previewUrl ? "Preview server running in E2B" : "No preview running yet"}
        </span>
        <span>React · Vite</span>
      </footer>
    </section>
  );
}
