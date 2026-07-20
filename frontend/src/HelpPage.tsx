import { X } from "lucide-react";
import { useState } from "react";
import { helpStorageBannerDismissedStorageKey } from "./appConstants";

type HelpPageProps = {
  isDesktopApp: boolean;
  isSelfHostedBrowser: boolean;
  isHostedApp: boolean;
  isPublicReadOnly: boolean;
  standaloneMode: boolean;
  onOpenApp: () => void;
};

export function HelpPage({
  isDesktopApp,
  isSelfHostedBrowser,
  isHostedApp,
  isPublicReadOnly,
  standaloneMode,
  onOpenApp
}: HelpPageProps) {
  const usbOnlyMode = isHostedApp || isPublicReadOnly;
  const [storageBannerDismissed, setStorageBannerDismissed] = useState(
    () => window.localStorage.getItem(helpStorageBannerDismissedStorageKey) === "1"
  );

  function dismissStorageBanner() {
    window.localStorage.setItem(helpStorageBannerDismissedStorageKey, "1");
    setStorageBannerDismissed(true);
  }

  return (
    <section className="help-page">
      {usbOnlyMode && !storageBannerDismissed && (
        <div className="help-storage-banner" role="note">
          <span>
            <strong>Note:</strong> All files are stored in your local browser and are <strong>NOT</strong> saved to any servers.
            Switching browsers or clearing your browser cache will remove your library.
          </span>
          <button type="button" onClick={dismissStorageBanner} title="Dismiss note" aria-label="Dismiss storage note">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="help-hero">
        <div>
          <p className="eyebrow">Getting Started</p>
          <h2>
            Sending files to your Cross<span className="serif">I</span>nk reader
          </h2>
        </div>
      </div>

      <div className="help-grid">
        <article className="help-card">
          <span className="help-step">1</span>
          <div>
            <h3>Connect Your Device</h3>

            <ul>
              {!usbOnlyMode && (
                <li>
                  For Wi-Fi, use the device host shown by CrossInk, usually <code>crosspoint.local</code> or an IP
                  address.
                </li>
              )}
              {!usbOnlyMode && isSelfHostedBrowser && (
                <li>
                  For local <code>192.168.x.x</code> addresses, you can enter just the last two octets, such as{" "}
                  <code>0.41</code>.
                </li>
              )}
              {!usbOnlyMode && <li>For USB, connect the reader by cable and select USB as the transfer method.</li>}
              {usbOnlyMode && <li>Connect your device to the USB cable and make sure to stay on the Home screen</li>}
              <li>
                Keep the destination folder as <code>/</code> or enter a folder such as <code>/Books</code>. Inky
                creates missing folders before upload.
              </li>
              <li>Select X3 or X4 before sending EPUBs so the optimizer uses the right screen target.</li>
              <li>Use Test Connection to confirm the app can reach the reader.</li>
            </ul>
          </div>
        </article>

        <article className="help-card">
          <span className="help-step">2</span>
          <div>
            <h3>{standaloneMode || usbOnlyMode ? "Add Local Files" : "Add Sources"}</h3>
            {standaloneMode || usbOnlyMode ? (
              <>
                <ul>
                  <li>
                    Use the add button in Local Library to pick{" "}
                    {isHostedApp ? "EPUB files" : "EPUB, TXT, XTC, XTCH, BMP, or PNG files"}.
                  </li>
                  <li>
                    Files are only stored in your local browser's storage and remain until you remove them or clear your
                    browser's cache.
                  </li>
                </ul>
              </>
            ) : (
              <>
                <p>Sources are places Inky can browse for books, files, or articles.</p>
                <ul>
                  {!usbOnlyMode && (
                    <>
                      <li>OPDS catalogs expose book catalogs such as Standard Ebooks or Project Gutenberg.</li>
                      <li>
                        WebDAV sources expose cloud folders from services such as Koofr, Nextcloud, or compatible
                        storage.
                      </li>
                      <li>RSS and Atom feeds expose articles that Inky can convert into simple EPUB files.</li>
                    </>
                  )}
                  {isDesktopApp && <li>Local Folder sources allow adding folders from your computer.</li>}
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
            <ul>
              <li>
                {standaloneMode
                  ? "Use Search to filter local files."
                  : "Use Search when a source supports it or to filter the current results."}
              </li>
              <li>You can sort the results for easier navigation.</li>
              {!standaloneMode && (
                <li>Folder rows open when clicked; book, article, and file rows show save/send actions.</li>
              )}
            </ul>
          </div>
        </article>

        <article className="help-card">
          <span className="help-step">4</span>
          <div>
            <h3>Send Files</h3>
            <ul>
              {!standaloneMode && !isPublicReadOnly && (
                <li>EPUBs are optimized for the selected X3 or X4 device before upload.</li>
              )}
              {!standaloneMode && isPublicReadOnly && (
                <li>EPUBs are temporarily optimized on the server, then sent from your browser.</li>
              )}
              {standaloneMode && <li>EPUBs are optimized locally in the browser before sending.</li>}
              {!isPublicReadOnly && (
                <li>RSS and Atom articles are first converted to EPUB, then optimized and sent.</li>
              )}
              {!isHostedApp && <li>TXT, XTC, XTCH, BMP, and PNG files skip optimization and upload directly.</li>}
              <li>The Device card shows the latest job log after send work starts.</li>
            </ul>
          </div>
        </article>
      </div>

      <section className="help-section">
        <div className="help-section-header">
          <p className="eyebrow">Manual Transfer</p>
          <h3>For Devices Without USB Transfer</h3>
        </div>
        <article className="help-card help-card-wide">
          <div>
            <p>
              If your reader is locked from USB transfers, you can still use Inky to prepare EPUBs and move them by SD
              card.
            </p>
            <ul>
              <li>Add or drop EPUB files into Local Library.</li>
              <li>Use the optimize button to prepare the EPUB for the selected X3 or X4 screen.</li>
              <li>Choose Download Optimized EPUB, then copy that file onto the reader's SD card manually.</li>
            </ul>
          </div>
        </article>
      </section>

      {(!standaloneMode || isHostedApp) && (
        <section className="help-section">
          <div className="help-section-header">
            <p className="eyebrow">CrossInk Specific</p>
            <h3>What Inky Adds To EPUBs</h3>
          </div>
          <article className="help-card help-card-wide">
            <div>
              <p>Optimized EPUBs include extra data and cleanup that CrossInk can use while reading.</p>
              <ul>
                <li>
                  Page locations let CrossInk jump and resume using stable content-based positions instead of fragile
                  screen pages.
                </li>
                <li>
                  Reference pages give a consistent stable page number that stays useful even when font size, margins,
                  or orientation change.
                </li>
                <li>TOC, cover, image, and metadata cleanup help books open cleaner and use less device memory.</li>
                <li>
                  Images are prepared for the selected X3 or X4 screen so covers and images fit the target display
                  better.
                </li>
              </ul>
            </div>
          </article>
        </section>
      )}
    </section>
  );
}
