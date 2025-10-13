/* Minimal Code39 SVG generator v1.0 – public domain */
(function(){
  const ALPHABET = {
    '0':'101001101101', '1':'110100101011', '2':'101100101011','3':'110110010101',
    '4':'101001101011', '5':'110100110101', '6':'101100110101','7':'101001011011',
    '8':'110100101101', '9':'101100101101',
    'A':'110101001011','B':'101101001011','C':'110110100101','D':'101011001011',
    'E':'110101100101','F':'101101100101','G':'101010011011','H':'110101001101',
    'I':'101101001101','J':'101011001101','K':'110101010011','L':'101101010011',
    'M':'110110101001','N':'101011010011','O':'110101101001','P':'101101101001',
    'Q':'101010110011','R':'110101011001','S':'101101011001','T':'101011011001',
    'U':'110010101011','V':'100110101011','W':'110011010101','X':'100101101011',
    'Y':'110010110101','Z':'100110110101','-':'100101011011','.' :'110010101101',
    ' ' :'100110101101','$':'100100100101','/':'100100101001','+':'100101001001',
    '%':'101001001001','*':'100101101101' /* start/stop */
  };
  function encode(text){
    const t = '*'+String(text).toUpperCase().replace(/[^0-9A-Z\-\.\ \$\/\+\%]/g,'')+'*';
    return t.split('').map(ch=>ALPHABET[ch]||'').join('0'); // narrow inter-char space
  }
  function svg(code, opts){
    opts = opts || {};
    const module = Math.max(0.6, +opts.module || 1.2);
    const height = Math.max(16, +opts.height || 48);
    const margin = Math.max(0, +opts.margin || 2);
    const showText = !!opts.showText;
    const fontSize = +opts.fontSize || 12;

    const bits = encode(code);
    const width = Math.round(bits.length * module) + margin*2;
    const svgns = 'http://www.w3.org/2000/svg';
    const el = document.createElementNS(svgns, 'svg');
    el.setAttribute('width', width);
    el.setAttribute('height', height + (showText? (fontSize+6):0));
    el.setAttribute('viewBox', `0 0 ${width} ${height + (showText?(fontSize+6):0)}`);
    let x = margin, y = margin, h = height - margin*2;

    // bars
    for (let i=0;i<bits.length;i++){
      if(bits[i]==='1'){
        const r = document.createElementNS(svgns, 'rect');
        r.setAttribute('x', x); r.setAttribute('y', y);
        r.setAttribute('width', module); r.setAttribute('height', h);
        r.setAttribute('fill', '#000');
        el.appendChild(r);
      }
      x += module;
    }
    if(showText){
      const txt = document.createElementNS(svgns, 'text');
      txt.setAttribute('x', width/2);
      txt.setAttribute('y', height + fontSize);
      txt.setAttribute('text-anchor','middle');
      txt.setAttribute('font-size', fontSize);
      txt.textContent = code;
      el.appendChild(txt);
    }
    return el;
  }
  window.code39 = { svg };
})();
