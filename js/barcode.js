/* Gstock - barcode.js (scanner intégré + debug overlay) */
(() => {
  'use strict';

  let stream = null;
  let detector = null;
  let scanning = false;
  let torchEnabled = false;
  let debugOverlay = null;

  // Debug overlay
  function createDebugOverlay(video) {
    if (!window.GSTOCK_DEBUG) return null;
    
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      z-index: 10;
      font-family: monospace;
      font-size: 12px;
      color: #00ff00;
      background: rgba(0,0,0,0.1);
    `;
    
    const info = document.createElement('div');
    info.style.cssText = `
      position: absolute;
      top: 10px; left: 10px;
      background: rgba(0,0,0,0.7);
      padding: 5px;
      border-radius: 3px;
    `;
    overlay.appendChild(info);
    
    const roi = document.createElement('div');
    roi.style.cssText = `
      position: absolute;
      border: 2px solid #00ff00;
      background: rgba(0,255,0,0.1);
    `;
    overlay.appendChild(roi);
    
    video.parentElement.style.position = 'relative';
    video.parentElement.appendChild(overlay);
    
    return { overlay, info, roi };
  }

  function updateDebugOverlay(debug, fps, lastCode, videoRect) {
    if (!debug || !window.GSTOCK_DEBUG) return;
    
    debug.info.innerHTML = `
      FPS: ${fps}<br>
      Dernier: ${lastCode || 'aucun'}<br>
      Résolution: ${videoRect.width}x${videoRect.height}
    `;
    
    // ROI au centre (50% de la largeur/hauteur)
    const roiW = videoRect.width * 0.5;
    const roiH = videoRect.height * 0.5;
    const roiX = (videoRect.width - roiW) / 2;
    const roiY = (videoRect.height - roiH) / 2;
    
    debug.roi.style.left = roiX + 'px';
    debug.roi.style.top = roiY + 'px';
    debug.roi.style.width = roiW + 'px';
    debug.roi.style.height = roiH + 'px';
  }

  // Scanner principal
  async function startScan(video, options = {}) {
    if (scanning) throw new Error('Scan déjà en cours');
    
    try {
      // Vérifier support BarcodeDetector
      if (!('BarcodeDetector' in window)) {
        throw new Error('BarcodeDetector non supporté sur ce navigateur');
      }
      
      detector = new BarcodeDetector({
        formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code']
      });
      
      // Demander accès caméra
      const constraints = {
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };
      
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (e) {
        // Fallback sans contraintes spécifiques
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      
      video.srcObject = stream;
      await video.play();
      
      scanning = true;
      debugOverlay = createDebugOverlay(video);
      
      return true;
    } catch (error) {
      console.error('Erreur démarrage scan:', error);
      throw error;
    }
  }

  async function stopScan() {
    scanning = false;
    
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
    
    if (debugOverlay) {
      debugOverlay.overlay.remove();
      debugOverlay = null;
    }
    
    detector = null;
    torchEnabled = false;
  }

  async function scanFrame(video) {
    if (!scanning || !detector || !video.videoWidth) return null;
    
    try {
      const barcodes = await detector.detect(video);
      return barcodes.length > 0 ? barcodes[0].rawValue : null;
    } catch (error) {
      console.warn('Erreur détection:', error);
      return null;
    }
  }

  // Scanner jusqu'à code connu
  async function scanUntilKnown(video, options = {}) {
    const { confirmFrames = 3, maxAttempts = 1000 } = options;
    
    await startScan(video, options);
    
    let attempts = 0;
    let lastCode = null;
    let confirmCount = 0;
    let fps = 0;
    let lastTime = Date.now();
    let frameCount = 0;
    
    return new Promise((resolve, reject) => {
      const scanLoop = async () => {
        if (!scanning) {
          resolve(null);
          return;
        }
        
        if (attempts++ > maxAttempts) {
          reject(new Error('Trop de tentatives'));
          return;
        }
        
        try {
          const code = await scanFrame(video);
          
          // Calcul FPS
          frameCount++;
          const now = Date.now();
          if (now - lastTime >= 1000) {
            fps = Math.round(frameCount * 1000 / (now - lastTime));
            frameCount = 0;
            lastTime = now;
          }
          
          // Mise à jour debug
          if (debugOverlay) {
            const rect = video.getBoundingClientRect();
            updateDebugOverlay(debugOverlay, fps, code || lastCode, {
              width: video.videoWidth,
              height: video.videoHeight
            });
          }
          
          if (code) {
            if (code === lastCode) {
              confirmCount++;
              if (confirmCount >= confirmFrames) {
                // Vérifier si le code existe en base
                const item = await window.dbGet(code);
                if (item) {
                  resolve(code);
                  return;
                } else {
                  // Code inconnu, émettre événement et continuer
                  window.dispatchEvent(new CustomEvent('gstock:scan-unknown', {
                    detail: { code }
                  }));
                  lastCode = null;
                  confirmCount = 0;
                }
              }
            } else {
              lastCode = code;
              confirmCount = 1;
            }
          }
          
          requestAnimationFrame(scanLoop);
        } catch (error) {
          reject(error);
        }
      };
      
      scanLoop();
    });
  }

  // Contrôle torche
  async function toggleTorch() {
    if (!stream) return false;
    
    try {
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities();
      
      if (capabilities.torch) {
        torchEnabled = !torchEnabled;
        await track.applyConstraints({
          advanced: [{ torch: torchEnabled }]
        });
        return torchEnabled;
      }
    } catch (error) {
      console.warn('Torche non supportée:', error);
    }
    
    return false;
  }

  // Gestion du debug toggle
  window.addEventListener('gstock:debug-changed', (event) => {
    if (!event.detail.enabled && debugOverlay) {
      debugOverlay.overlay.remove();
      debugOverlay = null;
    }
  });

  // Export global
  window.startScan = startScan;
  window.stopScan = stopScan;
  window.scanFrame = scanFrame;
  window.scanUntilKnown = scanUntilKnown;
  window.toggleTorch = toggleTorch;

})();