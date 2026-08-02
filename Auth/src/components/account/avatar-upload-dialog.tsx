import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { CameraIcon, UploadCloudIcon } from "lucide-react";
import { Alert } from "@si/ui/components/alert";
import { Avatar, AvatarFallback } from "@si/ui/components/avatar";
import { Button, buttonVariants } from "@si/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@si/ui/components/dialog";
import { ImageCropper, type CropArea } from "@si/ui/components/image-cropper";
import { Slider } from "@si/ui/components/slider";
import { toast } from "@si/ui/components/sonner";
import { cn } from "@si/ui/lib/utils";
import { cropImageToBlob } from "@si/ui/lib/crop";
import { uploadAvatar } from "@/lib/avatar.functions";

const ACCEPT = "image/jpeg,image/png,image/webp";
const MAX_BYTES = 8 * 1024 * 1024;
const OUTPUT_SIZE = 512;
const OUTPUT_TYPE = "image/jpeg" as const;
const OUTPUT_QUALITY = 0.85;

type Stage =
  | { kind: "pick" }
  | { kind: "crop"; src: string; sourceFile: File; area: CropArea | null }
  | { kind: "uploading" };

export function AvatarUploadDialog({
  trigger,
  fallbackInitial,
}: {
  trigger: React.ReactNode;
  fallbackInitial: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: "pick" });
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewSeqRef = useRef(0);

  const reset = useCallback(() => {
    setStage((prev) => {
      if (prev.kind === "crop") URL.revokeObjectURL(prev.src);
      return { kind: "pick" };
    });
    setZoom(1);
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  }, [previewUrl]);

  // Reset when the dialog closes so the next open is a clean haze.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const handleFile = useCallback((file: File) => {
    if (file.size > MAX_BYTES) {
      setError("That image is over 8 MB. Try a smaller one.");
      return;
    }
    if (file.size === 0) {
      setError("That file is empty.");
      return;
    }
    setError(null);
    const src = URL.createObjectURL(file);
    setStage({ kind: "crop", src, sourceFile: file, area: null });
    setZoom(1);
  }, []);

  const onCropComplete = useCallback(async (area: CropArea) => {
    const seq = ++previewSeqRef.current;
    setStage((prev) => (prev.kind === "crop" ? { ...prev, area } : prev));
    try {
      const blob = await cropImageToBlob(currentSrcRef.current, area, {
        outputSize: 128,
        mimeType: OUTPUT_TYPE,
        quality: OUTPUT_QUALITY,
      });
      // Drop stale preview generation when a newer crop has been requested.
      if (seq !== previewSeqRef.current) return;
      const url = URL.createObjectURL(blob);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } catch {
      // Preview failure is non-fatal; the user can still save.
    }
  }, []);

  const currentSrcRef = useRef<string>("");
  if (stage.kind === "crop") currentSrcRef.current = stage.src;

  const onSave = useCallback(async () => {
    if (stage.kind !== "crop" || !stage.area) return;
    setError(null);
    setStage({ kind: "uploading" });
    try {
      const blob = await cropImageToBlob(stage.src, stage.area, {
        outputSize: OUTPUT_SIZE,
        mimeType: OUTPUT_TYPE,
        quality: OUTPUT_QUALITY,
      });
      const buffer = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < buffer.length; i++) binary += String.fromCharCode(buffer[i]!);
      const uploaded = await uploadAvatar({
        data: { base64: btoa(binary), contentType: OUTPUT_TYPE },
      });
      if (!uploaded.ok) throw new Error(uploaded.error);
      toast.success("Avatar updated");
      setOpen(false);
      void router.invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      // Drop back into the crop stage so the user can retry without re-picking.
      setStage((prev) =>
        prev.kind === "uploading" && currentSrcRef.current
          ? {
              kind: "crop",
              src: currentSrcRef.current,
              sourceFile: lastFileRef.current!,
              area: null,
            }
          : prev,
      );
    }
  }, [router, stage]);

  const lastFileRef = useRef<File | null>(null);
  if (stage.kind === "crop") lastFileRef.current = stage.sourceFile;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger}
      <DialogContent className="max-w-md max-sm:inset-x-2 max-sm:inset-y-4 max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 sm:max-w-md md:max-w-lg">
        {stage.kind === "pick" && (
          <PickStage onPick={handleFile} fallbackInitial={fallbackInitial} error={error} />
        )}
        {stage.kind === "crop" && (
          <CropStage
            src={stage.src}
            zoom={zoom}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            previewUrl={previewUrl}
            fallbackInitial={fallbackInitial}
            onChooseAnother={() => {
              if (stage.kind === "crop") URL.revokeObjectURL(stage.src);
              setStage({ kind: "pick" });
              if (previewUrl) URL.revokeObjectURL(previewUrl);
              setPreviewUrl(null);
            }}
            onSave={onSave}
            error={error}
            saveDisabled={!stage.area}
          />
        )}
        {stage.kind === "uploading" && <UploadingStage />}
      </DialogContent>
    </Dialog>
  );
}

function PickStage({
  onPick,
  fallbackInitial,
  error,
}: {
  onPick: (file: File) => void;
  fallbackInitial: string;
  error: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Update photo</DialogTitle>
        <DialogDescription>Choose an image — we'll let you crop it.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) onPick(file);
          }}
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-sm border-2 border-dashed border-border-strong px-6 py-10 text-center transition-colors hover:bg-surface-sunken",
            dragging && "border-primary bg-surface-sunken",
          )}
        >
          <Avatar size="lg" className="size-16">
            <AvatarFallback>{fallbackInitial}</AvatarFallback>
          </Avatar>
          <UploadCloudIcon className="size-6 text-muted-foreground/80" />
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Drag an image here, or click to browse</span>
            <span className="text-xs text-muted-foreground/80">JPEG, PNG, WebP — up to 8 MB</span>
          </div>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPick(file);
            e.target.value = "";
          }}
        />
        {error && <Alert variant="destructive">{error}</Alert>}
      </div>
      <DialogFooter>
        <DialogClose className={cn(buttonVariants({ variant: "ghost" }))}>Cancel</DialogClose>
      </DialogFooter>
    </>
  );
}

function CropStage({
  src,
  zoom,
  onZoomChange,
  onCropComplete,
  previewUrl,
  fallbackInitial,
  onChooseAnother,
  onSave,
  error,
  saveDisabled,
}: {
  src: string;
  zoom: number;
  onZoomChange: (z: number) => void;
  onCropComplete: (area: CropArea) => void;
  previewUrl: string | null;
  fallbackInitial: string;
  onChooseAnother: () => void;
  onSave: () => void;
  error: string | null;
  saveDisabled: boolean;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Crop photo</DialogTitle>
        <DialogDescription>Drag to reposition, scroll or pinch to zoom.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <ImageCropper
          src={src}
          aspect={1}
          zoom={zoom}
          onZoomChange={onZoomChange}
          onCropComplete={onCropComplete}
        />
        <div className="flex items-center gap-3">
          <CameraIcon className="size-3.5 text-muted-foreground/80" />
          <Slider
            value={[zoom]}
            min={1}
            max={4}
            step={0.01}
            onValueChange={(val) => {
              const v = Array.isArray(val) ? (val[0] ?? 1) : val;
              onZoomChange(v);
            }}
            aria-label="Zoom"
          />
        </div>
        <div className="flex items-end gap-3">
          <span className="type-mono-label mr-2 self-center text-muted-foreground/80">Preview</span>
          {[
            { px: 32, label: "32" },
            { px: 64, label: "64" },
            { px: 96, label: "96" },
          ].map((p) => (
            <div key={p.px} className="flex flex-col items-center gap-1">
              <div
                className="overflow-hidden rounded-sm bg-muted"
                style={{ width: p.px, height: p.px }}
              >
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt=""
                    className="size-full object-cover"
                    width={p.px}
                    height={p.px}
                  />
                ) : (
                  <div className="flex size-full items-center justify-center text-xs text-muted-foreground/80">
                    {fallbackInitial}
                  </div>
                )}
              </div>
              <span className="type-mono-label text-xs text-muted-foreground/80">{p.label}</span>
            </div>
          ))}
        </div>
        {error && <Alert variant="destructive">{error}</Alert>}
      </div>
      <DialogFooter className="max-sm:flex-col-reverse max-sm:items-stretch">
        <Button variant="ghost" onClick={onChooseAnother}>
          Choose another
        </Button>
        <DialogClose className={cn(buttonVariants({ variant: "ghost" }))}>Cancel</DialogClose>
        <Button onClick={onSave} disabled={saveDisabled}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

function UploadingStage() {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Uploading…</DialogTitle>
        <DialogDescription>Sending your new avatar to the platform.</DialogDescription>
      </DialogHeader>
      <div className="flex items-center justify-center py-8">
        <div className="h-2 w-full overflow-hidden rounded-sm bg-surface-sunken">
          <div className="h-full w-1/3 animate-pulse bg-primary" />
        </div>
      </div>
    </>
  );
}
