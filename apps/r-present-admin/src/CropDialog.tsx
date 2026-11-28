import { useEffect, useRef, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import type { Crop, Rotation } from './api'

type Props = {
  /** Image to crop: an object URL for a picked file, or an uploaded photo's URL. */
  src: string
  /** width / height of the crop box. */
  aspect: number
  title: string
  /** e.g. "2 more to crop" when several photos were picked at once. */
  note?: string
  onConfirm: (crop: Crop) => void
  /** Cancel button and Escape. */
  onCancel: () => void
}

/**
 * Drag and zoom a photo inside a fixed-shape box. Reports the box as
 * percentages of the photo; the backend does the actual cropping.
 * Give it a `key` per photo so each one starts centered and zoomed out.
 */
export function CropDialog({
  src,
  aspect,
  title,
  note,
  onConfirm,
  onCancel,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState<Rotation>(0)
  const [area, setArea] = useState<Area | null>(null)

  const turn = (degrees: 90 | -90) => {
    setRotation((r) => (((r + degrees + 360) % 360) as Rotation))
    setPosition({ x: 0, y: 0 })
  }

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="crop-dialog"
      aria-labelledby="crop-dialog-title"
      // Escape closes a <dialog>; treat it like Cancel.
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
    >
      <header className="crop-header">
        <h2 id="crop-dialog-title">{title}</h2>
        {note && <span className="muted small">{note}</span>}
      </header>
      <p className="muted small crop-help">
        Drag to move the photo, pinch or use the slider to zoom, and turn it if it's sideways.
      </p>

      <div className="crop-controls">
        <div className="crop-rotate">
          <button type="button" aria-label="Turn left" title="Turn left" onClick={() => turn(-90)}>
            ↺
          </button>
          <button type="button" aria-label="Turn right" title="Turn right" onClick={() => turn(90)}>
            ↻
          </button>
        </div>
        <label className="crop-zoom">
          <span>Zoom</span>
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="crop-area">
        <Cropper
          image={src}
          aspect={aspect}
          crop={position}
          zoom={zoom}
          rotation={rotation}
          minZoom={1}
          maxZoom={4}
          onCropChange={setPosition}
          onZoomChange={setZoom}
          onCropComplete={(percentages) => setArea(percentages)}
        />
      </div>

      <div className="crop-actions">
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={!area}
          onClick={() => area && onConfirm({ ...area, rotation })}
        >
          Save
        </button>
      </div>
    </dialog>
  )
}
