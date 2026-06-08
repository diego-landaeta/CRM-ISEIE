import { useRef, useState, useEffect } from 'react';
import { Trash } from '@phosphor-icons/react';

// Canvas para firma digital. Devuelve la imagen como data URL (PNG base64)
// cuando el user llama a `getDataUrl()` desde el padre vía ref.

interface Props {
  value?: string | null;
  onChange?: (dataUrl: string | null) => void;
  height?: number;
  readOnly?: boolean;
}

export default function SignaturePad({ value, onChange, height = 160, readOnly = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [empty, setEmpty] = useState(!value);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  // Cargar firma existente (value) en el canvas al montar / cuando cambia.
  useEffect(() => {
    if (!value || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
      ctx.drawImage(img, 0, 0, canvasRef.current!.width, canvasRef.current!.height);
      setEmpty(false);
    };
    img.src = value;
  }, [value]);

  function getPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    if (readOnly) return;
    setDrawing(true);
    lastPoint.current = getPoint(e);
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing || readOnly) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const p = getPoint(e);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(lastPoint.current!.x, lastPoint.current!.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPoint.current = p;
    setEmpty(false);
  }

  function end() {
    if (!drawing) return;
    setDrawing(false);
    lastPoint.current = null;
    // Notificar al padre con la data URL al soltar el lápiz.
    if (canvasRef.current && onChange) {
      onChange(canvasRef.current.toDataURL('image/png'));
    }
  }

  function clear() {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !canvasRef.current) return;
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setEmpty(true);
    onChange?.(null);
  }

  return (
    <div className="relative inline-block w-full">
      <canvas
        ref={canvasRef}
        width={600}
        height={height}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
        className={`w-full border-2 border-dashed rounded-md bg-white touch-none ${readOnly ? 'border-border cursor-default' : empty ? 'border-zinc-300 cursor-crosshair' : 'border-emerald-400 cursor-crosshair'}`}
        style={{ height }}
      />
      {empty && !readOnly && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-xs text-zinc-400">
          Firma aquí con el ratón o el dedo
        </div>
      )}
      {!empty && !readOnly && (
        <button
          type="button"
          onClick={clear}
          className="absolute top-2 right-2 px-2 py-1 text-[11px] rounded-md bg-white border border-border hover:bg-muted shadow-sm flex items-center gap-1"
        >
          <Trash size={11} /> Borrar
        </button>
      )}
    </div>
  );
}
