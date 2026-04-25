import { useRef, useState } from "react"
import { IconCamera, IconTrash } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { pickVariantUrl, uploadImage } from "../lib/media"

export function BannerUpload({
  currentUrl,
  onChange,
}: {
  currentUrl: string | null
  onChange: (nextUrl: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setError(null)
    setUploading(true)
    try {
      const media = await uploadImage(file)
      const url = pickVariantUrl(media, "large")
      if (!url) throw new Error("no variant returned")
      onChange(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">Banner</span>
        <div className="flex items-center gap-3 text-xs">
          {uploading && (
            <span className="text-muted-foreground">uploading…</span>
          )}
          {error && <span className="text-destructive">{error}</span>}
          {currentUrl && !uploading && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange(null)}
              className="text-destructive hover:underline"
            >
              <IconTrash className="size-4" /> Remove
            </Button>
          )}
        </div>
      </div>
      <Button
        variant="default"
        size="icon"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="group relative block h-36 w-full overflow-hidden rounded-md border border-border bg-muted"
        aria-label="upload banner"
      >
        {currentUrl ? (
          <img src={currentUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            click to upload a banner image (wide is better)
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-background/0 opacity-0 transition group-hover:bg-background/30 group-hover:opacity-100">
          <IconCamera className="size-4" />
        </div>
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
        hidden
        onChange={onFile}
      />
    </div>
  )
}
