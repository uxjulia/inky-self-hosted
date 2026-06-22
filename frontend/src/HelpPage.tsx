import { Home } from "lucide-react";

type HelpPageProps = {
  isDesktopApp: boolean;
  standaloneMode: boolean;
  onOpenApp: () => void;
};

export function HelpPage({ isDesktopApp, standaloneMode, onOpenApp }: HelpPageProps) {
  return (
    <section className="help-page">
      <div className="help-hero">
        <div>
          <p className="eyebrow">Getting Started</p>
          <h2>Send books and articles to your Cross<span className="serif">I</span>nk reader</h2>
          <p>
            {standaloneMode
              ? "Inky stores local files on this iPhone and sends them directly to an X3 or X4 device. EPUB, TXT, XTC, XTCH, BMP, and PNG files are sent as-is."
              : "Inky connects catalogs, feeds, cloud folders, and local files to an X3 or X4 device. EPUBs can be optimized before sending. TXT, XTC, XTCH, BMP, and PNG files are sent as-is."}
          </p>
        </div>
      </div>

      <div className="help-grid">
        <article className="help-card">
          <span className="help-step">1</span>
          <div>
            <h3>Connect Your Device</h3>
            <p>On the reader, open File Transfer and join the same network as this app.</p>
            <ul>
              <li>Use the device host shown by CrossInk, usually <code>crosspoint.local</code> or an IP address.</li>
              <li>Keep the destination folder as <code>/</code> or enter a folder such as <code>/Books</code>. Inky creates missing folders before upload.</li>
              {!standaloneMode && <li>Select X3 or X4 before sending EPUBs so the optimizer uses the right screen target.</li>}
              <li>Use Test Connection to confirm the app can reach the reader.</li>
            </ul>
          </div>
        </article>

        <article className="help-card">
          <span className="help-step">2</span>
          <div>
            <h3>{standaloneMode ? "Add Local Files" : "Add Sources"}</h3>
            {standaloneMode ? (
              <>
                <p>Local Library stores files selected from this iPhone.</p>
                <ul>
                  <li>Use the add button in Local Library to pick EPUB, TXT, XTC, XTCH, BMP, or PNG files.</li>
                  <li>Files stay in the app's local storage until you remove them.</li>
                </ul>
              </>
            ) : (
              <>
                <p>Sources are places Inky can browse for books, files, or articles.</p>
                <ul>
                  <li>OPDS catalogs expose book catalogs such as Standard Ebooks or Project Gutenberg.</li>
                  <li>WebDAV sources expose cloud folders from services such as Koofr, Nextcloud, or compatible storage.</li>
                  <li>RSS and Atom feeds expose articles that Inky can convert into simple EPUB files.</li>
                  {isDesktopApp && <li>Local Folder sources (desktop only) allow adding local folders.</li>}
                  <li>Local Library contains uploaded files and items saved from external sources.</li>
                </ul>
              </>
            )}
          </div>
        </article>

        <article className="help-card">
          <span className="help-step">3</span>
          <div>
            <h3>Browse And Search</h3>
            <p>{standaloneMode ? "Use Local Library to browse files stored on this phone." : "Select a source, then browse folders, catalog pages, or feed entries."}</p>
            <ul>
              <li>{standaloneMode ? "Use Search to filter local files." : "Use Search when a source supports it or to filter the current results."}</li>
              <li>Use Sort for source order, title order, and Local Library file type order.</li>
              {!standaloneMode && <li>Folder rows open when clicked; book, article, and file rows show save/send actions.</li>}
            </ul>
          </div>
        </article>

        <article className="help-card">
          <span className="help-step">4</span>
          <div>
            <h3>Send Files</h3>
            <p>Use the send icon beside a result or a Local Library item.</p>
            <ul>
              {!standaloneMode && <li>EPUBs are optimized for the selected X3 or X4 device before upload.</li>}
              {!standaloneMode && <li>RSS and Atom articles are first converted to EPUB, then optimized and sent.</li>}
              <li>TXT, XTC, XTCH, BMP, and PNG files skip optimization and upload directly.</li>
              <li>The Device card shows the latest job log after send work starts.</li>
            </ul>
          </div>
        </article>
      </div>

      {!standaloneMode && <section className="help-section">
        <div className="help-section-header">
          <p className="eyebrow">CrossInk Specific</p>
          <h3>What Inky Adds To EPUBs</h3>
        </div>
        <article className="help-card help-card-wide">
          <div>
            <p>Optimized EPUBs include extra data and cleanup that CrossInk can use while reading.</p>
            <ul>
              <li>Page locations let CrossInk jump and resume using stable word-based positions instead of fragile screen pages.</li>
              <li>Reference pages give a consistent page-style number that stays useful even when font size, margins, or orientation change.</li>
              <li>TOC, cover, image, and metadata cleanup help books open cleaner and use less device memory.</li>
              <li>Optional long-section splitting can break EPUB sections over 2,000 visible words into smaller reader sections.</li>
              <li>Images are prepared for the selected X3 or X4 screen so covers and illustrations fit the target display better.</li>
            </ul>
          </div>
        </article>
      </section>}
    </section>
  );
}
