/* Gstock - barcode128.js (Générateur Code 128 standard complet) */
(() => {
  'use strict';

  // Tables Code 128 officielles complètes
  const CODE128_PATTERNS = [
    [2,1,2,2,2,2], [2,2,2,1,2,2], [2,2,2,2,2,1], [1,2,1,2,2,3], [1,2,1,3,2,2],
    [1,3,1,2,2,2], [1,2,2,2,1,3], [1,2,2,3,1,2], [1,3,2,2,1,2], [2,2,1,2,1,3],
    [2,2,1,3,1,2], [2,3,1,2,1,2], [1,1,2,2,3,2], [1,2,2,1,3,2], [1,2,2,2,3,1],
    [1,1,3,2,2,2], [1,2,3,1,2,2], [1,2,3,2,2,1], [2,2,3,2,1,1], [2,2,1,1,3,2],
    [2,2,1,2,3,1], [2,1,3,2,1,2], [2,2,3,1,1,2], [3,1,2,1,3,1], [3,1,1,2,2,2],
    [3,2,1,1,2,2], [3,2,1,2,2,1], [3,1,2,2,1,2], [3,2,2,1,1,2], [3,2,2,2,1,1],
    [2,1,2,1,2,3], [2,1,2,3,2,1], [2,3,2,1,2,1], [1,1,1,3,2,3], [1,3,1,1,2,3],
    [1,3,1,3,2,1], [1,1,2,3,1,3], [1,3,2,1,1,3], [1,3,2,3,1,1], [2,1,1,3,1,3],
    [2,3,1,1,1,3], [2,3,1,3,1,1], [1,1,2,1,3,3], [1,1,2,3,3,1], [1,3,2,1,3,1],
    [1,1,3,1,2,3], [1,1,3,3,2,1], [1,3,3,1,2,1], [3,1,3,1,2,1], [2,1,1,3,3,1],
    [2,3,1,1,3,1], [2,1,3,1,1,3], [2,1,3,3,1,1], [2,1,3,1,3,1], [3,1,1,1,2,3],
    [3,1,1,3,2,1], [3,3,1,1,2,1], [3,1,2,1,1,3], [3,1,2,3,1,1], [3,3,2,1,1,1],
    [3,1,4,1,1,1], [2,2,1,4,1,1], [4,3,1,1,1,1], [1,1,1,2,2,4], [1,1,1,4,2,2],
    [1,2,1,1,2,4], [1,2,1,4,2,1], [1,4,1,1,2,2], [1,4,1,2,2,1], [1,1,2,2,1,4],
    [1,1,2,4,1,2], [1,2,2,1,1,4], [1,2,2,4,1,1], [1,4,2,1,1,2], [1,4,2,2,1,1],
    [2,4,1,2,1,1], [2,2,1,1,1,4], [4,1,3,1,1,1], [2,4,1,1,1,2], [1,3,4,1,1,1],
    [1,1,1,2,4,2], [1,2,1,1,4,2], [1,2,1,2,4,1], [1,1,4,2,1,2], [1,2,4,1,1,2],
    [1,2,4,2,1,1], [4,1,1,2,1,2], [4,2,1,1,1,2], [4,2,1,2,1,1], [2,1,2,1,4,1],
    [2,1,4,1,2,1], [4,1,2,1,2,1], [1,1,1,1,4,3], [1,1,1,3,4,1], [1,3,1,1,4,1],
    [1,1,4,1,1,3], [1,1,4,3,1,1], [4,1,1,1,1,3], [4,1,1,3,1,1], [1,1,3,1,4,1],
    [1,1,4,1,3,1], [3,1,1,1,4,1], [4,1,1,1,3,1], [2,1,1,4,1,2], [2,1,1,2,1,4],
    [2,1,1,2,3,2], [2,3,3,1,1,1,2]
  ];

  // Code Set B (ASCII 32-127) - caractères imprimables
  const CODE_SET_B = {};
  for (let i = 0; i < 95; i++) {
    CODE_SET_B[String.fromCharCode(32 + i)] = i;
  }

  // Caractères spéciaux Code 128
  const START_B = 104;
  const STOP = 106;

  /**
   * Génère les codes pour une chaîne en Code 128B
   */
  function generateCode128B(text) {
    if (!text || typeof text !== 'string') {
      console.error('Texte invalide pour Code 128B:', text);
      return null;
    }
    
    const codes = [START_B];
    let checksum = START_B;
    
    // Encoder chaque caractère
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const code = CODE_SET_B[char];
      
      if (code === undefined) {
        console.warn(`Caractère non supporté en Code 128B: "${char}" (code ${char.charCodeAt(0)})`);
        return null;
      }
      
      codes.push(code);
      checksum += code * (i + 1);
    }
    
    // Ajouter le checksum modulo 103
    checksum = checksum % 103;
    codes.push(checksum);
    
    // Ajouter le caractère STOP
    codes.push(STOP);
    
    return codes;
  }

  /**
   * Génère un SVG de code-barres Code 128
   */
  function renderBarcodeSVG(svg, text, options = {}) {
    const {
      width = 300,
      height = 80,
      showText = true,
      fontSize = 12,
      quietZone = 10,
      barHeight = null
    } = options;
    
    // Nettoyer le SVG
    svg.innerHTML = '';
    
    const codes = generateCode128B(text);
    if (!codes) {
      console.error('Impossible de générer le code-barres pour:', text);
      return false;
    }
    
    // Calculer la largeur totale des barres
    let totalBars = 0;
    codes.forEach(code => {
      if (CODE128_PATTERNS[code]) {
        totalBars += CODE128_PATTERNS[code].reduce((sum, w) => sum + w, 0);
      }
    });
    
    // Largeur disponible pour les barres (moins les zones de silence)
    const barcodeWidth = width - (2 * quietZone);
    const barWidth = Math.max(1, barcodeWidth / totalBars);
    
    // Hauteur des barres
    const actualBarHeight = barHeight || (showText ? height - fontSize - 8 : height - 8);
    
    // Configurer le SVG
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.style.display = 'block';
    
    // Fond blanc
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', width);
    rect.setAttribute('height', height);
    rect.setAttribute('fill', 'white');
    svg.appendChild(rect);
    
    // Dessiner les barres
    let x = quietZone;
    
    codes.forEach(code => {
      const pattern = CODE128_PATTERNS[code];
      if (!pattern) {
        console.warn('Pattern manquant pour le code:', code);
        return;
      }
      
      let isBlack = true;
      pattern.forEach(barWidthUnits => {
        const barPixelWidth = Math.max(1, barWidthUnits * barWidth);
        
        if (isBlack) {
          const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          bar.setAttribute('x', Math.round(x));
          bar.setAttribute('y', 4);
          bar.setAttribute('width', Math.round(barPixelWidth));
          bar.setAttribute('height', actualBarHeight);
          bar.setAttribute('fill', 'black');
          svg.appendChild(bar);
        }
        
        x += barPixelWidth;
        isBlack = !isBlack;
      });
    });
    
    // Ajouter le texte
    if (showText) {
      const textElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      textElement.setAttribute('x', width / 2);
      textElement.setAttribute('y', height - 4);
      textElement.setAttribute('text-anchor', 'middle');
      textElement.setAttribute('font-family', 'monospace');
      textElement.setAttribute('font-size', fontSize);
      textElement.setAttribute('fill', 'black');
      textElement.textContent = text;
      svg.appendChild(textElement);
    }
    
    return true;
  }

  /**
   * Valide qu'un texte peut être encodé en Code 128B
   */
  function validateCode128B(text) {
    if (!text || typeof text !== 'string') return false;
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (CODE_SET_B[char] === undefined) {
        return false;
      }
    }
    return true;
  }

  // Export global
  window.generateCode128B = generateCode128B;
  window.renderBarcodeSVG = renderBarcodeSVG;
  window.validateCode128B = validateCode128B;

})();