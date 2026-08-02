import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { ImageCropper, type CropArea } from "./image-cropper";

const LARGE_SRC = "https://picsum.photos/id/1015/1600/900";
const SMALL_SRC = "https://picsum.photos/id/1025/200/200";

const meta = {
  title: "UI/ImageCropper",
  component: ImageCropper,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  args: { src: LARGE_SRC },
} satisfies Meta<typeof ImageCropper>;

export default meta;
type Story = StoryObj<typeof meta>;

function CropReadout({ area }: { area: CropArea | null }) {
  if (!area) return <p className="text-xs text-muted-foreground">Waiting for image…</p>;
  return (
    <p className="font-mono text-xs text-muted-foreground">
      x={Math.round(area.x)} y={Math.round(area.y)} w={Math.round(area.width)} h=
      {Math.round(area.height)}
    </p>
  );
}

export const Square: Story = {
  render: () => {
    const [area, setArea] = React.useState<CropArea | null>(null);
    return (
      <div className="flex w-80 flex-col gap-3">
        <ImageCropper src={LARGE_SRC} onCropComplete={setArea} />
        <CropReadout area={area} />
      </div>
    );
  },
};

export const WithControlledZoom: Story = {
  render: () => {
    const [zoom, setZoom] = React.useState(1);
    const [area, setArea] = React.useState<CropArea | null>(null);
    return (
      <div className="flex w-80 flex-col gap-3">
        <ImageCropper src={LARGE_SRC} zoom={zoom} onZoomChange={setZoom} onCropComplete={setArea} />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Zoom
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="flex-1"
          />
          <span className="font-mono">{zoom.toFixed(2)}×</span>
        </label>
        <CropReadout area={area} />
      </div>
    );
  },
};

export const SmallImage: Story = {
  render: () => {
    const [area, setArea] = React.useState<CropArea | null>(null);
    return (
      <div className="flex w-80 flex-col gap-3">
        <ImageCropper src={SMALL_SRC} onCropComplete={setArea} />
        <p className="text-xs text-muted-foreground">
          Source is 200×200; the crop window scales it up to cover and pan stays bounded.
        </p>
        <CropReadout area={area} />
      </div>
    );
  },
};
