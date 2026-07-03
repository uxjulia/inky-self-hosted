import { useEffect, useState } from "react";

type AuthenticatedImageProps = {
  src: string;
  alt: string;
  apiFetch: (path: string) => Promise<Response>;
  mediaUrl: (url: string) => string;
};

export function AuthenticatedImage({ src, alt, apiFetch, mediaUrl }: AuthenticatedImageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const needsAuthenticatedFetch = src.startsWith("/api/");

  useEffect(() => {
    if (!needsAuthenticatedFetch) {
      setObjectUrl(null);
      return;
    }

    let active = true;
    let nextObjectUrl: string | null = null;

    async function loadImage() {
      try {
        const response = await apiFetch(src);
        const blob = await response.blob();
        if (!active) return;
        nextObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(nextObjectUrl);
      } catch {
        if (active) setObjectUrl(null);
      }
    }

    loadImage();

    return () => {
      active = false;
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [apiFetch, mediaUrl, needsAuthenticatedFetch, src]);

  if (needsAuthenticatedFetch && !objectUrl) return null;
  return <img src={objectUrl || mediaUrl(src)} alt={alt} loading="lazy" />;
}
