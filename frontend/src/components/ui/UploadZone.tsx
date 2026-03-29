import { useCallback, useRef, useState } from "react";
import { T } from "../../theme/tokens";
import { uploadProject } from "../../api/endpoints";
import { useAppStore } from "../../stores/useAppStore";
import { useDataStore } from "../../stores/useDataStore";

export function UploadZone() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setUploading = useAppStore((s) => s.setUploading);
  const setHasData = useAppStore((s) => s.setHasData);
  const isUploading = useAppStore((s) => s.isUploading);
  const refreshAll = useDataStore((s) => s.refreshAll);

  const doUpload = useCallback(async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      await uploadProject(file);
      await refreshAll();
      setHasData(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar ficheiro");
    } finally {
      setUploading(false);
    }
  }, [setUploading, setHasData, refreshAll]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) doUpload(file);
  }, [doUpload]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) doUpload(file);
  }, [doUpload]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: 24,
      }}
    >
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        style={{
          width: 400,
          padding: "48px 32px",
          borderRadius: T.radius,
          border: `2px dashed ${dragging ? T.blue : T.border}`,
          background: dragging ? `${T.blue}08` : T.card,
          cursor: "pointer",
          textAlign: "center",
          transition: "all 0.2s",
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".mpp,.xlsx,.xls,.xml"
          style={{ display: "none" }}
          onChange={onFileChange}
        />
        {isUploading ? (
          <>
            <div style={{ fontSize: 32, marginBottom: 16 }}>...</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: T.primary }}>A processar...</div>
            <div style={{ fontSize: 13, color: T.secondary, marginTop: 8 }}>Scheduling + Analytics</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 32, marginBottom: 16 }}>MPP</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: T.primary }}>Carregar Ficheiro de Projecto</div>
            <div style={{ fontSize: 13, color: T.secondary, marginTop: 8 }}>
              Arrasta ficheiro .mpp, .xlsx ou clica para seleccionar
            </div>
          </>
        )}
      </div>
      {error && (
        <div style={{ fontSize: 13, color: T.red, maxWidth: 400, textAlign: "center" }}>{error}</div>
      )}
    </div>
  );
}
