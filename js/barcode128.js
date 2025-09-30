/* Gstock - barcode128.js (Générateur Code 128 standard) */
(() => {
  'use strict';

  // Tables Code 128 officielles
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

  // Code Set B (caractères ASCII 32-127)
  const CODE_SET_B = {};
  for (let i = 0; i < 95; i++) {
    CODE_SET_B[String.fromCharCode(32 + i)] = i;
  }

  // Caractères spéciaux
  const START_B = 104;
  const STOP = 106;

  function generateCode128B(text) {
    if (!text || typeof text !== 'string') return null;
    
    const codes = [START_B];
    let checksum = START_B;
    
    // Encoder chaque caractère
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const code = CODE_SET_B[char];
      
      if (code === undefined) {
        console.warn(`Caractère non supporté en Code 128B: "${char}"`);
        continue;
      }
      
      codes.push(code);
      checksum += code * (i + 1);
    }
    
    // Ajouter le checksum
    checksum = checksum % 103;
    codes.push(checksum);
    codes.push(STOP);
    
    return codes;
  }

  function renderBarcodeSVG(svg, text, options = {}) {
    const {
      width = 240,
      height = 60,
      showText = true,
      fontSize = 10,
      quietZone = 10
    } = options;
    
    const codes = generateCode128B(text);
    if (!codes) return false;
    
    // Calculer la largeur totale des barres
    let totalBars = 0;
    codes.forEach(code => {
      if (CODE128_PATTERNS[code]) {
        totalBars += CODE128_PATTERNS[code].reduce((sum, w) => sum + w, 0);
      }
    });
    
    // Largeur disponible pour les barres (moins les zones de silence)
    const barcodeWidth = width - (2 * quietZone);
    const barWidth = barcodeWidth / totalBars;
    
    // Créer le SVG
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    
    // Fond blanc
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', width);
    rect.setAttribute('height', height);
    rect.setAttribute('fill', 'white');
    svg.appendChild(rect);
    
    // Dessiner les barres
    let x = quietZone;
    const barHeight = showText ? height - fontSize - 4 : height - 4;
    
    codes.forEach(code => {
      const pattern = CODE128_PATTERNS[code];
      if (!pattern) return;
      
      let isBlack = true;
      pattern.forEach(barWidthUnits => {
        const barPixelWidth = barWidthUnits * barWidth;
        
        if (isBlack) {
          const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          bar.setAttribute('x', x);
          bar.setAttribute('y', 2);
          bar.setAttribute('width', barPixelWidth);
          bar.setAttribute('height', barHeight);
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
      textElement.setAttribute('y', height - 2);
      textElement.setAttribute('text-anchor', 'middle');
      textElement.setAttribute('font-family', 'monospace');
      textElement.setAttribute('font-size', fontSize);
      textElement.setAttribute('fill', 'black');
      textElement.textContent = text;
      svg.appendChild(textElement);
    }
    
    return true;
  }

  // Export global
  window.generateCode128B = generateCode128B;
  window.renderBarcodeSVG = renderBarcodeSVG;

})();