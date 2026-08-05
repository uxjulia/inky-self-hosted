import { BookOpen, ChevronDown, Download, RefreshCw, Type } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type DownloadPackage = {
  filename: string;
  size: number;
  description?: string;
};

type DownloadSectionProps = {
  title: string;
  description: string;
  endpoint: string;
  responseKey: "fonts" | "dictionaries";
  sourceUrl: string;
  defaultOpen?: boolean;
};

type FontDownloadsPanelProps = {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
};

function messageFromUnknown(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formatSize(size: number) {
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function DownloadSection({ title, description, endpoint, responseKey, sourceUrl, defaultOpen = false, apiFetch }: DownloadSectionProps & FontDownloadsPanelProps) {
  const [packages, setPackages] = useState<DownloadPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadPackages = useCallback(async (isRefresh = false) => {
    setError("");
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await apiFetch(endpoint);
      const data = await response.json() as Record<string, unknown>;
      const values = data[responseKey];
      setPackages(Array.isArray(values) ? values as DownloadPackage[] : []);
    } catch (error) {
      setError(messageFromUnknown(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiFetch, endpoint, responseKey]);

  useEffect(() => {
    void loadPackages();
  }, [loadPackages]);

  async function downloadPackage(item: DownloadPackage) {
    if (downloading) return;
    setDownloading(item.filename);
    setError("");
    try {
      const response = await apiFetch(`${endpoint}/${encodeURIComponent(item.filename)}`);
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = item.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setError(messageFromUnknown(error));
    } finally {
      setDownloading(null);
    }
  }

  return (
    <details className="panel downloads-section" open={defaultOpen}>
      <summary className="downloads-section-summary">
        <div className="downloads-section-title">
          <ChevronDown className="downloads-section-chevron" size={22} aria-hidden="true" />
          <div>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
        </div>
        <span>{loading ? "Loading…" : `${packages.length} packages`}</span>
      </summary>
      <div className="downloads-section-body">
        <div className="downloads-section-toolbar">
          <a href={sourceUrl} target="_blank" rel="noreferrer">View collection</a>
          <button className="icon-text" type="button" onClick={() => void loadPackages(true)} disabled={loading || refreshing}>
            <RefreshCw className={refreshing ? "spin" : ""} size={15} />
            Refresh
          </button>
        </div>
        {error && <div className="flash-message error">{error}</div>}
        {!loading && !error && (
          <div className="downloads-package-grid">
            {packages.map((item) => (
              <article className="downloads-package-card" key={item.filename}>
                <div>
                  <strong>{item.filename.replace(/\.zip$/, "")}</strong>
                  <span>{formatSize(item.size)} ZIP</span>
                  {item.description && (
                    <p className="downloads-package-description">{item.description}</p>
                  )}
                </div>
                <button className="primary icon-text" type="button" disabled={Boolean(downloading)} onClick={() => void downloadPackage(item)}>
                  <Download size={15} />
                  {downloading === item.filename ? "Downloading…" : "Download"}
                </button>
              </article>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

export function FontDownloadsPanel({ apiFetch }: FontDownloadsPanelProps) {
  return (
    <section className="downloads-page" role="tabpanel" id="downloads-panel" aria-labelledby="downloads-tab">
      <div className="downloads-content">
        <div className="panel downloads-intro">
          <div className="heading-line">
            <Download size={16} />
            <h2>Downloads</h2>
          </div>
          <p>Get font families and ready-made dictionaries for your Cross<span className="serif">I</span>nk device.</p>
        </div>

        <div className="downloads-category-heading">
          <Type size={16} />
          <h2>Fonts</h2>
        </div>
        <DownloadSection
          title="Reader Fonts"
          description="Standard SD-card font packages for reading books."
          endpoint="/api/fonts/crossink"
          responseKey="fonts"
          sourceUrl="https://github.com/uxjulia/crossink-fonts/tree/main/cpfonts"
          apiFetch={apiFetch}
        />
        <DownloadSection
          title="Dictionary Fonts"
          description="Font packages with IPA and other characters used in dictionary definitions."
          endpoint="/api/fonts/dictionary"
          responseKey="fonts"
          sourceUrl="https://github.com/uxjulia/crossink-fonts/tree/main/dictionary-fonts"
          apiFetch={apiFetch}
        />

        <div className="downloads-category-heading">
          <BookOpen size={16} />
          <h2>Dictionaries</h2>
        </div>
        <DownloadSection
          title="Prepared English Dictionaries"
          description="Dictionaries to get you started. Download, unzip, and copy it to the .dictionaries folder on your SD card."
          endpoint="/api/dictionaries/catalog"
          responseKey="dictionaries"
          sourceUrl="https://github.com/uxjulia/crossink-dictionaries/tree/main/English"
          apiFetch={apiFetch}
        />
      </div>
    </section>
  );
}
