/* Gstock - barcode.js (Scanner intégré optimisé) */
(() => {
  'use strict';

  let stream = null;
  let detector = null;
  let scanning = false;
  let torchEnabled = false;
  let debugOverlay = null;

  // Configuration du scanner
  const SCANNER_CONFIG = {
    formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code'],
    confirmFrames: 2, // Nombre de frames pour confirmer un code
    maxAttempts: 2000, // Tentatives max avant timeout
    debugMode: false
  };

  // Debug overlay pour développement
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
      background: rgba(0,0,0,0.8);
      padding: 8px;
      border-radius: 4px;
      color: #00ff00;
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

  function updateDebugOverlay(debug, fps, lastCode, attempts, videoRect) {
    if (!debug || !window.GSTOCK_DEBUG) return;
    
    debug.info.innerHTML = `
      FPS: ${fps}<br>
      Tentatives: ${attempts}<br>
      Dernier: ${lastCode || 'aucun'}<br>
      Résolution: ${videoRect.width}x${videoRect.height}
    `;
    
    // ROI au centre (60% de la largeur/hauteur)
    const roiW = videoRect.width * 0.6;
    const roiH = videoRect.height * 0.6;
    const roiX = (videoRect.width - roiW) / 2;
    const roiY = (videoRect.height - roiH) / 2;
    
    debug.roi.style.left = roiX + 'px';
    debug.roi.style.top = roiY + 'px';
    debug.roi.style.width = roiW + 'px';
    debug.roi.style.height = roiH + 'px';
  }

  /**
   * Nettoie et normalise un code-barres scanné
   */
  function cleanBarcodeValue(rawValue) {
    if (!rawValue) return null;
    
    // Supprimer les espaces et caractères de contrôle
    let cleaned = rawValue.replace(/[\s\r\n\t]/g, '');
    
    // Garder seulement les caractères alphanumériques et quelques symboles
    cleaned = cleaned.replace(/[^A-Za-z0-9\-_.]/g, '');
    
    return cleaned || null;
  }

  /**
   * Démarre le scanner
   */
  async function startScan(video, options = {}) {
    if (scanning) {
      throw new Error('Scanner déjà en cours');
    }
    
    try {
      // Vérifier le support BarcodeDetector
      if (!('BarcodeDetector' in window)) {
        throw new Error('BarcodeDetector non supporté. Utilisez Chrome, Edge ou Safari récent.');
      }
      
      // Créer le détecteur
      detector = new BarcodeDetector({
        formats: SCANNER_CONFIG.formats
      });
      
      // Configuration caméra optimisée
      const constraints = {
        video: {
          facingMode: 'environment', // Caméra arrière
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
          focusMode: 'continuous',
          whiteBalanceMode: 'continuous'
        }
      };
      
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (e) {
        console.warn('Contraintes avancées échouées, fallback simple:', e);
        // Fallback sans contraintes spécifiques
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'environment' } 
        });
      }
      
      video.srcObject = stream;
      await video.play();
      
      // Attendre que la vidéo soit prête
      await new Promise(resolve => {
        const checkReady = () => {
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            resolve();
          } else {
            setTimeout(checkReady, 100);
          }
        };
        checkReady();
      });
      
      scanning = true;
      debugOverlay = createDebugOverlay(video);
      
      console.log('Scanner démarré avec succès');
      return true;
      
    } catch (error) {
      console.error('Erreur démarrage scanner:', error);
      await stopScan();
      throw error;
    }
  }

  /**
   * Arrête le scanner
   */
  async function stopScan() {
    scanning = false;
    
    if (stream) {
      stream.getTracks().forEach(track => {
        track.stop();
        console.log('Track arrêté:', track.kind);
      });
      stream = null;
    }
    
    if (debugOverlay) {
      debugOverlay.overlay.remove();
      debugOverlay = null;
    }
    
    detector = null;
    torchEnabled = false;
    
    console.log('Scanner arrêté');
  }

  /**
   * Scanne une frame vidéo
   */
  async function scanFrame(video) {
    if (!scanning || !detector || !video.videoWidth || !video.videoHeight) {
      return null;
    }
    
    try {
      const barcodes = await detector.detect(video);
      
      if (barcodes.length > 0) {
        // Prendre le premier code-barres détecté
        const barcode = barcodes[0];
        const cleaned = cleanBarcodeValue(barcode.rawValue);
        
        if (cleaned && cleaned.length >= 3) {
          console.log('Code détecté:', cleaned, 'Format:', barcode.format);
          return cleaned;
        }
      }
      
      return null;
    } catch (error) {
      console.warn('Erreur détection frame:', error);
      return null;
    }
  }

  /**
   * Scanne jusqu'à trouver un code connu
   */
  async function scanUntilKnown(video, options = {}) {
    const { 
      confirmFrames = SCANNER_CONFIG.confirmFrames, 
      maxAttempts = SCANNER_CONFIG.maxAttempts,
      onUnknownCode = null
    } = options;
    
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
          reject(new Error(`Timeout après ${maxAttempts} tentatives`));
          return;
        }
        
        try {
          const code = await scanFrame(video);
          
          // Calcul FPS pour debug
          frameCount++;
          const now = Date.now();
          if (now - lastTime >= 1000) {
            fps = Math.round(frameCount * 1000 / (now - lastTime));
            frameCount = 0;
            lastTime = now;
          }
          
          // Mise à jour debug overlay
          if (debugOverlay) {
            updateDebugOverlay(debugOverlay, fps, code || lastCode, attempts, {
              width: video.videoWidth,
              height: video.videoHeight
            });
          }
          
          if (code) {
            if (code === lastCode) {
              confirmCount++;
              console.log(`Code confirmé ${confirmCount}/${confirmFrames}:`, code);
              
              if (confirmCount >= confirmFrames) {
                // Vérifier si le code existe en base
                try {
                  const item = await window.dbGet(code);
                  if (item) {
                    console.log('Code trouvé en base:', item.name);
                    resolve(code);
                    return;
                  } else {
                    console.log('Code inconnu:', code);
                    // Émettre événement pour code inconnu
                    window.dispatchEvent(new CustomEvent('gstock:scan-unknown', {
                      detail: { code }
                    }));
                    
                    // Callback optionnel
                    if (onUnknownCode) {
                      onUnknownCode(code);
                    }
                    
                    // Reset pour continuer le scan
                    lastCode = null;
                    confirmCount = 0;
                  }
                } catch (dbError) {
                  console.error('Erreur vérification base:', dbError);
                  lastCode = null;
                  confirmCount = 0;
                }
              }
            } else {
              lastCode = code;
              confirmCount = 1;
              console.log('Nouveau code détecté:', code);
            }
          }
          
          // Continuer le scan
          requestAnimationFrame(scanLoop);
          
        } catch (error) {
          console.error('Erreur dans scanLoop:', error);
          reject(error);
        }
      };
      
      // Démarrer la boucle
      scanLoop();
    });
  }

  /**
   * Contrôle de la torche
   */
  async function toggleTorch() {
    if (!stream) {
      console.warn('Pas de stream actif pour la torche');
      return false;
    }
    
    try {
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities();
      
      if (capabilities.torch) {
        torchEnabled = !torchEnabled;
        await track.applyConstraints({
          advanced: [{ torch: torchEnabled }]
        });
        console.log('Torche:', torchEnabled ? 'ON' : 'OFF');
        return torchEnabled;
      } else {
        console.warn('Torche non supportée sur cet appareil');
        return false;
      }
    } catch (error) {
      console.warn('Erreur contrôle torche:', error);
      return false;
    }
  }

  // Gestion des événements debug
  window.addEventListener('gstock:debug-changed', (event) => {
    SCANNER_CONFIG.debugMode = event.detail.enabled;
    if (!event.detail.enabled && debugOverlay) {
      debugOverlay.overlay.remove();
      debugOverlay = null;
    }
  });

  // Export des fonctions
  window.startScan = startScan;
  window.stopScan = stopScan;
  window.scanFrame = scanFrame;
  window.scanUntilKnown = scanUntilKnown;
  window.toggleTorch = toggleTorch;
  window.cleanBarcodeValue = cleanBarcodeValue;

  console.log('Module barcode.js chargé avec succès');

})();