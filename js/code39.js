/* Minimal Code39 → SVG (v2.9.3) */
(function(){
  const CHARS = {
    '0':'nnnwwnwnn','1':'wnnwnnnnw','2':'nnwwnnnnw','3':'wnwwnnnnn','4':'nnnwwnnnw','5':'wnnwwnnnn','6':'nnwwwnnnn','7':'nnnwnnwnw','8':'wnnwnnwnn','9':'nnwwnnwnn',
    'A':'wnnnnwnnw','B':'nnwnnwnnw','C':'wnwnnwnnn','D':'nnnnwwnnw','E':'wnnnwwnnn','F':'nnwnwwnnn','G':'nnnnnwwnw','H':'wnnnnwwnn','I':'nnwnnwwnn','J':'nnnnwwwnn',
    'K':'wnnnnnnww','L':'nnwnnnnww','M':'wnwnnnnwn','N':'nnnnwnnww','O':'wnnnwnnwn','P':'nnwnwnnwn','Q':'nnnnnnwww','R':'wnnnnnwwn','S':'nnwnnnwwn','T':'nnnnwnwwn',
    'U':'wwnnnnnnw','V':'nwwnnnnnw','W':'wwwnnnnnn','X':'nwnnwnnnw','Y':'wwnnwnnnn','Z':'nwwnwnnnn','-':'nwnnnnwnw','.':'wwnnnnwnn',' ':'nwwnnnwnn','$':'nwnwnwnnn','/':'nwnwnnnwn','+':'nwnnnwnwn','%':'nnnwnwnwn','*':'nwnnwnwnn'
  };
  function encode(input){
    const s=String(input).toUpperCase();
    const safe = '*'+ s.replace(/[^0-9A-Z\-\. \$\/\+\%]/g,'') +'*';
    return safe.split('').map(ch=>CHARS[ch]||CHARS['-']).join('n'); // interchar space
  }
  function svg(value, opts){
    opts=opts||{};
    const module=opts.module||2;  // px
    const h=opts.height||50;      // px
    const margin=opts.margin==null?4:opts.margin;
    const showText=!!opts.showText;
    const fontSize=opts.fontSize||12;

    const pattern=encode(value);
    // compute width
    let w=0; for(const c of pattern){ w += (c==='w'?3:1); } w *= module;
    const textH = showText ? (fontSize + 6) : 0;
    const totalW = w + margin*2;
    const totalH = h + margin*2 + textH;

    const svgNS='http://www.w3.org/2000/svg';
    const svg=document.createElementNS(svgNS,'svg');
    svg.setAttribute('viewBox',`0 0 ${totalW} ${totalH}`);
    svg.setAttribute('width', totalW);
    svg.setAttribute('height', totalH);

    let x=margin, drawBar=true;
    for(const c of pattern){
      const ww=(c==='w'?3*module:1*module);
      if(drawBar){
        const r=document.createElementNS(svgNS,'rect');
        r.setAttribute('x',x); r.setAttribute('y',margin);
        r.setAttribute('width',ww); r.setAttribute('height',h);
        r.setAttribute('fill','#000');
        svg.appendChild(r);
      }
      x+=ww;
      drawBar=!drawBar;
    }

    if(showText){
      const t=document.createElementNS(svgNS,'text');
      t.setAttribute('x', totalW/2); t.setAttribute('y', margin+h+textH-4);
      t.setAttribute('font-size', fontSize); t.setAttribute('text-anchor','middle');
      t.textContent=String(value);
      svg.appendChild(t);
    }
    return svg;
  }
  window.code39={ svg };
})();
