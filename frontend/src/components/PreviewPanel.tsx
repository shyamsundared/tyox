import { useState } from "react";

type Props = {
  className: string;
  previewUrl: string;
};

export function PreviewPanel({ className, previewUrl }: Props) {
  // changing the key makes react recreate the iframe, which reloads the page inside it
  const [reloadCount, setReloadCount] = useState(0);

  return (
    <section className={`flex-col min-h-0 min-w-0 bg-white ${className}`}>
      <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 text-sm">
        <span className={`h-2 w-2 rounded-full ${previewUrl ? "bg-green-500" : "bg-zinc-300"}`} />
        <span className="flex-1 truncate rounded-md bg-zinc-100 px-3 py-1 text-zinc-500">{previewUrl || "No preview yet"}</span>
        {previewUrl && (
          <>
            <button type="button" className="text-zinc-600 hover:text-zinc-900" onClick={() => setReloadCount(reloadCount + 1)}>Refresh</button>
            <a className="text-zinc-600 hover:text-zinc-900" href={previewUrl} target="_blank" rel="noreferrer">Open</a>
          </>
        )}
      </header>

      {previewUrl ? (
        <iframe
          key={reloadCount}
          title="App preview"
          src={previewUrl}
          sandbox="allow-scripts allow-forms allow-same-origin"
          className="flex-1 w-full"
        />
      ) : (
        <div className="m-auto p-4 text-center">
          <h2 className="font-semibold text-zinc-800">Your app will show up here</h2>
          <p className="mt-1 text-sm text-zinc-500">Send a request and Tyox will build a preview.</p>
        </div>
      )}
    </section>
  );
}
