"use client";

import * as React from "react";

import { cn } from "@si/ui/lib/utils";

export type CropArea = { x: number; y: number; width: number; height: number };

export interface ImageCropperProps extends Omit<React.ComponentProps<"div">, "onChange"> {
  src: string;
  aspect?: number;
  initialZoom?: number;
  minZoom?: number;
  maxZoom?: number;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  onCropComplete?: (area: CropArea) => void;
}

type Size = { w: number; h: number };
type Point = { x: number; y: number };

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

// Cover-fit base scale: at zoom = 1 the image's smaller dimension matches the
// window's larger dimension, i.e. the image fully covers the window.
function coverScale(src: Size, win: Size): number {
  return Math.max(win.w / src.w, win.h / src.h);
}

// Clamp the pan offset so the image fully covers the window. Pan is the offset
// of the image's top-left in window-pixel space; valid range is
// [win - imgDisplayed, 0] on each axis. If the image is smaller than the
// window on an axis (shouldn't happen at cover-fit but guard anyway), centre.
function clampPan(pan: Point, imgDisplayed: Size, win: Size): Point {
  const minX = win.w - imgDisplayed.w;
  const minY = win.h - imgDisplayed.h;
  const x = imgDisplayed.w <= win.w ? (win.w - imgDisplayed.w) / 2 : clamp(pan.x, minX, 0);
  const y = imgDisplayed.h <= win.h ? (win.h - imgDisplayed.h) / 2 : clamp(pan.y, minY, 0);
  return { x, y };
}

function ImageCropper({
  src,
  aspect: _aspect,
  initialZoom = 1,
  minZoom = 1,
  maxZoom = 4,
  zoom: zoomProp,
  onZoomChange,
  onCropComplete,
  className,
  style,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onWheel,
  ...rest
}: ImageCropperProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [srcSize, setSrcSize] = React.useState<Size | null>(null);
  const [winSize, setWinSize] = React.useState<Size | null>(null);
  const [pan, setPan] = React.useState<Point>({ x: 0, y: 0 });
  const [internalZoom, setInternalZoom] = React.useState<number>(
    clamp(initialZoom, minZoom, maxZoom),
  );

  const zoom = zoomProp !== undefined ? clamp(zoomProp, minZoom, maxZoom) : internalZoom;
  const setZoom = React.useCallback(
    (next: number) => {
      const clamped = clamp(next, minZoom, maxZoom);
      if (zoomProp === undefined) setInternalZoom(clamped);
      onZoomChange?.(clamped);
    },
    [zoomProp, minZoom, maxZoom, onZoomChange],
  );

  // Track active pointers for pinch-to-zoom and single-pointer drag.
  const pointersRef = React.useRef<Map<number, Point>>(new Map());
  // Pinch baseline captured on second pointer down.
  const pinchRef = React.useRef<{ distance: number; zoom: number } | null>(null);

  // Observe container size; recompute on resize so the geometry stays correct.
  React.useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setWinSize((prev) => {
        if (prev && prev.w === rect.width && prev.h === rect.height) return prev;
        return { w: rect.width, h: rect.height };
      });
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-clamp pan whenever zoom or window size changes so the image always covers.
  React.useEffect(() => {
    if (!srcSize || !winSize) return;
    const base = coverScale(srcSize, winSize);
    const displayed: Size = { w: srcSize.w * base * zoom, h: srcSize.h * base * zoom };
    setPan((prev) => {
      const clamped = clampPan(prev, displayed, winSize);
      if (clamped.x === prev.x && clamped.y === prev.y) return prev;
      return clamped;
    });
  }, [srcSize, winSize, zoom]);

  // Emit CropArea once srcSize and winSize are known and on every committed change.
  React.useEffect(() => {
    if (!srcSize || !winSize || !onCropComplete) return;
    const base = coverScale(srcSize, winSize);
    // Inverse mapping: window's (0,0) maps to image source pixel
    // (-pan.x, -pan.y) / (base * zoom). The displayed→source factor is the
    // reciprocal of the total scale applied to the source.
    const factor = 1 / (base * zoom);
    const area: CropArea = {
      x: -pan.x * factor,
      y: -pan.y * factor,
      width: winSize.w * factor,
      height: winSize.h * factor,
    };
    onCropComplete(area);
  }, [srcSize, winSize, pan, zoom, onCropComplete]);

  const handleImgLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    setSrcSize({ w: img.naturalWidth, h: img.naturalHeight });
    setPan({ x: 0, y: 0 });
  };

  const distance = (a: Point, b: Point): number => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  };

  const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  const zoomAt = React.useCallback(
    (anchor: Point, nextZoom: number) => {
      if (!srcSize || !winSize) {
        setZoom(nextZoom);
        return;
      }
      const clamped = clamp(nextZoom, minZoom, maxZoom);
      const base = coverScale(srcSize, winSize);
      const displayedNow: Size = { w: srcSize.w * base * zoom, h: srcSize.h * base * zoom };
      const displayedNext: Size = { w: srcSize.w * base * clamped, h: srcSize.h * base * clamped };
      // Keep the source pixel under the anchor stationary on screen.
      const factorNow = 1 / (base * zoom);
      const sourceX = (anchor.x - pan.x) * factorNow;
      const sourceY = (anchor.y - pan.y) * factorNow;
      const newPan: Point = {
        x: anchor.x - sourceX * base * clamped,
        y: anchor.y - sourceY * base * clamped,
      };
      setPan(clampPan(newPan, displayedNext, winSize));
      // unused but kept for clarity that displayedNow informs the math reasoning
      void displayedNow;
      setZoom(clamped);
    },
    [srcSize, winSize, zoom, pan, minZoom, maxZoom, setZoom],
  );

  const localPoint = (clientX: number, clientY: number): Point => {
    const el = containerRef.current;
    if (!el) return { x: clientX, y: clientY };
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerDown?.(event);
    if (event.defaultPrevented) return;
    const el = containerRef.current;
    if (!el) return;
    el.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, localPoint(event.clientX, event.clientY));
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()] as [Point, Point];
      pinchRef.current = { distance: distance(a, b), zoom };
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerMove?.(event);
    if (event.defaultPrevented) return;
    const pointers = pointersRef.current;
    const prev = pointers.get(event.pointerId);
    if (!prev) return;
    const next = localPoint(event.clientX, event.clientY);
    pointers.set(event.pointerId, next);

    if (pointers.size >= 2 && pinchRef.current) {
      const [a, b] = [...pointers.values()] as [Point, Point];
      const dist = distance(a, b);
      if (pinchRef.current.distance > 0) {
        const ratio = dist / pinchRef.current.distance;
        zoomAt(midpoint(a, b), pinchRef.current.zoom * ratio);
      }
      return;
    }

    if (pointers.size === 1 && srcSize && winSize) {
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const base = coverScale(srcSize, winSize);
      const displayed: Size = { w: srcSize.w * base * zoom, h: srcSize.h * base * zoom };
      setPan((current) => clampPan({ x: current.x + dx, y: current.y + dy }, displayed, winSize));
    }
  };

  const releasePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    const el = containerRef.current;
    if (el && el.hasPointerCapture(event.pointerId)) {
      el.releasePointerCapture(event.pointerId);
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerUp?.(event);
    releasePointer(event);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerCancel?.(event);
    releasePointer(event);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    onWheel?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    const anchor = localPoint(event.clientX, event.clientY);
    // Logarithmic step keeps zoom rate consistent across input devices.
    const delta = -event.deltaY * 0.0015;
    const nextZoom = zoom * Math.exp(delta);
    zoomAt(anchor, nextZoom);
  };

  const base = srcSize && winSize ? coverScale(srcSize, winSize) : 1;
  const imgWidth = srcSize ? srcSize.w * base * zoom : 0;
  const imgHeight = srcSize ? srcSize.h * base * zoom : 0;

  return (
    <div
      ref={containerRef}
      data-slot="image-cropper"
      className={cn(
        "relative aspect-square w-full overflow-hidden rounded-lg bg-muted touch-none select-none",
        className,
      )}
      style={style}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      onWheel={handleWheel}
      {...rest}
    >
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <img
        src={src}
        onLoad={handleImgLoad}
        draggable={false}
        className="absolute top-0 left-0 max-w-none select-none"
        style={{
          width: srcSize ? `${imgWidth}px` : "100%",
          height: srcSize ? `${imgHeight}px` : "100%",
          transform: srcSize ? `translate3d(${pan.x}px, ${pan.y}px, 0)` : undefined,
          // Avoid sub-pixel shimmer while dragging.
          willChange: "transform",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

export { ImageCropper };
