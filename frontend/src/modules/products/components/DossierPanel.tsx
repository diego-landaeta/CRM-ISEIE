import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useDossiers } from '../hooks/useDossiers';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { Progress } from '@/shared/components/ui/progress';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/shared/components/ui/accordion';
import { UploadSimple, FileText, DownloadSimple, WarningCircle, Eye, EyeSlash } from '@phosphor-icons/react';
import { getDossierUrl } from '../api/dossiers.api';

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function DossierPanel({ productId, projectId }) {
  const {
    history, activeDossier, loading, uploading, uploadProgress, error,
    upload, download,
  } = useDossiers(productId, projectId);

  const [pendingFile, setPendingFile] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  // CRM-149: preview inline del PDF activo (presigned URL en iframe).
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  async function togglePreview() {
    if (previewUrl) {
      setPreviewUrl(null);
      return;
    }
    if (!activeDossier) return;
    setPreviewLoading(true);
    try {
      const { url } = await getDossierUrl(activeDossier.id, projectId);
      setPreviewUrl(url);
    } catch {
      setUploadError('No se pudo generar la previsualizacion');
    } finally {
      setPreviewLoading(false);
    }
  }

  const onDrop = useCallback((acceptedFiles, rejectedFiles) => {
    setUploadError(null);
    if (rejectedFiles.length > 0) {
      setUploadError('Solo se permiten archivos PDF');
      return;
    }
    if (acceptedFiles.length > 0) {
      setPendingFile(acceptedFiles[0]);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    disabled: uploading,
  });

  async function handleUpload() {
    if (!pendingFile) return;
    setUploadError(null);
    try {
      await upload(pendingFile);
      setPendingFile(null);
    } catch {
      setUploadError('Error al subir el archivo');
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Dossier PDF</h3>

      {activeDossier && (
        <div className="rounded-lg border overflow-hidden">
          <div className="flex items-center gap-3 p-4">
            <FileText className="h-8 w-8 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{activeDossier.filename_original}</p>
              <p className="text-sm text-muted-foreground">
                v{activeDossier.version} &middot; {formatBytes(activeDossier.size_bytes)} &middot;
                Subido por {activeDossier.subido_por_nombre} el {formatDate(activeDossier.created_at)}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={togglePreview} disabled={previewLoading}>
              {previewUrl
                ? <><EyeSlash className="mr-1 h-4 w-4" /> Ocultar</>
                : <><Eye className="mr-1 h-4 w-4" /> {previewLoading ? 'Cargando…' : 'Ver'}</>
              }
            </Button>
            <Button variant="outline" size="sm" onClick={() => download(activeDossier.id)}>
              <DownloadSimple className="mr-1 h-4 w-4" /> Descargar
            </Button>
          </div>
          {previewUrl && (
            <iframe
              src={previewUrl}
              title={`Preview ${activeDossier.filename_original}`}
              className="w-full h-[60vh] border-t bg-muted/40"
            />
          )}
        </div>
      )}

      <div
        {...getRootProps()}
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
          isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'
        } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <input {...getInputProps()} />
        <UploadSimple className="h-10 w-10 text-muted-foreground mb-3" />
        {isDragActive ? (
          <p className="text-primary font-medium">Suelta el PDF aqui</p>
        ) : (
          <>
            <p className="font-medium">Arrastra un archivo PDF o haz clic para seleccionar</p>
            <p className="text-sm text-muted-foreground mt-1">Solo PDF, maximo 20 MB</p>
          </>
        )}
      </div>

      {pendingFile && !uploading && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <span className="flex-1 truncate text-sm">{pendingFile.name}</span>
          <Button size="sm" onClick={handleUpload}>Subir</Button>
          <Button size="sm" variant="ghost" onClick={() => setPendingFile(null)}>Cancelar</Button>
        </div>
      )}

      {uploading && (
        <div className="space-y-2">
          <Progress value={uploadProgress} />
          <p className="text-sm text-muted-foreground text-center">Subiendo... {uploadProgress}%</p>
        </div>
      )}

      {(error || uploadError) && (
        <div className="flex items-center gap-2 text-destructive text-sm">
          <WarningCircle className="h-4 w-4" />
          <span>{error || uploadError}</span>
        </div>
      )}

      {history.length > 1 && (
        <Accordion type="single" collapsible>
          <AccordionItem value="history">
            <AccordionTrigger>Historial de versiones ({history.length})</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-2">
                {history.map((dossier) => (
                  <div key={dossier.id} className="flex items-center gap-3 rounded border p-3">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">
                        {dossier.filename_original}
                        {dossier.active && <Badge className="ml-2" variant="default">Activa</Badge>}
                        {!dossier.active && <Badge className="ml-2" variant="secondary">Inactiva</Badge>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        v{dossier.version} &middot; {formatBytes(dossier.size_bytes)} &middot;
                        {dossier.subido_por_nombre} &middot; {formatDate(dossier.created_at)}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => download(dossier.id)}>
                      <DownloadSimple className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {loading && <p className="text-sm text-muted-foreground">Cargando historial...</p>}
    </div>
  );
}
