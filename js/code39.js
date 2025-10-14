/* Gstock Code39 v2.9.0 – rendu SVG minimal */
(function(){
  'use strict';
  // Table Code39 (narrow=1, wide=2, intercaracter=1 narrow)
  const C39 = {
    '0':'nnnwwnwnn','1':'wnnwnnnnw','2':'nnwwnnnnw','3':'wnwwnnnnn','4':'nnnwwnnnw','5':'wnnwwnnnn','6':'nnwwwnnnn','7':'nnnwnnwnw','8':'wnnwnnwnn','9':'nnwwnnwnn',
    'A':'wnnnnwnnw','B':'nnwnnwnnw','C':'wnwnnwnnn','D':'nnnnwwnnw','E':'wnnnwwnnn','F':'nnwnwwnnn','G':'nnnnnwwnw','H':'wnnnnwwnn','I':'nnwnnwwnn','J':'nnnnwwwnn',
    'K':'wnnnnnnww','L':'nnwnnnnww','M':'wnwnnnnwn','N':'nnnnwnnww','O':'wnnnwnnwn','P':'nnwnwnnwn','Q':'nnnnnnwww','R':'wnnnnnwwn','S':'nnwnnnwwn','T':'nnnnwnwwn',
    'U':'wwnnnnnnw','V':'nwwnnnnnw','W':'wwwnnnnnn','X':'nwnnwnnnw','Y':'wwnnwnnnn','Z':'nwwnwnnnn','-':'nwnnnnwnw','.' :'wwnnnnwnn',' ' :'nwwnnnwnn','$':'nwnwnwnnn',
    '/' :'nwnwnnnwn','+' :'nwnnnwnwn','%' :'nnnwnwnwn','*':'nwnnwnwnn'
  };
  function patternFor(ch){ return C39[ch] || C39['*']; }
  function validText(s){ return String(s).toUpperCase().replace(/[^0-9A-Z\-\.\ \$\/\+\%]/g,''); }
  function encode(txt){ txt='*'+validText(txt)+'*'; let out=[]; for(let i=0;i<txt.length;i++){ out.push(patternFor(txt[i])); } return out.join('n'); }
  function svg(text, opts){
    opts=opts||{};
    const module = Math.max(0.6, +opts.module || 1.6);
    const height = Math.max(16, +opts.height || 48);
    const margin = Math.max(0, +opts.margin || 0);
    const showText = !!opts.showText;
    const fontSize = +opts.fontSize || 10;

    const patt = encode(text);
    let width = 0;
    for(let i=0;i<patt.length;i++){ width += (patt[i]==='w'? (module*3) : module); }
    width += margin*2;

    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
    svg.setAttribute('width', Math.ceil(width));
    svg.setAttribute('height', height + (showText? fontSize+4 : 0));
    svg.setAttribute('viewBox', `0 0 ${width} ${height + (showText? fontSize+4 : 0)}`);

    let x = margin;
    let bar = true;
    for(let i=0;i<patt.length;i++){
      let w = (patt[i]==='w'? (module*3) : module);
      if(bar){
        const r = document.createElementNS(svg.namespaceURI,'rect');
        r.setAttribute('x', x);
        r.setAttribute('y', 0);
        r.setAttribute('width', w);
        r.setAttribute('height', height);
        r.setAttribute('fill', '#000');
        svg.appendChild(r);
      }
      x += w;
      bar = !bar;
    }
    if(showText){
      const t = document.createElementNS(svg.namespaceURI,'text');
      t.setAttribute('x', width/2);
      t.setAttribute('y', height + fontSize);
      t.setAttribute('text-anchor','middle');
      t.setAttribute('font-size', fontSize);
      t.textContent = text;
      svg.appendChild(t);
    }
    return svg;
  }
  window.code39 = { svg };
})();
