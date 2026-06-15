import { Home } from "lucide-react";

type HelpPageProps = {
  onOpenApp: () => void;
};

export function HelpPage({ onOpenApp }: HelpPageProps) {
  return (
    <section className="help-page">
      <div className="help-hero">
        <div>
          <p className="eyebrow">Getting Started</p>
          <h2>Send books and articles to your Cross<span className="serif">I</span>nk reader</h2>
          <p>
            Inky connects catalogs, feeds, cloud folders, and local files to an X3 or X4 device. EPUBs can be optimized before sending;
            TXT, XTC, and XTCH files are sent as-is.
          </p>
        </div>
        <button className="primary icon-text" type="button" onClick={onOpenApp}>
          <Home size={16} />
          Open App
        </button>
      </div>

      <div className="help-grid">
        <article className="help-card">
          <span className="help-step">1</span>
          <div>
            <h3>Connect Your Device</h3>
            <p>On the reader, open File Transfer and join the same network as this app.</p>
            <ul>
              <li>Use the device host shown by CrossInk, usually `crosspoint.local` or an IP address.</li>
              <li>Keep the destination folder as `/` or enter a folder such as `/Books`; Inky creates missing folders before upload.</li>
              <li>Select X3 or X4 before sending EPUBs so the optimizer uses the right screen target.</li>
              <li>Use Test Connection to confirm the app can reach the reader.</li>
            </ul>
          </div>
        </article>

        <article className="help-card">
          <span className="help-step">2</span>
          <div>
            <h3>Add Sources</h3>
            <p>Sources are places Inky can browse for books, files, or articles.</p>
            <ul>
              <li>OPDS catalogs expose book catalogs such as Standard Ebooks or Project Gutenberg.</li>
              <li>WebDAV sources expose cloud folders from services such as Koofr, Nextcloud, or compatible storage.</li>
              <li>RSS and Atom feeds expose articles that Inky can convert into simple EPUB files.</li>
              <li>Local Library contains uploaded files and folders added from the desktop app.</li>
            </ul>
          </div>
        </article>

        <article className="help-card">
          <span className="help-step">3</span>
          <div>
            <h3>Browse And Search</h3>
            <p>Select a source, then browse folders, catalog pages, or feed entries.</p>
            <ul>
              <li>Use Search when a source supports it or to filter the current results.</li>
              <li>Use Sort for source order, title order, and Local Library file type order.</li>
              <li>Folder rows open when clicked; book, article, and file rows show save/send actions.</li>
            </ul>
          </div>
        </article>

        <article className="help-card">
          <span className="help-step">4</span>
          <div>
            <h3>Send Files</h3>
            <p>Use the send icon beside a result or a Local Library item.</p>
            <ul>
              <li>EPUBs are optimized for the selected X3 or X4 device before upload.</li>
              <li>RSS and Atom articles are first converted to EPUB, then optimized and sent.</li>
              <li>TXT, XTC, and XTCH files skip optimization and upload directly.</li>
              <li>The Device card shows the latest job log after send work starts.</li>
            </ul>
          </div>
        </article>
      </div>
    </section>
  );
}
