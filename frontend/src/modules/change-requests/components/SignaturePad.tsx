import { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { Trash } from '@phosphor-icons/react';

// Canvas para firma digital. Devuelve la imagen como data URL (PNG base64)
// al padre vía onChange cuando se suelta el lápiz.
//
// IMPORTANTE: el canvas tiene su propia resolución interna (width/height) y
// un tamaño visual (CSS). Si NO coinciden, los píxeles del clientX/Y vienen
// en escala visual pero al pintar en el canvas son tratados como pixels
// internos → el trazo aparece desplazado / partido a la derecha. La fix:
// reajustar width/height del canvas al tamaño real visible (con devicePixelRatio).

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

  // Resync canvas internal resolution to its visual size whenever the layout
  // changes (mount, resize, sidebar collapse, etc.). Without this, drawing
  // lands in the wrong place.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function fit() {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      // Save current content before resize (resize wipes the canvas).
      const prev = empty ? null : canvas.toDataURL('image/png');
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (prev) {
        const img = new Image();
        img.onload = () => ctx?.drawImage(img, 0, 0, w, h);
        img.src = prev;
      }
    }
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cargar firma existente al cambiar value.
  useEffect(() => {
    if (!value || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.drawImage(img, 0, 0, rect.width, rect.height);
      setEmpty(false);
    };
    img.src = value;
  }, [value]);

  function getPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    // Coordenadas en píxeles CSS (porque el contexto ya está escalado por DPR).
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
    if (canvasRef.current && onChange) {
      onChange(canvasRef.current.toDataURL('image/png'));
    }
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    setEmpty(true);
    onChange?.(null);
  }

  return (
    <div className="relative w-full">
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
        className={`w-full block border-2 border-dashed rounded-md bg-white touch-none ${readOnly ? 'border-border cursor-default' : empty ? 'border-zinc-300 cursor-crosshair' : 'border-emerald-400 cursor-crosshair'}`}
        style={{ height, width: '100%' }}
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
