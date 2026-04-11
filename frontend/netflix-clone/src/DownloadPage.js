import React, { useState, useEffect, useRef } from "react";
import "./DownloadPage.css";

function formatFileSize(size) {
    if (!size) return null;
    // Eğer zaten string formatında geldiyse (örn: "370.5MiB") direkt döndür
    if (typeof size === "string" && (size.includes("MiB") || size.includes("GiB") || size.includes("MB") || size.includes("GB"))) {
        return size;
    }
    // Byte olarak geldiyse formatla
    const bytes = parseInt(size, 10);
    if (isNaN(bytes)) return null;
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function DownloadPage({ path, contentTitle, onClose }) {
    const [status, setStatus] = useState("preparing"); // preparing, downloading, completed, error
    const [progress, setProgress] = useState(0);
    const [speed, setSpeed] = useState(null);
    const [eta, setEta] = useState(null);
    const [error, setError] = useState(null);
    const [fileSize, setFileSize] = useState(null);
    const eventSourceRef = useRef(null);
    const downloadTriggered = useRef(false);

    useEffect(() => {
        const backendUrl = process.env.REACT_APP_BACKEND_URL || "";
        const eventSource = new EventSource(`${backendUrl}/api/download-progress${path}`);
        eventSourceRef.current = eventSource;

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.status === "preparing") {
                    setStatus("preparing");
                } else if (data.status === "downloading") {
                    setStatus("downloading");
                    if (data.progress !== undefined) setProgress(data.progress);
                    if (data.speed) setSpeed(data.speed);
                    if (data.eta) setEta(data.eta);
                    if (data.fileSize) setFileSize(data.fileSize);
                } else if (data.status === "completed") {
                    setStatus("completed");
                    setProgress(100);
                    if (data.fileSize) setFileSize(data.fileSize);
                    // Trigger actual download
                    if (!downloadTriggered.current) {
                        downloadTriggered.current = true;
                        window.location.href = `${backendUrl}/api/download-file${path}`;
                    }
                } else if (data.status === "error") {
                    setStatus("error");
                    setError(data.message || "Indirme hatasi olustu");
                }
            } catch (e) {
                console.error("SSE parse error:", e);
            }
        };

        eventSource.onerror = () => {
            eventSource.close();
        };

        return () => {
            eventSource.close();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [path]);

    function handleCancel() {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }
        onClose();
    }

    function handleRetry() {
        setStatus("preparing");
        setProgress(0);
        setError(null);
        downloadTriggered.current = false;

        const backendUrl = process.env.REACT_APP_BACKEND_URL || "";
        const eventSource = new EventSource(`${backendUrl}/api/download-progress${path}`);
        eventSourceRef.current = eventSource;

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.status === "preparing") {
                    setStatus("preparing");
                } else if (data.status === "downloading") {
                    setStatus("downloading");
                    if (data.progress !== undefined) setProgress(data.progress);
                    if (data.speed) setSpeed(data.speed);
                    if (data.eta) setEta(data.eta);
                    if (data.fileSize) setFileSize(data.fileSize);
                } else if (data.status === "completed") {
                    setStatus("completed");
                    setProgress(100);
                    if (data.fileSize) setFileSize(data.fileSize);
                    if (!downloadTriggered.current) {
                        downloadTriggered.current = true;
                        window.location.href = `${backendUrl}/api/download-file${path}`;
                    }
                } else if (data.status === "error") {
                    setStatus("error");
                    setError(data.message || "Indirme hatasi olustu");
                }
            } catch (e) {
                console.error("SSE parse error:", e);
            }
        };

        eventSource.onerror = () => {
            eventSource.close();
        };
    }

    const title = contentTitle || path.replace(/^\//, "").replace(/-/g, " ");

    return (
        <div className="download-overlay" onClick={handleCancel}>
            <div className="download-modal" onClick={(e) => e.stopPropagation()}>
                <button className="download-close" onClick={handleCancel} aria-label="Kapat">
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square">
                        <line x1="2" y1="2" x2="16" y2="16"/>
                        <line x1="16" y1="2" x2="2" y2="16"/>
                    </svg>
                </button>

                <div className="download-icon-wrap">
                    {status === "preparing" && (
                        <div className="download-icon download-icon--preparing">
                            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                                <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" strokeDasharray="30 100" className="download-spinner"/>
                            </svg>
                        </div>
                    )}
                    {status === "downloading" && (
                        <div className="download-icon download-icon--downloading">
                            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square">
                                <line x1="24" y1="8" x2="24" y2="32" className="download-arrow"/>
                                <polyline points="14,24 24,34 34,24" className="download-arrow"/>
                                <line x1="8" y1="40" x2="40" y2="40"/>
                            </svg>
                        </div>
                    )}
                    {status === "completed" && (
                        <div className="download-icon download-icon--completed">
                            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="square">
                                <polyline points="12,26 20,34 36,14"/>
                            </svg>
                        </div>
                    )}
                    {status === "error" && (
                        <div className="download-icon download-icon--error">
                            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="square">
                                <line x1="14" y1="14" x2="34" y2="34"/>
                                <line x1="34" y1="14" x2="14" y2="34"/>
                            </svg>
                        </div>
                    )}
                </div>

                <h2 className="download-title">{title}</h2>

                <div className="download-status">
                    {status === "preparing" && "Sunucuda hazirlaniyor..."}
                    {status === "downloading" && "Sunucuya indiriliyor..."}
                    {status === "completed" && "Hazir! Indirme basliyor..."}
                    {status === "error" && "Hata olustu"}
                </div>

                {(status === "downloading" || status === "completed") && (
                    <div className="download-progress-wrap">
                        <div className="download-progress-bar">
                            <div
                                className="download-progress-fill"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                        <div className="download-progress-text">{Math.round(progress)}%</div>
                    </div>
                )}

                <div className="download-info">
                    {speed && !speed.includes("N/A") && !speed.includes("NA") && <span className="download-speed">{speed}</span>}
                    {eta && !eta.includes("N/A") && !eta.includes("NA") && eta !== "Unknown" && <span className="download-eta">Kalan: {eta}</span>}
                    {fileSize && !String(fileSize).includes("N/A") && !String(fileSize).includes("NA") && (
                        <span className="download-size">{formatFileSize(fileSize)}</span>
                    )}
                </div>

                {status === "error" && (
                    <div className="download-error">{error}</div>
                )}

                <div className="download-actions">
                    {status === "error" ? (
                        <>
                            <button className="download-btn download-btn--retry" onClick={handleRetry}>
                                Tekrar Dene
                            </button>
                            <button className="download-btn download-btn--cancel" onClick={handleCancel}>
                                Kapat
                            </button>
                        </>
                    ) : status === "completed" ? (
                        <button className="download-btn download-btn--done" onClick={onClose}>
                            Tamam
                        </button>
                    ) : (
                        <button className="download-btn download-btn--cancel" onClick={handleCancel}>
                            Iptal
                        </button>
                    )}
                </div>

                {status === "preparing" && (
                    <p className="download-hint">
                        Video sunucuda hazirlanıyor...
                    </p>
                )}
                {status === "downloading" && (
                    <p className="download-hint">
                        Video sunucuya indiriliyor, tamamlaninca size aktarilacak.
                    </p>
                )}
            </div>
        </div>
    );
}

export default DownloadPage;
